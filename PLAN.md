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
- **D10 Usage is two numbers in two places.** Context fullness belongs to the session, so it sits by the composer: a ring that fills as the conversation grows (the last API call's prompt size against the model's window from `modelUsage`), details on click. Plan usage belongs to the account, so it sits in Settings and in the same popover; the header chip is only the alarm above 50%. Cost is the CLI's cumulative `total_cost_usd`, shown per turn on the completion line and in total in the popover.

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

**See.** Streaming transcript with tool steps ("Editing components/hero.tsx"), expandable step output, per-turn completion line with duration, cost, "N files changed" (opens a diff), Undo. Plan-usage chip from the CLI's rate-limit events. Model chip. Permission mode per session. Usage ring by the composer: context fullness, plan windows with reset times, cost so far; compaction shows as a notice.

**Approve.** Approval cards (Allow, Always allow, Deny with reason), clarifying-question cards, Dock badge with pending approvals, Dock bounce when Claude needs you or finishes in the background. Approvals expire when a turn ends.

**Publish.** Preview vs production targets, confirmation with changed-file count, optional commit (prefilled message) and push to origin, cancel that really stops, log and URL. Publish commands editable with presets.

**Sites.** Open a folder, New site from the starter, rename, site rules (`CLAUDE.md`) editor, reveal in Finder, open in editor, dev-server status and log, install when `node_modules` is missing, git init offer, one dev server at a time. Sessions listed from Claude's store, resumable, capped list with "Show older".

**Robustness.** Dual-stack readiness (Vite/Astro bind `[::1]`), announced-port override, orphan reaping for dev servers and claude processes, stderr tail in exit notices, error boundaries per pane, setup card when Claude Code is missing.

## 7. Known gaps (honest)

- Only used seriously on one machine with two real sites (Astro, Next) plus scratch projects. SvelteKit, Nuxt, plain Vite and monorepos were reasoned about, not used.
- The release app has been launched by a script, never used day to day. Dev mode is what has been tested.
- Not signed or notarized: anyone else gets Gatekeeper's "damaged" dialog.
- The first-run checklist was verified in the real app under a fake HOME (signed out) and a stripped PATH (no Node, no Claude Code), plus the mock; the npm path for New site is unit-tested but has not created a site on a pnpm-less machine.
- Failure paths: "not logged in" and "offline" were recorded from the real CLI and are handled; rate limit is covered from the CLI's own strings and has not been provoked.
- Session listing re-reads JSONL heads on every site switch (fine below a few hundred sessions).
- Last review round's fixes were verified in the mock and by smoke tests, not yet by a person.
- Context fullness follows Claude Code's own status-line rule (last API call's input + cache tokens) and compaction is handled from the CLI's schema and a saved transcript; neither has been watched live through a full 200k session.

## 8. Next milestone — v0.2 "usable by someone who isn't you"

1. **Live on the release app for a week.** `pnpm release --install`, quit `tauri dev`, use Open.app for real work. Log every papercut. Acceptance: a list of things that bit, or the honest absence of one.
2. **First-run checks that name what's missing.** *Built (session 12):* `toolchain.rs` + the checklist (session pane, welcome, Settings); Claude sign-in via `claude auth status`. Acceptance still open: a fresh macOS user account reaches a working preview following only the app's own text.
3. **npm fallback for New site.** *Built (session 12):* pnpm if present, else npm, starter rules rewritten; the starter stays lockfile-free. Acceptance still open: try it on a machine without pnpm (`PATH` without pnpm is enough to simulate).
4. **Distributable build.** *Decision (session 12): unsigned for now.* `pnpm release --install --zip` builds, installs and writes `release/Open-<version>-macos.zip`; recipients clear quarantine once (`xattr -dr com.apple.quarantine`). Signing/notarization is wired in the script for when a Developer ID Application certificate exists (the keychain has only an Apple Development one). Acceptance for now: a second Mac runs the zip after the one-line fix.
5. **Failure-path pass.** *Done except rate limit (session 12):* not logged in and offline recorded from the real CLI (offline = 10 silent retries over ~3 min, now shown live in the Working row); rate limit covered by the CLI's own strings, not provoked; publish sign-in failure and dev server without Node have hints. A dev server crash mid-session is the existing "stopped" card.
6. **Exercise the review fixes by hand.** *Session 12:* never-opens-a-port verified in the real app (error after 90 s, child killed); cancel during commit verified in the mock (deploy never ran); undo with untracked files is unit-tested in Rust. Still by hand: undo in the real UI, fast site switching.

