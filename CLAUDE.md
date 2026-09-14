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
  Mock switches: `?tools=missing|nologin|nonode|oldnode|nogit|nogitpath|nogitid|nopnpm` (`&brew=no` hides the
  `brew install` lines), `?sites=none|two|many`, `?dev=taken[:unknown|:site]` (port held by
  another program / something unnamed / the second site), `?dev=none` (no dev command until a turn ran), `?devDelay=<ms>` and
  `?stopDelay=<ms>` (dev-server start/kill timing; `window.__mock.devs` is the registry), `?context=full`, `?fast=on`,
  `?update=found|error` (a newer version announced / the check failing), `?clone=private|missing|offline|ssh|install|slow|exists`
  (how a pasted GitHub link fails or lands), `?sitesFolder=unset` (first run: the dialog says where sites live), `?signin=off`
  (a build without a GitHub client id), `?sync=updated|behind|failed` (what opening the first site finds against GitHub),
  `?env=missing` (the first site lacks secrets its .env.example lists), `?copy=elsewhere` (a pasted link is already in ~/code),
  `?trust=ask` (the first site brought hooks and an MCP server and waits for Use them), `?clone=hooks` (a pasted repository arrives that way),
  `?infoDelay=<ms>` (how long GitHub's details for a pasted link take; the card and Add site must not wait for them).
- `pnpm test` = route mapping + transcript reducer (node --experimental-strip-types) + `cargo test`.
  Test files are excluded from the app tsconfig. `cargo test -- --ignored` also creates a real site
  from the starter (runs pnpm install).
- Real-CLI checks: `SUPASITO_SMOKE_PROMPT=… pnpm tauri dev` (see src-tauri/src/smoke.rs; scenarios
  `queue|interrupt|pointing|mode|model|fast|undo|tools|ports`, `SUPASITO_SMOKE_SITE_PATH` for a scratch site, `SUPASITO_SMOKE_MODEL=haiku`).
  The built debug binary can be run directly with a fake `HOME` (signed out, empty app state) or
  `SUPASITO_PATH=/usr/bin:/bin` (bare Mac) while `pnpm dev` serves the UI on 1420.
- Recording a CLI failure shape: `ANTHROPIC_BASE_URL=http://127.0.0.1:9 claude -p … --output-format stream-json`
  for offline (10 retries, ~3 min), `HOME=<empty dir>` for signed out. Put the recorded lines in a reducer test.
- `pnpm release --install --zip` builds, installs and zips. Signing and notarization are on when
  `.env.release` sets the Apple variables listed at the top of `scripts/release.sh` (Developer ID
  identity + App Store Connect API key; key material lives outside the repo, nothing secret in git).
  Without them the same command still produces the unsigned "underground" build.
- `pnpm release [--install]` builds Supasito.app (and copies it to /Applications).
- **The release-app trial is running** (PLAN §8.1): the user works in `/Applications/Supasito.app`,
  not `tauri dev`. Do not start `pnpm tauri dev` without saying so — the two share the app-state
  file. A fix only reaches the installed app after `pnpm release --install`. Papercuts go in PLAN §8c.

## Where things are
- `src-tauri/src/agent/claude.rs` — the only place that speaks Claude Code's stream-json control
  protocol (verified on 2.1.257: `--permission-prompt-tool stdio` → `control_request/can_use_tool`).
  Keep protocol details here; the UI only sees `agent://message|permission|exit` events.
- `src-tauri/src/agent/codex.rs` — the only place that speaks Codex's app-server protocol (JSON-RPC over stdio,
  verified on codex-cli 0.149.0): one app-server per site, thread ids carried as `codex:<id>`, approvals shimmed
  into the Claude-shaped `agent://permission` request. `src/agent/codex.ts` is its reducer; the fixture comes
  from `node scripts/codex-probe.mjs <scratch repo>`. The model picker is the backend picker (`is_codex_model`).
  CODEX.md is the plan and the edge cases. Smoke on Codex: `SUPASITO_SMOKE_MODEL=gpt-5.6-luna` with the debug
  binary, `HOME=<empty dir> CODEX_HOME=~/.codex SUPASITO_PATH=$PATH` (see smoke.rs).
