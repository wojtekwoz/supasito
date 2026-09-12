// The models Supasito offers and helpers shared by Settings, the session header and turn lines.
// The list is read from the catalogue the backend fetches (PLAN §8d.1: Codex's from `model/list`, Claude's
// from the served models.json); BUILTIN_MODELS is the floor shown when nothing was ever fetched. Claude ids
// and aliases are what Claude Code 2.1.x accepts for `--model`; the CLI resolves an alias and reports the
// exact id in system/init (e.g. haiku → claude-haiku-4-5-20251001).
import type { Catalogue, CatalogueModel } from "./types";

export type Backend = "claude" | "codex";
export type ModelOption = {
  value: string; label: string; hint: string; backend: Backend;
  /** What a session on this backend runs on when no model was chosen (Codex's `isDefault`). */
  isDefault?: boolean;
  /** The efforts this model accepts; missing = the backend's fixed list (`EFFORTS`). */
  efforts?: string[];
  defaultEffort?: string | null;
  /** Fast mode exists for this model; missing = decided from the id (`supportsFast`). */
  fast?: boolean;
};

/** The floor. Codex rows from `model/list` on codex-cli 0.154.0 (2026-09-12); Claude rows from the Claude Code docs (2026-09). */
export const BUILTIN_MODELS: ModelOption[] = [
  { value: "claude-fable-5-1", label: "Fable 5.1", hint: "most capable", backend: "claude" },
  { value: "claude-opus-5", label: "Opus 5", hint: "strong; the only one with fast mode", backend: "claude" },
  { value: "claude-sonnet-5", label: "Sonnet 5", hint: "fast and cheaper, good for most edits", backend: "claude" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5", hint: "cheapest, for small copy changes", backend: "claude" },
  { value: "gpt-6-astra", label: "GPT-6 Astra", hint: "Codex; most capable, for demanding work", backend: "codex", isDefault: true, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], fast: true },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", hint: "Codex; the everyday workhorse", backend: "codex", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], fast: true },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", hint: "Codex; balanced coding model", backend: "codex", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], fast: true },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", hint: "Codex; fast and affordable", backend: "codex", efforts: ["low", "medium", "high", "xhigh", "max"], fast: true },
  { value: "gpt-5.5", label: "GPT-5.5", hint: "Codex; the previous generation", backend: "codex", efforts: ["low", "medium", "high", "xhigh"], fast: true },
  { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", hint: "Codex; ultra-fast, no fast mode", backend: "codex", efforts: ["low", "medium", "high", "xhigh"], fast: false },
];

/** What a Codex session runs on when no model was chosen and the catalogue was never fetched (mirrors `DEFAULT_MODEL`
 *  in codex.rs). The fetched list's `isDefault` wins (`codexDefault`). */
export const CODEX_DEFAULT = "gpt-6-astra";
/** An OpenAI model id means the session runs on Codex, not Claude Code (mirrors `is_codex_model` in codex.rs). */
export const isCodexModel = (id: string | null | undefined) => !!id && /^(gpt-|o3|o4)|codex/i.test(id.trim());
const backendOfId = (id: string): Backend => (isCodexModel(id) ? "codex" : "claude");

const toOption = (m: CatalogueModel): ModelOption => ({
  value: m.id, label: m.label || m.id, hint: m.hint ?? "", backend: m.backend === "codex" || (!m.backend && isCodexModel(m.id)) ? "codex" : "claude",
  isDefault: !!m.isDefault, efforts: m.efforts?.length ? m.efforts : undefined, defaultEffort: m.defaultEffort ?? null, fast: typeof m.fast === "boolean" ? m.fast : undefined,
});

/** The picker's list from what was fetched: Codex rows live from `model/list` (else the served file's, else built-in);
 *  Claude rows from the served file (else built-in). Hidden rows stay out. Order: Claude first, as always. */
