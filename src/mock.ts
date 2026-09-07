// Browser-only stand-in for the Rust side, so the UI can be developed and checked outside Tauri.
import type { Backend } from "./backend";
import type { DevInfo, DevProblem, EventName, SessionInfo, Settings, Site } from "./types";
import pickerSource from "../src-tauri/src/picker.js?raw";

type Handler = (payload: any) => void;
const handlers = new Map<EventName, Set<Handler>>();
const emit = (name: EventName, payload: any) => handlers.get(name)?.forEach((h) => h(payload));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const site: Site = {
  id: "site-demo", path: "/Users/you/Sites/clarityops", name: "ClarityOps", dev: "node_modules/.bin/next dev -p {port}",
  publish: "vercel deploy --prod --yes", preview: "vercel deploy --yes", lastSessionId: "sess-1", isGit: true, needsInstall: false, framework: "next", packageManager: "pnpm",
};
const query = new URLSearchParams(location.search);
// `?sites=none` starts with no site, `?sites=two` with a second one, for checking site switching.
const mockSites: Site[] = query.get("sites") === "none" ? [] : query.get("sites") === "two"
  ? [site, { ...site, id: "site-2", path: "/Users/you/Sites/second", name: "Second", lastSessionId: null }]
  : [site];
const siteOf = (id: string) => mockSites.find((s) => s.id === id) ?? site;
const sessions: Record<string, SessionInfo[]> = {
  [site.id]: [
    { id: "sess-1", title: "Roll out the new elevated Card style", lastModified: Date.now() - 3600e3, messageCount: 6 },
    { id: "sess-2", title: "Update pricing FAQ for the Enterprise tier", lastModified: Date.now() - 86400e3 * 2, messageCount: 4 },
  ],
  "site-2": [{ id: "sess-second-1", title: "Draft the About page", lastModified: Date.now() - 7200e3, messageCount: 2 }],
};
// Per-site dev servers, shaped like the Rust registry: `?devDelay=<ms>` is how long a start takes to become ready
// (a stale start never reports ready, like the real one), `?stopDelay=<ms>` how long the kill takes — while it is
// in flight the entry is gone for `devStatus` (Registry::stop removes it before killing) and `stopped` is emitted at the end.
const devs = new Map<string, DevInfo>();
const devStarts = new Map<string, number>();
const devStartCalls = new Map<string, number>(); // `devStart` invocations per site, for counting from the console
const devStopping = new Set<string>();
const devDelay = Number(query.get("devDelay")) || 0;
const stopDelay = Number(query.get("stopDelay")) || 0;
// `?dev=taken` — the first site's port is held by another program (`taken:unknown`: by something lsof can't name,
// `taken:site`: by the second site's server, with `?sites=two`); the start fails with a port problem until
// `devFreePort` clears it, like the Rust side after killing the holder.
const devTaken = query.get("dev")?.startsWith("taken") ? (query.get("dev")!.split(":")[1] ?? "known") : null;
let portBlocked = devTaken !== null;
if (mockSites[0] && !portBlocked) devs.set(site.id, { siteId: site.id, port: 3000, url: "mock:", status: "ready", command: site.dev! });
(window as any).__mock = { devs, devStartCalls };
const mockHolder = (): DevProblem["holder"] =>
  devTaken === "unknown" ? null
  : devTaken === "site" && mockSites[1] ? { pid: 4242, pgid: 4242, name: "node", command: "node_modules/.bin/next dev -p 3000", cwd: mockSites[1].path, siteId: mockSites[1].id }
  : { pid: 4242, pgid: 4242, name: "next-server (v16.3.3)", command: "next-server (v16.3.3)", cwd: "/Users/you/Sites/other-site" };

