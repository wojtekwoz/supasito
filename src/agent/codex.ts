// Turns Codex app-server notifications (JSON-RPC over stdio, codex-cli 0.149.0) into the same transcript
// items Claude's stream-json produces, so every row, Undo and the usage ring work unchanged.
// Recorded shapes: src/agent/fixtures/codex-0.149.0-write-turn.jsonl (scripts/codex-probe.mjs re-records it).
import { basename, contextWindowFor, expirePermissions, filesTouchedInTurn, friendlyError, patch, uid, type Item, type PlanWindow, type SessionState } from "./transcript.ts";

type Tool = Extract<Item, { kind: "tool" }>;
type Assistant = Extract<Item, { kind: "assistant" }>;

function findAssistant(items: Item[], id: string): Assistant | null {
  for (let k = items.length - 1; k >= 0; k--) { const it = items[k]; if (it.kind === "assistant" && it.id === id) return it; }
  return null;
}
/** Tool rows made from one Codex item; a fileChange fans out into one row per file (`<itemId>:<n>`). */
function toolsFor(items: Item[], itemId: string): Tool[] {
  const out: Tool[] = [];
  for (const it of items) if (it.kind === "tool" && (it.id === itemId || it.id.startsWith(itemId + ":"))) out.push(it);
  return out;
}

/** `windowDurationMins` → the names Claude's plan windows use, so the usage popover reads the same for both. */
export function windowName(mins: number | null | undefined): string {
  if (mins === 300) return "five_hour";
  if (mins === 10080) return "seven_day";
  if (!mins) return "window";
  return mins % 1440 === 0 ? `${mins / 1440}d` : mins % 60 === 0 ? `${mins / 60}h` : `${mins}m`;
}

/** `account/rateLimits/updated` (recorded 0.149.0): rateLimits.{primary,secondary}.{usedPercent,windowDurationMins,resetsAt}. */
export function parseCodexRateLimits(params: any): PlanWindow[] {
  const rl = params?.rateLimits;
  if (!rl || typeof rl !== "object") return [];
  const out: PlanWindow[] = [];
  for (const w of [rl.primary, rl.secondary]) {
    if (!w || typeof w.usedPercent !== "number") continue;
    // usedPercent is 0–100; the plan rows and the ring expect Claude's 0–1 utilization.
    out.push({ name: windowName(w.windowDurationMins), utilization: w.usedPercent / 100, resetsAt: typeof w.resetsAt === "number" ? w.resetsAt : null });
  }
  return out;
}

const kindLabel = (kind: any, path: string) => {
  const t = kind?.type;
  if (t === "add") return `Writing ${basename(path)}`;
  if (t === "delete") return `Deleting ${basename(path)}`;
  if (typeof kind?.move_path === "string" && kind.move_path) return `Moving ${basename(path)} → ${basename(kind.move_path)}`;
  return `Editing ${basename(path)}`;
};

/** One tool row per changed file. `name` follows Claude's tools so `filesTouchedInTurn` and Undo need no branch:
 *  `Write` + created for a new file, `Edit` for an update or a delete (git restores both the same way). A move
 *  becomes an Edit of the old path plus a created Write of the new one, so Undo restores one and deletes the other. */
function fileChangeRows(item: any): Tool[] {
  const rows: Tool[] = [];
  const changes: any[] = Array.isArray(item.changes) ? item.changes : [];
  changes.forEach((c, n) => {
    const path = typeof c?.path === "string" ? c.path : "";
    const kind = c?.kind ?? {};
    const created = kind.type === "add";
    const base = { kind: "tool" as const, result: null, status: "running" as const, parentToolUseId: null };
    rows.push({ ...base, id: `${item.id}:${n}`, name: created ? "Write" : "Edit", input: { file_path: path, diff: c?.diff ?? "", change: kind.type ?? "update", itemId: item.id }, label: kindLabel(kind, path), created });
    if (typeof kind.move_path === "string" && kind.move_path) {
      rows.push({ ...base, id: `${item.id}:${n}:moved`, name: "Write", input: { file_path: kind.move_path, diff: c?.diff ?? "", change: "add", itemId: item.id }, label: `Writing ${basename(kind.move_path)}`, created: true });
    }
  });
  return rows;
}

