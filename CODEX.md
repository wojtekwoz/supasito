# Codex as a second agent backend — plan

Status: not built. This is the design for the one line in PLAN.md §9a ("second agent backend behind
the same `agent://` events"). Everything below marked *verified* was recorded against **codex-cli
0.149.0 on 2026-09-10** with the probe in §3.4; everything else is marked as an open question.

## 1. The decision, in one paragraph

Supasito does not grow an "agent" concept. **The model picker becomes the backend picker**: one list
that holds Claude's models and Codex's models, and choosing GPT-5.6-Terra starts a `codex` thread
where choosing Opus 5 starts a `claude` process. The user learns nothing new — they already answer
"which model does the work" once per session. Everything downstream (preview, pointing, approvals,
Undo, publish) stays identical because it already speaks `Item[]` and git, not stream-json. If this
costs a new pane, a new mode, or a second approval UI, it has been built wrong.

## 2. Should it be built now

No, not before v0.2 closes. §9 is explicit that everything until "someone who isn't you can install
it and publish" is guesswork, and a second backend doubles the surface that the trial is meant to
test. The reason to move it up is not technical: it is that a person who has a ChatGPT plan and no
Claude plan currently cannot use Supasito at all. If that person is the market, this jumps the queue
and §9's ordering changes with it. That is a positioning call, not an engineering one.

## 3. What Codex actually speaks

### 3.1 The transport (verified)

`codex app-server` on stdio, JSON-RPC 2.0, one message per line — the same shape as claude.rs's
stream-json loop, so the writer/reader/exit-watcher skeleton is reusable almost verbatim.

    → {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"supasito","version":"…"}}}
    ← {"id":1,"result":{"userAgent":"supasito/0.149.0 (…)","codexHome":"/Users/…/.codex", …}}
    → {"jsonrpc":"2.0","method":"initialized"}
    → {"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":…,"model":…,"approvalPolicy":…,"sandbox":…,"developerInstructions":…}}
    ← {"id":2,"result":{"thread":{"id":"01a08c58-…", …}}}
    → {"jsonrpc":"2.0","id":3,"method":"turn/start","params":{"threadId":…,"input":[{"type":"text","text":"…"}]}}
    ← {"id":3,"result":{"turn":{"id":"01a08c58-…","status":"inProgress"}}}

Then a notification stream until `turn/completed`. `app-server` is flagged experimental; that is the
main version risk and §9 of this doc says how it is contained.

### 3.2 What arrives during a turn (verified trace)

`turn/started` → `item/started`/`item/completed` pairs carrying a typed `ThreadItem` (userMessage,
reasoning, agentMessage, commandExecution, fileChange, mcpToolCall, webSearch, plan, imageView,
contextCompaction, subAgentActivity, …) → deltas on the side (`item/agentMessage/delta`,
`item/reasoning/summaryTextDelta`, `item/commandExecution/outputDelta`) → `turn/diff/updated` with
the whole turn's unified diff → `thread/tokenUsage/updated` → `account/rateLimits/updated` →
`turn/completed`. Approvals interrupt this as **server→client JSON-RPC requests**.

This is a better contract than Claude's for our purposes, in three concrete ways:

- `fileChange.changes[]` carries `kind: {type: add|delete|update, move_path?}` **and** the diff, so
  Undo learns "this file was created" from the protocol instead of the `agent://fs` existence probe
  Rust does today before every `Write`.
- `thread/tokenUsage/updated` carries `modelContextWindow` outright; the context ring stops guessing.
- `account/rateLimits/updated` arrives every turn (usedPercent, windowDurationMins, resetsAt,
  planType, credits), where Claude's only shows up in a `rate_limit_event`.

And one thing it does not have: **no cost in dollars anywhere**. The usage ring's per-turn `$` must
render "—" for Codex sessions rather than `$0.00`.

### 3.3 Approvals (verified)

Server requests, answered with a JSON-RPC result on the same numeric id:

