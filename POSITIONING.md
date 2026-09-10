# Supasito — positioning (2026-09-08)

*Positioning is context, not words: it decides what the visitor compares Supasito to, and therefore what they notice. This document works through April Dunford's five steps (Obviously Awesome), then Geoffrey Moore's beachhead test (Crossing the Chasm), then the Heaths' SUCCESs audit (Made to Stick). WEBSITE.md derives from it. The rule the user set: the page does not sell to people; it lets the right person recognise themselves and decide.*

---

## 0. Where we were

The first draft (WEBSITE.md v1) scored about 5/10 on Dunford's scale: the category ("a Mac app for your website") was vague, the alternatives table was assumed rather than researched, and the best-fit customer was four segments at once (founders, freelancers, designers, developers). Two of its claims do not survive research: hosted builders are not the buyer's real alternative, and "a picker in the preview" is not unique.

## 1. Competitive alternatives (what the buyer does if Supasito vanishes)

Researched 2026-09-08. Ordered by how likely the best-fit buyer is to reach for it.

| Alternative | What it is, in the buyer's words | What it costs them | Where it stops for our buyer |
| --- | --- | --- | --- |
| **Claude Code, terminal** | "I open Terminal in the site folder and type what I want." | Included in the plan they already pay for | The terminal. Documented as "the single biggest reason non-technical people never try it". No page in view; every change is a diff to read and a browser to refresh. |
| **Claude Code desktop app** (Anthropic, redesigned April 2026; built-in browser July 2026) | "Claude Code with windows." Starts dev servers, previews the app in a pane, click an element to give Claude context, diff view with line comments, PR status, terminal, file editor, worktrees, computer use. | Included in the plan | Built for building software. The unit is the session, branch and pull request. Publishing is "merge". Server config lives in `.claude/launch.json`. Builder.io's review calls the preview "the AI's self-verification layer", not a visual editor. Everything it added in 2026 (worktrees, terminals, PR monitoring, Routines) moved it further toward developers. |
| **Frontman** (open source, plugin) | "Install a plugin into the Next/Astro/Vite project, click elements in the browser, describe the change." | Free, bring your own API key, pay per token | Positioned for "frontend developers and designers". Needs an API key, an `npx … install` in the project, and a browser tab. No publish, no undo, no app. |
| **Onlook** (closed beta, web) | "Figma-like canvas over a real Next.js + Tailwind codebase." | "Custom pricing", contact sales, or self-host | For product teams with a design system. Web app, closed beta, Next + Tailwind only. |
| **Hosted AI builders** (Lovable, Bolt, v0, Webflow AI) | "Describe an app, get it hosted." | $20–$50 a month in credits, plus hosting | For starting something new inside their account. Code export exists, but hosting and backend are the soft lock-in. Not for the site you already have as a folder. |
| **Cursor / an IDE** | "The editor developers use." | $20 a month | An IDE. Thousands of options, a file tree, a terminal. |
| **Hire or wait** | "Email the web person." | "$50–$150 an hour; wait three days, pay $200 for a text change" (2026 small-business pricing guides) | Waiting. Dependency. The site freezes when the freelancer gets busy. |
| **Do nothing** | The site stays as it was. | Stale pricing, an old headline, a launch the site does not mention | This is the most common one. |

**The finding that changes the plan.** The buyer's real alternative is *Claude Code itself*, in the terminal or the desktop app. Both are free with the plan they already pay for. So Supasito cannot be "AI for your website" (that is the same AI) and cannot be "a GUI for Claude Code" (Anthropic ships one). It can only be **what Claude Code becomes when everything not about your website is taken away, and the two things a website owner needs, Undo and Publish, are put in front.** That is PLAN §2's thesis, subtraction, restated as positioning.

## 2. Unique attributes (the "only we" test, honestly applied)

