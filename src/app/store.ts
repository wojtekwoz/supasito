import { create } from "zustand";
import { backend, type Backend } from "../backend";
import type { Attachment, ClaudeStatus, DevInfo, GitStatus, PermissionRequest, PublishTarget, Selection, SessionInfo, SessionOverrides, Settings, Site, Toolchain, UpdateInfo } from "../types";
import { addNotice, addPermission, addUser, applyFs, applyMessage, backendOf, emptySession, expirePermissions, markUndone, parseRateLimit, resetProcessCost, settlePermission, type PlanWindow, type SessionState } from "../agent/transcript";
import { applyCodexMessage, parseCodexRateLimits } from "../agent/codex";
import { isCodexModel, modelShort } from "../models";
import { routeForFile } from "../routes";

export const DRAFT = "draft";

/** Sent by the "Set up the preview" button. Detection reads package.json's `dev` script (a known framework's
 *  binary gets its port flag, an unrecognised script is run as-is on the port it picks) or supasito.json's `dev`. */
export const SETUP_PREVIEW_PROMPT = `Supasito shows this site in a live preview by running its dev server, but this folder has no dev command yet. Set that up without changing the site itself:
1. Look at what is here: plain HTML, a framework without a dev script, or something else.
2. Give the project a "dev" script in package.json that serves the site locally with live reload. For plain HTML use Vite (npm install -D vite, script "dev": "vite"). Supasito runs the script and reads the address the server prints, so a script that picks its own port is fine; to let Supasito choose the port instead, write supasito.json with {"dev": "<command> {port}"} — {port} is replaced at start.
3. Install the dependencies so node_modules exists, and add node_modules to .gitignore if this is a git repository.
4. Reply with one line saying what you set up.`;

/** Sent when the preview exists on paper but does not work: the install failed, or the dev command errors out. */
export const fixPreviewPrompt = (problem: string, log: string) => `Supasito shows this site in a live preview by running its dev server, and that is not working right now: ${problem}

The last output was:
${log || "(no output)"}

Get this site running locally, without changing how the site looks:
1. Read package.json and any supasito.json here and work out why the command fails.
2. Fix it: install what is missing, correct the "dev" script, or write supasito.json with {"dev": "<command> {port}"} — Supasito replaces {port} when it starts the server, and otherwise runs the command as written and reads the address it prints.
3. Run the command once yourself to check it serves the site, then stop it again.
4. Reply with one line saying what you fixed.`;
/** Resolves after `n` animation frames, i.e. once the DOM changes made so far have been painted; after 250 ms regardless, since
 *  frames stop while the window is occluded and waiting longer would not help the capture. */
const paints = (n: number) => new Promise<void>((resolve) => {
  const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
  step(n);
  setTimeout(resolve, 250);
});
/** A repair asked for from the preview pane is its own task, so it starts on a clean session rather than
 *  landing at the end of whatever the user was talking about. An untouched draft is already clean. */
function startFreshSession(get: () => Store) {
  const id = get().currentSessionId;
  if (id && (get().transcripts[id]?.items.length ?? 0) > 0) get().newSession();
}

export type Device = "desktop" | "tablet" | "phone";

type PublishState = { open: boolean; running: boolean; log: string[]; url: string | null; error: string | null; cancelled: boolean; target: PublishTarget; step: "" | "commit" | "push" | "deploy" };
type DiffState = { open: boolean; loading: boolean; files: string[]; text: string; error: string | null };
type RulesState = { open: boolean; loading: boolean; saving: boolean; text: string; error: string | null };
type NewSiteState = { open: boolean; running: boolean; log: string[]; error: string | null };

