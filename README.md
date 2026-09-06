# Supasito

A small Mac app for building websites with the coding agent you already have. Three panes: your sites, a conversation with Claude Code, and a live preview. Say what should change (or click the element you mean), the agent edits the code, the preview updates, you approve anything risky, you publish.

Read [PLAN.md](PLAN.md) for the thesis, the research behind it, and the architecture decisions.

## Run it

Prerequisites for building Supasito: Rust (stable), Node 20+, pnpm, Xcode command line tools. To use it: [Claude Code](https://claude.com/claude-code) signed in, Node.js and git. Supasito checks for these on launch and shows one line per missing tool.

```bash
pnpm install
pnpm tauri dev
```

A production bundle (`Supasito.app` in `src-tauri/target/release/bundle/macos`):

```bash
pnpm release            # builds Supasito.app
pnpm release --install  # …and copies it to /Applications
```

`pnpm release --dmg` also builds a disk image (from an interactive terminal: the DMG step drives Finder).

## Distribute it

**Unsigned, for now.** `pnpm release --zip` writes `release/Supasito-<version>-macos.zip`. Whoever installs it drags `Supasito.app` to `/Applications` and, because the app is not notarized, clears the quarantine flag once:

```bash
xattr -dr com.apple.quarantine /Applications/Supasito.app
```

(or opens it once, dismisses the warning, then System Settings → Privacy & Security → "Open Anyway"). Nothing else differs from a signed build.

**Signed and notarized, later.** The Tauri CLI signs and notarizes when these variables are set; put them in `.env.release` (gitignored) and `pnpm release` picks them up. It needs a *Developer ID Application* certificate (paid Apple Developer membership), not the *Apple Development* one Xcode creates for free:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"  # from Xcode → Settings → Accounts → Manage Certificates; `security find-identity -v -p codesigning` lists it
APPLE_ID=you@example.com          # the Apple ID of that developer account
APPLE_PASSWORD=xxxx-xxxx-xxxx-xxxx  # an app-specific password from appleid.apple.com, not your real one
APPLE_TEAM_ID=TEAMID
```

Then `pnpm release --dmg` from an interactive terminal: the app is signed with the hardened runtime, submitted to Apple's notary service, stapled, and packed into a DMG. The script prints whether it is signing and notarizing and verifies the signature afterwards. This path is set up but has not yet been exercised with a real Developer ID (see PLAN.md).

## How it works

- **A site is a folder** with a dev server. Supasito detects Next.js, Astro, Vite, SvelteKit and Nuxt from `package.json`, or reads `open.json`:
  ```json
  { "name": "My site", "dev": "node_modules/.bin/next dev -p {port}", "publish": "vercel deploy --prod --yes" }
  ```
- **Sessions are Claude Code sessions.** Supasito drives your `claude` binary over its stream-json protocol, so your login, skills, MCP servers and CLAUDE.md all apply. Transcripts stay in `~/.claude/projects`, where `claude --resume` also finds them.
- **The preview is an iframe** of the dev server. A small script injected into every frame powers the element picker; a selection carries the element's tag, classes, text, computed styles and, when the framework exposes it, its source file and React component chain.
- **Publish runs one command** and shows you the URL. The pending-change count is `git status`.
- **Undo a turn** puts the files that turn wrote back to their committed state and removes files the turn created; other untracked files are left alone. Needs git in the folder. Git is the history; there is no separate undo stack.
- **Images:** paste or drop a screenshot into the composer and Claude receives it with your message ("make it look like this").
- **Queueing:** you can keep typing while Claude works; Enter queues the message and it is sent when the current turn ends. Escape stops the current turn.
- **Publish** offers two targets: **Preview** (a shareable test link; the live site doesn't change) and **Production**. Each is one command in `open.json` (`preview`, `publish`), with presets for Vercel, Cloudflare, Netlify and git push. The dialog can commit the pending changes first (message prefilled from your last request) and push to `origin`, so publishing doubles as a backup. A running publish can be cancelled.
- **What changed:** "N files changed" on a turn's completion line opens the diff for that turn.
- **Show Claude the preview:** the camera button in the preview toolbar attaches a screenshot of the preview pane to your next message. It uses the webview's own snapshot, so there is no permission prompt.
- **Site rules:** the book icon on the current site opens its `CLAUDE.md` (voice, brand, what not to touch) in a dialog. Double-click a site to rename it.
- **First-run checks:** on launch Supasito looks for Claude Code (and whether it is signed in, via `claude auth status`), Node.js, git and a package manager. Anything missing gets one line saying how to get it, in the session pane, the welcome screen and Settings. **New site** installs with pnpm when it is present and with npm otherwise (the starter's permission rules are rewritten to match).
- **Slash commands:** type `/` in the composer to pick from the skills and commands your Claude Code reports for the session.
- **Permission mode per session:** the bar under the conversation switches a running session between "Ask before commands", "Don't ask this session", "Plan first" and "Ask about everything".
- **One dev server at a time:** switching sites stops the previous site's dev server unless one of its sessions is still working.
- **Getting called back:** the Dock badge shows how many approvals are waiting, and the Dock icon bounces when Claude needs you or finishes while Supasito is in the background.
- **Model, effort, fast mode:** Settings holds the defaults for new sessions: the exact model (Fable 5.1, Opus 5, Sonnet 5, Haiku 4.5, or any name or alias Claude Code accepts, with a `[1m]` checkbox for the 1M-token context), the effort level (`low` … `max`, how long Claude thinks) and fast mode (Opus only: same model, up to 2.5× faster output, about twice the cost). "Your Claude Code default" names what `~/.claude/settings.json` says. The chips in the bar under the conversation show the exact model id the CLI reported and change model, effort and fast mode for that session alone; a running session takes the change on its next turn (Claude Code restarts with the new flags if it can't apply it live). A turn's completion line adds the model when it differs from the session's and `fast` when the request ran in fast mode.
- **Reasoning:** every reply carries Claude's thinking summary. It streams open while Claude thinks and folds into a collapsed "Thinking" row once the answer starts. (Claude Code withholds the text in headless mode unless asked; Supasito asks with `--settings '{"showThinkingSummaries":true}'`.)
- **The preview follows the work:** when Claude edits a page file (`app/pricing/page.tsx`, `src/pages/pricing.astro`, `src/routes/pricing/+page.svelte`, `pages/pricing.vue`), the preview switches to that page.
- **Usage:** the small ring at the bottom of the composer shows how full the conversation is (how much of Claude's working memory this session uses; it fills as the conversation grows and Claude Code summarises older messages by itself when it is full). Click it for the numbers, your plan's 5-hour and weekly limits with their reset times, and the cost so far. Settings shows the plan limits too, and the header chip still appears once a plan limit passes 50%.

## Layout

```
src/            React UI (rail · session · preview)
src-tauri/      Rust core: agent bridge, dev-server supervisor, sites, publish
starters/next/  the bundled "New site" starter (Next.js 16 + Tailwind 4)
```

## Keyboard

- Enter sends (or queues while Claude works), Shift+Enter inserts a newline.
- Escape cancels picking, or stops the current turn.
- ⌘⇧E toggles the element picker; ⌘N starts a new session; ⌘, opens Settings.

## Debug smoke tests

Run real Claude Code turns inside the app process and print the protocol traffic. Scenarios: `prompt` (default), `queue`, `interrupt`, `pointing`.

```bash
OPEN_SMOKE_PROMPT="Change the hero headline to say Hello" pnpm tauri dev
OPEN_SMOKE_SITE_PATH=/path/to/site OPEN_SMOKE_MODEL=haiku OPEN_SMOKE_SCENARIO=queue OPEN_SMOKE_PROMPT=x pnpm tauri dev
```

`OPEN_SMOKE_SITE_PATH` registers a folder for the run without saving it; `OPEN_SMOKE_SITE` picks a registered site by name. Debug builds only.

## Tests

```bash
pnpm test                                        # transcript reducer (recorded stream), route mapping, Rust unit tests
cd src-tauri && cargo test -- --ignored          # also creates a real site from the starter (runs pnpm install)
```

Launching the app from a terminal prints `[preview] …` diagnostics when the preview iframe loads.

## Browser-only UI work

`pnpm dev` and open http://localhost:1420 in a browser: without Tauri, the UI runs against a mock backend with a demo site and a scripted agent.
