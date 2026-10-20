/**
 * Watching GitHub repos: the pure parts (reading a repo name, shaping GitHub's replies into what the panel shows).
 * The server file does the fetching and keeps the list.
 */
export type CiState = "passing" | "failing" | "running" | "other" | "none";
export type Commit = { sha: string; message: string; author: string; date: string; url: string };
export type RepoView = {
  repo: string;
  url: string;
  description: string;
  branch: string;
  pushedAt: string;
  openPrs: number;
  /** "100+" style cap is shown by the panel when this reaches the page size. */
  openIssues: number;
  ci: { state: CiState; name: string; url: string; at: string };
  commits: Commit[];
  error?: string | undefined;
};

export const MAX_REPOS = 12;
const NAME = /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;

/** "owner/name", or a github.com link to the repo or anything inside it. */
export function parseRepo(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/^git@github\.com:/i, "https://github.com/");
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+)/i);
  if (m) s = `${m[1]}/${m[2]}`;
  s = s.replace(/\.git$/i, "");
  return NAME.test(s) && !s.startsWith(".") ? s : null;
}

export function cleanRepoList(raw: unknown): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const p = parseRepo(r);
    if (p && !out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p);
  }
  return out.slice(0, MAX_REPOS);
}

const text = (v: unknown, max = 200): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function ciState(run: unknown): CiState {
  const r = obj(run);
  if (!r["status"]) return "none";
  if (r["status"] !== "completed") return "running";
  const c = r["conclusion"];
  if (c === "success") return "passing";
  if (c === "failure" || c === "timed_out" || c === "startup_failure" || c === "action_required") return "failing";
  return "other";
}

/** Builds the panel's view of one repo from GitHub's replies (the repo, its recent commits, the latest build, its open pull requests). */
export function shapeRepo(name: string, repoJson: unknown, commitsJson: unknown, runsJson: unknown, pullsJson: unknown): RepoView {
  const r = obj(repoJson);
  const pulls = Array.isArray(pullsJson) ? pullsJson.length : 0;
  const runs = obj(runsJson)["workflow_runs"];
  const run = obj(Array.isArray(runs) ? runs[0] : undefined);
  const commits: Commit[] = [];
  for (const c of (Array.isArray(commitsJson) ? commitsJson : []).slice(0, 5)) {
    const o = obj(c), inner = obj(o["commit"]), who = obj(inner["author"]);
    const sha = text(o["sha"], 40);
    if (!sha) continue;
    commits.push({ sha: sha.slice(0, 7), message: text(String(inner["message"] ?? "").split("\n")[0], 120), author: text(who["name"], 60) || text(obj(o["author"])["login"], 40), date: text(who["date"], 30), url: text(o["html_url"], 300) });
  }
  const issuesRaw = typeof r["open_issues_count"] === "number" ? (r["open_issues_count"] as number) : 0;
  return {
    repo: name,
    url: text(r["html_url"], 300) || `https://github.com/${name}`,
    description: text(r["description"], 200),
    branch: text(r["default_branch"], 80) || "main",
    pushedAt: text(r["pushed_at"], 30),
    openPrs: pulls,
    openIssues: Math.max(0, issuesRaw - pulls),
    ci: { state: ciState(run), name: text(run["display_title"], 100) || text(run["name"], 100), url: text(run["html_url"], 300), at: text(run["updated_at"], 30) },
    commits,
  };
}

/** "5m ago", "3h ago", "2d ago". */
export function ago(iso: string | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / (86400 * 30))}mo ago`;
}

/** A short plain-language line saying what GitHub's error means for this person. */
export function explainGithub(status: number, hasToken: boolean, remaining?: string | null): string {
  if (status === 401) return "GitHub rejected the token in Settings. Make a new one.";
  if (status === 403 || status === 429) return remaining === "0" ? "GitHub's hourly limit is used up. Add a token in Settings for a much higher limit, or try again later." : "GitHub refused the request.";
  if (status === 404) return hasToken ? "Repo not found, or the token can't see it." : "Repo not found. If it's private, add a GitHub token in Settings.";
  return `GitHub answered ${status}.`;
}