| Server request | Params | Response |
| --- | --- | --- |
| `item/commandExecution/requestApproval` | threadId, turnId, itemId, command, cwd, commandActions, environmentId | `{"decision":"accept"\|"acceptForSession"\|"decline"\|"cancel"}` |
| `item/fileChange/requestApproval` | threadId, turnId, itemId, reason, grantRoot | same four decisions |

Two traps, both hit in the probe: **the file-change approval carries no diff** (it arrives on the
preceding `item/started` fileChange item, joined by `itemId`), and **any unanswered server request
blocks the turn forever** — including ones we never implement (`item/tool/requestUserInput`,
`mcpServer/elicitation/request`, `item/permissions/requestApproval`, `attestation/generate`,
`account/chatgptAuthTokens/refresh`, `item/tool/call`). Same rule as claude.rs's unknown
`control_request`: answer everything, with a JSON-RPC error when unsupported.

### 3.4 Re-recording the trace

Fixtures for the reducer tests come from this, not from the schema (repo convention: record the CLI,
put the lines in a test):

```bash
codex app-server generate-json-schema --out /tmp/codex-schema   # the typed protocol, for reference
node scripts/codex-probe.mjs /tmp/site > /tmp/trace.jsonl        # to be written; ~30 lines of node
```

The probe drives initialize → thread/start → turn/start with a prompt that forces one command, one
file write and one approval of each kind, auto-accepts both, and dumps every line. Its output is the
fixture for `src/agent/codex.test.ts`.

## 4. Architecture

### 4.1 Process model

Claude is one process per session with an id **we** choose (`--session-id`). Codex is one app-server
that hosts **many** threads with ids **it** mints. Decisions:

- **One `codex app-server` per site**, refcounted by that site's live threads, torn down when the
  last one closes or the site is removed. Not one per session (wasteful, and thread/start already
  takes cwd), not one global (a crash would take every site down, and stop/kill semantics would stop
  matching the existing registry).
- **Never `codex app-server daemon`.** It is shared with the user's own Codex app, outlives us, and
  another client could answer our approvals. Own child, own process group, stdio.
- Session ids are **namespaced at the boundary**: the UI, app state and `Site.lastSessionId` hold
  `codex:<threadId>`; the Rust side strips the prefix. Every string-keyed map (registry, badge,
  running list, transcript cache) keeps working untouched, and "which backend is this session?" is
  answerable from the id alone after a restart.
- **`codex` on PATH may be a Node wrapper** (npm's `@openai/codex` is: `#!/usr/bin/env node`, which
  spawns the real binary under `node_modules/@openai/codex-darwin-arm64/vendor/…` as a child). So
  "the process" is two processes, SIGINT to the wrapper's pid is not enough, and the exit watcher sees
  the wrapper. claude.rs's `process_group(0)` + group kill already handles it; `stop()`'s first SIGINT
  to the bare pid does not. Homebrew's bottle may be the native binary instead — locate/version must
  accept both. Measured: the real binary idles at ~270 MB RSS with one thread, which is why this is
  per-site and not per-session.
- **Other app-servers are running on the same Mac.** Verified: the ChatGPT desktop app keeps two
  `codex app-server` processes alive. A blind `ps | grep app-server` reaper would kill the user's own
  app. The argv marker below is not optional.
- `agent_start` for Codex must await `thread/start` before returning the id (a few hundred ms). It is
  already async; the composer's in-flight guard already covers the double-send race.

### 4.2 Rust

`src-tauri/src/agent/codex.rs` — the only place that speaks the app-server protocol, mirroring the
comment discipline at the top of claude.rs. The registry holds an enum, not a trait object (two
variants, ever; compile-time exhaustiveness beats boxing):

```rust
enum Agent { Claude(Arc<claude::Handle>), Codex(Arc<codex::Thread>) }
```

with the same surface: `send_user`, `respond`, `interrupt`, `set_model`, `stop`. `codex::Thread`
additionally tracks `turn_id` (interrupt and steer both need it) and the app-server it belongs to.

