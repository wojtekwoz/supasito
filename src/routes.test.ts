import { routeForFile } from "./routes.ts";
const root = "/Users/x/site";
const cases: [string, string | null][] = [
  ["/Users/x/site/app/page.tsx", "/"],
  ["/Users/x/site/app/pricing/page.tsx", "/pricing"],
  ["/Users/x/site/src/app/(marketing)/about/page.tsx", "/about"],
  ["/Users/x/site/app/blog/[slug]/page.tsx", null],
  ["/Users/x/site/app/@modal/login/page.tsx", "/login"],
  ["/Users/x/site/app/layout.tsx", null],
  ["/Users/x/site/components/hero.tsx", null],
  ["/Users/x/site/pages/index.tsx", "/"],
  ["/Users/x/site/pages/pricing.tsx", "/pricing"],
  ["/Users/x/site/pages/api/hello.ts", null],
  ["/Users/x/site/pages/_app.tsx", null],
  ["/Users/x/site/src/pages/index.astro", "/"],
  ["/Users/x/site/src/pages/pricing.astro", "/pricing"],
  ["/Users/x/site/src/pages/docs/index.md", "/docs"],
  ["/Users/x/site/src/pages/blog/[...slug].astro", null],
  ["/Users/x/site/src/routes/+page.svelte", "/"],
  ["/Users/x/site/src/routes/pricing/+page.svelte", "/pricing"],
  ["/Users/x/site/src/routes/about/+page.server.ts", "/about"],
  ["/Users/x/site/src/routes/about/+page.ts", "/about"],
  ["/Users/x/site/src/routes/+layout.svelte", null],
  ["/Users/x/site/src/routes/+layout.server.ts", null],
  ["/Users/x/site/src/routes/api/health/+server.ts", null],
  ["/Users/x/site/pages/about.vue", "/about"],
  ["/Users/x/site/app/pages/about.vue", "/about"],
  ["/Users/x/site/app/pages/index.vue", "/"],
  ["/Users/x/site/app/pages/blog/[slug].vue", null],
  ["/Users/x/site/app/app.vue", null],
  ["/Users/x/site/app/layouts/default.vue", null],
  ["app/contact/page.tsx", "/contact"],
];
let fail = 0;
for (const [file, want] of cases) {
  const got = routeForFile(file, root);
  if (got !== want) { fail++; console.log(`FAIL ${file}: got ${got}, want ${want}`); }
}
console.log(fail === 0 ? `routes: all ${cases.length} cases pass` : `routes: ${fail} failures`);
if (fail) throw new Error(`${fail} route mapping case(s) failed`);
