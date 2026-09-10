import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { DRAFT, useSession, useSessionsOfCurrentSite, useSite, useStore } from "./store";
import { retryText, type Item, type SessionState } from "../agent/transcript";
import { EFFORTS, EFFORT_HINTS, MODELS, baseModel, isCodexModel, isEffort, modelShort, supportsFast } from "../models";
import { Markdown } from "../ui/Markdown";
import { Bubble, Collapse, Crosshair, Doc, Globe, Minus, Pen, Robot, Search, Send, Signal, Sparkle, Stop, Terminal, X } from "../ui/Icons";
import { cx, fmtDuration, relPath } from "../util";
import { PermissionCard, QuestionCard } from "./Approval";
import { Checklist, agentBlocked, claudeUsable, codexUsable, nodeTooOld, toolsMissing, toolsWarn } from "./Checklist";
import { UsageButton } from "./Usage";
import type { Selection } from "../types";
import { useShown } from "./ui";

export function SessionPane() {
  const site = useSite();
  const session = useSession();
  const currentSessionId = useStore((s) => s.currentSessionId);
  const sessions = useSessionsOfCurrentSite();
  const tools = useStore((s) => s.tools);
  const interrupt = useStore((s) => s.interrupt);
  const running = useStore((s) => (s.currentSessionId ? !!s.running[s.currentSessionId] : false));
  const title = currentSessionId === DRAFT ? "New session" : sessions.find((s) => s.id === currentSessionId)?.title ?? "Session";
  const full = useStore((s) => s.previewFull);
  const panelPos = useStore((s) => s.panelPos);
  const setPanelPos = useStore((s) => s.setPanelPos);
  const panelMin = useStore((s) => s.panelMin);
  const setPanelMin = useStore((s) => s.setPanelMin);
  const setPreviewFull = useStore((s) => s.setPreviewFull);
  const showKnobs = useShown("knobs");
  const pane = useRef<HTMLElement>(null);
  // A dragged panel stays inside the window when it grows (a reply arriving) or the window shrinks.
  useEffect(() => {
    const el = pane.current;
    if (!full || !panelPos || !el) return;
    const keep = () => { const pos = useStore.getState().panelPos; if (pos) setPanelPos(clampPanel(pos, el)); };
    const ro = new ResizeObserver(keep);
    ro.observe(el);
    window.addEventListener("resize", keep);
    return () => { ro.disconnect(); window.removeEventListener("resize", keep); };
  }, [full, !!panelPos, setPanelPos]);
  const onGrip = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = pane.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, left: r.left, bottom: window.innerHeight - r.bottom };
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    // The iframe under the pointer must not swallow the move events.
    document.body.classList.add("panel-drag");
    const move = (ev: PointerEvent) => setPanelPos(clampPanel({ left: start.left + ev.clientX - start.x, bottom: start.bottom - (ev.clientY - start.y) }, el));
    const up = () => { document.body.classList.remove("panel-drag"); grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up); };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  };

  if (!site) return <Welcome />;
  return (
    <section className={cx("pane session", full && panelMin && "min")} ref={pane} style={full && panelPos ? { left: panelPos.left, bottom: panelPos.bottom } : undefined}>
      <div className="titlebar drag" data-tauri-drag-region>
        <span className="title" data-tauri-drag-region>{title}</span>
        {session?.busy && <button className="btn sm ghost" onClick={() => void interrupt()} title="Interrupt (Esc)"><Stop /> Stop</button>}
      </div>
      {/* In full-width mode the pane floats; this grip along its top edge drags it, a double-click sends it back to the corner. Its
          two buttons minimise the panel to a pill and leave full-width mode. */}
      {full && !panelMin && (
        <div className="grip" title="Drag to move · double-click to put it back" onPointerDown={onGrip} onDoubleClick={() => setPanelPos(null)}>
          <i />
          <span className="tools" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" title="Minimise the conversation" onClick={() => setPanelMin(true)}><Minus /></button>
            <button className="icon-btn" title="Back to the sidebar and conversation (⌘\ or Esc)" onClick={() => setPreviewFull(false)}><Collapse /></button>
          </span>
        </div>
      )}
      {full && panelMin && (
        <button className="restore" title="Show the conversation" onClick={() => setPanelMin(false)}>
          <Bubble />
          <span className={cx("status-dot", session?.busy && "busy")} style={session?.items.some((i) => i.kind === "permission" && i.status === "pending") ? { background: "var(--warn)" } : undefined} />
        </button>
      )}
      {agentBlocked(tools)
        ? <Setup />
        : <Transcript items={session?.items ?? []} busy={!!session?.busy} root={site.path} sessionId={currentSessionId} />}
      <Composer />
      {/* The session's knobs are the last thing in the pane, under the composer: model, effort, permission mode, fast mode. */}
      {showKnobs && currentSessionId && !agentBlocked(tools) && (
        <div className="knobs">
          <Knobs session={session} mode={currentSessionId !== DRAFT && running ? session?.mode ?? null : undefined} />
        </div>
      )}
    </section>
  );
}

