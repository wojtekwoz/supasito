import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "./store";
import { Branch, Check, Chevron, Folder, Plus, Shield, Sparkle } from "../ui/Icons";
import { Checklist, nodeTooOld } from "./Checklist";
import { PlanRows } from "./Usage";
import { EFFORT_HINTS, baseModel, effortsFor, hasLongContext, isCodexModel, isEffort } from "../models";
import { UI_GROUPS } from "./ui";
import { cx } from "../util";
import { openExternal } from "../backend";
import { looksLikeAddress, webLinkOf } from "../repo";
import type { CloneError } from "../types";

/** Words for each way adding a site from a link can fail (clone.rs `classify`). */
function cloneErrorText(e: CloneError): { title: string; body: string } {
  switch (e.kind) {
    case "private": return { title: "This repository is private, or the link is wrong.", body: e.signIn ? "If it's yours, sign in to GitHub once and Supasito can download it." : "If it's yours, download it once with GitHub Desktop, then use Open a folder." };
    case "missing": return { title: "GitHub can't find this repository.", body: "Check the link for a typo, or ask the owner to give your GitHub account access." };
    case "offline": return { title: "You seem to be offline.", body: "Connect to the internet, then try again. Nothing was saved." };
    case "ssh": return { title: "This Mac has no SSH key for GitHub.", body: "The same repository downloads with its regular web link." };
    case "branch": return { title: "That branch isn't in the repository.", body: "The link may point at a branch that was deleted. The repository's main page still works." };
    case "folder": return { title: `The folder ${e.detail ?? ""} isn't in this repository.`, body: "Nothing was saved. The repository's main page still works." };
    case "disk": return { title: "This Mac is out of space.", body: "Free some space, then try again. Nothing was saved." };
    case "nogit": return { title: "Downloading a site needs git.", body: "The line below says how to get it." };
    case "busy": return { title: "Another site is still being added.", body: "Wait for it to finish, then try again." };
    default: return { title: "The download didn't work.", body: e.detail ?? "Try again in a moment." };
  }
}

