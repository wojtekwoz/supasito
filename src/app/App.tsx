import { useEffect } from "react";
import { useStore } from "./store";
import { Rail } from "./Rail";
import { SessionPane } from "./Session";
import { Preview } from "./Preview";
import { DiffDialog, NewSiteDialog, PublishDialog, RemoveSiteDialog, RulesDialog, SettingsDialog } from "./Dialogs";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { cx } from "../util";

export default function App() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  const fatal = useStore((s) => s.fatal);
  const toast = useStore((s) => s.toast);
  const full = useStore((s) => s.previewFull && !!s.currentSiteId);
  // The floating conversation reacts to these: it fades while picking, moves above the dev log, hides for a capture.
  const picking = useStore((s) => s.picking);
  const devLogOpen = useStore((s) => s.devLogOpen);
  const capturing = useStore((s) => s.capturing);
  useEffect(() => { void init(); }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘⇧E toggles the element picker from anywhere.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e") {
        const st = useStore.getState();
        const dev = st.currentSiteId ? st.dev[st.currentSiteId] : null;
        if (dev?.status === "ready") { e.preventDefault(); st.setPicking(!st.picking); }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        const st = useStore.getState();
        e.preventDefault(); st.setSiteMenuOpen(!st.siteMenuOpen);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "n") {
        const st = useStore.getState();
        // A new session is for talking: a minimised panel comes back for it.
        if (st.currentSiteId) { e.preventDefault(); st.setPanelMin(false); st.newSession(); }
        return;
      }
      // ⌘\ shows the preview at full width, and back. Matched by key position (the US backslash key, unshifted
      // so ⌘| stays free) or by the character, whatever modifiers produced it: on German and French layouts no
      // key at that position produces `\` (it is `#` or a backtick) and the real backslash is ⌥⇧7, which sets
      // shiftKey, so the shift guard applies to the position match only.
      if ((e.metaKey || e.ctrlKey) && ((e.code === "Backslash" && !e.shiftKey) || e.key === "\\")) {
        const st = useStore.getState();
        if (st.currentSiteId) { e.preventDefault(); st.setPreviewFull(!st.previewFull); }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") { e.preventDefault(); useStore.getState().setSettingsOpen(true); return; }
      if (e.key === "Escape") {
        // The composer handles its own Escape (closing the slash-command list) and marks the event handled.
        if (e.defaultPrevented) return;
        const st = useStore.getState();
        if (st.diff.open) { st.closeDiff(); return; }
        if (st.rules.open && !st.rules.saving) { st.closeRules(); return; }
        if (st.picking) { st.setPicking(false); return; }
        if (st.publish.open && !st.publish.running) { st.setPublishOpen(false); return; }
        if (st.newSite.open && !st.newSite.running) { st.openNewSite(false); return; }
        if (st.removing) { st.askRemoveSite(null); return; }
        if (st.siteMenuOpen) { st.setSiteMenuOpen(false); return; }
        if (st.settingsOpen) { st.setSettingsOpen(false); return; }
        const cur = st.currentSessionId ? st.transcripts[st.currentSessionId] : null;
        if (cur?.busy && !(e.target instanceof HTMLInputElement)) { void st.interrupt(); return; }
        // Nothing else to dismiss: Escape leaves full-width mode, like the arrows in the panel and ⌘\.
        if (st.previewFull && st.currentSiteId) st.setPreviewFull(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Dropping a file anywhere outside the composer must not navigate the window.
  useEffect(() => {
    const block = (e: DragEvent) => { if (!(e.target as HTMLElement | null)?.closest?.(".composer")) { e.preventDefault(); } };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => { window.removeEventListener("dragover", block); window.removeEventListener("drop", block); };
  }, []);

  if (!ready) return <div className="boot">Starting Supasito…</div>;
  if (fatal) return <div className="boot"><div>Supasito could not start.<br /><span style={{ color: "var(--err)" }}>{fatal}</span></div></div>;
  return (
    <div className={cx("app", full && "full", picking && "picking", devLogOpen && "devlog", capturing && "capturing")}>
      <ErrorBoundary label="rail"><Rail /></ErrorBoundary>
      <ErrorBoundary label="session"><SessionPane /></ErrorBoundary>
      <ErrorBoundary label="preview"><Preview /></ErrorBoundary>
      <NewSiteDialog />
      <RemoveSiteDialog />
      <PublishDialog />
      <DiffDialog />
      <RulesDialog />
      <SettingsDialog />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
