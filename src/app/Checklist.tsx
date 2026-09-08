// What this Mac has: Claude Code (and its sign-in), Node.js, git, a package manager. One line
// per missing tool saying where to get it and what to run, so a first-time user can follow the
// app's own text. Links go through openExternal — in the Tauri webview a plain anchor opens nothing.
import { useState, type ReactNode } from "react";
import { openExternal } from "../backend";
import { useStore } from "./store";
import type { Toolchain } from "../types";
import { copyText, cx } from "../util";

type Row = { key: string; label: string; ok: boolean | null; detail: string; fix?: ReactNode; optional?: boolean; warn?: boolean };

/** The bundled starter is Next 16, which needs Node 20 or newer. */
const NODE_MIN = 20;

/** A link that opens in the user's browser instead of navigating the app window. */
function Ext({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} onClick={(e) => { e.preventDefault(); void openExternal(href); }}>{children}</a>;
}

/** A Terminal command; clicking copies it, so nobody has to retype `xcode-select --install`.
 *  `block` puts a long one on its own line, where wrapping still reads as one command. */
function Cmd({ children, block }: { children: string; block?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <code
      className={cx("cmd", block && "block")}
      title="Click to copy"
      onClick={(e) => {
        const el = e.currentTarget;
        void copyText(children).then((ok) => {
          if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1400); return; }
          // Clipboard refused: select the command so ⌘C still works.
          const sel = window.getSelection();
          if (!sel) return;
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
        });
      }}
    >
      {copied ? "Copied" : children}
    </code>
  );
}

/** Leading number of a version string ("24.4.0" → 24), or null when it isn't one. */
function major(version?: string | null): number | null {
  const n = Number.parseInt(String(version ?? "").split(".")[0] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

/** Node is installed but older than the starter can use. */
export function nodeTooOld(t: Toolchain | null): boolean {
  const m = t?.node.ok ? major(t.node.version) : null;
  return m !== null && m < NODE_MIN;
}

/** True when the session or the preview cannot work yet. */
export function claudeBlocked(t: Toolchain | null): boolean {
  return !!t && (!t.claude.ok || t.claude.loggedIn === false);
}
export function toolsMissing(t: Toolchain | null): boolean {
  return !!t && (claudeBlocked(t) || !t.node.ok || nodeTooOld(t) || !t.git.ok || (t.node.ok && !t.packageManager));
}
/** Everything is here, but something will bite later — git has no name to save versions under. */
export function toolsWarn(t: Toolchain | null): boolean {
  return !!t && t.gitIdentity === false;
}

export function toolRows(t: Toolchain | null): Row[] {
  if (!t) return ["Claude Code", "Node.js", "git", "Package manager"].map((label) => ({ key: label, label, ok: null, detail: "Checking…" }));
  const c = t.claude;
  const brew = !!t.hasBrew;
  const claude: Row = !c.ok
    ? { key: "claude", label: "Claude Code", ok: false, detail: "Not found", fix: <>Install it from <Ext href="https://claude.com/claude-code">claude.com/claude-code</Ext>, then run <Cmd>claude</Cmd> once in Terminal and sign in.</> }
    : c.loggedIn === false
      ? { key: "claude", label: "Claude Code", ok: false, detail: `${c.version ?? ""} · not signed in`.trim(), fix: <>In Terminal, run <Cmd>claude auth login</Cmd> and finish the sign-in in your browser.</> }
      : { key: "claude", label: "Claude Code", ok: true, detail: [c.version, c.loggedIn ? `signed in${c.authMethod && c.authMethod !== "none" ? ` (${c.authMethod})` : ""}` : null].filter(Boolean).join(" · ") };
  const getNode = <>Download the LTS installer from <Ext href="https://nodejs.org/en/download">nodejs.org</Ext>{brew ? <> or run <Cmd>brew install node</Cmd></> : null}, then click Check again.</>;
  const node: Row = !t.node.ok
    ? { key: "node", label: "Node.js", ok: false, detail: "Not found", fix: <>Runs your site's dev server, and npm comes with it. {getNode}</> }
    : nodeTooOld(t)
      ? { key: "node", label: "Node.js", ok: false, warn: true, detail: `${t.node.version} · too old`, fix: <>The starter needs Node {NODE_MIN} or newer. {getNode}</> }
      : { key: "node", label: "Node.js", ok: true, detail: t.node.version ?? "" };
  const gitFor = <>Supasito uses git for Undo and Publish. </>;
  const git: Row = !t.git.ok
    ? t.git.path === "/usr/bin/git"
      ? { key: "git", label: "git", ok: false, detail: "Command line tools not installed", fix: <>{gitFor}In Terminal, run <Cmd>xcode-select --install</Cmd>, click Install in the dialog macOS opens, and wait for it to finish.</> }
      : { key: "git", label: "git", ok: false, detail: "Not found", fix: <>{gitFor}Install it from <Ext href="https://git-scm.com/downloads/mac">git-scm.com</Ext>{brew ? <> or run <Cmd>brew install git</Cmd></> : <> — or run <Cmd>xcode-select --install</Cmd>, which includes git</>}.</> }
    : t.gitIdentity === false
      ? { key: "git", label: "git", ok: false, warn: true, detail: `${t.git.version ?? ""} · no name set`.trim(), fix: <>git saves each version under your name, and won't save any until it has one. In Terminal, run both:<Cmd block>git config --global user.name "Your Name"</Cmd><Cmd block>git config --global user.email you@example.com</Cmd></> }
      : { key: "git", label: "git", ok: true, detail: t.git.version ?? "" };
  const pm = t.packageManager;
  const packageManager: Row = pm
    ? { key: "pm", label: "Packages", ok: true, detail: `${pm.name} ${pm.version ?? ""}`.trim(), fix: pm.name === "npm" ? <>Works as is. pnpm installs new sites faster: <Cmd>npm install -g pnpm</Cmd> (<Ext href="https://pnpm.io/installation">pnpm.io</Ext>).</> : undefined, optional: true }
    : t.node.ok
      ? { key: "pm", label: "Packages", ok: false, detail: "npm not found", fix: <>Installs what the site needs. npm normally comes with Node.js — reinstall it from <Ext href="https://nodejs.org/en/download">nodejs.org</Ext>.</> }
      : { key: "pm", label: "Packages", ok: null, detail: "Comes with Node.js", optional: true };
  return [claude, node, git, packageManager];
}

export function Checklist({ compact }: { compact?: boolean }) {
  const tools = useStore((s) => s.tools);
  const recheck = useStore((s) => s.recheckTools);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [checking, setChecking] = useState(false);
  const rows = toolRows(tools);
  const again = () => { setChecking(true); void recheck().finally(() => setChecking(false)); };
  return (
    <div className={cx("checklist", compact && "compact")}>
      {rows.map((r) => (
        <div key={r.key} className={cx("check", r.ok === true && "ok", r.ok === false && (r.warn ? "warn" : !r.optional && "missing"))}>
          <span className={cx("check-dot", r.ok === true && "ok", r.ok === false && (r.warn ? "warn" : "no"))} />
          <span className="label">{r.label}</span>
          <span className="detail">{r.detail}</span>
          {r.fix && <span className="fix">{r.fix}</span>}
        </div>
      ))}
      <div className="actions">
        <button className="btn sm" disabled={checking} onClick={again}>{checking ? "Checking…" : "Check again"}</button>
        {tools && !tools.claude.ok && !compact && <button className="btn sm ghost" onClick={() => setSettingsOpen(true)}>Set the path manually</button>}
      </div>
    </div>
  );
}
