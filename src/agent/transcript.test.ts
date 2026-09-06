// Run with: node --experimental-strip-types src/agent/transcript.test.ts
import { readFileSync } from "node:fs";
import { addPermission, addUser, applyFs, applyMessage, emptySession, expirePermissions, filesTouchedInTurn, fmtTokens, parseRateLimit, resetProcessCost, retryText, settlePermission, usageTokens, type Item } from "./transcript.ts";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) { failures++; console.log(`FAIL ${name}`, detail ?? ""); }
};

// 1. A real recorded stream from Claude Code 2.1.257 (haiku, a turn that tries to Write a file).
{
  const lines = readFileSync(new URL("./fixtures/claude-2.1.257-write-turn.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean);
  const s = emptySession();
  for (const l of lines) applyMessage(s, JSON.parse(l));
  const kinds = s.items.map((i) => i.kind);
  check("fixture: model captured from system/init", s.model === "claude-haiku-4-5-20251001", s.model);
  check("fixture: assistant text present", s.items.some((i) => i.kind === "assistant" && i.text.length > 0), kinds);
  check("fixture: three tool calls", s.items.filter((i) => i.kind === "tool").length === 3, kinds);
  check("fixture: tool results attached", s.items.filter((i) => i.kind === "tool" && i.result !== null).length === 3);
  check("fixture: failed writes are marked error", s.items.some((i) => i.kind === "tool" && i.name === "Write" && i.status === "error"));
  const result = s.items.find((i) => i.kind === "result");
  check("fixture: result present and successful", !!result && result.kind === "result" && !result.isError, result);
  check("fixture: cost recorded", result?.kind === "result" && (result.costUsd ?? 0) > 0.05, result?.kind === "result" ? result.costUsd : null);
  check("fixture: not busy after result", s.busy === false);
  check("fixture: no files counted for failed writes", result?.kind === "result" && result.files.length === 0, result?.kind === "result" ? result.files : null);
}

// 2. Token streaming: deltas accumulate, the full message replaces them, message_stop ends streaming.
{
  const s = emptySession();
  applyMessage(s, { type: "stream_event", event: { type: "message_start", message: { id: "m1" } }, parent_tool_use_id: null });
  applyMessage(s, { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } }, parent_tool_use_id: null });
  applyMessage(s, { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } }, parent_tool_use_id: null });
  const streaming = s.items[0];
  check("stream: text accumulates", streaming.kind === "assistant" && streaming.text === "Hello" && streaming.streaming);
  applyMessage(s, { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Hello, world." }] }, parent_tool_use_id: null });
  check("stream: full message replaces partial text", s.items.length === 1 && s.items[0].kind === "assistant" && s.items[0].text === "Hello, world." && !s.items[0].streaming, s.items);
  applyMessage(s, { type: "stream_event", event: { type: "message_start", message: { id: "sub" } }, parent_tool_use_id: "toolu_parent" });
  check("stream: subagent tokens are not shown", s.items.length === 1);
}

// 3. Interrupt shows as Stopped, other error subtypes get plain language.
{
  const s = emptySession();
  addUser(s, "count forever", null);
  s.interrupting = true;
  applyMessage(s, { type: "result", subtype: "error_during_execution", is_error: true, result: null, duration_ms: 6000, total_cost_usd: 0 });
  const r = s.items.find((i) => i.kind === "result");
  check("interrupt: stopped, not error", r?.kind === "result" && r.stopped && !r.isError && r.text === "Stopped", r);
  const s2 = emptySession();
  applyMessage(s2, { type: "result", subtype: "error_max_turns", is_error: true, result: null });
  const r2 = s2.items.find((i) => i.kind === "result");
  check("errors: friendly text for max turns", r2?.kind === "result" && r2.isError && /turn limit/.test(r2.text), r2);
}

// 3b. Signed out: the CLI sends a synthetic assistant message and an error result (recorded from
// 2.1.257 with an empty HOME). The bubble is skipped and the result says what to do in Open's terms.
{
  const s = emptySession();
  addUser(s, "say hi", null);
  applyMessage(s, { type: "assistant", message: { id: "a1", model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "Not logged in · Please run /login" }] }, parent_tool_use_id: null, error: "authentication_failed", is_api_error_message: true });
  check("auth: synthetic bubble not shown", !s.items.some((i) => i.kind === "assistant"), s.items);
  applyMessage(s, { type: "result", subtype: "success", is_error: true, num_turns: 1, result: "Not logged in · Please run /login", terminal_reason: "api_error", duration_ms: 76, total_cost_usd: 0 });
  const r = s.items.find((i) => i.kind === "result");
  check("auth: result reworded with claude auth login", r?.kind === "result" && r.isError && /claude auth login/.test(r.text) && !/\/login/.test(r.text), r);
  check("auth: not busy afterwards", s.busy === false);
  // recorded from 2.1.257 with ANTHROPIC_BASE_URL pointing at a closed port, after 10 retries (~3 min)
  const s2 = emptySession();
  applyMessage(s2, { type: "assistant", message: { id: "a2", model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "API Error: Connection refused — a firewall or proxy may be blocking it (ConnectionRefused)" }] }, parent_tool_use_id: null, error: "server_error", is_api_error_message: true });
  applyMessage(s2, { type: "result", subtype: "success", is_error: true, terminal_reason: "api_error", result: "API Error: Connection refused — a firewall or proxy may be blocking it (ConnectionRefused)" });
  const r2 = s2.items.find((i) => i.kind === "result");
  check("offline: synthetic bubble skipped", !s2.items.some((i) => i.kind === "assistant"), s2.items);
  check("offline: reworded and keeps the CLI's hint", r2?.kind === "result" && /internet connection/.test(r2.text) && /firewall or proxy/.test(r2.text) && !/API Error:/.test(r2.text), r2);
  const s2b = emptySession();
  applyMessage(s2b, { type: "result", subtype: "success", is_error: true, result: "API Error: fetch failed" });
  check("offline: fetch failed reworded", s2b.items.some((i) => i.kind === "result" && /internet connection/.test(i.text)), s2b.items);
}

