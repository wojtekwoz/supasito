// Turns Claude Code's stream-json messages into transcript items the UI can render.
import type { Attachment, PermissionRequest, Selection } from "../types";

export type ToolStatus = "running" | "done" | "error";

export type Item =
  | { kind: "user"; id: string; text: string; selection?: Selection | null; selectionSummary?: string | null; images?: { mediaType: string; data: string }[]; queued?: boolean }
  | { kind: "assistant"; id: string; text: string; thinking: string; streaming: boolean; parentToolUseId: string | null }
  | { kind: "tool"; id: string; name: string; input: any; label: string; result: string | null; status: ToolStatus; parentToolUseId: string | null }
  | { kind: "permission"; id: string; request: PermissionRequest["request"]; status: "pending" | "allowed" | "denied" }
  | { kind: "result"; id: string; isError: boolean; stopped: boolean; text: string; costUsd: number | null; durationMs: number | null; numTurns: number | null; files: string[]; undone: boolean }
  | { kind: "notice"; id: string; text: string; tone: "info" | "error" };

export type SessionState = {
  items: Item[];
  busy: boolean;
  model: string | null;
  loaded: boolean;
  stderr: string[];
  /** Set when the user pressed Stop; the next error result is shown as "Stopped". */
  interrupting: boolean;
  /** Most recent file written by an Edit/Write tool call, for the preview to follow. */
  lastWrite: { file: string; seq: number } | null;
  /** Highest utilisation reported by the CLI's rate_limit_event, when it reports one. */
  usage: { utilization: number; resetsAt: number | null; window: string } | null;
};

export const emptySession = (): SessionState => ({ items: [], busy: false, model: null, loaded: false, stderr: [], interrupting: false, lastWrite: null, usage: null });

const RESULT_ERRORS: Record<string, string> = {
  error_max_turns: "Stopped: the turn limit was reached.",
  error_max_budget_usd: "Stopped: the spending limit was reached.",
  error_during_execution: "The turn stopped with an error.",
  error_max_structured_output_retries: "The turn stopped with an error.",
};

