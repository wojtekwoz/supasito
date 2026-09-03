import { useEffect, useState } from "react";
import { useStore } from "./store";
import { Check } from "../ui/Icons";

export function NewSiteDialog() {
  const ns = useStore((s) => s.newSite);
  const openNewSite = useStore((s) => s.openNewSite);
  const createSite = useStore((s) => s.createSite);
  const [name, setName] = useState("");
  if (!ns.open) return null;
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !ns.running) openNewSite(false); }}>
      <div className="modal">
        <h2>New site</h2>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>Open copies its Next.js starter into a folder you choose, installs packages, and starts a session. Describe the site in your first message.</p>
        <div className="row2">
          <label>Name</label>
          <input className="text-input" autoFocus placeholder="e.g. ClarityOps" value={name} onChange={(e) => setName(e.target.value)} disabled={ns.running} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void createSite(name); }} />
        </div>
        {ns.running && <div className="log">{ns.log.slice(-14).join("\n") || "Copying the starter…"}</div>}
        {ns.error && <div className="err">{ns.error}</div>}
        <div className="foot">
          <button className="btn ghost" disabled={ns.running} onClick={() => openNewSite(false)}>Cancel</button>
          <button className="btn primary" disabled={ns.running || !name.trim()} onClick={() => void createSite(name)}>{ns.running ? "Creating…" : "Choose a folder and create"}</button>
        </div>
      </div>
    </div>
  );
}

const PRESETS: { label: string; cmd: string }[] = [
  { label: "Vercel", cmd: "vercel deploy --prod --yes" },
  { label: "Cloudflare", cmd: "wrangler deploy" },
  { label: "Netlify", cmd: "netlify deploy --prod" },
  { label: "Git push", cmd: "git push origin HEAD" },
];

export function PublishDialog() {
  const p = useStore((s) => s.publish);
  const setPublishOpen = useStore((s) => s.setPublishOpen);
  const site = useStore((s) => s.sites.find((x) => x.id === s.currentSiteId) ?? null);
  const git = useStore((s) => (s.currentSiteId ? s.git[s.currentSiteId] : null));
  const setPublishCommand = useStore((s) => s.setPublishCommand);
  const runPublish = useStore((s) => s.runPublish);
  const [editing, setEditing] = useState(false);
  const [cmd, setCmd] = useState("");
  useEffect(() => { if (p.open) { setEditing(!site?.publish); setCmd(site?.publish ?? ""); } }, [p.open, site?.publish]);
  if (!p.open) return null;
  const save = async (run: boolean) => {
    await setPublishCommand(cmd);
    setEditing(false);
    if (run && cmd.trim()) await runPublish();
  };
  const title = p.running ? "Publishing…" : editing ? (site?.publish ? "Change the publish command" : "How should this site be published?") : p.url ? "Published" : p.error ? "Publish failed" : "Publish";
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !p.running) setPublishOpen(false); }}>
      <div className="modal">
        <h2>{title}</h2>
        {editing ? (
          <>
            <p style={{ margin: 0, color: "var(--ink-2)" }}>Open runs one command from the site folder and shows you the result. It is saved in <code>open.json</code>.</p>
            <div className="presets">{PRESETS.map((x) => <button key={x.cmd} className={"btn sm" + (cmd === x.cmd ? " primary" : "")} onClick={() => setCmd(x.cmd)}>{x.label}</button>)}</div>
            <input className="text-input" autoFocus placeholder="e.g. vercel deploy --prod --yes" value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && cmd.trim()) void save(true); }} />
            <div className="foot">
              <button className="btn ghost" onClick={() => (site?.publish ? setEditing(false) : setPublishOpen(false))}>Cancel</button>
              <button className="btn" disabled={!cmd.trim()} onClick={() => void save(false)}>Save</button>
              <button className="btn primary" disabled={!cmd.trim()} onClick={() => void save(true)}>Save and publish</button>
            </div>
          </>
        ) : (
          <>
            {git && git.changed > 0 && !p.running && !p.url && <p style={{ margin: 0, color: "var(--ink-2)" }}>{git.changed} changed file{git.changed === 1 ? "" : "s"} since the last commit.</p>}
            <div className="log">{p.log.length ? p.log.join("\n") : site?.publish}</div>
            {p.url && <div className="url"><Check style={{ width: 14, height: 14, color: "var(--ok)", verticalAlign: -2 }} /> <a href={p.url} target="_blank" rel="noreferrer">{p.url}</a></div>}
            {p.error && <div className="err">{p.error}</div>}
            <div className="foot">
              {!p.running && <button className="btn ghost" onClick={() => setEditing(true)} style={{ marginRight: "auto" }}>Change command</button>}
              <button className="btn" disabled={p.running} onClick={() => setPublishOpen(false)}>Close</button>
              {!p.running && !p.url && <button className="btn primary" onClick={() => void runPublish()}>{p.error ? "Try again" : "Publish now"}</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const claude = useStore((s) => s.claude);
  const save = useStore((s) => s.saveSettings);
  const [form, setForm] = useState({ claudePath: "", model: "", permissionMode: "acceptEdits" });
  useEffect(() => { if (open) setForm({ claudePath: settings.claudePath ?? "", model: settings.model ?? "", permissionMode: settings.permissionMode ?? "acceptEdits" }); }, [open, settings]);
  if (!open) return null;
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal">
        <h2>Settings</h2>
        <div className="row2"><label>Claude Code</label><div style={{ color: "var(--ink-2)", fontSize: 12 }}>{claude?.ok ? `${claude.version} at ${claude.path}` : "Not found. Install from claude.com/claude-code, sign in once in a terminal."}</div></div>
        <div className="row2"><label>Path override</label><input className="text-input" placeholder="Leave empty to use PATH" value={form.claudePath} onChange={(e) => setForm({ ...form, claudePath: e.target.value })} /></div>
        <div className="row2"><label>Model</label><input className="text-input" placeholder="Default (e.g. sonnet, opus)" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
        <div className="row2"><label>Permissions</label>
          <select className="text-input" value={form.permissionMode} onChange={(e) => setForm({ ...form, permissionMode: e.target.value })}>
            <option value="acceptEdits">Edit files freely, ask before commands (recommended)</option>
            <option value="default">Ask before edits and commands</option>
            <option value="auto">Auto: a classifier reviews actions</option>
            <option value="bypassPermissions">Never ask (dangerous)</option>
          </select>
        </div>
        <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 12 }}>Changes apply to sessions started after saving.</p>
        <div className="foot">
          <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" onClick={() => { void save(form).then(() => setOpen(false)); }}>Save</button>
        </div>
      </div>
    </div>
  );
}