// 3d. API retries (recorded 2.1.257 with ANTHROPIC_BASE_URL pointing at a closed port): the CLI
// emits system/api_retry up to 10 times with growing delays; the session shows it and stays busy.
{
  const s = emptySession();
  addUser(s, "hi", null);
  applyMessage(s, { type: "system", subtype: "api_retry", attempt: 3, max_retries: 10, retry_delay_ms: 2134, error_status: null, error: "unknown" });
  check("retry: recorded and busy", s.busy && s.retry?.attempt === 3 && s.retry.max === 10, s.retry);
  check("retry: text names the cause and the count", s.retry ? /Can't reach Claude's API; retrying in 2s \(3 of 10\)/.test(retryText(s.retry)) : false, s.retry && retryText(s.retry));
  applyMessage(s, { type: "system", subtype: "api_retry", attempt: 4, max_retries: 10, retry_delay_ms: 4045, error_status: 529, error: "overloaded" });
  check("retry: overloaded wording", s.retry ? /overloaded/.test(retryText(s.retry)) : false, s.retry && retryText(s.retry));
  applyMessage(s, { type: "stream_event", event: { type: "message_start", message: { id: "m9" } }, parent_tool_use_id: null });
  check("retry: cleared once the turn moves on", s.retry === null);
  const s2 = emptySession();
  applyMessage(s2, { type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: 429, error: "rate_limit" });
  applyMessage(s2, { type: "result", subtype: "success", is_error: true, result: "API Error: 529 overloaded_error" });
  check("retry: cleared by the result, which is reworded", s2.retry === null && s2.items.some((i) => i.kind === "result" && /overloaded/.test(i.text)), s2.items);
}

// 3c. Rate limit rejected: one notice with the reset time, not repeated for the same event.
{
  const s = emptySession();
  const ev = { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1_900_000_000, unifiedWindows: { five_hour: { utilization: 1, resetsAt: 1_900_000_000 } } } };
  applyMessage(s, ev);
  applyMessage(s, ev);
  const notices = s.items.filter((i) => i.kind === "notice");
  check("rate limit: one notice", notices.length === 1 && /plan limit/.test(notices[0].kind === "notice" ? notices[0].text : ""), notices);
  check("rate limit: usage recorded", s.usage?.utilization === 1, s.usage);
  const s3 = emptySession();
  applyMessage(s3, { type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.3 } } } });
  check("rate limit: allowed adds no notice", s3.items.length === 0 && s3.usage?.utilization === 0.3);
}

