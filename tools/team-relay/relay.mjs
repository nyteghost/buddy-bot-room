import { readFile } from "node:fs/promises";

export const BOARD_MARKER = "<!-- pixel-pals-team-relay-board:v1 -->";
const HANDOFF_PATTERN = /<!--\s*pixel-pals-relay:v1\s*-->([\s\S]*?)<!--\s*\/pixel-pals-relay\s*-->/i;
export const ROLES = Object.freeze([
  "pm", "claude", "artist", "core", "adhd", "qa", "architect", "infra", "brainstorm"
]);
const ROLE_LABELS = {
  pm: "Project Manager", claude: "Living Universe (Claude)",
  artist: "Artistic Designer", core: "Core Developer",
  adhd: "ADHD Second Brain", qa: "QA & Release",
  architect: "AI Integration Architect", infra: "Infrastructure & Automation",
  brainstorm: "Brainstorming & Innovation"
};
const STATUSES = new Set(["progress", "blocked", "ready-for-review", "decision-needed", "complete"]);

export function parseHandoff(body) {
  const block = HANDOFF_PATTERN.exec(typeof body === "string" ? body : "");
  if (!block) return null;
  const fields = {};
  for (const row of block[1].split(/\r?\n/)) {
    const match = /^\s*(From|To|Status|Summary|Next)\s*:\s*(.*?)\s*$/i.exec(row);
    if (match) fields[match[1].toLowerCase()] = match[2];
  }
  const from = (fields.from || "").trim().toLowerCase();
  const status = (fields.status || "").trim().toLowerCase();
  const to = [...new Set((fields.to || "").toLowerCase().split(/[\s,]+/).filter(x => ROLES.includes(x)))];
  if (!ROLES.includes(from) || !STATUSES.has(status) || to.length === 0 || !(fields.summary || "").trim()) return null;
  return { from, to, status };
}

export function trustedHandoff(comment, owner) {
  if (!comment || comment.user?.type !== "User") return null;
  const trusted = comment.user?.login?.toLowerCase() === owner.toLowerCase()
    || ["OWNER", "MEMBER", "COLLABORATOR"].includes(comment.author_association);
  if (!trusted || !comment.html_url) return null;
  const parsed = parseHandoff(comment.body);
  return parsed ? { ...parsed, url: comment.html_url, time: comment.created_at || "" } : null;
}

