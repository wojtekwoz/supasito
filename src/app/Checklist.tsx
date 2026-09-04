// What this Mac has: Claude Code (and its sign-in), Node.js, git, a package manager. One line
// per missing tool saying how to get it, so a first-time user can follow the app's own text.
import { useState, type ReactNode } from "react";
import { useStore } from "./store";
import type { Toolchain } from "../types";
import { cx } from "../util";

type Row = { key: string; label: string; ok: boolean | null; detail: string; fix?: ReactNode; optional?: boolean };

/** True when the session or the preview cannot work yet. */
export function claudeBlocked(t: Toolchain | null): boolean {
  return !!t && (!t.claude.ok || t.claude.loggedIn === false);
}
export function toolsMissing(t: Toolchain | null): boolean {
  return !!t && (claudeBlocked(t) || !t.node.ok || !t.git.ok || (t.node.ok && !t.packageManager));
}

export function toolRows(t: Toolchain | null): Row[] {
  if (!t) return ["Claude Code", "Node.js", "git", "Package manager"].map((label) => ({ key: label, label, ok: null, detail: "Checking…" }));
  const c = t.claude;
  const claude: Row = !c.ok
    ? { key: "claude", label: "Claude Code", ok: false, detail: "Not found", fix: <>Install it from <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">claude.com/claude-code</a>, then run <code>claude</code> once in Terminal and sign in.</> }
    : c.loggedIn === false
      ? { key: "claude", label: "Claude Code", ok: false, detail: `${c.version ?? ""} · not signed in`.trim(), fix: <>In Terminal, run <code>claude auth login</code> and finish the sign-in in your browser.</> }
      : { key: "claude", label: "Claude Code", ok: true, detail: [c.version, c.loggedIn ? `signed in${c.authMethod && c.authMethod !== "none" ? ` (${c.authMethod})` : ""}` : null].filter(Boolean).join(" · ") };
  const node: Row = t.node.ok
    ? { key: "node", label: "Node.js", ok: true, detail: t.node.version ?? "" }
    : { key: "node", label: "Node.js", ok: false, detail: "Not found", fix: <>Runs the site's dev server. Install the LTS from <a href="https://nodejs.org" target="_blank" rel="noreferrer">nodejs.org</a> (or <code>brew install node</code>); npm comes with it.</> };
  const git: Row = t.git.ok
    ? { key: "git", label: "git", ok: true, detail: t.git.version ?? "" }
    : { key: "git", label: "git", ok: false, detail: t.git.path === "/usr/bin/git" ? "Command line tools not installed" : "Not found", fix: <>Keeps the history behind Undo and Publish. In Terminal, run <code>xcode-select --install</code> (Apple's command line tools include git).</> };
  const pm = t.packageManager;
  const packageManager: Row = pm
    ? { key: "pm", label: "Packages", ok: true, detail: `${pm.name} ${pm.version ?? ""}`.trim(), fix: pm.name === "npm" ? <>Works. pnpm is faster for new sites: <code>npm install -g pnpm</code>.</> : undefined, optional: true }
    : t.node.ok
      ? { key: "pm", label: "Packages", ok: false, detail: "npm not found", fix: <>npm normally comes with Node.js; reinstall Node from <a href="https://nodejs.org" target="_blank" rel="noreferrer">nodejs.org</a>.</> }
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
        <div key={r.key} className={cx("check", r.ok === true && "ok", r.ok === false && !r.optional && "missing")}>
          <span className={cx("check-dot", r.ok === true && "ok", r.ok === false && "no")} />
          <span className="label">{r.label}</span>
          <span className="detail">{r.detail}</span>
          {r.fix && (r.ok !== true || !compact) && <span className="fix">{r.fix}</span>}
        </div>
      ))}
      <div className="actions">
        <button className="btn sm" disabled={checking} onClick={again}>{checking ? "Checking…" : "Check again"}</button>
        {tools && !tools.claude.ok && !compact && <button className="btn sm ghost" onClick={() => setSettingsOpen(true)}>Set the path manually</button>}
      </div>
    </div>
  );
}
