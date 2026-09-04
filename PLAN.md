# Open — build plan

*Working name: **Open** (after this folder). A desktop app for building websites with your own local coding agent. Written 2026-09-03 (starter switched from Astro to Next.js on request) after a research pass on Webflow Source (announced 2026-09-02), the HF0 "subtraction" thesis, Tauri 2.11, and the Claude Code stream-json control protocol (verified against the installed CLI, v2.1.257).*

---

## 1. One paragraph

Open is a small Mac app with three panes: your sites, a conversation with an agent, and a live preview of the site. You describe a change (optionally clicking the element you mean in the preview), Claude Code edits the site's code, the preview updates, you approve anything risky, and you press Publish. The site is an ordinary code repository; the agent is the Claude Code you already have installed and logged into. Open owns nothing except the loop between you, the agent, and the browser.

## 2. The thesis: subtraction

HF0's Dave Fontenot: *"our whole thesis at HF0 is all about subtraction, not addition"*; *"the most dangerous distraction is the second most important thing in your business"*; *"recursive subtraction leads to breakthrough realizations"*; and the residency's prompt to founders, *"What could you build if you had nothing in your way?"*

Applied to this product, subtraction means deciding what the one most important thing is and cutting everything that is merely the second most important thing:

1. **One artifact: the code.** No proprietary site format, no abstraction layer, no export step. Webflow reached the same conclusion for Source ("Code is the native language of AI… agents can work directly with the code that actually ships instead of an abstraction layer"). We start there instead of migrating there.
2. **One agent runtime: yours.** Open does not ship a model, an API key flow, or its own agent loop. It drives the `claude` binary already on the machine. Your subscription, skills, MCP servers, memory, CLAUDE.md, and permission rules all come along for free.
3. **One loop: say → change → see → approve → publish.** Every screen element exists to make that loop shorter. Anything that doesn't is cut.
4. **Nothing to learn.** If you can describe a change and click the thing you mean, you can use Open. No designer canvas, no class panel, no CMS schema.
5. **Nothing to host.** Local-first. Sites are folders. Sessions live where Claude Code already keeps them (`~/.claude/projects/…`). Change history is git. App state is one JSON file.

The corollary: features are added only when the loop proves it needs them, never because Webflow has them.

## 3. What Webflow Source is, and what we cut

Source (limited research preview, applications at webflow.com/source) is "a platform for modern marketing teams and agents": code-first (agents get direct code access), governed workspaces with role-specific **Views** (Site, CMS, Assets, Brand, Campaigns…), an **Inbox** where background agents propose AEO/CRO work, comments that become agent tasks, custom agent builders, approval paths and audit trails, and connectors to existing codebases, CMS, martech and hosting (partners cite Next.js and Astro). The screenshot the user shared shows the actual layout: left rail (workspace, Home/Inbox/Projects/Workflows/Agents, Views, Projects, Sessions), a middle agent transcript with step rows and page cards, and a right-hand browser preview with URL bar, device toggles and an element picker.

