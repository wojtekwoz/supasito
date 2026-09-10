import { useEffect, useMemo, useRef, useState } from "react";
import { DRAFT, useSessionsOfCurrentSite, useStore } from "./store";
import { ago, cx } from "../util";
import { Book, Code, Folder, Gear, Plus, Sparkle, Star, Trash } from "../ui/Icons";
import type { Site } from "../types";
import { useShown } from "./ui";

const SESSION_CAP = 12;
/** Past this many sites the "All sites…" row appears even with nothing starred, for the filter. */
const MENU_AT = 6;

export function Rail() {
  const sites = useStore((s) => s.sites);
  const currentSiteId = useStore((s) => s.currentSiteId);
  const selectSite = useStore((s) => s.selectSite);
  const addSiteFromFolder = useStore((s) => s.addSiteFromFolder);
  const openNewSite = useStore((s) => s.openNewSite);
  const askRemoveSite = useStore((s) => s.askRemoveSite);
  const favoriteSite = useStore((s) => s.favoriteSite);
  const siteMenuOpen = useStore((s) => s.siteMenuOpen);
  const setSiteMenuOpen = useStore((s) => s.setSiteMenuOpen);
  const revealSite = useStore((s) => s.revealSite);
  const openSiteInEditor = useStore((s) => s.openSiteInEditor);
  const renameSite = useStore((s) => s.renameSite);
  const openRules = useStore((s) => s.openRules);
  const [showAll, setShowAll] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const sessions = useSessionsOfCurrentSite();
  const currentSessionId = useStore((s) => s.currentSessionId);
  const openSession = useStore((s) => s.openSession);
  const newSession = useStore((s) => s.newSession);
  const running = useStore((s) => s.running);
  const transcripts = useStore((s) => s.transcripts);
  const claude = useStore((s) => s.claude);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const showSiteTools = useShown("siteTools");
  // Starred sites, plus the current one if it is not starred; with nothing starred, every site as before.
  const favs = sites.filter((s) => s.favorite);
  const current = sites.find((s) => s.id === currentSiteId);
  const shown = favs.length ? (current && !current.favorite ? [...favs, current] : favs) : sites;
  const more = sites.length > shown.length || sites.length > MENU_AT;

  return (
    <aside className="pane rail">
      <div className="titlebar drag" data-tauri-drag-region />
      <div className="rail-body">
        <div>
          <div className="section-h">
            <span>Sites</span>
            <span className="actions">
              <button className="icon-btn" title="Open a folder" onClick={() => void addSiteFromFolder()}><Folder /></button>
              <button className="icon-btn" title="New site from the starter" onClick={() => openNewSite(true)}><Plus /></button>
            </span>
          </div>
          <div className="list">
            {sites.length === 0 && <div className="empty">No sites yet.</div>}
            {shown.map((site) => (
              <button key={site.id} className={cx("row", site.id === currentSiteId && "on")} onClick={() => void selectSite(site.id)} onDoubleClick={() => setRenaming({ id: site.id, value: site.name })} title={`${site.path}\nDouble-click to rename`}>
                {renaming?.id === site.id ? (
                  <input
                    className="rename"
                    autoFocus
                    value={renaming.value}
                    onChange={(e) => setRenaming({ id: site.id, value: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => { const v = renaming.value.trim(); setRenaming(null); if (v && v !== site.name) void renameSite(site.id, v); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }}
                  />
                ) : <span className="t">{site.name}</span>}
                <span className={cx("icon-btn x star", site.favorite && "set")} title={site.favorite ? "Unstar" : "Star: keep it at the top of the sidebar"} onClick={(e) => { e.stopPropagation(); void favoriteSite(site.id, !site.favorite); }}><Star filled={!!site.favorite} /></span>
                {site.id === currentSiteId && <span className="icon-btn x" title="Site rules (CLAUDE.md): voice, brand, conventions" onClick={(e) => { e.stopPropagation(); void openRules(); }}><Book /></span>}
                {showSiteTools && <span className="icon-btn x" title="Open in your code editor" onClick={(e) => { e.stopPropagation(); void openSiteInEditor(site.id); }}><Code /></span>}
                {showSiteTools && <span className="icon-btn x" title="Reveal in Finder" onClick={(e) => { e.stopPropagation(); void revealSite(site.id); }}><Folder /></span>}
                <span className="icon-btn x" title="Remove from the sidebar (the folder stays on disk)" onClick={(e) => { e.stopPropagation(); askRemoveSite(site.id); }}><Trash /></span>
              </button>
            ))}
            {more && (
              <button className={cx("row more", siteMenuOpen && "on")} title="All sites (⌘⇧O)" onClick={() => setSiteMenuOpen(!siteMenuOpen)}><span className="t">All sites… ({sites.length})</span></button>
            )}
          </div>
        </div>
        {siteMenuOpen && <SiteMenu />}

        {currentSiteId && (
          <div>
            <div className="section-h">
              <span>Sessions</span>
              <span className="actions">
                <button className="icon-btn" title="New session" onClick={newSession}><Plus /></button>
              </span>
            </div>
            <div className="list">
              {currentSessionId === DRAFT && (
                <button className="row on"><Sparkle className="glyph" /><span className="t">New session</span></button>
              )}
              {sessions.length === 0 && currentSessionId !== DRAFT && <div className="empty">No sessions for this site yet.</div>}
              {(showAll ? sessions : sessions.slice(0, SESSION_CAP)).map((s) => {
                const busy = transcripts[s.id]?.busy;
                const live = !!running[s.id];
                return (
                  <button key={s.id} className={cx("row", s.id === currentSessionId && "on")} onClick={() => void openSession(s.id)} title={s.title}>
                    <span className={cx("status-dot", busy && "busy", !busy && live && "live")} />
                    <span className="t">{s.title}</span>
                    <span className="meta">{ago(s.lastModified)}</span>
                  </button>
                );
              })}
              {sessions.length > SESSION_CAP && (
                <button className="row" onClick={() => setShowAll(!showAll)}><span className="t" style={{ color: "var(--ink-3)" }}>{showAll ? "Show fewer" : `Show ${sessions.length - SESSION_CAP} older`}</span></button>
              )}
            </div>
          </div>
        )}
      </div>
      <UpdateRow />
      <div className="rail-foot">
        <span className={cx("status-dot", claude?.ok ? "live" : "")} />
        <span className="t">{claude?.ok ? `Claude Code ${claude.version ?? ""}` : "Claude Code not found"}</span>
        <button className="icon-btn" title="Settings" onClick={() => setSettingsOpen(true)}><Gear /></button>
      </div>
    </aside>
  );
}

/** One line above the rail's foot when a newer Supasito exists, and only then: what the version is, one button to
 *  take it, one to say not now. The check that finds it is in src-tauri/src/updates.rs; Settings → Updates turns it off. */
function UpdateRow() {
  const update = useStore((s) => s.update);
  const busy = useStore((s) => s.updateBusy);
  const progress = useStore((s) => s.updateProgress);
  const install = useStore((s) => s.installUpdate);
  const dismiss = useStore((s) => s.dismissUpdate);
  if (!update) return null;
  const installing = busy === "installing";
  return (
    <div className="rail-update">
      <span className="t" title={update.notes ?? undefined}>Supasito {update.version} is out</span>
      {installing ? (
        <span className="p">{progress === null ? "Downloading…" : `Downloading ${Math.round(progress * 100)}%`}</span>
      ) : (
        <span className="acts">
          <button className="btn sm primary" onClick={() => void install()}>Update and restart</button>
          <button className="later" title="Ask again when a later version appears" onClick={() => void dismiss()}>Not now</button>
        </span>
      )}
    </div>
  );
}

/** The dropdown behind "All sites…" and ⌘⇧O: a filter, favourites first, then the rest by last opened, each with a
 *  star and the trash; Open a folder and New site at the bottom. ↑↓ move, Enter selects, Escape closes (App.tsx). */
function SiteMenu() {
  const sites = useStore((s) => s.sites);
  const currentSiteId = useStore((s) => s.currentSiteId);
  const selectSite = useStore((s) => s.selectSite);
  const favoriteSite = useStore((s) => s.favoriteSite);
  const askRemoveSite = useStore((s) => s.askRemoveSite);
  const addSiteFromFolder = useStore((s) => s.addSiteFromFolder);
  const openNewSite = useStore((s) => s.openNewSite);
  const setSiteMenuOpen = useStore((s) => s.setSiteMenuOpen);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (s: Site) => !needle || s.name.toLowerCase().includes(needle) || s.path.toLowerCase().includes(needle);
    const byOpened = (a: Site, b: Site) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0);
    return [...sites.filter((s) => s.favorite && hit(s)), ...sites.filter((s) => !s.favorite && hit(s)).sort(byOpened)];
  }, [sites, q]);
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector(".row.active")?.scrollIntoView({ block: "nearest" }); }, [active]);
  const pick = (site: Site) => { setSiteMenuOpen(false); if (site.id !== currentSiteId) void selectSite(site.id); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const r = rows[active]; if (r) pick(r); }
  };
  return (
    <>
      <div className="site-menu-veil" onMouseDown={() => setSiteMenuOpen(false)} />
      <div className="site-menu" onKeyDown={onKey}>
        <input className="filter" autoFocus placeholder="Filter sites" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="scroll" ref={listRef}>
          {rows.length === 0 && <div className="empty">No site matches.</div>}
          {rows.map((site, i) => (
            <button key={site.id} className={cx("row", i === active && "active", site.id === currentSiteId && "on")} onMouseEnter={() => setActive(i)} onClick={() => pick(site)} title={site.path}>
              <span className="two"><span className="t">{site.name}</span><span className="p">{site.path}</span></span>
              <span className={cx("icon-btn x star", site.favorite && "set")} title={site.favorite ? "Unstar" : "Star: keep it at the top of the sidebar"} onClick={(e) => { e.stopPropagation(); void favoriteSite(site.id, !site.favorite); }}><Star filled={!!site.favorite} /></span>
              <span className="icon-btn x" title="Remove from the sidebar (the folder stays on disk)" onClick={(e) => { e.stopPropagation(); setSiteMenuOpen(false); askRemoveSite(site.id); }}><Trash /></span>
            </button>
          ))}
        </div>
        <div className="foot">
          <button className="row" onClick={() => { setSiteMenuOpen(false); void addSiteFromFolder(); }}><Folder className="glyph" /><span className="t">Open a folder…</span></button>
          <button className="row" onClick={() => { setSiteMenuOpen(false); openNewSite(true); }}><Plus className="glyph" /><span className="t">New site from the starter…</span></button>
        </div>
      </div>
    </>
  );
}
