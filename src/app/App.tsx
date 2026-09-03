import { useEffect } from "react";
import { useStore } from "./store";
import { Rail } from "./Rail";
import { SessionPane } from "./Session";
import { Preview } from "./Preview";
import { DiffDialog, NewSiteDialog, PublishDialog, SettingsDialog } from "./Dialogs";
import { ErrorBoundary } from "../ui/ErrorBoundary";

export default function App() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  const fatal = useStore((s) => s.fatal);
  const toast = useStore((s) => s.toast);
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
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "n") {
        const st = useStore.getState();
        if (st.currentSiteId) { e.preventDefault(); st.newSession(); }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") { e.preventDefault(); useStore.getState().setSettingsOpen(true); return; }
      if (e.key === "Escape") {
        const st = useStore.getState();
        if (st.diff.open) { st.closeDiff(); return; }
        if (st.picking) { st.setPicking(false); return; }
        if (st.publish.open && !st.publish.running) st.setPublishOpen(false);
        if (st.newSite.open && !st.newSite.running) st.openNewSite(false);
        if (st.settingsOpen) st.setSettingsOpen(false);
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

  if (!ready) return <div className="boot">Starting Open…</div>;
  if (fatal) return <div className="boot"><div>Open could not start.<br /><span style={{ color: "var(--err)" }}>{fatal}</span></div></div>;
  return (
    <div className="app">
      <ErrorBoundary label="rail"><Rail /></ErrorBoundary>
      <ErrorBoundary label="session"><SessionPane /></ErrorBoundary>
      <ErrorBoundary label="preview"><Preview /></ErrorBoundary>
      <NewSiteDialog />
      <PublishDialog />
      <DiffDialog />
      <SettingsDialog />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