| Attribute | Only we? | Note |
| --- | --- | --- |
| **The website is the unit.** A list of sites, one live preview per site, Publish with preview and production targets, the preview follows the page being edited, device widths. | Yes, among the alternatives above | Claude Code desktop's unit is a session/branch/PR; Frontman's is a browser tab; builders' is a project in their cloud. |
| **Nothing to learn.** No terminal, no diff to read, no PR, no worktree, no `launch.json`, no API key, no account. Three panes and a Publish button. | Yes, by subtraction | The whole 2026 competitive movement went the other way. This is the differentiator, and it is a *lack*. |
| **Undo on every change, one click, git-backed.** | Presentation only | Claude Code has checkpoints and rewind; the difference is that Supasito puts Undo on the line where the change is reported. Do not claim "only". |
| **Runs the user's own `claude` binary.** Their plan, settings, skills, memory, CLAUDE.md. No key flow, no server of ours, sends nothing itself. | Yes vs. builders, Frontman, Onlook; no vs. Claude Code | Say it as ownership ("your Claude, your folder"), not as a feature. |
| **Works on the site you already have.** Next, Astro, Vite, SvelteKit, Nuxt detected; a Next starter for a new one. | Shared with Claude Code and Frontman | Table stakes for this buyer; state it in the fit list, not the headline. |
| **Point at the thing.** Picker with the React component chain (Server Components included) or Astro file:line. | No (Frontman, Claude Code desktop) | Show it in the video; never lead with it. |
| **A signed, notarized 11 MB Mac app.** | Yes vs. plugins and web apps | Supports "nothing to install into your project". |
| **The code is public.** | Shared with Frontman, Onlook | A credibility attribute (you can read every line), not a value attribute. |

## 3. Value themes (the "so what" chains)

*Revised 2026-09-08 after the reframe in §12: Supasito is the hub for all the websites a person runs, not a tool for one edit.*

1. **All your sites and every conversation about them in one place → nothing to find, nothing to re-explain, nothing nagging.** Concretely: open one app, see every site, pick one, the conversation about it is already there, the preview is already up. Emotional core: your head is free. *This is the primary theme.*
2. **Say it, see it, publish it → the change is made while you describe it, without waiting for anyone.** Concretely: three sites, ten minutes, done; on the plan you already pay for. Emotional core: independence, and the afternoon back.
3. **Undo and approval in front of you → nothing goes live you have not seen, so you change things instead of postponing them.** Concretely: every change is visible first; anything risky waits for your OK; Undo is one click. Emotional core: nerve.
4. **Your folders, your Claude → you own everything and pay for nothing new.** Concretely: stop tomorrow and nothing is lost; no account, no hosting, no credits. Emotional core: no trap.

Four themes, each backed by something visible in the video. Nothing on the page that is not one of the four.

## 4. Best-fit customer, and the beachhead

Dunford asks for characteristics you can identify before talking to the person. Moore asks for one segment, with urgent pain, reachable, that talks to itself.

**Candidates scored** (urgent pain / reachable / whole product ready / talks to each other):