const aboutSize = (kb?: number | null) => (kb == null ? null : kb < 1024 ? "under 1 MB" : `about ${Math.round(kb / 1024)} MB`);
const slugify = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** New site and Add a site from GitHub share one field (PLAN §8e): a name starts from the starter, a pasted link clones. */
export function AddSiteDialog() {
  const a = useStore((s) => s.addSite);
  const tools = useStore((s) => s.tools);
  const sites = useStore((s) => s.sites);
  const home = useStore((s) => s.settings.defaultSitesFolder?.replace(/\/Sites$/, "") ?? null);
  const openAddSite = useStore((s) => s.openAddSite);
  const setValue = useStore((s) => s.setAddSiteValue);
  const chooseFolder = useStore((s) => s.chooseSitesFolder);
  const createSite = useStore((s) => s.createSite);
  const cloneSite = useStore((s) => s.cloneSite);
  const cancelClone = useStore((s) => s.cancelClone);
  const openExisting = useStore((s) => s.openExistingSite);
  const startSignIn = useStore((s) => s.startGithubSignIn);
  const continueSignIn = useStore((s) => s.continueGithubSignIn);
  const cancelSignIn = useStore((s) => s.cancelGithubSignIn);
  const [details, setDetails] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!a.open) return;
    setDetails(false);
    requestAnimationFrame(() => { const i = inputRef.current; if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
  }, [a.open]);
  if (!a.open) return null;

  const tilde = (p: string | null | undefined) => (p && home && p.startsWith(home + "/") ? "~" + p.slice(home.length) : p ?? "");
  const repo = a.repo;
  const name = a.value.trim();
  const info = a.lookup?.info ?? null;
  const existing = a.lookup?.existingSiteId ? sites.find((s) => s.id === a.lookup!.existingSiteId) ?? null : null;
  const mode = a.running ? "running" : a.signIn ? "signin" : repo
    ? a.error ? "error" : a.looking ? "looking" : existing || a.lookup?.existingPath ? "exists" : "card"
    : !name ? "empty" : looksLikeAddress(name) ? "address" : "name";
  const noNode = !!tools && (!tools.node.ok || nodeTooOld(tools));
  const noGit = !!tools && !tools.git.ok;
  const [branch, ...folderSegs] = repo?.treePath?.split("/") ?? [];
  const subFolder = folderSegs.join("/");
  const cloneDest = a.lookup?.dest ?? (repo && a.folder ? `${a.folder}/${repo.repo}` : a.folder);
  // For a folder inside a repository the site is that folder, so that is the path to show.
  const target = mode === "name" ? `${a.folder}/${slugify(name) || "new-site"}` : subFolder ? `${cloneDest}/${subFolder}` : cloneDest;
  const close = () => { if (a.running) return; if (a.signIn) cancelSignIn(); openAddSite(false); };

  const badge = repo?.ssh ? <span className="add-badge">SSH link</span> : info?.private === false ? <span className="add-badge">Public</span> : null;
  const repoLine = repo && <div className="add-line"><Branch className="glyph" /><span className="grow add-name">{repo.owner} / <b>{repo.repo}</b></span>{badge}</div>;
  const folderLine = a.firstFolder ? (
    <div className="add-where">
      <div className="add-line"><Folder className="glyph" /><span className="grow">{a.folder ? <>Your sites will live in <b className="mono">{tilde(a.folder)}</b></> : "Choose where your sites will live"}</span><button className="link-btn" onClick={() => void chooseFolder()}>{a.folder ? "Change…" : "Choose…"}</button></div>
      <p>Supasito asks this once. New sites go there too.</p>
    </div>
  ) : (
    <div className="add-line muted"><Folder className="glyph" /><span className="grow mono" title={target}>{tilde(target)}</span><button className="link-btn" onClick={() => void chooseFolder()}>Change</button></div>
  );
  const detailsBlock = a.log.length > 0 && (
    <>
      <button className="details-btn" aria-expanded={details} onClick={() => setDetails(!details)}><Chevron className="glyph" /> Details</button>
      {details && <div className="log" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>{a.log.slice(-200).join("\n")}</div>}
    </>
  );

  let body: ReactNode = null;
  let primary: { label: string; run?: () => void; disabled?: boolean } = { label: "Add site", disabled: true };
  let secondary: { label: string; run: () => void } | null = null;
  let cancel: { label: string; run: () => void; disabled?: boolean } = { label: "Cancel", run: close };
  switch (mode) {
    case "empty":
      body = <p className="add-help">A name starts a fresh site from the starter. A link brings in a site that already lives on GitHub.</p>;
      break;
    case "address":
      body = <div className="add-line warn">That link isn't a repository. Paste the address of the repository's main page, like github.com/owner/name.</div>;
      break;
    case "name":
      body = <>
        <div className="add-line"><Sparkle className="glyph" /><span>Starts a fresh site from Supasito's starter. Describe it in your first message.</span></div>
        {noNode && <div className="add-line warn">New sites need a recent Node.js. The checklist on the welcome screen says how to get it.</div>}
        {folderLine}
        {a.message && <div className="err">{a.message}</div>}
      </>;
      primary = { label: "Create site", run: () => void createSite(name), disabled: noNode || !a.folder };
      break;
    case "looking":
      body = <div className="add-line muted"><span className="spinner" /><span>Looking up <b>{repo!.owner}/{repo!.repo}</b>…</span></div>;
      break;
    case "card":
      body = <>
        <div className="add-repo">
          {repoLine}
          {info?.description && <p className="add-desc">{info.description}</p>}
          <div className="add-meta">{[info?.language, aboutSize(info?.sizeKb)].filter(Boolean).join(" · ") || `${repo!.host}/${repo!.owner}/${repo!.repo}`}</div>
          {branch && <div className="add-sub"><Folder className="glyph" /><span>{subFolder ? <>Opens the <b>{subFolder}</b> folder, on branch <b>{branch}</b></> : <>On branch <b>{branch}</b></>}</span></div>}
          {repo!.fromCommand && <div className="add-sub"><Check className="glyph" /><span>Read from the command you copied</span></div>}
        </div>
        <div className="add-line muted"><Shield className="glyph" /><span>Supasito will run this project's code on your Mac.</span></div>
        {noGit ? <Checklist compact /> : folderLine}
        {a.note && <div className="add-note">{a.note}</div>}
      </>;
      primary = { label: "Add site", run: () => void cloneSite(), disabled: noGit || !a.folder };
      break;
    case "exists":
      {
        const conv = a.lookup?.existingConversations ?? 0;
        body = <div className="add-found"><Check className="glyph" /><div><b>You already have this one.</b><span>{existing ? <>{existing.name}, in <span className="mono">{tilde(existing.path)}</span></> : <>In <span className="mono">{tilde(a.lookup?.existingPath)}</span></>}{conv ? `, with ${conv} earlier conversation${conv === 1 ? "" : "s"}` : ""}. Opening it keeps its history.</span></div></div>;
      }
      primary = { label: "Open it", run: () => void openExisting() };
      secondary = { label: "Download another copy", run: () => void cloneSite(undefined, true) };
      break;
    case "error": {
      const e = a.error!;
      const text = cloneErrorText(e);
      body = <>
        {repoLine}
        <div className="add-err"><b>{text.title}</b><span>{text.body}</span></div>
        {e.kind === "nogit" && <Checklist compact />}
        {detailsBlock}
      </>;
      const retry = { label: "Try again", run: () => void cloneSite() };
      primary = e.kind === "private" && e.signIn ? { label: "Sign in to GitHub", run: () => void startSignIn() }
        : e.kind === "ssh" || e.kind === "branch" || e.kind === "folder" ? { label: e.kind === "ssh" ? "Use the web link instead" : "Use the main page", run: () => void cloneSite(webLinkOf(repo!)) }
        : retry;
      if (e.kind === "missing" || e.kind === "private") secondary = { label: "Edit link", run: () => { setValue(a.value); inputRef.current?.focus(); } };
      break;
    }
    case "signin": {
      const s = a.signIn!;
      body = <>
        {repoLine}
        <div className="add-signin">
          <b>Sign in to GitHub</b>
          {s.stage === "starting" && <div className="add-line muted"><span className="spinner" /><span>Asking GitHub for a code…</span></div>}
          {s.code && <>
            <p>{s.stage === "waiting" ? "Enter this code on the GitHub page that opened, then approve Supasito." : "GitHub will ask for this code. Copy it, then approve Supasito on the page that opens."}</p>
            <div className="add-code">{s.code.userCode}</div>
            {s.stage === "waiting" && <div className="add-line muted"><span className="spinner" /><span>Waiting for you to approve on GitHub…</span></div>}
          </>}
          {s.error && <div className="err">{s.error}</div>}
          <p className="small">Supasito keeps no password. Your Mac's Keychain remembers the sign-in, so publishing to GitHub works too.</p>
        </div>
      </>;
      cancel = { label: s.stage === "waiting" ? "Cancel" : "Back", run: cancelSignIn };
      primary = s.stage === "waiting"
        ? { label: "Open GitHub again", run: () => void openExternal(s.code!.verificationUri) }
        : { label: "Copy code and open GitHub", run: () => void continueSignIn(), disabled: !s.code };
      break;
    }
    case "running": {
      const p = a.progress;
      const downloading = a.running === "clone" && p?.phase === "download";
      const pct = Math.floor((p?.percent ?? 0) * 100);
      const label = a.running === "create" ? (a.log.some((l) => l.startsWith("$")) ? "Installing packages…" : "Copying the starter…")
        : !p || p.phase === "check" ? (repo?.host === "github.com" ? "Connecting to GitHub…" : "Connecting…")
        : p.phase === "download" ? `Downloading… ${pct}%` : "Installing packages…";
      body = <>
        {a.running === "clone" && repoLine}
        <div className="add-prog">
          <div className="add-prog-top"><b>{label}</b>{downloading && p?.amount && <span>{p.amount}</span>}</div>
          <div className={cx("add-bar", !downloading && "busy")} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloading ? pct : undefined}>
            <i style={downloading ? { width: `${Math.max(2, pct)}%` } : undefined} />
          </div>
          {detailsBlock}
        </div>
      </>;
      primary = { label: a.running === "create" ? "Creating…" : "Adding…", disabled: true };
      cancel = a.running === "clone" ? { label: "Cancel", run: () => void cancelClone() } : { label: "Cancel", run: close, disabled: true };
      break;
    }
  }

  const title = mode === "name" ? "New site" : repo ? (repo.host === "github.com" ? "Add a site from GitHub" : "Add a site from a link") : "Add a site";
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal add-site" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="add-field">
          <span className={cx("lead", repo && "link")}>{repo ? <Branch /> : mode === "name" ? <Sparkle /> : <Plus />}</span>
          <input ref={inputRef} id="add-site-input" className="text-input" autoComplete="off" spellCheck={false} placeholder="Name a new site, or paste a GitHub link"
            aria-label="Site name or GitHub link" value={a.value} disabled={!!a.running || !!a.signIn}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && primary.run && !primary.disabled) { e.preventDefault(); primary.run(); } }} />
        </div>
        <div className="add-body">{body}</div>
        <div className="foot">
          <button className="btn ghost" disabled={cancel.disabled} onClick={cancel.run}>{cancel.label}</button>
          {secondary && <button className="btn ghost" onClick={secondary.run}>{secondary.label}</button>}
          <button className="btn primary" disabled={primary.disabled || !primary.run} onClick={primary.run}>{primary.label}</button>
        </div>
      </div>
    </div>
  );
}