export function mergeModels(cat: Catalogue | null | undefined): ModelOption[] {
  const served = (cat?.served ?? []).filter((m) => m.id && !m.hidden).map(toOption);
  const codexLive = (cat?.codex ?? []).filter((m) => m.id && !m.hidden).map(toOption);
  const claude = served.filter((m) => m.backend === "claude");
  const codex = codexLive.length ? codexLive : served.filter((m) => m.backend === "codex");
  return [
    ...(claude.length ? claude : BUILTIN_MODELS.filter((m) => m.backend === "claude")),
    ...(codex.length ? codex : BUILTIN_MODELS.filter((m) => m.backend === "codex")),
  ];
}

// The list the helpers below read. The store sets it whenever the catalogue changes; components re-render
// through the store's own `models` field, so this only has to be current, not reactive.
let current: ModelOption[] = BUILTIN_MODELS;
export function setModels(list: ModelOption[]) { current = list; }
export const currentModels = () => current;

/** The Codex default as the fetched list marks it, else the constant. */
export const codexDefault = () => current.find((m) => m.backend === "codex" && m.isDefault)?.value ?? CODEX_DEFAULT;

/** What the aliases resolve to on Claude Code 2.1.x (docs, 2026-09). Used only for labels; the CLI reports the real id. */
const ALIASES: Record<string, string> = { fable: "claude-fable-5-1", best: "claude-fable-5-1", opus: "claude-opus-5", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5" };

/** Claude Code's efforts; `ultra` is Codex's extra step (some GPT models list it). */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const ALL_EFFORTS = [...EFFORTS, "ultra"] as const;
export type Effort = (typeof ALL_EFFORTS)[number];
export const isEffort = (v: unknown): v is Effort => typeof v === "string" && (ALL_EFFORTS as readonly string[]).includes(v);
export const EFFORT_HINTS: Record<Effort, string> = {
  low: "quick edits, least thinking",
  medium: "everyday changes",
  high: "the usual default; careful work",
  xhigh: "hard problems, slower",
  max: "thinks as long as it wants; slowest and dearest",
  ultra: "Codex only: maximum reasoning, delegates sub-tasks by itself",
};
/** The efforts a model takes: its own list when the catalogue has one, else Claude Code's five. */
export function effortsFor(id: string | null | undefined): readonly string[] {
  const own = modelOption(id)?.efforts;
  if (own?.length) return own;
  return isCodexModel(id) ? ALL_EFFORTS : EFFORTS;
}

/** `claude-sonnet-5[1m]` → `claude-sonnet-5`; aliases stay as typed. */
export const baseModel = (m: string) => m.replace(/\[1m\]$/i, "");
export const hasLongContext = (m: string) => /\[1m\]$/i.test(m);

/** Short form for chips and turn lines: `claude-haiku-4-5-20251001` → `haiku-4-5`, `claude-opus-5[1m]` → `opus-5 · 1M`. */
export function modelShort(id: string): string {
  if (isCodexModel(id)) return modelOption(id)?.label ?? id.replace(/^gpt-/i, "GPT-").replace(/-(\w)/g, (_, c: string) => `-${c.toUpperCase()}`).replace(/^GPT-(\S+?)-([A-Z])/, "GPT-$1 $2");
  const base = baseModel(id).replace(/^claude-/, "").replace(/-\d{8}$/, "");
  return hasLongContext(id) ? `${base} · 1M` : base;
}

/** The catalogue entry an id or alias belongs to, if any (`claude-haiku-4-5-20251001` → Haiku 4.5). */
export function modelOption(id: string | null | undefined, list: ModelOption[] = current): ModelOption | null {
  if (!id) return null;
  const base = ALIASES[baseModel(id).toLowerCase()] ?? baseModel(id);
  return list.find((m) => base === m.value) ?? list.find((m) => base.startsWith(m.value + "-")) ?? null;
}

/** Fast mode: Opus 5 and 4.8 on Claude (docs; verified on 2.1.257, where the CLI switches it off elsewhere); on Codex the
 *  models whose `model/list` row offers the `priority` tier — every one on 0.154.0 except Codex Spark. An unknown GPT id is assumed to. */
export function supportsFast(id: string | null | undefined): boolean {
  if (!id) return false;
  const own = modelOption(id)?.fast;
  if (typeof own === "boolean" && backendOfId(id) === "codex") return own;
  return isCodexModel(id) || /opus/i.test(id);
}