const MODES: { value: string; label: string; hint: string }[] = [
  { value: "acceptEdits", label: "Ask before commands", hint: "Edits files freely; asks before running commands" },
  { value: "bypassPermissions", label: "Don't ask this session", hint: "Runs everything without asking. Use on sites you can restore." },
  { value: "plan", label: "Plan first", hint: "Explores and proposes a plan before changing anything" },
  { value: "default", label: "Ask about everything", hint: "Asks before edits and commands" },
];

/** A chip that opens a native dropdown: an icon (or a word) names the setting, `label` is its current value.
 *  The chip draws itself so it hugs the value; the real select sits invisibly on top and only supplies the menu
 *  (a visible native select would be as wide as its longest option). */
/** Keeps the floating panel inside the window: 16 px from the edges, below the preview toolbar. */
function clampPanel(pos: { left: number; bottom: number }, el: HTMLElement): { left: number; bottom: number } {
  const m = 16;
  const toolbar = document.querySelector(".preview .titlebar")?.getBoundingClientRect().bottom ?? 44;
  const left = Math.round(Math.min(Math.max(m, pos.left), Math.max(m, window.innerWidth - m - el.offsetWidth)));
  const bottom = Math.round(Math.min(Math.max(m, pos.bottom), Math.max(m, window.innerHeight - toolbar - m - el.offsetHeight)));
  return left === pos.left && bottom === pos.bottom ? pos : { left, bottom };
}