/** The trash button in the rail asks first, and says what "remove" means here: the site leaves the list, nothing on disk
 *  changes. A running session or dev server for that site is stopped, so the dialog says so when either is the case. */
export function RemoveSiteDialog() {
  const site = useStore((s) => (s.removing ? s.sites.find((x) => x.id === s.removing) ?? null : null));
  const askRemoveSite = useStore((s) => s.askRemoveSite);
  const removeSite = useStore((s) => s.removeSite);
  const sessionRunning = useStore((s) => !!site && (s.sessions[site.id] ?? []).some((x) => s.running[x.id]));
  const devUp = useStore((s) => !!site && (s.dev[site.id]?.status === "ready" || s.dev[site.id]?.status === "starting"));
  if (!site) return null;
  const stops = [sessionRunning && "its running session", devUp && "its dev server"].filter(Boolean) as string[];
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) askRemoveSite(null); }}>
      <div className="modal">
        <h2>Remove {site.name} from the sidebar?</h2>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>This only takes the site off the list. Nothing is deleted: the folder stays where it is, with your code, its git history and your Claude Code sessions. Open it again any time with the folder button.</p>
        <div className="url" title={site.path}>{site.path}</div>
        {stops.length > 0 && <p style={{ margin: 0, color: "var(--ink-2)" }}>Supasito will stop {stops.join(" and ")} first.</p>}
        <div className="foot">
          <button className="btn ghost" onClick={() => askRemoveSite(null)}>Cancel</button>
          <button className="btn primary" autoFocus onClick={() => void removeSite(site.id)}>Remove from the sidebar</button>
        </div>
      </div>
    </div>
  );
}