function toolRow(item: any): Tool | null {
  const base = { kind: "tool" as const, id: String(item.id), result: null, status: "running" as const, parentToolUseId: null };
  switch (item.type) {
    case "commandExecution": return { ...base, name: "Bash", input: { command: item.command, cwd: item.cwd, itemId: item.id }, label: `Running ${String(item.command || "").replace(/^\/bin\/z?sh -lc '?/, "").replace(/'$/, "").split("\n")[0].slice(0, 80)}` };
    case "mcpToolCall": return { ...base, name: `${item.server}/${item.tool}`, input: item.arguments ?? {}, label: `Using ${item.tool} (${item.server})` };
    case "webSearch": return { ...base, name: "WebSearch", input: { query: item.query }, label: `Searching the web for “${item.query}”` };
    case "imageView": return { ...base, name: "Read", input: { file_path: item.path }, label: `Looking at ${basename(item.path)}` };
    case "dynamicToolCall": return { ...base, name: String(item.tool ?? "tool"), input: item.arguments ?? {}, label: `Using ${item.tool}` };
    case "subAgentActivity": return { ...base, name: "Agent", input: { agent: item.agentPath, kind: item.kind }, label: `Delegating: ${item.agentPath}` };
    case "collabAgentToolCall": return { ...base, name: "Agent", input: { prompt: item.prompt }, label: "Delegating to another agent" };
    case "sleep": return { ...base, name: "sleep", input: {}, label: "Waiting" };
    case "imageGeneration": return { ...base, name: "imageGeneration", input: {}, label: "Generating an image" };
    case "enteredReviewMode": return { ...base, name: "review", input: {}, label: "Reviewing" };
    case "userMessage": case "agentMessage": case "reasoning": case "plan": case "fileChange": case "contextCompaction": case "exitedReviewMode": case "hookPrompt": return null;
    // A type this version of Supasito has never seen still shows as a row, never vanishes: app-server is experimental.
    default: return { ...base, name: String(item.type ?? "item"), input: item, label: String(item.type ?? "item") };
  }
}

const toolStatus = (s: unknown): Tool["status"] => (s === "failed" || s === "declined" ? "error" : "done");

function toolResult(item: any): string | null {
  switch (item.type) {
    case "commandExecution": { const out = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : ""; return item.status === "declined" ? "Declined" : item.exitCode != null && item.exitCode !== 0 ? `${out}\n(exit ${item.exitCode})`.trim() : out; }
    case "mcpToolCall": return item.error?.message ?? (item.result != null ? JSON.stringify(item.result).slice(0, 4000) : "");
    case "webSearch": return Array.isArray(item.results) ? `${item.results.length} results` : "";
    default: return "";
  }
}

function userTextOf(item: any): { text: string; selectionSummary: string | null; images: { mediaType: string; data: string }[] } {
  const content: any[] = Array.isArray(item.content) ? item.content : [];
  const texts = content.filter((c) => c?.type === "text").map((c) => String(c.text));
  const sel = texts.find((t) => t.startsWith("Selected element"));
  const images = content.filter((c) => c?.type === "image" && typeof c.url === "string" && c.url.startsWith("data:")).map((c) => { const m = /^data:([^;]+);base64,(.*)$/.exec(c.url); return { mediaType: m?.[1] ?? "image/png", data: m?.[2] ?? "" }; });
  return { text: texts.filter((t) => t !== sel).join("\n"), selectionSummary: sel ?? null, images };
}

