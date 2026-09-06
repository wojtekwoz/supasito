// Browser-only stand-in for the Rust side, so the UI can be developed and checked outside Tauri.
import type { Backend } from "./backend";
import type { DevInfo, EventName, SessionInfo, Site } from "./types";
import pickerSource from "../src-tauri/src/picker.js?raw";

type Handler = (payload: any) => void;
const handlers = new Map<EventName, Set<Handler>>();
const emit = (name: EventName, payload: any) => handlers.get(name)?.forEach((h) => h(payload));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const site: Site = {
  id: "site-demo", path: "/Users/you/Sites/clarityops", name: "ClarityOps", dev: "node_modules/.bin/next dev -p {port}",
  publish: "vercel deploy --prod --yes", preview: "vercel deploy --yes", lastSessionId: "sess-1", isGit: true, needsInstall: false, framework: "next", packageManager: "pnpm",
};
const sessions: SessionInfo[] = [
  { id: "sess-1", title: "Roll out the new elevated Card style", lastModified: Date.now() - 3600e3, messageCount: 6 },
  { id: "sess-2", title: "Update pricing FAQ for the Enterprise tier", lastModified: Date.now() - 86400e3 * 2, messageCount: 4 },
];
let dev: DevInfo = { siteId: site.id, port: 3000, url: "mock:", status: "ready", command: site.dev! };

export const demoHtml = `<!doctype html><html><head><meta charset="utf-8"><title>ClarityOps</title>
<style>body{margin:0;font:16px/1.5 Georgia,serif;color:#141414;background:#f7f6f2}header{display:flex;justify-content:space-between;padding:20px 32px;font:600 13px/1 -apple-system,system-ui}nav a{margin-left:18px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#333;text-decoration:none}.hero{text-align:center;padding:72px 24px 40px}.hero .kicker{font:600 10px/1 -apple-system;letter-spacing:.2em;text-transform:uppercase;color:#666}h1{font-size:64px;line-height:1;margin:14px 0 18px;font-weight:400}.hero p{max-width:520px;margin:0 auto 24px;font-size:18px;color:#333}.btn{display:inline-block;padding:10px 16px;background:#141414;color:#fff;font:600 11px/1 -apple-system;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;margin:0 4px}.btn.ghost{background:transparent;color:#141414;border:1px solid #141414}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px 32px 64px}.card{background:#fff;border:1px solid #e3e1da;padding:22px;min-height:160px}.card h3{margin:0 0 8px;font-weight:500}.card p{margin:0;color:#555;font-size:15px}.card.dark{background:#141414;color:#fff}.card.dark p{color:#bbb}</style></head>
<body><header><div>ClarityOps</div><nav><a href="#">Product</a><a href="#">Customers</a><a href="#">Pricing</a><a href="#">Blog</a></nav></header>
<main><section class="hero"><div class="kicker">Decision intelligence</div><h1>Decisions, made durable</h1><p>ClarityOps gives leadership teams one durable operating record for the context, commitments, owners, and risks behind every strategic decision.</p><a class="btn" href="#">See pricing</a><a class="btn ghost" href="#">How it works</a></section>
<section class="grid"><div class="card"><h3>Context intake</h3><p>Capture the why before the what.</p></div><div class="card"><h3>Ownership map</h3><p>Every decision has a name on it.</p></div><div class="card dark"><h3>Pricing expansion approved for EMEA.</h3><p>Owner: Revenue Operations · Friday 09:00</p></div></section></main>
<script>${pickerSource}</script></body></html>`;

const running = new Set<string>();
let mockPublishCancelled = false;
let mockChanged = 5;
// Context grows by a fixed amount per turn (`?context=full` starts near the top) and compacts past 170k; cost is cumulative like the CLI's.
let mockCtx = new URLSearchParams(location.search).get("context") === "full" ? 140_000 : 24_000;
let mockTurns = 0;
const mockUsage = () => ({ input_tokens: 10, cache_creation_input_tokens: 2400, cache_read_input_tokens: mockCtx, output_tokens: 80 });
let mockRules = "# This site\n\n## Brand\n- Voice: plain, confident, short sentences.\n- Type: display serif for headlines.\n";
(window as any).__openMockDoc = demoHtml;