const PRESETS: { label: string; production: string; preview: string }[] = [
  { label: "Vercel", production: "vercel deploy --prod --yes", preview: "vercel deploy --yes" },
  { label: "Cloudflare", production: "wrangler deploy", preview: "wrangler versions upload" },
  { label: "Netlify", production: "netlify deploy --prod", preview: "netlify deploy" },
  // the branch is the site's own default (`presetsFor`); a preview branch of Supasito's own is safe to force-push
  { label: "Git push", production: "git push origin HEAD:main", preview: "git push --force origin HEAD:supasito-preview" },
];

const presetsFor = (site: { defaultBranch?: string | null } | null) =>
  PRESETS.map((x) => (x.label === "Git push" ? { ...x, production: `git push origin HEAD:${site?.defaultBranch || "main"}` } : x));
const isPush = (cmd: string | null | undefined) => /^\s*git\s+push\b/.test(cmd ?? "");

export function PublishDialog() {
  const p = useStore((s) => s.publish);
  const setPublishOpen = useStore((s) => s.setPublishOpen);
  const site = useStore((s) => s.sites.find((x) => x.id === s.currentSiteId) ?? null);
  const git = useStore((s) => (s.currentSiteId ? s.git[s.currentSiteId] : null));
  const session = useStore((s) => (s.currentSessionId ? s.transcripts[s.currentSessionId] ?? null : null));
  const setPublishCommand = useStore((s) => s.setPublishCommand);
  const runPublish = useStore((s) => s.runPublish);
  const cancelPublish = useStore((s) => s.cancelPublish);
  const mergeFromRemote = useStore((s) => s.mergeFromRemote);
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
  const phase = p.running ? "running" : editing ? "editing" : p.cancelled ? "cancelled" : p.url || p.done ? "done" : p.error ? "failed" : "ready";
  const pushed = isPush(p.target === "preview" ? site?.preview : site?.publish);
  const title = { running: p.step === "commit" ? "Committing…" : p.step === "push" ? "Pushing to origin…" : p.target === "preview" ? "Publishing a preview…" : "Publishing to production…", editing: "How should this site be published?", cancelled: "Publish cancelled", done: pushed ? "Pushed to GitHub" : p.target === "preview" ? "Preview is up" : "Published", failed: "Publish failed", ready: `Publish ${site?.name ?? ""}` }[phase];
  const cmdFor = (t: "preview" | "production") => (t === "preview" ? site?.preview : site?.publish);
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !p.running) setPublishOpen(false); }}>
      <div className="modal">
        <h2>{title}</h2>
        {phase === "editing" && (
          <>
            <p style={{ margin: 0, color: "var(--ink-2)" }}>Supasito runs one command from the site folder for each target and shows you the result. Both are saved in <code>supasito.json</code>.</p>
            <div className="presets">{presetsFor(site).map((x) => <button key={x.label} className={"btn sm" + (prod === x.production ? " primary" : "")} onClick={() => { setProd(x.production); setPrev(x.preview); }}>{x.label}</button>)}</div>
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
                {isPush(cmdFor(target)) ? <label className="muted">Publishing is a push to GitHub{git.remote ? ` (${git.remote.replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, "$1")})` : ""}</label> : <label className={canPush && (commit || !canCommit) ? "" : "muted"} title={!canPush ? "No origin remote configured" : canCommit && !commit ? "Tick commit first: only committed changes can be pushed" : git.remote ?? ""}><input type="checkbox" disabled={!canPush || (canCommit && !commit)} checked={canPush && push && (commit || !canCommit)} onChange={(e) => setPush(e.target.checked)} /> {canPush ? `Push to origin (${git.remote?.replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, "$1")})${canCommit && !commit ? " · needs the commit" : ""}` : "Push to origin (no remote yet)"}</label>}
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
            {phase === "done" && !p.url && <p style={{ margin: 0, color: "var(--ink-2)" }}>{pushed ? (p.target === "preview" ? "Pushed to the supasito-preview branch. If your host builds from GitHub, it makes a preview link from it in a minute or two; the link shows up on GitHub and in your host's dashboard." : "If your host builds from GitHub, the live site updates in a minute or two.") : "The command finished without printing a link."}</p>}
            {p.error && <div className="err">{p.error}</div>}
            {phase === "cancelled" && <p style={{ margin: 0, color: "var(--ink-2)" }}>The publish command was stopped. Nothing was confirmed as live; check your hosting dashboard if it had already started uploading.</p>}
            <div className="foot">
              <button className="btn ghost" onClick={() => setEditing(true)} style={{ marginRight: "auto" }}>Change commands</button>
              <button className="btn" onClick={() => setPublishOpen(false)}>Close</button>
              {phase !== "done" && (p.behind && site
                ? <button className="btn primary" onClick={() => void mergeFromRemote(site.id)}>Ask Claude to bring them in</button>
                : <button className="btn primary" onClick={go}>Try again</button>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The private settings a site expects from env files git never stores (PLAN §8e.11). Values go straight from these
 *  fields to the file through the backend, never into a conversation. */
export function EnvDialog() {
  const e = useStore((s) => s.env);
  const openEnv = useStore((s) => s.openEnv);
  const saveEnv = useStore((s) => s.saveEnv);
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => { setValues(Object.fromEntries((e.needs?.keys ?? []).map((k) => [k.name, k.value ?? ""]))); }, [e.needs]);
  if (!e.open) return null;
  const close = () => { if (!e.saving) void openEnv(null); };
  const filled = (e.needs?.keys ?? []).filter((k) => (values[k.name] ?? "").trim()).length;
  const save = () => { if (filled && !e.saving) void saveEnv(Object.entries(values)); };
  return (
    <div className="backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div className="modal env-modal" role="dialog" aria-modal="true" aria-label="Private settings">
        <h2>Private settings for this site</h2>
        {!e.needs && !e.error && <div className="add-line muted"><span className="spinner" /><span>Reading the example file…</span></div>}
        {e.needs && <>
          <p className="env-lead">The site's <code>{e.needs.example}</code> lists these. They're saved on this Mac in <code>{e.needs.file}</code>, which isn't uploaded to GitHub, and they don't go into the conversation. Leave any you don't have empty.</p>
          <div className="env-keys">
            {e.needs.keys.map((k, i) => (
              <label key={k.name} className="env-key" htmlFor={`env-${k.name}`}>
                <span className="env-name">{k.name}</span>
                {k.hint && <span className="env-hint">{k.hint}</span>}
                <input id={`env-${k.name}`} className="text-input" autoFocus={i === 0} autoComplete="off" spellCheck={false} value={values[k.name] ?? ""}
                  onChange={(ev) => setValues({ ...values, [k.name]: ev.target.value })} onKeyDown={(ev) => { if (ev.key === "Enter") save(); }} />
              </label>
            ))}
          </div>
        </>}
        {e.error && <div className="err">{e.error}</div>}
        <div className="foot">
          <button className="btn ghost" disabled={e.saving} onClick={close}>Cancel</button>
          <button className="btn primary" disabled={!e.needs || e.saving || filled === 0} onClick={save}>{e.saving ? "Saving…" : "Save"}</button>
        </div>
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

const FEEDBACK_EMAIL = "yo@wozu.co";
// Subject only: the body stays empty so people write in their own words, and openExternal hands the
// mailto: to the default mail app (a plain anchor opens nothing in the Tauri webview).
const FEEDBACK_MAILTO = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("Supasito feedback")}`;

// A stable empty list: a selector that returned a fresh `[]` each render would keep zustand re-rendering.
const NO_HIDDEN: string[] = [];

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const save = useStore((s) => s.saveSettings);
  const planUsage = useStore((s) => s.planUsage);
  const defaults = useStore((s) => s.tools?.claude.defaults ?? null);
  const hidden = useStore((s) => s.settings.hidden) ?? NO_HIDDEN;
  const setHidden = useStore((s) => s.setHidden);
  const [tab, setTab] = useState<"claude" | "interface" | "updates" | "feedback">("claude");
  const version = useStore((s) => s.version);
  const update = useStore((s) => s.update);
  const updateBusy = useStore((s) => s.updateBusy);
  const updateProgress = useStore((s) => s.updateProgress);
  const checkUpdate = useStore((s) => s.checkUpdate);
  const installUpdate = useStore((s) => s.installUpdate);
  const [form, setForm] = useState({ claudePath: "", model: "", permissionMode: "acceptEdits", effort: "", fastMode: false });
  const [customModel, setCustomModel] = useState(false);
  const models = useStore((s) => s.models);
  useEffect(() => {
    if (!open) return;
    setForm({ claudePath: settings.claudePath ?? "", model: settings.model ?? "", permissionMode: settings.permissionMode ?? "acceptEdits", effort: settings.effort ?? "", fastMode: !!settings.fastMode });
    setCustomModel(!!settings.model && !models.some((m) => m.value === baseModel(settings.model ?? "")));
  }, [open, settings, models]);
  if (!open) return null;
  const base = baseModel(form.model);
  const oneM = hasLongContext(form.model);
  const known = models.some((m) => m.value === base);
  const efforts = effortsFor(form.model || null);
  const custom = customModel || (form.model !== "" && !known);
  const pickModel = (v: string) => {
    if (v === "custom") { setCustomModel(true); if (known) setForm({ ...form, model: "" }); return; }
    setCustomModel(false);
    // the 1M suffix is Claude Code's; a GPT id with it appended is a model nobody has
    setForm({ ...form, model: v ? v + (oneM && !isCodexModel(v) ? "[1m]" : "") : "" });
  };
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal">
        <h2>Settings</h2>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "claude"} className={cx(tab === "claude" && "on")} onClick={() => setTab("claude")}>Claude</button>
          <button role="tab" aria-selected={tab === "interface"} className={cx(tab === "interface" && "on")} onClick={() => setTab("interface")}>Interface</button>
          <button role="tab" aria-selected={tab === "updates"} className={cx(tab === "updates" && "on")} onClick={() => setTab("updates")}>Updates{update ? " ·" : ""}</button>
          <button role="tab" aria-selected={tab === "feedback"} className={cx(tab === "feedback" && "on")} onClick={() => setTab("feedback")}>Got feedback?</button>
        </div>
        {tab === "feedback" && (
          <>
            <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>Something broken, missing, or in the way? Tell me.</p>
            <div className="foot" style={{ justifyContent: "flex-start" }}>
              <button className="btn primary" onClick={() => void openExternal(FEEDBACK_MAILTO)}>Send feedback</button>
            </div>
          </>
        )}
        {tab === "updates" && (
          <>
            <div className="row2"><label>This copy</label><div style={{ fontSize: 13 }}>Supasito {version || "—"}</div></div>
            <div className="row2"><label>Newer version</label>
              <div style={{ display: "grid", gap: 8, justifyItems: "start" }}>
                {update ? (
                  <>
                    <div style={{ fontSize: 13 }}>Supasito {update.version} is out.</div>
                    {update.notes && <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5, whiteSpace: "pre-wrap" }}>{update.notes}</p>}
                    <button className="btn primary" disabled={!!updateBusy} onClick={() => void installUpdate()}>
                      {updateBusy === "installing" ? (updateProgress === null ? "Downloading…" : `Downloading ${Math.round(updateProgress * 100)}%`) : `Update to ${update.version} and restart`}
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: "var(--ink-2)" }}>Nothing newer found.</div>
                    <button className="btn" disabled={!!updateBusy} onClick={() => void checkUpdate(true)}>{updateBusy === "checking" ? "Checking…" : "Check now"}</button>
                  </>
                )}
              </div>
            </div>
            <div className="row2"><label>Automatically</label>
              <div style={{ display: "grid", gap: 4 }}>
                <label className="opt-row"><input type="checkbox" checked={settings.updatesEnabled !== false} onChange={(e) => void save({ updatesEnabled: e.target.checked })} /> Check for a new version once a day (the same request also refreshes the Claude model list)</label>
                <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 12 }}>
                  That request is the only thing Supasito sends anywhere on its own. It asks supasito.com, and GitHub if that is unreachable, whether a version newer than this one exists; it carries the version, macOS and the chip this app was built for, and nothing else — no account, no identifier, no record of what you build. Your requests to Claude go from your own Claude Code, as they always did.
                </p>
              </div>
            </div>
            <div className="foot"><button className="btn primary" onClick={() => setOpen(false)}>Done</button></div>
          </>
        )}
        {tab === "interface" && (
          <>
            <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>Untick what you don't use. Changes apply right away and stay until you tick them back; keyboard shortcuts keep working.</p>
            {UI_GROUPS.map((g) => (
              <div className="row2" style={{ alignItems: "start" }} key={g.label}>
                <label style={{ paddingTop: 2 }}>{g.label}</label>
                <div style={{ display: "grid", gap: 6 }}>
                  {g.items.map((it) => (
                    <label className="opt-row" key={it.key}>
                      <input type="checkbox" checked={!hidden.includes(it.key)} onChange={(e) => void setHidden(e.target.checked ? hidden.filter((k) => k !== it.key) : [...hidden, it.key])} /> {it.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="foot">
              {hidden.length > 0 && <button className="btn ghost" style={{ marginRight: "auto" }} onClick={() => { if (confirm(`Tick all ${hidden.length === 1 ? "one box" : hidden.length + " boxes"} you have unticked and show everything?`)) void setHidden([]); }}>Show everything</button>}
              <button className="btn primary" onClick={() => setOpen(false)}>Done</button>
            </div>
          </>
        )}
        {tab === "claude" && <>
        <div className="row2"><label>On this Mac</label><Checklist compact /></div>
        <div className="row2"><label>Claude path</label><input className="text-input" placeholder="Leave empty to find claude on your PATH" value={form.claudePath} onChange={(e) => setForm({ ...form, claudePath: e.target.value })} /></div>
        <div className="row2"><label>Model</label>
          <div style={{ display: "grid", gap: 6 }}>
            <select className="text-input" value={custom ? "custom" : known ? base : ""} onChange={(e) => pickModel(e.target.value)}>
              <option value="">Your Claude Code default{defaults?.model ? ` · ${defaults.model}` : ""}</option>
              {models.map((m) => <option key={m.value} value={m.value}>{m.label} · {m.value} · {m.hint}</option>)}
              <option value="custom">Custom model name or alias…</option>
            </select>
            {custom && <input className="text-input" placeholder="e.g. claude-sonnet-5, opus[1m], opusplan" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value.trim() })} />}
            {known && !custom && !isCodexModel(base) && <label className="opt-row"><input type="checkbox" checked={oneM} onChange={(e) => setForm({ ...form, model: base + (e.target.checked ? "[1m]" : "") })} /> 1M-token context window (<code>[1m]</code>; needs a plan that includes it)</label>}
          </div>
        </div>
        <div className="row2"><label>Effort</label>
          <select className="text-input" value={form.effort} onChange={(e) => setForm({ ...form, effort: e.target.value })}>
            <option value="">Your Claude Code default{defaults?.effort ? ` · ${defaults.effort}` : ""}</option>
            {efforts.map((l) => <option key={l} value={l}>{l}{isEffort(l) ? ` · ${EFFORT_HINTS[l]}` : ""}</option>)}
            {form.effort && !efforts.includes(form.effort) && <option value={form.effort}>{form.effort} · not offered by this model</option>}
          </select>
        </div>
        <div className="row2"><label>Fast mode</label>
          <div style={{ display: "grid", gap: 4 }}>
            <label className="opt-row"><input type="checkbox" checked={form.fastMode} onChange={(e) => setForm({ ...form, fastMode: e.target.checked })} /> Faster output where the model offers it</label>
            <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 12 }}>Same model, faster streaming, more of the plan's window per token: Claude's Opus 5 and 4.8 (up to 2.5×, about twice the cost) and the GPT models that list a fast tier (Codex calls it priority). Other models ignore it.</p>
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
        </>}
      </div>
    </div>
  );
}
