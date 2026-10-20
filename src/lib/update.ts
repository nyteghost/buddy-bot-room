/** "Update available" checks for the self-hosted web app. Pure shaping; the lookup is in update.server.ts. */
export type UpdateInfo = {
  /** Commit this server was built from (short). */
  current: string;
  /** Newest commit on main (short), when known. */
  latest: string;
  /** How many commits behind. 0 means up to date. */
  behind: number;
  /** One-line messages of what's new, newest first. */
  changes: string[];
  /** Why no comparison could be made (unknown local build, no network...). */
  note?: string | undefined;
};

const first = (s: unknown): string => String(s ?? "").split("\n")[0]?.trim().slice(0, 120) ?? "";

/** Shape GitHub's compare response (`/compare/<current>...main`). Null if it isn't one. */
export function parseCompare(json: unknown, current: string): UpdateInfo | null {
  const j = json as { status?: string; ahead_by?: number; commits?: { sha?: string; commit?: { message?: string } }[] } | null;
  if (!j || typeof j.status !== "string") return null;
  const commits = Array.isArray(j.commits) ? j.commits : [];
  const behind = j.status === "ahead" || j.status === "diverged" ? Math.max(0, Number(j.ahead_by) || commits.length) : 0;
  const last = commits[commits.length - 1];
  return {
    current,
    latest: String(last?.sha ?? current).slice(0, 7),
    behind,
    changes: commits.slice().reverse().map((c) => first(c.commit?.message)).filter(Boolean).slice(0, 8),
  };
}

/** A build that can't be compared (no commit stamp). */
export const isKnownBuild = (commit: string): boolean => /^[0-9a-f]{7,40}$/i.test(commit.trim());

export function updateText(u: UpdateInfo): string {
  if (u.note) return u.note;
  if (u.behind <= 0) return `Pixel Pals is up to date (${u.current}).`;
  const list = u.changes.length ? `\n\nWhat's new:\n${u.changes.map((c) => `• ${c}`).join("\n")}` : "";
  return `Update available: ${u.behind} new change${u.behind === 1 ? "" : "s"} (you have ${u.current}, latest is ${u.latest}).${list}\n\nTo update: Portainer → Stacks → your Pixel Pals stack → Pull and redeploy (turn on “Re-pull image and redeploy” / “Build”). Your data lives in the data volume and is kept.`;
}
