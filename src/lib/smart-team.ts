/**
 * Smart Team: a discussion mode that only calls as many pals as the question needs.
 * Everything here is plain deterministic code (no model call decides who speaks), so planning costs nothing and tests exactly.
 *
 *   simple question          -> one pal answers
 *   problem / system / code  -> specialist, then coder (if a fix or code is needed), then reviewer (if risky), then coordinator
 *
 * Turns run one after another (one model on the GPU at a time). Each turn gets a short hand-off of what the earlier turns found.
 */
export type SmartRole = "specialist" | "coder" | "reviewer" | "coordinator";
export const SMART_ROLES: SmartRole[] = ["specialist", "coder", "reviewer", "coordinator"];
export type TaskKind = "simple" | "system" | "code" | "plan" | "general";

export type TaskProfile = { kind: TaskKind; wantsFix: boolean; risky: boolean; complex: boolean };

const SYSTEM = /\b(docker|container|compose|unraid|server|network|dns|ssl|tls|nginx|proxy|port|disk|drive|array|parity|ram|gpu|vram|cpu|log|logs|boot|crash|restart|reboot|permission|mount|share|ssh|vpn|router|firewall|systemd|kernel|driver|plex|ollama|portainer|tailscale)\b/i;
const CODE = /\b(code|bug|error|exception|stack ?trace|function|script|regex|sql|api|typescript|javascript|python|bash|shell|compile|build|test|refactor|class|import|npm|pip|git)\b|```/i;
const FIX = /\b(fix|solve|repair|resolve|why (is|does|won'?t|isn'?t|can'?t)|not working|doesn'?t work|won'?t|keeps? (restarting|crashing|failing)|fails?|broken|how (do|can|to) i)\b/i;
const RISK = /\b(delete|remove|wipe|format|drop|rm\s|chmod|chown|force|reset|overwrite|migrate|upgrade|downgrade|production|data loss|backup|parity|rebuild|prune|kill)\b/i;
const PLAN = /\b(plan|roadmap|strategy|schedule|organi[sz]e|steps to|compare|decide|should i|trade-?offs?|pros and cons)\b/i;

export function profileTask(text: string): TaskProfile {
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  const system = SYSTEM.test(t), code = CODE.test(t), plan = PLAN.test(t) && words >= 8, fix = FIX.test(t), risky = RISK.test(t);
  const kind: TaskKind = system ? "system" : code ? "code" : plan ? "plan" : "general";
  // A short question with no technical signal is simple: one pal is enough.
  const technical = system || code || fix || risky;
  const complex = (technical && (words >= 8 || (system && code) || risky)) || (plan && words >= 14);
  return { kind: complex || technical || plan ? kind : "simple", wantsFix: fix || code, risky, complex };
}

export type SmartConfig = {
  /** Never more pals than this speak (including the coordinator). 1-6. */
  maxTurns: number;
  /** Stop starting new turns after this many seconds. */
  maxSeconds: number;
  /** Always use one pal, even for hard questions. */
  singleOnly: boolean;
  /** Force-pick who plays a role; "auto" lets the app choose. */
  assign: Partial<Record<SmartRole, string>>;
};
export const defaultSmartConfig: SmartConfig = { maxTurns: 4, maxSeconds: 180, singleOnly: false, assign: {} };

export function cleanSmartConfig(v: unknown): SmartConfig {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d);
  const assign: SmartConfig["assign"] = {};
  const a = o["assign"] && typeof o["assign"] === "object" ? (o["assign"] as Record<string, unknown>) : {};
  for (const r of SMART_ROLES) if (typeof a[r] === "string" && a[r] && a[r] !== "auto") assign[r] = a[r] as string;
  return { maxTurns: num(o["maxTurns"], 1, 6, defaultSmartConfig.maxTurns), maxSeconds: num(o["maxSeconds"], 20, 900, defaultSmartConfig.maxSeconds), singleOnly: o["singleOnly"] === true, assign };
}

/** Which pal tends to suit which role (by id); anyone seated can fill in. */
const PREFER: Record<SmartRole, string[]> = {
  specialist: ["byte", "sage", "nova"],
  coder: ["byte", "pip", "nova"],
  reviewer: ["sage", "pip", "nova"],
  coordinator: ["nova", "sage", "byte"],
};

export type SmartStep = { agentId: string; role: SmartRole };
export type SmartPlan = { steps: SmartStep[]; single: boolean; profile: TaskProfile; why: string };

/** Who speaks, in order. `mentioned` (an @pal in the message) always takes the single-pal answer. */
export function planSmartTeam(o: { text: string; seated: string[]; config?: SmartConfig; mentioned?: string | null }): SmartPlan {
  const config = o.config ?? defaultSmartConfig;
  const profile = profileTask(o.text);
  const seated = [...new Set(o.seated)];
  if (!seated.length) return { steps: [], single: true, profile, why: "nobody is seated" };
  const pick = (role: SmartRole, used: Set<string>): string => {
    const forced = config.assign[role];
    if (forced && seated.includes(forced)) return forced;
    const free = seated.filter((id) => !used.has(id));
    const pool = free.length ? free : seated;
    return PREFER[role].find((id) => pool.includes(id)) ?? pool[0]!;
  };
  const one = (why: string): SmartPlan => ({ steps: [{ agentId: o.mentioned && seated.includes(o.mentioned) ? o.mentioned : pick("specialist", new Set()), role: "specialist" }], single: true, profile, why });
  if (config.singleOnly || config.maxTurns <= 1) return one(config.singleOnly ? "single-pal setting is on" : "turn limit is 1");
  if (profile.kind === "simple" || seated.length === 1) return one(seated.length === 1 ? "only one pal is seated" : "a simple question needs one pal");
  const roles: SmartRole[] = ["specialist"];
  if (profile.wantsFix || profile.complex) roles.push("coder");
  if (profile.risky || (profile.complex && profile.wantsFix)) roles.push("reviewer");
  roles.push("coordinator");
  // Trim to the turn limit: the reviewer goes first, then the coder; the specialist and coordinator always stay.
  for (const drop of ["reviewer", "coder"] as const) if (roles.length > config.maxTurns && roles.includes(drop)) roles.splice(roles.indexOf(drop), 1);
  const used = new Set<string>();
  const steps = roles.map((role) => { const agentId = pick(role, used); used.add(agentId); return { agentId, role }; });
  return { steps, single: false, profile, why: `${profile.kind} question${profile.risky ? " with risky steps" : ""}: ${roles.join(" -> ")}` };
}

/** Skip the reviewer when nothing risky or code-like has been proposed yet, and skip the coordinator when only one pal spoke. */
export function shouldRun(step: SmartStep, plan: SmartPlan, done: { role: SmartRole; text: string }[]): boolean {
  if (plan.single) return true;
  if (step.role === "coordinator") return done.length >= 2 || (done.length === 1 && done[0]!.text.length > 600);
  if (step.role === "reviewer") return plan.profile.risky || done.some((d) => /```|\b(rm|chmod|chown|docker (rm|stop|kill|system)|dd |mkfs|drop table|--force|-f\b)/i.test(d.text));
  return true;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
