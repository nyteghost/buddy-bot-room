/** Working Pals is an approval-first job inbox. No autonomous side effects. */
export type PalMissionStatus =
  | "proposed"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "revoked"
  | "interrupted";
export type PalMission = {
  id: string;
  title: string;
  question: string;
  scope: "personal" | "project";
  project: string;
  status: PalMissionStatus;
  revision: number;
  created: string;
  updated: string;
  approvedAt: string;
  startedAt: string;
  finishedAt: string;
  result: string;
  error: string;
  source: "owner-ui";
  execution: "local-summary-only";
  schedule?: { minutes: number; next: number; enabled: boolean; approvedAt: string };
  receipts?: { revision: number; at: string; status: string; result: string; error: string }[];
};
export const MAX_MISSIONS = 50;
const ID = /^[0-9a-f-]{36}$/i;
const PROJECT = /^[a-zA-Z0-9_-]{1,80}$/;
const STATUS: PalMissionStatus[] = [
  "proposed",
  "approved",
  "running",
  "completed",
  "failed",
  "paused",
  "revoked",
  "interrupted",
];
export function validMission(raw: unknown): raw is PalMission {
  if (!raw || typeof raw !== "object") return false;
  const m = raw as Partial<PalMission>;
  return (
    typeof m.id === "string" &&
    ID.test(m.id) &&
    typeof m.title === "string" &&
    m.title.length > 0 &&
    m.title.length <= 120 &&
    typeof m.question === "string" &&
    m.question.length > 0 &&
    m.question.length <= 1200 &&
    (m.scope === "personal" || m.scope === "project") &&
    typeof m.project === "string" &&
    (!m.project || PROJECT.test(m.project)) &&
    (m.scope === "personal" ? !m.project : !!m.project) &&
    STATUS.includes(m.status as PalMissionStatus) &&
    typeof m.revision === "number" &&
    Number.isInteger(m.revision) &&
    m.revision >= 1 &&
    ["created", "updated", "approvedAt", "startedAt", "finishedAt", "result", "error"].every(
      (k) => typeof m[k as keyof PalMission] === "string",
    ) &&
    m.result!.length <= 4000 &&
    m.error!.length <= 300 &&
    (m.schedule === undefined ||
      (Number.isInteger(m.schedule.minutes) &&
        m.schedule.minutes >= 60 &&
        m.schedule.minutes <= 10080 &&
        Number.isFinite(m.schedule.next) &&
        m.schedule.next > 0 &&
        typeof m.schedule.enabled === "boolean" &&
        typeof m.schedule.approvedAt === "string" &&
        !!m.schedule.approvedAt)) &&
    (m.receipts === undefined ||
      (Array.isArray(m.receipts) &&
        m.receipts.length <= 100 &&
        m.receipts.every(
          (r) =>
            Number.isSafeInteger(r.revision) &&
            typeof r.at === "string" &&
            typeof r.status === "string" &&
            typeof r.result === "string" &&
            r.result.length <= 4000 &&
            typeof r.error === "string" &&
            r.error.length <= 300,
        ))) &&
    m.source === "owner-ui" &&
    m.execution === "local-summary-only"
  );
}
export function newMission(
  input: Record<string, unknown>,
  id: string,
  now: string,
): PalMission | null {
  const title = typeof input["title"] === "string" ? input["title"].trim() : "";
  const question = typeof input["question"] === "string" ? input["question"].trim() : "";
  const scope =
    input["scope"] === "project" ? "project" : input["scope"] === "personal" ? "personal" : null;
  const project = typeof input["project"] === "string" ? input["project"].trim() : "";
  if (
    !ID.test(id) ||
    !title ||
    title.length > 120 ||
    !question ||
    question.length > 1200 ||
    !scope ||
    (scope === "project" && !PROJECT.test(project)) ||
    (scope === "personal" && !!project)
  )
    return null;
  // Read-only summarization, not a general-purpose command/task executor.
  return {
    id,
    title,
    question,
    scope,
    project,
    status: "proposed",
    revision: 1,
    created: now,
    updated: now,
    approvedAt: "",
    startedAt: "",
    finishedAt: "",
    result: "",
    error: "",
    source: "owner-ui",
    execution: "local-summary-only",
  };
}
export function canRun(m: PalMission): boolean {
  return (
    !!m.approvedAt &&
    ["approved", "completed", "failed", "paused", "interrupted"].includes(m.status)
  );
}
export function isTerminal(m: PalMission): boolean {
  return m.status === "revoked";
}
/** A running job has no durable process after a restart. Never auto-retry it. */
export function recoverMission(m: PalMission): PalMission {
  return m.status === "running"
    ? {
        ...m,
        status: "interrupted",
        revision: m.revision + 1,
        error: "Interrupted by restart. Review and press Run to retry.",
      }
    : m;
}
