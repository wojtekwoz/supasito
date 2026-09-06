import type {
  Attachment, DevInfo, EventName, GitStatus, PublishResult, PublishTarget, RestoreReport, Selection, SessionInfo, SessionOverrides, Settings, Site, Toolchain,
} from "./types";

export type Unlisten = () => void;

export interface Backend {
  settingsGet(): Promise<Settings>;
  settingsSet(patch: Settings): Promise<void>;
  toolchainCheck(): Promise<Toolchain>;
  sitesList(): Promise<Site[]>;
  sitePickFolder(): Promise<string | null>;
  siteAdd(path: string): Promise<Site>;
  siteRemove(siteId: string): Promise<void>;
  siteRefresh(siteId: string): Promise<Site>;
  siteInstall(siteId: string): Promise<Site>;
  siteGitStatus(siteId: string): Promise<GitStatus>;
  siteGitInit(siteId: string): Promise<void>;
  siteUndoFiles(siteId: string, files: string[], created: string[]): Promise<RestoreReport>;
  previewEvent(kind: string, detail: string): Promise<void>;
  siteSetLastSession(siteId: string, sessionId: string | null): Promise<void>;
  siteNew(parent: string, name: string): Promise<Site>;
  devStart(siteId: string): Promise<DevInfo>;
  devStop(siteId: string): Promise<void>;
  devStatus(siteId: string): Promise<DevInfo | null>;
  devLog(siteId: string): Promise<string[]>;
  publishRun(siteId: string, target: PublishTarget): Promise<PublishResult>;
  siteGitCommit(siteId: string, message: string): Promise<GitStatus>;
  siteGitPush(siteId: string): Promise<string>;
  siteGitDiff(siteId: string, files: string[]): Promise<string>;
  setBadge(count: number): Promise<void>;
  previewCapture(rect: { x: number; y: number; w: number; h: number }, scale: number): Promise<{ mediaType: string; data: string; bytes: number }>;
  siteOpenEditor(siteId: string): Promise<string>;
  siteReadText(siteId: string, rel: string): Promise<string>;
  siteWriteText(siteId: string, rel: string, content: string): Promise<void>;
  siteRename(siteId: string, name: string): Promise<Site>;
  agentSetMode(sessionId: string, mode: string): Promise<void>;
  requestAttention(): Promise<void>;
  publishCancel(siteId: string): Promise<void>;
  agentStart(siteId: string, resume: string | null, overrides?: SessionOverrides | null): Promise<string>;
  /** Mid-session control requests (Claude Code 2.1.257: `set_model`, `apply_flag_settings`). Both resolve with the request id; a rejection arrives later as `agent://control_error`. */
  agentSetModel(sessionId: string, model: string): Promise<string>;
  agentApplySettings(sessionId: string, settings: Record<string, unknown>): Promise<string>;
  agentSend(sessionId: string, text: string, selection: Selection | null, images: Attachment[]): Promise<void>;
  siteSetPublish(siteId: string, command: string, key: "publish" | "preview"): Promise<Site>;
  agentRespond(sessionId: string, requestId: string, response: unknown): Promise<void>;
  agentInterrupt(sessionId: string): Promise<void>;
  agentStop(sessionId: string): Promise<void>;
  agentRunning(): Promise<{ sessionId: string; siteId: string }[]>;
  sessionsList(siteId: string): Promise<SessionInfo[]>;
  sessionTranscript(siteId: string, sessionId: string): Promise<unknown[]>;
  openExternal(url: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  on(event: EventName, handler: (payload: any) => void): Promise<Unlisten>;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { openUrl, revealItemInDir } = await import("@tauri-apps/plugin-opener");
  return {
    settingsGet: () => invoke("settings_get"),
    settingsSet: (patch) => invoke("settings_set", { patch }),
    toolchainCheck: () => invoke("toolchain_check"),
    sitesList: () => invoke("sites_list"),
    sitePickFolder: () => invoke("site_pick_folder"),
    siteAdd: (path) => invoke("site_add", { path }),
    siteRemove: (siteId) => invoke("site_remove", { siteId }),
    siteRefresh: (siteId) => invoke("site_refresh", { siteId }),
    siteInstall: (siteId) => invoke("site_install", { siteId }),
    siteGitStatus: (siteId) => invoke("site_git_status", { siteId }),
    siteGitInit: (siteId) => invoke("site_git_init", { siteId }),
    siteUndoFiles: (siteId, files, created) => invoke("site_undo_files", { siteId, files, created }),
    previewEvent: (kind, detail) => invoke("preview_event", { kind, detail }),
    siteSetLastSession: (siteId, sessionId) => invoke("site_set_last_session", { siteId, sessionId }),
    siteNew: (parent, name) => invoke("site_new", { parent, name }),
    devStart: (siteId) => invoke("dev_start", { siteId }),
    devStop: (siteId) => invoke("dev_stop", { siteId }),
    devStatus: (siteId) => invoke("dev_status", { siteId }),
    devLog: (siteId) => invoke("dev_log", { siteId }),
    publishRun: (siteId, target) => invoke("publish_run", { siteId, target }),
    siteGitCommit: (siteId, message) => invoke("site_git_commit", { siteId, message }),
    siteGitPush: (siteId) => invoke("site_git_push", { siteId }),
    siteGitDiff: (siteId, files) => invoke("site_git_diff", { siteId, files }),
    setBadge: (count) => invoke("set_badge", { count }),
    previewCapture: (rect, scale) => invoke("preview_capture", { x: rect.x, y: rect.y, w: rect.w, h: rect.h, scale }),
    siteOpenEditor: (siteId) => invoke("site_open_editor", { siteId }),
    siteReadText: (siteId, rel) => invoke("site_read_text", { siteId, rel }),
    siteWriteText: (siteId, rel, content) => invoke("site_write_text", { siteId, rel, content }),
    siteRename: (siteId, name) => invoke("site_rename", { siteId, name }),
    agentSetMode: (sessionId, mode) => invoke("agent_set_mode", { sessionId, mode }),
    requestAttention: () => invoke("request_attention"),
    publishCancel: (siteId) => invoke("publish_cancel", { siteId }),
    agentStart: (siteId, resume, overrides) => invoke("agent_start", { siteId, resume, overrides: overrides ?? null }),
    agentSetModel: (sessionId, model) => invoke("agent_set_model", { sessionId, model }),
    agentApplySettings: (sessionId, settings) => invoke("agent_apply_settings", { sessionId, settings }),
    agentSend: (sessionId, text, selection, images) => invoke("agent_send", { sessionId, text, selection, images: images.map((i) => ({ mediaType: i.mediaType, data: i.data })) }),
    siteSetPublish: (siteId, command, key) => invoke("site_set_publish", { siteId, command, key }),
    agentRespond: (sessionId, requestId, response) => invoke("agent_respond", { sessionId, requestId, response }),
    agentInterrupt: (sessionId) => invoke("agent_interrupt", { sessionId }),
    agentStop: (sessionId) => invoke("agent_stop", { sessionId }),
    agentRunning: () => invoke("agent_running"),
    sessionsList: (siteId) => invoke("sessions_list", { siteId }),
    sessionTranscript: (siteId, sessionId) => invoke("session_transcript", { siteId, sessionId }),
    openExternal: (url) => openUrl(url),
    revealPath: (path) => revealItemInDir(path),
    on: async (event, handler) => listen(event, (e) => handler(e.payload)),
  };
}

let backendPromise: Promise<Backend> | null = null;
export function backend(): Promise<Backend> {
  if (!backendPromise) {
    backendPromise = isTauri ? tauriBackend() : import("./mock").then((m) => m.mockBackend());
  }
  return backendPromise;
}