export const demoHtml = `<!doctype html><html><head><meta charset="utf-8"><title>ClarityOps</title>
<style>body{margin:0;font:16px/1.5 Georgia,serif;color:#141414;background:#f7f6f2}header{display:flex;justify-content:space-between;padding:20px 32px;font:600 13px/1 -apple-system,system-ui}nav a{margin-left:18px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#333;text-decoration:none}.hero{text-align:center;padding:72px 24px 40px}.hero .kicker{font:600 10px/1 -apple-system;letter-spacing:.2em;text-transform:uppercase;color:#666}h1{font-size:64px;line-height:1;margin:14px 0 18px;font-weight:400}.hero p{max-width:520px;margin:0 auto 24px;font-size:18px;color:#333}.btn{display:inline-block;padding:10px 16px;background:#141414;color:#fff;font:600 11px/1 -apple-system;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;margin:0 4px}.btn.ghost{background:transparent;color:#141414;border:1px solid #141414}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px 32px 64px}.card{background:#fff;border:1px solid #e3e1da;padding:22px;min-height:160px}.card h3{margin:0 0 8px;font-weight:500}.card p{margin:0;color:#555;font-size:15px}.card.dark{background:#141414;color:#fff}.card.dark p{color:#bbb}</style></head>
<body><header><div>ClarityOps</div><nav><a href="#">Product</a><a href="#">Customers</a><a href="#">Pricing</a><a href="#">Blog</a></nav></header>
<main><section class="hero"><div class="kicker">Decision intelligence</div><h1>Decisions, made durable</h1><p>ClarityOps gives leadership teams one durable operating record for the context, commitments, owners, and risks behind every strategic decision.</p><a class="btn" href="#">See pricing</a><a class="btn ghost" href="#">How it works</a></section>
<section class="grid"><div class="card"><h3>Context intake</h3><p>Capture the why before the what.</p></div><div class="card"><h3>Ownership map</h3><p>Every decision has a name on it.</p></div><div class="card dark"><h3>Pricing expansion approved for EMEA.</h3><p>Owner: Revenue Operations · Friday 09:00</p></div></section></main>
<script>${pickerSource}</script></body></html>`;

// session id → site id, like the Rust side's running map
const running = new Map<string, string>();
let mockPublishCancelled = false;
let mockChanged = 5;
// Context grows by a fixed amount per turn (`?context=full` starts near the top) and compacts past 170k; cost is cumulative like the CLI's.
let mockCtx = new URLSearchParams(location.search).get("context") === "full" ? 140_000 : 24_000;
let mockTurns = 0;
const mockUsage = () => ({ input_tokens: 10, cache_creation_input_tokens: 2400, cache_read_input_tokens: mockCtx, output_tokens: 80 });
let mockRules = "# This site\n\n## Brand\n- Voice: plain, confident, short sentences.\n- Type: display serif for headlines.\n";
// `?fast=on` starts on Opus with fast mode on; the session-header knobs and Settings change these like the real backend would.
let mockFast = new URLSearchParams(location.search).get("fast") === "on";
let mockModel = mockFast ? "claude-opus-5" : "claude-sonnet-5";
const mockSettings: Settings = { claudePath: null, model: null, permissionMode: "acceptEdits", effort: null, fastMode: mockFast, hidden: [] };
const THINKING = "The user wants a different headline. The hero lives in components/hero.tsx; I'll read it, replace the h1 text and keep the classes as they are.";
(window as any).__openMockDoc = demoHtml;