### 4.3 The `agent://` boundary

Unchanged, which is the whole point of having had it. `agent://message` carries a codex notification
instead of a stream-json line; the store routes on the session's backend. `agent://permission` keeps
its shape — Codex approvals are **shimmed into the Claude-shaped request** (`tool_name: "Bash"` with
`input.command`, or `"Write"`/`"Edit"` with `input.file_path`, plus `itemId`) so `Approval.tsx`
renders with no branch. `agent://fs` becomes Claude-only. `agent://control_error` carries JSON-RPC
errors.

### 4.4 TypeScript

`src/agent/transcript.ts` splits: the `Item` union, `SessionState`, `toolLabel`, `filesTouchedInTurn`
and the helpers stay; `applyMessage` becomes `applyClaudeMessage`, and `src/agent/codex.ts` gets
`applyCodexMessage` producing the **same `Item[]`**. `SessionState` gains `backend`. Rejected
alternative: translating Codex into stream-json in Rust — it is lossy (no matching tool_use ids, no
usage shape, no cost), it buries what Codex knows that Claude does not, and it puts UI-shaped logic
in Rust, which is exactly the split claude.rs was written to avoid.

## 5. Mappings

### 5.1 Items → transcript rows

| Codex | Supasito |
| --- | --- |
| `agentMessage` (+ delta), `phase: commentary\|final_answer` | assistant bubble; commentary is the pre-tool narration |
| `reasoning` (+ summaryTextDelta) | assistant `thinking` — **needs `summary:"auto"` on turn/start**, else it arrives empty (verified: empty in the probe, which did not ask) |
| `commandExecution` | tool row, name `Bash`, label from `command`, result from `aggregatedOutput`, status from `inProgress\|completed\|failed\|declined` |
| `fileChange` | tool row per change; `kind.type` gives `created` for Undo; `move_path` is a rename |
| `mcpToolCall`, `webSearch`, `imageView`, `sleep`, `plan`, `dynamicToolCall`, `subAgentActivity` | tool rows with their own labels |
| `contextCompaction`, `thread/compacted` | the existing "summarised the older part" notice |
| `turn/completed` | result row: duration from `turn.durationMs`, files from the turn's fileChanges, **cost null**, error from `turn.error.message` |
| `error` with `willRetry:true` | the existing retry banner |
| `warning`, `configWarning`, `deprecationNotice` | debug pane, not the transcript (the probe emitted a skills-budget warning that would be pure noise) |
| unknown `item.type` / unknown notification | generic tool row / ignored-but-logged. Forward compatibility is a rule, not a nicety: this protocol is experimental |

### 5.2 Models, effort, fast

