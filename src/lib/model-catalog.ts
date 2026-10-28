import { modelBudgetGb, type Hardware } from "./hardware";

export type TaskKey = "chat" | "code" | "reasoning" | "fast";
export const TASKS: { key: TaskKey; label: string; hint: string }[] = [
  { key: "chat", label: "Chat", hint: "General conversation and writing. Used by default." },
  { key: "code", label: "Code", hint: "Used when a message looks like programming or a terminal question." },
  { key: "reasoning", label: "Reasoning", hint: "Used in Problem-solving mode and for puzzles, maths and step-by-step questions." },
  { key: "fast", label: "Quick replies", hint: "A small, fast model for very short messages." },
];

export type CatalogModel = { id: string; task: TaskKey; gb: number; note: string };
/** Ollama library tags. `gb` is the approximate 4-bit download size, which is about what it takes in memory. */
export const CATALOG: CatalogModel[] = [
  { id: "llama3.2:1b", task: "fast", gb: 1.3, note: "Tiny and instant" },
  { id: "llama3.2:3b", task: "fast", gb: 2.0, note: "Small and quick" },
  { id: "qwen2.5:3b", task: "fast", gb: 1.9, note: "Small, good with languages" },
  { id: "qwen2.5:7b", task: "chat", gb: 4.7, note: "Strong all-rounder" },
  { id: "llama3.1:8b", task: "chat", gb: 4.9, note: "Natural conversation" },
  { id: "gemma2:9b", task: "chat", gb: 5.4, note: "Very good writing" },
  { id: "qwen2.5:14b", task: "chat", gb: 9.0, note: "Noticeably smarter" },
  { id: "phi4:14b", task: "chat", gb: 9.1, note: "Strong reasoning for its size" },
  { id: "gemma2:27b", task: "chat", gb: 16, note: "High quality" },
  { id: "qwen2.5:32b", task: "chat", gb: 20, note: "Near the top for local chat" },
  { id: "llama3.3:70b", task: "chat", gb: 43, note: "Best quality, needs a big GPU" },
  { id: "qwen2.5-coder:3b", task: "code", gb: 1.9, note: "Light code helper" },
  { id: "qwen2.5-coder:7b", task: "code", gb: 4.7, note: "Good code model" },
  { id: "qwen2.5-coder:14b", task: "code", gb: 9.0, note: "Strong code model" },
  { id: "qwen2.5-coder:32b", task: "code", gb: 20, note: "Best local code model" },
  { id: "deepseek-r1:7b", task: "reasoning", gb: 4.7, note: "Thinks step by step" },
  { id: "qwen3:8b", task: "reasoning", gb: 5.2, note: "Thinking model" },
  { id: "deepseek-r1:14b", task: "reasoning", gb: 9.0, note: "Stronger step-by-step" },
  { id: "qwen3:14b", task: "reasoning", gb: 9.3, note: "Stronger thinking model" },
  { id: "deepseek-r1:32b", task: "reasoning", gb: 20, note: "Top local reasoning" },
];

/** Memory needed to actually run it: weights plus working space for the conversation. */
export const needGb = (m: CatalogModel): number => Math.round((m.gb * 1.15 + 0.7) * 10) / 10;

export type Fit = "gpu" | "cpu" | "no";
export function fitFor(m: CatalogModel, hw: Hardware): Fit {
  const { gb, onGpu } = modelBudgetGb(hw);
  if (needGb(m) <= gb) return onGpu ? "gpu" : "cpu";
  // Doesn't fit the GPU: it can still run by spilling into system RAM, just slowly.
  if (onGpu && needGb(m) <= hw.ramGb * 0.6) return "cpu";
  return "no";
}

export type Recommendation = { task: TaskKey; model: CatalogModel; fit: Fit };

/** The best model per task that fits. On a GPU that is the largest that fits in VRAM; otherwise the largest that stays comfortably fast. */
export function recommend(hw: Hardware): Recommendation[] {
  const out: Recommendation[] = [];
  for (const { key } of TASKS) {
    const options = CATALOG.filter((m) => m.task === key).sort((a, b) => b.gb - a.gb);
    const fast = options.find((m) => fitFor(m, hw) === (modelBudgetGb(hw).onGpu ? "gpu" : "cpu"));
    const any = fast ?? [...options].reverse().find((m) => fitFor(m, hw) !== "no");
    if (any) out.push({ task: key, model: any, fit: fitFor(any, hw) });
  }
  return out;
}

export function fitLabel(fit: Fit, onGpu: boolean): string {
  if (fit === "gpu") return "fits your GPU";
  if (fit === "cpu") return onGpu ? "too big for your GPU, runs slowly on CPU" : "runs on CPU";
  return "too big for this machine";
}

/** Plain-language reading of a speed test: tokens per second and how much of the model sits on the GPU. */
export function describeBench(tokensPerSec: number, gpuPercent: number | null): string {
  const speed = tokensPerSec >= 30 ? "very fast" : tokensPerSec >= 15 ? "fast" : tokensPerSec >= 6 ? "usable" : "slow";
  const where = gpuPercent === null ? "" : gpuPercent >= 95 ? " Entirely on the GPU." : gpuPercent > 0 ? ` About ${gpuPercent}% on the GPU, the rest on the CPU (this is what slows it down).` : " Running on the CPU only.";
  return `${tokensPerSec} tokens/second (${speed}).${where}`;
}

