import { useState } from "react";
import { DRAFT, useSessionsOfCurrentSite, useStore } from "./store";
import { ago, cx } from "../util";
import { Book, Code, Folder, Gear, Mark, Plus, Sparkle, Trash } from "../ui/Icons";
import { useShown } from "./ui";

const SESSION_CAP = 12;

export function Rail() {
  const sites = useStore((s) => s.sites);
  const currentSiteId = useStore((s) => s.currentSiteId);
  const selectSite = useStore((s) => s.selectSite);
  const addSiteFromFolder = useStore((s) => s.addSiteFromFolder);
  const openNewSite = useStore((s) => s.openNewSite);
  const removeSite = useStore((s) => s.removeSite);
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

  return (
    <aside className="pane rail">
      <div className="titlebar drag" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region><Mark className="mark" />Supasito</div>
      </div>
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
            {sites.map((site) => (
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
                {site.id === currentSiteId && <span className="icon-btn x" title="Site rules (CLAUDE.md): voice, brand, conventions" onClick={(e) => { e.stopPropagation(); void openRules(); }}><Book /></span>}
                {showSiteTools && <span className="icon-btn x" title="Open in your code editor" onClick={(e) => { e.stopPropagation(); void openSiteInEditor(site.id); }}><Code /></span>}
                {showSiteTools && <span className="icon-btn x" title="Reveal in Finder" onClick={(e) => { e.stopPropagation(); void revealSite(site.id); }}><Folder /></span>}
                <span className="icon-btn x" title="Remove from Supasito (keeps the folder)" onClick={(e) => { e.stopPropagation(); if (confirm(`Remove ${site.name} from Supasito? The folder stays on disk.`)) void removeSite(site.id); }}><Trash /></span>
              </button>
            ))}
          </div>
        </div>

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
      <div className="rail-foot">
        <span className={cx("status-dot", claude?.ok ? "live" : "")} />
        <span className="t">{claude?.ok ? `Claude Code ${claude.version ?? ""}` : "Claude Code not found"}</span>
        <button className="icon-btn" title="Settings" onClick={() => setSettingsOpen(true)}><Gear /></button>
      </div>
    </aside>
  );
}