| Segment | Pain | Reach | Whole product | Word of mouth | Verdict |
| --- | --- | --- | --- | --- | --- |
| A. **Solo founder or indie maker, on a Mac, already paying for Claude Pro or Max, whose marketing site is a Next or Astro folder** | High: the site lags the product; they are the bottleneck | High: X, Indie Hackers, r/ClaudeAI, the Claude Code newsletters | Nearly complete: they have Node, git and Claude Code installed already | High | **Beachhead** |
| B. Freelance web designer or one-person studio maintaining client sites built in code | High: "$200 text change" is their unpaid time | Medium | Complete for them; incomplete for their clients (Terminal setup) | High | Pin 2 |
| C. Someone who built a site in Lovable, Bolt or v0, exported it, and has not touched it since | High: the site is frozen | Medium (the builders' own forums) | Missing: a "from your export" guide; Supabase-coupled apps are not "a website" | Medium | Pin 3 |
| D. Marketer at a small startup | Medium | Medium | Missing: repo access, local setup, permission from engineering | Low | Not now |
| E. Developer who wants a nicer Claude Code | Low: they have one | High | n/a | High | **Not a customer**; they use the desktop app, and the page should say so |

**Beachhead: A, with one more condition: they run two or more sites** (the product site plus a landing page, a side project or a client's site). One site works; the hub pays for itself at the second (§12). Identifiable before contact: Mac, a Claude plan, sites in code folders, posts about their products. It is also who has used Supasito so far, which is the only evidence there is. Whole product for A today: the first-run checklist, the Next starter, publish presets for Vercel, Cloudflare and Netlify, the README, a 14-day refund. Missing: auto-update (PLAN §8.7) and references (none yet; the founders' batch produces them).

**Negative criteria on the page** (so the wrong reader leaves happy): WordPress, Squarespace, Webflow, Wix; Windows or Linux; wants hosting or maintenance done for them; wants worktrees, terminals and pull requests (that person should download Claude Code's desktop app, and the page says so).

## 5. Market category

Options, per Dunford:

| Frame | What the visitor assumes | Verdict |
| --- | --- | --- |
| "AI website builder" (Lovable's category) | Hosted, from scratch, credits, templates, their account | Wrong. Every evaluation criterion favours them, and it hides the ownership theme. |
| "Claude Code GUI" (Conductor, Nimbalyst, Emdash) | Parallel sessions, worktrees, developer buyers | Wrong buyer, wrong criteria, and Anthropic's own app is the gorilla. |
| New category ("conversational website editor") | Nothing; they have to be taught | Education tax we cannot pay at v0.1. |
| **Subcategory of Claude Code: "for your website"** | Same brain they already pay for; the difference is what is in front of them | **This.** The buyer knows Claude Code, pays for it, and can evaluate "the same thing, for my website, without the terminal" in five seconds. |

**Positioning statement (internal; never printed as is):**

> For people who run more than one website built in code and already pay for Claude, Supasito is the Mac app where all their sites, and every conversation about them, live in one place: pick a site, say what should change, watch it, publish. Unlike Claude Code's terminal and desktop app, it is organised around websites rather than repositories and sessions, and assumes nothing about developers: no terminal, no diffs, no pull requests, one Undo, one Publish.

**One caution.** "Claude Code" is Anthropic's mark. Use it descriptively in body copy ("runs the Claude Code you already have"), never in the tagline, the logo lockup, the domain or an ad headline as if it were ours. The tagline stays category-free; candidates are in §12.7.

## 6. Trends that make this timely (real, and connected to the unique attribute)

1. **Non-developers are pouring into Claude Code in 2026**, and the guides written for them name the terminal as the barrier. The subtraction attribute is what that trend is asking for.
2. **Every AI path now ends in a code folder.** Claude Design hands off to Claude Code; Lovable exports to GitHub; Claude Code builds sites for non-developers. More people than ever own a site as a folder and have no friendly way to change it.
3. **Anthropic's desktop app went toward software engineering** (worktrees, PRs, terminals, computer use). The "I just want my website changed" person is left where they were.
4. **Owners are still paying $200 and waiting three days for a text change.** The old way is documented and priced.

## 7. Crossing the Chasm: where Supasito actually is

Honest reading: **v0.1 is an early-adopter product** (used by one person on one Mac, no references, no auto-update). Pragmatists will not buy it yet, and the page must not pretend they should. But the page can be *built pragmatist-shaped* from day one, so nothing has to be rewritten at v0.2:

- **Evolution, not revolution.** No "revolutionary", "the future of", "reimagined". It is the Claude Code you have, for your website.
- **Proof over claims.** One unedited 25-second video; the public repository; a 14-day refund; the requirements above the fold; "what to expect" in plain sight.
- **References come from the founders' batch.** Twenty named early buyers, each asked for one sentence in their own words after two weeks. Those sentences, not adjectives, are the v0.2 page.
- **Bowling pins:** A (founders on Claude plans) → B (freelancers maintaining client sites, then their clients) → C (Lovable/Bolt exporters, with a "from your export" guide). Never D or E.

Chasm score today: 6/10. One beachhead, urgent pain, whole product nearly complete, positioning evolutionary. Missing: references and auto-update.

## 8. Made to Stick: the SUCCESs audit of the page

Scores are for the copy in WEBSITE.md §3 after this rewrite; the v1 copy scored roughly 28/60.

| Principle | How the page does it | Score |
| --- | --- | --- |
| **Simple** | Commander's intent: *Change your website by saying so.* Everything else is subordinate. One accent colour on one button. | 9 |
| **Unexpected** | A product page that lists what the product does *not* do, first: no hosting, no account, does not even run the AI. "Less than Claude Code, on purpose." The reader expects more; they get less, and understand why. | 8 |
| **Concrete** | "The price changed this morning. You type 'the Pro plan is $29 now', watch the page, press Publish." Named frameworks, named requirements, "about a minute", "$49 once". No "seamless", no "powerful". | 9 |
| **Credible** | Internal: the unedited video, the exact requirements, the known gaps stated. Testable: the code is public, 14-day refund. No fake logos, no invented numbers. | 8 |
| **Emotional** | Identity, not fear: "the kind of person who fixes it themselves". Independence over hype. One person's Tuesday, not "thousands of users". | 7 |
| **Stories** | The hero is a four-sentence story in the second person, present tense: the reader runs the simulation and casts themselves. Three more one-line scenes under "You might recognise one of these". | 8 |

49/60: strong. The two points left on Emotional and Credible arrive with the first real quotes.

## 9. How the page lets the reader sell themselves

The instruction: do not sell to people; let them sell to themselves. Applied as rules the page obeys, each traced to a framework:

1. **Recognition before persuasion.** The first thing the reader meets is a scene from their own week, not a claim about ours. If they see themselves, they keep reading; if not, they leave in ten seconds, unbothered. (Stories, Emotional/identity.)
2. **The video argues; the copy does not.** No adjective the video cannot show. If a sentence could not be checked against the 25 seconds, cut it. (Concrete, Credible.)
3. **Say what it is not, early.** The subtractive block sits right after the video. Readers who wanted hosting or PRs are sent to the right tool by name. Every wrong reader we turn away is a refund and a bad review we do not get. (Unexpected; Dunford's negative criteria; Moore's whole-product honesty.)
4. **Let them verify everything.** Requirements above the fold; the repository public; the README's "what to expect"; the refund. Nothing to take on trust. (Credible: testable credentials.)
5. **Let them do the arithmetic themselves.** "You already pay for Claude. Supasito is $49, once." No ROI calculator, no "saves 10 hours a week". (Concrete; Dunford's value in the customer's terms.)
6. **Self-qualification comes before the price.** "It fits if / it doesn't fit if" is above the Buy card, and includes "if worktrees and pull requests are your words, use Claude Code's desktop app". (Dunford best-fit; Moore.)
7. **No pressure devices.** No countdown, no popup, no "only today", no testimonial wall until there are real ones. The founders' count is the one true scarcity and is stated as a fact. (Credible; the brand.)
8. **One action, said twice.** Buy in the hero and on the price card. Nothing else asks for anything. (Simple.)

## 10. Positioning canvas (the one-page version)

| Component | Answer |
| --- | --- |
| Competitive alternatives | Claude Code in the terminal or desktop app (free with their plan); Frontman; hosted builders; waiting for the web person; doing nothing |
| Unique attributes | The website is the unit (sites, preview, Publish, Undo in front); nothing to learn, by subtraction; runs their own Claude, no account; a signed Mac app, nothing installed into the project |
| Value themes | All your sites and their conversations in one place · The change made while you describe it, no one to wait for · Nothing goes live you haven't seen · Your folders, your Claude, nothing new to pay for |
| Best-fit customer | Solo founder, indie maker or one-person studio on a Mac, already on Claude Pro/Max, running two or more sites that are Next or Astro folders |
| Market category | Subcategory of Claude Code: "for your website" (tagline stays category-free) |
| Relevant trends | Non-developers adopting Claude Code; every AI path ends in a code folder; Anthropic's app went toward engineering; the $200 text change |
| Positioning statement | §5 |
| Proof points | The unedited video; the public repository; the requirements and known gaps in plain sight; 14-day refund; founders' quotes at v0.2 |
| Primary message | *Every website you run, up to date, from one place.* (candidates in §12.7) |
| Sales narrative | Tuesday: three sites need three small things → the demo does them in front of you → what you get back → what Supasito does not do → fits / doesn't fit → download free, pay what it's worth when it has earned it (§12.9) |

Positioning score after this pass: 8/10. The last two points need what only customers can give: their own words for the alternatives they left, and the first references.

## 12. The hub: the job, the pains, the dreams, and why now

*Added after the reframe: Supasito is a hub for all the websites a person runs, with every conversation about each site kept where the site is. This section is the research behind the benefit copy in WEBSITE.md §3. Frameworks: Christensen's job statement and four forces; Hormozi's value equation; the psychology named in §12.5 with its sources.*

### 12.1 The job (never mentions the product)

> **When** I run more than one website (the product site, the landing page for the next thing, a client's site, the side project) and something on one of them needs to change, **I want to** get it changed and live without hunting for the right folder and conversation, without reopening a terminal, and without asking anyone, **so that** every site I am responsible for is current and none of them is nagging me.

| Dimension | What the person wants |
| --- | --- |
| Functional | Change any of my sites, fast, and put it live |
| Emotional | Relief: it is under control; nothing is wrong out there right now |
| Social | Be the person whose sites are always current, who ships, who never has to ask |

**Circumstances that trigger the first thought** (the moment they arrive at the page): the price changed; the launch went out and the site does not mention it; a client's message; a friend's screenshot "your site still says…"; the third side project; opening Terminal and not remembering which folder held the conversation about the footer.

### 12.2 Pains (push), with evidence

1. **Scattered.** Each site is a folder; Claude Code scopes every conversation to the folder you happen to be in, so `--resume` only shows that folder's sessions. Users of Anthropic's own desktop app asked for sessions grouped by project because mixing them "makes it easy to resume the wrong session" (anthropics/claude-code issue #56067). Guides for running several projects describe the same thing: "you lose track of which session is working on what, prompts go to the wrong terminal, context bleeds between tasks."
2. **Every switch is a re-orientation.** Change site: open a terminal, `cd`, find the session, start the dev server, open a browser tab, remember where you were. Freelance guides call context switching "the silent productivity killer", and note "it's not the big changes that hurt, it's the small interruptions." A full-time freelancer carries five to fifteen clients; "the work itself is rarely the bottleneck. What breaks first is the operational layer underneath."
3. **Every small change is a project.** Either the web person (three days, $200 for a text change) or the terminal and a diff to read.
4. **A stale site costs money and face.** Founders "pour budget into getting people to the website, then lose them the moment they arrive"; a wrong price or an old headline is a loss happening now, and it is visible to everyone.
5. **Open loops nag.** The change you have not made stays in your head. Zeigarnik (1927): unfinished tasks are held about twice as tightly as finished ones; four or more concurrent open tasks measurably raise cognitive load and drain self-control. Working memory holds three to five items; the person with four sites and a to-do on each is already over capacity.

### 12.3 Dreams (pull), in their words

1. "Nothing on any of my sites is wrong right now."
2. "One place. I open it, I see all of them, I pick one, I say the thing."
3. "The conversation about each site is where the site is. I never explain the footer twice."
4. "I fixed it myself, in a minute, and nobody had to be asked."
5. "The afternoon I would have spent on this, I get back."

### 12.4 Anxieties and habits (the forces against hiring)

| Force | The worry | What the page does about it |
| --- | --- | --- |
| Anxiety | "Will it break my site?" | Preview first, approval on anything risky, one-click Undo; the video shows all three |
| Anxiety | "Another subscription?" | $49 once; runs on the Claude plan they already pay for |
| Anxiety | "Another tool to learn?" | Three panes and a Publish button; the video is 25 seconds |
| Anxiety | "Is it finished?" | Version 0.1 stated plainly; public code; 14-day refund |
| Anxiety | "Am I locked in?" | Folders, git, their host; stop tomorrow and nothing is lost |
| Habit | The terminal works, sort of | Named in "you might recognise one of these", not argued with |
| Habit | The freelancer relationship | Named, priced ($200 a text change), not attacked |
| Habit | "I'll do it later" | The Zeigarnik answer: a place where it will get done closes the loop today |

### 12.5 The psychology of wanting it now

Why someone buys on the day they land, not "later". Each item is a real mechanism with a source, used honestly: the page names what is already true for the reader, it does not manufacture it.

1. **Loss aversion.** A wrong price or old headline is not a future cost; it is a loss occurring with every visitor right now. Losses weigh roughly twice as much as gains (Kahneman and Tversky). The page says "right now", not "some day".
2. **Open loops, and what closes them.** Zeigarnik's effect explains the nag. Masicampo and Baumeister (2011) found that the intrusion stops not when the task is done but when there is a credible plan to do it. A hub where every site has its place *is* that plan. This is the deepest reason "one place" sells: it is relief on the day of purchase, before a single change is made.
3. **Autonomy and competence** (Self-Determination Theory, Deci and Ryan). Waiting on someone else frustrates autonomy; fixing it yourself in a minute satisfies competence. Both are intrinsic, which is why "I did it myself" feels better than "it got done". The page's identity line: the kind of person who fixes it themselves.
4. **Cognitive load and consolidation.** Working memory holds three to five items; every extra tool or folder adds checking and re-orienting. Consolidation is experienced as relief, not as a feature. "One place" is the benefit; "sites list" is the feature.
5. **Circumstance timing.** The reader is on the page because something needs changing today (§12.1). The page speaks to that moment: "the thing you came here to fix".
6. **The value equation** (Hormozi): dream outcome = every site current and under control; likelihood = the unedited video, Undo, the refund; time delay = a minute per change, five minutes to install; effort = say it. Against $49 once, anchored to one $200 text change. No ROI calculator; the reader does the arithmetic.
7. **Identity.** "People whose sites are always current" is a group the reader wants to be in. The page offers membership, not a pitch.

### 12.6 The benefit ladder (feature → benefit → what it means to them)

| Feature (never on the page) | Benefit (on the page) | What it means to them |
| --- | --- | --- |
| Sites list; sessions listed per site from `~/.claude/projects` | All your sites and every conversation about them in one place | Your head is free; nothing to find, nothing to re-explain |
| Dev server per site; live preview; device widths | You see the change before anyone else does | No surprises; safe to move fast |
| Composer; element picker; follow-the-page | The change is made while you describe it | You need no one; the afternoon is yours |
| Approval cards; per-turn Undo (git-backed) | Nothing goes live you haven't seen; anything can be put back | Nerve: you change things instead of postponing them |
| Publish per site, preview and production targets | Live in one click, on your own host | Sites stay current; visitors see the truth; you look sharp |
| Runs the user's `claude` binary; folders; git | Nothing new to pay for or learn; nothing to lose | No trap |

### 12.7 Headline candidates (benefit first, hub framed)

The old line, "Change your website by saying so", named the mechanism and one site. The hub needs a line that names the outcome across all of them.

1. **Every website you run, up to date, from one place.** *(recommended: outcome, plural, the hub, eight words)*
2. All your websites in one place. Say what should change.
3. Keep every site you run current, without asking anyone.
4. Your websites, finally under control.
5. One window for all your sites. Say it, see it, publish it.

Test: read each to someone who runs three sites and ask what they think the product is. The right line makes them say "so it's where I'd keep all of them".

### 12.8 What this changes elsewhere

- Best-fit customer gains a condition: **runs two or more sites**. One site works; the hub pays for itself at the second. (§4, §10 updated.)
- Value theme 1 is now the hub (§3). The video should show a site *switch*: pick another site in the rail, the preview is already up, say the thing.
- The "recognise yourself" scenes gain the three-terminals scene (WEBSITE.md §3).
- Chasm note: the hub is also the whole-product story for pin 2 (freelancers with client sites), whose pain is exactly §12.2 items 1 and 2.

Job-fit score (Christensen): 8/10. Missing: ten timeline interviews with real buyers; the first supporters supply them.

### 12.9 Honour-based pricing: why it fits, and the psychology that makes it work

*Decided 2026-09-08: free to download for personal use; people who find it saves them time, want to support the work, or build for clients with it pay what it is worth.*

**Why it fits this product and this page.**
- It is the literal form of "the reader sells themselves": nobody pays before the product has done the selling. The value equation's two denominators, time delay and effort, go to zero, and "perceived likelihood" becomes certainty because payment follows use.
- It removes the last anxiety in §12.4 ("is it finished?") without an argument. Version 0.1 is a gift, not a purchase, and a gift is judged differently.
- It matches the brand's subtraction: no licence key, no trial timer, no nag, no gate on the download. Day one needs no checkout to work before anyone can try it.
- It is a known, respected shape for exactly this kind of app: Obsidian (free for personal use, commercial licence on trust), Sublime Text (buy when you decide it's worth it), and the pay-what-you-want norm on Polar and Lemon Squeezy.

**The psychology, used honestly.**
1. **Reciprocity** (Cialdini). A genuine gift, given first and without conditions, creates a real wish to give back. It only works when the gift is real: the whole app, the whole time, no crippling.
2. **Identity and consistency.** "The kind of person who pays for what saves them time" is a self-image the reader wants; a public supporters list lets them act on it once and be consistent with it after.
3. **Fairness norms.** People pay more under pay-what-you-want when the reference is visible and the ask is specific. So the page gives three named amounts, each tied to a reason in their own words, and never a bare "donate".
4. **The commercial line is a trust signal, not a threat.** "If you build for clients with it, pay" states the norm the way Obsidian does. It is not enforced, and the page does not pretend it is.
5. **Timing.** The wish to pay peaks right after a saved afternoon. So the one surface this costs is a single line the app can show after the 25th published change ("Supasito has published 25 changes across 3 sites for you. If it's earning its keep, pay what it's worth."), dismissable forever, and even that is a candidate for PLAN §9, not a decision. The page itself asks once, quietly, after the demo.

**The three amounts (suggested, not tiers; nothing is unlocked).**

| Amount | The reason, in their words |
| --- | --- |
| $29 | "It saved me an afternoon." |
| $79 | "I use it for client work." |
| $149 | "Keep building it. I'm in." |

**What it costs, and why that is fine now.** Honour models convert a small fraction of downloads. At v0.1 the goal is users, papercuts (PLAN §8c), timeline interviews and the first references, which a price gate would throttle. The number to watch is downloads to payments; the number that matters is downloads to third sites added.

**What changes elsewhere.** WEBSITE.md §4 is rewritten around this. The "founders' batch" becomes the first supporters, listed on the page by name if they opt in. The download is a public link on GitHub Releases; no zip is hidden. The source-available LICENSE still matters: it says what the honour system asks.

## 13. Sources

For §12: Claude Code session scoping: https://code.claude.com/docs/en/sessions · "Group recent sessions in sidebar by project" (anthropics/claude-code #56067): https://github.com/anthropics/claude-code/issues/56067 · Managing several projects in Claude Code: https://tacticremote.com/blog/2026-02-28-managing-multiple-claude-code-sessions/ and https://memclaw.me/blog/posts/manage-multiple-projects-claude-code · Freelancers and context switching: https://dev.to/ryanrudd/freelance-developers-can-reduce-context-switching-from-client-feedback-4dha and https://www.deelo.ai/blog/freelancer-multiple-clients-management-2026 · Tool sprawl and cognitive load: https://www.uctoday.com/productivity-automation/cognitive-load-workplace-productivity-tool-sprawl/ · Zeigarnik effect and the Masicampo–Baumeister plan finding: https://super-productivity.com/blog/zeigarnik-effect-productivity/ and https://spacedaily.com/j-v-the-zeigarnik-effect-helps-explain-why-unfinished-goals-can-feel-louder-than-completed-ones-but-modern-research-suggests-the-minds-pull-toward-open-loops-is-far-more-conditional-than-the/ · Self-Determination Theory in UX (NN/g): https://www.nngroup.com/articles/autonomy-relatedness-competence/ · Website mistakes that cost customers: https://www.entrepreneur.com/building-a-business/7-website-mistakes-that-are-costing-your-business-customers

For §1–§10: Claude Code desktop docs: https://code.claude.com/docs/en/desktop · Anthropic, "Preview, review, and merge with Claude Code": https://claude.com/blog/preview-review-and-merge-with-claude-code · VentureBeat on the April 2026 redesign and Routines: https://venturebeat.com/orchestration/we-tested-anthropics-redesigned-claude-code-desktop-app-and-routines-heres-what-enterprises-should-know · Builder.io, "How to use Claude Code's preview feature for visual editing (and where it stops)": https://www.builder.io/blog/claude-code-visual-editor · Frontman comparison matrix: https://frontman.sh/compare/ · Onlook pricing: https://www.onlook.com/pricing · Anthropic, "Introducing Claude Design": https://www.anthropic.com/news/claude-design-anthropic-labs · Lovable/Bolt/v0 lock-in comparison: https://wz-it.com/en/blog/lovable-vs-bolt-vs-v0-comparison-2026/ · "Skip the terminal" (non-technical Claude Code guide): https://hannahstulberg.substack.com/p/skip-the-terminal-and-8-other-claude · Marketer's guide to Claude Code: https://getmarketingwithai.substack.com/p/the-marketers-guide-to-claude-code · Small-business website maintenance costs 2026: https://www.surmado.com/blog/website-management-cost-2026 and https://www.jim.com/blog/small-business-website-cost · Frameworks: April Dunford, *Obviously Awesome*; Geoffrey Moore, *Crossing the Chasm*; Chip and Dan Heath, *Made to Stick*.
