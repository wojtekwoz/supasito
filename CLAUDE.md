# Supasito — notes for agents working on this repo

Supasito is a macOS desktop app (Tauri 2, Rust core, React UI) that builds websites by driving the
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
  Mock switches: `?tools=missing|nologin|nonode|nogit|nopnpm`, `?sites=none|two`, `?devDelay=<ms>` and
  `?stopDelay=<ms>` (dev-server start/kill timing; `window.__mock.devs` is the registry), `?context=full`, `?fast=on`.
- `pnpm test` = route mapping + transcript reducer (node --experimental-strip-types) + `cargo test`.
  Test files are excluded from the app tsconfig. `cargo test -- --ignored` also creates a real site
  from the starter (runs pnpm install).
- Real-CLI checks: `SUPASITO_SMOKE_PROMPT=… pnpm tauri dev` (see src-tauri/src/smoke.rs; scenarios
  `queue|interrupt|pointing|mode|model|fast|undo|tools`, `SUPASITO_SMOKE_SITE_PATH` for a scratch site, `SUPASITO_SMOKE_MODEL=haiku`).
  The built debug binary can be run directly with a fake `HOME` (signed out, empty app state) or
  `SUPASITO_PATH=/usr/bin:/bin` (bare Mac) while `pnpm dev` serves the UI on 1420.
- Recording a CLI failure shape: `ANTHROPIC_BASE_URL=http://127.0.0.1:9 claude -p … --output-format stream-json`
  for offline (10 retries, ~3 min), `HOME=<empty dir>` for signed out. Put the recorded lines in a reducer test.
- `pnpm release --install --zip` = the unsigned "underground" build; signing needs a Developer ID (see README).
- `pnpm release [--install]` builds Supasito.app (and copies it to /Applications).

## Where things are
- `src-tauri/src/agent/claude.rs` — the only place that speaks Claude Code's stream-json control
  protocol (verified on 2.1.257: `--permission-prompt-tool stdio` → `control_request/can_use_tool`).
  Keep protocol details here; the UI only sees `agent://message|permission|exit` events.
- `src-tauri/src/toolchain.rs` — first-run checks (Node, pnpm/npm, git, Claude Code + `claude auth status`).
  The UI's `Checklist.tsx` renders it; the mock simulates each failure with `?tools=…` (list under `pnpm dev` above).
- `src-tauri/src/devserver.rs` — dev-server supervisor. Readiness must stay dual-stack
  (Vite/Astro bind `[::1]` only); the port the server prints wins.
- `src-tauri/src/picker.js` — injected into every frame (`initialization_script_for_all_frames`);
  posts selections to the parent. Server Component owners come from React 19 component-info objects.
- `src/agent/transcript.ts` — reducer from stream-json to transcript items. Items are immutable
  (replace, never mutate) because rows are memoised. Also derives context fullness (the last API call's
  `usage` input + cache tokens; the result's `usage` is the turn's sum, don't use it) and per-turn cost
  from the CLI's cumulative `total_cost_usd` (0 on interrupt; reset when the process restarts).
- `src/app/Usage.tsx` — the usage ring by the composer, its popover, and the plan rows Settings shows.
- `src/routes.ts` — file → route mapping for follow-the-page.
- `src-tauri/icons/Supasito.icon` — the app icon, an Icon Composer document (the coral tile with the "s").
  `pnpm icon` compiles it with actool into `icons/Assets.car` (the layered icon macOS 26 draws in light,
  dark and tinted; `src-tauri/Info.plist` names it via `CFBundleIconName`) and regenerates the flat
  PNG/icns/ico set from `icons/default-1024.png`, Icon Composer's 1024px export. `Mark` in `Icons.tsx`
  is the same glyph, flat, for the rail. Design source: see CHANGELOG session 15.
- `starters/next/` — the bundled "New site" starter (Next 16 + Tailwind 4). Commit files that
  `next dev` rewrites (tsconfig, CLAUDE.md block) so a fresh site starts clean.

## Conventions
- No Node sidecar, no Agent SDK: spawn the user's `claude`. No accounts, no cloud.
- Sites are folders; per-site config is `supasito.json` (`name`, `dev`, `publish`, `preview`); a site that still has
  `open.json` from before the rename is read as is and moved to the new name on its next write (sites.rs `config_file`).
- Git is the history: pending count = `git status`, undo = `git checkout`, publish may commit/push. The site
  may be a subfolder of the repository; git commands run from the site folder and are scoped to it.
- App state is one JSON file in the app data dir; transcripts stay in `~/.claude/projects`.
- macOS first. Anything platform-specific (capture, badge) lives behind `#[cfg(target_os)]`.
- After changing Rust: `cargo build` in src-tauri. After changing UI: `pnpm exec tsc --noEmit`.