Then decide from use whether anything else deserves building. Default answer: no.

## 8a. Planned: exact model, reasoning, fast mode (planned 2026-09-06, not built)

Three knobs on the same loop: which model makes the change, how hard it thinks, how fast it streams. No new pane: they live where the model chip already is (session header) and in Settings (defaults for new sessions). Everything under "facts" was verified on Claude Code 2.1.257 with `-p` probes in a scratch folder; the recordings are in `src/agent/fixtures/claude-2.1.257-thinking-summaries.jsonl` (haiku, `--effort low`, thinking text on) and `src/agent/fixtures/claude-2.1.257-fast-mode.jsonl` (opus, fast mode on). Neither is used by a test yet.

**Facts (CLI 2.1.257, 2026-09-06)**
- **Model.** `--model` takes an alias (`fable`, `opus`, `sonnet`, `haiku`, `best`, `opusplan`, `default`) or a full id (`claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`), optionally with `[1m]` for the 1M-context variant. The resolved id is `system/init.model`, every assistant `message.model`, and per turn `result.modelUsage` (`{<id>: {canonicalModel, costUSD, …}}`). The user's own default is `model` in `~/.claude/settings.json` (on this Mac `claude-fable-5-1[1m]`).
- **Effort (reasoning).** `--effort low|medium|high|xhigh|max`; also settings `effortLevel` and env `CLAUDE_CODE_EFFORT_LEVEL`. Not reported in `init` or `result`: Open has to remember what it passed. User default here: `effortLevel: high`.
- **Thinking text.** In `-p` mode thinking arrives empty (`{"type":"thinking","thinking":""}`, `thinking_delta` without text, plus `system/thinking_tokens {estimated_tokens}`), which is why the existing "Thinking" row never shows anything. `--settings '{"showThinkingSummaries":true}'` turns the text on: `thinking_delta.thinking` streams and the final block carries the summary; the reducer already accumulates both. A `thinkingDisplay` setting does nothing.
- **Fast mode.** No flag: `--settings '{"fastMode":true}'`. Opus 5 / Opus 4.8 only; other models get it switched off by the CLI. `system/init` and `result` carry `fast_mode_state` (`on|off|cooldown`) and `fast_mode_disabled_reason` (`sdk_opt_in_required` when not opted in); `result.usage.speed` says whether the last request really ran fast (`fast|standard`, and a fast session may still answer at standard speed). Cost: a one-word answer cost $0.257 on Opus 5 fast against $0.034 on Haiku; fast mode is billed at $10/$50 per MTok, about twice standard Opus, so on a subscription it empties the usage window faster.
- `--settings` merges on top of the user's settings (the opus probe kept `permissionMode: auto` from `~/.claude/settings.json`).
- **Mid-session control requests** present in the 2.1.257 binary, not yet exercised by Open: `set_model {model}`, `apply_flag_settings {settings}` (the settings layer the CLI re-reads for `fastMode` and `effortLevel`), `set_max_thinking_tokens {max_thinking_tokens, thinking_display}`. `/model`, `/effort` and `/fast` are also listed under `slash_commands` for the session. Fallback that needs no protocol: stop the process and `--resume` it with new flags (Open already resumes a stopped session on the next send).

