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

export type RouteHint = { mode?: string; text?: string };
export type LocalModels = { localChat: string; localCode: string; localReasoning: string; localFast: string; localAuto: boolean };

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

/** Chooses the model for a turn. With routing off, or when a task has no model set, the Chat model is used. */
export function pickModel(s: LocalModels, hint: RouteHint): string {
  const chat = s.localChat.trim() || DEFAULT_LOCAL_MODEL;
  if (!s.localAuto) return chat;
  const task = pickTask(hint);
  const by: Record<TaskKey, string> = { chat: s.localChat, code: s.localCode, reasoning: s.localReasoning, fast: s.localFast };
  return by[task].trim() || chat;
}

/** Ollama model names only: letters, digits, dots, dashes, slashes and one tag. */
export const isModelName = (name: unknown): name is string => typeof name === "string" && name.length <= 120 && /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*(:[A-Za-z0-9._-]+)?$/i.test(name);