export type Store = {
  ready: boolean;
  fatal: string | null;
  /** Shortcut for `tools.claude`; null until the first check completes. */
  claude: ClaudeStatus | null;
  tools: Toolchain | null;
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
  /** The preview covers the window, the rail is hidden and the conversation floats over the bottom-left corner (⌘\). */
  previewFull: boolean;
  /** A capture is about to be taken: the floating conversation hides so it stays out of the picture. */
  capturing: boolean;
  /** Where the floating conversation was dragged to (from the window's left and bottom edges); null = the bottom-left corner. */
  panelPos: { left: number; bottom: number } | null;
  /** The floating conversation is minimised to a small pill; an approval request, a picked element or ⌘N restore it. */
  panelMin: boolean;
  previewNonce: number;
  /** Set to make the preview navigate; the Preview pane consumes it. */
  navigateRequest: { path: string; seq: number } | null;
  publish: PublishState;
  diff: DiffState;
  rules: RulesState;
  /** Time of the last commit made from Supasito; turns before it can no longer be undone. */
  committedAt: number;
  newSite: NewSiteState;
  /** Site id the "Remove from the sidebar?" dialog is asking about; null when closed. */
  removing: string | null;
  /** The "All sites" dropdown in the rail (⌘⇧O). */
  siteMenuOpen: boolean;
  toast: string | null;
  /** Plan usage is per account, not per session: the last rate_limit_event any session received, for Settings and new sessions. */
  planUsage: { windows: PlanWindow[]; at: number } | null;
  /** This build's version, for Settings → Updates. */
  version: string;
  /** A newer version the daily check or "Check now" found, until it is installed or dismissed. */
  update: UpdateInfo | null;
  /** Set while a check or an install is running, so the buttons can say which. */
  updateBusy: "checking" | "installing" | null;
  /** Download progress, 0…1, while installing; null when the size is unknown. */
  updateProgress: number | null;

  init: () => Promise<void>;
  selectSite: (id: string) => Promise<void>;
  addSiteFromFolder: () => Promise<void>;
  /** Opens (id) or closes (null) the confirmation before `removeSite`. */
  askRemoveSite: (id: string | null) => void;
  setSiteMenuOpen: (open: boolean) => void;
  favoriteSite: (id: string, on: boolean) => Promise<void>;
  removeSite: (id: string) => Promise<void>;
  /** The preview card's one button: install what the site needs, and hand over to Claude if that is not enough. */
  prepareSite: (id: string) => Promise<void>;
  createSite: (name: string) => Promise<void>;
  openNewSite: (open: boolean) => void;
  newSession: () => void;
  openSession: (id: string, forSiteId?: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  respondPermission: (sessionId: string, requestId: string, response: unknown, status: "allowed" | "denied") => Promise<void>;
  interrupt: () => Promise<void>;
  stopSession: (id: string) => Promise<void>;
  startDev: (siteId: string) => Promise<void>;
  stopDev: (siteId: string) => Promise<void>;
  restartDev: (siteId: string) => Promise<void>;
  /** Stop whatever holds the port the site's dev command needs, then start the site again. */
  freePortAndRestart: (siteId: string) => Promise<void>;
  toggleDevLog: () => void;
  refreshGit: (siteId: string) => Promise<void>;
  /** Re-detect the site (dev command, install state) and start its dev server if that made it previewable. */
  redetectSite: (siteId: string) => Promise<void>;
  /** Supasito's first task for a folder with no dev server: ask Claude to set one up. */
  setupPreview: (siteId: string) => Promise<void>;
  /** Hand a broken install or a dev server that will not start to Claude, with the output it failed on. */
  fixPreview: (siteId: string, problem: string) => Promise<void>;
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
  setPreviewFull: (on: boolean) => void;
  setPanelPos: (pos: { left: number; bottom: number } | null) => void;
  setPanelMin: (on: boolean) => void;
  reloadPreview: () => void;
  revealSite: (siteId: string) => Promise<void>;
  openSiteInEditor: (siteId: string) => Promise<void>;
  renameSite: (siteId: string, name: string) => Promise<void>;
  openRules: () => Promise<void>;
  closeRules: () => void;
  saveRules: (text: string) => Promise<void>;
  setSessionMode: (mode: string) => Promise<void>;
  /** Model, effort and fast mode for the current session ("" / null / false = back to the Settings default). */
  setSessionModel: (model: string) => Promise<void>;
  setSessionEffort: (effort: string | null) => Promise<void>;
  setSessionFast: (on: boolean) => Promise<void>;
  capturePreview: () => Promise<void>;
  /** The preview pane sets this so captures know where the iframe is. */
  previewRect: { x: number; y: number; w: number; h: number } | null;
  setPreviewRect: (r: { x: number; y: number; w: number; h: number } | null) => void;
  recheckTools: () => Promise<void>;
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
  /** Settings → Interface: the elements to hide (keys from ui.ts). Applies at once and is saved with the other settings. */
  setHidden: (keys: string[]) => Promise<void>;
  showToast: (t: string | null) => void;
  /** Ask now. `manual` also says so when there is nothing to install, which the daily check stays quiet about. */
  checkUpdate: (manual: boolean) => Promise<void>;
  /** Download, verify and restart into the version the last check found. */
  installUpdate: () => Promise<void>;
  /** "Not now": hide the banner until a later version appears. */
  dismissUpdate: () => Promise<void>;
};

let api: Backend;
let initStarted = false;
let sending = false;

const RULES_TEMPLATE = `# This site

Notes Claude reads before every change. Keep them short and true.

## Brand
- Voice: plain, confident, short sentences.
- Type: one display face for headlines, a system sans for everything else.
- Colours: keep to the tokens; no new colours without asking.

## Conventions
- One component per section. Small, direct edits.
- Do not add dependencies unless asked.
- Never start the dev server; Supasito runs it.
`;
const now = () => Date.now();
/** Explain a failed publish command from its output: most first failures are a hosting CLI that isn't signed in or installed. */
function publishFailure(cmd: string, code: number | null | undefined, log: string[]): string {
  const tool = cmd.trim().split(/\s+/)[0] ?? "";
  const text = log.join("\n");
  if (/command not found|No such file or directory|not recognized/i.test(text) && tool) return `\`${tool}\` isn't installed on this Mac. Install your host's CLI (for example \`npm install -g ${tool}\`), sign in with \`${tool} login\` in Terminal, then try again.`;
  if (/log ?in|credentials|not authenticated|unauthori[sz]ed|401|403|token/i.test(text) && tool) return `The ${tool} CLI isn't signed in. In Terminal, run \`${tool} login\` inside this site's folder, then try again.`;
  return `Publish exited with code ${code ?? "?"}. The output above says why; fix it and try again.`;
}
const isAuthFailure = (text: unknown) => typeof text === "string" && /not logged in|authentication_failed|invalid api key|please run \/login/i.test(text);

function bump(transcripts: Record<string, SessionState>, id: string): Record<string, SessionState> {
  const s = transcripts[id];
  return { ...transcripts, [id]: { ...s, items: [...s.items] } };
}

/** Control requests in flight whose rejection should fall back to restarting the process, by request id. */
const pendingControl = new Map<string, () => void>();
const waitUntil = async (cond: () => boolean, ms: number) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 100)); return cond(); };
/** Dev servers being killed, by site. The backend forgets a server as soon as its stop begins but reports `stopped`
 *  only once the process is gone, so anything that restarts the same site waits for the kill first — otherwise
 *  the old server's `stopped` event lands on the new one. A second stop while one is in flight is the same stop. */
