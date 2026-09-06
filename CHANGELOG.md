# Open — build log

Session-by-session record of what was built, verified and fixed. The current plan lives in PLAN.md.

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

### Session 10 (2026-09-04)
- **Site rules dialog:** edits the site's `CLAUDE.md` from the rail (template offered when missing). This is where Webflow's "Brand" lives in Open: a file the agent reads.
- **Rename** a site inline (writes `open.json` name).
- **Slash-command autocomplete** from `system/init.slash_commands` + `skills`; Tab or Enter inserts.
- **Per-session permission mode** via `control_request{subtype:"set_permission_mode"}` (smoke scenario `mode`); the header shows the current mode from `system/init.permissionMode`.

## Backlog (deferred on purpose)
- **Windows build.** Needs a Windows machine to test WebView2's mixed-content policy for the localhost iframe, the all-frames init script, process-group handling and the missing Dock APIs. Everything platform-specific already sits behind `#[cfg(target_os)]`.
- **Second agent backend** (e.g. Codex CLI) behind the same `agent://` events.
- **Session list caching** (`sessions.rs` re-reads JSONL heads on every site switch; fine until a site has hundreds of sessions).

### Session 11 (2026-09-05) — review
Own pass plus an independent reviewer agent over the Rust and TypeScript. Fixed:
1. **Undo could delete files it didn't create** (untracked, gitignored, or from an earlier uncommitted turn) and accepted paths outside the site. Now: Rust reports, before each `Write` runs, whether the file already existed (`agent://fs`); Undo restores tracked files, deletes only files the turn created, leaves other untracked files alone and says so; every path must resolve inside the site; Undo requires git.
2. **Cancelling a publish during commit or push let the deploy run** and then reported "cancelled". Now the flow checks for cancel after every step and stops before deploying; Cancel stays clickable during the deploy itself.
3. A dev server that never opened its port left "Starting…" forever → after 90 s it becomes an error with a hint and a retry.
4. A queued message ended the previous turn's file list early and lost its "Queued" tag on the next tool step → queued messages are skipped when collecting a turn's files and are unqueued when the turn's result arrives.
5. git commit/push/diff/status/undo and session listing ran on the UI thread (a slow push froze the window) → now off-thread.
6. Switching sites quickly could attach the old site's session and dev server to the new one → guarded after every await.
7. Double-clicking Send on a new session started two Claude processes → in-flight guard, attachments cleared synchronously.
8. Removing a site left its Claude sessions running with unreachable approvals → sessions are stopped and dropped first.
9. Escape never interrupted (docs said it did) → it does, after dialogs and picking.
10. New-site creation reported a git failure as an install failure and left a half-made folder → separate steps; install failure removes the folder; git is best effort.
11. Unanswered approvals stayed "pending" after the turn ended or the process left → they expire and the Dock badge clears.
12. Errors the CLI returns to interrupt / set-mode requests were dropped → surfaced as a notice.
13. The readiness probe kept running after a stop and could report a killed server as ready → it exits when the child is gone.
14. The dev-start reply could overwrite a newer status → newer status wins.
15. `~/.claude.json` was rewritten non-atomically → write-then-rename.
Also from my own pass: the preview iframe kept the previous site's page path; reload double-loaded; Stop escalation could signal a recycled pid; a small per-screenshot leak; the last dev port was never remembered; push without commit is now disabled.

### Session 12 (2026-09-05) — v0.2 items 2, 3, 4 (groundwork), 5 (partly)
- **First-run checks.** New `toolchain.rs` reports Node (`node --version`), the package manager New site will use (pnpm, else npm), git (asks `xcode-select -p` before touching `/usr/bin/git`, which on a bare Mac is a stub that pops the "install command line tools" dialog), and Claude Code with its sign-in state from `claude auth status` (JSON, exit 1 when signed out; verified on 2.1.257). The UI shows a checklist with one line per missing tool: as the session pane when Claude Code is missing or signed out, on the welcome screen when there are no sites and something is missing, compact in Settings. The preview's "dev server didn't start" and "install dependencies" cards say when the cause is a missing Node. The check runs off the boot path so the window opens at once. Mock: `?tools=missing|nologin|nonode|nogit|nopnpm`, `?sites=none`.
- **npm fallback.** New site picks pnpm if on PATH, else npm (`--no-audit --no-fund`), before copying anything so a missing Node leaves no folder behind; with npm the starter's `.claude/settings.json` rules and CLAUDE.md are rewritten (`pnpm typecheck` → `npm run typecheck`, `pnpm exec tsc` → `npx tsc`; unit-tested). Installer output now streams into the New-site dialog. "Install dependencies" for an opened site falls back to npm when its lockfile's manager isn't installed and says so.
- **Failure paths, recorded for real:** signed out, Claude Code `-p` does not fail on stderr; it emits a synthetic assistant message (`error: "authentication_failed"`, text "Not logged in · Please run /login") and a `result{is_error:true, subtype:"success", terminal_reason:"api_error"}`, then exits 1. The reducer now drops the synthetic bubble and rewords the result ("run `claude auth login`"); the store re-runs the toolchain check so the checklist takes over. Offline (`fetch failed`) and rate-limit texts are reworded by pattern (not recorded); a `rate_limit_event{status:"rejected"}` adds one notice with the reset time. A failed publish whose output mentions login/credentials/401 now says "run `<cli> login` in this folder"; a missing CLI says how to install it. Tests added for the signed-out stream, offline text and rate-limit notice.
- **Signing/notarization groundwork:** `scripts/release.sh` reads `.env.release` (gitignored), prints whether it signs (`APPLE_SIGNING_IDENTITY`) and notarizes (`APPLE_ID`+`APPLE_PASSWORD`+`APPLE_TEAM_ID`, or the API-key trio), takes `--dmg`, and verifies the signature after the build; `tauri.conf.json` sets a minimum macOS of 12 and the DMG layout. README has the steps. Not exercised with a real Developer ID yet.
- Verified: `cargo test` (toolchain and npm-rule tests, the toolchain test runs against this machine), `pnpm test`, `tsc`, and the four checklist states in the mock UI by screenshot.