function clean(value) {
  return String(value ?? "").replace(/[|<>\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 110);
}
function url(value) {
  // URLs come from GitHub API, never directly from the untrusted comment text.
  return /^https:\/\/github\.com\/nyteghost\/buddy-bot-room\/(issues|pull)\/\d+(?:#issuecomment-\d+)?$/.test(value || "")
    ? value : "";
}

export function renderBoard({ pulls = [], runs = [], handoffs = [] }) {
  const latest = new Map();
  for (const run of [...runs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
    if (run.head_sha && !latest.has(run.head_sha)) latest.set(run.head_sha, run);
  }
  const lines = [
    BOARD_MARKER,
    "## Pixel Pals Team Relay — live team inbox",
    "**Metadata-only, free GitHub coordination.** This board links to trusted handoffs, open PRs and CI results. It **cannot wake up ChatGPT chats or authorize agents**.",
    "Private art, credentials, personal/work records and Second Brain data must never be posted in this public repository.",
    "",
    "### Open development pull requests",
    "| PR | Branch → target | Latest CI |",
    "| --- | --- | --- |"
  ];
  const active = pulls.filter(p => p.state === "open" && p.base?.ref === "beta").sort((a, b) => a.number - b.number);
  for (const p of active.slice(0, 25)) {
    const r = latest.get(p.head?.sha);
    const ci = r ? (clean(r.conclusion || r.status) + " ([run](" + r.html_url + "))") : "No recent matching run";
    lines.push("| [#" + p.number + " " + clean(p.title) + "](https://github.com/nyteghost/buddy-bot-room/pull/" + p.number + ")"
      + (p.draft ? " (draft)" : "") + " | " + clean(p.head?.ref) + " → beta | " + ci + " |");
  }
  if (!active.length) lines.push("| No open PRs targeting beta | — | — |");

  lines.push("", "### Routed inbox (newest trusted handoffs)");
  const ordered = [...handoffs].sort((a, b) => b.time.localeCompare(a.time));
  for (const role of ROLES) {
    const incoming = ordered.filter(h => h.to.includes(role) && url(h.url)).slice(0, 4);
    lines.push("", "**" + ROLE_LABELS[role] + "**");
    if (!incoming.length) lines.push("- No handoffs in the latest scanned comments.");
    for (const h of incoming) {
      lines.push("- **" + clean(h.status) + "** from " + ROLE_LABELS[h.from] + ": [open source report](" + url(h.url) + ")");
    }
  }
  lines.push("",
    "### Post a handoff",
    "Add a new comment to [Issue #23](https://github.com/nyteghost/buddy-bot-room/issues/23) or [Issue #26](https://github.com/nyteghost/buddy-bot-room/issues/26) with this envelope, followed by the full public-safe report:",
    "",
    "    <!-- pixel-pals-relay:v1 -->",
    "    From: core",
    "    To: pm, qa",
    "    Status: ready-for-review",
    "    Summary: A short public-safe summary",
    "    Next: Request review of PR #25",
    "    <!-- /pixel-pals-relay -->",
    "",
    "Valid roles: " + ROLES.join(", ") + ". Valid statuses: " + [...STATUSES].join(", ") + ".",
    "Only owner/member/collaborator-authored handoffs enter this index. No comment contents are copied into the board—only source links.",
    "",
    "*This one comment is edited when the GitHub metadata changes, avoiding notification spam. Owner-triggered issue activity refreshes it; the scheduled check also catches PR/CI updates. Developers must open their chats and read their queue.*"
  );
  return lines.join("\n") + "\n";
}

async function api(path, token, method = "GET", body) {
  const response = await fetch("https://api.github.com" + path, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) throw new Error("GitHub API " + method + " " + path + ": HTTP " + response.status);
  return response.json();
}

async function comments(issue, token) {
  const result = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await api("/repos/nyteghost/buddy-bot-room/issues/" + issue + "/comments?per_page=100&page=" + page, token);
    result.push(...batch);
    if (batch.length < 100) break;
  }
  return result;
}

export async function runRelay(env = process.env) {
  if (env.GITHUB_REPOSITORY !== "nyteghost/buddy-bot-room") throw new Error("Unexpected repository; refusing cross-repository posting");
  if (!env.GITHUB_TOKEN) throw new Error("No GitHub Actions token");
  const token = env.GITHUB_TOKEN;
  const [pulls, data, issue23, issue26] = await Promise.all([
    api("/repos/nyteghost/buddy-bot-room/pulls?state=open&per_page=100", token),
    api("/repos/nyteghost/buddy-bot-room/actions/runs?per_page=100", token),
    comments(23, token),
    comments(26, token)
  ]);
  const handoffs = [...issue23, ...issue26].map(c => trustedHandoff(c, "nyteghost")).filter(Boolean);
  const body = renderBoard({ pulls, runs: data.workflow_runs || [], handoffs });
  const previous = issue23.find(c => c.user?.login === "github-actions[bot]" && c.body?.includes(BOARD_MARKER));
  if (previous?.body === body) {
    console.log("Team Relay: unchanged; no comment posted.");
    return;
  }
  if (previous) {
    await api("/repos/nyteghost/buddy-bot-room/issues/comments/" + previous.id, token, "PATCH", { body });
    console.log("Team Relay: updated board comment #" + previous.id);
  } else {
    const created = await api("/repos/nyteghost/buddy-bot-room/issues/23/comments", token, "POST", { body });
    console.log("Team Relay: created board at " + created.html_url);
  }
}

// Unit tests import this module without performing any GitHub or network activity.
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  // Read the event file only as a defensive check; never run content from it.
  if (process.env.GITHUB_EVENT_PATH) await readFile(process.env.GITHUB_EVENT_PATH, "utf8");
  await runRelay();
}
