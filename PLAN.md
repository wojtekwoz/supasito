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
  app/Dialogs.tsx        publish (targets, commit, push, cancel), diff, site rules, settings (Claude / Interface tabs), new site
  app/ui.ts              the parts of the interface Settings → Interface can hide (`settings.hidden`) and the useShown hook
  agent/transcript.ts    stream-json → transcript items (tests: agent/transcript.test.ts + fixtures/)
  routes.ts              edited file → page route (tests: routes.test.ts)
  mock.ts                browser-only backend for UI work (`pnpm dev` → http://localhost:1420)
src-tauri/src/
  lib.rs                 Tauri commands (sites, dev server, agent, git, publish, capture, badge)
  agent/claude.rs        spawn claude, NDJSON reader/writer, control protocol, orphan reaping
  agent/sessions.rs      read ~/.claude/projects/<encoded cwd>/*.jsonl
  devserver.rs           dev-server supervisor (bind+connect port check, listener ownership, retry on a taken port, orphan reaping)
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

**See.** Streaming transcript with tool steps ("Editing components/hero.tsx"), expandable step output, per-turn completion line with duration, cost, "N files changed" (opens a diff), Undo. Plan-usage chip from the CLI's rate-limit events. Permission mode per session. Exact model id, effort level and fast mode (Opus) as chips in a bar under the composer, per session, with defaults in Settings; the turn line names the model when it differs and `fast` when the request ran fast. Claude's reasoning streams as "Thinking…" and folds into a collapsed row (§8a). Usage ring by the composer: context fullness, plan windows with reset times, cost so far; compaction shows as a notice. The preview can take the whole window (arrows button, ⌘\) with the conversation floating minimal over the bottom-left corner, draggable anywhere over the page, minimisable to a pill, with its own way out of the mode.

**Approve.** Approval cards (Allow, Always allow, Deny with reason), clarifying-question cards, Dock badge with pending approvals, Dock bounce when Claude needs you or finishes in the background. Approvals expire when a turn ends.

**Publish.** Preview vs production targets, confirmation with changed-file count, optional commit (prefilled message) and push to origin, cancel that really stops, log and URL. Publish commands editable with presets.

**Sites.** Open a folder, New site from the starter, rename, remove from the sidebar (a dialog that says the folder stays on disk, session 21), star favourites and the "All sites…" dropdown with a filter (⌘⇧O, §8b), site rules (`CLAUDE.md`) editor, reveal in Finder, open in editor, dev-server status and log, install when `node_modules` is missing, git init offer, one dev server at a time. A folder with no dev command (plain HTML) gets "Set up the preview": Claude's first task adds a `dev` script, the site is re-detected when the turn ends and the server starts (session 18). Sessions listed from Claude's store, resumable, capped list with "Show older".

**Robustness.** Dual-stack readiness (Vite/Astro bind `[::1]`), announced-port override, orphan reaping for dev servers and claude processes, stderr tail in exit notices, error boundaries per pane, setup card when Claude Code is missing. A taken port (session 18): the free-port check also connects (a wildcard Node listener passes a loopback bind on macOS), readiness counts only a listener in our own process group, a conflict on the port we chose retries on another, and a conflict on a port the command insists on becomes a card naming the holder with "Stop it and try again".

## 7. Known gaps (honest)

- Only used seriously on one machine with two real sites (Astro, Next) plus scratch projects. Plain Vite, SvelteKit and Nuxt 4 were exercised once each from fresh scaffolds (detection, readiness, port fallback), and a pnpm-workspace monorepo with the site at `apps/web` (status, undo, commit and package manager scoped to that folder; session 17). A monorepo with the site at the repository root, and Nuxt with a custom srcDir, are untested.
- The release app has been launched by a script, never used day to day. Dev mode is what has been tested.
- The signed build has been launched and used for one short pass, not lived on. Hardened runtime was
  the open question and it is answered: the signed app spawns `claude` and dev servers normally.
- The first-run checklist was verified in the real app under a fake HOME (signed out) and a stripped PATH (no Node, no Claude Code), plus the mock; the npm path for New site created and served a site on a PATH without pnpm (the ignored cargo test, session 17), not through the New site dialog.
- Failure paths: "not logged in" and "offline" were recorded from the real CLI and are handled; rate limit is covered from the CLI's own strings and has not been provoked.
- Session listing re-reads JSONL heads on every site switch (fine below a few hundred sessions).
- Last review round's fixes were verified in the mock and by smoke tests, not yet by a person.
- Fast site switching was raced against a registry-shaped mock, not in the Tauri window; ⌘\ reaching the page in the Tauri window is argued from the default menu's accelerators, not pressed.
- Fast mode has been switched on and reported by the CLI, but no recorded turn has actually run at `usage.speed: "fast"` (one-word answers stay standard); a longer Opus turn with fast on has not been tried, so the cost and speed claims come from the docs, not from Supasito.
- Context fullness follows Claude Code's own status-line rule (last API call's input + cache tokens) and compaction is handled from the CLI's schema and a saved transcript; neither has been watched live through a full 200k session.

## 8. Next milestone — v0.2 "usable by someone who isn't you"

1. **Live on the release app for a week.** `pnpm release --install`, quit `tauri dev`, use Supasito.app for real work. Log every papercut under §8c. Acceptance: a list of things that bit, or the honest absence of one.

   *Why the installed app and not dev mode.* Nearly all use so far has been `pnpm tauri dev`: a debug
   binary, the UI served by Vite with hot reload, and a relaunch on every Rust edit. The release app
   differs in ways tests do not reach. Optimized code hits the dev-server and site-switch races at
   different timings than the debug build and the mock. The UI comes from the bundle under the
   production CSP, not from Vite on 1420. The starter is read from the app bundle's Resources, not the
   repo. Launched from the Dock it inherits no shell environment, so `login_shell_path` in `state.rs`
   is what finds `claude`, `node` and `git` — a path that barely matters in dev. The debug escape
   hatches are compiled out: `SUPASITO_PATH` is `#[cfg(debug_assertions)]`, and the smoke scenarios do
   not exist in a release build. And state accumulates across days rather than being wiped by the next
   relaunch, so session lists grow and orphaned dev servers must be reaped rather than restarted away.

   *Rules while the trial runs.* Do not run `pnpm tauri dev` alongside it; both read the same app-state
   file, which is why `scripts/release.sh` refuses to build while a dev instance is alive. Changes do
   not reach the installed app by themselves — `pnpm release --install` is what updates it, so a fix
   made during the trial is invisible until someone rebuilds.
2. **First-run checks that name what's missing.** *Built (session 12):* `toolchain.rs` + the checklist (session pane, welcome, Settings); Claude sign-in via `claude auth status`. Acceptance still open: a fresh macOS user account reaches a working preview following only the app's own text.
3. **npm fallback for New site.** *Built (session 12):* pnpm if present, else npm, starter rules rewritten; the starter stays lockfile-free. *Acceptance closed (session 17):* on a PATH without pnpm the ignored cargo test created the site with npm (package-lock.json, rules rewritten) and its `next dev` answered.
4. **Distributable build.** *Done (session 24).* Developer ID Application certificate (team AR9C3X8J27) and an App Store Connect API key for notarization; both referenced from `.env.release` (gitignored), key material in `~/.private/supasito-signing/`. `pnpm release --zip` signs with the hardened runtime, notarizes, staples and verifies. *Acceptance closed:* notarization accepted, and a copy unzipped from the zip with the quarantine flag set was accepted by Gatekeeper as "Notarized Developer ID". Remaining: a second Mac has still not run it.
5. **Failure-path pass.** *Done except rate limit (session 12):* not logged in and offline recorded from the real CLI (offline = 10 silent retries over ~3 min, now shown live in the Working row); rate limit covered by the CLI's own strings, not provoked; publish sign-in failure and dev server without Node have hints. A dev server crash mid-session is the existing "stopped" card; a taken port is the "Port N is taken" card (session 18, verified by the `ports` smoke scenario).
6. **Exercise the review fixes by hand.** *Session 12:* never-opens-a-port verified in the real app (error after 90 s, child killed); cancel during commit verified in the mock (deploy never ran); undo with untracked files is unit-tested in Rust. *Session 17:* undo verified against the real CLI by the `undo` smoke scenario (the command's own `undo_files`: tracked file restored, created file deleted, repo clean); fast site switching verified in the mock, which found a real race (the old server's `stopped` landing on the restart), fixed in the store. Remaining: `undoTurn`'s UI guards (isGit, committedAt, markUndone) and site switching in the Tauri window are mock-verified only.

7. **Auto-update.** Pulled out of the backlog now that signing exists and a build can reach other
   people: without it, every fix asks them to download the app again. Tauri's updater plugin, the
   same Developer ID, a manifest on GitHub Releases. See §9.

Then decide from use whether anything else deserves building. Default answer: no. Version by version,
§9.

## 8a. Exact model, effort, fast mode, reasoning (built 2026-09-06; see CHANGELOG session 14)

Three knobs on the same loop: which model makes the change, how hard it thinks, how fast it streams; plus the reasoning behind each reply. No new pane: Settings holds the defaults, the bar under the composer changes one session, the turn line reports what ran.

**Facts (CLI 2.1.257, verified 2026-09-06 with `-p` probes; recordings are reducer fixtures)**
- **Model.** `--model` takes an alias (`fable`, `opus`, `sonnet`, `haiku`, `best`, `opusplan`, `default`) or a full id (`claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`), optionally with `[1m]`. The resolved id is `system/init.model`, every assistant `message.model`, and per turn `result.modelUsage`. The user's own default is `model` in `~/.claude/settings.json`.
- **Effort.** `--effort low|medium|high|xhigh|max` (also settings `effortLevel`, env `CLAUDE_CODE_EFFORT_LEVEL`). Not reported back; Supasito remembers what it passed.
- **Thinking text** is withheld in `-p` mode unless `--settings '{"showThinkingSummaries":true}'`; then `thinking_delta.thinking` streams and the block arrives as its own assistant message before the text.
- **Fast mode.** `--settings '{"fastMode":true}'`, Opus 5 / 4.8 only. `system/init` and `result` carry `fast_mode_state` (`on|off|cooldown`) and `fast_mode_disabled_reason`; `result.usage.speed` is `fast|standard` per request. About twice the cost of standard Opus ($10/$50 per MTok); a one-word answer cost $0.257.
- `--settings` merges over the user's settings. Mid-session: `set_model {model}` and `apply_flag_settings {settings}` control requests exist in the binary; Supasito sends them for an idle session and falls back to stop + `--resume` with new flags when the CLI rejects one.

**Verified live (smoke `model`, `fast`):** `set_model` and `apply_flag_settings{fastMode}` take effect on the next turn, and that turn's `system/init` reports the new model / `fast_mode_state`. Not yet seen: a real turn with `usage.speed: "fast"` (both one-word probes stayed "standard" even with fast mode on), so the `fast` mark on the turn line is tested only from a synthetic result.

## 8b. Site switcher with favourites (built 2026-09-07, session 21; see CHANGELOG)

**Why it passes the one rule.** The rail lists every site ever opened, newest first. Past a dozen the list pushes Sessions below the fold and the site you use daily sits wherever it last landed, so "say" starts with a scroll. The fix is to show the few sites that matter and put the rest one click away; nothing new to learn, no new pane.

**Shape.**
- The Sites section of the rail shows **favourites** (starred) plus the current site if it is not starred, in list order (newest opened first). A site with no favourites shows what it shows today: every site, newest first, and "All sites…" appears only past six sites.
- Below them one row, **"All sites…"** with a count, opens a **dropdown** anchored to the rail: a filter field (auto-focused; typing narrows by name and folder), then Favourites, then the rest by last opened, each row with the folder path in small type, a star toggle on hover, and the trash (which opens the same Remove dialog). The two existing actions, Open a folder and New site, sit at the bottom of the menu so a first-time user finds them in the same place as today.
- **Star** = a hollow star on hover at the row's right, filled when set; also in the dropdown. No drag-to-reorder: starring appends, unstarring removes, that is the whole ordering model.
- **Keyboard.** ⌘⇧O opens the dropdown (Escape closes it, ↑↓ and Enter pick). Nothing else; ⌘1…9 for favourites is tempting and cut, it collides with the preview's device widths if those ever get shortcuts.
- The dropdown replaces nothing: the rail rows still select on click, rename on double-click, and carry the rules/editor/Finder/trash buttons.

**Data.** Two fields on the persisted `Site` (src-tauri/src/sites.rs, saved in the app-state JSON, *not* in `supasito.json`: a favourite is the user's preference, the site file is committed and shared): `favorite: bool` (serde default false) and `last_opened: u64` (ms; set by `site_select`; default 0 so old state files sort by their existing order). Two commands: `site_favorite(site_id, on)` and `site_opened(site_id)` stamps the timestamp when a site is selected. The mock gets `?sites=many` (fourteen sites, three starred) for the browser check.

**Acceptance (all met in the mock, session 21).** With `?sites=many` the rail shows three starred rows plus "All sites… (14)" and Sessions stays visible without scrolling; starring from the dropdown moves the site into the rail immediately; unstarring the current site keeps it in the rail until another site is selected; typing "cl" in the filter leaves only ClarityOps; ⌘⇧O opens, Escape closes; a state file without the two fields loads unchanged (`cargo test`); with two sites and nothing starred the rail is identical to today's.

**Cut.** Folders/groups, tags, drag-to-reorder, recents as a separate section in the rail, an "all sites" grid page, per-site icons or favicons. Each is a surface, none shortens the loop.

## 8c. Papercuts from living on the release app

Every annoyance from day-to-day use of `/Applications/Supasito.app`, however small: anything that made
you pause, click twice, or wonder what the app was doing. Not only bugs. Date each one and say what you
were trying to do; an entry nobody can reproduce is still worth having. Empty is a real result and
closes §8.1 on its own.

- (2026-09-08) Trial started on the signed 0.1.0 build.
- (2026-09-08) Opened `~/supasito` (the landing page: a package.json with scripts and no dependencies)
  and the preview showed "Dependencies aren't installed" with a "Run npm install" button that did
  nothing. It was doing exactly what it said — `npm install` on a manifest with no dependencies creates
  no `node_modules`, so the check that raised the card could never be cleared by the button that card
  offered. Fixed in session 28; the wider lesson is that every dead-end card in the preview pane now
  hands off to Claude rather than repeating an action that has already failed.
- (2026-09-08) Same site, next wall: Supasito appended `--port 4322` to a dev script that serves with
  `python3 -m http.server`, which takes its port as a positional argument and exits on the flag. Supasito
  had invented a flag for a command it did not recognise. Fixed in session 29 — it now runs an
  unrecognised script as written and asks the OS where the server went.

## 8d. v0.2.1 — the model list comes from the agents, and one conversation spans both (planned and built 2026-09-12; CHANGELOG session 32)

Two items, one release. Both are seams between Supasito and the two CLIs that 0.2.0 exposed the moment
it shipped; neither adds a surface. Order: the model list first (half a day, and it is what you hit
today), the conversation chain second (about a day with the tests).

### 8d.1 The model list is fetched, not typed in

**The fault.** `src/models.ts` is a hardcoded list from codex-cli 0.149.0 and the Claude Code docs.
Codex is at 0.154.0 now and its `model/list` (measured 2026-09-12, the probe in CODEX.md §3.4) returns
six models with **`gpt-6-astra` as the default**, plus `gpt-5.5` and `gpt-5.3-codex-spark`; Supasito
offers three GPT models and still calls `gpt-5.6-sol` the default. The user's own `~/.codex/config.toml`
already says `gpt-6-astra`. Every model release will repeat this until the list comes from the CLI.

**Decision.** The two agents are different cases and get different answers:

- **Codex: live from `model/list`.** The app-server reports id, `displayName`, `description`,
  `isDefault`, `supportedReasoningEfforts`, `defaultReasoningEffort`, `serviceTiers` and `hidden`.
  That is the whole Codex half of `models.ts`, with two things the hardcoded list cannot know: the
  efforts are **per model** (the 5.6 and 6 models offer `ultra`, which Supasito's fixed low…max list does
  not have; `codex-spark` stops at `xhigh`), and Fast is the `priority` service tier, **offered by every
  model except `gpt-5.3-codex-spark`** — so `supportsFast` stops guessing from the id.
- **Claude: a served catalogue, with the built-in list as the floor.** Claude Code has no model
  listing (`claude --help` on 2.1.257: `--model` takes an alias or a full id, nothing enumerates them; the
  API's `/v1/models` needs an API key the subscription sign-in does not have, and Supasito does not touch
  `~/.claude/.credentials.json`). So the list rides on the one request the app already makes:
  `updates.rs` fetches `supasito.com/updates/models.json` right after `latest.json`, once a day and on
  "Check now", same host, same no-identifier URL (WEBSITE.md §4.6 still holds). `pnpm release` writes
  `release/models.json` from `src/models.ts` so the two cannot drift at release time; editing the file on
  the site is how a new Claude model appears between releases. The built-in list is what the app shows
  when it has never fetched.
- **Rejected:** asking Claude Code with a deliberately wrong `--model` and parsing the error (unverified
  that it lists anything, and it costs a process start); offering only aliases (`opus`, `sonnet`…) so the
  list never ages (true for a tier, useless for a new family name like Fable was; the served catalogue may
  still carry alias rows, `modelOption` already resolves them).

**The cache is app state.** `Persisted.models: { codex: Vec<Model>, codex_at, claude: Vec<Model>, claude_at }`,
written whenever a fetch succeeds, read at startup so the picker is right before any fetch returns and
when offline. A `Model` is `{ id, label, hint, default, efforts, default_effort, fast, backend }` — one
shape for both agents, which is what `models.ts` becomes a reader of. Fetch points: selecting a site
(through its app-server, after its session list so the two never share the server at once), Recheck, and
opening Settings, the last two only when the cache is an hour old or was never filled. The Codex fetch
reuses the current site's `server_for` (refcounted, released when idle, a few hundred ms); no new
process model.

**What moves.** `CODEX_DEFAULT` / `DEFAULT_MODEL` become "the entry marked `isDefault`, else the
constant" — `lib.rs:426` reads it from the cache, the Session header's "Codex's default (GPT-5.6 Sol)" stops
being a string literal. The effort picker shows the model's own efforts for Codex sessions (`isEffort`
accepts `ultra` there) and the fixed five for Claude. `MODELS` in `Session.tsx` and `Dialogs.tsx` becomes a
store selector (`useModels()`) merging cache + built-in by id, filtering `hidden`, keeping the installed
agents' models only, as today. `modelShort` already renders `gpt-6-astra` as `GPT-6 Astra`; a `displayName`
is kept as the label when present. `is_codex_model` needs no change (`gpt-`, `codex`).

**Mock.** `?models=stale|fresh|fail`: the built-in list, a fetched list with astra default and a
spark row without Fast, and a fetch that errors (the picker must look identical to `stale`).

**Files.** `src-tauri/src/agent/codex.rs` (`models()` over `model/list`, and the `Model` parse with a unit
test on the recorded reply), `src-tauri/src/updates.rs` (`models.json` after `latest.json`),
`src-tauri/src/state.rs` (the cache), `src-tauri/src/lib.rs` (`models_list` command, the default),
`scripts/release.sh` (write `release/models.json`), `src/models.ts` (reader over the cache, per-model
efforts and fast), `src/app/store.ts` (`models` slice + fetch), `src/app/Session.tsx`, `Dialogs.tsx`,
`src/mock.ts`, CODEX.md §5.2 (milestone 4 closes).

**Proof.** *Mock and real CLI done (session 32); release-app steps open.* `pnpm dev?models=fresh` shows Astra as the default with `ultra` in its effort list and no Fast
on Spark. In the release app: the picker shows the six 0.154.0 models on first launch after the update
check, with `codex` removed from PATH it shows the cached six, and with the app-state file wiped it shows
the built-in list. A Codex session started with no model chosen runs on `gpt-6-astra` (the thread's
`model` in `thread/read`).

### 8d.2 One conversation, several engines underneath

**The fault.** Switching a Claude chat to a GPT model (or back) starts a *separate* session with a
handoff (0.2.0, session 31): correct, and ugly — the rail shows two rows, the transcript empties down to
one notice, and the old process stays alive doing nothing. The constraint is real: each CLI keeps its
own history (`~/.claude/projects`, `~/.codex`), so no single process can switch. The app does not have to
expose that seam.

**Decision.** A conversation is a **chain of backend sessions**. When a session continues another one, the
link is recorded in app state; everything else is derived from it:

- **The link.** `Site.continuations: Vec<{ id, continues, at }>` in app state next to `favorite` (a user's
  view of their history, not the site's config, so not `supasito.json`). It is written by `start_agent`,
  atomically with minting the new id, from a new `SessionOverrides.continues` field the draft carries —
  not by a second call from the UI, which could lose the link between the two. The `handoff` text keeps
  its job and its place (the system prompt; lib.rs:407), so replaying the tail shows only the user's real
  messages.
- **The rail shows one row: the tail.** `sessions_list` returns each `SessionInfo` with `continues` and
  `continuedBy`; a pure `fold_chains(list, links)` in `sessions.rs` hides every session whose successor is
  *in the list* (if the tail is missing because Codex is uninstalled or its list failed, the head stays
  visible rather than the conversation vanishing), and gives the tail the head's title and `createdAt`,
  the tail's `lastModified`, and the summed `messageCount`. The GPT badge follows the tail's id, as now.
  `Site.lastSessionId` is always the tail; `siteSetLastSession` needs nothing new.
- **The transcript is the segments in order.** `openSession(tail)` walks `continues` back to the head,
  loads each segment with its own reducer (`applyMessage` or `applyCodexMessage`) into its own scratch
  `SessionState`, and concatenates the items with a divider between segments: a new `Item` kind
  `handoff` carrying `{ from, to, model }`, rendered as a thin line with "now on GPT-6 Astra". The tail's
  state (backend, model, context, fast, mode, overrides) is the live one; the earlier segments contribute
  items only. A segment that fails to load (Claude Code's `cleanupPeriodDays` deletes old JSONL; Codex
  unreachable) becomes one notice row — "the earlier part of this conversation, on Claude, is no longer
  available" — and the rest still renders.
- **Switching is the same divider, live.** `setSessionModel` across agents no longer calls `newSession()`
  into an empty draft with a notice. The draft *inherits the current items* plus the divider, carries
  `overrides.continues = currentId` and the handoff, and the view does not move; the first send starts
  the new tail as today and the draft's items become its transcript. The head's process is stopped
  once the tail has started (`agent_stop`, best effort): it was idle, and two live agents on one folder
  is a foot-gun. Switching back adds another segment the same way; a chain is any length.
- **Sending goes to the tail.** `currentSessionId` already is the tail, so `send`, queue, interrupt,
  approvals and the knobs need no routing change. Same-agent switches (Claude→Claude, GPT→GPT) stay live
  and mid-conversation as they are.
- **Unchanged on purpose.** Undo works on files and turn items, not sessions — an undo of a turn that ran
  on Claude from a transcript whose tail is Codex is the same `git checkout`. Context fullness and cost are
  the tail process's own, as they already are after any restart. `handoffText` stays the honest handover
  (the new engine still needs to be told what was said; that part is invisible to the user).

**Edges to write down.** Switching while busy is still refused (toast). A chain's head opened directly is
impossible from the rail (hidden) and harmless from `lastSessionId` (the store resolves it to the tail
before loading). Two successors of one head cannot happen through the UI; `fold_chains` takes the newer
and leaves the other visible rather than dropping it. Deleting the site forgets the links with it.

**Mock.** `?sites=two` gets a chained pair (a Claude head, a Codex tail) so the rail row, the divider and
the replay are workable without either CLI; `?chain=broken` drops the head's transcript to exercise the
notice.

**Tests.** *Built (session 32).* `fold_chains` (Rust: hides continued rows, keeps the head when the tail is absent, title and
counts) and `concatSegments` (TS: divider placement, a failed segment's notice, items stay immutable) run
in `pnpm test`; the mock walks the whole chain (`?chain=broken` for the notice). Proof in the release app, still open: start on Claude, switch to a GPT model, one turn, switch back,
one turn; relaunch; the rail shows **one** row under the original title with no GPT badge, and reopening
it replays three segments with two dividers. Undo of the Codex turn from that view restores the files.

**Files.** `src-tauri/src/sites.rs` (`continuations` on `Site`), `src-tauri/src/agent/sessions.rs`
(`fold_chains`, `continues`/`continuedBy` on `SessionInfo`), `src-tauri/src/lib.rs` (`start_agent`
records the link, stops the head; `sessions_list` folds), `src/types.ts` (`continues` on overrides and
`SessionInfo`), `src/agent/transcript.ts` (`handoff` item, `concatSegments`), `src/app/store.ts`
(`openSession` walks the chain, `setSessionModel` keeps the items), `src/app/Session.tsx` (the divider
row), `src/app/Rail.tsx` (nothing: it already renders what `sessions_list` returns), `src/mock.ts`,
CODEX.md (a §11 pointing here; "switching backend offers a new session" in milestone 4 is superseded).

### 8d.3 Out of scope for 0.2.1

Merging histories into one CLI store, a combined context ring across segments, editing the handoff,
and per-backend settings. None of them shortens the loop.

## 8e. v0.2.2 — paste a GitHub link, get a working preview (planned and built 2026-09-14 on `github-link`; CHANGELOG session 33)

Today a site that lives on GitHub reaches Supasito only through a terminal: someone has to `git clone` it and then
"Open a folder…". That is the one step of the loop a non-technical person cannot do, and it comes before *say*.
This closes it without a new pane: the New site dialog also accepts a link, and everything after the link is
work the app already knows how to do (detect, install, start the dev server, hand a dead end to Claude).

**The claim.** Someone who has never opened a terminal copies a repository link from their browser, pastes it
into Supasito, and is looking at the site running, with nothing to answer except where their sites live (once).

### 8e.1 The flow, as the user sees it

1. **Paste.** Three ways in, all landing in the same dialog, prefilled:
   - The New site dialog has one field: *"Name a new site, or paste a GitHub link"*. A link turns the dialog into
     the clone flow as you type; a name keeps today's starter flow. No tabs, no mode switch.
   - The welcome screen and the rail's "+" menu name it: "New site or GitHub link…".
   - ⌘V with a GitHub link anywhere outside a text field opens the dialog with the link in it. It uses the paste
     event the user just made, so no clipboard permission and no reading the clipboard behind their back.
2. **Recognise.** Within half a second of a valid link the field shows what it points at, before anything is
   downloaded: `owner/repo`, its description, "Public · about 40 MB", and, for a `/tree/<branch>/<folder>` link,
   "the apps/web folder on branch main". Source: GitHub's public API when it answers (no token, 60 requests an
   hour is plenty), `git ls-remote` as the authority either way. An unrecognisable string just stays a name.
3. **Where it goes.** Folder: `<sites folder>/<repo>`. The sites folder is asked for once, the first time either
   New site or a clone runs, prefilled with `~/Sites` (created if missing, and outside the folders macOS asks
   permission for), and shown afterwards as a quiet "in ~/Sites · Change" line under the field. New site uses the
   same folder, so the per-site folder picker goes away for both.
4. **One button: "Add site".** Then a single progress line with a bar, not a log:
   *Downloading… 45%* → *Installing packages…* → *Starting the preview…*. The log stays available behind
   "Details" for whoever wants it. Cancel is live the whole time and leaves nothing on disk.
5. **Done.** The dialog closes, the site is selected, the preview is running. If the project has no dev command,
   or install cannot clear, the existing hand-off runs ("Set up the preview": Claude's first task), exactly as it
   does for a folder today (session 18, session 28).

### 8e.2 What the link can be

Parsed in Rust (`sites::parse_repo_url`), unit-tested, accepting what people actually copy:

| Pasted | Clones | Site folder |
|---|---|---|
| `https://github.com/owner/repo` (with or without `.git`, trailing `/`, `?tab=…`, `#readme`) | https URL | repo root |
| `github.com/owner/repo`, `owner/repo` only when it came with `github.com` | https URL | repo root |
| `https://github.com/owner/repo/tree/<branch>/<path>` | https URL, that branch | `<path>` inside the clone (D5 already scopes git to a subfolder) |
| `https://github.com/owner/repo/blob/…` | https URL | repo root (a file link means the repo) |
| `git@github.com:owner/repo.git` | kept as SSH | repo root |
| `gh repo clone owner/repo` (a copied command) | https URL | repo root |
| any other `https://…` ending in `.git` (GitLab, Bitbucket, self-hosted) | as given | repo root, no preview card |

A branch name with a slash (`feature/x`) is resolved by matching the longest `/tree/…` prefix against
`git ls-remote --heads`, so `/tree/feature/x/apps/web` finds the branch before the folder.

### 8e.3 Already have it?

- Folder exists and its `origin` is the same repository → it is that site: add it (or select it if already in
  the rail) and say "You already had this one". No download.
- Folder exists and is something else → `<repo>-2`, shown in the "in ~/Sites" line before the button is pressed.
- A site already in the rail with the same `origin` elsewhere on disk → select it; the dialog says where it is.

Nothing is ever overwritten or merged into an existing folder.

### 8e.4 Rust

- `sites::parse_repo_url(&str) -> Option<RepoRef { clone_url, owner, repo, branch, subdir, host }>`.
- `sites::repo_info(&RepoRef)` for the preview card: GitHub API with the `reqwest` already in Cargo.toml, 3 s
  timeout, failure is silent (the card just shows `owner/repo`).
- `sites::clone_repo(repo, parent, path_env, on_progress) -> Site`, mirroring `create_from_starter`:
  1. `git ls-remote --heads <url>` first, with `GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND="ssh -o BatchMode=yes"` and
     `LC_ALL=C`, so a private, missing or unreachable repository fails in a second, in English, before any folder
     exists; the branch list it returns resolves `/tree/…`. Then `git clone --progress [--branch b] <url> <dest>` in its
     own process group. *Changed while building:* this said `--filter=blob:none`, but a partial clone downloads the
     files at checkout with no progress output at all (measured on vercel/commerce: the bar would sit at 100% for the
     longest part of the wait), so the clone takes the full history and the bar stays honest.
  2. Progress: split stderr on `\r` and `\n`, map `Receiving objects: NN%` to 0–85% and `Resolving deltas` /
     `Updating files` to 85–100% of the download phase. Emitted as `clone://progress {phase, percent, line}`.
  3. `Site::from_path(dest or dest/subdir)`, `mark_trusted`, then install through the same code as `run_install`
     when `needs_install` (streamed into the same progress line), then return. The UI starts the dev server as
     `selectSite` already does.
  4. Failure or cancel at any step before the site is saved removes `dest` — the same rule New site follows.
- `site_clone(url, parent)` and `site_clone_cancel()` commands; cancel kills the process group (the publish
  cancel pattern). `sitesFolder: Option<String>` in `Persisted`, read and written through `settings_get/set`.
- Errors, classified from recorded git output (tests carry the exact lines):

| git says | The dialog says | Offers |
|---|---|---|
| `fatal: could not read Username for 'https://github.com': terminal prompts disabled` | This repository is private, or the link is wrong. | Sign in to GitHub (8e.5) |
| `remote: Repository not found.` | GitHub can't find it. Check the link, or ask the owner to give your account access. | Try again |
| `Could not resolve host` / connection timed out | You seem to be offline. | Try again |
| `Permission denied (publickey)` (SSH link) | This Mac has no SSH key for GitHub. | Use the https link instead (one click, same repo) |
| git missing / Xcode stub | The Checklist line for git, in the dialog, instead of the field | — |
| anything else | The last line of git's output | Details |

### 8e.5 Private repositories

Recorded on this Mac: with no stored credentials git stops at the username prompt; with the Keychain helper it
just works. So, in order:

1. **Whatever git already has.** Clone first with the user's own credential helpers (osxkeychain ships with both
   Apple's and Homebrew's git). Most people who have ever pushed from this Mac never see step 2.
2. **`gh` if signed in.** On the "private" error, if `gh auth status` succeeds, retry once with
   `-c credential.helper='!gh auth git-credential'`. No UI.
3. **Sign in to GitHub** (the button). GitHub's OAuth device flow: the dialog shows an 8-character code with
   "Copy and open GitHub", polls until the user approves, then hands the token to `git credential approve` so it
   lands in the macOS Keychain under github.com. The clone retries by itself. Supasito keeps no token of its own:
   after this, git — including Publish's push — authenticates the same way it would for a terminal user.
   *Needs from you:* a GitHub OAuth App owned by the Supasito account with device flow enabled; only its public
   client id ships in the app (device flow has no secret). This is the one piece that touches the network beyond
   github.com's own git endpoints, and it creates no Supasito account (§3 still holds).

*Built:* all three. Step 3 is compiled in only when `SUPASITO_GITHUB_CLIENT_ID` is set at build time
(`.env.release`); a build without it says "download it once with GitHub Desktop, then use Open a folder" instead of
offering the button. The OAuth App does not exist yet, so step 3 has not run against GitHub.

### 8e.6 Trust

Pasting a link is the same decision as opening a folder (D8): the site's `.claude/settings.json` applies, its
install scripts and dev command run. For someone else's repository that is a real choice, so the preview card says
it in one line — *"Supasito will run this project's code on your Mac."* — and nothing more. No second dialog.

### 8e.7 Mock and tests

- Mock: `?clone=private|missing|offline|ssh|exists|slow` (slow = a 10 s download with real progress ticks),
  `?sitesFolder=unset` for the first-run folder question.
- `cargo test`: URL table above, `/tree` branch-with-slash resolution against a fake heads list, progress parsing
  from a recorded stderr, error classification from the recorded lines in 8e.4.
- `cargo test -- --ignored clone_public`: clones octocat/Hello-World into a temp dir and asserts a Site comes back
  with `is_git` and no leftover on cancel.

### 8e.8 Acceptance

- In the mock, every row of the error table reaches its message and its button works; cancel mid-download leaves
  `window.__mock` with no site and no folder.
- In the release app: paste a public Next repo link and a public Astro monorepo `/tree/main/apps/web` link, both
  reach a running preview with no other input than the first-time folder.
- A private repo of yours clones on this Mac with no prompt (step 1), and under a fake `HOME` it shows the private
  error rather than hanging.
- The §9 v0.2 fresh-account walk includes a pasted link.

### 8e.9 Cut

A list of your GitHub repositories to pick from, a branch picker, forking, "Open in Supasito" buttons or a
`supasito://` link handler, GitLab- or Bitbucket-specific previews, Git LFS setup, and cloning into an existing
non-empty folder. Each is a surface; none gets a person from a link to a preview any faster.

## 9. Roadmap

Each version is a claim you can make honestly when it ends, not a feature list. The thesis holds:
almost everything below is confidence, not surface. Anything that would add a pane, a mode or a
concept to learn belongs in §9a, not here.

**v0.1 — it exists, and it installs. (Now.)** Signed with a Developer ID, notarized, stapled;
Gatekeeper opens it with no warning. Used seriously by one person, on one machine, on two real sites.
The honest claim stops there.

**v0.2 — usable by someone who isn't you.** The six items in §8. Ordered by what blocks what:

1. *The week on the release app* (§8.1). Everything else is guesswork until this runs, because it is
   the only step that can surface a fault nobody thought to test for. Papercuts land in §8c.
2. *Links and clipboard proved in the Tauri window.* Session 22 rebuilt the checklist around external
   links and click-to-copy commands, then noted that neither was tried in the real webview — only in
   the browser mock. The whole first-run story rests on them, so this is the cheapest high-value check
   left and it gates item 3.
3. *A fresh macOS user account reaches a working preview* following only the app's own text (§8.2's
   open acceptance). A new account is the honest test: no Homebrew, no Node, no Claude Code, no git
   identity. Session 22 wrote a line for each of those; nobody has walked the whole path.
4. *A second Mac runs the zip* (§8.4's remainder). Different hardware, different macOS, no developer
   tools. The notarized zip makes this a five-minute test on any Mac you can borrow.
5. *Auto-update.* Moved up from the old backlog, and the one addition to §8. It was deferred while
   there was nothing to distribute; now a signed build can reach other people, and a fix that cannot
   reach them is not shipped. Signing was its prerequisite and is done: Tauri's updater plugin signs
   the manifest with the same Developer ID and can serve it from GitHub Releases. It costs one new
   surface, a "restart to update" line, which is the least the loop can pay for staying current.
6. *The rest of §8's remainders*: rate limit provoked rather than inferred from the CLI's strings,
   `undoTurn`'s UI guards and site switching exercised in the Tauri window rather than the mock.

The claim at the end: a person who is not you installs Supasito, follows only what the app tells them,
and publishes a site without asking you anything.

**v0.2.1 — two agents, one app.** 0.2.0 shipped Codex as a second agent (CODEX.md, session 31) and the
seams showed within a day: the model list is a snapshot of one CLI version (codex 0.154.0 already
defaults to a model Supasito cannot show), and changing agent mid-conversation splits the conversation
in two. §8d has the plan: the list comes from `model/list` and a served catalogue, and a conversation is
a chain of backend sessions shown as one. The claim: you pick any model either CLI offers today, and
the rail never shows you the seam between them.

**v0.2.2 — a GitHub link is a site.** Today a repository reaches Supasito only through a terminal, which is
the one step before *say* a non-technical person cannot take. §8e has the plan: the New site field also takes a
link, the app clones, installs and starts the preview, and private repositories use the credentials git already
has before asking anyone to sign in. The claim: paste a link from the browser, see the site running.

**v0.3 — survives other people's projects.** Everything so far assumes projects shaped like yours.
Known holes, all from §7: a monorepo with the site at the repository root, Nuxt with a custom srcDir,
and the frameworks exercised exactly once each from a fresh scaffold rather than from a real codebase.
Session listing also re-reads every JSONL head on each site switch, which is fine at a few dozen
sessions and not at a few hundred; caching by file mtime is the fix and belongs here, when people with
long histories exist. The claim: someone points Supasito at a project you have never seen and it works,
or says precisely why not.

**v0.4 — honest over a long session.** Two numbers the app shows have never been watched end to end:
context fullness through a full 200k window with a real compaction, and fast mode actually running at
`usage.speed: "fast"` rather than reporting that it is on. Both are currently argued from the CLI's
schema and the docs. Cost per turn has the same shape of risk. The claim: the numbers by the composer
are ones you would defend.

**v1.0 — recommendable.** Nothing new; the previous three held up under other people's use for long
enough that you would tell a stranger to install it. Windows is the open question at this point, and
the answer may stay no. macOS-first is a decision (D9), not an accident, and a second platform costs
the WebView2 mixed-content policy, the all-frames injection, process groups and the Dock APIs.

## 9a. Not on the roadmap (deferred on purpose)

- Windows build (WebView2 mixed-content policy, all-frames script, process groups; no Dock APIs).
  Revisited at v1.0, not before.
- Second agent backend behind the same `agent://` events — **now being built on the `codex-backend`
  branch**, plan and edge cases in CODEX.md. The boundary held: one enum in agent/mod.rs, one reducer
  in src/agent/codex.ts, no new pane. Whether it ships before v0.2 closes is the positioning call CODEX.md §2 names.
- Everything on the §2 cut list: Inbox, Workflows, Agents, CMS, Brand, Campaigns, custom views,
  multiplayer, analytics. Still cut.

## 10. Sources

Webflow Source: https://webflow.com/source · HF0 / Dave Fontenot: https://tv.nyse.com/videos/hf0-ceo-dave-fontenot-on-a-unique-approach-to-vcs · Claude Code headless and control protocol: https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/agent-sdk/user-input · Tauri 2: https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html