### Session 12, continued — doing the "left for you" items that don't need a human
- **Offline, recorded for real** (`ANTHROPIC_BASE_URL` pointed at a closed port): the CLI emits `system/api_retry` ten times with growing delays (0.5 s → 38 s, about 3 minutes in total) and only then the synthetic assistant message + `result{is_error}` with "API Error: Connection refused — a firewall or proxy may be blocking it (ConnectionRefused)". Open showed nothing but "Working…" for those 3 minutes. Now the Working row reads "Can't reach Claude's API; retrying in 4s (3 of 10). Esc stops the turn." (also worded for rate limiting, overload and 5xx from `error_status`/`error`), and the final text is reworded with the CLI's hint kept. The earlier pattern missed "Connection refused"; the recorded text is now a test.
- **Rate limit:** not provoked (it would burn the plan). The CLI's own list of API error texts was pulled from the binary ("rate limited", "overloaded", "529", "usage limit reached", "credit balance too low", "Please run /login", "Invalid API key", "401"); the rewording covers each.
- **Toolchain check in the real app** (`OPEN_SMOKE_SCENARIO=tools`, new): all green on this Mac; `HOME=<empty>` → `loggedIn:false, authMethod:"none"`; `OPEN_PATH=/usr/bin:/bin` (new debug-only override in `login_shell_path`) → Claude Code and Node not found, no package manager. Found and fixed: Apple's `git version 2.50.1 (Apple Git-155)` was parsed as "Git-155)".
- **Review fixes exercised:** a dev command that never opens its port (`open.json` with `sleep 300`) became an error after 90 s with the hint, and the child was killed (real app, smoke run). Cancel during commit (mock, via `window.__store`): commit completed, push skipped, deploy never ran, dialog shows "Stopped before deploying."
- **Signing: dropped for now** ("underground release"). The keychain has only an *Apple Development* identity; Gatekeeper on other Macs needs *Developer ID Application*. `pnpm release --zip` writes `release/Open-<version>-macos.zip` and prints the one-line quarantine fix for recipients; README says the same. The signing path stays in the script for later.

