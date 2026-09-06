import { useEffect, useState } from "react";
import { useStore } from "./store";
import { Check } from "../ui/Icons";
import { Checklist } from "./Checklist";
import { PlanRows } from "./Usage";
import { EFFORTS, EFFORT_HINTS, MODELS, baseModel, hasLongContext } from "../models";

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

const PRESETS: { label: string; production: string; preview: string }[] = [
  { label: "Vercel", production: "vercel deploy --prod --yes", preview: "vercel deploy --yes" },
  { label: "Cloudflare", production: "wrangler deploy", preview: "wrangler versions upload" },
  { label: "Netlify", production: "netlify deploy --prod", preview: "netlify deploy" },
  { label: "Git push", production: "git push origin HEAD:main", preview: "git push origin HEAD:staging" },
];

export function PublishDialog() {
  const p = useStore((s) => s.publish);
  const setPublishOpen = useStore((s) => s.setPublishOpen);
  const site = useStore((s) => s.sites.find((x) => x.id === s.currentSiteId) ?? null);
  const git = useStore((s) => (s.currentSiteId ? s.git[s.currentSiteId] : null));
  const session = useStore((s) => (s.currentSessionId ? s.transcripts[s.currentSessionId] ?? null : null));
  const setPublishCommand = useStore((s) => s.setPublishCommand);
  const runPublish = useStore((s) => s.runPublish);
  const cancelPublish = useStore((s) => s.cancelPublish);
  const [editing, setEditing] = useState(false);
  const [prod, setProd] = useState("");
  const [prev, setPrev] = useState("");
  const [target, setTarget] = useState<"preview" | "production">("production");
  const [commit, setCommit] = useState(true);
  const [push, setPush] = useState(true);
  const [message, setMessage] = useState("");
  const lastPrompt = session ? [...session.items].reverse().find((i) => i.kind === "user")?.text ?? "" : "";
  useEffect(() => {
    if (!p.open) return;
    setEditing(!site?.publish && !site?.preview);
    setProd(site?.publish ?? "");
    setPrev(site?.preview ?? "");
    setTarget(site?.preview ? p.target : "production");
    setMessage(lastPrompt.split("\n")[0].slice(0, 72) || "Update site");
  }, [p.open, site?.publish, site?.preview]);
  if (!p.open) return null;
  const changed = git?.changed ?? 0;
  const canCommit = !!git?.isGit && changed > 0;
  const canPush = !!git?.remote;
  const save = async () => {
    await setPublishCommand(prod, "publish");
    await setPublishCommand(prev, "preview");
    setEditing(false);
  };
  const go = () => void runPublish(target, { commit: canCommit && commit, message, push: canPush && push && (commit || changed === 0) });
  const phase = p.running ? "running" : editing ? "editing" : p.cancelled ? "cancelled" : p.url ? "done" : p.error ? "failed" : "ready";
  const title = { running: p.step === "commit" ? "Committing…" : p.step === "push" ? "Pushing to origin…" : p.target === "preview" ? "Publishing a preview…" : "Publishing to production…", editing: "How should this site be published?", cancelled: "Publish cancelled", done: p.target === "preview" ? "Preview is up" : "Published", failed: "Publish failed", ready: `Publish ${site?.name ?? ""}` }[phase];
  const cmdFor = (t: "preview" | "production") => (t === "preview" ? site?.preview : site?.publish);
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !p.running) setPublishOpen(false); }}>
      <div className="modal">
        <h2>{title}</h2>
        {phase === "editing" && (
          <>
            <p style={{ margin: 0, color: "var(--ink-2)" }}>Open runs one command from the site folder for each target and shows you the result. Both are saved in <code>open.json</code>.</p>
            <div className="presets">{PRESETS.map((x) => <button key={x.label} className={"btn sm" + (prod === x.production ? " primary" : "")} onClick={() => { setProd(x.production); setPrev(x.preview); }}>{x.label}</button>)}</div>
            <div className="row2"><label>Production</label><input className="text-input" autoFocus placeholder="e.g. vercel deploy --prod --yes" value={prod} onChange={(e) => setProd(e.target.value)} /></div>
            <div className="row2"><label>Preview</label><input className="text-input" placeholder="optional, e.g. vercel deploy --yes" value={prev} onChange={(e) => setPrev(e.target.value)} /></div>
            <div className="foot">
              <button className="btn ghost" onClick={() => (site?.publish || site?.preview ? setEditing(false) : setPublishOpen(false))}>Cancel</button>
              <button className="btn primary" disabled={!prod.trim() && !prev.trim()} onClick={() => void save()}>Save</button>
            </div>
          </>
        )}
        {phase === "ready" && (
          <>
            <div className="targets">
              {(["preview", "production"] as const).map((t) => (
                <button key={t} className={"target" + (target === t ? " on" : "") + (cmdFor(t) ? "" : " off")} disabled={!cmdFor(t)} onClick={() => setTarget(t)}>
                  <b>{t === "preview" ? "Preview" : "Production"}</b>
                  <span>{t === "preview" ? "A shareable test link. The live site doesn't change." : "Goes live for everyone."}</span>
                  <code>{cmdFor(t) ?? "no command set"}</code>
                </button>
              ))}
            </div>
            {git?.isGit && (
              <div className="opts">
                <label className={canCommit ? "" : "muted"}><input type="checkbox" disabled={!canCommit} checked={canCommit && commit} onChange={(e) => setCommit(e.target.checked)} /> {canCommit ? `Commit ${changed} changed file${changed === 1 ? "" : "s"} first` : "Nothing to commit"}</label>
                {canCommit && commit && <input className="text-input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Commit message" />}
                <label className={canPush && (commit || !canCommit) ? "" : "muted"} title={!canPush ? "No origin remote configured" : canCommit && !commit ? "Tick commit first: only committed changes can be pushed" : git.remote ?? ""}><input type="checkbox" disabled={!canPush || (canCommit && !commit)} checked={canPush && push && (commit || !canCommit)} onChange={(e) => setPush(e.target.checked)} /> {canPush ? `Push to origin (${git.remote?.replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, "$1")})${canCommit && !commit ? " · needs the commit" : ""}` : "Push to origin (no remote yet)"}</label>
              </div>
            )}
            <div className="foot">
              <button className="btn ghost" onClick={() => setEditing(true)} style={{ marginRight: "auto" }}>Change commands</button>
              <button className="btn" onClick={() => setPublishOpen(false)}>Cancel</button>
              <button className="btn primary" autoFocus disabled={!cmdFor(target)} onClick={go}>{target === "preview" ? "Publish preview" : "Publish to production"}</button>
            </div>
          </>
        )}
        {phase === "running" && (
          <>
            <div className="log">{p.log.join("\n")}</div>
            <div className="foot">
              <span className="spinner" style={{ marginRight: "auto", alignSelf: "center" }} />
              <button className="btn" disabled={p.cancelled && p.step !== "deploy"} onClick={() => void cancelPublish()}>{p.cancelled ? (p.step === "deploy" ? "Cancel again" : "Stopping after this step…") : "Cancel"}</button>
            </div>
          </>
        )}
        {(phase === "done" || phase === "failed" || phase === "cancelled") && (
          <>
            {p.log.length > 0 && <div className="log">{p.log.join("\n")}</div>}
            {p.url && <div className="url"><Check style={{ width: 14, height: 14, color: "var(--ok)", verticalAlign: -2 }} /> <a href={p.url} target="_blank" rel="noreferrer">{p.url}</a></div>}
            {p.error && <div className="err">{p.error}</div>}
            {phase === "cancelled" && <p style={{ margin: 0, color: "var(--ink-2)" }}>The publish command was stopped. Nothing was confirmed as live; check your hosting dashboard if it had already started uploading.</p>}
            <div className="foot">
              <button className="btn ghost" onClick={() => setEditing(true)} style={{ marginRight: "auto" }}>Change commands</button>
              <button className="btn" onClick={() => setPublishOpen(false)}>Close</button>
              {phase !== "done" && <button className="btn primary" onClick={go}>Try again</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function RulesDialog() {
  const r = useStore((s) => s.rules);
  const closeRules = useStore((s) => s.closeRules);
  const saveRules = useStore((s) => s.saveRules);
  const site = useStore((s) => s.sites.find((x) => x.id === s.currentSiteId) ?? null);
  const [text, setText] = useState("");
  useEffect(() => { if (r.open && !r.loading) setText(r.text); }, [r.open, r.loading, r.text]);
  if (!r.open) return null;
  const dirty = text !== r.text;
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !r.saving) closeRules(); }}>
      <div className="modal wide">
        <h2>Site rules · {site?.name}</h2>
        <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>This is the site's <code>CLAUDE.md</code>. Claude reads it before every change: voice, brand, what not to touch. Plain text, Markdown headings help.</p>
        {r.loading ? <div className="log">Loading…</div> : (
          <textarea className="rules" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void saveRules(text); } }} />
        )}
        {r.error && <div className="err">{r.error}</div>}
        <div className="foot">
          <button className="btn ghost" disabled={r.saving} onClick={closeRules}>Cancel</button>
          <button className="btn primary" disabled={r.saving || r.loading || !dirty} onClick={() => void saveRules(text)}>{r.saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

export function DiffDialog() {
  const d = useStore((s) => s.diff);
  const closeDiff = useStore((s) => s.closeDiff);
  const root = useStore((s) => s.sites.find((x) => x.id === s.currentSiteId)?.path ?? "");
  if (!d.open) return null;
  const lines = d.text.split("\n");
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeDiff(); }}>
      <div className="modal wide">
        <h2>What changed</h2>
        <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>{d.files.map((f) => f.replace(root + "/", "")).join(" · ")}</p>
        {d.loading ? <div className="log">Loading…</div> : d.error ? <div className="err">{d.error}</div> : (
          <div className="diffview">
            {lines.length <= 1 && !d.text.trim() ? <div className="muted">No differences against the last commit (already committed or undone).</div> : lines.map((l, i) => {
              const cls = l.startsWith("diff --git") ? "file" : l.startsWith("+++") || l.startsWith("---") || l.startsWith("index ") || l.startsWith("new file") ? "meta" : l.startsWith("@@") ? "hunk" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "";
              return <div key={i} className={cls}>{cls === "file" ? l.replace(/^diff --git a\/(.*) b\/.*$/, "$1") : l}</div>;
            })}
          </div>
        )}
        <div className="foot"><button className="btn" onClick={closeDiff}>Close</button></div>
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const save = useStore((s) => s.saveSettings);
  const planUsage = useStore((s) => s.planUsage);
  const defaults = useStore((s) => s.tools?.claude.defaults ?? null);
  const [form, setForm] = useState({ claudePath: "", model: "", permissionMode: "acceptEdits", effort: "", fastMode: false });
  const [customModel, setCustomModel] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({ claudePath: settings.claudePath ?? "", model: settings.model ?? "", permissionMode: settings.permissionMode ?? "acceptEdits", effort: settings.effort ?? "", fastMode: !!settings.fastMode });
    setCustomModel(!!settings.model && !MODELS.some((m) => m.value === baseModel(settings.model ?? "")));
  }, [open, settings]);
  if (!open) return null;
  const base = baseModel(form.model);
  const oneM = hasLongContext(form.model);
  const known = MODELS.some((m) => m.value === base);
  const custom = customModel || (form.model !== "" && !known);
  const pickModel = (v: string) => {
    if (v === "custom") { setCustomModel(true); if (known) setForm({ ...form, model: "" }); return; }
    setCustomModel(false);
    setForm({ ...form, model: v ? v + (oneM ? "[1m]" : "") : "" });
  };
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal">
        <h2>Settings</h2>
        <div className="row2"><label>On this Mac</label><Checklist compact /></div>
        <div className="row2"><label>Claude path</label><input className="text-input" placeholder="Leave empty to find claude on your PATH" value={form.claudePath} onChange={(e) => setForm({ ...form, claudePath: e.target.value })} /></div>
        <div className="row2"><label>Model</label>
          <div style={{ display: "grid", gap: 6 }}>
            <select className="text-input" value={custom ? "custom" : known ? base : ""} onChange={(e) => pickModel(e.target.value)}>
              <option value="">Your Claude Code default{defaults?.model ? ` · ${defaults.model}` : ""}</option>
              {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label} · {m.value} · {m.hint}</option>)}
              <option value="custom">Custom model name or alias…</option>
            </select>
            {custom && <input className="text-input" placeholder="e.g. claude-sonnet-5, opus[1m], opusplan" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value.trim() })} />}
            {known && !custom && <label className="opt-row"><input type="checkbox" checked={oneM} onChange={(e) => setForm({ ...form, model: base + (e.target.checked ? "[1m]" : "") })} /> 1M-token context window (<code>[1m]</code>; needs a plan that includes it)</label>}
          </div>
        </div>
        <div className="row2"><label>Effort</label>
          <select className="text-input" value={form.effort} onChange={(e) => setForm({ ...form, effort: e.target.value })}>
            <option value="">Your Claude Code default{defaults?.effort ? ` · ${defaults.effort}` : ""}</option>
            {EFFORTS.map((l) => <option key={l} value={l}>{l} · {EFFORT_HINTS[l]}</option>)}
          </select>
        </div>
        <div className="row2"><label>Fast mode</label>
          <div style={{ display: "grid", gap: 4 }}>
            <label className="opt-row"><input type="checkbox" checked={form.fastMode} onChange={(e) => setForm({ ...form, fastMode: e.target.checked })} /> Faster output for Opus sessions</label>
            <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 12 }}>Same model, up to 2.5× faster streaming, about twice the cost per token (on a subscription it uses up the plan's window faster). Opus 5 and 4.8 only; other models ignore it.</p>
          </div>
        </div>
        <div className="row2"><label>Permissions</label>
          <select className="text-input" value={form.permissionMode} onChange={(e) => setForm({ ...form, permissionMode: e.target.value })}>
            <option value="acceptEdits">Edit files freely, ask before commands (recommended)</option>
            <option value="default">Ask before edits and commands</option>
            <option value="auto">Auto: a classifier reviews actions</option>
            <option value="bypassPermissions">Never ask (dangerous)</option>
          </select>
        </div>
        <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 12 }}>Defaults for sessions started after saving. The chips in the bar under the conversation show the exact model in use and change model, effort and fast mode for that session alone. Claude's reasoning shows in a collapsed "Thinking" row on every reply.</p>
        <div className="row2" style={{ alignItems: "start" }}><label style={{ paddingTop: 2 }}>Plan usage</label><PlanRows windows={planUsage?.windows ?? []} at={planUsage?.at ?? null} /></div>
        <div className="foot">
          <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" onClick={() => { void save(form).then(() => setOpen(false)); }}>Save</button>
        </div>
      </div>
    </div>
  );
}