const devStops = new Map<string, Promise<void>>();
function stopDevServer(siteId: string): Promise<void> {
  const pending = devStops.get(siteId);
  if (pending) return pending;
  const p: Promise<void> = api.devStop(siteId).catch(() => {}).finally(() => { if (devStops.get(siteId) === p) devStops.delete(siteId); });
  devStops.set(siteId, p);
  return p;
}
const siteBusy = (st: Store, siteId: string) => (st.sessions[siteId] ?? []).some((x) => st.transcripts[x.id]?.busy);
/** Bumped by every `selectSite`; a call that resumes from an await and finds a newer one bows out. Several calls for
 *  the same site can wait on one pending stop, and `currentSiteId` alone lets all of them start that site's server. */
let selectGen = 0;

/** Record a model / effort / fast-mode choice for the current session. A running, idle session gets the
 *  control request (`set_model`, `apply_flag_settings`); if the CLI rejects it, or the choice has no request
 *  form, the process is stopped so the next message resumes the session with the new flags. A draft or a
 *  stopped session just remembers the choice for its next start. */
async function changeKnob(get: () => Store, set: (p: Partial<Store>) => void, patch: SessionOverrides, live: ((id: string) => Promise<string>) | null) {
  const id = get().currentSessionId;
  if (!id) return;
  const cur = get().transcripts[id] ?? emptySession();
  if (cur.busy) { get().showToast("Wait for Claude to finish this turn, then change it."); return; }
  cur.overrides = { ...cur.overrides, ...patch };
  if (patch.model) cur.model = patch.model; // shown until the next system/init reports the exact id
  if (typeof patch.fastMode === "boolean") cur.fast = { state: patch.fastMode ? "on" : "off", reason: null };
  get().transcripts[id] = cur;
  set({ transcripts: bump(get().transcripts, id) });
  if (id === DRAFT || !get().running[id]) return; // applied when the process starts
  const restart = async () => {
    await api.agentStop(id).catch(() => {});
    if (await waitUntil(() => !get().running[id], 8000)) get().showToast("Claude Code restarts with the new setting on your next message.");
  };
  if (!live) { await restart(); return; }
  try {
    const rid = await live(id);
    pendingControl.set(rid, () => { void restart(); });
  } catch { await restart(); }
}

