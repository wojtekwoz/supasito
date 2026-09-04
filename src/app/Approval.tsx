import { useState } from "react";
import { useStore } from "./store";
import type { Item } from "../agent/transcript";
import { Question, Shield } from "../ui/Icons";
import { cx, relPath } from "../util";

type PermItem = Extract<Item, { kind: "permission" }>;

export function PermissionCard({ item, sessionId }: { item: PermItem; sessionId: string }) {
  const respond = useStore((s) => s.respondPermission);
  const root = useStore((s) => s.sites.find((x) => x.id === s.currentSiteId)?.path ?? "");
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const r = item.request;
  const i = r.input || {};
  const name = r.display_name || r.tool_name;
  const suggestions = (r.permission_suggestions ?? []) as unknown[];

  const allow = (remember: boolean) => void respond(sessionId, item.id, { behavior: "allow", updatedInput: i, ...(remember && suggestions.length ? { updatedPermissions: suggestions } : {}) }, "allowed");
  const deny = () => void respond(sessionId, item.id, { behavior: "deny", message: reason.trim() || "The user declined this action." }, "denied");

  let body: React.ReactNode;
  switch (r.tool_name) {
    case "Bash":
      body = <div className="cmd">{String(i.command ?? "")}</div>;
      break;
    case "Edit":
    case "MultiEdit":
      body = (
        <>
          <div className="desc">{relPath(String(i.file_path ?? ""), root)}</div>
          {"old_string" in i && <div className="diff"><div className="del">{String(i.old_string ?? "").slice(0, 800)}</div><div className="add">{String(i.new_string ?? "").slice(0, 800)}</div></div>}
        </>
      );
      break;
    case "Write":
      body = <><div className="desc">{relPath(String(i.file_path ?? ""), root)}</div><div className="cmd">{String(i.content ?? "").slice(0, 800)}</div></>;
      break;
    default:
      body = <div className="cmd">{JSON.stringify(i, null, 1).slice(0, 800)}</div>;
  }

  return (
    <div className="card permission">
      <div className="h"><Shield className="glyph" />Claude wants to use {name}</div>
      {r.description && <div className="desc">{r.description}</div>}
      {body}
      {item.status === "pending" ? (
        denying ? (
          <div className="actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <input className="text-input" autoFocus placeholder="Tell Claude why, or what to do instead (optional)" value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") deny(); }} />
            <div className="actions"><button className="btn sm primary" onClick={deny}>Deny</button><button className="btn sm ghost" onClick={() => setDenying(false)}>Back</button></div>
          </div>
        ) : (
          <div className="actions">
            <button className="btn sm primary" onClick={() => allow(false)}>Allow</button>
            {suggestions.length > 0 && <button className="btn sm" onClick={() => allow(true)} title="Allow and don't ask again for this kind of action">Always allow</button>}
            <button className="btn sm ghost" onClick={() => setDenying(true)}>Deny…</button>
          </div>
        )
      ) : (
        <div className="settled">{item.status === "allowed" ? "Allowed" : item.status === "denied" ? "Denied" : "No longer needed (the turn ended)"}</div>
      )}
    </div>
  );
}

type Q = { question: string; header?: string; options: { label: string; description?: string }[]; multiSelect?: boolean };

export function QuestionCard({ item, sessionId }: { item: PermItem; sessionId: string }) {
  const respond = useStore((s) => s.respondPermission);
  const questions = ((item.request.input?.questions as Q[] | undefined) ?? []);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  const toggle = (q: Q, label: string) => {
    setAnswers((a) => {
      const cur = a[q.question] ?? [];
      if (q.multiSelect) return { ...a, [q.question]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
      return { ...a, [q.question]: [label] };
    });
  };
  const complete = questions.every((q) => (answers[q.question]?.length ?? 0) > 0 || (other[q.question] ?? "").trim());
  const submit = () => {
    const out: Record<string, string> = {};
    for (const q of questions) {
      const free = (other[q.question] ?? "").trim();
      const picked = answers[q.question] ?? [];
      out[q.question] = free ? (picked.length ? [...picked, free].join(", ") : free) : picked.join(", ");
    }
    void respond(sessionId, item.id, { behavior: "allow", updatedInput: { questions, answers: out } }, "allowed");
  };

  return (
    <div className="card question">
      <div className="h"><Question className="glyph" />Claude has a question</div>
      {questions.map((q) => (
        <div className="q" key={q.question}>
          {q.header && <div className="qh">{q.header}</div>}
          <div>{q.question}</div>
          {q.options.map((o) => (
            <button key={o.label} className={cx("opt", (answers[q.question] ?? []).includes(o.label) && "on")} disabled={item.status !== "pending"} onClick={() => toggle(q, o.label)}>
              <span><span className="l">{o.label}</span>{o.description && <div className="d">{o.description}</div>}</span>
            </button>
          ))}
          {item.status === "pending" && <input className="text-input" placeholder="Or type your own answer" value={other[q.question] ?? ""} onChange={(e) => setOther({ ...other, [q.question]: e.target.value })} />}
        </div>
      ))}
      {item.status === "pending"
        ? <div className="actions"><button className="btn sm primary" disabled={!complete} onClick={submit}>Send answers</button></div>
        : <div className="settled">{item.status === "expired" ? "No longer needed (the turn ended)" : "Answered"}</div>}
    </div>
  );
}
