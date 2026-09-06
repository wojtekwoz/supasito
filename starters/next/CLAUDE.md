# This site

A marketing site built with Next.js (App Router), Tailwind v4 and TypeScript. It is edited through Supasito: the person you are talking to sees the live preview, not the code.

## Where things are
- `app/page.tsx` composes the page from `components/*`. One component per section; keep it that way.
- Design tokens live in `app/globals.css` under `@theme` (colors, fonts). Change tokens before adding one-off colors.
- No global state, no data fetching, no client components unless something is interactive.

## Brand (edit me)
- Voice: plain, confident, short sentences. No exclamation marks.
- Type: display serif for headlines, system sans for everything else.
- Colors: paper background, ink text, one accent. Do not introduce gradients.

## Conventions
- Prefer small, direct edits. Do not add dependencies unless asked.
- After editing, run `pnpm typecheck` when the change touched more than copy.
- Never start the dev server; Supasito runs it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
