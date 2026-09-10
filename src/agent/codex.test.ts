// Run with: node --experimental-strip-types src/agent/codex.test.ts
import { readFileSync } from "node:fs";
import { applyCodexMessage, parseCodexRateLimits, windowName } from "./codex.ts";
import { addPermission, addUser, backendOf, emptySession, settlePermission } from "./transcript.ts";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) { failures++; console.log(`FAIL ${name}`, detail ?? ""); }
};
const fixture = () => readFileSync(new URL("./fixtures/codex-0.149.0-write-turn.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const session = () => { const s = emptySession(); applyCodexMessage(s, { method: "supasito/session", params: { model: "gpt-5.6-luna", mode: "acceptEdits" } }); return s; };

// 1. The recorded turn: one command, one new file, both approved, one final sentence.
{
  const s = session();
  for (const m of fixture()) applyCodexMessage(s, m);
  const kinds = s.items.map((i) => i.kind);
  check("fixture: backend is codex", s.backend === "codex");
  check("fixture: model is what Supasito asked for", s.model === "gpt-5.6-luna", s.model);
  check("fixture: the user message is a row", s.items.some((i) => i.kind === "user" && i.text.startsWith("Run the shell command")), kinds);
  const assistants = s.items.filter((i) => i.kind === "assistant");
  // commentary, a thinking-only bubble before the write (the model went straight to the tool), the final sentence;
  // the third reasoning item had an empty summary and was folded into the final message.
  check("fixture: three assistant bubbles", assistants.length === 3 && assistants[1].kind === "assistant" && assistants[1].text === "" && assistants[1].thinking.includes("Implementing"), assistants.map((a) => a.kind === "assistant" && [a.text, a.thinking]));
  check("fixture: reasoning folded into the bubble as thinking", assistants[0].kind === "assistant" && assistants[0].thinking.includes("Planning") && assistants[0].text.length > 0, assistants[0]);
  check("fixture: nothing left streaming", assistants.every((a) => a.kind === "assistant" && !a.streaming));
  const bash = s.items.find((i) => i.kind === "tool" && i.name === "Bash");
  check("fixture: the command is a Bash row, done, label without the zsh wrapper", bash?.kind === "tool" && bash.status === "done" && bash.label === "Running git status --short", bash);
  const write = s.items.find((i) => i.kind === "tool" && i.name === "Write");
  check("fixture: the new file is a created Write row", write?.kind === "tool" && write.created === true && write.input.file_path === "/Users/me/site/probe.txt" && write.status === "done", write);
  const result = s.items.find((i) => i.kind === "result");
  check("fixture: result present, successful, no dollars", result?.kind === "result" && !result.isError && result.costUsd === null && result.durationMs === 12768, result);
  check("fixture: Undo knows the file and that it was created", result?.kind === "result" && result.files.join() === "/Users/me/site/probe.txt" && result.created.join() === "/Users/me/site/probe.txt", result?.kind === "result" ? [result.files, result.created] : null);
  check("fixture: not busy after the turn", s.busy === false);
  check("fixture: context from the last call's input tokens", !!s.context && s.context.used > 10_000 && s.context.window > s.context.used, s.context);
  check("fixture: plan window from account/rateLimits", s.plan.length === 1 && s.plan[0].name === "seven_day" && s.plan[0].utilization === 11, s.plan);
  check("fixture: turn counted", s.cost.turns === 1 && s.cost.session === 0);
  check("fixture: follow-the-page saw the write", s.lastWrite?.file === "/Users/me/site/probe.txt");
}

// 2. Streaming: deltas accumulate, the completed item's text wins.
{
  const s = session();
  applyCodexMessage(s, { method: "turn/started", params: {} });
  applyCodexMessage(s, { method: "item/started", params: { item: { type: "agentMessage", id: "m1", text: "" } } });
  applyCodexMessage(s, { method: "item/agentMessage/delta", params: { itemId: "m1", delta: "Hel" } });
  applyCodexMessage(s, { method: "item/agentMessage/delta", params: { itemId: "m1", delta: "lo" } });
  const a = s.items[0];
  check("stream: text accumulates while streaming", a.kind === "assistant" && a.text === "Hello" && a.streaming && s.busy, a);
  applyCodexMessage(s, { method: "item/completed", params: { item: { type: "agentMessage", id: "m1", text: "Hello, world." } } });
  check("stream: completed text replaces the deltas", s.items.length === 1 && s.items[0].kind === "assistant" && s.items[0].text === "Hello, world." && !s.items[0].streaming, s.items);
}

// 3. Interrupt shows as Stopped; a failed turn gets plain language; a retry shows the banner.
{
  const s = session();
  addUser(s, "count forever", null);
  s.interrupting = true;
  applyCodexMessage(s, { method: "turn/completed", params: { turn: { id: "t", status: "interrupted", items: [] } } });
  const r = s.items.find((i) => i.kind === "result");
  check("interrupt: Stopped, not an error", r?.kind === "result" && r.stopped && !r.isError && r.text === "Stopped" && !s.busy && !s.interrupting, r);
  const f = session();
  applyCodexMessage(f, { method: "error", params: { error: { message: "stream disconnected" }, willRetry: true } });
  check("retry: banner while the CLI retries", f.retry?.attempt === 1 && f.retry.reason === "stream disconnected" && f.busy, f.retry);
  applyCodexMessage(f, { method: "turn/completed", params: { turn: { id: "t", status: "failed", items: [], error: { message: "The 'gpt-6-astra' model requires a newer version of Codex." } } } });
  const fr = f.items.find((i) => i.kind === "result");
  check("failure: error result in plain words, retry cleared", fr?.kind === "result" && fr.isError && fr.text.length > 0 && f.retry === null && !f.busy, fr);
}

// 4. A queued message: the turn ends, the queued row loses its tag and the session stays busy.
{
  const s = session();
  applyCodexMessage(s, { method: "turn/started", params: {} });
  addUser(s, "and then make it blue", null);
  check("queue: tagged while busy", s.items[0].kind === "user" && s.items[0].queued === true);
  applyCodexMessage(s, { method: "turn/completed", params: { turn: { id: "t", status: "completed", items: [] } } });
  check("queue: untagged and still busy after the turn", s.items[0].kind === "user" && s.items[0].queued === false && s.busy, s.items);
  // and Codex echoing it as a userMessage does not duplicate the row
  applyCodexMessage(s, { method: "item/started", params: { item: { type: "userMessage", id: "u9", content: [{ type: "text", text: "and then make it blue" }] } } });
  check("queue: the echoed user message is not duplicated", s.items.filter((i) => i.kind === "user").length === 1, s.items);
}

// 5. Approval cards: an answer settles them; serverRequest/resolved expires only what is still pending.
{
  const s = session();
  addPermission(s, { sessionId: "codex:t", requestId: "7", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm -rf build" } } });
  addPermission(s, { sessionId: "codex:t", requestId: "8", request: { subtype: "can_use_tool", tool_name: "Edit", input: { file_path: "/Users/me/site/a.ts" } } });
  settlePermission(s, "7", "allowed");
  applyCodexMessage(s, { method: "serverRequest/resolved", params: { requestId: 7 } });
  applyCodexMessage(s, { method: "serverRequest/resolved", params: { requestId: 8 } });
  const st = s.items.map((i) => (i.kind === "permission" ? i.status : "?"));
  check("permissions: allowed stays allowed, unanswered becomes expired", st.join() === "allowed,expired", st);
}

// 6. File changes: update, delete and move map onto Claude's tool names so Undo needs no branch.
{
  const s = session();
  applyCodexMessage(s, { method: "item/started", params: { item: { type: "fileChange", id: "fc1", status: "inProgress", changes: [
    { path: "/site/a.ts", kind: { type: "update", move_path: null }, diff: "-a\n+b" },
    { path: "/site/old.css", kind: { type: "delete" }, diff: "" },
    { path: "/site/x.ts", kind: { type: "update", move_path: "/site/y.ts" }, diff: "" },
  ] } } });
  const rows = s.items.filter((i) => i.kind === "tool");
  check("fileChange: four rows for three changes (the move fans out)", rows.length === 4, rows.map((r) => r.kind === "tool" && r.label));
  check("fileChange: labels", rows.map((r) => r.kind === "tool" && r.label).join("|") === "Editing site/a.ts|Deleting site/old.css|Moving site/x.ts → site/y.ts|Writing site/y.ts", rows.map((r) => r.kind === "tool" && r.label));
  check("fileChange: only the moved-to file counts as created", rows.filter((r) => r.kind === "tool" && r.created).map((r) => r.kind === "tool" && r.input.file_path).join() === "/site/y.ts");
  applyCodexMessage(s, { method: "item/completed", params: { item: { type: "fileChange", id: "fc1", status: "declined", changes: [] } } });
  check("fileChange: declined marks every row as error", rows.length === 4 && s.items.every((i) => i.kind !== "tool" || i.status === "error"), s.items);
}

// 7. Unknown item types still show as a row; helpers.
{
  const s = session();
  applyCodexMessage(s, { method: "item/started", params: { item: { type: "somethingNew", id: "z1", foo: 1 } } });
  applyCodexMessage(s, { method: "item/completed", params: { item: { type: "somethingNew", id: "z1", status: "completed" } } });
  check("unknown item: a generic done row", s.items.length === 1 && s.items[0].kind === "tool" && s.items[0].name === "somethingNew" && s.items[0].status === "done", s.items);
  check("windowName", [windowName(300), windowName(10080), windowName(60), windowName(null)].join() === "five_hour,seven_day,1h,window");
  check("parseCodexRateLimits: both windows", parseCodexRateLimits({ rateLimits: { primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: 1 }, secondary: { usedPercent: 11, windowDurationMins: 10080, resetsAt: 2 } } }).map((w) => `${w.name}=${w.utilization}`).join() === "five_hour=3,seven_day=11");
  check("backendOf", backendOf("codex:abc") === "codex" && backendOf("abc") === "claude" && backendOf(null) === "claude");
  check("model/rerouted: notice and new model", (() => { const r = session(); applyCodexMessage(r, { method: "model/rerouted", params: { fromModel: "a", toModel: "b", reason: "capacity" } }); return r.model === "b" && r.items[0].kind === "notice"; })());
}

if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("codex reducer: ok");