export type RouteHint = { mode?: string; text?: string; agentId?: string };
export type LocalModels = { localChat: string; localCode: string; localReasoning: string; localFast: string; localAuto: boolean; localPals?: Record<string, string> };

const CODE_RE = /```|\b(function|const|def|class|import|stack ?trace|exception|compile|regex|sql|typescript|javascript|python|bash|docker|git|npm|bun|api|bug|refactor)\b|[{};]\s*$/im;
const REASON_RE = /\b(prove|step[- ]by[- ]step|puzzle|riddle|derive|calculate|math|logic|trade-?offs?|work out)\b/i;

export function pickTask(hint: RouteHint): TaskKey {
  const text = (hint.text ?? "").trim();
  if (CODE_RE.test(text)) return "code";
  if (hint.mode === "solve" || REASON_RE.test(text)) return "reasoning";
  if (text.length > 0 && text.length < 40) return "fast";
  return "chat";
}

export const DEFAULT_LOCAL_MODEL = "qwen2.5:7b";

/** A task set to "auto" lets the server pick the best installed model for it at the moment of the request. */
export const AUTO_MODEL = "auto";
export const autoMarker = (task: TaskKey): string => `auto:${task}`;
export function parseAutoMarker(model: unknown): TaskKey | null {
  const m = typeof model === "string" ? /^auto:(chat|code|reasoning|fast)$/.exec(model) : null;
  return m ? (m[1] as TaskKey) : null;
}

export type Installed = { name: string; gb: number };

/** Which job an installed model is for: the catalog when it knows the model, otherwise its name and size. */
export function taskOfInstalled(m: Installed): TaskKey {
  const known = CATALOG.find((c) => c.id === m.name || `${c.id}` === m.name.replace(/:latest$/, ""));
  if (known) return known.task;
  if (/coder|code/i.test(m.name)) return "code";
  if (/r1|qwen3|qwq|reason|think/i.test(m.name)) return "reasoning";
  return m.gb > 0 && m.gb <= 2.6 ? "fast" : "chat";
}

/**
 * The best model you already have for a task, given this machine. Quick replies get the smallest small model (speed matters);
 * everything else gets the largest model that fits the GPU (or runs comfortably on CPU). A task with no suitable model borrows the Chat choice.
 */
export function bestInstalled(task: TaskKey, installed: Installed[], hw: Hardware | null, avoid?: ReadonlySet<string>): string | null {
  const all = installed.filter((m) => !/embed/i.test(m.name) && m.gb > 0);
  // Models your own benchmarks showed to be failing or too slow are skipped, but only when something else is left to choose.
  const kept = avoid?.size ? all.filter((m) => !avoid.has(m.name)) : all;
  const usable = kept.length ? kept : all;
  if (!usable.length) return null;
  const fits = (m: Installed): Fit => (hw ? fitFor({ id: m.name, task: taskOfInstalled(m), gb: m.gb, note: "" }, hw) : "cpu");
  const preferred: Fit = hw && modelBudgetGb(hw).onGpu ? "gpu" : "cpu";
  const inClass = (t: TaskKey) => usable.filter((m) => taskOfInstalled(m) === t && fits(m) !== "no");
  const pickLargest = (list: Installed[]): Installed | undefined => {
    const good = list.filter((m) => fits(m) === preferred);
    return (good.length ? good : list).sort((a, b) => (good.length ? b.gb - a.gb : a.gb - b.gb))[0];
  };
  if (task === "fast") {
    const small = inClass("fast").sort((a, b) => a.gb - b.gb)[0];
    if (small) return small.name;
    const any = usable.filter((m) => fits(m) !== "no").sort((a, b) => a.gb - b.gb)[0];
    return any ? any.name : null;
  }
  const own = pickLargest(inClass(task));
  if (own) return own.name;
  if (task !== "chat") return bestInstalled("chat", installed, hw, avoid);
  const general = pickLargest(usable.filter((m) => taskOfInstalled(m) !== "code" && fits(m) !== "no"));
  return general ? general.name : null;
}

/** Chooses the model for a turn: the pal's own model if set, else by task. With routing off, or when a task has no model set, the Chat model is used. */
export function pickModel(s: LocalModels, hint: RouteHint): string {
  // A model you assigned to a specific pal always wins.
  const mine = hint.agentId ? s.localPals?.[hint.agentId]?.trim() : "";
  if (mine) return mine;
  const chat = s.localChat.trim() || DEFAULT_LOCAL_MODEL;
  if (!s.localAuto) return chat === AUTO_MODEL ? autoMarker("chat") : chat;
  const task = pickTask(hint);
  const by: Record<TaskKey, string> = { chat: s.localChat, code: s.localCode, reasoning: s.localReasoning, fast: s.localFast };
  const chosen = by[task].trim();
  if (chosen === AUTO_MODEL) return autoMarker(task);
  return chosen || (chat === AUTO_MODEL ? autoMarker("chat") : chat);
}

/** Ollama model names only: letters, digits, dots, dashes, slashes and one tag. */
export const isModelName = (name: unknown): name is string => typeof name === "string" && name.length <= 120 && /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*(:[A-Za-z0-9._-]+)?$/i.test(name);