- `src-tauri/src/models.rs` — the model catalogue: Codex's from `model/list` (fixture from 0.154.0), Claude's from
  `supasito.com/updates/models.json` fetched with the update check (`pnpm release` writes it via `scripts/models-json.mjs`);
  both cached in the app state. `src/models.ts` reads that cache with `BUILTIN_MODELS` as the floor; never add a model
  to the UI by hand elsewhere. Mock: `?models=stale|fresh|fail`.
- `src-tauri/src/agent/sessions.rs` `fold_chains` — a conversation that changed agent is a chain of backend sessions
  (`Site.continuations`, written by `start_agent`); the rail shows the tail under the head's title, the store replays
  the segments under `handoff` dividers (`concatSegments` in transcript.ts). Mock: the "Rework the pricing page" row,
  `?chain=broken`.
- `src-tauri/src/toolchain.rs` — first-run checks (Node, pnpm/npm, git, Claude Code + `claude auth status`).
  The UI's `Checklist.tsx` renders it; the mock simulates each failure with `?tools=…` (list under `pnpm dev` above).
- `src-tauri/src/updates.rs` — the only request the app makes on its own: once a day it asks
  `supasito.com/updates/latest.json` (GitHub Releases is the fallback when the site 404s or is down) whether
  a newer version exists, and Settings → Updates turns it off. It carries version, target and arch in the URL
  and no identifier, so counting that route is also how many installs ran that day (WEBSITE.md §4.6). Debug
  builds never check on their own, so development does not inflate the count; "Check now" still works there.
  `pnpm release` signs `Supasito.app.tar.gz` with the key in `.env.release` and writes `release/latest.json`;
  `cargo test -- --ignored updater_package` checks that key against the pubkey shipped in tauri.conf.json,
  which is the one mismatch that would silently break every future update.
- `src-tauri/src/clone.rs` — a site from a pasted repository link (PLAN §8e). `parse_repo_url` is mirrored by `src/repo.ts`
  (same test table in both); GitHub's public API fills the card; `git ls-remote` runs before anything is written, then
  `git clone --progress` (full history: a partial clone fetches the files at checkout with no progress output) with prompts
  off and `LC_ALL=C`, so `classify` can name the failure from git's English. Credentials: git's own helpers plus the
  Keychain, then `gh auth git-credential`; Sign in to GitHub is the OAuth device flow, and its token goes into the Keychain
  through `git credential approve`, never into app state. The client id is compiled in from `SUPASITO_GITHUB_CLIENT_ID`
  (`.env.release`; debug builds also read it at run time) and without one the button is not offered. The UI is
  `AddSiteDialog` (Dialogs.tsx, one field for a name or a link); ⌘V with a link outside a text field opens it (App.tsx).
  Network test: `cargo test -- --ignored clone_public`.
- `src-tauri/src/remote.rs` — continuing a site that lives on GitHub (PLAN §8e.11): `sync` (fetch, ahead/behind, fast-forward only
  when nothing of the user's is in the way; tested against local bare repositories), `default_branch` from `origin/HEAD`
  (a downloaded site, `Site.cloned_from`, publishes with `git push`), `env_needs`/`env_save` (secrets an example env file
  lists, written straight to `.env.local` or `.env`, mode 600, gitignored), and `find_local_copies` over `CODE_FOLDERS`
  (never `~/Documents`, `~/Desktop` or `~/Downloads`, which make macOS ask for permission).
- `src-tauri/src/devserver.rs` — dev-server supervisor. A port counts as free only if it binds *and* refuses a
  connection (a wildcard listener passes a loopback bind on macOS), and as ready only when the listener is in our own
  process group. Readiness must stay dual-stack
  (Vite/Astro bind `[::1]` only); the port the server prints wins, and when it prints nothing we can parse,
  `lsof` says which port our own process group listens on and that wins instead (python buffers its banner
  behind the pipe). Only a dev command that recognises `{port}` gets one — see `sites.rs`.
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
  PNG/icns/ico set from `icons/default-1024.png`, Icon Composer's 1024px export. Design source: see CHANGELOG session 15.
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