async function fakeTurn(sessionId: string, text: string) {
  const msgId = "msg_" + Math.random().toString(36).slice(2);
  const say = async (s: string) => {
    emit("agent://message", { sessionId, message: { type: "stream_event", event: { type: "message_start", message: { id: msgId, role: "assistant", content: [] } }, parent_tool_use_id: null } });
    emit("agent://message", { sessionId, message: { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, parent_tool_use_id: null } });
    for (const word of s.split(" ")) {
      emit("agent://message", { sessionId, message: { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: word + " " } }, parent_tool_use_id: null } });
      await wait(25);
    }
    emit("agent://message", { sessionId, message: { type: "assistant", message: { id: msgId, role: "assistant", content: [{ type: "text", text: s }], usage: mockUsage() }, parent_tool_use_id: null } });
  };
  await wait(300);
  mockTurns++;
  mockCtx += 22_000;
  if (mockCtx > 170_000) {
    emit("agent://message", { sessionId, message: { type: "system", subtype: "compact_boundary", uuid: "cb" + mockTurns, compact_metadata: { trigger: "auto", pre_tokens: mockCtx, post_tokens: 12_000 } } });
    mockCtx = 12_000;
  }
  emit("agent://message", { sessionId, message: { type: "system", subtype: "init", model: "claude-sonnet-5", cwd: site.path, session_id: sessionId, tools: [], permissionMode: "acceptEdits", slash_commands: ["compact", "cost", "review", "impeccable", "web-typography", "cro-methodology"] } });
  await say("Checking the hero section first — the headline lives in components/hero.tsx.");
  const t1 = "toolu_1" + Math.random().toString(36).slice(2);
  emit("agent://message", { sessionId, message: { type: "assistant", message: { id: "m2", role: "assistant", content: [{ type: "tool_use", id: t1, name: "Read", input: { file_path: site.path + "/components/hero.tsx" } }] }, parent_tool_use_id: null } });
  await wait(500);
  emit("agent://message", { sessionId, message: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: t1, content: "export function Hero() { … }" }] }, parent_tool_use_id: null } });
  const t2 = "toolu_2" + Math.random().toString(36).slice(2);
  emit("agent://message", { sessionId, message: { type: "assistant", message: { id: "m3", role: "assistant", content: [{ type: "tool_use", id: t2, name: "Edit", input: { file_path: site.path + "/components/hero.tsx", old_string: "Decisions, made durable", new_string: text.slice(0, 40) } }] }, parent_tool_use_id: null } });
  await wait(600);
  emit("agent://message", { sessionId, message: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: t2, content: "The file has been updated." }] }, parent_tool_use_id: null } });
  emit("agent://message", { sessionId, message: { type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.82, resetsAt: Math.floor(Date.now() / 1000) + 5400 }, seven_day: { utilization: 0.31, resetsAt: Math.floor(Date.now() / 1000) + 86400 } } } } });
  if (/pricing/i.test(text)) {
    const t2b = "toolu_2b" + Math.random().toString(36).slice(2);
    emit("agent://message", { sessionId, message: { type: "assistant", message: { id: "m3b", role: "assistant", content: [{ type: "tool_use", id: t2b, name: "Edit", input: { file_path: site.path + "/app/pricing/page.tsx", old_string: "Plans", new_string: "Pricing" } }] }, parent_tool_use_id: null } });
    await wait(400);
    emit("agent://message", { sessionId, message: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: t2b, content: "The file has been updated." }] }, parent_tool_use_id: null } });
  }
  const reqId = "req_" + Math.random().toString(36).slice(2);
  emit("agent://permission", { sessionId, requestId: reqId, request: { subtype: "can_use_tool", tool_name: "Bash", display_name: "Bash", input: { command: "pnpm exec tsc --noEmit", description: "Type-check the project" }, description: "Type-check the project", permission_suggestions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "pnpm exec tsc:*" }], behavior: "allow", destination: "localSettings" }], tool_use_id: "toolu_3" } });
}

