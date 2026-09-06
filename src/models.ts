// The models Open offers and helpers shared by Settings, the session header and turn lines.
// Ids and aliases are what Claude Code 2.1.x accepts for `--model`; the CLI resolves an alias and
// reports the exact id in system/init (e.g. haiku → claude-haiku-4-5-20251001).
export type ModelOption = { value: string; label: string; hint: string };

export const MODELS: ModelOption[] = [
  { value: "claude-fable-5-1", label: "Fable 5.1", hint: "most capable" },
  { value: "claude-opus-5", label: "Opus 5", hint: "strong; the only one with fast mode" },
  { value: "claude-sonnet-5", label: "Sonnet 5", hint: "fast and cheaper, good for most edits" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5", hint: "cheapest, for small copy changes" },
];

/** What the aliases resolve to on Claude Code 2.1.x (docs, 2026-09). Used only for labels; the CLI reports the real id. */
const ALIASES: Record<string, string> = { fable: "claude-fable-5-1", best: "claude-fable-5-1", opus: "claude-opus-5", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5" };

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
export const isEffort = (v: unknown): v is Effort => typeof v === "string" && (EFFORTS as readonly string[]).includes(v);
export const EFFORT_HINTS: Record<Effort, string> = {
  low: "quick edits, least thinking",
  medium: "everyday changes",
  high: "the usual default; careful work",
  xhigh: "hard problems, slower",
  max: "thinks as long as it wants; slowest and dearest",
};

/** `claude-sonnet-5[1m]` → `claude-sonnet-5`; aliases stay as typed. */
export const baseModel = (m: string) => m.replace(/\[1m\]$/i, "");
export const hasLongContext = (m: string) => /\[1m\]$/i.test(m);

/** Short form for chips and turn lines: `claude-haiku-4-5-20251001` → `haiku-4-5`, `claude-opus-5[1m]` → `opus-5 · 1M`. */
export function modelShort(id: string): string {
  const base = baseModel(id).replace(/^claude-/, "").replace(/-\d{8}$/, "");
  return hasLongContext(id) ? `${base} · 1M` : base;
}

/** The catalogue entry an id or alias belongs to, if any (`claude-haiku-4-5-20251001` → Haiku 4.5). */
export function modelOption(id: string | null | undefined): ModelOption | null {
  if (!id) return null;
  const base = ALIASES[baseModel(id).toLowerCase()] ?? baseModel(id);
  return MODELS.find((m) => base === m.value || base.startsWith(m.value + "-")) ?? null;
}

/** Fast mode exists for Opus 5 and Opus 4.8 only (Claude Code docs; verified on 2.1.257, where the CLI switches it off on other models). */
export const supportsFast = (id: string | null | undefined) => !!id && /opus/i.test(id);
