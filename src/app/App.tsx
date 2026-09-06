import { useEffect } from "react";
import { useStore } from "./store";
import { Rail } from "./Rail";
import { SessionPane } from "./Session";
import { Preview } from "./Preview";
import { DiffDialog, NewSiteDialog, PublishDialog, RulesDialog, SettingsDialog } from "./Dialogs";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { cx } from "../util";

export default function App() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  const fatal = useStore((s) => s.fatal);
  const toast = useStore((s) => s.toast);
  const full = useStore((s) => s.previewFull && !!s.currentSiteId);
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
        // A new session is for talking, so a full-width preview gives way to it.
        if (st.currentSiteId) { e.preventDefault(); st.setPreviewFull(false); st.newSession(); }
        return;
      }
      // ⌘\ shows the preview at full width, and back. Matched by key position (the US backslash key) or by
      // the character: on German and French layouts no key at that position produces `\` (it is `#` or a
      // backtick), and the real backslash is ⌥⇧7, `code: "Digit7"`. Chords that need Shift still stop at
      // the shift guard.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.code === "Backslash" || e.key === "\\")) {
        const st = useStore.getState();
        if (st.currentSiteId) { e.preventDefault(); st.setPreviewFull(!st.previewFull); }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") { e.preventDefault(); useStore.getState().setSettingsOpen(true); return; }
      if (e.key === "Escape") {
        const st = useStore.getState();
        if (st.diff.open) { st.closeDiff(); return; }
        if (st.rules.open && !st.rules.saving) { st.closeRules(); return; }
        if (st.picking) { st.setPicking(false); return; }
        if (st.publish.open && !st.publish.running) { st.setPublishOpen(false); return; }
        if (st.newSite.open && !st.newSite.running) { st.openNewSite(false); return; }
        if (st.settingsOpen) { st.setSettingsOpen(false); return; }
        const cur = st.currentSessionId ? st.transcripts[st.currentSessionId] : null;
        if (cur?.busy && !(e.target instanceof HTMLInputElement)) void st.interrupt();
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
    <div className={cx("app", full && "full")}>
      <ErrorBoundary label="rail"><Rail /></ErrorBoundary>
      <ErrorBoundary label="session"><SessionPane /></ErrorBoundary>
      <ErrorBoundary label="preview"><Preview /></ErrorBoundary>
      <NewSiteDialog />
      <PublishDialog />
      <DiffDialog />
      <RulesDialog />
      <SettingsDialog />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