| Source concept | Open v1 | Why |
|---|---|---|
| Three-pane layout (rail · session · preview) | **Keep** | It is the loop, made visible. |
| Sessions per project | **Keep** (they are Claude Code sessions, resumable) | Free, durable, already on disk. |
| Element picker in the preview | **Keep** | Pointing beats describing. |
| Publish with pending-change count | **Keep** (count = `git status`) | Git is the change log. |
| Agent step cards ("Updating Pricing · 4 cards restyled") | **Keep** (rendered from tool calls) | Shows work without showing code. |
| Approval before risky actions | **Keep** (Claude's own permission prompts, surfaced in the UI) | Governance without a governance product. |
| Home, Inbox, Workflows, Agents, Campaigns | **Cut** | Second-most-important things. |
| CMS, Assets, Brand views | **Cut** → a `CLAUDE.md` + tokens file in the repo | The agent reads brand rules from the repo; nothing to sync. |
| Custom agents / custom views | **Cut** → Claude Code skills & subagents in `.claude/` | Already exists, already better. |
| Background agents proposing work | **Cut** | v1 is human-initiated. |
| Accounts, multiplayer, roles, audit trail | **Cut** → git log | Single user, local machine. |
| Comments → tasks | **Cut** | The composer with an attached element *is* the comment. |
| Connectors (martech, hosting) | **Cut** → one configurable publish command | `vercel`, `wrangler`, `netlify`, or `git push` — the user already has a CLI. |

## 4. Product

**The loop.** Open a site → (dev server starts, preview appears) → type "make the hero headline two lines and darker", or click the headline first → the agent works; step rows appear ("Reading src/pages/index.astro", "Editing hero") → the preview hot-reloads → if the agent needs to run something outside the allowlist, an approval card appears (Allow · Allow always · Deny with reason) → Publish (n files changed) → a URL.

**Three panes.**
- *Rail (left, narrow):* Sites; the current site's sessions (title, relative time); New session; Add site (open a folder / new from template). Nothing else.
- *Session (middle):* transcript. User messages with an optional element chip. Assistant text as markdown. Tool calls collapsed into step rows grouped per turn; expandable to see the diff or command output. Approval cards. Question cards (AskUserQuestion). Composer: "Tell Open what to change…", Enter to send, Escape to stop, an attach-element toggle, and a model/permission-mode indicator.
- *Preview (right):* path bar (`/`, `/pricing`), desktop/tablet/phone widths, pick-element toggle, reload, open in browser, dev-server status. Publish lives in the window's top-right with the pending-change count.

**First run.** Detects `claude` (`which claude`, or a path in settings); if missing, shows install instructions and stops. No sign-in of its own.

**New site.** Two paths: open an existing folder with a dev script; or "New site" which copies a bundled starter (Next.js 16 + Tailwind 4 + a `CLAUDE.md` describing tone, tokens, and conventions, plus `.claude/settings.json` allowlisting `pnpm typecheck` and `pnpm build`) and immediately starts a session with the user's one-line brief.

## 5. Decisions (ADRs, short)

**D1 — Tauri 2.11 (Rust core, WKWebView UI), not Electron and not a pure-Rust GUI.** The preview must be a real browser engine anyway, so the UI shell might as well be web tech too. Tauri gives a ~5–10 MB app and 20–80 MB idle memory versus 85+ MB / 100–300 MB for Electron. A pure-Rust GUI (iced/egui/Dioxus-native) would still need an embedded webview for the preview and would make the transcript UI slower to build. Onlook's reason for choosing Electron (consistent custom frame across OSes) doesn't apply: macOS first, and the preview is an iframe, not a custom-drawn frame. Frontend: React 19 + TypeScript + Vite, vanilla CSS with tokens, no UI kit.

**D2 — Drive the user's `claude` binary directly from Rust over stream-json; no Node sidecar, no Agent SDK.** The official TypeScript SDK (0.3.258) bundles its own ~200 MB native CLI per platform, requires Node at runtime, and would duplicate the login the user already has. The CLI's stream-json control protocol is exactly what the SDK itself speaks. Verified on 2.1.257 (see §6). Risk: the protocol is semi-internal and can drift. Mitigations: feature-detect via `system/init.capabilities`, pin a minimum CLI version in the UI, and keep a fallback that runs without approvals (`--permission-mode acceptEdits` + allowlist) if `control_request` ever stops appearing. The bridge is behind an `AgentBackend` trait so Codex CLI or others can be added later without touching the UI.

**D3 — Preview is an `<iframe>` to the site's dev server; element picking via a Tauri all-frames initialization script.** Tauri's `initialization_script_for_all_frames` (WebviewWindowBuilder, 2.11) runs a script in every frame, including the cross-origin localhost iframe, before the page's own scripts. The script is guarded by `location.hostname` and the port Open assigned, adds a hover highlight and a click handler, and `postMessage`s a selection (tag, id, classes, text, CSS selector, bounding box, a few computed styles, trimmed outerHTML, and — when present — Astro's `data-astro-source-file` / `data-astro-source-loc`) to the parent. No proxy, no framework plugin, no multi-webview (still unstable in Tauri). Mixed content: dev builds run the UI on `http://localhost:1420`; production uses `tauri://localhost`, which on macOS allows http subresources (Tauri's docs note that the https scheme would *not*, and that this differs from `tauri://localhost` behaviour) — so `useHttpsScheme` stays false and the CSP gets `frame-src http://localhost:* http://127.0.0.1:*`. Windows/Linux revisit this later.

**D4 — Next.js is the default starter; any dev-server project is supported.** The starter is Next.js 16 (App Router) + Tailwind 4 + TypeScript, one component per section, tokens in `globals.css`, a `CLAUDE.md` with brand rules, and `.claude/settings.json` allowlisting typecheck/build. Next's dev server does not stamp elements with their source file the way Astro's does, so the picker adds React hints read from the dev fiber tree: the component chain (e.g. `Hero < Page`) and, when React exposes a JSX stack, a best-effort file:line. The selection still carries text, selector, classes and trimmed HTML, and the agent greps for the rest; in a one-component-per-section site that resolves unambiguously. Astro, Vite, SvelteKit and Nuxt projects work the same way (Astro additionally gets exact source mapping for free).

**D5 — Git is the audit trail and the undo.** After each agent turn Open runs `git status --porcelain` (badge count) and `git diff --stat` (turn summary). "Undo this turn" is a `git checkout` of the files the turn touched. If the folder isn't a repo, Open offers `git init` on first open.

**D6 — Publish is a command, not an integration.** `open.json` in the site folder: `{ "dev": "pnpm dev", "publish": "vercel deploy --prod --yes" }`. Open runs it, streams the log, and extracts the URL. Defaults are inferred from `package.json` and the presence of `vercel.json` / `wrangler.*` / `netlify.toml`.

**D7 — One JSON file of app state.** `~/Library/Application Support/co.wozu.open/state.json`: sites (path, name, last session id, last port), window layout, the `claude` path. Transcripts are *not* duplicated; resumed sessions are re-rendered from Claude's own `~/.claude/projects/<encoded-cwd>/<session>.jsonl`.

## 6. Agent bridge (verified protocol)

Spawn, cwd = site folder:

```
claude -p \
  --input-format stream-json --output-format stream-json --verbose \
  --include-partial-messages \
  --permission-prompt-tool stdio \
  --permission-mode acceptEdits \
  --append-system-prompt "<Open context: preview URL, how selections are attached, don't start dev servers, run astro check after edits>" \
  [--resume <session-id>] [--model <alias>]
```

Empirical results on 2.1.257 (probe with `--model haiku`, prompt asking for a Write):
- With `--permission-prompt-tool stdio` the CLI emits `{"type":"control_request","request_id":…,"request":{"subtype":"can_use_tool","tool_name":"Write","display_name":"Write","input":{…},"description":"probe.txt","permission_suggestions":[{"type":"setMode","mode":"acceptEdits","destination":"session"}],"tool_use_id":"toolu_…"}}` and blocks until a `control_response` arrives. Without the flag no request is emitted and the tool is silently denied.
- Response shapes: allow `{"type":"control_response","response":{"subtype":"success","request_id":"…","response":{"behavior":"allow","updatedInput":{…},"updatedPermissions":[…optional]}}}`; deny `{"…":{"behavior":"deny","message":"…"}}`.
- Other stdout types seen: `system` (subtypes incl. `init`, `status`, `api_retry`…), `assistant` (`message.content[]` blocks: text/thinking/tool_use), `user` (tool_result blocks), `stream_event` (token deltas when `--include-partial-messages`), `rate_limit_event`, `result` (`session_id`, `total_cost_usd`, `usage`, `permission_denials`, `duration_api_ms`).
- Input: `{"type":"user","message":{"role":"user","content":"…" | [{"type":"text",…},{"type":"image",…}]}}` per line; keep stdin open for the life of the session. Interrupt: `{"type":"control_request","request_id":…,"request":{"subtype":"interrupt"}}`. On app quit send SIGINT, wait, then SIGTERM.
- `AskUserQuestion` arrives as `can_use_tool` with `tool_name:"AskUserQuestion"`; answer by allowing with `updatedInput:{questions, answers}`.
- Session list for a site: read `~/.claude/projects/<cwd with / → ->/*.jsonl`, take the first `user` line's text as title (or `customTitle`), mtime as last activity. Same data `claude --resume` uses.

Rust shape: `agent/mod.rs` (trait `AgentBackend`), `agent/claude.rs` (spawn, NDJSON reader task, writer channel, pending control-request map), Tauri commands `session_start`, `session_send`, `session_respond_permission`, `session_interrupt`, `session_stop`, events `agent://message`, `agent://permission`, `agent://exit`.

## 7. Data model

```
Site      { id, path, name, dev: Option<String>, publish: Option<String>, lastSessionId?, lastPort? }
Session   { id (Claude session_id), siteId, title, startedAt, lastActiveAt, cwd }
Turn      { userMessage, selection?, steps: Step[], assistantText, result? }
Step      { toolUseId, tool, label, input, output?, isError?, startedAt, endedAt }
Selection { url, selector, tag, id?, classes[], text, rect, styles{…}, outerHtml, source?: {file, loc} }
Permission{ requestId, toolName, displayName, input, description, suggestions[] }
DevServer { siteId, port, pid, status: starting|ready|error|stopped, log[] }
```

## 8. Repo layout

```
open/
  PLAN.md
  package.json                 # pnpm, scripts: dev, build, tauri
  src/                         # React UI
    app/                       # shell, panes, routing-free state (zustand)
    agent/                     # event → transcript reducer, message types
    preview/                   # iframe, device widths, selection chip
    ui/                        # tokens.css, primitives
    mock/                      # browser-only mock backend for UI work
  src-tauri/
    src/main.rs, lib.rs
    src/agent/{mod.rs,claude.rs,sessions.rs}
    src/devserver.rs           # spawn dev script, pick port, readiness probe
    src/publish.rs
    src/sites.rs, state.rs
    src/picker.js              # all-frames initialization script (embedded)
    capabilities/default.json
    tauri.conf.json
  starters/next/               # bundled "New site" template (Next.js 16 + Tailwind 4 + CLAUDE.md)
```

## 9. Milestones

**M0 — the loop works (this session).** Tauri app boots; add a site folder; dev server starts on a free port and the preview shows it; a session streams from Claude Code with markdown text and step rows; approvals round-trip; sessions list and resume. Acceptance: change the headline of the bundled starter from the chat and see it update.

**M1 — pointing.** Element picker via all-frames init script; selection chip in the composer; React component hints (Astro source mapping when present); device widths; open-in-browser; "New site" from the starter.

**M2 — shipping.** Publish command with log and URL; per-turn diff summary and undo; pending-change badge; app settings (claude path, default model, permission mode).

**M3 — polish and breadth.** Multiple concurrent sessions per site (one dev server); interrupt/queue messages; images in messages (drag a screenshot in); Windows build (check WebView2 mixed-content policy); optional second backend (Codex CLI).

## 10. Non-goals for v1

Accounts, cloud, sync, multiplayer, CMS, asset library, brand manager, inbox/notifications, background or scheduled agents, custom agent builder, custom views, analytics/AEO/CRO, comments-as-tasks, mobile, a visual drag-and-drop canvas, a code editor (open the folder in your editor instead).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Control protocol drift across Claude Code releases | Feature-detect on `system/init`; minimum-version check; degrade to acceptEdits+allowlist; protocol isolated in one Rust module. |
| WKWebView blocks http iframe or all-frames script in a production build | Test a release build in M0; fallback is a tiny Rust reverse proxy that injects the picker. |
| Dev-server port collisions / slow readiness | Bind-test a free port, pass `--port`/`PORT`, poll until 200, show the log while waiting. |
| Agent runs a dev server itself or long Bash tasks | System prompt says not to; Bash outside the allowlist requires approval; `claude -p` kills background shells at exit. |
| Next.js has no built-in source stamping | Picker sends React component chain + text/selector/classes; agent greps. Optional SWC/webpack plugin (`data-loc`) later if it proves necessary. |
| Cost visibility for API-key users | Show `total_cost_usd` from `result`; subscription users see turns and time. |

## 12. Sources

- Source by Webflow: https://webflow.com/source · press release https://www.globenewswire.com/news-release/2026/09/02/3355326/0/en/webflow-unveils-agentic-platform-source-by-webflow.html · CMSWire https://www.cmswire.com/digital-experience/webflow-launches-source-agentic-workspace-for-marketers/ · Yahoo/Forbes https://ca.news.yahoo.com/webflow-goes-ai-pilled-marketing-150121984.html
- HF0 / Dave Fontenot: https://tv.nyse.com/videos/hf0-ceo-dave-fontenot-on-a-unique-approach-to-vcs · https://howiinvestpodcast.com/episodes/zMfSQJxWOjy · https://xraise.ai/blog/meet-dave-fontenot-architect-of-the-monastery-of-code-founders-guide/ · https://www.readtheprofile.com/p/the-profile-the-monastery-for-startup
- Claude Code: headless/stream-json https://code.claude.com/docs/en/headless · approvals https://code.claude.com/docs/en/agent-sdk/user-input · streaming input https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode · TS SDK https://code.claude.com/docs/en/agent-sdk/typescript · local probe of CLI 2.1.257 (this machine)
- Tauri: sidecars https://v2.tauri.app/develop/sidecar/ · versions https://tauri.app/release/tauri/all-versions/ · WebviewWindowBuilder https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html · WindowConfig.use_https_scheme https://docs.rs/tauri-utils/latest/tauri_utils/config/struct.WindowConfig.html · multiwebview status https://v2.tauri.app/blog/tauri-20/
- Comparisons: Tauri vs Electron 2026 https://www.pkgpulse.com/guides/electron-vs-tauri-2026 · Onlook architecture https://news.ycombinator.com/item?id=44127653 · Conductor https://www.conductor.build/

---

## Status (2026-09-03, end of first session)

Built and verified:
- Tauri app scaffolded, Rust core compiles, frontend type-checks, release bundle builds (`Open.app`, 10 MB binary, starter bundled as a resource).
- **End-to-end smoke test passed inside the real app** (`OPEN_SMOKE_PROMPT=… pnpm tauri dev`): dev server for a Next.js site started on a free port and became ready; a Claude Code session ran through the Rust bridge (Read → Edit → "Done. The hero headline is now 'Hello from Open'"); `git status` reported the change; clean shutdown.
- UI verified in the browser against the mock backend: rail, sessions, streaming transcript, tool step rows, element picker (click → chip in composer with tag/text), Enter to send, approval card with Allow / Always allow / Deny.
- Sites opened in Open are marked trusted in `~/.claude.json` so their `.claude/settings.json` allowlists apply (Claude Code ignores project permissions in untrusted folders).

Not yet verified by hand: the production build running as a real app (CSP + `tauri://localhost` iframe of `http://localhost:*`), the New-site dialog end to end, Publish against a real Vercel project.

Next: M1 leftovers (device widths and open-in-browser are built but untested in the app), M2 (undo a turn, publish log polish), then M3.

Fixed after first hands-on test (2026-09-03, later): Astro/Vite dev servers bind only the IPv6 loopback on macOS, so readiness now probes both `127.0.0.1` and `::1`, the free-port check is dual-stack, and the URL the server prints ("Local: http://localhost:4322") overrides the requested port if a framework moved. `tauri dev` relaunches the app on Rust changes without running shutdown hooks, which orphaned dev servers; Open now records their pids in `dev-pids.json` and reaps them on the next launch.

### Session 2 (2026-09-03, afternoon)
- **Undo a turn (M2):** the completion line now lists how many files the turn wrote and offers Undo, which restores tracked files with git and deletes files the turn created. Verified in the mock UI; the git logic has a unit test.
- **Picker verified on a live Next.js 16 page:** tag, classes, text, selector, computed styles and trimmed HTML come through; React Server Component owners (which have no client fiber) are now read from React 19's component-info objects so the component chain (`Hero`) is included. No file:line from Next, as expected.
- **Production build verified as a real app:** launched `Open.app` with an isolated home; the iframe loaded an Astro site on port 4322 under the release CSP and `tauri://localhost`, and the injected picker reported ready. D3 holds.
- **New-site path tested:** `create_from_starter` copies the starter, installs, inits git and commits (integration test, run with `cargo test -- --ignored`). Unit tests cover site detection, git restore, port parsing and session-dir encoding.
- Diagnostics: the app prints `[preview] …` lines to stderr when launched from a terminal, so preview loading can be checked without screenshots.

Still untested by hand: Publish against a real deploy target (needs your account), the New-site dialog UI itself (the Rust path behind it is tested).

### Session 3 (2026-09-03, evening)
Publish confirmed against Vercel by the user. Built next:
- **Images in messages (M3):** paste or drop PNG/JPEG/GIF/WebP into the composer; sent as base64 image blocks alongside the text and selection. Tauri's own drag-drop handler is disabled so the webview gets normal HTML5 drops. Thumbnails in the composer and in the user message; images in saved transcripts render too.
- **Queue while busy (M3):** the composer stays open during a turn; Enter queues (Claude Code processes queued input after the current turn) and the message shows a dashed "Queued" state until its turn starts. Stop stays available.
- **Publish command editor:** the Publish dialog now sets the command (presets: Vercel, Cloudflare, Netlify, git push) and writes it to `open.json`; "Change command" from the result view.
- **Exit notices** include the last stderr lines from Claude Code (e.g. not logged in).
- **App icon:** a bracket-and-lines mark in the accent gradient; source in `src-tauri/icons/icon.svg`, set generated with `tauri icon`.

Remaining from the plan: Windows build (unverified platform), optional second agent backend. Both deferred on purpose.

### Session 4 (2026-09-03, later)
Verified against the real Claude Code (2.1.257, haiku) with new smoke scenarios (`OPEN_SMOKE_SCENARIO=queue|interrupt|pointing`):
- **Queue:** a second message sent mid-turn is processed after the first; results arrived in order (ONE, then TWO).
- **Interrupt:** the Stop button's `interrupt` control request ends the turn with `result{subtype:"error_during_execution", is_error:true}`; the process stays alive and the next message works. The UI now shows such a turn as "Stopped" (muted) instead of a red error, and other error subtypes get plain-language text.
- **Pointing:** a message with an attached selection (the starter's `h1`, component chain `Hero < Page`, no file:line) made Claude read `app/page.tsx`, open `components/hero.tsx` and change only that headline. The selection block format works as designed without source stamping.
- ⌘⇧E toggles the element picker; shortcuts are listed in the README.

### Session 5 (2026-09-03)
- **The preview follows the page being edited:** an Edit/Write of a page file maps to its route (Next app and pages routers, Astro, SvelteKit, Nuxt; route groups and parallel routes stripped, dynamic segments skipped) and the preview navigates there. 19-case check in `src/routes.test.ts`, run by `pnpm test`.
- **Plan usage chip** from `rate_limit_event` (highest window utilisation, colour-coded from 75% and 90%, reset time in the tooltip).
- **Setup card** replaces the banner when Claude Code isn't found: install link, sign-in step, "Check again", "Set the path manually".
- **Reveal in Finder** on each site row; **error boundaries** around the three panes so a render error shows a retry card instead of a blank window.
- Mock preview reports `/` instead of `srcdoc` as its path.

### Session 6 (2026-09-03, user testing)
From the first hands-on round: pointing worked on a real site. Fixed: the user bubble lost its accent left border and the selection chip no longer wraps (it prefers a short plain class name, or none, and truncates); Publish now confirms first (command + changed-file count) and a running publish can be cancelled (the command runs in its own process group; `publish_cancel` stops it); Settings has a model dropdown (default / Sonnet / Opus / Haiku / custom). Also added: claude processes are recorded in `agent-pids.json` and reaped on the next launch, like dev servers, so an app relaunch during a turn leaves nothing running.

### Session 7 (2026-09-04)
- **Preview and production publish targets.** `open.json` gains `preview` next to `publish`; both are inferred per host (Vercel `vercel deploy --yes` vs `--prod`, Netlify `netlify deploy` vs `--prod`, Cloudflare `wrangler versions upload` vs `deploy`) and editable in the Publish dialog. The dialog is a two-card choice with the command shown under each.
- **Commit and push on publish.** Optional steps in the same dialog: commit all pending changes (message prefilled from the last request) and push to `origin` when a remote exists. Git identity missing → a plain-language error with the exact commands. Answers "does it back up to GitHub?": only when you tick push; nothing is pushed silently.
- **Diff per turn:** "N files changed" opens a unified diff (working tree vs HEAD, untracked files shown as additions, capped at 800 lines).
- **Dock badge and attention:** badge = pending approvals across sessions; the Dock bounces on a new approval request or a finished turn while the window is unfocused. No notification plugin.
- ⌘N new session, ⌘, settings.

### Session 8 (2026-09-04)
- **Transcript reducer tests** against a recorded Claude Code 2.1.257 stream (`src/agent/fixtures/`), plus streaming, interrupt, queue, files-touched and saved-transcript cases. `pnpm test` runs them with the route check and the Rust suite; test files are excluded from the app's type-check.
- **Show Claude the preview:** camera button → `preview_capture` asks WKWebView for a snapshot of the iframe's rect (`takeSnapshotWithConfiguration:` via objc2 + block2, width capped at 1600 px); the PNG is attached to the composer like a pasted image. Cross-origin iframe content is included and no Screen Recording permission is needed (a first attempt with `screencapture` needed that permission and was dropped). macOS only.
- **Release script** (`pnpm release [--install]`) so daily use doesn't depend on `tauri dev`.
- Rail: session list capped at 12 with "Show older"; "Open in your code editor" (code, cursor, zed, windsurf on PATH; Finder otherwise).

### Session 9 (2026-09-04)
- **Transcript performance:** items are now replaced, never mutated, and rows (`Entry`, `Steps`) are memoised, so a streamed token re-renders one row instead of the whole transcript.
- **Idle dev servers stop** when you switch sites, unless a session on that site is still working.
- **Undo is gated by commit time:** turns from before the last commit made in Open lose their Undo (git is the right tool from there).
- `CLAUDE.md` added for agents working on this repo: the one rule, how to run and test, where the sharp edges are.