let counter = 0;
export const uid = (p = "i") => `${p}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

const basename = (p: string) => (p || "").split("/").filter(Boolean).slice(-2).join("/");

export function toolLabel(name: string, input: any): string {
  const i = input || {};
  switch (name) {
    case "Read": return `Reading ${basename(i.file_path)}`;
    case "Edit": case "MultiEdit": return `Editing ${basename(i.file_path)}`;
    case "Write": return `Writing ${basename(i.file_path)}`;
    case "NotebookEdit": return `Editing ${basename(i.notebook_path)}`;
    case "Bash": return i.description ? `Running: ${i.description}` : `Running ${String(i.command || "").split("\n")[0].slice(0, 80)}`;
    case "Grep": return `Searching for “${i.pattern}”`;
    case "Glob": return `Finding ${i.pattern}`;
    case "LS": return `Listing ${basename(i.path)}`;
    case "WebFetch": { try { return `Fetching ${new URL(i.url).host}`; } catch { return "Fetching a page"; } }
    case "WebSearch": return `Searching the web for “${i.query}”`;
    case "Task": case "Agent": return `Delegating: ${i.description || "a subtask"}`;
    case "TodoWrite": case "TaskCreate": case "TaskUpdate": return "Planning";
    case "AskUserQuestion": return "Asking you a question";
    case "Skill": return `Using skill ${i.skill || ""}`.trim();
    case "ToolSearch": return "Loading tools";
    default: return name;
  }
}

function contentText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((b) => b?.type === "text").map((b) => b.text).join("\n");
  return "";
}

function splitUserContent(content: any): { text: string; selectionSummary: string | null; images: { mediaType: string; data: string }[] } {
  if (typeof content === "string") return { text: content, selectionSummary: null, images: [] };
  if (!Array.isArray(content)) return { text: "", selectionSummary: null, images: [] };
  const texts = content.filter((b) => b?.type === "text").map((b) => String(b.text));
  const sel = texts.find((t) => t.startsWith("Selected element"));
  const images = content.filter((b) => b?.type === "image" && b.source?.type === "base64" && b.source.data).map((b) => ({ mediaType: String(b.source.media_type || "image/png"), data: String(b.source.data) }));
  return { text: texts.filter((t) => t !== sel).join("\n"), selectionSummary: sel ?? null, images };
}

function findTool(items: Item[], id: string) {
  for (let k = items.length - 1; k >= 0; k--) { const it = items[k]; if (it.kind === "tool" && it.id === id) return it; }
  return null;
}
function findAssistant(items: Item[], id: string) {
  for (let k = items.length - 1; k >= 0; k--) { const it = items[k]; if (it.kind === "assistant" && it.id === id) return it; }
  return null;
}

/** Mutates `state` in place with one stream-json message. Returns true if something changed. */
export function applyMessage(state: SessionState, msg: any): boolean {
  if (!msg || typeof msg !== "object") return false;
  const items = state.items;
  const parent: string | null = msg.parent_tool_use_id ?? null;
  switch (msg.type) {
    case "system": {
      if (msg.subtype === "init") { state.model = msg.model ?? state.model; return true; }
      return false;
    }
    case "stream_event": {
      const ev = msg.event || {};
      if (parent) return false; // subagent tokens are not shown live
      if (ev.type === "message_start") {
        const id = ev.message?.id || uid("m");
        if (!findAssistant(items, id)) items.push({ kind: "assistant", id, text: "", thinking: "", streaming: true, parentToolUseId: parent });
        state.busy = true;
        for (const it of items) if (it.kind === "user" && it.queued) { it.queued = false; break; }
        return true;
      }
      if (ev.type === "content_block_delta") {
        const last = [...items].reverse().find((i) => i.kind === "assistant" && i.streaming) as Extract<Item, { kind: "assistant" }> | undefined;
        if (!last) return false;
        if (ev.delta?.type === "text_delta") { last.text += ev.delta.text ?? ""; return true; }
        if (ev.delta?.type === "thinking_delta") { last.thinking += ev.delta.thinking ?? ""; return true; }
        return false;
      }
      if (ev.type === "message_stop") {
        const last = [...items].reverse().find((i) => i.kind === "assistant" && i.streaming) as Extract<Item, { kind: "assistant" }> | undefined;
        if (last) { last.streaming = false; return true; }
        return false;
      }
      return false;
    }
    case "assistant": {
      const m = msg.message || {};
      const id: string = m.id || uid("m");
      let changed = false;
      const blocks: any[] = Array.isArray(m.content) ? m.content : [];
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const thinking = blocks.filter((b) => b.type === "thinking").map((b) => b.thinking).join("\n");
      if (text || thinking) {
        if (parent) {
          // subagent text: keep it out of the main thread
        } else {
          const existing = findAssistant(items, id);
          if (existing) { existing.text = text || existing.text; existing.thinking = thinking || existing.thinking; existing.streaming = false; }
          else items.push({ kind: "assistant", id, text, thinking, streaming: false, parentToolUseId: parent });
          changed = true;
        }
      }
      for (const b of blocks) {
        if (b.type !== "tool_use") continue;
        if (findTool(items, b.id)) continue;
        items.push({ kind: "tool", id: b.id, name: b.name, input: b.input, label: toolLabel(b.name, b.input), result: null, status: "running", parentToolUseId: parent });
        if (["Edit", "MultiEdit", "Write"].includes(b.name) && typeof b.input?.file_path === "string") {
          state.lastWrite = { file: b.input.file_path, seq: (state.lastWrite?.seq ?? 0) + 1 };
        }
        changed = true;
      }
      if (m.stop_reason === "end_turn" && !blocks.some((b) => b.type === "tool_use")) {
        // turn text is complete; result will follow
      }
      state.busy = true;
      return changed;
    }
    case "user": {
      const m = msg.message || {};
      const content = m.content;
      const results = Array.isArray(content) ? content.filter((b: any) => b?.type === "tool_result") : [];
      if (results.length) {
        let changed = false;
        for (const r of results) {
          const t = findTool(items, r.tool_use_id);
          if (!t) continue;
          t.result = contentText(r.content);
          t.status = r.is_error ? "error" : "done";
          changed = true;
        }
        return changed;
      }
      if (parent) return false;
      if (msg.isMeta) return false;
      const { text, selectionSummary, images } = splitUserContent(content);
      if (!text.trim() && !selectionSummary && images.length === 0) return false;
      // avoid duplicating a message we already added locally (replayed input)
      const last = items[items.length - 1];
      if (last && last.kind === "user" && last.text === text) return false;
      items.push({ kind: "user", id: msg.uuid || uid("u"), text, selectionSummary, images });
      return true;
    }
    case "rate_limit_event": {
      const windows = msg.rate_limit_info?.unifiedWindows;
      if (!windows || typeof windows !== "object") return false;
      let best: { utilization: number; resetsAt: number | null; window: string } | null = null;
      for (const [name, w] of Object.entries<any>(windows)) {
        const u = typeof w?.utilization === "number" ? w.utilization : null;
        if (u == null) continue;
        if (!best || u > best.utilization) best = { utilization: u, resetsAt: typeof w.resetsAt === "number" ? w.resetsAt : null, window: name };
      }
      if (!best) return false;
      state.usage = best;
      return true;
    }
    case "result": {
      for (const it of items) if (it.kind === "assistant") it.streaming = false;
      for (const it of items) if (it.kind === "tool" && it.status === "running") it.status = "done";
      state.busy = false;
      const subtype = typeof msg.subtype === "string" ? msg.subtype : "success";
      const failed = !!msg.is_error || subtype !== "success";
      const stopped = failed && state.interrupting;
      state.interrupting = false;
      const text = stopped ? "Stopped" : failed ? (typeof msg.result === "string" && msg.result ? msg.result : RESULT_ERRORS[subtype] ?? "The turn ended with an error.") : "";
      items.push({ kind: "result", id: uid("r"), isError: failed && !stopped, stopped, text, costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : null, durationMs: typeof msg.duration_ms === "number" ? msg.duration_ms : null, numTurns: typeof msg.num_turns === "number" ? msg.num_turns : null, files: filesTouchedInTurn(items), undone: false });
      return true;
    }
    default:
      return false;
  }
}

/** Files written by Edit/Write tools since the last user message (the turn that just ended). */
export function filesTouchedInTurn(items: Item[]): string[] {
  const files: string[] = [];
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    if (it.kind === "user") break;
    if (it.kind !== "tool" || it.status === "error") continue;
    const f = ["Edit", "MultiEdit", "Write"].includes(it.name) ? it.input?.file_path : it.name === "NotebookEdit" ? it.input?.notebook_path : null;
    if (typeof f === "string" && f && !files.includes(f)) files.unshift(f);
  }
  return files;
}

export function addPermission(state: SessionState, req: PermissionRequest) {
  state.items.push({ kind: "permission", id: req.requestId, request: req.request, status: "pending" });
  state.busy = true;
}

export function settlePermission(state: SessionState, requestId: string, status: "allowed" | "denied") {
  for (const it of state.items) if (it.kind === "permission" && it.id === requestId) it.status = status;
}

export function addUser(state: SessionState, text: string, selection: Selection | null, images: Attachment[] = []) {
  const queued = state.busy;
  state.items.push({ kind: "user", id: uid("u"), text, selection, selectionSummary: null, images: images.map((i) => ({ mediaType: i.mediaType, data: i.data })), queued });
  state.busy = true;
}

export function addNotice(state: SessionState, text: string, tone: "info" | "error" = "info") {
  state.items.push({ kind: "notice", id: uid("n"), text, tone });
}
