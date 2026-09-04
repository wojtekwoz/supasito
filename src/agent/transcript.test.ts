// Run with: node --experimental-strip-types src/agent/transcript.test.ts
import { readFileSync } from "node:fs";
import { addPermission, addUser, applyFs, applyMessage, emptySession, expirePermissions, filesTouchedInTurn, settlePermission, type Item } from "./transcript.ts";

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
  const s2 = emptySession();
  applyMessage(s2, { type: "result", subtype: "success", is_error: true, result: "API Error: fetch failed" });
  const r2 = s2.items.find((i) => i.kind === "result");
  check("offline: reworded", r2?.kind === "result" && /internet connection/.test(r2.text), r2);
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

console.log(failures === 0 ? "transcript: all checks pass" : `transcript: ${failures} failure(s)`);
if (failures) throw new Error(`${failures} transcript check(s) failed`);