// 4. Files touched in a turn: Edit/Write since the last user message, failures excluded, deduped.
{
  const items: Item[] = [
    { kind: "user", id: "u1", text: "earlier" },
    { kind: "tool", id: "t0", name: "Edit", input: { file_path: "/s/old.tsx" }, label: "", result: "", status: "done", parentToolUseId: null },
    { kind: "user", id: "u2", text: "now" },
    { kind: "tool", id: "t1", name: "Read", input: { file_path: "/s/a.tsx" }, label: "", result: "", status: "done", parentToolUseId: null },
    { kind: "tool", id: "t2", name: "Edit", input: { file_path: "/s/a.tsx" }, label: "", result: "", status: "done", parentToolUseId: null },
    { kind: "tool", id: "t3", name: "Write", input: { file_path: "/s/b.tsx" }, label: "", result: "", status: "error", parentToolUseId: null },
    { kind: "tool", id: "t4", name: "Edit", input: { file_path: "/s/a.tsx" }, label: "", result: "", status: "done", parentToolUseId: null },
    { kind: "tool", id: "t5", name: "Write", input: { file_path: "/s/c.css" }, label: "", result: "", status: "done", parentToolUseId: null },
  ];
  const { files } = filesTouchedInTurn(items);
  check("files: current turn only, deduped, failures excluded", JSON.stringify(files) === JSON.stringify(["/s/a.tsx", "/s/c.css"]), files);
  // a queued message sitting at the end must not hide the turn's files
  const withQueued: Item[] = [...items, { kind: "user", id: "u3", text: "queued", queued: true }];
  check("files: queued message does not end the turn early", filesTouchedInTurn(withQueued).files.length === 2, filesTouchedInTurn(withQueued));
  // created files are tracked separately, from the Rust fs event
  const s5 = emptySession();
  s5.items = [...items];
  applyFs(s5, "t5", false);
  applyFs(s5, "t2", true);
  const t = filesTouchedInTurn(s5.items);
  check("files: created list only holds files that did not exist before", JSON.stringify(t.created) === JSON.stringify(["/s/c.css"]), t);
}

// 5. Permissions: pending → settled, queued user messages clear when the next turn starts.
{
  const s = emptySession();
  addPermission(s, { sessionId: "x", requestId: "req1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } });
  check("permission: busy while pending", s.busy && s.items[0].kind === "permission" && s.items[0].status === "pending");
  settlePermission(s, "req1", "allowed");
  check("permission: settled", s.items[0].kind === "permission" && s.items[0].status === "allowed");
  addUser(s, "second", null);
  check("queue: message sent while busy is queued", s.items[1].kind === "user" && s.items[1].queued === true);
  applyMessage(s, { type: "stream_event", event: { type: "message_start", message: { id: "m9" } }, parent_tool_use_id: null });
  check("queue: still queued while the current turn continues", s.items[1].kind === "user" && s.items[1].queued === true);
  applyMessage(s, { type: "result", subtype: "success", is_error: false, result: "ok" });
  check("queue: cleared when the current turn ends, session stays busy", s.items[1].kind === "user" && s.items[1].queued === false && s.busy === true);
  const s6 = emptySession();
  addPermission(s6, { sessionId: "x", requestId: "req2", request: { subtype: "can_use_tool", tool_name: "Bash", input: {} } });
  applyMessage(s6, { type: "result", subtype: "error_during_execution", is_error: true, result: null });
  check("permission: unanswered approval expires when the turn ends", s6.items[0].kind === "permission" && s6.items[0].status === "expired" && s6.busy === false);
  check("permission: expirePermissions counts", expirePermissions(emptySession()) === 0);
}

// 6. Saved transcripts: user lines with images and a selection block render both.
{
  const s = emptySession();
  applyMessage(s, { type: "user", message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } }, { type: "text", text: "make it like this" }, { type: "text", text: "Selected element (clicked in the live preview):\n- element: <h1>" }] }, parent_tool_use_id: null });
  const u = s.items[0];
  check("saved: image + text + selection split", u.kind === "user" && u.text === "make it like this" && u.images?.length === 1 && !!u.selectionSummary, u);
}

