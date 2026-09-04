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
