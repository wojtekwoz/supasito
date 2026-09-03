// Map an edited file to the page it renders, so the preview can follow Claude's work.
// Returns null for files that are not a page (components, layouts, config) or that need a
// dynamic parameter we cannot fill in.

const strip = (p: string, root: string | null | undefined) => {
  const rel = root && p.startsWith(root) ? p.slice(root.length) : p;
  return rel.replace(/^\/+/, "");
};

function clean(segments: string[]): string | null {
  const out: string[] = [];
  for (const s of segments) {
    if (!s || s === "index") continue;
    if (/^\(.*\)$/.test(s)) continue; // route groups (marketing)
    if (s.startsWith("@")) continue; // parallel routes
    if (/[\[\]]/.test(s)) return null; // dynamic segments need a value
    out.push(s);
  }
  return "/" + out.join("/");
}

export function routeForFile(filePath: string, root?: string | null): string | null {
  const rel = strip(filePath, root);
  let m: RegExpMatchArray | null;
  // Next.js App Router: app/(group)/pricing/page.tsx
  if ((m = rel.match(/^(?:src\/)?app\/(.*?)(?:^|\/)?page\.(?:tsx|jsx|ts|js|mdx|md)$/))) {
    return clean(m[1].split("/").filter((s) => s !== "page.tsx"));
  }
  // Next.js Pages Router: pages/pricing.tsx (not api/, _app, _document)
  if ((m = rel.match(/^(?:src\/)?pages\/(.*)\.(?:tsx|jsx|ts|js|mdx|md)$/))) {
    if (m[1].startsWith("api/") || m[1].startsWith("_")) return null;
    return clean(m[1].split("/"));
  }
  // Astro: src/pages/pricing.astro, src/pages/pricing/index.astro
  if ((m = rel.match(/^src\/pages\/(.*)\.(?:astro|md|mdx|html)$/))) {
    return clean(m[1].split("/"));
  }
  // SvelteKit: src/routes/pricing/+page.svelte
  if ((m = rel.match(/^src\/routes\/(.*?)\/?\+page\.(?:svelte|ts|js)$/))) {
    return clean(m[1].split("/"));
  }
  // Nuxt: pages/pricing.vue
  if ((m = rel.match(/^pages\/(.*)\.vue$/))) {
    return clean(m[1].split("/"));
  }
  return null;
}
