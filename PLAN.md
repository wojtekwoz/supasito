# Open — plan (v2, 2026-09-05)

*Open is a macOS desktop app that builds websites with the Claude Code you already have. This document is the current state and the next steps; the session-by-session history is in CHANGELOG.md, and agent-facing conventions are in CLAUDE.md.*

---

## 1. One paragraph

Three panes: your sites, a conversation with Claude Code, and a live preview of the site. You describe a change, or click the element you mean in the preview, Claude edits the code, the preview hot-reloads, you approve anything risky, and you press Publish. The site is an ordinary code repository; the agent is the `claude` binary on your machine; history is git. Open owns nothing except the loop between you, the agent and the browser.

## 2. The thesis: subtraction

HF0's Dave Fontenot: *"our whole thesis at HF0 is all about subtraction, not addition"*; *"the most dangerous distraction is the second most important thing in your business."* Applied here:

1. **One artifact: the code.** No proprietary site format, no abstraction layer. (Webflow Source reached the same conclusion: "code is the native language of AI".)
2. **One agent runtime: yours.** Open ships no model, no key flow, no agent loop. Your subscription, skills, MCP servers, memory and `CLAUDE.md` all apply.
3. **One loop: say → change → see → approve → publish.** Every feature must shorten it. The cut list from Webflow Source (Inbox, Workflows, Agents, CMS, Brand, Campaigns, custom views, multiplayer, analytics) stays cut.
4. **Nothing to learn.** Describe a change and click the thing you mean.
5. **Nothing to host.** Sites are folders. Sessions live in `~/.claude/projects`. History is git. App state is one JSON file.

## 3. Decisions (still true)

- **D1 Tauri 2.11 + React 19**, not Electron: 11 MB binary, native WebView, the preview needs a browser engine anyway.
- **D2 Drive the user's `claude` binary over stream-json** from Rust; no Node sidecar, no Agent SDK. Verified on Claude Code 2.1.257: `-p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio`; approvals arrive as `control_request{can_use_tool}`; `interrupt` and `set_permission_mode` control requests work mid-session; queued user messages run in order. The protocol lives in one file (`src-tauri/src/agent/claude.rs`); the UI only sees `agent://*` events.
- **D3 Preview is an iframe of the site's dev server**; the element picker is a script Tauri injects into every frame, posting selections to the parent. Works under the release CSP and `tauri://localhost`. Screenshots for Claude come from WKWebView's own snapshot, no Screen Recording permission.
- **D4 Next.js 16 starter by default; any dev-server project works** (Next, Astro, Vite, SvelteKit, Nuxt detected). Next stamps no source locations, so selections carry the React component chain (`Hero < Page`, including Server Components), text, classes and selector; Claude finds the file. Astro gets exact file:line for free.
- **D5 Git is the history.** Pending count = `git status`. Undo restores tracked files and removes only files the turn created. Publish can commit and push first. Turns before the last commit lose Undo.
- **D6 Publish is one command per target** in `open.json`: `publish` (production) and `preview` (a shareable deployment). Inferred for Vercel, Netlify, Cloudflare; editable with presets.
- **D7 One JSON file of app state**; transcripts are Claude's own JSONL, re-rendered on resume.
- **D8 Trust follows the user's action.** Opening a folder marks it trusted in `~/.claude.json` so its `.claude/settings.json` rules apply; its `dev` and `publish` commands run as given. Same trust model as running `claude` there.
- **D9 macOS first.** Platform-specific code (snapshot, Dock badge, attention) sits behind `#[cfg(target_os)]`.

## 4. Architecture

```
src/                     React UI (vanilla CSS, zustand)
  app/store.ts           all state and actions; window.__store in dev
  app/Session.tsx        transcript rows (memoised, immutable items), composer, approvals
  app/Preview.tsx        iframe, device widths, picker messaging, follow-the-page
  app/Dialogs.tsx        publish (targets, commit, push, cancel), diff, site rules, settings, new site
  agent/transcript.ts    stream-json → transcript items (tests: agent/transcript.test.ts + fixtures/)
  routes.ts              edited file → page route (tests: routes.test.ts)
  mock.ts                browser-only backend for UI work (`pnpm dev` → http://localhost:1420)
src-tauri/src/
  lib.rs                 Tauri commands (sites, dev server, agent, git, publish, capture, badge)
  agent/claude.rs        spawn claude, NDJSON reader/writer, control protocol, orphan reaping
  agent/sessions.rs      read ~/.claude/projects/<encoded cwd>/*.jsonl
  devserver.rs           dev-server supervisor (dual-stack readiness, port announcement, orphan reaping)
  sites.rs               detection (package.json, lockfile, host), open.json, git status/commit/push/diff/restore
  capture.rs             WKWebView snapshot of the preview rect
  picker.js              injected into every frame: hover/click selection, React owner chain
  smoke.rs               debug-only real-CLI scenarios (prompt|queue|interrupt|pointing|mode, capture)
starters/next/           bundled "New site" (Next 16 + Tailwind 4 + CLAUDE.md + permission allowlist)
```

