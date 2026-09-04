# Open — notes for agents working on this repo

Open is a macOS desktop app (Tauri 2, Rust core, React UI) that builds websites by driving the
user's own Claude Code binary. Read PLAN.md for the current state, decisions and next milestone;
CHANGELOG.md for what was built and verified when; README.md for usage.

## The one rule
Every feature must shorten the loop *say → change → see → approve → publish*. If a change adds a
surface that isn't part of that loop, don't build it (see the cut list in PLAN.md).

## Run, test, ship
- `pnpm install` once. `pnpm tauri dev` runs the app with hot reload; Rust edits relaunch it, which
  kills running agents and dev servers (they are reaped on the next launch).
- `pnpm dev` alone serves the UI at http://localhost:1420 against a **mock backend** (src/mock.ts) —
  use this for UI work and browser-driven checks; `window.__store` exposes the zustand store in dev.
- `pnpm test` = route mapping + transcript reducer (node --experimental-strip-types) + `cargo test`.
  Test files are excluded from the app tsconfig. `cargo test -- --ignored` also creates a real site
  from the starter (runs pnpm install).
- Real-CLI checks: `OPEN_SMOKE_PROMPT=… pnpm tauri dev` (see src-tauri/src/smoke.rs; scenarios
  `queue|interrupt|pointing`, `OPEN_SMOKE_SITE_PATH` for a scratch site, `OPEN_SMOKE_MODEL=haiku`).
- `pnpm release [--install]` builds Open.app (and copies it to /Applications).

## Where things are
- `src-tauri/src/agent/claude.rs` — the only place that speaks Claude Code's stream-json control
  protocol (verified on 2.1.257: `--permission-prompt-tool stdio` → `control_request/can_use_tool`).
  Keep protocol details here; the UI only sees `agent://message|permission|exit` events.
- `src-tauri/src/devserver.rs` — dev-server supervisor. Readiness must stay dual-stack
  (Vite/Astro bind `[::1]` only); the port the server prints wins.
- `src-tauri/src/picker.js` — injected into every frame (`initialization_script_for_all_frames`);
  posts selections to the parent. Server Component owners come from React 19 component-info objects.
- `src/agent/transcript.ts` — reducer from stream-json to transcript items. Items are immutable
  (replace, never mutate) because rows are memoised.
- `src/routes.ts` — file → route mapping for follow-the-page.
- `starters/next/` — the bundled "New site" starter (Next 16 + Tailwind 4). Commit files that
  `next dev` rewrites (tsconfig, CLAUDE.md block) so a fresh site starts clean.

## Conventions
- No Node sidecar, no Agent SDK: spawn the user's `claude`. No accounts, no cloud.
- Sites are folders; per-site config is `open.json` (`name`, `dev`, `publish`, `preview`).
- Git is the history: pending count = `git status`, undo = `git checkout`, publish may commit/push.
- App state is one JSON file in the app data dir; transcripts stay in `~/.claude/projects`.
- macOS first. Anything platform-specific (capture, badge) lives behind `#[cfg(target_os)]`.
- After changing Rust: `cargo build` in src-tauri. After changing UI: `pnpm exec tsc --noEmit`.
