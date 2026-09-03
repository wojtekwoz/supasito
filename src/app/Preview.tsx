import { useEffect, useRef, useState } from "react";
import { useDev, useDevLogOfCurrentSite, useSite, useStore, type Device } from "./store";
import { cx } from "../util";
import { Crosshair, Desktop, External, Phone, Reload, Tablet, Terminal } from "../ui/Icons";
import { isTauri } from "../backend";

const widths: Record<Device, string> = { desktop: "100%", tablet: "834px", phone: "390px" };

export function Preview() {
  const site = useSite();
  const dev = useDev();
  const device = useStore((s) => s.device);
  const setDevice = useStore((s) => s.setDevice);
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
  const installDeps = useStore((s) => s.installDeps);
  const newSite = useStore((s) => s.newSite);
  const gitInit = useStore((s) => s.gitInit);
  const refreshGit = useStore((s) => s.refreshGit);
  const previewEvent = useStore((s) => s.previewEvent);
  const navigateRequest = useStore((s) => s.navigateRequest);

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
  const mountPath = useRef(previewPath);
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
        <div className="seg">
          {(["desktop", "tablet", "phone"] as Device[]).map((d) => (
            <button key={d} className={cx("icon-btn", device === d && "on")} title={d} onClick={() => setDevice(d)}>
              {d === "desktop" ? <Desktop /> : d === "tablet" ? <Tablet /> : <Phone />}
            </button>
          ))}
        </div>
        <div className="path">
          <span className="host">{dev?.url && !isMock ? dev.url.replace(/^https?:\/\//, "") : "localhost"}</span>
          <input value={pathDraft} onChange={(e) => setPathDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") navigate(pathDraft); }} onBlur={() => setPathDraft(previewPath)} spellCheck={false} />
        </div>
        <button className={cx("icon-btn", picking && "on")} title="Pick an element" disabled={!ready} onClick={() => setPicking(!picking)}><Crosshair /></button>
        <button className="icon-btn" title="Reload" disabled={!ready} onClick={() => { post({ type: "reload" }); reloadPreview(); }}><Reload /></button>
        <button className="icon-btn" title="Open in browser" disabled={!ready || isMock} onClick={() => void openInBrowser()}><External /></button>
        <button className={cx("icon-btn", devLogOpen && "on")} title="Dev server log" onClick={toggleDevLog}><Terminal /></button>
        <DevChip />
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
                  {newSite.running && <div className="log">{newSite.log.slice(-12).join("\n") || "Installing…"}</div>}
                  {newSite.error && <p style={{ color: "#C0392B" }}>{newSite.error}</p>}
                  <div><button className="btn primary" disabled={newSite.running} onClick={() => void installDeps(site.id)}>{newSite.running ? "Installing…" : `Run ${site.packageManager ?? "npm"} install`}</button></div>
                </>
              ) : !site.dev ? (
                <>
                  <h3>No dev server found</h3>
                  <p>Add a <code>dev</code> script to package.json, or an <code>open.json</code> with a <code>dev</code> command (use <code>{"{port}"}</code> where the port goes).</p>
                </>
              ) : dev?.status === "error" || dev?.status === "stopped" ? (
                <>
                  <h3>{dev.status === "error" ? "The dev server didn't start" : "The dev server stopped"}</h3>
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
                <p>This folder isn't a git repository yet, so Open can't count changes. <button className="btn sm" onClick={() => void gitInit(site.id)}>Initialise git</button></p>
              )}
            </div>
          </div>
        )}
      </div>
      {devLogOpen && <div className="devlog">{devLog.length ? devLog.join("\n") : "No output yet."}</div>}
    </section>
  );
}

function DevChip() {
  const dev = useDev();
  if (!dev) return <span className="chip">Preview off</span>;
  const cls = dev.status === "ready" ? "ok" : dev.status === "starting" ? "warn" : "err";
  const label = dev.status === "ready" ? `Ready · :${dev.port}` : dev.status === "starting" ? "Starting…" : dev.status === "error" ? "Error" : "Stopped";
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
