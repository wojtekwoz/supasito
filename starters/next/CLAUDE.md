# This site

A marketing site built with Next.js (App Router), Tailwind v4 and TypeScript. It is edited through Supasito: the person you are talking to sees the live preview, not the code.

## Where things are
- `site.ts` is the site's identity: name, description, email, public URL. The pages, the social
  card, `robots.txt` and `sitemap.xml` all read from it. Rename the site here, not in the markup.
- `app/page.tsx` composes the page from `components/*`. One component per section; keep it that way.
- Design tokens live in `app/globals.css` under `@theme` (colors, fonts). Change tokens before adding one-off colors.
- `app/opengraph-image.tsx` and `app/icon.tsx` draw the share card and the tab icon from `site.ts`.
- `app/sitemap.ts` lists the routes: add a line there whenever you add a page.
- No global state, no data fetching, no client components unless something is interactive.

## Brand (edit me)
- Voice: plain, confident, short sentences. No exclamation marks.
- Type: display serif for headlines, system sans for everything else.
- Colors: paper background, ink text, one accent. Do not introduce gradients.

## Conventions
- Prefer small, direct edits. Do not add dependencies unless asked.
- Images go in `public/` and are rendered with `next/image`, always with `width` and `height`
  (or `fill` inside a sized parent). Never use a bare `<img>` — it breaks layout on load.
- Before publishing, set the real domain in `site.ts`; social cards and the sitemap need absolute links.
- Nothing prints the current year: the page is prerendered, so a build-time year freezes at whatever
  year the site was last published.
- After editing, run `pnpm typecheck` when the change touched more than copy.
- Never start the dev server; Supasito runs it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
