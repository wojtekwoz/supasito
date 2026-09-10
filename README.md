# Supasito

Supasito is a Mac app for changing a website by describing the change. You tell Claude Code what you want, watch the live site update in the same window, and publish when it looks right. The site stays an ordinary code folder on your Mac: no accounts, no cloud, no file format of its own.

**Version 0.1. macOS only. Signed and notarized by Apple.** It has been used on one Mac so far. Read [What to expect](#what-to-expect) before you install.

## Is it for you?

Supasito fits if:

- You have a **Claude plan that includes Claude Code** (Pro, Max, Team or Enterprise) or an API key. The free plan does not include Claude Code.
- Your site is a **code project**: Next.js, Astro, Vite, SvelteKit or Nuxt. Or you want a new one; Supasito ships a Next.js starter.
- You can **run a few commands in Terminal** during setup.

It does not fit if your site lives in WordPress, Squarespace, Webflow or another hosted builder (there is no folder to edit), or if you use Windows or Linux.

## What you need

Supasito checks all of these when it starts and shows one line per missing tool, with the fix.

- **A Mac with Apple silicon (M1 or newer) on macOS 13 or later.** The ready-made zip is built on and for Apple silicon. The app itself allows macOS 12, but Claude Code needs 13.
- **Claude Code, installed and signed in.** Install it, then run `claude` once and finish the sign-in in your browser:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```

- **Node.js.** It runs your site's dev server. Get the LTS from [nodejs.org](https://nodejs.org) or run `brew install node`. npm comes with it.
- **git.** It keeps the history behind Undo and Publish. Apple's command line tools include it:

  ```bash
  xcode-select --install
  ```

- **pnpm, optional.** Faster installs for new sites. npm works otherwise.

## Install

Pick one of the two ways.

### From a zip

Use this when someone built `Supasito-<version>-macos.zip` for you (see [Build a zip for someone else](#working-on-supasito)).

1. Unzip it and drag **Supasito.app** into **Applications**.
2. Open Supasito from Applications. The build is signed and notarized, so macOS opens it after the
   usual "downloaded from the internet" confirmation. No `xattr` step.

### From source

You need Rust (stable), Node.js 20.19 or later (Vite's minimum), pnpm and Xcode's command line tools. The first build compiles the Rust core and takes a while.

```bash
git clone https://github.com/wojtekwoz/supasito.git
cd supasito
pnpm install
pnpm release --install
```

This builds `Supasito.app` and copies it into Applications. Nothing else on your Mac changes.

## First five minutes

1. **Open Supasito.** If a tool is missing you see a "Before you start" checklist. Fix what it names and click **Check again**. Otherwise you see "Open a site to begin".
2. **Pick a site.**
   - **New site** copies the bundled Next.js starter into a folder you choose, installs packages and opens a session. Describe the site in your first message.
   - **Open a folder…** points Supasito at a project you already have. It detects the framework, offers to install packages when `node_modules` is missing, and offers to set up git when the folder has none. In a monorepo, open the app's own folder (for example `apps/web`), not the workspace root.
3. **Wait for the preview.** The right pane shows the site as soon as its dev server is ready. The terminal icon in the preview toolbar shows the server's log.
4. **Ask for a change.** Type it and press Enter. Claude's steps stream in the middle pane ("Editing components/hero.tsx") and the preview reloads by itself.
5. **Approve when asked.** When Claude wants to run a command, a card appears with **Allow**, **Deny** and, when offered, **Always allow**. The turn waits for you.
6. **Publish.** Click **Publish** in the preview toolbar. The first time, pick a preset (Vercel, Cloudflare, Netlify, git push) or type your own command.

## Everyday use

**Saying what to change**

- **Enter** sends. **Shift+Enter** inserts a newline. **Esc** stops the current turn.
- **Keep typing while Claude works.** Enter queues the message; it runs when the current turn ends.
- **Paste or drop a screenshot** into the composer to say "make it look like this".
- **Camera button** in the preview toolbar attaches a screenshot of the preview to your next message.
- **Type `/`** to pick from your Claude Code skills and commands.

**Pointing at an element**

- Click the **crosshair** (composer or preview toolbar) or press **⌘⇧E**, then click the element in the preview. A chip lands in the composer; say what should change about it.
- Claude receives the element's tag, classes, text and styles, plus its source file (Astro) or React component chain (Next.js) when the framework exposes them.

**Watching the result**

- **The preview follows the page** Claude edits.
- **Device widths**: desktop, tablet (834 px) and phone (390 px). Reload and Open in browser sit next to them.
- **Full width**: the arrows button at the left of the preview toolbar, or **⌘\**, hides the sidebar and lets the page fill the window. The conversation floats over the bottom-left corner, as small as it gets, so you can keep talking: drag it by the grip along its top edge to anywhere over the page (double-click the grip to put it back), minimise it to a small pill with the − at the grip's right (the pill's dot shows Claude working or waiting for an approval; an approval request, a picked element or ⌘N bring the panel back), it fades while you pick an element, stays out of screenshots and moves above the dev log. Model, mode and other sessions need the full layout; the arrows next to the − in the panel, the toolbar button, ⌘\ or Esc bring it back (Esc works with the page itself focused, unless the page uses the key).
- **Every turn ends with a line**: duration, cost, "N files changed" (click it for the diff) and **Undo**.
- **Undo** restores the files that turn changed and removes the files it created. It needs git in the folder. Turns from before your last commit lose it.

**Controlling Claude**

- **Mode**, in the bar under the composer: "Ask before commands" (the default: edits files freely, asks before running commands), "Don't ask this session", "Plan first" and "Ask about everything".
- **Model, effort and fast mode** sit in the same bar and change the current session. Defaults for new sessions live in Settings (**⌘,**). Fast mode is Opus only and costs about twice as much.
- **Thinking** streams while Claude reasons and folds into a collapsed row once the answer starts.
- **Hide what you don't use**: Settings (**⌘,**) → Interface lists the optional parts of the window: the chips under the composer, the usage ring, the picker buttons, the keyboard hint, the tool-step rows and the Thinking row in the conversation; full width, device widths, pick, reload, open in browser, screenshot, dev log and the status chip on the preview toolbar; the editor and Finder buttons on sites. Untick to hide, at once; the shortcuts keep working; "Show everything" puts it all back after a confirm. A fresh install starts with the chips, the composer's picker button, the keyboard hint, the dev log button and the status chip hidden.
- **Usage ring** at the bottom of the composer fills as the conversation grows. Click it for the numbers, your plan's 5-hour and weekly limits, and the cost so far. When the conversation is full, Claude Code summarises older messages by itself; **⌘N** starts a clean session.

**Publishing**

- **Two targets**: Preview (a shareable test link; the live site does not change) and Production.
- **Commit and push first**, in the same dialog. Both boxes are ticked when the folder has changes and a remote; untick them to publish the working tree as it is. The commit message is prefilled from your last request.
- **The URL** appears when the command finishes. A running publish can be cancelled.
- **Change commands**, at the bottom of the publish dialog, edits both later. They are stored in `supasito.json` in the site folder.

**Managing sites**

- Icons on a site row: **book** (site rules: the `CLAUDE.md` Claude reads, for voice, brand and what not to touch), **code** (open in your editor), **folder** (reveal in Finder) and **star** (keep it at the top of the list) and **trash** (remove from the list, after a dialog that says so: nothing is deleted, the folder stays on disk with its code, git history and sessions). **Double-click** a site to rename it. With favourites set, or past six sites, the list shows the starred ones plus the current site and an **All sites…** row (⌘⇧O) opens a dropdown with a filter, favourites first, then the rest by last opened.
- **One dev server runs at a time.** Switching sites stops the previous one unless a session there is still working.

**Getting called back**

- The **Dock badge** counts approvals waiting for you. The Dock icon bounces when Claude needs you or finishes while Supasito is in the background.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Enter | Send, or queue while Claude works |
| Shift+Enter | New line |
| Esc | Stop picking, stop the current turn, or leave full width |
| ⌘⇧E | Pick an element |
| ⌘\ | Preview at full width (Esc leaves it) |
| ⌘N | New session |
| ⌘, | Settings |

## What Supasito does on your Mac

- **It runs your own `claude`.** Your plan, settings, skills, MCP servers, memory and `CLAUDE.md` all apply. Usage is billed to your Claude plan or API key. Supasito has no account of its own, and the only request it makes on its own is a once-a-day check for a newer version — it carries the version, macOS and the chip, no identifier, and Settings → Updates turns it off.
- **It finds Claude Code** on your PATH, then at `~/.claude/local/claude` and `~/.local/bin/claude`. Settings has a field for a different path.
- **Opening a folder marks it trusted** in `~/.claude.json`, the same as running `claude` there, so the folder's `.claude/settings.json` rules apply. Its dev and publish commands run as written.
- **Transcripts** stay in `~/.claude/projects`. The sessions listed under a site are the ones `claude --resume` sees, and they can be resumed from either side.
- **App state** is one file: `~/Library/Application Support/co.wozu.supasito/state.json`.
- **Per-site settings** live in `supasito.json` in the site folder:

  ```json
  { "name": "My site", "dev": "node_modules/.bin/next dev -p {port}", "publish": "vercel deploy --prod --yes", "preview": "vercel deploy --yes" }
  ```

  Supasito fills in `dev` for Next.js, Astro, Vite, SvelteKit and Nuxt, and infers `publish` from a `vercel.json`, `wrangler.toml` or `netlify.toml`. Any other project works if you write the `dev` command yourself; `{port}` is replaced at start.
- **Git is the history.** The pending-change count is `git status`, Undo is `git checkout`, and publish commits and pushes only when you tick the boxes. The site may be one folder inside a larger repository; the count, Undo and commits then cover that folder only.

## What to expect

- Used seriously on one Mac with Next.js and Astro sites. Plain Vite, SvelteKit and Nuxt 4 were each tried once from a fresh scaffold, and so was a pnpm-workspace monorepo with the site in `apps/web`.
- Most of that use was in development mode. The packaged app you install here has had less.
- Signed with a Developer ID certificate and notarized by Apple, so Gatekeeper opens it without a warning.
- No auto-update. Replace the app to update it.
- Bugs and questions: [github.com/wojtekwoz/supasito/issues](https://github.com/wojtekwoz/supasito/issues).

## If something goes wrong

- **"Supasito is damaged and can't be opened"**: the download was corrupted, or it is an old unsigned
  build. Download the zip again; releases from 0.1 on are notarized.
- **The checklist says Claude Code is not found** but it is installed: open Settings (⌘,) and set **Claude path** to what `which claude` prints in Terminal.
- **"Not signed in"**: run `claude auth login` in Terminal, finish in the browser, then click **Check again**.
- **The preview says the dev server didn't start**: open the log (terminal icon). Missing Node.js or uninstalled packages are the usual causes, and the card offers to install. A server that never opens a port turns into an error after 90 seconds.
- **"Port N is taken"**: another program, or another of your sites, is listening on the port your dev command asks for. The card names it; click **Stop it and try again**, or change the port in the command. When Supasito chose the port itself, it retries on another one without asking, and when the server picks a different port on its own, the preview follows it.
- **"Can't reach Claude's API; retrying"**: you are offline or blocked. Claude Code retries ten times over about three minutes. Esc stops the turn.
- **Publish fails mentioning login or 401**: run your host's login command in the site folder (`vercel login`, `netlify login` or `wrangler login`), then publish again.
- **The preview is blank after switching sites**: click Reload in the preview toolbar.

## Uninstall

Delete `/Applications/Supasito.app` and the folder `~/Library/Application Support/co.wozu.supasito`. Your sites, their git history and your Claude transcripts are untouched.

## Working on Supasito

Everything below is for people changing the app itself.

```bash
pnpm install
pnpm tauri dev          # the app with hot reload; Rust edits relaunch it
pnpm dev                # UI only at http://localhost:1420 against a mock backend, no Tauri needed
pnpm test               # transcript reducer, route mapping, cargo test
pnpm release            # Supasito.app; --install copies it to /Applications, --zip adds the zip, --dmg a disk image
```

- **Build a zip for someone else**: `pnpm release --install --zip` writes `release/Supasito-<version>-macos.zip`. Signing and notarization run when the Apple variables listed at the top of `scripts/release.sh` are set in `.env.release` (gitignored); without them the build still works but the recipient needs the quarantine step. The signed path was exercised end to end on 2026-09-08: notarization accepted, ticket stapled, and a quarantined copy unzipped on this Mac was accepted by Gatekeeper as "Notarized Developer ID".
- **Smoke tests against the real CLI**: `SUPASITO_SMOKE_PROMPT="Change the hero headline" pnpm tauri dev`. Scenarios and knobs are in `src-tauri/src/smoke.rs`.
- **Where things are**: `src/` is the React UI (rail, session, preview), `src-tauri/src/` the Rust core (agent bridge, dev-server supervisor, sites, publish), `starters/next/` the "New site" starter.
- **More**: [CLAUDE.md](CLAUDE.md) for conventions and sharp edges, [PLAN.md](PLAN.md) for the thesis, decisions and next milestone, [CHANGELOG.md](CHANGELOG.md) for what was built and verified when.
