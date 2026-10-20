import type { TraktItem } from "./trakt";

/** Why something is on tonight's list, in one plain line. Facts only: nothing is invented about the plot or your taste. */
export function pickReason(item: TraktItem, rank = 0): string {
  const kind = item.kind === "show" ? "series" : "movie";
  const bits: string[] = [];
  bits.push(item.watched ? "you've seen it" : `unwatched ${kind} on your Trakt list`);
  if (item.inPlex === true) bits.push("already in Plex, ready to play");
  else if (item.inPlex === false) bits.push("not in Plex yet, you can request it");
  if (item.year && new Date().getFullYear() - item.year >= 15 && !item.watched) bits.push(`from ${item.year}`);
  if (rank === 0 && item.inPlex === true) bits.unshift("top pick");
  return bits.join(" · ").replace(/^./, (c) => c.toUpperCase());
}

export type QueueEntry = { item: TraktItem; reason: string; action: "watch" | "request" | "none" };

/** Unwatched items, ones Plex already has first, each with its reason and the one-tap action that makes sense. */
export function watchQueue(items: TraktItem[], n = 6): QueueEntry[] {
  const open = items.filter((i) => !i.watched);
  const ordered = [...open.filter((i) => i.inPlex === true), ...open.filter((i) => i.inPlex !== true)].slice(0, n);
  return ordered.map((item, rank) => ({ item, reason: pickReason(item, rank), action: item.inPlex === true ? "watch" : item.inPlex === false ? "request" : "none" }));
}
