import { useStore } from "./store";

/** Every part of the interface that Settings → Interface can hide. The key is what `settings.hidden` stores; the label
 *  is the checkbox text. Publish, the composer and the transcript itself are not here: they are the loop. */
export type UiKey =
  | "knobs" | "usage" | "composerPick" | "hint" | "steps" | "thinking"
  | "fullWidth" | "devices" | "previewPick" | "reload" | "openBrowser" | "screenshot" | "devLog" | "devStatus"
  | "siteTools";

export const UI_GROUPS: { label: string; items: { key: UiKey; label: string }[] }[] = [
  {
    label: "Conversation",
    items: [
      { key: "knobs", label: "Model, effort, mode and fast-mode chips under the message box" },
      { key: "usage", label: "Usage ring next to Send (context, plan, cost)" },
      { key: "composerPick", label: "Element picker button in the message box (⌘⇧E still works)" },
      { key: "hint", label: "Keyboard hint under the message box" },
      { key: "steps", label: "What Claude did: file reads, edits and commands as rows" },
      { key: "thinking", label: "Claude's reasoning (the collapsed Thinking row)" },
    ],
  },
  {
    label: "Preview toolbar",
    items: [
      { key: "fullWidth", label: "Full-width preview button (⌘\\ still works)" },
      { key: "devices", label: "Desktop, tablet and phone widths" },
      { key: "previewPick", label: "Pick an element" },
      { key: "reload", label: "Reload" },
      { key: "openBrowser", label: "Open in browser" },
      { key: "screenshot", label: "Screenshot of the preview" },
      { key: "devLog", label: "Dev server log (the terminal button)" },
      { key: "devStatus", label: "Dev server status chip (Ready · :3000)" },
    ],
  },
  {
    label: "Sidebar",
    items: [
      { key: "siteTools", label: "Open in editor and Reveal in Finder on each site" },
    ],
  },
];

/** What a fresh install hides: the chips, the composer's picker button, the keyboard hint, the dev log button and the status
 *  chip. The same list lives in `Persisted::default_hidden` (src-tauri/src/state.rs), which is what the app actually reads;
 *  this copy is for the mock backend. Ticking a box or "Show everything" writes the list explicitly, so a saved `[]` stays `[]`. */
export const DEFAULT_HIDDEN: UiKey[] = ["knobs", "composerPick", "hint", "devLog", "devStatus"];

/** True unless the user hid this element in Settings → Interface. */
export function useShown(key: UiKey): boolean {
  return useStore((s) => !(s.settings.hidden ?? []).includes(key));
}
