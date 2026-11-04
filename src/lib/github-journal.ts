import { cleanRepoList, parseRepo } from "./repos";

export type JournalConfig = {
  enabled: boolean;
  localAi: boolean;
  time: string;
  tz: string;
};
export type JournalState = {
  config: JournalConfig;
  heads: Record<string, string>;
  lastRun: string;
  lastDailyDay: string;
  lastResult: string;
  changed: number;
  errors: string[];
};

export const DEFAULT_GITHUB_REPOS = [
  "nyteghost/buddy-bot-room",
  "nyteghost/vibelight",
  "nyteghost/vibebeam",
  "nyteghost/showpilot",
  "nyteghost/RTP-Approval-System",
  "nyteghost/cgc-zone-monitor",
] as const;

export function defaultJournalState(): JournalState {
  return {
    config: { enabled: false, localAi: false, time: "03:00", tz: "America/New_York" },
    heads: {},
    lastRun: "",
    lastDailyDay: "",
    lastResult: "Never scanned",
    changed: 0,
    errors: [],
  };
}

export function validTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function journalRepos(raw: unknown, exists: boolean): string[] {
  return exists ? cleanRepoList(raw) : [...DEFAULT_GITHUB_REPOS];
}

export function journalBranches(defaultBranch: string, list: unknown): string[] {
  const names = Array.isArray(list) ? list.map(item =>
    item && typeof item === "object" && "name" in item ? String(item.name) : ""
  ) : [];
  const safe = (name: string) => /^[A-Za-z0-9._/-]{1,100}$/.test(name) && !name.includes("..");
  const picked = [defaultBranch, ...names.filter(name =>
    name === "beta" || name.startsWith("beta/") || name === "main" || name === "master"
  )].filter(safe);
  return [...new Set(picked)].slice(0, 12);
}

export function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 90) || "unknown";
}

export function commitLine(c: { sha: string; message: string }, repo: string): string {
  const first = c.message.split("\n")[0] ?? "";
  const clean = first.replace(/[\r\n\x00-\x1f\x7f[\]()<>]/g, " ").slice(0, 180);
  return "- [" + c.sha.slice(0, 8) + "](https://github.com/" + repo + "/commit/" + c.sha + ") " + clean;
}

export function isSha(x: unknown): x is string {
  return typeof x === "string" && /^[0-9a-f]{40}$/i.test(x);
}

export function validRepoName(s: unknown): s is string {
  return !!parseRepo(s) && parseRepo(s) === s;
}