async function fakeTurn(sessionId: string, text: string) {
  const msgId = "msg_" + Math.random().toString(36).slice(2);
  const say = async (s: string, thinking?: string) => {
    emit("agent://message", { sessionId, message: { type: "stream_event", event: { type: "message_start", message: { id: msgId, role: "assistant", model: mockModel, content: [] } }, parent_tool_use_id: null } });
    if (thinking) {
      // the shape recorded from 2.1.257 with showThinkingSummaries: a thinking block, then the assistant message for it, then the text block
      emit("agent://message", { sessionId, message: { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }, parent_tool_use_id: null } });
      for (const word of thinking.split(" ")) {
        emit("agent://message", { sessionId, message: { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: word + " " } }, parent_tool_use_id: null } });
        await wait(40);
      }
      emit("agent://message", { sessionId, message: { type: "assistant", message: { id: msgId, model: mockModel, role: "assistant", content: [{ type: "thinking", thinking, signature: "x" }], stop_reason: null, usage: mockUsage() }, parent_tool_use_id: null } });
      await wait(300);
    }
    emit("agent://message", { sessionId, message: { type: "stream_event", event: { type: "content_block_start", index: thinking ? 1 : 0, content_block: { type: "text", text: "" } }, parent_tool_use_id: null } });
    for (const word of s.split(" ")) {
      emit("agent://message", { sessionId, message: { type: "stream_event", event: { type: "content_block_delta", index: thinking ? 1 : 0, delta: { type: "text_delta", text: word + " " } }, parent_tool_use_id: null } });
      await wait(25);
    }
    emit("agent://message", { sessionId, message: { type: "assistant", message: { id: msgId, model: mockModel, role: "assistant", content: [{ type: "text", text: s }], usage: mockUsage() }, parent_tool_use_id: null } });
  };
  await wait(300);
  const path = siteOf(running.get(sessionId) ?? site.id).path;
  mockTurns++;
  mockCtx += 22_000;
  if (mockCtx > 170_000) {
    emit("agent://message", { sessionId, message: { type: "system", subtype: "compact_boundary", uuid: "cb" + mockTurns, compact_metadata: { trigger: "auto", pre_tokens: mockCtx, post_tokens: 12_000 } } });
    mockCtx = 12_000;
  }
  const fastOn = mockFast && /opus/.test(mockModel);
  emit("agent://message", { sessionId, message: { type: "system", subtype: "init", model: mockModel, cwd: path, session_id: sessionId, tools: [], permissionMode: "acceptEdits", slash_commands: ["compact", "cost", "review", "impeccable", "web-typography", "cro-methodology"], fast_mode_state: fastOn ? "on" : "off", ...(fastOn ? {} : { fast_mode_disabled_reason: mockFast ? "model_not_supported" : "sdk_opt_in_required" }) } });
  await say("Checking the hero section first — the headline lives in components/hero.tsx.", THINKING);
  const t1 = "toolu_1" + Math.random().toString(36).slice(2);
  emit("agent://message", { sessionId, message: { type: "assistant", message: { id: "m2", role: "assistant", content: [{ type: "tool_use", id: t1, name: "Read", input: { file_path: path + "/components/hero.tsx" } }] }, parent_tool_use_id: null } });
  await wait(500);
  emit("agent://message", { sessionId, message: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: t1, content: "export function Hero() { … }" }] }, parent_tool_use_id: null } });
  const t2 = "toolu_2" + Math.random().toString(36).slice(2);
  emit("agent://message", { sessionId, message: { type: "assistant", message: { id: "m3", role: "assistant", content: [{ type: "tool_use", id: t2, name: "Edit", input: { file_path: path + "/components/hero.tsx", old_string: "Decisions, made durable", new_string: text.slice(0, 40) } }] }, parent_tool_use_id: null } });
  await wait(600);
  emit("agent://message", { sessionId, message: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: t2, content: "The file has been updated." }] }, parent_tool_use_id: null } });
  emit("agent://message", { sessionId, message: { type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.82, resetsAt: Math.floor(Date.now() / 1000) + 5400 }, seven_day: { utilization: 0.31, resetsAt: Math.floor(Date.now() / 1000) + 86400 } } } } });
  if (/pricing/i.test(text)) {
    const t2b = "toolu_2b" + Math.random().toString(36).slice(2);
    emit("agent://message", { sessionId, message: { type: "assistant", message: { id: "m3b", role: "assistant", content: [{ type: "tool_use", id: t2b, name: "Edit", input: { file_path: path + "/app/pricing/page.tsx", old_string: "Plans", new_string: "Pricing" } }] }, parent_tool_use_id: null } });
    await wait(400);
    emit("agent://message", { sessionId, message: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: t2b, content: "The file has been updated." }] }, parent_tool_use_id: null } });
  }
  const reqId = "req_" + Math.random().toString(36).slice(2);
  emit("agent://permission", { sessionId, requestId: reqId, request: { subtype: "can_use_tool", tool_name: "Bash", display_name: "Bash", input: { command: "pnpm exec tsc --noEmit", description: "Type-check the project" }, description: "Type-check the project", permission_suggestions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "pnpm exec tsc:*" }], behavior: "allow", destination: "localSettings" }], tool_use_id: "toolu_3" } });
}

