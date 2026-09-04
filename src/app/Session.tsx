import { memo, useEffect, useRef, useState } from "react";
import { DRAFT, useSession, useSessionsOfCurrentSite, useSite, useStore } from "./store";
import type { Item } from "../agent/transcript";
import { Markdown } from "../ui/Markdown";
import { Crosshair, Doc, Globe, Pen, Search, Send, Sparkle, Stop, Terminal, X } from "../ui/Icons";
import { cx, fmtDuration, relPath } from "../util";
import { PermissionCard, QuestionCard } from "./Approval";
import { Checklist, claudeBlocked, toolsMissing } from "./Checklist";
import type { Selection } from "../types";

export function SessionPane() {
  const site = useSite();
  const session = useSession();
  const currentSessionId = useStore((s) => s.currentSessionId);
  const sessions = useSessionsOfCurrentSite();
  const tools = useStore((s) => s.tools);
  const interrupt = useStore((s) => s.interrupt);
  const running = useStore((s) => (s.currentSessionId ? !!s.running[s.currentSessionId] : false));
  const title = currentSessionId === DRAFT ? "New session" : sessions.find((s) => s.id === currentSessionId)?.title ?? "Session";

  if (!site) return <Welcome />;
  const usage = session?.usage ?? null;
  return (
    <section className="pane session">
      <div className="titlebar drag" data-tauri-drag-region>
        <span className="title" data-tauri-drag-region>{title}</span>
        {usage && usage.utilization >= 0.5 && (
          <span className={cx("chip", usage.utilization >= 0.9 ? "err" : usage.utilization >= 0.75 ? "warn" : "")} title={`Claude plan usage in the ${usage.window.replace("_", "-")} window${usage.resetsAt ? `, resets ${new Date(usage.resetsAt * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`}>
            Usage {Math.round(usage.utilization * 100)}%
          </span>
        )}
        {session?.model && <span className="chip" title="Model">{session.model.replace(/^claude-/, "")}</span>}
        {currentSessionId && currentSessionId !== DRAFT && running && <ModeSelect mode={session?.mode ?? null} />}
        {session?.busy && <button className="btn sm ghost" onClick={() => void interrupt()} title="Interrupt (Esc)"><Stop /> Stop</button>}
      </div>
      {claudeBlocked(tools)
        ? <Setup />
        : <Transcript items={session?.items ?? []} busy={!!session?.busy} root={site.path} sessionId={currentSessionId} />}
      <Composer />
    </section>
  );
}

const MODES: { value: string; label: string; hint: string }[] = [
  { value: "acceptEdits", label: "Ask before commands", hint: "Edits files freely; asks before running commands" },
  { value: "bypassPermissions", label: "Don't ask this session", hint: "Runs everything without asking. Use on sites you can restore." },
  { value: "plan", label: "Plan first", hint: "Explores and proposes a plan before changing anything" },
  { value: "default", label: "Ask about everything", hint: "Asks before edits and commands" },
];

function ModeSelect({ mode }: { mode: string | null }) {
  const setSessionMode = useStore((s) => s.setSessionMode);
  const current = MODES.find((m) => m.value === mode) ?? MODES[0];
  return (
    <select className="chip select" value={current.value} title={current.hint} onChange={(e) => void setSessionMode(e.target.value)}>
      {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
    </select>
  );
}

/** Shown instead of the transcript while Claude Code is missing or signed out. */
function Setup() {
  const signedOut = useStore((s) => !!s.tools?.claude.ok);
  return (
    <div className="welcome">
      <div className="box wide" style={{ textAlign: "left" }}>
        <h2>{signedOut ? "Sign in to Claude Code" : "Open needs Claude Code"}</h2>
        <p>Open drives the Claude Code you already use, with your own subscription. {signedOut ? "It's installed but not signed in on this Mac." : "It isn't on this Mac yet, or it isn't on the PATH."} Follow the line below, then check again.</p>
        <Checklist />
      </div>
    </div>
  );
}

function Welcome() {
  const addSiteFromFolder = useStore((s) => s.addSiteFromFolder);
  const openNewSite = useStore((s) => s.openNewSite);
  const tools = useStore((s) => s.tools);
  const missing = toolsMissing(tools);
  return (
    <section className="pane session">
      <div className="titlebar drag" data-tauri-drag-region />
      <div className="welcome">
        <div className={cx("box", missing && "wide")}>
          {missing ? (
            <>
              <h2>Before you start</h2>
              <p>Open builds sites with tools already on your Mac. Get the missing ones, then check again.</p>
              <Checklist />
            </>
          ) : (
            <>
              <h2>Open a site to begin</h2>
              <p>A site is a folder with a dev server. Open one you already have, or start a new one from the starter and describe what it should be.</p>
            </>
          )}
          <div className="actions">
            <button className="btn primary" onClick={() => void addSiteFromFolder()}>Open a folder…</button>
            <button className="btn" onClick={() => openNewSite(true)} disabled={!!tools && !tools.node.ok} title={tools && !tools.node.ok ? "Needs Node.js" : undefined}>New site</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Transcript({ items, busy, root, sessionId }: { items: Item[]; busy: boolean; root: string; sessionId: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, busy]);

  // group consecutive tool items
  const groups: (Item | Item[])[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (it.kind === "tool") {
      if (Array.isArray(last)) last.push(it); else groups.push([it]);
    } else groups.push(it);
  }

  return (
    <div className="transcript" ref={ref}>
      {items.length === 0 && (
        <div className="notice" style={{ marginTop: 8 }}>
          Describe a change, or switch on the picker <Crosshair style={{ width: 12, height: 12, verticalAlign: -2 }} /> and click the element you mean in the preview. Claude edits the code; the preview updates.
        </div>
      )}
      {groups.map((g, i) => Array.isArray(g)
        ? <Steps key={"g" + i} items={g} root={root} />
        : <Entry key={g.id} item={g} sessionId={sessionId} />)}
      {busy && !items.some((i) => i.kind === "assistant" && i.streaming) && !items.some((i) => i.kind === "permission" && i.status === "pending") && (
        <div className="step" style={{ color: "var(--ink-3)" }}><span className="st running" /><span className="label">Working…</span></div>
      )}
    </div>
  );
}

const Entry = memo(function Entry({ item, sessionId }: { item: Item; sessionId: string | null }) {
  switch (item.kind) {
    case "user":
      return (
        <div className={cx("msg user", item.queued && "queued")}>
          {item.images && item.images.length > 0 && (
            <div className="thumbs">{item.images.map((im, i) => <img key={i} src={`data:${im.mediaType};base64,${im.data}`} alt="" />)}</div>
          )}
          {item.text}
          {item.queued && <div className="queued-tag">Queued · sends when Claude finishes</div>}
          {item.selection && <div><SelectionChip sel={item.selection} /></div>}
          {!item.selection && item.selectionSummary && <div className="sel-chip" style={{ marginTop: 8 }}><Crosshair style={{ width: 12, height: 12 }} /><span className="txt">{item.selectionSummary.split("\n")[1]?.replace(/^- /, "") ?? "element"}</span></div>}
        </div>
      );
    case "assistant":
      return (
        <div className="msg assistant">
          {item.thinking && <details className="thinking"><summary>Thinking</summary>{item.thinking}</details>}
          <Markdown text={item.text} />
          {item.streaming && !item.text && <span className="caret" />}
        </div>
      );
    case "permission":
      return item.request.tool_name === "AskUserQuestion"
        ? <QuestionCard item={item} sessionId={sessionId!} />
        : <PermissionCard item={item} sessionId={sessionId!} />;
    case "result":
      return <TurnEnd item={item} sessionId={sessionId} />;
    case "notice":
      return <div className={cx("notice", item.tone === "error" && "error")}>{item.text}</div>;
    default:
      return null;
  }
});

function TurnEnd({ item, sessionId }: { item: Extract<Item, { kind: "result" }>; sessionId: string | null }) {
  const undoTurn = useStore((s) => s.undoTurn);
  const openDiff = useStore((s) => s.openDiff);
  const committedAt = useStore((s) => s.committedAt);
  const isGit = useStore((s) => (s.currentSiteId ? !!s.git[s.currentSiteId]?.isGit : false));
  const root = useStore((s) => s.sites.find((x) => x.id === s.currentSiteId)?.path ?? "");
  const n = item.files.length;
  const canUndo = isGit && n > 0 && !item.undone && item.at > committedAt;
  const label = item.isError
    ? item.text
    : [item.stopped ? "Stopped" : "Done", item.durationMs != null && fmtDuration(item.durationMs), item.costUsd != null && item.costUsd > 0 && `$${item.costUsd.toFixed(3)}`].filter(Boolean).join(" · ");
  return (
    <div className={cx("turn-end", item.isError && "error")} title={item.files.map((f) => relPath(f, root)).join("\n")}>
      <span>{label}</span>
      {n > 0 && !item.isError && <button className="link-btn" onClick={() => void openDiff(item.files)} title="Show what changed">· {n} file{n === 1 ? "" : "s"} changed</button>}
      {canUndo && sessionId && (
        <button className="link-btn" onClick={() => { if (confirm(`Put ${n === 1 ? "this file" : `these ${n} files`} back the way ${n === 1 ? "it" : "they"} ${n === 1 ? "was" : "were"} before this turn?\n\n${item.files.map((f) => relPath(f, root)).join("\n")}`)) void undoTurn(sessionId, item.id); }}>Undo</button>
      )}
      {item.undone && <span>· undone</span>}
    </div>
  );
}

function toolGlyph(name: string) {
  switch (name) {
    case "Read": case "Glob": case "LS": return <Doc className="glyph" />;
    case "Edit": case "MultiEdit": case "Write": case "NotebookEdit": return <Pen className="glyph" />;
    case "Bash": return <Terminal className="glyph" />;
    case "Grep": return <Search className="glyph" />;
    case "WebFetch": case "WebSearch": return <Globe className="glyph" />;
    default: return <Sparkle className="glyph" />;
  }
}

const sameItems = (a: { items: Item[]; root: string }, b: { items: Item[]; root: string }) => a.root === b.root && a.items.length === b.items.length && a.items.every((it, i) => it === b.items[i]);

const Steps = memo(function Steps({ items, root }: { items: Item[]; root: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="steps">
      {items.map((it) => {
        if (it.kind !== "tool") return null;
        const label = it.label.replace(root + "/", "");
        const isOpen = open === it.id;
        return (
          <div key={it.id}>
            <button className={cx("step", it.parentToolUseId && "sub")} onClick={() => setOpen(isOpen ? null : it.id)} title={it.name}>
              {toolGlyph(it.name)}
              <span className="label">{label}</span>
              <span className={cx("st", it.status)} />
            </button>
            {isOpen && <StepDetail item={it} root={root} />}
          </div>
        );
      })}
    </div>
  );
}, sameItems);

function StepDetail({ item, root }: { item: Extract<Item, { kind: "tool" }>; root: string }) {
  const i = item.input || {};
  let head: string;
  switch (item.name) {
    case "Bash": head = String(i.command ?? ""); break;
    case "Edit": head = `${relPath(String(i.file_path ?? ""), root)}\n- ${String(i.old_string ?? "").slice(0, 400)}\n+ ${String(i.new_string ?? "").slice(0, 400)}`; break;
    case "Write": head = `${relPath(String(i.file_path ?? ""), root)}\n${String(i.content ?? "").slice(0, 600)}`; break;
    case "Read": head = relPath(String(i.file_path ?? ""), root); break;
    default: head = JSON.stringify(i, null, 1).slice(0, 800);
  }
  const out = item.result ? item.result.slice(0, 1500) : item.status === "running" ? "…" : "";
  return (
    <div className="step-out">
      <span className="k">{item.name}</span> {head}
      {out && <>{"\n"}<span className="k">→</span> {out}</>}
    </div>
  );
}

const plainClass = (classes: string[]) => classes.find((c) => /^[a-zA-Z][\w-]{1,17}$/.test(c));

export function SelectionChip({ sel, onClear }: { sel: Selection; onClear?: () => void }) {
  const cls = sel.id ? "" : plainClass(sel.classes) ?? "";
  const label = sel.tag + (sel.id ? "#" + sel.id : "") + (cls ? "." + cls : "");
  const src = sel.source?.file ? sel.source.file.split("/").slice(-2).join("/") + (sel.source.loc ? ":" + sel.source.loc.split(":")[0] : "") : sel.react?.components?.[0];
  return (
    <span className="sel-chip" title={sel.selector}>
      <Crosshair style={{ width: 12, height: 12, color: "var(--accent)" }} />
      <span className="tag">{label}</span>
      {sel.text && <span className="txt">{sel.text}</span>}
      {src && <span className="src">{src}</span>}
      {onClear && <button onClick={onClear} title="Remove"><X /></button>}
    </span>
  );
}

function Composer() {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const send = useStore((s) => s.send);
  const interrupt = useStore((s) => s.interrupt);
  const session = useSession();
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const attachments = useStore((s) => s.attachments);
  const addAttachments = useStore((s) => s.addAttachments);
  const removeAttachment = useStore((s) => s.removeAttachment);
  const picking = useStore((s) => s.picking);
  const setPicking = useStore((s) => s.setPicking);
  const dev = useStore((s) => (s.currentSiteId ? s.dev[s.currentSiteId] : null));
  const claudeOk = useStore((s) => !!s.tools && !claudeBlocked(s.tools));
  const busy = !!session?.busy;
  const canPick = dev?.status === "ready";
  const canSend = (text.trim().length > 0 || attachments.length > 0) && claudeOk;
  const [cmdIndex, setCmdIndex] = useState(0);
  const slashMatch = /^\/([\w:-]*)$/.exec(text);
  const commands = session?.commands ?? [];
  const suggestions = slashMatch ? commands.filter((c) => c.toLowerCase().startsWith(slashMatch[1].toLowerCase())).slice(0, 8) : [];
  const pickCommand = (c: string) => { setText(`/${c} `); setCmdIndex(0); ref.current?.focus(); };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [text]);

  useEffect(() => { if (selection || attachments.length) ref.current?.focus(); }, [selection, attachments.length]);

  const submit = () => {
    if (!canSend) return;
    void send(text.trim() || (attachments.length ? "Here is an image." : ""));
    setText("");
  };

  const onFiles = (list: FileList | File[] | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length) void addAttachments(files);
  };

  return (
    <div className="composer">
      <div
        className={cx("box", dragging && "dragging")}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files); }}
      >
        {(selection || attachments.length > 0) && (
          <div className="attach-row">
            {selection && <SelectionChip sel={selection} onClear={() => setSelection(null)} />}
            {attachments.map((a) => (
              <span key={a.id} className="thumb" title={`${a.name} · ${Math.round(a.size / 1024)} KB`}>
                <img src={`data:${a.mediaType};base64,${a.data}`} alt="" />
                <button onClick={() => removeAttachment(a.id)} title="Remove"><X /></button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          value={text}
          placeholder={attachments.length ? "What should Claude do with this image?" : selection ? "What should change about this element?" : "Tell Open what to change…"}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); onFiles(files); } }}
          onKeyDown={(e) => {
            if (suggestions.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setCmdIndex((i) => (i + 1) % suggestions.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setCmdIndex((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); pickCommand(suggestions[Math.min(cmdIndex, suggestions.length - 1)]); return; }
              if (e.key === "Escape") { e.preventDefault(); setText(""); return; }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          rows={1}
        />
        {suggestions.length > 0 && (
          <div className="suggest" role="listbox">
            {suggestions.map((c, i) => (
              <button key={c} role="option" aria-selected={i === cmdIndex} className={cx("suggest-item", i === cmdIndex && "on")} onMouseDown={(e) => { e.preventDefault(); pickCommand(c); }}>/{c}</button>
            ))}
            <div className="suggest-hint">Skills and commands from your Claude Code · Tab to insert</div>
          </div>
        )}
        <div className="bar">
          <button className={cx("icon-btn", picking && "on")} disabled={!canPick} title={canPick ? "Pick an element in the preview (⌘⇧E)" : "Preview must be running to pick"} onClick={() => setPicking(!picking)}><Crosshair /></button>
          <span className="hint">{dragging ? "Drop the image to attach it" : picking ? "Click an element in the preview · Esc to cancel" : busy ? "Claude is working · Enter queues your message · Esc to stop" : "Enter to send · Shift+Enter for a new line · paste or drop an image"}</span>
          <span className="sp" />
          {busy && <button className="send stop" title="Stop" onClick={() => void interrupt()}><Stop /></button>}
          <button className="send" title={busy ? "Queue" : "Send"} disabled={!canSend} onClick={submit}><Send /></button>
        </div>
      </div>
    </div>
  );
}