Per-site config `open.json`: `{ "name", "dev" ("{port}" placeholder), "publish", "preview" }`.

## 5. Run, test, ship

```bash
pnpm install
pnpm tauri dev                 # app with hot reload (Rust edits relaunch it; orphans are reaped)
pnpm dev                       # UI only, mock backend, for browser-driven checks
pnpm test                      # transcript reducer, route mapping, cargo test
cd src-tauri && cargo test -- --ignored   # + creates a real site from the starter
OPEN_SMOKE_SCENARIO=queue OPEN_SMOKE_SITE_PATH=/path OPEN_SMOKE_MODEL=haiku OPEN_SMOKE_PROMPT=x pnpm tauri dev
pnpm release [--install]       # Open.app (optionally into /Applications)
```

## 6. What's built (all verified; see CHANGELOG.md for how)

**Say.** Composer with Enter to send, queue while Claude works, Escape to stop, paste/drop images, a screenshot of the preview (camera), slash-command autocomplete from the session's skills, ⌘⇧E picker, ⌘N new session, ⌘, settings.

**Point.** Element picker in the preview: tag, plain class, text, selector, computed styles, HTML, React component chain or Astro file:line. Preview follows the page Claude edits. Device widths, path bar, reload, open in browser.

**See.** Streaming transcript with tool steps ("Editing components/hero.tsx"), expandable step output, per-turn completion line with duration, cost, "N files changed" (opens a diff), Undo. Plan-usage chip from the CLI's rate-limit events. Model chip. Permission mode per session.

**Approve.** Approval cards (Allow, Always allow, Deny with reason), clarifying-question cards, Dock badge with pending approvals, Dock bounce when Claude needs you or finishes in the background. Approvals expire when a turn ends.

**Publish.** Preview vs production targets, confirmation with changed-file count, optional commit (prefilled message) and push to origin, cancel that really stops, log and URL. Publish commands editable with presets.

**Sites.** Open a folder, New site from the starter, rename, site rules (`CLAUDE.md`) editor, reveal in Finder, open in editor, dev-server status and log, install when `node_modules` is missing, git init offer, one dev server at a time. Sessions listed from Claude's store, resumable, capped list with "Show older".

**Robustness.** Dual-stack readiness (Vite/Astro bind `[::1]`), announced-port override, orphan reaping for dev servers and claude processes, stderr tail in exit notices, error boundaries per pane, setup card when Claude Code is missing.

## 7. Known gaps (honest)

- Only used seriously on one machine with two real sites (Astro, Next) plus scratch projects. SvelteKit, Nuxt, plain Vite and monorepos were reasoned about, not used.
- The release app has been launched by a script, never used day to day. Dev mode is what has been tested.
- Not signed or notarized: anyone else gets Gatekeeper's "damaged" dialog.
- New site requires pnpm; a machine with only npm can't create one. The setup card covers a missing Claude Code, not a missing Node.
- Failure paths (not logged in, rate limit, offline) have notices in the code but no human has seen them.
- Session listing re-reads JSONL heads on every site switch (fine below a few hundred sessions).
- Last review round's fixes were verified in the mock and by smoke tests, not yet by a person.

## 8. Next milestone — v0.2 "usable by someone who isn't you"

1. **Live on the release app for a week.** `pnpm release --install`, quit `tauri dev`, use Open.app for real work. Log every papercut. Acceptance: a list of things that bit, or the honest absence of one.
2. **First-run checks that name what's missing.** Node, pnpm or npm, git, Claude Code (and its login) with one line each on how to get it. Acceptance: a fresh macOS user account reaches a working preview following only the app's own text.
3. **npm fallback for New site.** Use pnpm if present, else npm; keep the starter lockfile-free. Acceptance: New site works on a machine without pnpm.
4. **Signed and notarized build.** Apple Developer ID in the Tauri bundle config, `notarytool`, a `pnpm release` that produces a distributable DMG. Acceptance: a second Mac opens the DMG with no warnings.
5. **Failure-path pass.** Deliberately hit: not logged in, rate-limited, offline, dev server crash, publish auth failure. Acceptance: each shows a notice that says what happened and what to do.
6. **Exercise the review fixes by hand.** Undo with untracked files present, cancel during commit/push, a dev script that never opens a port, fast site switching. Acceptance: matches the CHANGELOG description.

Then decide from use whether anything else deserves building. Default answer: no.

## 9. Backlog (deferred on purpose)

- Windows build (WebView2 mixed-content policy, all-frames script, process groups; no Dock APIs).
- Second agent backend behind the same `agent://` events.
- Session-list caching by file mtime.
- Auto-update.

## 10. Sources

Webflow Source: https://webflow.com/source · HF0 / Dave Fontenot: https://tv.nyse.com/videos/hf0-ceo-dave-fontenot-on-a-unique-approach-to-vcs · Claude Code headless and control protocol: https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/agent-sdk/user-input · Tauri 2: https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html
