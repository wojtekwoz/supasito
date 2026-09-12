// The picker's list as a reader over the fetched catalogue (PLAN §8d.1): run with
// node --experimental-strip-types src/models.test.ts
import { BUILTIN_MODELS, CODEX_DEFAULT, codexDefault, effortsFor, mergeModels, modelOption, modelShort, setModels, supportsFast } from "./models.ts";
import type { Catalogue, CatalogueModel } from "./types.ts";

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => { if (!ok) { failed++; console.error("FAIL", name, info === undefined ? "" : JSON.stringify(info)); } else console.log("ok  ", name); };

const codexRows: CatalogueModel[] = [
  { id: "gpt-6-astra", label: "GPT-6 Astra", hint: "Our most capable model", backend: "codex", isDefault: true, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "medium", fast: true, hidden: false },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", hint: "Ultra-fast", backend: "codex", isDefault: false, efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "high", fast: false, hidden: false },
  { id: "gpt-4.1-retired", label: "Old", hint: "", backend: "codex", isDefault: false, efforts: [], defaultEffort: null, fast: false, hidden: true },
];
const empty: Catalogue = { codex: [], codexAt: 0, served: [], servedAt: 0 };

// never fetched → the built-in list, whole
const floor = mergeModels(null);
check("floor: built-in list when nothing was fetched", floor === BUILTIN_MODELS || JSON.stringify(floor) === JSON.stringify(BUILTIN_MODELS));
check("floor: an empty catalogue is the same", JSON.stringify(mergeModels(empty)) === JSON.stringify(BUILTIN_MODELS));
setModels(floor);
check("floor: Codex default is the constant", codexDefault() === CODEX_DEFAULT);
check("floor: Claude efforts are the five", effortsFor("claude-opus-5").join() === "low,medium,high,xhigh,max");
check("floor: Spark has no fast mode even built in", !supportsFast("gpt-5.3-codex-spark"));

// a live Codex list replaces the Codex half only; hidden rows stay out; Claude rows stay built in
const live = mergeModels({ ...empty, codex: codexRows, codexAt: 1 });
check("live: Claude rows first and unchanged", live.slice(0, 4).every((m, i) => m.value === BUILTIN_MODELS[i].value));
check("live: Codex rows are the fetched ones", live.slice(4).map((m) => m.value).join() === "gpt-6-astra,gpt-5.3-codex-spark");
check("live: hidden row is out", !live.some((m) => m.value === "gpt-4.1-retired"));
setModels(live);
check("live: the default is what Codex marks", codexDefault() === "gpt-6-astra");
check("live: efforts per model", effortsFor("gpt-6-astra").includes("ultra") && !effortsFor("gpt-5.3-codex-spark").includes("ultra") && !effortsFor("gpt-5.3-codex-spark").includes("max"));
check("live: fast from the priority tier", supportsFast("gpt-6-astra") && !supportsFast("gpt-5.3-codex-spark"));
check("live: an unknown GPT id is assumed to offer fast; Opus does; Sonnet does not", supportsFast("gpt-9-nova") && supportsFast("claude-opus-5[1m]") && !supportsFast("claude-sonnet-5"));
check("live: exact id wins over prefix (gpt-5.3-codex-spark is not gpt-5.3)", modelOption("gpt-5.3-codex-spark")?.value === "gpt-5.3-codex-spark");
check("live: a dated Claude id maps to its row", modelOption("claude-haiku-4-5-20251001")?.label === "Haiku 4.5");
check("live: an alias maps to its row", modelOption("opus")?.label === "Opus 5");
check("live: the chip uses the catalogue label for a GPT id, the id's shape for an unknown one", modelShort("gpt-5.3-codex-spark") === "GPT-5.3 Codex Spark" && modelShort("gpt-9-nova") === "GPT-9 Nova");

// the served file carries Claude rows (and may carry Codex rows used only when no live list exists)
const served: CatalogueModel[] = [
  { id: "claude-fable-5-2", label: "Fable 5.2", hint: "new", backend: "claude", fast: false },
  { id: "claude-opus-5", label: "Opus 5", hint: "strong", backend: "claude", fast: true },
  { id: "gpt-7", label: "GPT-7", hint: "served fallback", backend: "codex", fast: true, efforts: ["low", "ultra"] },
];
const withServed = mergeModels({ ...empty, served, servedAt: 1 });
check("served: Claude rows replace the built-in Claude rows", withServed.filter((m) => m.backend === "claude").map((m) => m.value).join() === "claude-fable-5-2,claude-opus-5");
check("served: Codex rows are the served ones when no live list", withServed.filter((m) => m.backend === "codex").map((m) => m.value).join() === "gpt-7");
const both = mergeModels({ codex: codexRows, codexAt: 1, served, servedAt: 1 });
check("both: the live Codex list wins over served Codex rows", both.filter((m) => m.backend === "codex").map((m) => m.value).join() === "gpt-6-astra,gpt-5.3-codex-spark");
setModels(both);
check("both: a served Claude row with fast:false still follows the id rule (Claude fast is Opus)", supportsFast("claude-opus-5"));

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("models: all passed");
