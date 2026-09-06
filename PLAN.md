# Supasito — plan (v2, 2026-09-05)

*Supasito is a macOS desktop app that builds websites with the Claude Code you already have. This document is the current state and the next steps; the session-by-session history is in CHANGELOG.md, and agent-facing conventions are in CLAUDE.md.*

---

## 1. One paragraph

Three panes: your sites, a conversation with Claude Code, and a live preview of the site. You describe a change, or click the element you mean in the preview, Claude edits the code, the preview hot-reloads, you approve anything risky, and you press Publish. The site is an ordinary code repository; the agent is the `claude` binary on your machine; history is git. Supasito owns nothing except the loop between you, the agent and the browser.

## 2. The thesis: subtraction

HF0's Dave Fontenot: *"our whole thesis at HF0 is all about subtraction, not addition"*; *"the most dangerous distraction is the second most important thing in your business."* Applied here:

1. **One artifact: the code.** No proprietary site format, no abstraction layer. (Webflow Source reached the same conclusion: "code is the native language of AI".)
2. **One agent runtime: yours.** Supasito ships no model, no key flow, no agent loop. Your subscription, skills, MCP servers, memory and `CLAUDE.md` all apply.
3. **One loop: say → change → see → approve → publish.** Every feature must shorten it. The cut list from Webflow Source (Inbox, Workflows, Agents, CMS, Brand, Campaigns, custom views, multiplayer, analytics) stays cut.
4. **Nothing to learn.** Describe a change and click the thing you mean.
5. **Nothing to host.** Sites are folders. Sessions live in `~/.claude/projects`. History is git. App state is one JSON file.

## 3. Decisions (still true)

- **D1 Tauri 2.11 + React 19**, not Electron: 11 MB binary, native WebView, the preview needs a browser engine anyway.
- **D2 Drive the user's `claude` binary over stream-json** from Rust; no Node sidecar, no Agent SDK. Verified on Claude Code 2.1.257: `-p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio`; approvals arrive as `control_request{can_use_tool}`; `interrupt` and `set_permission_mode` control requests work mid-session; queued user messages run in order. The protocol lives in one file (`src-tauri/src/agent/claude.rs`); the UI only sees `agent://*` events.
- **D3 Preview is an iframe of the site's dev server**; the element picker is a script Tauri injects into every frame, posting selections to the parent. Works under the release CSP and `tauri://localhost`. Screenshots for Claude come from WKWebView's own snapshot, no Screen Recording permission.
- **D4 Next.js 16 starter by default; any dev-server project works** (Next, Astro, Vite, SvelteKit, Nuxt detected). Next stamps no source locations, so selections carry the React component chain (`Hero < Page`, including Server Components), text, classes and selector; Claude finds the file. Astro gets exact file:line for free.
- **D5 Git is the history.** Pending count = `git status`. Undo restores tracked files and removes only files the turn created. Publish can commit and push first. Turns before the last commit lose Undo. A site may be one folder of a larger git repository; status, commit and undo are scoped to that folder.
- **D6 Publish is one command per target** in `supasito.json`: `publish` (production) and `preview` (a shareable deployment). Inferred for Vercel, Netlify, Cloudflare; editable with presets.
- **D7 One JSON file of app state**; transcripts are Claude's own JSONL, re-rendered on resume.
- **D8 Trust follows the user's action.** Opening a folder marks it trusted in `~/.claude.json` so its `.claude/settings.json` rules apply; its `dev` and `publish` commands run as given. Same trust model as running `claude` there.
- **D9 macOS first.** Platform-specific code (snapshot, Dock badge, attention) sits behind `#[cfg(target_os)]`.
- **D10 Usage is two numbers in two places.** Context fullness belongs to the session, so it sits by the composer: a ring that fills as the conversation grows (the last API call's prompt size against the model's window from `modelUsage`), details on click. Plan usage belongs to the account, so it sits in Settings and in the same popover; the ring is the only indicator: its colour is the worse of context and plan, and a plan window past 75% is named next to it (the earlier header chip duplicated it and went). Cost is the CLI's cumulative `total_cost_usd`, shown per turn on the completion line and in total in the popover.

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
  sites.rs               detection (package.json, lockfile, host), supasito.json, git status/commit/push/diff/restore
  capture.rs             WKWebView snapshot of the preview rect
  picker.js              injected into every frame: hover/click selection, React owner chain
  smoke.rs               debug-only real-CLI scenarios (prompt|queue|interrupt|pointing|mode|model|fast|undo|tools, capture)