export function mockBackend(): Backend {
  return {
    settingsGet: async () => ({ model: null, permissionMode: "acceptEdits" }),
    settingsSet: async () => {},
    // `?tools=missing|nologin|nonode|nogit` simulates a Mac that lacks something, for checking the checklist.
    toolchainCheck: async () => {
      const sim = new URLSearchParams(location.search).get("tools");
      const claude = sim === "missing" ? { ok: false } : { ok: true, path: "/opt/homebrew/bin/claude", version: "2.1.257", loggedIn: sim !== "nologin", authMethod: sim === "nologin" ? "none" : "claude.ai" };
      const node = sim === "missing" || sim === "nonode" ? { ok: false } : { ok: true, path: "/opt/homebrew/bin/node", version: "24.4.0" };
      const git = sim === "missing" || sim === "nogit" ? { ok: false, path: "/usr/bin/git" } : { ok: true, path: "/opt/homebrew/bin/git", version: "2.51.0" };
      const packageManager = node.ok ? (sim === "nonode" ? null : { ok: true, name: sim === "nopnpm" ? "npm" : "pnpm", path: "/opt/homebrew/bin/pnpm", version: "10.33.0" }) : null;
      return { claude, node, git, packageManager };
    },
    sitesList: async () => (new URLSearchParams(location.search).get("sites") === "none" ? [] : [site]),
    sitePickFolder: async () => "/Users/you/Sites/another",
    siteAdd: async (path) => ({ ...site, id: "site-" + Math.random().toString(36).slice(2), path, name: path.split("/").pop() || "site", lastSessionId: null }),
    siteRemove: async () => {},
    siteRefresh: async () => site,
    siteInstall: async () => site,
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
    siteRename: async (_siteId, name) => { site.name = name; return { ...site }; },
    agentSetMode: async (_sessionId, mode) => { console.debug("[mode]", mode); },
    requestAttention: async () => { console.debug("[attention]"); },
    siteGitInit: async () => {},
    siteUndoFiles: async (_siteId, files, created) => ({ restored: files.filter((f) => !created.includes(f)).map((f) => f.replace(site.path + "/", "")), deleted: created.map((f) => f.replace(site.path + "/", "")), skipped: [] }),
    previewEvent: async (kind, detail) => { console.debug("[preview]", kind, detail); },
    siteSetLastSession: async () => {},
    siteNew: async (parent, name) => ({ ...site, id: "site-new", path: parent + "/" + name, name, lastSessionId: null }),
    devStart: async () => { dev = { ...dev, status: "ready" }; emit("dev://status", dev); return dev; },
    devStop: async () => { dev = { ...dev, status: "stopped" }; emit("dev://status", dev); },
    devStatus: async () => dev,
    devLog: async () => ["▲ Next.js 16.3.4", "- Local: http://localhost:3000", "✓ Ready in 1.2s"],
    publishRun: async (siteId, target) => {
      mockPublishCancelled = false;
      const url = target === "preview" ? "https://your-site-git-main-you.vercel.app" : "https://your-site.vercel.app";
      for (const l of ["Vercel CLI 59", "Uploading [====] 1.2MB", "Building…", `${target === "preview" ? "Preview" : "Production"}: ${url}`]) { await wait(900); if (mockPublishCancelled) return { ok: false, code: null, url: null, log: [] }; emit("publish://log", { siteId, line: l }); }
      return { ok: true, code: 0, url, log: [] };
    },
    publishCancel: async () => { mockPublishCancelled = true; },
    agentStart: async (_siteId, resume) => { const id = resume ?? "sess-" + Math.random().toString(36).slice(2); running.add(id); return id; },
    agentSend: async (sessionId, text) => { void fakeTurn(sessionId, text); },
    siteSetPublish: async (_siteId, command, key) => ({ ...site, [key]: command || null }),
    agentRespond: async (sessionId, _requestId, response: any) => {
      await wait(200);
      const denied = response?.behavior === "deny";
      emit("agent://message", { sessionId, message: { type: "assistant", message: { id: "m4", role: "assistant", content: [{ type: "tool_use", id: "toolu_3", name: "Bash", input: { command: "pnpm exec tsc --noEmit", description: "Type-check the project" } }] }, parent_tool_use_id: null } });
      emit("agent://message", { sessionId, message: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_3", content: denied ? "User denied this action" : "", is_error: denied }] }, parent_tool_use_id: null } });
      await wait(200);
      emit("agent://message", { sessionId, message: { type: "assistant", message: { id: "m5", role: "assistant", content: [{ type: "text", text: "Done. The headline in `components/hero.tsx` now reads as you asked; the preview has reloaded." }], usage: mockUsage() }, parent_tool_use_id: null } });
      const total = +(0.031 * mockTurns).toFixed(4);
      emit("agent://message", { sessionId, message: { type: "result", subtype: "success", is_error: false, duration_ms: 6120, num_turns: 3, total_cost_usd: total, modelUsage: { "claude-sonnet-5": { costUSD: total, contextWindow: 200000 } }, session_id: sessionId, result: "Done." } });
    },
    agentInterrupt: async () => {},
    agentStop: async (sessionId) => { running.delete(sessionId); emit("agent://exit", { sessionId, code: 0 }); },
    agentRunning: async () => [...running].map((sessionId) => ({ sessionId, siteId: site.id })),
    sessionsList: async () => sessions,
    sessionTranscript: async (_siteId, sessionId) => [
      { type: "user", message: { role: "user", content: sessions.find((s) => s.id === sessionId)?.title ?? "Hello" } },
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
