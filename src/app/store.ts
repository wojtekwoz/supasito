import { create } from "zustand";
import { backend, type Backend } from "../backend";
import type { Attachment, ClaudeStatus, DevInfo, GitStatus, PermissionRequest, PublishTarget, Selection, SessionInfo, Settings, Site } from "../types";
import { addNotice, addPermission, addUser, applyMessage, emptySession, markUndone, settlePermission, type SessionState } from "../agent/transcript";
import { routeForFile } from "../routes";

export const DRAFT = "draft";
export type Device = "desktop" | "tablet" | "phone";

type PublishState = { open: boolean; running: boolean; log: string[]; url: string | null; error: string | null; cancelled: boolean; target: PublishTarget; step: "" | "commit" | "push" | "deploy" };
type DiffState = { open: boolean; loading: boolean; files: string[]; text: string; error: string | null };
type NewSiteState = { open: boolean; running: boolean; log: string[]; error: string | null };

export type Store = {
  ready: boolean;
  fatal: string | null;
  claude: ClaudeStatus | null;
  settings: Settings;
  settingsOpen: boolean;
  sites: Site[];
  currentSiteId: string | null;
  sessions: Record<string, SessionInfo[]>;
  currentSessionId: string | null;
  transcripts: Record<string, SessionState>;
  running: Record<string, boolean>;
  dev: Record<string, DevInfo>;
  devLogs: Record<string, string[]>;
  devLogOpen: boolean;
  git: Record<string, GitStatus>;
  selection: Selection | null;
  attachments: Attachment[];
  picking: boolean;
  previewPath: string;
  previewTitle: string;
  device: Device;
  previewNonce: number;
  /** Set to make the preview navigate; the Preview pane consumes it. */
  navigateRequest: { path: string; seq: number } | null;
  publish: PublishState;
  diff: DiffState;
  /** Time of the last commit made from Open; turns before it can no longer be undone. */
  committedAt: number;
  newSite: NewSiteState;
  toast: string | null;

  init: () => Promise<void>;
  selectSite: (id: string) => Promise<void>;
  addSiteFromFolder: () => Promise<void>;
  removeSite: (id: string) => Promise<void>;
  installDeps: (id: string) => Promise<void>;
  createSite: (name: string) => Promise<void>;
  openNewSite: (open: boolean) => void;
  newSession: () => void;
  openSession: (id: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  respondPermission: (sessionId: string, requestId: string, response: unknown, status: "allowed" | "denied") => Promise<void>;
  interrupt: () => Promise<void>;
  stopSession: (id: string) => Promise<void>;
  startDev: (siteId: string) => Promise<void>;
  stopDev: (siteId: string) => Promise<void>;
  restartDev: (siteId: string) => Promise<void>;
  toggleDevLog: () => void;
  refreshGit: (siteId: string) => Promise<void>;
  gitInit: (siteId: string) => Promise<void>;
  undoTurn: (sessionId: string, resultId: string) => Promise<void>;
  previewEvent: (kind: string, detail: string) => void;
  setPicking: (on: boolean) => void;
  setSelection: (sel: Selection | null) => void;
  addAttachments: (files: File[]) => Promise<void>;
  removeAttachment: (id: string) => void;
  setPublishCommand: (command: string, key: "publish" | "preview") => Promise<void>;
  setPreviewPath: (path: string) => void;
  setPreviewInfo: (path: string, title: string) => void;
  setDevice: (d: Device) => void;
  reloadPreview: () => void;
  revealSite: (siteId: string) => Promise<void>;
  openSiteInEditor: (siteId: string) => Promise<void>;
  capturePreview: () => Promise<void>;
  /** The preview pane sets this so captures know where the iframe is. */
  previewRect: { x: number; y: number; w: number; h: number } | null;
  setPreviewRect: (r: { x: number; y: number; w: number; h: number } | null) => void;
  recheckClaude: () => Promise<void>;
  openInBrowser: () => Promise<void>;
  openPublish: () => void;
  runPublish: (target: PublishTarget, opts: { commit: boolean; message: string; push: boolean }) => Promise<void>;
  cancelPublish: () => Promise<void>;
  openDiff: (files: string[]) => Promise<void>;
  closeDiff: () => void;
  syncBadge: () => void;
  setPublishOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  saveSettings: (patch: Settings) => Promise<void>;
  showToast: (t: string | null) => void;
};

let api: Backend;
let initStarted = false;
const now = () => Date.now();

function bump(transcripts: Record<string, SessionState>, id: string): Record<string, SessionState> {
  const s = transcripts[id];
  return { ...transcripts, [id]: { ...s, items: [...s.items] } };
}

export const useStore = create<Store>((set, get) => ({
  ready: false,
  fatal: null,
  claude: null,
  settings: {},
  settingsOpen: false,
  sites: [],
  currentSiteId: null,
  sessions: {},
  currentSessionId: null,
  transcripts: {},
  running: {},
  dev: {},
  devLogs: {},
  devLogOpen: false,
  git: {},
  selection: null,
  attachments: [],
  picking: false,
  previewPath: "/",
  previewTitle: "",
  device: "desktop",
  previewNonce: 0,
  navigateRequest: null,
  previewRect: null,
  publish: { open: false, running: false, log: [], url: null, error: null, cancelled: false, target: "production", step: "" },
  diff: { open: false, loading: false, files: [], text: "", error: null },
  committedAt: 0,
  newSite: { open: false, running: false, log: [], error: null },
  toast: null,

  async init() {
    // React StrictMode runs effects twice in dev; listeners must only be registered once.
    if (initStarted) return;
    initStarted = true;
    try {
      api = await backend();
      const [settings, claude, sites, running] = await Promise.all([api.settingsGet(), api.claudeCheck(), api.sitesList(), api.agentRunning()]);
      set({ settings, claude, sites, running: Object.fromEntries(running.map((r) => [r.sessionId, true])) });

      await api.on("agent://message", ({ sessionId, message }) => {
        const st = get();
        const cur = st.transcripts[sessionId] ?? emptySession();
        const before = cur.lastWrite?.seq ?? 0;
        const changed = applyMessage(cur, message);
        if (!st.transcripts[sessionId]) st.transcripts[sessionId] = cur;
        if (changed) set({ transcripts: bump(st.transcripts, sessionId) });
        // Follow the page Claude is editing, for the session that is on screen.
        if (cur.lastWrite && cur.lastWrite.seq !== before && sessionId === st.currentSessionId && st.currentSiteId) {
          const site = st.sites.find((x) => x.id === st.currentSiteId);
          const route = routeForFile(cur.lastWrite.file, site?.path);
          if (route && route !== st.previewPath) set({ navigateRequest: { path: route, seq: cur.lastWrite.seq } });
        }
        if (message?.type === "result") {
          const siteId = st.sites.find((s) => (st.sessions[s.id] ?? []).some((x) => x.id === sessionId))?.id ?? st.currentSiteId;
          if (siteId) void get().refreshGit(siteId);
          if (!document.hasFocus()) void api.requestAttention().catch(() => {});
        }
      });
      await api.on("agent://permission", (req: PermissionRequest) => {
        const st = get();
        const cur = st.transcripts[req.sessionId] ?? emptySession();
        addPermission(cur, req);
        st.transcripts[req.sessionId] = cur;
        set({ transcripts: bump(st.transcripts, req.sessionId) });
        get().syncBadge();
        if (!document.hasFocus()) void api.requestAttention().catch(() => {});
      });
      await api.on("agent://exit", ({ sessionId, code }) => {
        const st = get();
        const running = { ...st.running };
        delete running[sessionId];
        const cur = st.transcripts[sessionId];
        if (cur && cur.busy) {
          const tail = cur.stderr.slice(-3).map((l) => l.trim()).filter(Boolean).join(" · ");
          addNotice(cur, code === 0 ? "Claude ended the session." : `Claude exited unexpectedly (code ${code ?? "?"}).${tail ? ` ${tail}` : ""} Send a message to resume.`, code === 0 ? "info" : "error");
          cur.busy = false;
          set({ running, transcripts: bump(st.transcripts, sessionId) });
        } else set({ running });
      });
      await api.on("agent://stderr", ({ sessionId, line }) => {
        const cur = get().transcripts[sessionId];
        if (cur) { cur.stderr.push(line); if (cur.stderr.length > 100) cur.stderr.shift(); }
        if (import.meta.env.DEV) console.debug("[claude stderr]", sessionId, line);
      });
      await api.on("dev://status", (info: DevInfo) => {
        set({ dev: { ...get().dev, [info.siteId]: info } });
      });
      await api.on("dev://log", ({ siteId, line }) => {
        const logs = get().devLogs[siteId] ?? [];
        set({ devLogs: { ...get().devLogs, [siteId]: [...logs.slice(-400), line] } });
      });
      await api.on("publish://log", ({ line }) => {
        set({ publish: { ...get().publish, log: [...get().publish.log, line] } });
      });
      await api.on("install://log", ({ line }) => {
        const ns = get().newSite;
        set({ newSite: { ...ns, log: [...ns.log.slice(-200), line] } });
      });

      set({ ready: true });
      const first = sites[0];
      if (first) await get().selectSite(first.id);
    } catch (e) {
      set({ ready: true, fatal: String(e) });
    }
  },

  async selectSite(id) {
    const site = get().sites.find((s) => s.id === id);
    if (!site) return;
    const previous = get().currentSiteId;
    set({ currentSiteId: id, selection: null, picking: false, previewPath: "/", previewTitle: "", devLogOpen: false });
    // Stop the dev server of the site we are leaving unless one of its sessions is still working.
    if (previous && previous !== id) {
      const st = get();
      const busy = (st.sessions[previous] ?? []).some((x) => st.transcripts[x.id]?.busy);
      const d = st.dev[previous];
      if (!busy && d && (d.status === "ready" || d.status === "starting")) void api.devStop(previous).catch(() => {});
    }
    const [sessions, devInfo] = await Promise.all([api.sessionsList(id), api.devStatus(id)]);
    set({ sessions: { ...get().sessions, [id]: sessions } });
    if (devInfo) set({ dev: { ...get().dev, [id]: devInfo } });
    void get().refreshGit(id);
    const last = site.lastSessionId && sessions.find((s) => s.id === site.lastSessionId) ? site.lastSessionId : sessions[0]?.id;
    if (last) await get().openSession(last); else get().newSession();
    if (!devInfo || devInfo.status === "stopped" || devInfo.status === "error") {
      if (site.dev && !site.needsInstall) void get().startDev(id);
    }
  },

  async addSiteFromFolder() {
    const path = await api.sitePickFolder();
    if (!path) return;
    try {
      const site = await api.siteAdd(path);
      const sites = [site, ...get().sites.filter((s) => s.id !== site.id)];
      set({ sites });
      await get().selectSite(site.id);
    } catch (e) { get().showToast(String(e)); }
  },

  async removeSite(id) {
    await api.devStop(id).catch(() => {});
    await api.siteRemove(id);
    const sites = get().sites.filter((s) => s.id !== id);
    set({ sites });
    if (get().currentSiteId === id) {
      if (sites[0]) await get().selectSite(sites[0].id); else set({ currentSiteId: null, currentSessionId: null });
    }
  },

  async installDeps(id) {
    set({ newSite: { ...get().newSite, running: true, log: [], error: null } });
    try {
      const site = await api.siteInstall(id);
      set({ sites: get().sites.map((s) => (s.id === id ? site : s)), newSite: { ...get().newSite, running: false } });
      if (site.dev) void get().startDev(id);
    } catch (e) {
      set({ newSite: { ...get().newSite, running: false, error: String(e) } });
    }
  },

  openNewSite(open) { set({ newSite: { open, running: false, log: [], error: null } }); },

  async createSite(name) {
    const parent = await api.sitePickFolder();
    if (!parent) return;
    set({ newSite: { open: true, running: true, log: [], error: null } });
    try {
      const site = await api.siteNew(parent, name);
      set({ sites: [site, ...get().sites], newSite: { open: false, running: false, log: [], error: null } });
      await get().selectSite(site.id);
    } catch (e) {
      set({ newSite: { ...get().newSite, running: false, error: String(e) } });
    }
  },

  newSession() {
    const t = get().transcripts;
    set({ currentSessionId: DRAFT, transcripts: { ...t, [DRAFT]: emptySession() }, selection: null, picking: false });
  },

  async openSession(id) {
    set({ currentSessionId: id, selection: null, picking: false });
    const siteId = get().currentSiteId;
    if (!siteId) return;
    void api.siteSetLastSession(siteId, id);
    if (get().transcripts[id]?.loaded) return;
    try {
      const lines = await api.sessionTranscript(siteId, id);
      const st = get().transcripts[id] ?? emptySession();
      if (st.items.length === 0) for (const l of lines) applyMessage(st, l);
      st.loaded = true;
      st.busy = st.busy && !!get().running[id];
      set({ transcripts: { ...get().transcripts, [id]: { ...st, items: [...st.items] } } });
    } catch (e) {
      const st = get().transcripts[id] ?? emptySession();
      st.loaded = true;
      addNotice(st, `Could not load the saved transcript: ${e}`, "error");
      set({ transcripts: { ...get().transcripts, [id]: st } });
    }
  },

  async send(text) {
    const st = get();
    const siteId = st.currentSiteId;
    if (!siteId || !text.trim()) return;
    let sessionId = st.currentSessionId ?? DRAFT;
    const selection = st.selection;
    const attachments = st.attachments;
    try {
      if (sessionId === DRAFT) {
        const id = await api.agentStart(siteId, null);
        const draft = st.transcripts[DRAFT] ?? emptySession();
        const transcripts = { ...st.transcripts, [id]: { ...draft, loaded: true } };
        delete transcripts[DRAFT];
        const info: SessionInfo = { id, title: text.trim().slice(0, 90), lastModified: now(), createdAt: now(), messageCount: 1 };
        set({ transcripts, currentSessionId: id, sessions: { ...st.sessions, [siteId]: [info, ...(st.sessions[siteId] ?? [])] }, running: { ...st.running, [id]: true } });
        void api.siteSetLastSession(siteId, id);
        sessionId = id;
      } else if (!st.running[sessionId]) {
        await api.agentStart(siteId, sessionId);
        set({ running: { ...get().running, [sessionId]: true } });
      }
      const cur = get().transcripts[sessionId] ?? emptySession();
      addUser(cur, text.trim(), selection, attachments);
      get().transcripts[sessionId] = cur;
      set({ transcripts: bump(get().transcripts, sessionId), selection: null, attachments: [], picking: false });
      await api.agentSend(sessionId, text.trim(), selection, attachments);
      const list = (get().sessions[siteId] ?? []).map((s) => (s.id === sessionId ? { ...s, lastModified: now(), messageCount: s.messageCount + 1 } : s));
      set({ sessions: { ...get().sessions, [siteId]: list } });
    } catch (e) {
      const cur = get().transcripts[sessionId] ?? emptySession();
      addNotice(cur, String(e), "error");
      cur.busy = false;
      get().transcripts[sessionId] = cur;
      set({ transcripts: bump(get().transcripts, sessionId) });
    }
  },

  async respondPermission(sessionId, requestId, response, status) {
    const cur = get().transcripts[sessionId];
    if (cur) { settlePermission(cur, requestId, status); set({ transcripts: bump(get().transcripts, sessionId) }); }
    get().syncBadge();
    try { await api.agentRespond(sessionId, requestId, response); } catch (e) { get().showToast(String(e)); }
  },

  async interrupt() {
    const id = get().currentSessionId;
    if (!id || id === DRAFT) return;
    const cur = get().transcripts[id];
    if (cur) cur.interrupting = true;
    try { await api.agentInterrupt(id); } catch (e) { if (cur) cur.interrupting = false; get().showToast(String(e)); }
  },

  async stopSession(id) {
    try { await api.agentStop(id); } catch (e) { get().showToast(String(e)); }
  },

  async startDev(siteId) {
    try {
      const info = await api.devStart(siteId);
      set({ dev: { ...get().dev, [siteId]: info } });
    } catch (e) {
      set({ dev: { ...get().dev, [siteId]: { siteId, port: 0, url: "", status: "error", command: "" } }, devLogs: { ...get().devLogs, [siteId]: [String(e)] } });
    }
  },
  async stopDev(siteId) { await api.devStop(siteId).catch(() => {}); },
  async restartDev(siteId) { await api.devStop(siteId).catch(() => {}); set({ devLogs: { ...get().devLogs, [siteId]: [] } }); await get().startDev(siteId); },
  toggleDevLog() { set({ devLogOpen: !get().devLogOpen }); },

  async refreshGit(siteId) {
    try { const g = await api.siteGitStatus(siteId); set({ git: { ...get().git, [siteId]: g } }); } catch { /* ignore */ }
  },
  async gitInit(siteId) {
    try { await api.siteGitInit(siteId); const site = await api.siteRefresh(siteId); set({ sites: get().sites.map((s) => (s.id === siteId ? site : s)) }); await get().refreshGit(siteId); } catch (e) { get().showToast(String(e)); }
  },

  async undoTurn(sessionId, resultId) {
    const siteId = get().currentSiteId;
    const cur = get().transcripts[sessionId];
    if (!siteId || !cur) return;
    const item = cur.items.find((i) => i.kind === "result" && i.id === resultId);
    if (!item || item.kind !== "result" || item.files.length === 0) return;
    if (item.at <= get().committedAt) { get().showToast("That turn was committed since; undo it with git instead."); return; }
    try {
      const restored = await api.siteUndoFiles(siteId, item.files);
      markUndone(cur, resultId);
      set({ transcripts: bump(get().transcripts, sessionId) });
      get().showToast(`Restored ${restored.length} file${restored.length === 1 ? "" : "s"}`);
      void get().refreshGit(siteId);
    } catch (e) { get().showToast(String(e)); }
  },
  previewEvent(kind, detail) { void api?.previewEvent(kind, detail).catch(() => {}); },
  async addAttachments(files) {
    const accepted = files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
    if (accepted.length === 0) { if (files.length) get().showToast("Only PNG, JPEG, GIF and WebP images can be attached."); return; }
    const read = (f: File) => new Promise<Attachment>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(r.error);
      r.onload = () => resolve({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: f.name || "image", mediaType: f.type, data: String(r.result).split(",")[1] ?? "", size: f.size });
      r.readAsDataURL(f);
    });
    const out: Attachment[] = [];
    for (const f of accepted) {
      if (f.size > 5 * 1024 * 1024) { get().showToast(`${f.name || "Image"} is larger than 5 MB.`); continue; }
      try { out.push(await read(f)); } catch { get().showToast(`Could not read ${f.name || "image"}.`); }
    }
    if (out.length) set({ attachments: [...get().attachments, ...out].slice(0, 6) });
  },
  removeAttachment(id) { set({ attachments: get().attachments.filter((a) => a.id !== id) }); },
  async setPublishCommand(command, key) {
    const siteId = get().currentSiteId;
    if (!siteId) return;
    try {
      const site = await api.siteSetPublish(siteId, command, key);
      set({ sites: get().sites.map((s) => (s.id === siteId ? site : s)) });
    } catch (e) { get().showToast(String(e)); }
  },
  setPicking(on) { set({ picking: on }); },
  setSelection(sel) { set({ selection: sel, picking: false }); },
  setPreviewPath(path) { set({ previewPath: path.startsWith("/") ? path : "/" + path }); },
  setPreviewInfo(path, title) { set({ previewPath: path || "/", previewTitle: title }); },
  setDevice(d) { set({ device: d }); },
  reloadPreview() { set({ previewNonce: get().previewNonce + 1 }); },
  async revealSite(siteId) {
    const site = get().sites.find((s) => s.id === siteId);
    if (site) await api.revealPath(site.path).catch((e) => get().showToast(String(e)));
  },
  async openSiteInEditor(siteId) {
    try {
      const which = await api.siteOpenEditor(siteId);
      if (which === "finder") get().showToast("No code editor found on your PATH (code, cursor, zed); opened the folder instead.");
    } catch (e) { get().showToast(String(e)); }
  },
  setPreviewRect(r) { set({ previewRect: r }); },
  async capturePreview() {
    const st = get();
    const rect = st.previewRect;
    const dev = st.currentSiteId ? st.dev[st.currentSiteId] : null;
    if (!rect || dev?.status !== "ready") { get().showToast("The preview must be showing before it can be captured."); return; }
    try {
      const shot = await api.previewCapture(rect, window.devicePixelRatio || 1);
      const a: Attachment = { id: `${Date.now()}-shot`, name: `preview${st.previewPath === "/" ? "" : st.previewPath.replace(/\//g, "-")}.png`, mediaType: shot.mediaType, data: shot.data, size: shot.bytes };
      set({ attachments: [...st.attachments.filter((x) => !x.name.startsWith("preview")), a].slice(0, 6) });
    } catch (e) { get().showToast(String(e)); }
  },
  async recheckClaude() {
    const claude = await api.claudeCheck();
    set({ claude });
    if (!claude.ok) get().showToast("Still can't find Claude Code. Install it, sign in once in a terminal, or set its path in Settings.");
  },
  async openInBrowser() {
    const st = get();
    const d = st.currentSiteId ? st.dev[st.currentSiteId] : null;
    if (d?.url && d.url !== "mock:") await api.openExternal(d.url + st.previewPath);
  },

  openPublish() {
    set({ publish: { open: true, running: false, log: [], url: null, error: null, cancelled: false, target: get().publish.target, step: "" } });
  },
  async runPublish(target, opts) {
    const siteId = get().currentSiteId;
    if (!siteId) return;
    const site = get().sites.find((s) => s.id === siteId);
    const cmd = target === "preview" ? site?.preview : site?.publish;
    if (!cmd) { get().openPublish(); return; }
    const log: string[] = [];
    set({ publish: { open: true, running: true, log, url: null, error: null, cancelled: false, target, step: opts.commit ? "commit" : "deploy" } });
    const push = (line: string) => set({ publish: { ...get().publish, log: [...get().publish.log, line] } });
    try {
      if (opts.commit) {
        push(`$ git commit -m ${JSON.stringify(opts.message.trim() || "Update site")}`);
        const g = await api.siteGitCommit(siteId, opts.message.trim() || "Update site");
        set({ git: { ...get().git, [siteId]: g }, committedAt: Date.now() });
        push("Committed.");
      }
      if (opts.push) {
        set({ publish: { ...get().publish, step: "push" } });
        push("$ git push -u origin HEAD");
        const out = await api.siteGitPush(siteId);
        if (out) push(out);
      }
      set({ publish: { ...get().publish, step: "deploy" } });
      push(`$ ${cmd}`);
      const r = await api.publishRun(siteId, target);
      const cancelled = get().publish.cancelled;
      set({ publish: { ...get().publish, running: false, step: "", url: cancelled ? null : r.url ?? null, error: cancelled || r.ok ? null : `Publish exited with code ${r.code ?? "?"}` } });
      void get().refreshGit(siteId);
    } catch (e) {
      set({ publish: { ...get().publish, running: false, step: "", error: String(e) } });
    }
  },
  async cancelPublish() {
    const siteId = get().currentSiteId;
    if (!siteId || !get().publish.running) return;
    set({ publish: { ...get().publish, cancelled: true } });
    if (get().publish.step === "deploy") {
      try { await api.publishCancel(siteId); } catch (e) { get().showToast(String(e)); }
    }
  },
  async openDiff(files) {
    const siteId = get().currentSiteId;
    if (!siteId || files.length === 0) return;
    set({ diff: { open: true, loading: true, files, text: "", error: null } });
    try {
      const text = await api.siteGitDiff(siteId, files);
      set({ diff: { ...get().diff, loading: false, text } });
    } catch (e) {
      set({ diff: { ...get().diff, loading: false, error: String(e) } });
    }
  },
  closeDiff() { set({ diff: { ...get().diff, open: false } }); },
  syncBadge() {
    let pending = 0;
    for (const t of Object.values(get().transcripts)) for (const it of t.items) if (it.kind === "permission" && it.status === "pending") pending++;
    void api?.setBadge(pending).catch(() => {});
  },
  setPublishOpen(open) { set({ publish: { ...get().publish, open } }); },
  setSettingsOpen(open) { set({ settingsOpen: open }); },
  async saveSettings(patch) {
    await api.settingsSet(patch);
    const [settings, claude] = await Promise.all([api.settingsGet(), api.claudeCheck()]);
    set({ settings, claude });
  },
  showToast(t) { set({ toast: t }); if (t) setTimeout(() => { if (get().toast === t) set({ toast: null }); }, 5000); },
}));

const NO_SESSIONS: SessionInfo[] = [];
const NO_LINES: string[] = [];
export const useSessionsOfCurrentSite = () => useStore((s) => (s.currentSiteId ? s.sessions[s.currentSiteId] ?? NO_SESSIONS : NO_SESSIONS));
export const useDevLogOfCurrentSite = () => useStore((s) => (s.currentSiteId ? s.devLogs[s.currentSiteId] ?? NO_LINES : NO_LINES));
export const useSite = () => useStore((s) => s.sites.find((x) => x.id === s.currentSiteId) ?? null);
export const useSession = () => useStore((s) => (s.currentSessionId ? s.transcripts[s.currentSessionId] ?? null : null));
export const useDev = () => useStore((s) => (s.currentSiteId ? s.dev[s.currentSiteId] ?? null : null));
