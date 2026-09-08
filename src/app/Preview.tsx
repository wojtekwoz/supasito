import { useEffect, useRef, useState } from "react";
import { useDev, useDevLogOfCurrentSite, useSite, useStore, type Device } from "./store";
import { cx } from "../util";
import { Camera, Collapse, Crosshair, Desktop, Expand, External, Phone, Reload, Tablet, Terminal } from "../ui/Icons";
import { isTauri } from "../backend";
import type { DevProblem } from "../types";
import { useShown, type UiKey } from "./ui";

const widths: Record<Device, string> = { desktop: "100%", tablet: "834px", phone: "390px" };

export function Preview() {
  const site = useSite();
  const dev = useDev();
  const device = useStore((s) => s.device);
  const setDevice = useStore((s) => s.setDevice);
  const full = useStore((s) => s.previewFull);
  const setPreviewFull = useStore((s) => s.setPreviewFull);
  const picking = useStore((s) => s.picking);
  const setPicking = useStore((s) => s.setPicking);
  const setSelection = useStore((s) => s.setSelection);
  const previewPath = useStore((s) => s.previewPath);
  const setPreviewInfo = useStore((s) => s.setPreviewInfo);
  const setPreviewPath = useStore((s) => s.setPreviewPath);
  const nonce = useStore((s) => s.previewNonce);
  const reloadPreview = useStore((s) => s.reloadPreview);
  const openInBrowser = useStore((s) => s.openInBrowser);
  const git = useStore((s) => (s.currentSiteId ? s.git[s.currentSiteId] : null));
  const openPublish = useStore((s) => s.openPublish);
  const devLogOpen = useStore((s) => s.devLogOpen);
  const toggleDevLog = useStore((s) => s.toggleDevLog);
  const devLog = useDevLogOfCurrentSite();
  const startDev = useStore((s) => s.startDev);
  const restartDev = useStore((s) => s.restartDev);
  const freePortAndRestart = useStore((s) => s.freePortAndRestart);
  const setupPreview = useStore((s) => s.setupPreview);
  const siteBusy = useStore((s) => (s.currentSiteId ? (s.sessions[s.currentSiteId] ?? []).some((x) => s.transcripts[x.id]?.busy) : false));
  const sites = useStore((s) => s.sites);
  const siteName = (id: string | null | undefined) => sites.find((x) => x.id === id)?.name;
  const installDeps = useStore((s) => s.installDeps);
  const noNode = useStore((s) => !!s.tools && !s.tools.node.ok);
  const newSite = useStore((s) => s.newSite);
  const gitInit = useStore((s) => s.gitInit);
  const refreshGit = useStore((s) => s.refreshGit);
  const previewEvent = useStore((s) => s.previewEvent);
  const navigateRequest = useStore((s) => s.navigateRequest);
  const setPreviewRect = useStore((s) => s.setPreviewRect);
  const capturePreview = useStore((s) => s.capturePreview);
  // Toolbar buttons the user switched off in Settings → Interface.
  const shown: Record<Extract<UiKey, "fullWidth" | "devices" | "previewPick" | "reload" | "openBrowser" | "screenshot" | "devLog" | "devStatus">, boolean> = {
    fullWidth: useShown("fullWidth"), devices: useShown("devices"), previewPick: useShown("previewPick"), reload: useShown("reload"),
    openBrowser: useShown("openBrowser"), screenshot: useShown("screenshot"), devLog: useShown("devLog"), devStatus: useShown("devStatus"),
  };

  const frame = useRef<HTMLIFrameElement>(null);
  const [pathDraft, setPathDraft] = useState(previewPath);
  useEffect(() => setPathDraft(previewPath), [previewPath]);

  const post = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ source: "open-host", ...msg }, "*");

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.source !== "open-picker") return;
      (window as any).__openPickerSeen = true;
      if (d.type === "selected") setSelection(d.selection);
      else if (d.type === "pick") setPicking(!!d.active);
      else if (d.type === "ready") { setPreviewInfo(String(d.page ?? "/"), String(d.title ?? "")); previewEvent("ready", `${d.page ?? "/"} "${d.title ?? ""}"`); }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [setSelection, setPicking, setPreviewInfo, previewEvent]);

  useEffect(() => { post({ type: "pick", active: picking }); }, [picking]);

  // Keep the iframe's position on record so a screenshot can be cropped to it.
  useEffect(() => {
    const update = () => {
      const el = frame.current;
      if (!el) { setPreviewRect(null); return; }
      const r = el.getBoundingClientRect();
      setPreviewRect({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    update();
    const ro = frame.current ? new ResizeObserver(update) : null;
    if (frame.current && ro) ro.observe(frame.current);
    window.addEventListener("resize", update);
    return () => { ro?.disconnect(); window.removeEventListener("resize", update); };
  }, [dev?.status, device, nonce, setPreviewRect]);

  // Follow the page Claude is editing.
  useEffect(() => {
    if (!navigateRequest) return;
    setPreviewPath(navigateRequest.path);
    if (dev?.status === "ready" && dev.url !== "mock:") post({ type: "navigate", path: navigateRequest.path });
  }, [navigateRequest?.seq]);

  useEffect(() => {
    if (!site) return;
    const t = setInterval(() => void refreshGit(site.id), 8000);
    return () => clearInterval(t);
  }, [site?.id, refreshGit]);

  const ready = dev?.status === "ready";
  const isMock = dev?.url === "mock:";
  // The iframe's src is fixed for the life of the mount; in-page navigation is reported back by the
  // picker script and never re-sets src (that would reload the page the user just navigated to).
  const mountPath = useRef("/");
  const mountSite = useRef<string | null>(null);
  // A new site always starts at its root (reset during render so the first frame is right);
  // a manual reload remounts at the page currently shown.
  if (mountSite.current !== (site?.id ?? null)) { mountSite.current = site?.id ?? null; mountPath.current = "/"; }
  const src = ready && !isMock ? `${dev!.url}${mountPath.current === "/" ? "/" : mountPath.current}` : undefined;
  const navigate = (p: string) => {
    const path = p.startsWith("/") ? p : "/" + p;
    setPreviewPath(path);
    const w = frame.current?.contentWindow;
    if (w && (window as any).__openPickerSeen) post({ type: "navigate", path });
    else if (frame.current && dev?.url && !isMock) frame.current.src = `${dev.url}${path}`;
  };

  if (!site) return <section className="pane preview"><div className="titlebar drag" data-tauri-drag-region /></section>;

  return (
    <section className="pane preview">
      <div className="titlebar drag" data-tauri-drag-region>
        {shown.fullWidth && <button className={cx("icon-btn", full && "on")} title={full ? "Back to the sidebar and conversation (⌘\\)" : "Preview at full width (⌘\\)"} onClick={() => setPreviewFull(!full)}>{full ? <Collapse /> : <Expand />}</button>}
        {shown.devices && <div className="seg">
          {(["desktop", "tablet", "phone"] as Device[]).map((d) => (
            <button key={d} className={cx("icon-btn", device === d && "on")} title={d} onClick={() => setDevice(d)}>
              {d === "desktop" ? <Desktop /> : d === "tablet" ? <Tablet /> : <Phone />}
            </button>
          ))}
        </div>}
        <div className="path">
          <span className="host">{dev?.url && !isMock ? dev.url.replace(/^https?:\/\//, "") : "localhost"}</span>
          <input value={pathDraft} onChange={(e) => setPathDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") navigate(pathDraft); }} onBlur={() => setPathDraft(previewPath)} spellCheck={false} />
        </div>
        {shown.previewPick && <button className={cx("icon-btn", picking && "on")} title="Pick an element" disabled={!ready} onClick={() => setPicking(!picking)}><Crosshair /></button>}
        {shown.reload && <button className="icon-btn" title="Reload" disabled={!ready} onClick={() => { if ((window as any).__openPickerSeen) post({ type: "reload" }); else { mountPath.current = previewPath; reloadPreview(); } }}><Reload /></button>}
        {shown.openBrowser && <button className="icon-btn" title="Open in browser" disabled={!ready || isMock} onClick={() => void openInBrowser()}><External /></button>}
        {shown.screenshot && <button className="icon-btn" title="Attach a screenshot of the preview to your next message" disabled={!ready} onClick={() => void capturePreview()}><Camera /></button>}
        {shown.devLog && <button className={cx("icon-btn", devLogOpen && "on")} title="Dev server log" onClick={toggleDevLog}><Terminal /></button>}
        {shown.devStatus && <DevChip />}
        <button className="publish" onClick={openPublish} title={site.publish ? site.publish : "No publish command yet"}>
          Publish{git && git.changed > 0 && <span className="n">{git.changed}</span>}
        </button>
      </div>
      <div className={cx("stage", device !== "desktop" && "device", picking && "picking")}>
        {ready && (
          <iframe
            key={(dev?.url ?? "") + nonce}
            ref={frame}
            className="frame"
            name={isMock ? "open-mock-preview" : "open-preview"}
            title="Site preview"
            style={{ width: widths[device], maxWidth: "100%" }}
            src={src}
            srcDoc={isMock ? mockDoc() : undefined}
            onLoad={() => { previewEvent("iframe-load", src ?? "srcdoc"); post({ type: "ping" }); if (picking) post({ type: "pick", active: true }); }}
          />
        )}
        {!ready && (
          <div className="overlay">
            <div className="box">
              {site.needsInstall ? (
                <>
                  <h3>Dependencies aren't installed</h3>
                  <p>This site needs its packages before the dev server can start.</p>
                  {noNode && <p className="danger">Node.js isn't installed, so nothing can be installed yet. Get the LTS from nodejs.org, then come back.</p>}
                  {newSite.running && <div className="log">{newSite.log.slice(-12).join("\n") || "Installing…"}</div>}
                  {newSite.error && <p className="danger">{newSite.error}</p>}
                  <div><button className="btn primary" disabled={newSite.running || noNode} onClick={() => void installDeps(site.id)}>{newSite.running ? "Installing…" : `Run ${site.packageManager ?? "npm"} install`}</button></div>
                </>
              ) : !site.dev ? (
                <>
                  <h3 style={siteBusy ? { display: "flex", alignItems: "center", gap: 10 } : undefined}>{siteBusy && <span className="spinner" />}{siteBusy ? "Setting up the preview" : "This site can't be previewed yet"}</h3>
                  <p>There is no dev server in this folder, so Supasito's first task is to set one up: Claude looks at the files, adds a <code>dev</code> script that serves the site with live reload, and installs what it needs. The site itself stays as it is.</p>
                  {siteBusy
                    ? <p>Claude is on it; the preview starts when the turn ends.</p>
                    : <div><button className="btn primary" onClick={() => void setupPreview(site.id)}>Set up the preview</button></div>}
                  <p style={{ fontSize: 12 }}>Or add a <code>dev</code> script to package.json yourself, or a <code>supasito.json</code> with a <code>dev</code> command (<code>{"{port}"}</code> where the port goes).</p>
                </>
              ) : dev?.status === "error" && dev.problem?.kind === "port" ? (
                <>
                  <h3>Port {dev.problem.port} is taken</h3>
                  <PortTakenNote problem={dev.problem} otherSite={siteName(dev.problem.holder?.siteId)} />
                  <div className="log">{devLog.slice(-6).join("\n") || dev.command}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {dev.problem.holder && <button className="btn primary" onClick={() => void freePortAndRestart(site.id)}>{dev.problem.holder.siteId ? `Stop ${siteName(dev.problem.holder.siteId) ?? "it"} and try again` : "Stop it and try again"}</button>}
                    <button className={cx("btn", !dev.problem.holder && "primary")} onClick={() => void restartDev(site.id)}>Try again</button>
                  </div>
                </>
              ) : dev?.status === "error" || dev?.status === "stopped" ? (
                <>
                  <h3>{dev.status === "error" ? "The dev server didn't start" : "The dev server stopped"}</h3>
                  {noNode && <p className="danger">Node.js isn't installed, so the dev server can't run. Get the LTS from nodejs.org, then try again.</p>}
                  <div className="log">{devLog.slice(-14).join("\n") || dev.command}</div>
                  <div><button className="btn primary" onClick={() => void restartDev(site.id)}>Try again</button></div>
                </>
              ) : (
                <>
                  <h3 style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="spinner" />Starting the dev server</h3>
                  <p>{dev?.command ?? site.dev}</p>
                  {devLog.length > 0 && <div className="log">{devLog.slice(-8).join("\n")}</div>}
                  {!dev && <div><button className="btn primary" onClick={() => void startDev(site.id)}>Start</button></div>}
                </>
              )}
              {!site.isGit && !site.needsInstall && (
                <p>This folder isn't a git repository yet, so Supasito can't count changes. <button className="btn sm" onClick={() => void gitInit(site.id)}>Initialise git</button></p>
              )}
            </div>
          </div>
        )}
      </div>
      {devLogOpen && <div className="devlog">{devLog.length ? devLog.join("\n") : "No output yet."}</div>}
    </section>
  );
}

/** What holds the port and why that blocks this site: the command names the port itself, so no other port would do. */
function PortTakenNote({ problem, otherSite }: { problem: DevProblem; otherSite?: string }) {
  const h = problem.holder;
  const folder = h?.cwd ? h.cwd.replace(/^\/Users\/[^/]+/, "~") : null;
  if (h?.siteId) return <p>Your site <b>{otherSite ?? "another site"}</b> is using port {problem.port}. Both sites' dev commands ask for that port, so only one can run at a time.</p>;
  if (h) return <p><b>{h.name}</b> (pid {h.pid}){folder ? <> started in <code>{folder}</code></> : null} is listening on port {problem.port}, and this site's dev command uses that port. Stopping it ends that program.</p>;
  return <p>Something else is listening on port {problem.port}, and this site's dev command uses that port. Quit whatever runs there, or put <code>{"{port}"}</code> in the dev command so Supasito can pick a free one.</p>;
}

function DevChip() {
  const dev = useDev();
  if (!dev) return <span className="chip">Preview off</span>;
  const cls = dev.status === "ready" ? "ok" : dev.status === "starting" ? "warn" : "err";
  const label = dev.status === "ready" ? `Ready · :${dev.port}` : dev.status === "starting" ? "Starting…" : dev.status === "error" ? (dev.problem?.kind === "port" ? "Port taken" : "Error") : "Stopped";
  return <span className={cx("chip", cls)}><span className="status-dot" style={{ background: "currentColor" }} />{label}</span>;
}

let cachedMock: string | null = null;
function mockDoc(): string {
  if (isTauri) return "";
  if (cachedMock) return cachedMock;
  // loaded lazily so the mock never ships in the Tauri bundle path
  cachedMock = (window as any).__openMockDoc ?? "";
  return cachedMock ?? "";
}