**Steps** (each ends green on `pnpm test`, `cargo build`, `pnpm exec tsc --noEmit`)
1. **Protocol + reducer.** `StartOpts` (claude.rs) gains `effort`, `fast_mode`; `claude.rs` adds `--effort <level>` and one merged `--settings {"fastMode":…,"showThinkingSummaries":true}`. `transcript.ts`: `SessionState` gains `effort` (what Open passed, null = the user's default), `fast: {state, reason} | null`, `thinking: boolean` (a thinking block is streaming, for the Working row); assistant items gain `model`; result items gain `models` (keys of `modelUsage`) and `speed` (`usage.speed`). Tests on the two new fixtures: thinking text accumulates from deltas and the final block replaces it; `fast_mode_state` on/off and the reason are parsed from init and result; the result carries `speed` and the model id. Mock: thinking deltas in `fakeTurn`, `fast_mode_state` in init and result, `?fast=on`.
2. **Settings, the defaults for new sessions.** `Persisted` (state.rs), `settings_get/set` (lib.rs) and the `Settings` type gain `effort` and `fastMode`. Dialog: the model list becomes exact ids with plain labels (Fable 5.1 · `claude-fable-5-1`, Opus 5, Sonnet 5, Haiku 4.5, custom name for anything else), a "1M context" checkbox that appends `[1m]`, an effort select (your default / low / medium / high / xhigh / max), a fast-mode checkbox with the cost line and "Opus only". "Your Claude Code default" names what it resolves to by reading `model` and `effortLevel` from `~/.claude/settings.json` in toolchain.rs (best effort; project settings can still override). Thinking summaries are always on, no setting: the row stays collapsed.
3. **Per-session controls** in the header next to the mode select: a model select showing the exact id in use, an effort select, a fast toggle shown only when the session's model is Opus (shows `cooldown` when the CLI says so, and the disabled reason otherwise). Changing one while the session is idle sends the control request (`set_model`, `apply_flag_settings`); a `control_response` error falls back to stop + resume with the new flags on the next send. Two new smoke scenarios in smoke.rs, `model` (haiku ↔ sonnet, assert the next `message.model`) and `fast` (opus, assert `fast_mode_state` and `usage.speed`; about $0.25 a turn), verify the control requests against the real CLI before the UI relies on them. Overrides live in the store for the app's lifetime; after a relaunch the defaults apply and the chips show what `init` reports.
4. **Seeing it.** Turn-end line: `Done · 12 s · $0.04 · opus-5 · fast` (model short name only when it differs from the session's model or several were used; `fast` only when `usage.speed` was fast). Working row says "Thinking…" while a thinking block streams. The "Thinking" details row streams the summary with the caret, collapsed by default (`.thinking` in app.css). README "Model" bullet rewritten, CHANGELOG entry, this section folded into §6.

**Acceptance**
- A new session with Opus + fast shows `fast` in the header and `· fast` on turn lines; with Sonnet the toggle is hidden and `init` reports `off`.
- Switching the model of an idle session: the next assistant `message.model` is the new id (smoke `model`).
- Effort `low` versus `max` on the same prompt: visibly different thinking time and summary length; the header shows the level Open passed.
- The "Thinking" row contains text on a real turn (today it is always empty).
- Old sessions still resume and render; turns recorded before this change simply have no thinking text.

**Cut on purpose:** a thinking-token budget (`MAX_THINKING_TOKENS`, `set_max_thinking_tokens`), `best`/`opusplan` as list entries (the custom field takes them), per-turn model switching inside a running turn, a cost calculator.

## 9. Backlog (deferred on purpose)

- Windows build (WebView2 mixed-content policy, all-frames script, process groups; no Dock APIs).
- Second agent backend behind the same `agent://` events.
- Session-list caching by file mtime.
- Auto-update.

## 10. Sources

Webflow Source: https://webflow.com/source · HF0 / Dave Fontenot: https://tv.nyse.com/videos/hf0-ceo-dave-fontenot-on-a-unique-approach-to-vcs · Claude Code headless and control protocol: https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/agent-sdk/user-input · Tauri 2: https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html
