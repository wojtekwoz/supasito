# Open

A small Mac app for building websites with the coding agent you already have. Three panes: your sites, a conversation with Claude Code, and a live preview. Say what should change (or click the element you mean), the agent edits the code, the preview updates, you approve anything risky, you publish.

Read [PLAN.md](PLAN.md) for the thesis, the research behind it, and the architecture decisions.

## Run it

Prerequisites: Rust (stable), Node 20+, pnpm, Xcode command line tools, and [Claude Code](https://claude.com/claude-code) installed and signed in (`claude` on your PATH).

```bash
pnpm install
pnpm tauri dev
```

A production bundle (`Open.app` in `src-tauri/target/release/bundle/macos`):

```bash
pnpm tauri build
```

Add `--bundles dmg` from an interactive terminal session if you want a disk image; the DMG step drives Finder and fails in headless shells.

## How it works

- **A site is a folder** with a dev server. Open detects Next.js, Astro, Vite, SvelteKit and Nuxt from `package.json`, or reads `open.json`:
  ```json
  { "name": "My site", "dev": "node_modules/.bin/next dev -p {port}", "publish": "vercel deploy --prod --yes" }
  ```
- **Sessions are Claude Code sessions.** Open drives your `claude` binary over its stream-json protocol, so your login, skills, MCP servers and CLAUDE.md all apply. Transcripts stay in `~/.claude/projects`, where `claude --resume` also finds them.
- **The preview is an iframe** of the dev server. A small script injected into every frame powers the element picker; a selection carries the element's tag, classes, text, computed styles and, when the framework exposes it, its source file and React component chain.
- **Publish runs one command** and shows you the URL. The pending-change count is `git status`.
- **Undo a turn** puts the files that turn wrote back to their committed state (and deletes files it created). Git is the history; there is no separate undo stack.
- **Images:** paste or drop a screenshot into the composer and Claude receives it with your message ("make it look like this").
- **Queueing:** you can keep typing while Claude works; Enter queues the message and it is sent when the current turn ends. Escape stops the current turn.
- **Publish command** is set from the Publish dialog (presets for Vercel, Cloudflare, Netlify, git push) and saved to `open.json`.
- **The preview follows the work:** when Claude edits a page file (`app/pricing/page.tsx`, `src/pages/pricing.astro`, `src/routes/pricing/+page.svelte`, `pages/pricing.vue`), the preview switches to that page.
- **Plan usage** from Claude Code's rate-limit events shows as a chip in the session header once it passes 50%.

## Layout

```
src/            React UI (rail · session · preview)
src-tauri/      Rust core: agent bridge, dev-server supervisor, sites, publish
starters/next/  the bundled "New site" starter (Next.js 16 + Tailwind 4)
```

## Keyboard

- Enter sends (or queues while Claude works), Shift+Enter inserts a newline.
- Escape cancels picking, or stops the current turn.
- ⌘⇧E toggles the element picker.

## Debug smoke tests

Run real Claude Code turns inside the app process and print the protocol traffic. Scenarios: `prompt` (default), `queue`, `interrupt`, `pointing`.

```bash
OPEN_SMOKE_PROMPT="Change the hero headline to say Hello" pnpm tauri dev
OPEN_SMOKE_SITE_PATH=/path/to/site OPEN_SMOKE_MODEL=haiku OPEN_SMOKE_SCENARIO=queue OPEN_SMOKE_PROMPT=x pnpm tauri dev
```

`OPEN_SMOKE_SITE_PATH` registers a folder for the run without saving it; `OPEN_SMOKE_SITE` picks a registered site by name. Debug builds only.

## Tests

```bash
pnpm test                                        # route mapping check + Rust unit tests
cd src-tauri && cargo test -- --ignored          # also creates a real site from the starter (runs pnpm install)
```

Launching the app from a terminal prints `[preview] …` diagnostics when the preview iframe loads.

## Browser-only UI work

`pnpm dev` and open http://localhost:1420 in a browser: without Tauri, the UI runs against a mock backend with a demo site and a scripted agent.