export function mockBackend(): Backend {
  return {
    settingsGet: async () => ({ ...mockSettings }),
    settingsSet: async (patch) => { Object.assign(mockSettings, patch); },
    // `?tools=missing|nologin|nonode|nogit` simulates a Mac that lacks something, for checking the checklist.
    toolchainCheck: async () => {
      const sim = new URLSearchParams(location.search).get("tools");
      const claude = sim === "missing" ? { ok: false } : { ok: true, path: "/opt/homebrew/bin/claude", version: "2.1.257", loggedIn: sim !== "nologin", authMethod: sim === "nologin" ? "none" : "claude.ai", defaults: { model: "claude-fable-5-1[1m]", effort: "high" } };
      const node = sim === "missing" || sim === "nonode" ? { ok: false } : { ok: true, path: "/opt/homebrew/bin/node", version: "24.4.0" };
      const git = sim === "missing" || sim === "nogit" ? { ok: false, path: "/usr/bin/git" } : { ok: true, path: "/opt/homebrew/bin/git", version: "2.51.0" };
      const packageManager = node.ok ? (sim === "nonode" ? null : { ok: true, name: sim === "nopnpm" ? "npm" : "pnpm", path: "/opt/homebrew/bin/pnpm", version: "10.33.0" }) : null;
      return { claude, node, git, packageManager };
    },
    sitesList: async () => [...mockSites],
    sitePickFolder: async () => "/Users/you/Sites/another",
    siteAdd: async (path) => { const s = { ...site, id: "site-" + Math.random().toString(36).slice(2), path, name: path.split("/").pop() || "site", lastSessionId: null }; mockSites.push(s); return s; },
    siteRemove: async () => {},
    siteRefresh: async (siteId) => siteOf(siteId),
    siteInstall: async (siteId) => siteOf(siteId),
    siteGitStatus: async () => ({ isGit: true, changed: mockChanged, files: ["components/hero.tsx", "app/page.tsx"], branch: "main", remote: "git@github.com:you/clarityops.git" }),
    siteGitCommit: async (_siteId, message) => { await wait(400); console.debug("[commit]", message); mockChanged = 0; return { isGit: true, changed: 0, files: [], branch: "main", remote: "git@github.com:you/clarityops.git" }; },
    siteGitPush: async () => { await wait(600); return "To github.com:you/clarityops.git\n   1a2b3c4..5d6e7f8  main -> main"; },
    siteGitDiff: async (_siteId, files) => files.map((f) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -12,7 +12,7 @@ export function Hero() {\n       <p className="text-[11px] font-semibold uppercase">Decision intelligence</p>\n-      <h1 className="mx-auto mt-4 max-w-3xl font-display text-6xl">Decisions, made durable</h1>\n+      <h1 className="mx-auto mt-4 max-w-3xl font-display text-6xl">Decisions, made durable, together</h1>\n       <p className="mx-auto mt-6 max-w-xl text-lg">ClarityOps gives leadership teams one durable operating record.</p>`).join("\n"),
    setBadge: async (count) => { console.debug("[badge]", count); },
    previewCapture: async (rect) => {
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(rect.w)); c.height = Math.max(1, Math.round(rect.h));
      const g = c.getContext("2d")!; g.fillStyle = "#f7f6f2"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "#141414"; g.font = "48px Georgia"; g.fillText("Decisions, made durable", 40, 120);
      const data = c.toDataURL("image/png").split(",")[1];
      return { mediaType: "image/png", data, bytes: data.length };
    },
    siteOpenEditor: async () => "code",
    siteReadText: async (_siteId, rel) => (rel === "CLAUDE.md" ? mockRules : ""),
    siteWriteText: async (_siteId, rel, content) => { if (rel === "CLAUDE.md") mockRules = content; },
    siteRename: async (siteId, name) => { const s = siteOf(siteId); s.name = name; return { ...s }; },
    agentSetMode: async (_sessionId, mode) => { console.debug("[mode]", mode); },
    agentSetModel: async (_sessionId, model) => { console.debug("[set_model]", model); mockModel = model; return "req-model"; },
    agentApplySettings: async (_sessionId, settings) => { console.debug("[apply_flag_settings]", settings); if (typeof settings.fastMode === "boolean") mockFast = settings.fastMode; return "req-settings"; },
    requestAttention: async () => { console.debug("[attention]"); },
    siteGitInit: async () => {},
    siteUndoFiles: async (_siteId, files, created) => ({ restored: files.filter((f) => !created.includes(f)).map((f) => f.replace(site.path + "/", "")), deleted: created.map((f) => f.replace(site.path + "/", "")), skipped: [] }),
    previewEvent: async (kind, detail) => { console.debug("[preview]", kind, detail); },
    siteSetLastSession: async () => {},
    siteNew: async (parent, name) => { const s = { ...site, id: "site-new", path: parent + "/" + name, name, lastSessionId: null }; mockSites.push(s); return s; },
    devStart: async (siteId) => {
      devStartCalls.set(siteId, (devStartCalls.get(siteId) ?? 0) + 1);
      const cur = devs.get(siteId);
      if (cur && !devStopping.has(siteId) && (cur.status === "ready" || cur.status === "starting")) return cur;
      const token = (devStarts.get(siteId) ?? 0) + 1;
      devStarts.set(siteId, token);
      // one port per site, reused on restart like `last_port`
      const info: DevInfo = { siteId, port: 3000 + Math.max(0, mockSites.findIndex((s) => s.id === siteId)), url: "mock:", status: "starting", command: siteOf(siteId).dev ?? "" };
      devs.set(siteId, info);
      emit("dev://status", info);
      void wait(devDelay).then(() => {
        if (devStarts.get(siteId) !== token || devs.get(siteId) !== info) return;
        if (portBlocked && siteId === mockSites[0]?.id) {
          emit("dev://log", { siteId, line: "⨯ Failed to start server" });
          emit("dev://log", { siteId, line: `Error: listen EADDRINUSE: address already in use :::${info.port}` });
          emit("dev://log", { siteId, line: `Port ${info.port} is taken by ${mockHolder()?.name ?? "something"}, and this dev command uses that port.` });
          const failed: DevInfo = { ...info, status: "error", problem: { kind: "port", port: info.port, holder: mockHolder() } };
          devs.set(siteId, failed);
          emit("dev://status", failed);
          return;
        }
        const ready = { ...info, status: "ready" as const };
        devs.set(siteId, ready);
        emit("dev://status", ready);
      });
      return info;
    },
    devFreePort: async (siteId) => {
      const cur = devs.get(siteId);
      if (cur?.problem?.kind !== "port") throw new Error("Nothing is blocking this site's port.");
      await wait(300);
      portBlocked = false;
      const h = cur.problem.holder;
      if (h?.siteId) { const other = devs.get(h.siteId); if (other) { const stopped = { ...other, status: "stopped" as const }; devs.set(h.siteId, stopped); emit("dev://status", stopped); } return "Stopped the other site's dev server."; }
      return h ? `Stopped ${h.name} (pid ${h.pid}).` : `Port ${cur.problem.port} is free now.`;
    },
    devStop: async (siteId) => {
      const cur = devs.get(siteId);
      if (!cur || cur.status === "stopped" || devStopping.has(siteId)) return;
      devStopping.add(siteId);
      devStarts.set(siteId, (devStarts.get(siteId) ?? 0) + 1); // a start in flight never reports ready
      await wait(stopDelay);
      devStopping.delete(siteId);
      const stopped = { ...cur, status: "stopped" as const };
      if (devs.get(siteId) === cur) devs.set(siteId, stopped);
      emit("dev://status", stopped); // the old server's event fires even when a newer start replaced it, like the Rust side
    },
    devStatus: async (siteId) => (devStopping.has(siteId) ? null : devs.get(siteId) ?? null),
    devLog: async () => ["▲ Next.js 16.3.4", "- Local: http://localhost:3000", "✓ Ready in 1.2s"],
    publishRun: async (siteId, target) => {
      mockPublishCancelled = false;
      const url = target === "preview" ? "https://your-site-git-main-you.vercel.app" : "https://your-site.vercel.app";
      for (const l of ["Vercel CLI 59", "Uploading [====] 1.2MB", "Building…", `${target === "preview" ? "Preview" : "Production"}: ${url}`]) { await wait(900); if (mockPublishCancelled) return { ok: false, code: null, url: null, log: [] }; emit("publish://log", { siteId, line: l }); }
      return { ok: true, code: 0, url, log: [] };
    },
    publishCancel: async () => { mockPublishCancelled = true; },
    agentStart: async (siteId, resume, overrides) => {
      const id = resume ?? "sess-" + Math.random().toString(36).slice(2);
      running.set(id, siteId);
      // like the Rust side: the session's own choice, else the saved default
      mockModel = overrides?.model || mockSettings.model || mockModel;
      mockFast = overrides?.fastMode ?? !!mockSettings.fastMode;
      return id;
    },
    agentSend: async (sessionId, text) => { void fakeTurn(sessionId, text); },
    siteSetPublish: async (siteId, command, key) => ({ ...siteOf(siteId), [key]: command || null }),
    agentRespond: async (sessionId, _requestId, response: any) => {
      await wait(200);
      const denied = response?.behavior === "deny";
      emit("agent://message", { sessionId, message: { type: "assistant", message: { id: "m4", role: "assistant", content: [{ type: "tool_use", id: "toolu_3", name: "Bash", input: { command: "pnpm exec tsc --noEmit", description: "Type-check the project" } }] }, parent_tool_use_id: null } });
      emit("agent://message", { sessionId, message: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_3", content: denied ? "User denied this action" : "", is_error: denied }] }, parent_tool_use_id: null } });
      await wait(200);
      emit("agent://message", { sessionId, message: { type: "assistant", message: { id: "m5", role: "assistant", content: [{ type: "text", text: "Done. The headline in `components/hero.tsx` now reads as you asked; the preview has reloaded." }], usage: mockUsage() }, parent_tool_use_id: null } });
      const total = +(0.031 * mockTurns).toFixed(4);
      const fastOn = mockFast && /opus/.test(mockModel);
      emit("agent://message", { sessionId, message: { type: "result", subtype: "success", is_error: false, duration_ms: 6120, num_turns: 3, total_cost_usd: total, modelUsage: { [mockModel]: { costUSD: total, contextWindow: 200000 } }, usage: { speed: fastOn ? "fast" : "standard" }, fast_mode_state: fastOn ? "on" : "off", session_id: sessionId, result: "Done." } });
    },
    agentInterrupt: async () => {},
    agentStop: async (sessionId) => { running.delete(sessionId); emit("agent://exit", { sessionId, code: 0 }); },
    agentRunning: async () => [...running].map(([sessionId, siteId]) => ({ sessionId, siteId })),
    sessionsList: async (siteId) => sessions[siteId] ?? [],
    sessionTranscript: async (siteId, sessionId) => [
      { type: "user", message: { role: "user", content: (sessions[siteId] ?? []).find((s) => s.id === sessionId)?.title ?? "Hello" } },
      { type: "assistant", message: { id: "old1", role: "assistant", content: [{ type: "text", text: "Home is done. Pricing next — its plan tiers extend the same Card base, so they inherit the new style." }], usage: { input_tokens: 12, cache_creation_input_tokens: 1200, cache_read_input_tokens: 61000, output_tokens: 60 } } },
    ],
    openExternal: async (url) => { window.open(url, "_blank"); },
    revealPath: async (path) => { console.debug("[reveal]", path); },
    on: async (event, handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
  };
}
