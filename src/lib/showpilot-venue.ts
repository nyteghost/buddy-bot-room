import type { EventRow } from "./work-tools";

/**
 * Convention-center-only intake gate. Identify venue by space, not show title.
 * Never silently treat an unknown space as the convention center.
 * Space patterns are deliberately conservative and should be extended only
 * after verifying Ungerboeck naming in real reports.
 */
const CONVENTION_SPACES = [
  /\bexhibit\s*halls?\s*[a-d]{1,4}\b/i,
  /\bhalls?\s+[a-d]{1,4}\b/i,
  /\bball\s*rooms?\s*[a-g]{1,7}\b/i,
  /\bconcourse\s*[a-d]{1,4}\b/i,
  /\bchattahoochee\b/i,
  /\bbrfull\b/i,
];
const OTHER_BUILDING = /\b(?:cepac|cobb\s*energy|performing\s*arts(?:\s*centre|\s*center)?)\b/i;

export type VenueScope<T> = { accepted: T[]; excluded: T[]; needsReview: T[] };

export function scopeShowPilotRows<T extends Pick<EventRow, "space">>(rows: readonly T[], approvedSpaces: readonly string[] = []): VenueScope<T> {
  const accepted: T[] = [], excluded: T[] = [], needsReview: T[] = [];
  const approved = new Set(approvedSpaces.map((s) => s.trim().toLowerCase()).filter(Boolean));
  for (const row of rows) {
    const space = (row.space ?? "").trim();
    if (OTHER_BUILDING.test(space)) excluded.push(row);
    else if (CONVENTION_SPACES.some((p) => p.test(space)) || approved.has(space.toLowerCase())) accepted.push(row);
    else needsReview.push(row);
  }
  return { accepted, excluded, needsReview };
}
