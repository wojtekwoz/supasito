# supasito.com — plan (v4, 2026-09-08)

*One page, one action, live this week. Positioning is in POSITIONING.md (the hub reframe is §12, honour pricing is §12.9) and this page derives from it; do not restate it here, obey it. Order: ground rules → brand → wireframe → copy → money → build order. A working prototype of the hero and demo exists as an artifact (see §2.1).*

---

## 0. Ground rules

- **The site obeys the app's one rule.** Everything on the page moves a visitor through *recognise → verify → decide → download*. A section that does not shorten that path is cut.
- **The reader sells themselves, and then pays themselves.** The page shows the loop happening, says what Supasito is not, lets them check everything, and asks once. The download is free; payment follows use. The eight rules are POSITIONING.md §9.
- **Benefits only.** No feature appears on the page by its name. Every line is the right-hand columns of the benefit ladder (POSITIONING.md §12.6). The demo carries the features.
- **One page.** No docs site (the GitHub README is the docs), no blog, no changelog page yet.
- **Honest.** The README says "used on one Mac". The site says the same, because the buyer finds out anyway and honesty is the brand.
- **Built with Supasito.** The site is a folder made from the bundled Next starter, edited in Supasito, published from the Publish button.

---

## 1. Brand foundation

### 1.1 What it is, in one line

Supasito is the Mac app where all the websites you run live in one place, and where you change any of them by saying what should change.

*Internally (never printed as is):* the Claude Code you already pay for, organised around your websites instead of repositories and sessions, with everything not about your websites taken away, and Undo and Publish put in front. See POSITIONING.md §5 and §12.

### 1.2 Who it is for

