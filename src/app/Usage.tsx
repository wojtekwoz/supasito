// Usage, in two senses: how full this conversation is (Claude's context) and how much of the
// Claude plan is used (rate-limit windows). The ring lives in the composer bar; the popover and
// Settings show the details in plain words.
import { useEffect, useRef, useState } from "react";
import { useSession, useStore } from "./store";
import { fmtTokens, type PlanWindow, type SessionState } from "../agent/transcript";
import { ago, cx } from "../util";

export const windowLabel = (name: string) =>
  name === "five_hour" ? "5-hour limit" : name === "seven_day" ? "Weekly limit" : name === "spend_limit" ? "Spend limit" : name.replace(/_/g, " ") + " limit";

/** "resets 4:15 PM" today, "resets Tue 9:00 AM" otherwise. */
export function fmtReset(resetsAt: number | null): string {
  if (!resetsAt) return "";
  const d = new Date(resetsAt * 1000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = d.toDateString() === new Date().toDateString();
  return today ? `resets ${time}` : `resets ${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

const tone = (p: number) => (p >= 0.9 ? "err" : p >= 0.75 ? "warn" : "");
const fmtUsd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

export function Ring({ pct }: { pct: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return (
    <svg className="ring" viewBox="0 0 14 14" aria-hidden>
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      {p > 0 && <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${c * p} ${c}`} strokeLinecap="round" transform="rotate(-90 7 7)" />}
    </svg>
  );
}

function Meter({ pct }: { pct: number }) {
  return <span className={cx("meter", tone(pct))}><i style={{ width: `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%` }} /></span>;
}

/** One line per plan window, with its reset time. Used in the popover and in Settings. */
export function PlanRows({ windows, at }: { windows: PlanWindow[]; at: number | null }) {
  if (windows.length === 0) return <p className="plan-empty">Claude Code reports plan usage while it works; nothing has come in since Supasito started.</p>;
  return (
    <div className="plan-rows">
      {windows.map((w) => (
        <div key={w.name} className="plan-row">
          <span className="k">{windowLabel(w.name)}</span>
          <span className={cx("v", tone(w.utilization))}>{Math.round(w.utilization * 100)}% used</span>
          <span className="r">{fmtReset(w.resetsAt)}</span>
          <Meter pct={w.utilization} />
        </div>
      ))}
      {at != null && <p className="when">Reported by Claude Code {ago(at)}.</p>}
    </div>
  );
}

/** The ring in the composer bar: the one place usage shows. Its fill is the conversation's context; its
 *  colour is the worse of context and plan usage, and a plan window past 75% is named next to it, so a
 *  plan limit is visible without a second indicator. Quiet until either passes half; click for details. */
export function UsageButton() {
  const session = useSession();
  const planUsage = useStore((s) => s.planUsage);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); e.stopPropagation(); setOpen(false); } };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey, true); };
  }, [open]);
  const ctx = session?.context ?? null;
  const own = !!session?.plan.length;
  const windows = own ? session!.plan : planUsage?.windows ?? [];
  if (!ctx && windows.length === 0) return null;
  const pct = ctx ? ctx.used / ctx.window : 0;
  const plan = windows.reduce<PlanWindow | null>((best, w) => (!best || w.utilization > best.utilization ? w : best), null);
  const planPct = plan?.utilization ?? 0;
  const title = [ctx ? `This conversation is ${Math.round(pct * 100)}% full` : null, plan ? `${windowLabel(plan.name)} ${Math.round(planPct * 100)}% used${plan.resetsAt ? `, ${fmtReset(plan.resetsAt)}` : ""}` : null, "click for details"].filter(Boolean).join(" · ");
  return (
    <div className="usage" ref={ref}>
      <button className={cx("usage-btn", tone(Math.max(pct, planPct)), open && "on")} title={title} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ring pct={pct} />
        {pct >= 0.5 && <span>{Math.round(pct * 100)}%</span>}
        {planPct >= 0.75 && <span>plan {Math.round(planPct * 100)}%</span>}
      </button>
      {open && <UsagePopover ctx={ctx} windows={windows} at={own ? null : planUsage?.at ?? null} cost={session?.cost ?? null} resumed={!!session?.resumed} />}
    </div>
  );
}

function UsagePopover({ ctx, windows, at, cost, resumed }: { ctx: SessionState["context"]; windows: PlanWindow[]; at: number | null; cost: SessionState["cost"] | null; resumed: boolean }) {
  const pct = ctx ? ctx.used / ctx.window : 0;
  return (
    <div className="usage-pop" role="dialog" aria-label="Usage">
      <section>
        <h4>This conversation</h4>
        {ctx ? (
          <>
            <div className="row"><span className={cx("big", tone(pct))}>{Math.round(pct * 100)}% of Claude's working memory</span><span className="dim">{fmtTokens(ctx.used)} of {fmtTokens(ctx.window)} tokens</span></div>
            <Meter pct={pct} />
            <p>{pct >= 0.8
              ? "Nearly full. Claude Code will soon summarise older messages to make room, which can lose detail. For the next unrelated change, start a new session (⌘N)."
              : "Fills as the conversation grows and everything Claude reads. When it is full, Claude Code summarises older messages by itself; a new session (⌘N) starts empty."}</p>
          </>
        ) : <p>Known after Claude's first reply in this session.</p>}
      </section>
      <section>
        <h4>Your Claude plan</h4>
        <PlanRows windows={windows} at={at} />
      </section>
      {cost && cost.session > 0 && (
        <section>
          <h4>Cost</h4>
          <div className="row"><span className="big">{fmtUsd(cost.session)}</span><span className="dim">{cost.turns} turn{cost.turns === 1 ? "" : "s"}{resumed ? " since you resumed" : ""} · at API list prices</span></div>
        </section>
      )}
    </div>
  );
}
