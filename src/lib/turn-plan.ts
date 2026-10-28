import type { Mode } from "./agents";
import type { DmRole } from "./campaign";
import { SOLVE_ROLE_ORDER } from "./solve-steps";
import { planSmartTeam, type SmartConfig, type SmartPlan } from "./smart-team";

/** Who speaks, in what order, for one message. Pure: the room runs the turns, this only decides them. */
export type PlannedTurn<A> = { agent: A; round: number; verdict: boolean; dmRole?: DmRole; role?: string; side?: "for" | "against"; summary?: boolean };

export function planTurns<A extends { id: string }>(o: {
  seated: A[];
  mode: Mode;
  /** One-on-one (also used when a message @mentions a pal). */
  direct: boolean;
  rounds: number;
  judgeOn: boolean;
  /** A Dungeon Master campaign is running: the first pal narrates, the rest react. */
  campaignActive: boolean;
  /** A "summarize" request: the first pal writes it. */
  summary: boolean;
  topic: string;
  smart: SmartConfig;
}): { turns: PlannedTurn<A>[]; smartPlan: SmartPlan | null } {
  const { seated, mode, direct, rounds } = o;
  const turns: PlannedTurn<A>[] = [];
  let smartPlan: SmartPlan | null = null;
  if (o.summary && seated[0]) turns.push({ agent: seated[0], round: 1, verdict: false, summary: true });
  else if (o.campaignActive) seated.forEach((agent, i) => turns.push({ agent, round: 1, verdict: false, dmRole: i === 0 ? "dm" : "party" }));
  else if (mode === "smart" && !direct) {
    // Smart Team: plan with plain code (no model call), then run only the pals the question needs, one at a time.
    const plan = planSmartTeam({ text: o.topic, seated: seated.map((a) => a.id), config: o.smart });
    smartPlan = plan;
    for (const st of plan.steps) {
      const agent = seated.find((a) => a.id === st.agentId);
      if (agent) turns.push({ agent, round: 1, verdict: false, ...(plan.single ? {} : { role: st.role }) });
    }
  } else if (mode === "debate" && !direct) {
    // Two pals take the sides; the next pal (or the first, with only two) judges.
    const debaters = seated.slice(0, 2);
    for (let r = 1; r <= rounds; r++)
      debaters.forEach((agent, i) => turns.push({ agent, round: r, verdict: false, side: i === 0 ? "for" : "against" }));
    const judge = seated[2] ?? seated[0];
    if (judge && debaters.length === 2) turns.push({ agent: judge, round: rounds, verdict: true });
  } else {
    for (let r = 1; r <= (direct ? 1 : rounds); r++)
      seated.forEach((agent, i) => turns.push({ agent, round: r, verdict: false, ...(mode === "solve" && !direct ? { role: SOLVE_ROLE_ORDER[i % SOLVE_ROLE_ORDER.length] } : {}) }));
    const lead = seated[0];
    if ((mode === "roundtable" || mode === "solve" || (mode === "broadcast" && o.judgeOn)) && !direct && seated.length > 1 && lead)
      turns.push({ agent: lead, round: rounds, verdict: true });
  }
  return { turns, smartPlan };
}