/** 0..1 word overlap between two replies, to catch a pal repeating what was already said. */
export function similarity(a: string, b: string): number {
  const A = new Set(squash(a)), B = new Set(squash(b));
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}
export const isRepeat = (text: string, earlier: string[], limit = 0.8): boolean => earlier.some((e) => similarity(text, e) >= limit);

/** The structured hand-off passed to the next turn: one short block per earlier turn, newest last, bounded in size. */
export function buildHandoff(done: { role: SmartRole; name: string; text: string }[], maxChars = 1800): string {
  if (!done.length) return "";
  const per = Math.max(200, Math.floor(maxChars / done.length));
  return done.map((d) => `[${d.role} - ${d.name}]\n${d.text.trim().replace(/\n{3,}/g, "\n\n").slice(0, per)}${d.text.trim().length > per ? " ..." : ""}`).join("\n\n").slice(0, maxChars);
}

/** True once the time budget is spent: no new turn should start. */
export const outOfTime = (startedMs: number, nowMs: number, cfg: Pick<SmartConfig, "maxSeconds">): boolean => nowMs - startedMs >= cfg.maxSeconds * 1000;

export const SMART_ROLE_LABEL: Record<SmartRole, string> = { specialist: "SPECIALIST", coder: "CODER", reviewer: "REVIEWER", coordinator: "COORDINATOR" };

/** Instruction for each role (used by the server prompt). */
export const SMART_ROLE_TASK: Record<SmartRole, string> = {
  specialist: "Your role is the Specialist: look at the human's problem and the information they gave, say what is most likely going on and what to check first. If it is a simple question, just answer it.",
  coder: "Your role is the Coder: using the specialist's findings, give the concrete fix, command or code, in order. Only what is needed.",
  reviewer: "Your role is the Reviewer: check the proposed steps for risk (data loss, downtime, wrong assumptions) and say what to back up or verify first. If the plan is safe, say so in one line.",
  coordinator: "Your role is the Coordinator: summarize what the team found as short labelled lines: \"Cause:\" , \"Do this:\" (3-5 numbered steps) and \"Watch out:\". No more than 130 words.",
};
