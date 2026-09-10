#!/usr/bin/env node
// Records one Codex app-server turn as the fixture for src/agent/codex.test.ts.
//
//   node scripts/codex-probe.mjs <scratch git repo> > src/agent/fixtures/codex-<version>-write-turn.jsonl
//
// Drives initialize → thread/start → turn/start with a prompt that runs one command and writes one
// file under approvalPolicy "untrusted", so both approval kinds are asked for and auto-accepted.
// Paths and machine identifiers are scrubbed so the fixture is portable. Re-run after `codex update`.
import { spawn } from "node:child_process";
import readline from "node:readline";
import { homedir } from "node:os";

const cwd = process.argv[2];
if (!cwd) { console.error("usage: codex-probe.mjs <scratch git repo>"); process.exit(2); }
const model = process.env.CODEX_PROBE_MODEL || "gpt-5.6-luna";
const p = spawn("codex", ["-c", 'supasito.site="probe"', "app-server"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
const send = (o) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
const scrub = (l) => l.split(cwd).join("/Users/me/site").split(homedir()).join("/Users/me").replace(/"installationId":"[^"]*"/g, '"installationId":"x"');
let id = 0, threadId = null;
p.stderr.on("data", (d) => process.stderr.write(`[stderr] ${d}`));
readline.createInterface({ input: p.stdout }).on("line", (l) => {
  console.log(scrub(l));
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.id === 1) {
    send({ method: "initialized" });
    send({ id: ++id, method: "thread/start", params: { cwd, model, approvalPolicy: "untrusted", sandbox: "workspace-write", developerInstructions: "You are inside a test harness. Keep replies to one sentence." } });
  }
  if (m.id === 2) {
    threadId = m.result?.thread?.id;
    send({ id: ++id, method: "turn/start", params: { threadId, summary: "auto", input: [{ type: "text", text: "Run the shell command `git status --short`, then write a file called probe.txt containing the word ok. Then reply with one short sentence." }] } });
  }
  if (m.method?.endsWith("requestApproval")) send({ id: m.id, result: { decision: "accept" } });
  if (m.method === "turn/completed") setTimeout(() => { p.kill("SIGTERM"); process.exit(0); }, 300);
});
send({ id: ++id, method: "initialize", params: { clientInfo: { name: "supasito-probe", version: "0.0.1" } } });
setTimeout(() => { console.error("timeout"); p.kill("SIGTERM"); process.exit(1); }, 180_000);