### Session 13 (2026-09-06) — usage and context fullness
- **Usage ring by the composer.** A 14 px ring at the right of the composer bar fills with the conversation's context use; grey and unlabelled below 50%, then the percentage, amber from 75%, red from 90%. Click: a popover with "N% of Claude's working memory · Xk of Yk tokens", what happens when it fills (Claude Code summarises by itself; ⌘N for a clean slate), the plan's 5-hour and weekly windows with reset times and meters, and the cost so far. Settings gets a read-only "Plan usage" block from the last rate-limit event any session received. The header chip is unchanged (alarm above 50%).
- **How context is counted:** the last API call's `usage.input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, the same rule as Claude Code's status line; `message_start` events update it as soon as a call starts, subagent calls and synthetic error messages are skipped. The window comes from the result's `modelUsage.<model>.contextWindow` (200k in every recording); before the first result it is 200k, or 1M for "[1m]" models. `system/compact_boundary` (stream-json `compact_metadata{pre_tokens, post_tokens?}`, saved JSONL `compactMetadata{preTokens, postTokens?}`) resets it and adds a notice; the Rust transcript loader now keeps those lines so a resumed session shows them.
- **Cost was a running total.** A two-turn probe against the real CLI (haiku, stream-json input) reported `total_cost_usd` 0.030972 then 0.0395562: cumulative for the process (the arithmetic matches haiku's 1-hour cache-write price), and 0 for an interrupted turn. The completion line now shows each turn's share; the popover shows the session total (since resume, when the transcript was re-rendered from disk). The same probe recorded the real `rate_limit_event` shape (`unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt}` plus `overageStatus`), which the mock already matched.
- Verified: reducer tests for context, cost deltas, interrupt, process restart, both compaction shapes and the plan windows; `tsc`; `cargo build` + `cargo test`; in the mock (`pnpm dev`): ring at 31% on a resumed session, popover after a turn, `?context=full` for the amber/red states and the compaction notice, Settings block.

### Session 14 (2026-09-06) — exact model, effort, fast mode, reasoning
- **What the CLI does, verified on 2.1.257 with `-p` probes** (recordings in `src/agent/fixtures/claude-2.1.257-thinking-summaries.jsonl` and `…-fast-mode.jsonl`, both reducer tests now): thinking text is withheld in headless mode (`{"type":"thinking","thinking":""}`, `thinking_delta` without text, `system/thinking_tokens` estimates) unless `--settings '{"showThinkingSummaries":true}'` is passed, and then the thinking block streams *before* the text and arrives as its own assistant message. Fast mode has no flag: `--settings '{"fastMode":true}'`, Opus only; `system/init` and `result` carry `fast_mode_state` (`on|off|cooldown`) and `fast_mode_disabled_reason` (`sdk_opt_in_required` without the opt-in), `result.usage.speed` says whether the request ran fast. `--effort low|medium|high|xhigh|max` works but is not reported back. The exact model id is in `system/init.model`, every assistant `message.model` and `result.modelUsage`. `--settings` merges over the user's own settings. A one-word Opus fast turn cost $0.257 against $0.034 on Haiku.
- **Reasoning.** Open always asks for thinking summaries. The reducer now keeps the row streaming through the thinking-only assistant message (before, that message ended streaming and the text deltas that followed were dropped until the full text arrived), tracks the streaming `phase`, and the row shows "Thinking…" with the summary while it streams, then folds into the collapsed "Thinking" row once the answer starts.
- **Exact model.** Settings lists real ids (Fable 5.1, Opus 5, Sonnet 5, Haiku 4.5, custom name or alias) with a `[1m]` checkbox; "Your Claude Code default" names the `model` and `effortLevel` read from `~/.claude/settings.json` (toolchain.rs). The header chip became a select showing the id the CLI reported; assistant items carry `model`; a turn's completion line names the model when it differs from the session's (or several ran) and adds `fast` when `usage.speed` was fast.
- **Effort and fast mode**, in Settings (defaults) and the header (per session; fast only when the model is Opus, with `cooldown` shown). Rust: `Persisted.effort`/`fast_mode`, `--effort`, `--settings`, `Overrides` on `agent_start`, `set_model` and `apply_flag_settings` control requests (`agent_set_model`, `agent_apply_settings`, both return the request id). Store: a change on an idle running session sends the control request; a `control_error` for that id (or a choice with no request form, such as "back to default") stops the process so the next message resumes it with the new flags; drafts and stopped sessions remember the choice for their start. Mock: thinking stream, `fast_mode_state`, `?fast=on`.
- New smoke scenarios `model` (set_model between two turns) and `fast` (apply_flag_settings between two turns), `OPEN_SMOKE_EFFORT`, `OPEN_SMOKE_FAST=1`.
- Verified: reducer tests on both recordings plus synthetic cases (thinking phase and streaming, exact ids, fast on/off/cooldown, `usage.speed`); `tsc`; `cargo test` (extra settings JSON, overrides, user defaults). Mock (`pnpm dev`): "Thinking…" streams then folds, header chips, `?fast=on` shows `Fast · on` on Opus, a draft's model/effort choices reach the started session, Settings shows "Your Claude Code default · claude-fable-5-1[1m]" / "· high". Real CLI (scratch site, `OPEN_SMOKE_SITE_PATH`): scenario `model` (haiku → `set_model sonnet`): the next turn's `system/init` and `message.model` were `claude-sonnet-5`; scenario `fast` (opus → `apply_flag_settings {fastMode:true, effortLevel:"low"}`): the next turn's init and result reported `fast_mode_state: "on"` (the one-word answer still ran at `usage.speed: "standard"`, as in the probe). The two smoke runs cost about $0.30 and $0.46.
- **Layout (user feedback, same day):** the model / effort / fast / permission-mode chips moved out of the title bar into a bar under the conversation, above the composer (`.knobs`), so the title bar holds only the title and Stop. The header's plan-usage chip was a second usage indicator next to the composer ring and is gone; the ring now colours by the worse of context and plan usage and names a plan window past 75% ("plan 82%"), with the reset time in its tooltip.
- Then, per feedback: the chips became icon-led dropdowns (`Pick`): a robot icon for the model, signal bars for effort, the word "Mode" for the permission mode, each showing its current value; Fast unchanged. Order: model, effort, mode, fast.