/** Mutates `state` in place with one app-server line (a notification, or Supasito's own `supasito/session`). Returns true if something changed. */
export function applyCodexMessage(state: SessionState, msg: any): boolean {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") return false;
  state.backend = "codex";
  const items = state.items;
  const p = msg.params ?? {};
  switch (msg.method) {
    case "supasito/session": {
      // Emitted by codex.rs after thread/start or thread/resume: the model and mode Supasito asked for
      // (the Thread object itself carries neither; verified 0.149.0).
      if (typeof p.model === "string") state.model = p.model;
      if (typeof p.mode === "string") state.mode = p.mode;
      if (Array.isArray(p.commands)) state.commands = p.commands.filter((c: unknown) => typeof c === "string").sort();
      return true;
    }
    case "turn/started": {
      state.busy = true;
      state.retry = null;
      return true;
    }
    case "item/started": {
      const item = p.item ?? {};
      state.retry = null;
      state.busy = true;
      switch (item.type) {
        case "userMessage": {
          const { text, selectionSummary, images } = userTextOf(item);
          if (!text.trim() && !selectionSummary && images.length === 0) return false;
          // Codex echoes every user message as an item. The row already exists when we sent it from here (added
          // locally, possibly queued behind a turn and since untagged), so the most recent user row with the same text is it.
          for (let k = items.length - 1; k >= 0; k--) {
            const it = items[k];
            if (it.kind !== "user") continue;
            if (it.text !== text) break;
            if (it.queued) { items[k] = { ...it, queued: false }; return true; }
            return false;
          }
          items.push({ kind: "user", id: String(item.id), text, selectionSummary, images });
          return true;
        }
        case "reasoning": {
          items.push({ kind: "assistant", id: String(item.id), text: "", thinking: "", streaming: true, parentToolUseId: null, model: state.model, phase: "thinking" });
          return true;
        }
        case "agentMessage": {
          // Reasoning arrives as its own item just before the message; fold the two into one bubble like Claude's.
          const last = items[items.length - 1];
          if (last && last.kind === "assistant" && last.text === "" && last.phase === "thinking") { items[items.length - 1] = { ...last, id: String(item.id), streaming: true, phase: "text", text: String(item.text ?? "") }; return true; }
          items.push({ kind: "assistant", id: String(item.id), text: String(item.text ?? ""), thinking: "", streaming: true, parentToolUseId: null, model: state.model, phase: "text" });
          return true;
        }
        case "plan": {
          items.push({ kind: "assistant", id: String(item.id), text: String(item.text ?? ""), thinking: "", streaming: true, parentToolUseId: null, model: state.model, phase: "text" });
          return true;
        }
        case "fileChange": {
          for (const row of fileChangeRows(item)) {
            items.push(row);
            state.lastWrite = { file: row.input.file_path, seq: (state.lastWrite?.seq ?? 0) + 1 };
          }
          return true;
        }
        case "contextCompaction": return false; // handled on completion
        default: {
          const row = toolRow(item);
          if (!row) return false;
          items.push(row);
          return true;
        }
      }
    }
    case "item/completed": {
      const item = p.item ?? {};
      switch (item.type) {
        case "userMessage": return false;
        case "reasoning": {
          const summary = Array.isArray(item.summary) ? item.summary.join("\n") : "";
          const raw = Array.isArray(item.content) ? item.content.join("\n") : "";
          const ex = findAssistant(items, String(item.id));
          if (!ex) return false;
          // Reasoning with no summary and no text yet (the model went straight to a tool) is an empty bubble: drop it.
          if (!summary && !raw && !ex.thinking && !ex.text) { items.splice(items.indexOf(ex), 1); return true; }
          return patch(items, (i) => i === ex, "assistant", { thinking: summary || raw || ex.thinking, streaming: false });
        }
        case "agentMessage": case "plan": {
          const ex = findAssistant(items, String(item.id));
          if (ex) return patch(items, (i) => i === ex, "assistant", { text: String(item.text ?? ex.text), streaming: false, phase: "text" });
          items.push({ kind: "assistant", id: String(item.id), text: String(item.text ?? ""), thinking: "", streaming: false, parentToolUseId: null, model: state.model, phase: "text" });
          return true;
        }
        case "fileChange": {
          const rows = toolsFor(items, String(item.id));
          if (rows.length === 0) { for (const row of fileChangeRows(item)) items.push({ ...row, status: toolStatus(item.status), result: item.status === "declined" ? "Declined" : "" }); return true; }
          for (const r of rows) patch(items, (i) => i === r, "tool", { status: toolStatus(item.status), result: item.status === "declined" ? "Declined" : item.status === "failed" ? "Failed" : "" });
          return true;
        }
        case "contextCompaction": {
          state.context = state.context ? { ...state.context, used: 0 } : null;
          items.push({ kind: "notice", id: String(item.id), text: "Codex summarised the older part of this conversation to make room. Nothing on the site changed.", tone: "info" });
          return true;
        }
        default: {
          const ex = toolsFor(items, String(item.id))[0];
          const result = toolResult(item);
          if (ex) return patch(items, (i) => i === ex, "tool", { status: toolStatus(item.status), result: result ?? ex.result });
          const row = toolRow(item);
          if (!row) return false;
          items.push({ ...row, status: toolStatus(item.status), result });
          return true;
        }
      }
    }
    case "item/agentMessage/delta": case "item/plan/delta": {
      const ex = findAssistant(items, String(p.itemId));
      if (!ex) return false;
      state.busy = true;
      return patch(items, (i) => i === ex, "assistant", { text: ex.text + String(p.delta ?? ""), streaming: true, phase: "text" });
    }
    case "item/reasoning/summaryTextDelta": case "item/reasoning/textDelta": {
      const ex = findAssistant(items, String(p.itemId));
      if (!ex) return false;
      const sep = msg.method.endsWith("summaryTextDelta") && ex.thinking && !ex.thinking.endsWith("\n") && String(p.delta ?? "").startsWith("**") ? "\n" : "";
      return patch(items, (i) => i === ex, "assistant", { thinking: ex.thinking + sep + String(p.delta ?? ""), phase: "thinking" });
    }
    case "item/reasoning/summaryPartAdded": {
      const ex = findAssistant(items, String(p.itemId));
      if (!ex || !ex.thinking || ex.thinking.endsWith("\n")) return false;
      return patch(items, (i) => i === ex, "assistant", { thinking: ex.thinking + "\n" });
    }
    case "item/commandExecution/outputDelta": {
      const ex = toolsFor(items, String(p.itemId))[0];
      if (!ex) return false;
      return patch(items, (i) => i === ex, "tool", { result: (ex.result ?? "") + String(p.delta ?? "") });
    }
    case "error": {
      // {"error":{"message":…},"willRetry":true} while the CLI retries; a final failure is reported on turn/completed.
      if (p.willRetry === true) { state.retry = { attempt: (state.retry?.attempt ?? 0) + 1, max: state.retry?.max ?? 10, delayMs: 0, reason: String(p.error?.message ?? "unknown") }; state.busy = true; return true; }
      return false;
    }
    case "thread/tokenUsage/updated": {
      // last.inputTokens already includes cachedInputTokens (recorded: 19701 with 19200 cached), so it is the prompt size.
      const last = p.tokenUsage?.last;
      const used = Number(last?.inputTokens) || 0;
      if (used <= 0) return false;
      const window = Number(p.tokenUsage?.modelContextWindow) || state.context?.window || contextWindowFor(state.model);
      if (state.context && state.context.used === used && state.context.window === window) return false;
      state.context = { used, window };
      return true;
    }
    case "account/rateLimits/updated": {
      const windows = parseCodexRateLimits(p);
      let changed = false;
      if (p.rateLimits?.rateLimitReachedType) {
        const text = "Your ChatGPT plan limit is reached for now. Supasito will keep the session; send again after the reset.";
        const last = items[items.length - 1];
        if (!(last?.kind === "notice" && last.text === text)) { items.push({ kind: "notice", id: uid("n"), text, tone: "error" }); changed = true; }
      }
      if (windows.length === 0) return changed;
      state.plan = windows;
      let best: SessionState["usage"] = null;
      for (const w of windows) if (!best || w.utilization > best.utilization) best = { utilization: w.utilization, resetsAt: w.resetsAt, window: w.name };
      state.usage = best;
      return true;
    }
    case "model/rerouted": {
      items.push({ kind: "notice", id: uid("n"), text: `Codex switched this turn from ${p.fromModel} to ${p.toModel} (${typeof p.reason === "string" ? p.reason : "provider's choice"}).`, tone: "info" });
      if (typeof p.toModel === "string") state.model = p.toModel;
      return true;
    }
    case "serverRequest/resolved": {
      // Answered elsewhere (or by Codex's own review): a card nobody needs to click any more.
      return patch(items, (it) => it.kind === "permission" && it.id === String(p.requestId) && it.status === "pending", "permission", { status: "expired" });
    }
    case "turn/completed": {
      state.retry = null;
      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        if (it.kind === "assistant" && it.streaming) items[k] = { ...it, streaming: false };
        if (it.kind === "tool" && it.status === "running") items[k] = { ...it, status: "done" };
      }
      const turn = p.turn ?? {};
      const status = String(turn.status ?? "completed");
      const failed = status === "failed";
      const stopped = status === "interrupted" || (failed && state.interrupting);
      state.interrupting = false;
      const raw = typeof turn.error?.message === "string" ? turn.error.message : "";
      const text = stopped ? "Stopped" : failed ? friendlyError(raw, "error_during_execution") : "";
      const touched = filesTouchedInTurn(items);
      const q = items.findIndex((it) => it.kind === "user" && it.queued);
      if (q >= 0) { items[q] = { ...(items[q] as Extract<Item, { kind: "user" }>), queued: false }; state.busy = true; }
      expirePermissions(state);
      if (!failed && !stopped) state.cost = { ...state.cost, turns: state.cost.turns + 1 };
      // No dollars anywhere in the app-server protocol: costUsd stays null and the row shows nothing, not $0.
      items.push({ kind: "result", id: uid("r"), isError: failed && !stopped, stopped, text, costUsd: null, durationMs: typeof turn.durationMs === "number" ? turn.durationMs : null, numTurns: null, files: touched.files, created: touched.created, undone: false, at: Date.now(), models: state.model ? [state.model] : [], speed: null });
      if (q >= 0) return true;
      state.busy = false;
      return true;
    }
    // Housekeeping the transcript has no row for. codex.rs mirrors warnings to agent://stderr for the debug pane.
    case "thread/started": case "thread/status/changed": case "thread/closed": case "turn/diff/updated": case "turn/plan/updated":
    case "warning": case "configWarning": case "deprecationNotice": case "guardianWarning":
    case "mcpServer/startupStatus/updated": case "hook/started": case "hook/completed": case "remoteControl/status/changed":
    case "item/fileChange/outputDelta": case "item/fileChange/patchUpdated": case "item/mcpToolCall/progress":
    case "thread/compacted": case "account/updated": case "thread/settings/updated": case "thread/name/updated":
      return false;
    default:
      return false;
  }
}