`model/list` returns id, displayName, description, `supportedReasoningEfforts`, `defaultReasoningEffort`,
`isDefault`, `inputModalities`, `serviceTiers` — so the Codex half of `src/models.ts` is **fetched and
cached, not hardcoded**, with a small hardcoded fallback when the call fails. Consequences: efforts
come per-model (some offer `ultra`, which Supasito's fixed low…max list does not have), and "Fast"
maps to `serviceTier: "priority"` offered only by models that list it — the exact shape of today's
`supportsFast`. Mid-session switching is easier than Claude's: `model`, `effort`, `summary` and
`serviceTier` are all per-turn parameters on `turn/start`, so no control request is needed.

### 5.3 Permission modes

| Supasito | Codex |
| --- | --- |
| default | `approvalPolicy: "untrusted"` + workspaceWrite (verified: prompts for both a command and a write) |
| acceptEdits (today's default) | `"on-request"` + workspaceWrite *(unverified — the probe only exercised `untrusted`)* |
| bypassPermissions | `"never"` + `dangerFullAccess` |
| plan | **no equivalent — hide the option for Codex sessions.** Faking it with a read-only sandbox would produce a mode that lies |

### 5.4 Approval answers

Allow → `accept`. "Always allow" → `acceptForSession`. Deny → `decline`. Deny-and-stop → `cancel`.
The deny card's free-text reason has nowhere to go in the Codex decision, so it is sent as a
`turn/steer` immediately after the `decline`, which reaches the model as a mid-turn user message —
the same effect Claude's `message` field has.

## 6. Edge cases

**Config leakage (verified, and it failed hard).** The user's `~/.codex/config.toml` named model
`gpt-6-astra`; the installed CLI could not use it and the turn died with a raw 400 body. The same
start pulled in four MCP servers, ran two hooks and warned that skill descriptions had been truncated
to fit the context budget. Rules: **always pass an explicit model** from Supasito's own list, never
inherit the config default; surface the loaded MCP servers and hooks in the debug pane, since they
change behaviour and eat context; keep the user's config otherwise (Supasito respects `~/.claude`
settings the same way). If the skills budget bites in practice, `thread/start`'s `config` override is
the escape hatch.

**System prompt.** Use `developerInstructions` (additive). **Never `baseInstructions`** — it replaces
Codex's own tool instructions and would break apply_patch.

**AGENTS.md vs CLAUDE.md.** The site rules dialog writes CLAUDE.md, which Codex does not read. Fix:
the dialog writes **AGENTS.md**, and CLAUDE.md becomes the single line `@AGENTS.md` — Claude Code's
import syntax, not a prose pointer it might or might not follow. Existing sites need a one-time move
of their CLAUDE.md content on the dialog's next save. The starter ships both.

**The sandbox is the approve step, not an obstacle (verified 2026-09-10, second probe).** Under
`sandbox: read-only` + `approvalPolicy: on-request`, a file write produced `item/fileChange/requestApproval`;
`accept` wrote the file **outside** the sandbox. So approval escalates, and the sandbox is what turns
"a command needs the network" into an approval card rather than a silent failure. Ship Codex's own
defaults — `workspaceWrite`, network off, `writableRoots` = the site folder — and let the card be the
gate. Do **not** pass `networkAccess: true` (an earlier draft of this plan said to, for "parity with
Claude"; parity would throw away the one safety property Claude does not have). Unverified: the
command path with network specifically — the probe only exercised the write path.

**Interrupt needs a turn id.** Track it from `turn/started`; Stop between turns must be a no-op, not
an error.

**Queue is a race.** `turn/steer` requires `expectedTurnId` as a precondition and fails if the turn
completed in the meantime — which is exactly when a queued message is most likely to be sent. Steer
when a turn is active, catch the precondition failure, fall back to `turn/start`.

**Stop must decline first.** Killing the process with an approval outstanding leaves the saved thread
mid-approval. Answer every pending request with `decline`, then close stdin, then signal.

**Orphan reaping.** `ps` matching on `claude` + sessionId does not transfer: the thread id is not in
the app-server's argv, and blind-matching `codex app-server` could kill a process belonging to the
user's own Codex app. Mark ours in argv — `codex -c supasito.session="<siteId>" app-server` — and
match on that. Verified: unknown `-c` keys are accepted (they only warn; do not pass `--strict-config`).

**Sessions come from the protocol, never from disk.** `~/.codex` currently holds legacy JSONL
rollouts, a `thread_history_1.sqlite`, and a `migrate-rollouts` subcommand for moving between them —
the layout is mid-migration. Use `thread/list` (it filters by `cwd`, which is precisely what
`sessions_list` needs) and `thread/read {includeTurns:true}` for replay. Bonus: replay and live use
the same `ThreadItem` shapes, so unlike Claude's saved JSONL there is no second dialect to handle.

**Undo asymmetry.** After Supasito's Undo, the model still believes it made the change — true for
Claude today and equally true for Codex. `thread/rollback` exists but is marked deprecated, so do not
build on it; the honest fix stays "the next message says what actually happened".

**Auth.** `codex login status` prints `Logged in using ChatGPT` (verified) — that is the toolchain
check. Open question: whether a long session ever gets `account/chatgptAuthTokens/refresh` from the
server, which we would be erroring; the symptom would be a turn failing on auth after ~an hour.

**The checklist stops demanding one CLI.** With two backends the rule becomes "at least one agent
installed, and you can only pick models you have". Checklist.tsx grows a second block and neither one
is fatal on its own.

## 7. What changes, file by file

| File | Change |
| --- | --- |
| `src-tauri/src/agent/codex.rs` | new; the only place that speaks app-server |
| `src-tauri/src/agent/mod.rs` | `Agent` enum, shared `system_prompt`, image handling for Codex's `localImage`/data-URL input |
| `src-tauri/src/agent/sessions.rs` | Claude path unchanged; Codex listing/replay goes through a short-lived app-server |
| `src-tauri/src/lib.rs` | `start_agent` picks the backend from the model; id namespacing |
| `src-tauri/src/toolchain.rs` | `codex` binary, version floor, `codex login status` |
| `src-tauri/src/smoke.rs` | `SUPASITO_SMOKE_AGENT=codex` across queue/interrupt/mode/model/undo/tools |
| `src/agent/transcript.ts` | split shared helpers out; `applyClaudeMessage` |
| `src/agent/codex.ts` + `.test.ts` | new reducer + fixture tests from the recorded trace |
| `src/models.ts` | Codex catalogue fetched from `model/list`, per-model efforts, `priority` tier as Fast |
| `src/app/Checklist.tsx`, `Session.tsx`, `Usage.tsx`, `Dialogs.tsx` | two agents in the checklist; backend in the session header; "—" for cost; AGENTS.md in site rules |
| `src/mock.ts` | `?agent=codex` replaying the fixture, so UI work needs no CLI |
| `src/types.ts`, `state.rs` | `backend` on sessions and settings, `codexPath` |

## 8. Milestones, each with the thing that proves it

1. **Fixtures.** The probe script committed, a trace recorded, reducer tests red. *Proof: `pnpm test`.*
2. **It talks.** codex.rs spawns, initializes, starts a thread, streams one turn into the transcript;
   read-only, no approvals. *Proof: a message and a reply render in the app against a scratch site.*
3. **It works.** Approvals both ways, interrupt, steer/queue, decline-with-reason. *Proof: smoke
   scenarios `queue`, `interrupt`, `tools` pass with `SUPASITO_SMOKE_AGENT=codex`.*
4. **It's pickable.** One model list, per-session backend, switching backend offers a new session
   rather than silently dropping history. *Proof: a site with one Claude and one Codex session, both
   resumable after a relaunch.*
5. **It remembers.** `thread/list`/`thread/read` behind the existing session list and replay.
   *Proof: reopening a Codex session from yesterday renders the same transcript.*
6. **It onboards.** Toolchain check, checklist copy, AGENTS.md, mock mode. *Proof: a fake `HOME` with
   only `codex` installed reaches a working preview following only the app's text.*
7. **It's honest.** Context from `modelContextWindow`, plan usage from `account/rateLimits`, cost
   blank rather than zero, docs updated (CLAUDE.md's "where things are", PLAN.md §9a → §9, CHANGELOG).

## 9. Risks and what contains them

`app-server` is experimental and the CLI moves weekly. Containment: a version floor checked at
startup with a plain "update Codex" message rather than a JSON-RPC failure; protocol-only reads (no
parsing of `~/.codex`); unknown items and notifications degrade to a generic row instead of vanishing;
and the fixture regenerated by one script whenever the CLI updates. The second risk is honesty drift —
two backends where the app's numbers mean different things. Containment: anything Codex cannot report
renders as absent, never as zero.

## 10. What stays out

Codex Cloud, `codex review`, plugins/marketplace, MCP management, the shared daemon, remote control,
realtime/voice, multi-agent (`collabAgentToolCall` renders as a row and nothing more), and a
per-backend settings screen. Each is a surface, and none of them shortens say → change → see →
approve → publish.
