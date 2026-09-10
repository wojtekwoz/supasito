// Turns Claude Code's stream-json messages into transcript items the UI can render.
import type { Attachment, PermissionRequest, Selection, SessionOverrides } from "../types";

export type ToolStatus = "running" | "done" | "error";

export type Item =
  | { kind: "user"; id: string; text: string; selection?: Selection | null; selectionSummary?: string | null; images?: { mediaType: string; data: string }[]; queued?: boolean }
  /** `model` is the exact id the API answered with; `phase` says what is streaming right now (thinking summaries arrive before the text). */
  | { kind: "assistant"; id: string; text: string; thinking: string; streaming: boolean; parentToolUseId: string | null; model?: string | null; phase?: "thinking" | "text" }
  | { kind: "tool"; id: string; name: string; input: any; label: string; result: string | null; status: ToolStatus; parentToolUseId: string | null; created?: boolean }
  | { kind: "permission"; id: string; request: PermissionRequest["request"]; status: "pending" | "allowed" | "denied" | "expired" }
  /** `models`: the ids in the result's modelUsage (several when subagents ran); `speed`: the API's `usage.speed`, "fast" when the last request ran in fast mode. */
  | { kind: "result"; id: string; isError: boolean; stopped: boolean; text: string; costUsd: number | null; durationMs: number | null; numTurns: number | null; files: string[]; created: string[]; undone: boolean; at: number; models: string[]; speed: string | null }
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
  /** Slash commands and skills the CLI reported at init, for composer autocomplete. */
  commands: string[];
  /** Permission mode the session runs with (acceptEdits, bypassPermissions, plan, default). */
  mode: string | null;
  /** The CLI is retrying a failed API call (offline, overloaded, rate limited); cleared when the turn moves on. */
  retry: { attempt: number; max: number; delayMs: number; reason: string } | null;
  /** Every plan window from the last rate_limit_event (five_hour, seven_day, …), for the usage popover. */
  plan: PlanWindow[];
  /** How full Claude's context is: tokens in the prompt of its last API call against the model's window. */
  context: { used: number; window: number } | null;
  /** USD. `session` sums the turns seen since this session was opened in Supasito; `process` mirrors the CLI's cumulative total_cost_usd for the running process. */
  cost: { session: number; process: number; turns: number };
  /** True when the transcript was re-rendered from Claude's store, so cost only covers this sitting. */
  resumed: boolean;
  /** Model, effort and fast mode Supasito passes when it (re)starts this session's process; unset = the Settings default. */
  overrides: SessionOverrides;
  /** Fast mode as the CLI reports it in system/init and result (`on`, `off`, `cooldown`; verified 2.1.257) with its reason when off. */
  fast: { state: string; reason: string | null } | null;
  /** Which CLI runs this session. Claude's messages go through `applyMessage`, Codex's through `applyCodexMessage` (src/agent/codex.ts). */
  backend: Backend;
};

export type Backend = "claude" | "codex";
/** Codex sessions carry the thread id behind a prefix, so every string-keyed map in the app works unchanged and the backend is known from the id alone. */
export const CODEX_PREFIX = "codex:";
export const backendOf = (sessionId: string | null | undefined): Backend => (sessionId?.startsWith(CODEX_PREFIX) ? "codex" : "claude");

export type PlanWindow = { name: string; utilization: number; resetsAt: number | null };

export const emptySession = (): SessionState => ({ items: [], busy: false, model: null, loaded: false, stderr: [], interrupting: false, lastWrite: null, usage: null, commands: [], mode: null, retry: null, plan: [], context: null, cost: { session: 0, process: 0, turns: 0 }, resumed: false, overrides: {}, fast: null, backend: "claude" });

/** The model's context window. The result's modelUsage carries the exact size; until then, 1M for "[1m]" models, else 200k. */
export function contextWindowFor(model: string | null): number {
  return model && /\[1m\]|-1m$/i.test(model) ? 1_000_000 : 200_000;
}

/** Tokens in the prompt of one API call, counted the way Claude Code's status line counts context:
 *  fresh input plus everything read from or written to the prompt cache. */
export function usageTokens(u: any): number {
  if (!u || typeof u !== "object") return 0;
  return (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0);
}

