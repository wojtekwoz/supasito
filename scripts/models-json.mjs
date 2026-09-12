// Writes the served model catalogue (models.json) from the built-in list in src/models.ts, in the shape
// src-tauri/src/models.rs reads: { models: [{ id, label, hint, backend, isDefault, efforts, defaultEffort, fast }] }.
// `pnpm release` runs it; the file goes next to latest.json on supasito.com and in the GitHub release.
//   node --experimental-strip-types --no-warnings scripts/models-json.mjs [out-path]      (default: release/models.json)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const { BUILTIN_MODELS } = await import("../src/models.ts");
const out = process.argv[2] ?? "release/models.json";
const models = BUILTIN_MODELS.map((m) => ({
  id: m.value, label: m.label, hint: m.hint, backend: m.backend, isDefault: !!m.isDefault,
  efforts: m.efforts ?? [], defaultEffort: m.defaultEffort ?? null, fast: typeof m.fast === "boolean" ? m.fast : /opus/i.test(m.value) || m.backend === "codex",
}));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ models, generated: new Date().toISOString() }, null, 2) + "\n");
console.log(`Model catalogue: ${out} (${models.length} models)`);
