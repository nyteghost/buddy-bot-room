/**
 * Three-way sync of two lists with a remembered "last agreed" copy (base). Works for tasks and reminders alike.
 * - New on one side → copied to the other.
 * - Changed on one side → copied to the other. Changed on both → the remote (your phone) wins.
 * - Gone from one side but in base → it was deleted there, so delete it on the other side too.
 * Pure: it only plans; the caller applies the plan.
 */
export type Plan<T extends { id: string }> = {
  /** The new local list (local order kept, new remote items appended). */
  local: T[];
  /** Items to create or update on the remote side. */
  push: T[];
  /** Ids to delete on the remote side. */
  remoteDelete: string[];
  /** The agreed state to remember for next time. */
  base: Record<string, T>;
};

export function syncPlan<T extends { id: string }>(local: T[], remote: T[], base: Record<string, T>, same: (a: T, b: T) => boolean): Plan<T> {
  const L = new Map(local.map((i) => [i.id, i]));
  const R = new Map(remote.map((i) => [i.id, i]));
  const result = new Map<string, T>();
  const push: T[] = [];
  const remoteDelete: string[] = [];
  const nextBase: Record<string, T> = {};
  const ids = new Set<string>([...L.keys(), ...R.keys()]);
  for (const id of ids) {
    const l = L.get(id);
    const r = R.get(id);
    const b = base[id];
    if (l && r) {
      if (same(l, r)) { result.set(id, l); nextBase[id] = l; continue; }
      const changedL = !b || !same(l, b);
      const changedR = !b || !same(r, b);
      if (changedL && !changedR) { result.set(id, l); push.push(l); nextBase[id] = l; }
      else { result.set(id, r); nextBase[id] = r; } // only remote changed, or both (remote wins)
    } else if (l && !r) {
      if (b) continue; // deleted on the remote side: drop it here too
      result.set(id, l); push.push(l); nextBase[id] = l; // new here
    } else if (!l && r) {
      if (b) { remoteDelete.push(id); continue; } // deleted here: delete there too
      result.set(id, r); nextBase[id] = r; // new there
    }
  }
  const ordered: T[] = [];
  for (const i of local) { const kept = result.get(i.id); if (kept) { ordered.push(kept); result.delete(i.id); } }
  for (const i of result.values()) ordered.push(i);
  return { local: ordered, push, remoteDelete, base: nextBase };
}