function noteContext(state: SessionState, usage: any): boolean {
  const used = usageTokens(usage);
  if (used <= 0) return false;
  const window = state.context?.window ?? contextWindowFor(state.model);
  if (state.context && state.context.used === used && state.context.window === window) return false;
  state.context = { used, window };
  return true;
}

/** `fast_mode_state` / `fast_mode_disabled_reason` sit on system/init and on the result (recorded 2.1.257: "off" + "sdk_opt_in_required" without the opt-in, "on" with `--settings '{"fastMode":true}'` on Opus). */
function noteFast(state: SessionState, msg: any): boolean {
  const s = msg?.fast_mode_state;
  if (typeof s !== "string") return false;
  const reason = typeof msg.fast_mode_disabled_reason === "string" ? msg.fast_mode_disabled_reason : null;
  if (state.fast && state.fast.state === s && state.fast.reason === reason) return false;
  state.fast = { state: s, reason };
  return true;
}

export function streamingAssistant(items: Item[]): Extract<Item, { kind: "assistant" }> | null {
  for (let k = items.length - 1; k >= 0; k--) { const it = items[k]; if (it.kind === "assistant" && it.streaming) return it; }
  return null;
}

/** The plan windows in a rate_limit_event (recorded 2.1.257): rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt}. */
export function parseRateLimit(info: any): PlanWindow[] {
  const windows = info?.unifiedWindows;
  if (!windows || typeof windows !== "object") return [];
  const out: PlanWindow[] = [];
  for (const [name, w] of Object.entries<any>(windows)) {
    if (typeof w?.utilization !== "number") continue;
    out.push({ name, utilization: w.utilization, resetsAt: typeof w.resetsAt === "number" ? w.resetsAt : null });
  }
  return out;
}

/** A new claude process starts its cumulative total_cost_usd at zero; call this when one is (re)started or exits. */
export function resetProcessCost(state: SessionState) {
  state.cost = { ...state.cost, process: 0 };
}

export const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

const RESULT_ERRORS: Record<string, string> = {
  error_max_turns: "Stopped: the turn limit was reached.",
  error_max_budget_usd: "Stopped: the spending limit was reached.",
  error_during_execution: "The turn stopped with an error.",
  error_max_structured_output_retries: "The turn stopped with an error.",
};

/** The CLI's own error texts, reworded for someone who is not at a terminal. */
export function friendlyError(raw: string, subtype: string): string {
  if (/not logged in|authentication_failed|please run \/login/i.test(raw)) return "Claude Code isn't signed in on this Mac. In Terminal, run `claude auth login`, then send your message again.";
  if (/invalid api key|authentication/i.test(raw)) return `Claude Code could not authenticate: ${raw}. Run \`claude auth login\` in Terminal, then try again.`;
  // recorded (2.1.257, API unreachable): "API Error: Connection refused — a firewall or proxy may be blocking it (ConnectionRefused)"
  if (/connection ?refused|fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|timed out|getaddrinfo|unable to connect|could not connect|network|firewall|proxy/i.test(raw)) return `Claude couldn't reach the API (${raw.replace(/^API Error:\s*/i, "")}). Check your internet connection, then send the message again.`;
  if (/rate.?limit|429|usage limit|limit reached/i.test(raw)) return `Your Claude plan limit is reached for now: ${raw}`;
  if (/overloaded|529/i.test(raw)) return "Claude's API is overloaded right now. Wait a minute, then send the message again.";
  if (/credit balance|billing/i.test(raw)) return `Claude Code reports a billing problem: ${raw}`;
  return raw || RESULT_ERRORS[subtype] || "The turn ended with an error.";
}

/** One line for the "Working…" row while the CLI retries an API call. */
export function retryText(r: NonNullable<SessionState["retry"]>): string {
  const wait = r.delayMs >= 1000 ? `${Math.round(r.delayMs / 1000)}s` : "a moment";
  const why = r.reason === "rate_limit" || r.reason === "429" ? "Claude's API is rate limiting" : r.reason === "overloaded" || r.reason === "529" ? "Claude's API is overloaded" : /^5\d\d$/.test(r.reason) ? "Claude's API returned an error" : "Can't reach Claude's API";
  return `${why}; retrying in ${wait} (${r.attempt} of ${r.max}). Esc stops the turn.`;
}