export const useStore = create<Store>((set, get) => ({
  ready: false,
  fatal: null,
  claude: null,
  tools: null,
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
  previewFull: false,
  capturing: false,
  panelPos: null,
  panelMin: false,
  previewNonce: 0,
  navigateRequest: null,
  previewRect: null,
  publish: { open: false, running: false, log: [], url: null, error: null, cancelled: false, target: "production", step: "" },
  diff: { open: false, loading: false, files: [], text: "", error: null },
  rules: { open: false, loading: false, saving: false, text: "", error: null },
  committedAt: 0,
  newSite: { open: false, running: false, log: [], error: null },
  removing: null,
  siteMenuOpen: false,
  toast: null,
  version: "",
  update: null,
  updateBusy: null,
  updateProgress: null,
  planUsage: null,

  async init() {
    // React StrictMode runs effects twice in dev; listeners must only be registered once.
    if (initStarted) return;
    initStarted = true;
    try {
      api = await backend();
      // The toolchain check runs `claude auth status`, `node --version` etc.; don't hold the window on it.
      const toolsP = api.toolchainCheck().then((tools) => set({ tools, claude: tools.claude })).catch((e) => get().showToast(`Could not check the tools on this Mac: ${e}`));
      const [settings, sites, running] = await Promise.all([api.settingsGet(), api.sitesList(), api.agentRunning()]);
      set({ settings, sites, running: Object.fromEntries(running.map((r) => [r.sessionId, true])) });
      void toolsP;
      void api.appVersion().then((version) => set({ version })).catch(() => {});

      // The daily check runs in the backend and announces what it found; the UI never polls.
      await api.on("update://available", (found: UpdateInfo) => set({ update: found }));
      await api.on("update://progress", ({ got, total }: { got: number; total: number | null }) => {
        set({ updateProgress: total ? Math.min(1, got / total) : null });
      });

      await api.on("agent://message", ({ sessionId, message }) => {
        const st = get();
        if (message?.type === "control_response") {
          // our own request was answered; an error came first as agent://control_error and has been handled there
          const rid = message.response?.request_id;
          if (typeof rid === "string") pendingControl.delete(rid);
        }
        const codex = backendOf(sessionId) === "codex";
        const cur = st.transcripts[sessionId] ?? { ...emptySession(), backend: codex ? "codex" : "claude" };
        const before = cur.lastWrite?.seq ?? 0;
        const changed = codex ? applyCodexMessage(cur, message) : applyMessage(cur, message);
        if (!st.transcripts[sessionId]) st.transcripts[sessionId] = cur;
        if (changed) set({ transcripts: bump(st.transcripts, sessionId) });
        if (message?.type === "rate_limit_event" || message?.method === "account/rateLimits/updated") {
          const windows = codex ? parseCodexRateLimits(message.params) : parseRateLimit(message.rate_limit_info);
          if (windows.length) set({ planUsage: { windows, at: now() } });
        }
        // Follow the page Claude is editing, for the session that is on screen.
        if (cur.lastWrite && cur.lastWrite.seq !== before && sessionId === st.currentSessionId && st.currentSiteId) {
          const site = st.sites.find((x) => x.id === st.currentSiteId);
          const route = routeForFile(cur.lastWrite.file, site?.path);
          if (route && route !== st.previewPath) set({ navigateRequest: { path: route, seq: cur.lastWrite.seq } });
        }
        if (message?.type === "result" || message?.method === "turn/completed") {
          const siteId = st.sites.find((s) => (st.sessions[s.id] ?? []).some((x) => x.id === sessionId))?.id ?? st.currentSiteId;
          if (siteId) void get().refreshGit(siteId);
          // A turn may have made the site previewable (the setup task, or an install Claude ran): look again.
          const site = siteId ? get().sites.find((s) => s.id === siteId) : undefined;
          if (site && (!site.dev || site.needsInstall)) void get().redetectSite(site.id);
          get().syncBadge();
          if (!document.hasFocus()) void api.requestAttention().catch(() => {});
          // A sign-out mid-session (token expired, `claude auth logout`) shows up as an auth error; re-check so the checklist takes over.
          if (message.is_error && isAuthFailure(message.result)) void get().recheckTools();
          if (codex && message.params?.turn?.status === "failed" && isAuthFailure(message.params.turn.error?.message)) void get().recheckTools();
        }
      });
      await api.on("agent://permission", (req: PermissionRequest) => {
        const st = get();
        const cur = st.transcripts[req.sessionId] ?? emptySession();
        addPermission(cur, req);
        st.transcripts[req.sessionId] = cur;
        set({ transcripts: bump(st.transcripts, req.sessionId) });
        // An approval card in a minimised panel would stall the turn unseen.
        if (st.previewFull && st.panelMin && req.sessionId === st.currentSessionId) set({ panelMin: false });
        get().syncBadge();
        if (!document.hasFocus()) void api.requestAttention().catch(() => {});
      });
      await api.on("agent://exit", ({ sessionId, code }) => {
        const st = get();
        const running = { ...st.running };
        delete running[sessionId];
        const cur = st.transcripts[sessionId];
        if (cur) {
          resetProcessCost(cur);
          const expired = expirePermissions(cur);
          if (cur.busy) {
            const tail = cur.stderr.slice(-3).map((l) => l.trim()).filter(Boolean).join(" · ");
            addNotice(cur, code === 0 ? "Claude ended the session." : `Claude exited unexpectedly (code ${code ?? "?"}).${tail ? ` ${tail}` : ""} Send a message to resume.`, code === 0 ? "info" : "error");
            cur.busy = false;
          }
          set({ running, transcripts: bump(st.transcripts, sessionId) });
          if (expired) get().syncBadge();
        } else set({ running });
      });
      await api.on("agent://fs", ({ sessionId, toolUseId, existed }) => {
        const st = get();
        const cur = st.transcripts[sessionId];
        if (cur && applyFs(cur, toolUseId, !!existed)) set({ transcripts: bump(st.transcripts, sessionId) });
      });
      await api.on("agent://control_error", ({ sessionId, requestId, error }) => {
        const fallback = typeof requestId === "string" ? pendingControl.get(requestId) : undefined;
        if (fallback) { pendingControl.delete(requestId); fallback(); return; }
        const cur = get().transcripts[sessionId];
        const msg = typeof error === "string" ? error : JSON.stringify(error);
        if (cur) { addNotice(cur, `Claude Code rejected a control request: ${msg}`, "error"); set({ transcripts: bump(get().transcripts, sessionId) }); }
        else get().showToast(`Claude Code rejected a control request: ${msg}`);
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
    const gen = ++selectGen;
    set({ currentSiteId: id, selection: null, picking: false, previewPath: "/", previewTitle: "", devLogOpen: false, siteMenuOpen: false, sites: get().sites.map((s) => (s.id === id ? { ...s, lastOpened: Date.now() } : s)) });
    void api.siteOpened(id).catch(() => {});
    // Stop the dev server of the site we are leaving unless one of its sessions is still working.
    if (previous && previous !== id) {
      const st = get();
      const d = st.dev[previous];
      if (!siteBusy(st, previous) && d && (d.status === "ready" || d.status === "starting")) void stopDevServer(previous);
    }
    const stopping = devStops.get(id);
    const [sessions, devInfo] = await Promise.all([api.sessionsList(id), stopping ? stopping.then(() => api.devStatus(id)) : api.devStatus(id)]);
    if (selectGen !== gen || get().currentSiteId !== id) return; // the user moved on while we were loading
    set({ sessions: { ...get().sessions, [id]: sessions } });
    if (devInfo) set({ dev: { ...get().dev, [id]: devInfo } });
    void get().refreshGit(id);
    const last = site.lastSessionId && sessions.find((s) => s.id === site.lastSessionId) ? site.lastSessionId : sessions[0]?.id;
    if (last) await get().openSession(last, id); else get().newSession();
    if (selectGen !== gen || get().currentSiteId !== id) return;
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

  askRemoveSite(id) { set({ removing: id }); },
  setSiteMenuOpen(open) { set({ siteMenuOpen: open }); },

  async favoriteSite(id, on) {
    set({ sites: get().sites.map((s) => (s.id === id ? { ...s, favorite: on } : s)) });
    try {
      const site = await api.siteFavorite(id, on);
      set({ sites: get().sites.map((s) => (s.id === id ? site : s)) });
    } catch (e) { get().showToast(String(e)); }
  },

  async removeSite(id) {
    set({ removing: null });
    const st = get();
    const ids = new Set((st.sessions[id] ?? []).map((x) => x.id));
    for (const sid of Object.keys(st.running)) if (ids.has(sid)) await api.agentStop(sid).catch(() => {});
    const transcripts = { ...st.transcripts };
    for (const sid of ids) delete transcripts[sid];
    const running = { ...st.running };
    for (const sid of ids) delete running[sid];
    set({ transcripts, running });
    get().syncBadge();
    await stopDevServer(id);
    await api.siteRemove(id);
    const sites = get().sites.filter((s) => s.id !== id);
    set({ sites });
    if (get().currentSiteId === id) {
      if (sites[0]) await get().selectSite(sites[0].id); else set({ currentSiteId: null, currentSessionId: null });
    }
  },

  async prepareSite(id) {
    set({ newSite: { ...get().newSite, running: true, log: [], error: null } });
    let site: Site;
    try {
      site = await api.siteInstall(id);
    } catch (e) {
      set({ newSite: { ...get().newSite, running: false, error: String(e) } });
      return; // the card shows what went wrong and offers Claude as the next step
    }
    set({ sites: get().sites.map((s) => (s.id === id ? site : s)), newSite: { ...get().newSite, running: false } });
    // Installing is only half the job. If the site is previewable now, show it; if the install left it
    // where it was (a manifest with nothing to install, no dev command), Claude takes it from here.
    if (site.dev && !site.needsInstall) { void get().startDev(id); return; }
    await get().setupPreview(id);
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

  async openSession(id, forSiteId) {
    const siteId = forSiteId ?? get().currentSiteId;
    if (!siteId || get().currentSiteId !== siteId) return;
    set({ currentSessionId: id, selection: null, picking: false });
    void api.siteSetLastSession(siteId, id);
    if (get().transcripts[id]?.loaded) return;
    try {
      const lines = await api.sessionTranscript(siteId, id);
      if (get().currentSiteId !== siteId) return;
      const st = get().transcripts[id] ?? emptySession();
      const apply = backendOf(id) === "codex" ? applyCodexMessage : applyMessage;
      if (st.items.length === 0) { for (const l of lines) apply(st, l); st.resumed = st.items.length > 0; }
      st.backend = backendOf(id);
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
    if (!siteId || !text.trim() || sending) return;
    sending = true;
    let sessionId = st.currentSessionId ?? DRAFT;
    const selection = st.selection;
    const attachments = st.attachments;
    set({ selection: null, attachments: [], picking: false });
    try {
      if (sessionId === DRAFT) {
        const draft = st.transcripts[DRAFT] ?? emptySession();
        const id = await api.agentStart(siteId, null, draft.overrides);
        const transcripts = { ...st.transcripts, [id]: { ...draft, loaded: true } };
        delete transcripts[DRAFT];
        const info: SessionInfo = { id, title: text.trim().slice(0, 90), lastModified: now(), createdAt: now(), messageCount: 1 };
        set({ transcripts, currentSessionId: id, sessions: { ...st.sessions, [siteId]: [info, ...(st.sessions[siteId] ?? [])] }, running: { ...st.running, [id]: true } });
        void api.siteSetLastSession(siteId, id);
        sessionId = id;
      } else if (!st.running[sessionId]) {
        await api.agentStart(siteId, sessionId, st.transcripts[sessionId]?.overrides ?? null);
        const t = get().transcripts[sessionId];
        if (t) resetProcessCost(t);
        set({ running: { ...get().running, [sessionId]: true } });
      }
      const cur = get().transcripts[sessionId] ?? emptySession();
      addUser(cur, text.trim(), selection, attachments);
      get().transcripts[sessionId] = cur;
      set({ transcripts: bump(get().transcripts, sessionId) });
      await api.agentSend(sessionId, text.trim(), selection, attachments);
      const list = (get().sessions[siteId] ?? []).map((s) => (s.id === sessionId ? { ...s, lastModified: now(), messageCount: s.messageCount + 1 } : s));
      set({ sessions: { ...get().sessions, [siteId]: list } });
    } catch (e) {
      const cur = get().transcripts[sessionId] ?? emptySession();
      addNotice(cur, String(e), "error");
      cur.busy = false;
      get().transcripts[sessionId] = cur;
      set({ transcripts: bump(get().transcripts, sessionId), selection, attachments });
    } finally {
      sending = false;
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
      const newer = get().dev[siteId];
      // a status event for this very server may have arrived before the reply; keep it
      if (!(newer && newer.port === info.port && newer.status !== "starting")) set({ dev: { ...get().dev, [siteId]: info } });
      // the user may have left the site while the server was spawning, before a switch could know to stop it
      if (get().currentSiteId !== siteId && !siteBusy(get(), siteId)) void stopDevServer(siteId);
    } catch (e) {
      set({ dev: { ...get().dev, [siteId]: { siteId, port: 0, url: "", status: "error", command: "" } }, devLogs: { ...get().devLogs, [siteId]: [String(e)] } });
    }
  },
  async stopDev(siteId) { await stopDevServer(siteId); },
  async restartDev(siteId) { await stopDevServer(siteId); set({ devLogs: { ...get().devLogs, [siteId]: [] } }); await get().startDev(siteId); },
  async freePortAndRestart(siteId) {
    try {
      const report = await api.devFreePort(siteId);
      set({ devLogs: { ...get().devLogs, [siteId]: [...(get().devLogs[siteId] ?? []), report] } });
    } catch (e) {
      get().showToast(String(e));
      return; // the status event carries the new holder when the port changed hands; the card updates itself
    }
    await get().restartDev(siteId);
  },
  toggleDevLog() { set({ devLogOpen: !get().devLogOpen }); },

  async redetectSite(siteId) {
    try {
      const fresh = await api.siteRefresh(siteId);
      set({ sites: get().sites.map((s) => (s.id === siteId ? fresh : s)) });
      const d = get().dev[siteId];
      if (fresh.dev && !fresh.needsInstall && (!d || d.status === "stopped" || d.status === "error") && get().currentSiteId === siteId) void get().startDev(siteId);
    } catch (e) { get().showToast(String(e)); }
  },
  async setupPreview(siteId) {
    if (get().currentSiteId !== siteId) return;
    startFreshSession(get);
    await get().send(SETUP_PREVIEW_PROMPT);
  },
  async fixPreview(siteId, problem) {
    if (get().currentSiteId !== siteId) return;
    const log = [...(get().newSite.error ? [get().newSite.error!] : []), ...(get().devLogs[siteId] ?? [])].slice(-30).join("\n");
    startFreshSession(get);
    await get().send(fixPreviewPrompt(problem, log));
  },
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
    if (!get().git[siteId]?.isGit) { get().showToast("Undo needs git in this folder. Initialise it from the preview pane first."); return; }
    if (item.at <= get().committedAt) { get().showToast("That turn was committed since; undo it with git instead."); return; }
    try {
      const r = await api.siteUndoFiles(siteId, item.files, item.created);
      markUndone(cur, resultId);
      set({ transcripts: bump(get().transcripts, sessionId) });
      const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
      const parts = [r.restored.length && `restored ${n(r.restored.length, "file")}`, r.deleted.length && `removed ${n(r.deleted.length, "new file")}`, r.skipped.length && `left ${n(r.skipped.length, "untracked file")} as is`].filter(Boolean);
      get().showToast(parts.length ? parts.join(", ").replace(/^./, (c) => c.toUpperCase()) : "Nothing to restore");
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
  // A picked element lands in the composer, so a minimised panel comes back for it.
  setSelection(sel) { set({ selection: sel, picking: false, ...(sel ? { panelMin: false } : {}) }); },
  setPreviewPath(path) { set({ previewPath: path.startsWith("/") ? path : "/" + path }); },
  setPreviewInfo(path, title) { set({ previewPath: path || "/", previewTitle: title }); },
  setDevice(d) { set({ device: d }); },
  // Entering full-width mode always shows the panel: a minimised one is easy to miss.
  setPreviewFull(on) { set({ previewFull: on, ...(on ? { panelMin: false } : {}) }); },
  setPanelMin(on) { set({ panelMin: on }); },
  setPanelPos(pos) { if (pos !== get().panelPos) set({ panelPos: pos }); },
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
  async renameSite(siteId, name) {
    try {
      const site = await api.siteRename(siteId, name);
      set({ sites: get().sites.map((s) => (s.id === siteId ? site : s)) });
    } catch (e) { get().showToast(String(e)); }
  },
  async openRules() {
    const siteId = get().currentSiteId;
    if (!siteId) return;
    set({ rules: { open: true, loading: true, saving: false, text: "", error: null } });
    try {
      const text = await api.siteReadText(siteId, "CLAUDE.md");
      set({ rules: { ...get().rules, loading: false, text: text || RULES_TEMPLATE } });
    } catch (e) { set({ rules: { ...get().rules, loading: false, error: String(e) } }); }
  },
  closeRules() { set({ rules: { ...get().rules, open: false } }); },
  async saveRules(text) {
    const siteId = get().currentSiteId;
    if (!siteId) return;
    set({ rules: { ...get().rules, saving: true, error: null } });
    try {
      await api.siteWriteText(siteId, "CLAUDE.md", text);
      set({ rules: { ...get().rules, open: false, saving: false, text } });
      get().showToast("Site rules saved. New sessions pick them up; a running session sees them on its next turn.");
      void get().refreshGit(siteId);
    } catch (e) { set({ rules: { ...get().rules, saving: false, error: String(e) } }); }
  },
  async setSessionMode(mode) {
    const id = get().currentSessionId;
    if (!id || id === DRAFT) return;
    const cur = get().transcripts[id];
    if (!get().running[id]) { get().showToast("Start the session first; the mode for new sessions is in Settings."); return; }
    try {
      await api.agentSetMode(id, mode);
      if (cur) { cur.mode = mode; set({ transcripts: bump(get().transcripts, id) }); }
    } catch (e) { get().showToast(String(e)); }
  },
  async setSessionModel(model) {
    // A model on the other backend cannot take over a running conversation: its history lives in the other CLI's store.
    const id = get().currentSessionId;
    if (id && id !== DRAFT && model && (isCodexModel(model) ? "codex" : "claude") !== backendOf(id)) {
      get().showToast(`This conversation runs on ${backendOf(id) === "codex" ? "Codex" : "Claude Code"}. Start a new chat to use ${modelShort(model)}.`);
      return;
    }
    await changeKnob(get, set, { model: model || null }, model ? (id) => api.agentSetModel(id, model) : null);
  },
  async setSessionEffort(effort) {
    await changeKnob(get, set, { effort: effort || null }, effort ? (id) => api.agentApplySettings(id, { effortLevel: effort }) : null);
  },
  async setSessionFast(on) {
    await changeKnob(get, set, { fastMode: on }, (id) => api.agentApplySettings(id, { fastMode: on }));
  },
  setPreviewRect(r) { set({ previewRect: r }); },
  async capturePreview() {
    const st = get();
    const rect = st.previewRect;
    const dev = st.currentSiteId ? st.dev[st.currentSiteId] : null;
    if (!rect || dev?.status !== "ready") { get().showToast("The preview must be showing before it can be captured."); return; }
    // The floating conversation would be in the picture: hide it and let two frames paint before the shot.
    const floating = st.previewFull;
    if (floating) { set({ capturing: true }); await paints(2); }
    try {
      const shot = await api.previewCapture(rect, window.devicePixelRatio || 1);
      const a: Attachment = { id: `${Date.now()}-shot`, name: `preview${st.previewPath === "/" ? "" : st.previewPath.replace(/\//g, "-")}.png`, mediaType: shot.mediaType, data: shot.data, size: shot.bytes };
      set({ attachments: [...st.attachments.filter((x) => !x.name.startsWith("preview")), a].slice(0, 6) });
    } catch (e) { get().showToast(String(e)); }
    finally { if (floating) set({ capturing: false }); }
  },
  async recheckTools() {
    try {
      const tools = await api.toolchainCheck();
      set({ tools, claude: tools.claude });
    } catch (e) { get().showToast(String(e)); }
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
    const stopIfCancelled = () => {
      if (!get().publish.cancelled) return false;
      push("Stopped before deploying.");
      set({ publish: { ...get().publish, running: false, step: "" } });
      return true;
    };
    try {
      if (opts.commit) {
        push(`$ git commit -m ${JSON.stringify(opts.message.trim() || "Update site")}`);
        const g = await api.siteGitCommit(siteId, opts.message.trim() || "Update site");
        set({ git: { ...get().git, [siteId]: g }, committedAt: Date.now() });
        push("Committed.");
        if (stopIfCancelled()) return;
      }
      if (opts.push) {
        set({ publish: { ...get().publish, step: "push" } });
        push("$ git push -u origin HEAD");
        const out = await api.siteGitPush(siteId);
        if (out) push(out);
        if (stopIfCancelled()) return;
      }
      if (stopIfCancelled()) return;
      set({ publish: { ...get().publish, step: "deploy" } });
      push(`$ ${cmd}`);
      const r = await api.publishRun(siteId, target);
      const cancelled = get().publish.cancelled;
      set({ publish: { ...get().publish, running: false, step: "", url: cancelled ? null : r.url ?? null, error: cancelled || r.ok ? null : publishFailure(cmd, r.code, get().publish.log) } });
      void get().refreshGit(siteId);
    } catch (e) {
      set({ publish: { ...get().publish, running: false, step: "", error: String(e) } });
    }
  },
  async cancelPublish() {
    const siteId = get().currentSiteId;
    if (!siteId || !get().publish.running) return;
    set({ publish: { ...get().publish, cancelled: true } });
    // commit/push finish on their own and the flow stops before deploying; a running deploy is killed
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
    const [settings, tools] = await Promise.all([api.settingsGet(), api.toolchainCheck()]);
    set({ settings, tools, claude: tools.claude });
  },
  async setHidden(keys) {
    // Hiding the log button closes the log too, or there would be no way to close it.
    set({ settings: { ...get().settings, hidden: keys }, ...(keys.includes("devLog") ? { devLogOpen: false } : {}) });
    try { await api.settingsSet({ hidden: keys }); } catch (e) { get().showToast(String(e)); }
  },
  showToast(t) { set({ toast: t }); if (t) setTimeout(() => { if (get().toast === t) set({ toast: null }); }, 5000); },
  async checkUpdate(manual) {
    if (get().updateBusy) return;
    set({ updateBusy: "checking" });
    try {
      const found = await api.updateCheck();
      set({ update: found });
      if (manual && !found) get().showToast(`Supasito ${get().version || "is"} is the newest version.`);
    } catch (e) {
      if (manual) get().showToast(`Could not check for updates: ${e}`);
    } finally {
      set({ updateBusy: null });
    }
  },
  async installUpdate() {
    if (get().updateBusy) return;
    set({ updateBusy: "installing", updateProgress: 0 });
    try {
      // On success the app restarts into the new version and this never resolves.
      await api.updateInstall();
      set({ updateBusy: null, updateProgress: null });
    } catch (e) {
      set({ updateBusy: null, updateProgress: null });
      get().showToast(`Could not install the update: ${e}`);
    }
  },
  async dismissUpdate() {
    const v = get().update?.version;
    set({ update: null });
    if (v) await api.updateDismiss(v).catch(() => {});
  },
}));

const NO_SESSIONS: SessionInfo[] = [];
const NO_LINES: string[] = [];
export const useSessionsOfCurrentSite = () => useStore((s) => (s.currentSiteId ? s.sessions[s.currentSiteId] ?? NO_SESSIONS : NO_SESSIONS));
export const useDevLogOfCurrentSite = () => useStore((s) => (s.currentSiteId ? s.devLogs[s.currentSiteId] ?? NO_LINES : NO_LINES));
export const useSite = () => useStore((s) => s.sites.find((x) => x.id === s.currentSiteId) ?? null);
export const useSession = () => useStore((s) => (s.currentSessionId ? s.transcripts[s.currentSessionId] ?? null : null));
export const useDev = () => useStore((s) => (s.currentSiteId ? s.dev[s.currentSiteId] ?? null : null));