starters/next/           bundled "New site" (Next 16 + Tailwind 4 + CLAUDE.md + permission allowlist)
```

Per-site config `supasito.json`: `{ "name", "dev" ("{port}" placeholder), "publish", "preview" }`.

## 5. Run, test, ship

```bash
pnpm install
pnpm tauri dev                 # app with hot reload (Rust edits relaunch it; orphans are reaped)
pnpm dev                       # UI only, mock backend, for browser-driven checks
pnpm test                      # transcript reducer, route mapping, cargo test
cd src-tauri && cargo test -- --ignored   # + creates a real site from the starter
SUPASITO_SMOKE_SCENARIO=queue SUPASITO_SMOKE_SITE_PATH=/path SUPASITO_SMOKE_MODEL=haiku SUPASITO_SMOKE_PROMPT=x pnpm tauri dev
pnpm release [--install]       # Supasito.app (optionally into /Applications)
```

## 6. What's built (all verified; see CHANGELOG.md for how)

**Say.** Composer with Enter to send, queue while Claude works, Escape to stop, paste/drop images, a screenshot of the preview (camera), slash-command autocomplete from the session's skills, ⌘⇧E picker, ⌘N new session, ⌘, settings.

**Point.** Element picker in the preview: tag, plain class, text, selector, computed styles, HTML, React component chain or Astro file:line. Preview follows the page Claude edits. Device widths, path bar, reload, open in browser.

**See.** Streaming transcript with tool steps ("Editing components/hero.tsx"), expandable step output, per-turn completion line with duration, cost, "N files changed" (opens a diff), Undo. Plan-usage chip from the CLI's rate-limit events. Permission mode per session. Exact model id, effort level and fast mode (Opus) as chips in a bar under the composer, per session, with defaults in Settings; the turn line names the model when it differs and `fast` when the request ran fast. Claude's reasoning streams as "Thinking…" and folds into a collapsed row (§8a). Usage ring by the composer: context fullness, plan windows with reset times, cost so far; compaction shows as a notice. The preview can take the whole window (arrows button, ⌘\); picking an element, ⌘N or an approval request brings the conversation back.

**Approve.** Approval cards (Allow, Always allow, Deny with reason), clarifying-question cards, Dock badge with pending approvals, Dock bounce when Claude needs you or finishes in the background. Approvals expire when a turn ends.

**Publish.** Preview vs production targets, confirmation with changed-file count, optional commit (prefilled message) and push to origin, cancel that really stops, log and URL. Publish commands editable with presets.

**Sites.** Open a folder, New site from the starter, rename, site rules (`CLAUDE.md`) editor, reveal in Finder, open in editor, dev-server status and log, install when `node_modules` is missing, git init offer, one dev server at a time. Sessions listed from Claude's store, resumable, capped list with "Show older".

**Robustness.** Dual-stack readiness (Vite/Astro bind `[::1]`), announced-port override, orphan reaping for dev servers and claude processes, stderr tail in exit notices, error boundaries per pane, setup card when Claude Code is missing.

## 7. Known gaps (honest)

- Only used seriously on one machine with two real sites (Astro, Next) plus scratch projects. Plain Vite, SvelteKit and Nuxt 4 were exercised once each from fresh scaffolds (detection, readiness, port fallback), and a pnpm-workspace monorepo with the site at `apps/web` (status, undo, commit and package manager scoped to that folder; session 17). A monorepo with the site at the repository root, and Nuxt with a custom srcDir, are untested.
- The release app has been launched by a script, never used day to day. Dev mode is what has been tested.
- Not signed or notarized: anyone else gets Gatekeeper's "damaged" dialog.
- The first-run checklist was verified in the real app under a fake HOME (signed out) and a stripped PATH (no Node, no Claude Code), plus the mock; the npm path for New site created and served a site on a PATH without pnpm (the ignored cargo test, session 17), not through the New site dialog.
- Failure paths: "not logged in" and "offline" were recorded from the real CLI and are handled; rate limit is covered from the CLI's own strings and has not been provoked.
- Session listing re-reads JSONL heads on every site switch (fine below a few hundred sessions).
- Last review round's fixes were verified in the mock and by smoke tests, not yet by a person.
- Fast site switching was raced against a registry-shaped mock, not in the Tauri window; ⌘\ reaching the page in the Tauri window is argued from the default menu's accelerators, not pressed.
- Fast mode has been switched on and reported by the CLI, but no recorded turn has actually run at `usage.speed: "fast"` (one-word answers stay standard); a longer Opus turn with fast on has not been tried, so the cost and speed claims come from the docs, not from Supasito.
- Context fullness follows Claude Code's own status-line rule (last API call's input + cache tokens) and compaction is handled from the CLI's schema and a saved transcript; neither has been watched live through a full 200k session.

## 8. Next milestone — v0.2 "usable by someone who isn't you"

1. **Live on the release app for a week.** `pnpm release --install`, quit `tauri dev`, use Supasito.app for real work. Log every papercut. Acceptance: a list of things that bit, or the honest absence of one.
2. **First-run checks that name what's missing.** *Built (session 12):* `toolchain.rs` + the checklist (session pane, welcome, Settings); Claude sign-in via `claude auth status`. Acceptance still open: a fresh macOS user account reaches a working preview following only the app's own text.
3. **npm fallback for New site.** *Built (session 12):* pnpm if present, else npm, starter rules rewritten; the starter stays lockfile-free. *Acceptance closed (session 17):* on a PATH without pnpm the ignored cargo test created the site with npm (package-lock.json, rules rewritten) and its `next dev` answered.
4. **Distributable build.** *Decision (session 12): unsigned for now.* `pnpm release --install --zip` builds, installs and writes `release/Supasito-<version>-macos.zip`; recipients clear quarantine once (`xattr -dr com.apple.quarantine`). Signing/notarization is wired in the script for when a Developer ID Application certificate exists (the keychain has only an Apple Development one). Acceptance for now: a second Mac runs the zip after the one-line fix.
5. **Failure-path pass.** *Done except rate limit (session 12):* not logged in and offline recorded from the real CLI (offline = 10 silent retries over ~3 min, now shown live in the Working row); rate limit covered by the CLI's own strings, not provoked; publish sign-in failure and dev server without Node have hints. A dev server crash mid-session is the existing "stopped" card.
6. **Exercise the review fixes by hand.** *Session 12:* never-opens-a-port verified in the real app (error after 90 s, child killed); cancel during commit verified in the mock (deploy never ran); undo with untracked files is unit-tested in Rust. *Session 17:* undo verified against the real CLI by the `undo` smoke scenario (the command's own `undo_files`: tracked file restored, created file deleted, repo clean); fast site switching verified in the mock, which found a real race (the old server's `stopped` landing on the restart), fixed in the store. Remaining: `undoTurn`'s UI guards (isGit, committedAt, markUndone) and site switching in the Tauri window are mock-verified only.

Then decide from use whether anything else deserves building. Default answer: no.

## 8a. Exact model, effort, fast mode, reasoning (built 2026-09-06; see CHANGELOG session 14)

Three knobs on the same loop: which model makes the change, how hard it thinks, how fast it streams; plus the reasoning behind each reply. No new pane: Settings holds the defaults, the bar under the composer changes one session, the turn line reports what ran.

**Facts (CLI 2.1.257, verified 2026-09-06 with `-p` probes; recordings are reducer fixtures)**
- **Model.** `--model` takes an alias (`fable`, `opus`, `sonnet`, `haiku`, `best`, `opusplan`, `default`) or a full id (`claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`), optionally with `[1m]`. The resolved id is `system/init.model`, every assistant `message.model`, and per turn `result.modelUsage`. The user's own default is `model` in `~/.claude/settings.json`.
- **Effort.** `--effort low|medium|high|xhigh|max` (also settings `effortLevel`, env `CLAUDE_CODE_EFFORT_LEVEL`). Not reported back; Supasito remembers what it passed.
- **Thinking text** is withheld in `-p` mode unless `--settings '{"showThinkingSummaries":true}'`; then `thinking_delta.thinking` streams and the block arrives as its own assistant message before the text.
- **Fast mode.** `--settings '{"fastMode":true}'`, Opus 5 / 4.8 only. `system/init` and `result` carry `fast_mode_state` (`on|off|cooldown`) and `fast_mode_disabled_reason`; `result.usage.speed` is `fast|standard` per request. About twice the cost of standard Opus ($10/$50 per MTok); a one-word answer cost $0.257.
- `--settings` merges over the user's settings. Mid-session: `set_model {model}` and `apply_flag_settings {settings}` control requests exist in the binary; Supasito sends them for an idle session and falls back to stop + `--resume` with new flags when the CLI rejects one.

**Verified live (smoke `model`, `fast`):** `set_model` and `apply_flag_settings{fastMode}` take effect on the next turn, and that turn's `system/init` reports the new model / `fast_mode_state`. Not yet seen: a real turn with `usage.speed: "fast"` (both one-word probes stayed "standard" even with fast mode on), so the `fast` mark on the turn line is tested only from a synthetic result.

## 9. Backlog (deferred on purpose)

- Windows build (WebView2 mixed-content policy, all-frames script, process groups; no Dock APIs).
- Second agent backend behind the same `agent://` events.
- Session-list caching by file mtime.
- Auto-update.

## 10. Sources

Webflow Source: https://webflow.com/source · HF0 / Dave Fontenot: https://tv.nyse.com/videos/hf0-ceo-dave-fontenot-on-a-unique-approach-to-vcs · Claude Code headless and control protocol: https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/agent-sdk/user-input · Tauri 2: https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html