let counter = 0;
export const uid = (p = "i") => `${p}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export const basename = (p: string) => (p || "").split("/").filter(Boolean).slice(-2).join("/");

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
/** Items are never mutated in place: a changed item is replaced by a copy so memoised rows re-render only when their own item changed. */
export function patch<K extends Item["kind"]>(items: Item[], pred: (it: Item) => boolean, kind: K, changes: Partial<Extract<Item, { kind: K }>>): boolean {
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    if (it.kind === kind && pred(it)) { items[k] = { ...it, ...changes } as Item; return true; }
  }
  return false;
}

/** Mutates `state` in place with one stream-json message. Returns true if something changed. */
export function applyMessage(state: SessionState, msg: any): boolean {
  if (!msg || typeof msg !== "object") return false;
  const items = state.items;
  const parent: string | null = msg.parent_tool_use_id ?? null;
  switch (msg.type) {
    case "system": {
      if (msg.subtype === "api_retry") {
        // {"subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":528,"error_status":null,"error":"unknown"} (recorded, 2.1.257, API unreachable)
        const reason = msg.error_status != null ? String(msg.error_status) : typeof msg.error === "string" ? msg.error : "unknown";
        state.retry = { attempt: Number(msg.attempt) || 1, max: Number(msg.max_retries) || 10, delayMs: Number(msg.retry_delay_ms) || 0, reason };
        state.busy = true;
        return true;
      }
      if (msg.subtype === "compact_boundary") {
        // stream-json: compact_metadata{trigger, pre_tokens, post_tokens?}; Claude's saved JSONL: compactMetadata{preTokens, postTokens?}
        const meta = msg.compact_metadata ?? msg.compactMetadata ?? {};
        const pre = Number(meta.pre_tokens ?? meta.preTokens) || 0;
        const post = Number(meta.post_tokens ?? meta.postTokens) || 0;
        state.context = { used: post, window: state.context?.window ?? contextWindowFor(state.model) };
        items.push({ kind: "notice", id: msg.uuid || uid("n"), text: `Claude Code summarised the older part of this conversation to make room${pre ? ` (it was holding ${fmtTokens(pre)} tokens)` : ""}. Nothing on the site changed.`, tone: "info" });
        return true;
      }
      if (msg.subtype === "thinking_tokens") {
        // The CLI's own estimate while thinking streams (also sent when the text itself is withheld); it marks the row as thinking.
        const last = streamingAssistant(items);
        if (!last || last.phase === "thinking") return false;
        return patch(items, (i) => i === last, "assistant", { phase: "thinking" });
      }
      if (msg.subtype === "init") {
        state.model = msg.model ?? state.model;
        noteFast(state, msg);
        if (typeof msg.permissionMode === "string") state.mode = msg.permissionMode;
        const cmds = new Set<string>([...(Array.isArray(msg.slash_commands) ? msg.slash_commands : []), ...(Array.isArray(msg.skills) ? msg.skills : [])].filter((c) => typeof c === "string"));
        state.commands = [...cmds].sort();
        return true;
      }
      return false;
    }
    case "stream_event": {
      const ev = msg.event || {};
      state.retry = null;
      if (parent) return false; // subagent tokens are not shown live
      if (ev.type === "message_start") {
        const id = ev.message?.id || uid("m");
        if (!findAssistant(items, id)) items.push({ kind: "assistant", id, text: "", thinking: "", streaming: true, parentToolUseId: parent, model: typeof ev.message?.model === "string" ? ev.message.model : null });
        if (ev.message?.usage) noteContext(state, ev.message.usage); // the prompt size is known as soon as the call starts
        state.busy = true;
        return true;
      }
      if (ev.type === "content_block_start") {
        // thinking comes as its own block before the text (recorded 2.1.257 with showThinkingSummaries)
        const last = streamingAssistant(items);
        const kind = ev.content_block?.type;
        if (!last || (kind !== "thinking" && kind !== "text") || last.phase === kind) return false;
        return patch(items, (i) => i === last, "assistant", { phase: kind });
      }
      if (ev.type === "content_block_delta") {
        const last = streamingAssistant(items);
        if (!last) return false;
        if (ev.delta?.type === "text_delta") return patch(items, (i) => i === last, "assistant", { text: last.text + (ev.delta.text ?? ""), phase: "text" });
        if (ev.delta?.type === "thinking_delta") return patch(items, (i) => i === last, "assistant", { thinking: last.thinking + (ev.delta.thinking ?? ""), phase: "thinking" });
        return false;
      }
      if (ev.type === "message_stop") {
        const last = streamingAssistant(items);
        if (last) return patch(items, (i) => i === last, "assistant", { streaming: false });
        return false;
      }
      return false;
    }
    case "assistant": {
      state.retry = null;
      // API failures (signed out, offline, rate limit) arrive as a synthetic assistant message and
      // again as the result; the result row carries the reworded text, so skip the bubble.
      if (msg.is_api_error_message === true || typeof msg.error === "string") { state.busy = true; return false; }
      const m = msg.message || {};
      const id: string = m.id || uid("m");
      let changed = false;
      if (!parent && m.usage && noteContext(state, m.usage)) changed = true;
      const blocks: any[] = Array.isArray(m.content) ? m.content : [];
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const thinking = blocks.filter((b) => b.type === "thinking").map((b) => b.thinking).join("\n");
      if (text || thinking) {
        if (parent) {
          // subagent text: keep it out of the main thread
        } else {
          const existing = findAssistant(items, id);
          // The CLI sends one assistant message per finished content block: the thinking block arrives
          // on its own while the text is still to come, so only text (or a stop reason) ends the streaming.
          const done = !!text || !!m.stop_reason;
          const model = typeof m.model === "string" ? m.model : null;
          if (existing) patch(items, (i) => i === existing, "assistant", { text: text || existing.text, thinking: thinking || existing.thinking, streaming: existing.streaming && !done, model: model ?? existing.model, phase: text ? "text" : existing.phase });
          else items.push({ kind: "assistant", id, text, thinking, streaming: false, parentToolUseId: parent, model });
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
          patch(items, (i) => i === t, "tool", { result: contentText(r.content), status: r.is_error ? "error" : "done" });
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
      const info = msg.rate_limit_info || {};
      let changed = false;
      if (info.status === "rejected") {
        const at = typeof info.resetsAt === "number" ? new Date(info.resetsAt * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
        const text = `Your Claude plan limit is reached${at ? `; it resets at ${at}` : ""}. Supasito will keep the session; send again after the reset.`;
        const last = items[items.length - 1];
        if (!(last?.kind === "notice" && last.text === text)) { items.push({ kind: "notice", id: uid("n"), text, tone: "error" }); changed = true; }
      }
      const windows = parseRateLimit(info);
      if (windows.length === 0) return changed;
      state.plan = windows;
      let best: SessionState["usage"] = null;
      for (const w of windows) if (!best || w.utilization > best.utilization) best = { utilization: w.utilization, resetsAt: w.resetsAt, window: w.name };
      state.usage = best;
      return true;
    }
    case "result": {
      state.retry = null;
      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        if (it.kind === "assistant" && it.streaming) items[k] = { ...it, streaming: false };
        if (it.kind === "tool" && it.status === "running") items[k] = { ...it, status: "done" };
      }
      const subtype = typeof msg.subtype === "string" ? msg.subtype : "success";
      const failed = !!msg.is_error || subtype !== "success";
      const stopped = failed && state.interrupting;
      state.interrupting = false;
      const text = stopped ? "Stopped" : failed ? friendlyError(typeof msg.result === "string" ? msg.result : "", subtype) : "";
      const touched = filesTouchedInTurn(items);
      // a queued message is next in line; an approval that was never answered is now moot
      const q = items.findIndex((it) => it.kind === "user" && it.queued);
      if (q >= 0) { items[q] = { ...(items[q] as Extract<Item, { kind: "user" }>), queued: false }; state.busy = true; }
      expirePermissions(state);
      // total_cost_usd is cumulative for the running claude process (verified 2.1.257: the second turn's result
      // carried turn 1 + turn 2), and an interrupted turn reports 0; the completion line wants this turn's share.
      const total = typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : null;
      let turnCost: number | null = null;
      if (total != null && total > state.cost.process) { turnCost = total - state.cost.process; state.cost = { session: state.cost.session + turnCost, process: total, turns: state.cost.turns + (failed ? 0 : 1) }; }
      else if (!failed) state.cost = { ...state.cost, turns: state.cost.turns + 1 };
      // modelUsage.<model>.contextWindow is the exact window for the model that ran
      const mu = msg.modelUsage;
      if (state.context && mu && typeof mu === "object") {
        const win = Math.max(0, ...Object.values<any>(mu).map((m) => Number(m?.contextWindow) || 0));
        if (win > 0 && win !== state.context.window) state.context = { ...state.context, window: win };
      }
      noteFast(state, msg);
      const models = mu && typeof mu === "object" ? Object.keys(mu).filter((k) => !k.startsWith("<")) : [];
      const speed = typeof msg.usage?.speed === "string" ? msg.usage.speed : null;
      items.push({ kind: "result", id: uid("r"), isError: failed && !stopped, stopped, text, costUsd: turnCost, durationMs: typeof msg.duration_ms === "number" ? msg.duration_ms : null, numTurns: typeof msg.num_turns === "number" ? msg.num_turns : null, files: touched.files, created: touched.created, undone: false, at: Date.now(), models, speed });
      if (q >= 0) return true;
      state.busy = false;
      return true;
    }
    default:
      return false;
  }
}

/** Files written by Edit/Write tools in the turn that just ended (since the last user message that
 *  actually started a turn; queued messages are skipped). `created` lists files a Write created. */
export function filesTouchedInTurn(items: Item[]): { files: string[]; created: string[] } {
  const files: string[] = [];
  const created: string[] = [];
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    if (it.kind === "user") { if (it.queued) continue; break; }
    if (it.kind !== "tool" || it.status === "error") continue;
    const f = ["Edit", "MultiEdit", "Write"].includes(it.name) ? it.input?.file_path : it.name === "NotebookEdit" ? it.input?.notebook_path : null;
    if (typeof f !== "string" || !f) continue;
    if (!files.includes(f)) files.unshift(f);
    if (it.name === "Write" && it.created && !created.includes(f)) created.push(f);
  }
  return { files, created };
}

/** Record whether a Write tool call created its file (reported by Rust before the tool ran). */
export function applyFs(state: SessionState, toolUseId: string, existed: boolean) {
  return patch(state.items, (it) => it.id === toolUseId, "tool", { created: !existed });
}

/** Approvals nobody answered before the turn ended or the process left are moot. */
export function expirePermissions(state: SessionState): number {
  let n = 0;
  for (let k = 0; k < state.items.length; k++) {
    const it = state.items[k];
    if (it.kind === "permission" && it.status === "pending") { state.items[k] = { ...it, status: "expired" }; n++; }
  }
  return n;
}

export function addPermission(state: SessionState, req: PermissionRequest) {
  state.items.push({ kind: "permission", id: req.requestId, request: req.request, status: "pending" });
  state.busy = true;
}

export function settlePermission(state: SessionState, requestId: string, status: "allowed" | "denied") {
  patch(state.items, (it) => it.id === requestId, "permission", { status });
}

export function markUndone(state: SessionState, resultId: string) {
  patch(state.items, (it) => it.id === resultId, "result", { undone: true });
}

export function addUser(state: SessionState, text: string, selection: Selection | null, images: Attachment[] = []) {
  const queued = state.busy;
  state.items.push({ kind: "user", id: uid("u"), text, selection, selectionSummary: null, images: images.map((i) => ({ mediaType: i.mediaType, data: i.data })), queued });
  state.busy = true;
}

/** The conversation as plain text for handing to another agent: what was said and which files each turn
 *  changed, newest last, cut from the front to fit `max` characters. The files themselves the new agent reads from disk. */
export function handoffText(items: Item[], max = 8000): string {
  const lines: string[] = [];
  for (const it of items) {
    if (it.kind === "user" && it.text.trim()) lines.push(`User: ${it.text.trim()}`);
    else if (it.kind === "assistant" && it.text.trim()) lines.push(`Agent: ${it.text.trim()}`);
    else if (it.kind === "result" && it.files.length) lines.push(`(files changed: ${it.files.join(", ")}${it.undone ? " — then undone" : ""})`);
  }
  let out = lines.join("\n");
  if (out.length > max) out = "…" + out.slice(out.length - max);
  return out;
}

export function addNotice(state: SessionState, text: string, tone: "info" | "error" = "info") {
  state.items.push({ kind: "notice", id: uid("n"), text, tone });
}
