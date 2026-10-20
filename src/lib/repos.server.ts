import { currentUser } from "./accounts.server";
import { cleanRepoList, explainGithub, MAX_REPOS, parseRepo, shapeRepo, type RepoView } from "./repos";

/**
 * Repo watch: the repos you pick, with latest commits, build status and open pull requests, read from GitHub's API.
 * Owner only. The list lives in BUDDY_DATA_DIR/repos.json. GITHUB_TOKEN (Settings, optional) allows private repos and a higher
 * hourly limit; it only ever goes to api.github.com and never reaches the browser. Everything is read-only.
 */
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fsp = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const file = () => `${dir()}/repos.json`;
const token = () => (process.env["GITHUB_TOKEN"] ?? "").trim();

async function load(): Promise<string[]> {
  try { return cleanRepoList((JSON.parse(await (await fsp()).readFile(file(), "utf8")) as { repos?: unknown }).repos); } catch { return []; }
}
async function save(repos: string[]): Promise<void> {
  const f = await fsp();
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${file()}.tmp`, JSON.stringify({ repos }), "utf8");
  await f.rename(`${file()}.tmp`, file());
}

type Got = { ok: true; json: unknown } | { ok: false; status: number; remaining: string | null };
async function gh(path: string): Promise<Got> {
  const t = token();
  try {
    const res = await fetch(`https://api.github.com/${path}`, {
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "pixel-pals-repo-watch", ...(t ? { authorization: `Bearer ${t}` } : {}) },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { ok: false, status: res.status, remaining: res.headers.get("x-ratelimit-remaining") };
    return { ok: true, json: await res.json() };
  } catch { return { ok: false, status: 0, remaining: null }; }
}

const cache = new Map<string, { at: number; view: RepoView }>();

async function view(name: string, force: boolean): Promise<RepoView> {
  const hit = cache.get(name);
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.view;
  const empty = (error: string): RepoView => ({ repo: name, url: `https://github.com/${name}`, description: "", branch: "", pushedAt: "", openPrs: 0, openIssues: 0, ci: { state: "none", name: "", url: "", at: "" }, commits: [], error });
  const repo = await gh(`repos/${name}`);
  if (!repo.ok) return empty(repo.status === 0 ? "Couldn't reach GitHub." : explainGithub(repo.status, !!token(), repo.remaining));
  const branch = String((repo.json as { default_branch?: unknown }).default_branch ?? "main");
  const [commits, runs, pulls] = await Promise.all([
    gh(`repos/${name}/commits?sha=${encodeURIComponent(branch)}&per_page=5`),
    gh(`repos/${name}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`),
    gh(`repos/${name}/pulls?state=open&per_page=100`),
  ]);
  const v = shapeRepo(name, repo.json, commits.ok ? commits.json : [], runs.ok ? runs.json : {}, pulls.ok ? pulls.json : []);
  cache.set(name, { at: Date.now(), view: v });
  return v;
}

export async function handleRepos(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return Response.json({ error: "Only the owner account can use Repos here." }, { status: 403 });
  if (!dir()) return Response.json({ error: "Needs BUDDY_DATA_DIR (the data volume)." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { op?: string; repo?: string; force?: boolean };
  let repos = await load();
  if (body.op === "add") {
    const p = parseRepo(body.repo);
    if (!p) return Response.json({ error: "Type a repo like owner/name, or paste its GitHub link." }, { status: 400 });
    if (repos.some((r) => r.toLowerCase() === p.toLowerCase())) return Response.json({ error: "You're already watching that one." }, { status: 400 });
    if (repos.length >= MAX_REPOS) return Response.json({ error: `That's the most I'll watch (${MAX_REPOS}).` }, { status: 400 });
    repos = [...repos, p];
    await save(repos);
  } else if (body.op === "remove") {
    const p = parseRepo(body.repo);
    repos = repos.filter((r) => r.toLowerCase() !== (p ?? "").toLowerCase());
    await save(repos);
  }
  const items = await Promise.all(repos.map((r) => view(r, body.force === true || body.op === "add")));
  return Response.json({ items, token: !!token() });
}