// 7. Context fullness, plan windows and cost. Cost numbers recorded from 2.1.257: two haiku turns in one
// process reported total_cost_usd 0.030972 then 0.0395562, i.e. the total is cumulative per process.
{
  const lines = readFileSync(new URL("./fixtures/claude-2.1.257-write-turn.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const s = emptySession();
  for (const l of lines) applyMessage(s, l);
  const lastUsage = [...lines].reverse().find((l) => l.type === "assistant" && l.message?.usage)?.message.usage;
  check("context: last API call's input + cache tokens (not the turn's sum)", s.context?.used === usageTokens(lastUsage) && s.context.used > 40000 && s.context.used < 60000, s.context);
  check("context: window from the result's modelUsage", s.context?.window === 200000, s.context);
  check("cost: first result of a process is its own cost", s.cost.session > 0.05 && s.cost.process === s.cost.session && s.cost.turns === 1, s.cost);

  const t = emptySession();
  applyMessage(t, { type: "result", subtype: "success", is_error: false, result: "ONE", total_cost_usd: 0.030972 });
  applyMessage(t, { type: "result", subtype: "success", is_error: false, result: "TWO", total_cost_usd: 0.0395562 });
  const costs = t.items.map((i) => (i.kind === "result" ? i.costUsd : null));
  check("cost: completion lines show each turn's share, not the running total", Math.abs((costs[0] ?? 0) - 0.030972) < 1e-9 && Math.abs((costs[1] ?? 0) - 0.0085842) < 1e-6, costs);
  t.interrupting = true;
  applyMessage(t, { type: "result", subtype: "error_during_execution", is_error: true, result: null, total_cost_usd: 0 });
  const last = t.items[t.items.length - 1];
  check("cost: an interrupted turn (total 0) shows no cost and keeps the totals", last.kind === "result" && last.costUsd === null && Math.abs(t.cost.session - 0.0395562) < 1e-9 && t.cost.turns === 2, t.cost);
  resetProcessCost(t);
  applyMessage(t, { type: "result", subtype: "success", is_error: false, result: "THREE", total_cost_usd: 0.02 });
  check("cost: a restarted process counts from zero again", Math.abs(t.cost.session - 0.0595562) < 1e-9 && t.cost.process === 0.02 && t.cost.turns === 3, t.cost);

  const c = emptySession();
  applyMessage(c, { type: "system", subtype: "init", model: "claude-sonnet-4-6[1m]" });
  applyMessage(c, { type: "stream_event", event: { type: "message_start", message: { id: "m1", usage: { input_tokens: 4, cache_creation_input_tokens: 1000, cache_read_input_tokens: 30000, output_tokens: 1 } } }, parent_tool_use_id: null });
  check("context: known from message_start; 1M window for [1m] models", c.context?.used === 31004 && c.context.window === 1_000_000, c.context);
  applyMessage(c, { type: "stream_event", event: { type: "message_start", message: { id: "sub", usage: { input_tokens: 4, cache_read_input_tokens: 90000 } } }, parent_tool_use_id: "toolu_parent" });
  check("context: subagent calls don't count", c.context?.used === 31004, c.context);
  applyMessage(c, { type: "assistant", message: { id: "err", role: "assistant", content: [{ type: "text", text: "API Error" }], usage: { input_tokens: 0, cache_read_input_tokens: 0 } }, parent_tool_use_id: null, error: "server_error", is_api_error_message: true });
  check("context: synthetic error messages don't count", c.context?.used === 31004, c.context);
  applyMessage(c, { type: "system", subtype: "compact_boundary", uuid: "cb1", compact_metadata: { trigger: "auto", pre_tokens: 180000, post_tokens: 9000 } });
  const n1 = c.items[c.items.length - 1];
  check("compact: notice added and context reset (stream-json shape)", c.context?.used === 9000 && n1.kind === "notice" && /summarised/.test(n1.text) && /180k/.test(n1.text), n1);
  applyMessage(c, { type: "system", subtype: "compact_boundary", uuid: "cb2", compactMetadata: { trigger: "manual", preTokens: 84665 } });
  const n2 = c.items[c.items.length - 1];
  check("compact: saved-transcript shape; zero until the next call when post tokens are unknown", c.context?.used === 0 && n2.kind === "notice" && /85k/.test(n2.text), n2);

  const r = emptySession();
  applyMessage(r, { type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 1788690000, rateLimitType: "five_hour", overageStatus: "rejected", overageDisabledReason: "out_of_credits", isUsingOverage: false, unifiedWindows: { five_hour: { utilization: 0.19, resetsAt: 1788690000 }, seven_day: { utilization: 0.13, resetsAt: 1789002000 } } } });
  check("plan: both windows kept, the highest drives the chip", r.plan.length === 2 && r.usage?.window === "five_hour" && r.usage.utilization === 0.19, r.plan);
  check("plan: parseRateLimit tolerates a missing payload", parseRateLimit(null).length === 0 && parseRateLimit({ unifiedWindows: { x: {} } }).length === 0);
  check("tokens: formatting", fmtTokens(950) === "950" && fmtTokens(41125) === "41k" && fmtTokens(1_000_000) === "1M" && fmtTokens(1_250_000) === "1.3M", [fmtTokens(950), fmtTokens(41125), fmtTokens(1_000_000), fmtTokens(1_250_000)]);
}

// 8. Thinking summaries (recorded 2.1.257, haiku, `--effort low --settings '{"showThinkingSummaries":true}'`): the thinking
// block streams before the text and arrives as its own assistant message; the row keeps streaming until the text comes.
{
  const lines = readFileSync(new URL("./fixtures/claude-2.1.257-thinking-summaries.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const s = emptySession();
  let sawThinkingPhase = false;
  let streamingAfterThinkingBlock = false;
  for (const l of lines) {
    applyMessage(s, l);
    const a = s.items.find((i) => i.kind === "assistant");
    if (a?.kind === "assistant" && a.streaming && !a.text && a.phase === "thinking" && a.thinking.length > 0) sawThinkingPhase = true;
    if (l.type === "assistant" && l.message.content.every((b: any) => b.type === "thinking")) streamingAfterThinkingBlock = a?.kind === "assistant" && a.streaming;
  }
  const a = s.items.find((i) => i.kind === "assistant");
  check("thinking: summary text captured", a?.kind === "assistant" && a.thinking.length > 100 && a.text === "ok", a);
  check("thinking: live phase seen while it streamed", sawThinkingPhase);
  check("thinking: the thinking-only assistant message does not end streaming", streamingAfterThinkingBlock);
  check("thinking: phase is text once the answer streams", a?.kind === "assistant" && a.phase === "text" && !a.streaming, a);
  check("model: exact id on the assistant item", a?.kind === "assistant" && a.model === "claude-haiku-4-5-20251001", a);
  check("fast: off with the CLI's reason when not opted in", s.fast?.state === "off" && s.fast.reason === "sdk_opt_in_required", s.fast);
  const r = s.items.find((i) => i.kind === "result");
  check("result: models from modelUsage and standard speed", r?.kind === "result" && JSON.stringify(r.models) === JSON.stringify(["claude-haiku-4-5-20251001"]) && r.speed === "standard", r);
}

// 9. Fast mode (recorded 2.1.257, opus, `--settings '{"fastMode":true}'`): init and result say "on"; the one-word answer still ran at standard speed.
{
  const lines = readFileSync(new URL("./fixtures/claude-2.1.257-fast-mode.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const s = emptySession();
  for (const l of lines) applyMessage(s, l);
  check("fast: on from init and result", s.fast?.state === "on" && s.fast.reason === null, s.fast);
  check("fast: exact model", s.model === "claude-opus-5" && s.items.some((i) => i.kind === "assistant" && i.model === "claude-opus-5"), s.model);
  const r = s.items.find((i) => i.kind === "result");
  check("fast: speed recorded from usage.speed", r?.kind === "result" && r.speed === "standard" && r.models[0] === "claude-opus-5", r);
  const t = emptySession();
  applyMessage(t, { type: "result", subtype: "success", is_error: false, result: "ok", fast_mode_state: "cooldown", usage: { speed: "fast" }, modelUsage: { "claude-opus-5": { costUSD: 0.2 }, "<synthetic>": {} } });
  const rt = t.items[0];
  check("fast: cooldown and a fast request", t.fast?.state === "cooldown" && rt.kind === "result" && rt.speed === "fast" && JSON.stringify(rt.models) === JSON.stringify(["claude-opus-5"]), [t.fast, rt]);
}

// 10. Thinking without text (summaries off): the CLI's thinking_tokens estimates still mark the row as thinking.
{
  const s = emptySession();
  applyMessage(s, { type: "stream_event", event: { type: "message_start", message: { id: "m1", model: "claude-sonnet-5" } }, parent_tool_use_id: null });
  applyMessage(s, { type: "system", subtype: "thinking_tokens", estimated_tokens: 50, estimated_tokens_delta: 50 });
  const a = s.items[0];
  check("thinking: tokens-only marks the phase", a.kind === "assistant" && a.phase === "thinking" && a.thinking === "" && a.model === "claude-sonnet-5", a);
  applyMessage(s, { type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hi" } }, parent_tool_use_id: null });
  check("thinking: text delta moves the phase on", s.items[0].kind === "assistant" && s.items[0].phase === "text" && s.items[0].text === "Hi");
}

console.log(failures === 0 ? "transcript: all checks pass" : `transcript: ${failures} failure(s)`);
if (failures) throw new Error(`${failures} transcript check(s) failed`);