**The beachhead (POSITIONING.md §4):** a solo founder, indie maker or one-person studio on a Mac, already paying for Claude Pro or Max, running two or more sites that are Next or Astro folders (the product site, a landing page for the next thing, a client's site, the side project), who changes them weekly and is tired of hunting for the right folder and conversation, or of waiting for someone.

**Who the page sends elsewhere, by name:** WordPress, Squarespace, Webflow and Wix users (no folder to edit); Windows and Linux; anyone who wants hosting or maintenance done for them; and developers who want worktrees, terminals and pull requests, who should use Claude Code's own desktop app.

### 1.3 The promise

Every website you run, up to date, from one place.

### 1.4 Values, in customer words

1. **Your head is free.** Every site, and every conversation about it, in one place. Nothing to find, nothing to re-explain, nothing nagging.
2. **You change it yourself, today.** The change is made while you describe it. No one to wait for, no need to become a developer.
3. **Nothing goes live you haven't seen.** Every change is in front of you first. Undo is one click.
4. **You own everything, and pay for nothing new.** Your folders, your git history, your Claude plan. And Supasito itself is free until you decide it has earned something.

### 1.5 The name

*supasito*: super + site, said small and warm. Always lowercase in the wordmark. In running text: Supasito (capital S, one word). Never "SupaSito", never "Supasito.app" in prose.

### 1.6 Voice

- **Plain.** Short sentences. Second person. Verbs. "You pick the site. You say the thing. It's live."
- **Concrete over grand.** "before the coffee is cold" beats "instantly". "the price changed" beats "keep your content fresh".
- **Outcome, never mechanism.** "in one place" not "sites list"; "you see it first" not "live preview"; "put it back" not "git-backed undo".
- **Honest about limits**, in the same tone as the promise, not in small print.
- **Calm.** No exclamation marks. No urgency theatre. No "revolutionary", "reimagined", "the future of".
- **Descriptive about Claude Code**, never possessive: "runs the Claude Code you already have". The name never appears in the tagline, the lockup or an ad headline.
- **About money: an invitation, never a plea.** "Pay what it's worth", never "support me", "donate", "tip", "help keep the lights on".

| Use | Avoid |
| --- | --- |
| your sites, the sites you run | websites, web presence, digital experience, portfolio |
| change, say, see, publish | generate, unleash, supercharge, transform, manage |
| one place, one window | hub, dashboard, platform, workspace, command center |
| a Mac app | AI-powered platform, tool, solution, builder |
| the Claude Code you already have | our AI, our agents, our model |
| pay what it's worth | donate, tip, support me, sponsor |
| what to expect | limitations (as a hidden footnote) |
| Download | Get started, Sign up, Join the waitlist, Buy |

("Hub" is the internal word. On the page it is always "one place".)

### 1.7 Visual identity

**Colour.** One accent: the icon's coral. Used for exactly one thing on the page, the Download button, so the eye lands there. The pay link is underlined text in the accent, not a second button.

| Token | Light page | Dark page |
| --- | --- | --- |
| paper (background) | `#F6F4EE` (the starter's paper) | `#141416` |
| ink (text) | `#17181C` | `#EFEAE6` (the app's ink) |
| ink-2 (secondary) | `#4B4E57` | `#B7ADA5` |
| line | `#DEDAD0` | `#2A2A2E` |
| accent (button) | `#FF5A3C` (the app's `--accent-2`) | `#FF7A5E` |
| story beat | `#8A5A4E` | `#D9A08F` |

The demo window keeps the app's own dark tokens (`src/ui/app.css`) in both page themes: it is a picture of the app.

**A decision to make before anything else: the tile colour.** The wordmark PNGs carry a tile that runs `#FF6350 → #FF2707`, a saturated red. The app icon runs `#FF7A64 → #EC543B`, a coral, and the app's UI accent is `#FF7A5E` / `#FF5A3C` to match. Recommendation: re-export the wordmark with the icon's coral so the Dock icon, the app and the site are one colour. If the red is the new direction, the icon (`src-tauri/icons/Supasito.icon`) and `--accent` in `src/ui/app.css` follow it. One coral everywhere.

**Type.** One family: the system stack (`-apple-system, "SF Pro Text", "Helvetica Neue"`), the same as the app, so the site feels like the thing it sells. Large sizes and generous line height do the work. The starter's Source Serif 4 is switched off for this site.

**Logo use.**

- Files: `logo-text-dark.png` (black wordmark) on paper; `logo-text-light.png` (white wordmark) on dark. The tile alone is the favicon and the social-card mark.
- The PNGs are 6120 px wide and 1.7 MB each. Trace the wordmark to SVG (or export SVG from the source); keep the tile as a small PNG or SVG with the gradient. Budget: under 20 KB for the header logo.
- Clear space: the tile's corner radius. Minimum height: 28 px. Never recolour, never add a shadow, never put the black wordmark on coral.

**Assets to produce (day 1).**

- `logo.svg`, `logo-inverse.svg`, `mark.svg`.
- Favicon 32 px and touch icon 180 px from the tile (`app/icon.tsx` in the starter).
- Social card 1200×630: paper, the lockup, the promise (`app/opengraph-image.tsx`). Alternative: a still of the demo window with the three sites in the rail.
- **No video.** The demo (§2.1) replaces it. If a video is wanted for social posts, it is a screen recording of the demo itself, or of the real app doing the same three changes.

---

## 2. Wireframe

One column, max width ~1080 px for the demo, ~720 px for text. Eight blocks. Nothing sticky. Nothing animates except the demo.

```
┌──────────────────────────────────────────────────────────┐
│ [tile] supasito       GitHub   Pay what it's worth   [ Download ] │  1 header
├──────────────────────────────────────────────────────────┤
│                                                          │
│         Every website you run,                           │  2 hero
│         up to date, from one place.                      │
│   One Mac app for all your sites and every conversation  │
│   about them. Runs on the Claude Code you already have.  │
│                                                          │
│   9:41  The price changed on the product site.           │  3 demo
│   ┌──────────┬───────────────┬───────────────────────┐   │  (the story,
│   │ Sites    │ conversation  │ preview  [Publish]    │   │   acted out)
│   │ ● Supasito│ "the Pro plan │  Pricing              │   │
│   │   Cardstack│  is $29 now" │  Free $0   Pro $29/mo │   │
│   │   Marta's │ Editing …     │                       │   │
│   │ Sessions │ 9 s · Undo    │  Live · supasito.com  │   │
│   └──────────┴───────────────┴───────────────────────┘   │
│   Not a video. Click a site on the left to watch that    │
│   change happen.                                         │
│                                                          │
│   [ Download Supasito ]  Free for personal use. macOS…   │
│   If it saves you an afternoon, or you use it for client │
│   work, pay what it's worth. No licence key, no nag.     │
├──────────────────────────────────────────────────────────┤
│   What you get back                                      │  4 benefits
│   Your head. Your afternoons. Your nerve. Your           │
│   independence.  (two lines each)                        │
├──────────────────────────────────────────────────────────┤
│   What Supasito doesn't do                               │  5 subtraction
├──────────────────────────────────────────────────────────┤
│   You might recognise one of these                       │  6 recognition
├──────────────────────────────────────────────────────────┤
│   It fits if…             It doesn't fit if…             │  7 fit
├──────────────────────────────────────────────────────────┤
│   Honor-based pricing                                    │  8 the deal
│   Free for personal use. Three amounts, three reasons.   │
│   Supporters (names, opt-in).  6 questions.              │
├──────────────────────────────────────────────────────────┤
│ [tile]  © wozu · GitHub · Changelog · Privacy · email    │  footer
└──────────────────────────────────────────────────────────┘
```

**Phone:** same order, one column. The demo scales like an image. Download appears once under the demo; the pay link appears twice (under Download and in the pricing block). No sticky bar.

**Final draft (2026-09-08, the artifact "Supasito Hero Demo").** Below the demo the page now runs: Download with the deal line → What you get back (2×2, headings without full stops) → What Supasito doesn't do (a ruled list with a coda line) → You might recognise one of these (set larger, the emotional beat) → Is it for you? (fits / doesn't fit, accent dots on the fits) → Honor-based pricing (three amount cards, the Polar button, the supporters line) → Questions → Privacy (on the page, so the footer link is real) → footer with GitHub, Changelog, Privacy, email, and "This page was built and published with Supasito." Every link is real: Download goes to GitHub Releases latest, pay links go to Polar, the README link goes to "What to expect".

**Cut list:** feature grid, "how it works" diagram, comparison table, testimonials until there are real ones, framework logos, newsletter box, chat widget, cookie banner (no cookies), pricing tiers, "for teams", countdowns, popups, a second page for anything.

### 2.1 The demo (replaces the story paragraph and the video)

The story is acted out on a Mac screen instead of told. Built in HTML, scaled to the page like an image (a 1000×625 stage, so proportions hold on a phone), it runs a script:

1. **The screen.** A display bezel, the macOS menu bar with a clock, a wallpaper, and the Supasito window on it. The clock is the story's time: 9:41, 9:44, 9:47.
2. **The trigger.** Each scene opens with a notification sliding into the corner: a Slack message ("Pro goes to $29 today. Can you update the site?"), a calendar reminder (Cardstack launch, October 2), a text from the client ("the phone number on the site is still the old one"). The outside world pokes; Supasito answers.
3. **The sites.** The rail lists three sites, each a different little brand so the switch is visible: Supasito (the product site, a pricing page), Cardstack (the landing page for the next thing, "Coming soon" since June), Marta's Bakery (a client, an old phone number). Under them, that site's sessions, so the "conversations kept where the site is" benefit is seen, not claimed.
4. **The loop, cursor-driven.** A cursor moves to the site and clicks it, clicks the composer, the request types itself, a step row names the file being edited, the price on the mock page changes with a flash, the turn line shows "9 s · 1 file changed · Undo", the cursor clicks Publish, and "Live · supasito.com" appears. Three scenes, about 45 seconds, looping.
5. **The narration.** A caption under the screen carries the beat, then what was said, then "Live on supasito.com. About a minute." It is what a phone reader follows, and what a screen reader gets. Three scene bars under it show progress and jump on click.
6. **The visitor can take over.** Clicking a site in the rail, or a scene bar, runs that scene immediately. The caption says so: *Not a video.*
7. **Then the ask, once.** Download (free), the requirements, and the honor-based line in two sentences.

Prototype: the artifact "Supasito Hero Demo" (published from this session; source at `scratchpad/supasito-hero-demo.html`, to be moved into the site as a component). Reduced-motion users get the same scenes without typing animation. The mock pages are plainly examples; nothing pretends to be a real customer.

**Why this beats a paragraph or a video.** A paragraph tells; a video shows once; the demo shows and then hands the visitor the controls. Recognition (the beat), concreteness (the price actually changes), credibility (they can drive it) and the hub (three sites, three conversations) all land in the first screen, and the page's one rule holds: nothing on it is decoration.

---

## 3. Copy

Full draft, derived from POSITIONING.md §3, §12 and §12.9. Every line is a benefit or a recognition; the demo carries the features. Paste, then cut; never expand.

### Header

`supasito` · GitHub · Honor-based pricing · **Download**

### Hero

**Every website you run, up to date, from one place.**

One Mac app for all your sites and every conversation about them. Runs on the Claude Code you already have.

*Alternative headlines, if the first tests flat (POSITIONING.md §12.7):*
- All your websites in one place. Say what should change.
- Keep every site you run current, without asking anyone.
- Your websites, finally under control.
- One window for all your sites. Say it, see it, publish it.

### Demo beats (one per scene)

- 9:41 · The price changed on the product site.
- 9:44 · The landing page for the next thing still says "coming soon". It has since June.
- 9:47 · A client texts: the phone number on the site is the old one.

Caption under the window: *Not a video. Click a site on the left to watch that change happen.*

### Under the demo

**[ Download Supasito ]**
Free for personal use. macOS 13 or later, Apple silicon. Needs Claude Code and a Claude plan that includes it.

If it saves you an afternoon, or you use it for client work, pay what it's worth. No licence key, no nag. You decide.

### What you get back

**Your head.**
Every site, and every conversation about it, in one place. Nothing to find, nothing to re-explain, nothing nagging at you from a folder you forgot.

**Your afternoons.**
The change is made while you describe it. Three sites, ten minutes, done, on the plan you already pay for.

**Your nerve.**
You see every change before anyone else does, and anything can be put back with one click. So you change things instead of postponing them.

**Your independence.**
No developer to wait for, no builder to pay monthly, no terminal to open. Your sites, your folders, your Claude.

### What Supasito doesn't do

It doesn't host your sites. Your host stays your host.
It doesn't run the AI. It runs the Claude Code on your Mac, on your plan.
It has no account, no cloud, no file format of its own, no licence key.
It has no terminal, no diffs to read, no pull requests. A list of your sites, a conversation, a preview and a Publish button. That is the whole app, on purpose.

### You might recognise one of these

**Three sites, three folders, three terminals**, and the conversation about the footer is in none of the ones you have open.

**Claude Code built the site.** Now every small change means opening Terminal again, and reading a diff to find out what happened to the page.

**Someone else built the site.** A text change is an email, three days, and an invoice.

**The landing page for the next thing still says "coming soon".** It has said that since June.

### It fits if

- you run one site or several, and they are code projects: Next.js, Astro, Vite, SvelteKit or Nuxt, or you want a new one (a starter is included)
- you have a Claude Pro, Max, Team or Enterprise plan, or an API key
- you can run a few commands in Terminal once, during setup

### It doesn't fit if

- your sites live in WordPress, Squarespace, Webflow or Wix
- you are on Windows or Linux
- you want someone else to host or maintain the sites for you
- worktrees, terminals and pull requests are your words: use Claude Code's own desktop app, it is very good at that

### Honor-based pricing

**Supasito is free for personal use.** Download it, put your sites in it, use it for as long as you like. Nothing is locked, nothing expires.

**If it has earned something, pay what it's worth.** Three amounts, three reasons; pick the one that is true, or type your own.

| | |
| --- | --- |
| **$29** | It saved me an afternoon. |
| **$79** | I use it for client work. |
| **$149** | Keep building it. I'm in. |

**[ Pay what it's worth ]**

Every update through 1.0 is included either way. Paying gets a receipt, a thank-you, and your name here if you want it.

**Supporters** (opt-in, names only, in the order they arrived): *none yet. You would be the first.*

### Questions

**Do I need a Claude subscription?**
Yes. Supasito drives the Claude Code that comes with Claude Pro, Max, Team and Enterprise plans, or an API key. Usage is billed to that plan, not to Supasito.

**Is it really free?**
Yes, for personal use, with everything in it. If you use it for client work, or it keeps saving you afternoons, the deal above is how you pay for that. Nobody checks. It is on you.

**I only have one site. Is it for me?**
It works with one. It earns its place at the second, when the conversations and previews would otherwise start scattering across folders.

**Why not just use the Claude Code desktop app?**
You can, and if you build software you probably should. It is organised around sessions, branches, diffs and pull requests. Supasito is organised around your websites: each one has its place, its conversations and its Publish button, and there is nothing to learn.

**What does Supasito send anywhere?**
Nothing of its own. It has no account and no server. Your requests go to Claude through your own Claude Code, the same as in the terminal.

**How finished is it?**
Version 0.1. It has been used seriously by one person on one Mac, on Next.js and Astro sites; other frameworks were each tried once. Known gaps are listed in the README. The code is public.

### Footer

`[tile]` © 2026 wozu · GitHub · Changelog · Privacy · yo@wozu.co

**Privacy** (one paragraph, on the page or `/privacy`): supasito.com sets no cookies and runs no tracking scripts. The host's server-side visit counts are the only measurement. Payments are handled by [merchant of record]; their privacy policy covers payment details. The app makes one request of its own: once a day it asks whether a newer version exists. That request carries the version, macOS and the chip it was built for — no account, no identifier, no record of what you build — and Settings → Updates turns it off. Everything else the app does goes through your own Claude Code.

---

## 4. Money: honour-based

### 4.1 The model

**Free to download for personal use. Pay what it's worth when it has earned it.** The reasoning and the psychology are POSITIONING.md §12.9; the mechanics are here.

- **The download is public.** `Supasito-<version>-macos.zip` on GitHub Releases, linked from the page and the README. No gate, no key, no email wall.
- **The pay link is a pay-what-you-want product** at a merchant of record, with three suggested amounts ($29, $79, $149) and a free field. The merchant of record handles VAT and invoices; a paying freelancer gets a receipt they can expense.
- **Commercial use is on trust**, stated once on the page and once in the LICENSE, the way Obsidian does it. Not enforced. Not pretended to be.
- **Nothing is unlocked by paying.** Paying gets a receipt, a thank-you, and an opt-in place on the supporters list. That list is the only reward, and it is also the page's social proof.

### 4.2 Provider

| | Polar | Lemon Squeezy | Paddle |
| --- | --- | --- | --- |
| Fee | 4% + $0.40 | 5% + $0.50 | 5% + $0.50 |
| Merchant of record | yes | yes | yes |
| Pay what you want | yes | yes | no native option |
| GitHub-native / open-source friendly | yes | no | no |

**Decided: Polar.** The checkout exists (2026-09-08): `https://buy.polar.sh/polar_cl_JmO0OSf9Fofcbf2Evw1TBYimiruFnnOkWhXIu06Re3H`. Every "pay what it's worth" link on the page points at it, opening in a new tab. Still to confirm in the Polar dashboard: the three suggested amounts ($29 / $79 / $149) and a small minimum are set on the product, payout to a PLN or EUR account works, and the receipt email carries the thank-you and the opt-in question for the supporters list.

Sources: [Freemius: merchant of record for licensed software compared (2026)](https://freemius.com/blog/merchant-of-record-licensed-software/), [Lemon Squeezy vs Polar vs Paddle (2026)](https://www.buildmvpfast.com/blog/lemon-squeezy-vs-polar-paddle-merchant-of-record-2026), [Keylight: payment processors for Mac apps (2026)](https://keylight.dev/best-payment-processors-for-mac-apps/).

### 4.3 The one surface it may cost, later

The wish to pay peaks right after a saved afternoon, and the app knows when that happened: it counts published changes. A candidate for PLAN §9, not a decision: after the 25th publish, one line under the publish result, *"Supasito has published 25 changes across 3 sites for you. If it's earning its keep, pay what it's worth."*, with a link, dismissable forever, never shown again. It must pass the one rule before it is built. Until then the page asks once and the app asks never.

### 4.4 First supporters this week

1. **Announce where the beachhead already is.** The post's first line is the three-terminals scene, then the demo, then the download link. X, Indie Hackers, r/ClaudeAI. One post per place, no thread.
2. **The README gets the download link at the top and the deal in one sentence.** The repo has stars before the site has visitors.
3. **Ask every supporter two questions** after two weeks: "how many sites do you have in it?" and "what would you have done instead?" Their words are the v0.2 page and go back into POSITIONING.md §1 and §12.
4. **The supporters list starts empty and says so.** "None yet. You would be the first." is a truthful line that some people will want to answer.

### 4.5 What not to sell

A "pro" tier, seats, a hosted version, setup calls, a Claude-plan reseller, a licence key. Each is either a second product or a gate, and the deal has neither.

### 4.6 Measurement

Server-side visit counts from the host (Vercel or Cloudflare Web Analytics, no cookie). Five numbers, weekly: visits, downloads, **installs that ran today**, payments, supporters opted in. The number that matters most is not on the page: downloads to third sites added, asked in the two-week note. Nothing else until a number moves.

**Downloads** come from two places: the button points at `supasito.com/download`, a redirect that carries the referrer (`?src=…` per announcement, §4.4.1), and GitHub reports the asset's own count (`gh api repos/wojtekwoz/supasito/releases --jq '.[].assets[] | {name, download_count}'`), which also catches people who came to the repo first.

**Installs** come from the app's daily update check, built 2026-09-08 (src-tauri/src/updates.rs). Each running copy asks `supasito.com/updates/latest.json?v=<version>&t=darwin&a=<arch>` at most once a day, so requests to that route per day ≈ installs that ran that day, and the `v` parameter splits them by version — the upgrade curve for free. There is no identifier and no event, which is the whole point: the number is a by-product of a feature the user wants, not telemetry, and the page says so. Debug builds never check, so development does not inflate it.

**Serving the manifest — not as a static file.** `/updates/latest.json` has to be a route handler, not a file in `public/`. A static asset is served from Vercel's edge with no function invocation behind it, so there is nothing to count: Web Analytics is a browser script the updater never runs, and a cached asset produces no request log. A route handler (`app/updates/latest.json/route.ts`, `export const dynamic = "force-dynamic"`) is invoked on every check, which is the whole point — it returns the same JSON and leaves a record. Read `v` off the query string there. It must return JSON or a 404 and never a catch-all HTML page: a 200 with a non-JSON body makes the app abort the check instead of falling through to GitHub.

**The fallback cannot count, and that is fine.** The app falls back to `github.com/wojtekwoz/supasito/releases/latest/download/latest.json` when the site is unreachable, so updates keep working when the count does not. GitHub does report that asset's `download_count`, which is a free cumulative count of checks that reached it — worth reading before the site route exists, useless afterwards, since a working site route means GitHub is never asked. The fallback only resolves for a release marked latest; a prerelease is invisible to `releases/latest`.

**Not on the page.** No download counter under the button until it is a number worth printing — the supporters list starting empty and saying so (§4.4.4) is the honest empty state, and a printed number can never be taken back down.

---

## 5. Build order

**Day 1: decisions and assets.**
- Decide the tile colour (§1.7). Re-export the wordmark or change the app's accent to match.
- Trace the lockup to SVG; tile as SVG or 2× PNG; favicon and touch icon; social card.
- Move the demo prototype into the site as a component; replace the mock brands' details with the final three; check it on a phone.
- Pick the headline (recommend the first; read the five candidates to two people who run several sites first).

**Day 2: the page.**
- `New site` in Supasito from the starter into `~/Sites/supasito.com`. The uncommitted starter work in this repo (`site.ts`, `app/icon.tsx`, `app/opengraph-image.tsx`, `robots.ts`, `sitemap.ts`, the header and footer reading from `site.ts`) is exactly what this site needs; commit it first so the new site starts with it.
- Set `site.ts`: name `supasito`, url `https://supasito.com`, description = the promise, email `yo@wozu.co`.
- Build the eight blocks from §2 with the copy from §3, in Supasito, by describing them. Switch off the serif. One accent, one button per screen.
- Publish to Vercel or Cloudflare from the Publish button; point `supasito.com` at it; `www` redirects to the apex.
- Acceptance: on a phone, the headline, the beat, the demo's preview and the Download button are visible within one scroll; Lighthouse performance and accessibility green; the OG card renders in a link preview; a reader who has never heard of Supasito says "so it's where I'd keep all of them" after the first screen.

**Day 3: the deal.**
- GitHub Release with the signed zip; the Download button points at it.
- Provider account (§4.2), product "Supasito", pay what you want with $29 / $79 / $149 suggested and a small minimum. Pay yourself once with a real card; confirm the receipt and the thank-you.
- The supporters list: a text file in the site repo, edited by hand, with opt-in from the thank-you email.
- `LICENSE` in the repo: source-available, free for personal use, commercial use asks for payment on trust. The README gets the download link and the one-sentence deal.

**Day 4: launch.**
- The post: the three-terminals scene, the demo, the link.
- Watch the four numbers for a week. Papercuts go to PLAN §8c. The two-week notes go to POSITIONING.md §1 and §12.

**The claim at the end:** a stranger who runs three sites lands on supasito.com, watches their own week happen in the demo or leaves in ten seconds, downloads without being asked for anything, and comes back to pay on the day it saves them an afternoon.