function Pick({ icon, word, label, title, value, disabled, onChange, children }: { icon?: ReactNode; word?: string; label: string; title: string; value: string; disabled?: boolean; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className={cx("chip pick", disabled && "disabled")} title={title}>
      {icon ?? <span className="word">{word}</span>}
      <span className="val">{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={word ?? title}>{children}</select>
    </label>
  );
}

function ModeSelect({ mode }: { mode: string | null }) {
  const setSessionMode = useStore((s) => s.setSessionMode);
  const current = MODES.find((m) => m.value === mode) ?? MODES[0];
  return (
    <Pick word="Mode" label={current.label} title={`Permissions: ${current.hint}`} value={current.value} onChange={(v) => void setSessionMode(v)}>
      {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
    </Pick>
  );
}

/** Model, effort and fast mode for this session. What the CLI reported (system/init) wins over what Supasito
 *  asked for; a draft shows the defaults it will start with. Changes wait for an idle session. */
function Knobs({ session, mode }: { session: SessionState | null; mode?: string | null }) {
  const settings = useStore((s) => s.settings);
  const tools = useStore((s) => s.tools);
  const defaults = useStore((s) => s.tools?.claude.defaults ?? null);
  // Only the models whose agent is installed and signed in; with one agent the list is just its models.
  const offered = MODELS.filter((m) => (isCodexModel(m.value) ? codexUsable(tools) : claudeUsable(tools)));
  const claudeDefault = claudeUsable(tools) ? `your Claude Code default${defaults?.model ? ` (${defaults.model})` : ""}` : "Codex's default (GPT-5.6 Sol)";
  const setModel = useStore((s) => s.setSessionModel);
  const setEffort = useStore((s) => s.setSessionEffort);
  const setFast = useStore((s) => s.setSessionFast);
  const busy = !!session?.busy;
  const o = session?.overrides ?? {};
  // A running session on one backend must not show the other backend's default (a Claude session while the
  // Settings default is a GPT model): the process ignores that model, so the chip says "default" instead.
  const codex = session?.backend === "codex";
  const settingsFits = !session?.loaded || !settings.model || isCodexModel(settings.model) === codex;
  const model = session?.model ?? o.model ?? (settingsFits ? settings.model : null) ?? (codex ? null : defaults?.model) ?? null;
  const effort = o.effort ?? settings.effort ?? null;
  const fastState = session?.fast?.state ?? null;
  const fastOn = fastState ? fastState !== "off" : !!(o.fastMode ?? settings.fastMode);
  const options = [...(model && !offered.some((m) => m.value === model) ? [{ value: model, label: modelShort(model) }] : []), ...offered];
  const wait = busy ? " Wait for the turn to finish to change it." : "";
  const fastTitle = fastState === "cooldown"
    ? "Fast mode is cooling down after a rate limit; Claude Code returns to it by itself."
    : fastOn
      ? `Fast mode is on: same model, up to 2.5× faster output, about twice the cost. Click to turn it off.${wait}`
      : `Turn on fast mode: same model, up to 2.5× faster output, about twice the cost.${session?.fast?.reason ? ` Claude Code reports: ${session.fast.reason}.` : ""}${wait}`;
  return (
    <>
      <Pick icon={<Robot className="glyph" />} label={model ? modelShort(model) : "default"} title={`Model${model ? `: ${model}` : `: ${claudeDefault}`}.${wait}`} value={model ?? ""} disabled={busy} onChange={(v) => void setModel(v)}>
        {!model && <option value="">default</option>}
        {options.map((m) => <option key={m.value} value={m.value}>{m.value === model ? modelShort(m.value) : `${m.label} · ${m.value}`}</option>)}
      </Pick>
      <Pick icon={<Signal className="glyph" />} label={effort ?? "default"} title={`Effort: how long Claude thinks before answering. ${isEffort(effort) ? EFFORT_HINTS[effort] : `Your Claude Code default${defaults?.effort ? ` (${defaults.effort})` : ""}.`}${wait}`} value={effort ?? ""} disabled={busy} onChange={(v) => void setEffort(v || null)}>
        <option value="">default</option>
        {EFFORTS.map((l) => <option key={l} value={l}>{l}</option>)}
      </Pick>
      {mode !== undefined && <ModeSelect mode={mode} />}
      {supportsFast(model) && (
        <button className={cx("chip toggle", fastOn && "ok")} disabled={busy} title={fastTitle} onClick={() => void setFast(!fastOn)}>
          Fast · {fastState === "cooldown" ? "cooling down" : fastOn ? "on" : "off"}
        </button>
      )}
    </>
  );
}

/** Shown instead of the transcript while no agent can run: neither Claude Code nor Codex is installed and signed in. */
function Setup() {
  const tools = useStore((s) => s.tools);
  const installed = [tools?.claude.ok ? "Claude Code" : null, tools?.codex?.ok ? "Codex" : null].filter(Boolean) as string[];
  const signedOut = installed.length > 0;
  return (
    <div className="welcome">
      <div className="box wide" style={{ textAlign: "left" }}>
        <h2>{signedOut ? `Sign in to ${installed.join(" or ")}` : "Supasito needs Claude Code or Codex"}</h2>
        <p>Supasito drives the coding agent you already use, with your own subscription: Claude Code (Anthropic) or Codex (OpenAI) — either one is enough. {signedOut ? `${installed.join(" and ")} ${installed.length > 1 ? "are" : "is"} installed but not signed in on this Mac.` : "Neither is on this Mac yet, or on the PATH."} Follow a line below, then check again.</p>
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
  const warn = toolsWarn(tools);
  return (
    <section className="pane session">
      <div className="titlebar drag" data-tauri-drag-region />
      <div className="welcome">
        <div className={cx("box", (missing || warn) && "wide")}>
          {missing || warn ? (
            <>
              <h2>Before you start</h2>
              <p>Supasito builds sites with tools already on your Mac. {missing ? "Get the missing ones, then check again." : "One of them needs a minute of setup, or Publish will stop later."}</p>
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
            <button className="btn" onClick={() => openNewSite(true)} disabled={!!tools && (!tools.node.ok || nodeTooOld(tools))} title={tools && !tools.node.ok ? "Needs Node.js" : tools && nodeTooOld(tools) ? "Needs a newer Node.js" : undefined}>New site</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Transcript({ items, busy, root, sessionId }: { items: Item[]; busy: boolean; root: string; sessionId: string | null }) {
  const retry = useStore((s) => (sessionId ? s.transcripts[sessionId]?.retry ?? null : null));
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // The floating panel in full-width mode is much shorter, and a minimised one hides the transcript (which forgets its scroll
  // position), so its end must be re-stuck when the layout changes.
  const full = useStore((s) => s.previewFull);
  const min = useStore((s) => s.panelMin);
  const showSteps = useShown("steps");
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
  }, [items, busy, full, min]);

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
      {groups.map((g, i) => Array.isArray(g)
        ? (showSteps ? <Steps key={"g" + i} items={g} root={root} /> : null)
        : <Entry key={g.id} item={g} sessionId={sessionId} />)}
      {busy && !items.some((i) => i.kind === "assistant" && i.streaming) && !items.some((i) => i.kind === "permission" && i.status === "pending") && (
        <div className="step" style={{ color: retry ? "var(--warn)" : "var(--ink-3)" }}><span className="st running" /><span className="label">{retry ? retryText(retry) : "Working…"}</span></div>
      )}
    </div>
  );
}

const Entry = memo(function Entry({ item, sessionId }: { item: Item; sessionId: string | null }) {
  const showThinking = useShown("thinking");
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
    case "assistant": {
      // While the reasoning streams it is shown open; once the answer starts it folds into a "Thinking" row.
      const live = item.streaming && !item.text;
      return (
        <div className="msg assistant">
          {!showThinking ? null : live && item.phase === "thinking"
            ? <div className="thinking live"><span className="thinking-label">Thinking…</span>{item.thinking && <div className="thinking-body">{item.thinking}</div>}</div>
            : item.thinking ? <details className="thinking"><summary>Thinking</summary><div className="thinking-body">{item.thinking}</div></details> : null}
          <Markdown text={item.text} />
          {live && item.phase !== "thinking" && <span className="caret" />}
        </div>
      );
    }
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
  const sessionModel = useStore((s) => (sessionId ? s.transcripts[sessionId]?.model ?? null : null));
  const n = item.files.length;
  const canUndo = isGit && n > 0 && !item.undone && item.at > committedAt;
  // the model is named when it differs from the session's, or when several ran (subagents); "fast" when the request ran in fast mode
  const modelBit = item.models.length > 1 ? item.models.map(modelShort).join(" + ") : item.models[0] && (!sessionModel || baseModel(item.models[0]) !== baseModel(sessionModel)) ? modelShort(item.models[0]) : null;
  const label = item.isError
    ? item.text
    : [item.stopped ? "Stopped" : "Done", item.durationMs != null && fmtDuration(item.durationMs), item.costUsd != null && item.costUsd > 0 && `$${item.costUsd.toFixed(3)}`, modelBit, item.speed === "fast" && "fast"].filter(Boolean).join(" · ");
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
  const claudeOk = useStore((s) => !!s.tools && !agentBlocked(s.tools));
  const showPick = useShown("composerPick");
  const showUsage = useShown("usage");
  const showHint = useShown("hint");
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
  // Full-width mode is entered to keep talking, so the composer takes the keyboard; so does restoring a minimised panel.
  const full = useStore((s) => s.previewFull);
  const min = useStore((s) => s.panelMin);
  useEffect(() => { if (full && !min) ref.current?.focus(); }, [full, min]);

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
          placeholder={attachments.length ? "What should Claude do with this image?" : selection ? "What should change about this element?" : "Tell Supasito what to change…"}
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
          {showPick && <button className={cx("icon-btn", picking && "on")} disabled={!canPick} title={canPick ? "Pick an element in the preview (⌘⇧E)" : "Preview must be running to pick"} onClick={() => setPicking(!picking)}><Crosshair /></button>}
          {/* A hidden hint still speaks up while something transient is going on: a drop or a pick in progress. */}
          {(showHint || dragging || picking) && <span className="hint">{dragging ? "Drop the image to attach it" : picking ? "Click an element in the preview · Esc to cancel" : busy ? "Claude is working · Enter queues your message · Esc to stop" : "Enter to send · Shift+Enter for a new line · paste or drop an image"}</span>}
          <span className="sp" />
          {showUsage && <UsageButton />}
          {busy && <button className="send stop" title="Stop" onClick={() => void interrupt()}><Stop /></button>}
          <button className="send" title={busy ? "Queue" : "Send"} disabled={!canSend} onClick={submit}><Send /></button>
        </div>
      </div>
    </div>
  );
}
