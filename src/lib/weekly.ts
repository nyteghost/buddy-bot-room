/** Weekly review text: what's coming in the next 7 days. Pure, so it can be tested and previewed. */
export type WeeklyInput = {
  /** "Sun 25 Oct" style label for the start of the week. */
  from: string;
  /** Next seven days, in order. Days with no events can be left out. */
  days: { label: string; events: string[] }[];
  reminders?: string[];
  mail?: { count: number } | undefined;
  picks?: string[];
  weather?: string | undefined;
};

export function buildWeekly(i: WeeklyInput): { title: string; body: string } {
  const lines: string[] = [];
  if (i.weather) lines.push(i.weather, "");
  const busy = i.days.filter((d) => d.events.length);
  if (busy.length) {
    lines.push("Coming up:");
    for (const d of busy) lines.push(`${d.label}: ${d.events.slice(0, 4).join(" · ")}${d.events.length > 4 ? ` (+${d.events.length - 4})` : ""}`);
  } else if (i.days.length) lines.push("Your calendar is clear this week.");
  if (i.reminders?.length) lines.push("", "Reminders:", ...i.reminders.slice(0, 8).map((r) => `• ${r}`));
  if (i.mail) lines.push("", i.mail.count ? `${i.mail.count} unread email${i.mail.count === 1 ? "" : "s"} to look at.` : "Inbox is clear.");
  if (i.picks?.length) lines.push("", `Worth watching: ${i.picks.join(", ")}`);
  if (!lines.length) lines.push("Nothing to report yet. Connect a calendar or set a reminder to fill this in.");
  return { title: `Your week ahead (${i.from})`, body: lines.join("\n").replace(/^\n+/, "") };
}

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** REVIEW_DAY accepts "sun", "Sunday", "0"... Returns 0 to 6, or null if unreadable. */
export function reviewDay(v: string | undefined): number | null {
  const t = (v ?? "").trim().toLowerCase();
  if (!t) return null;
  if (/^[0-6]$/.test(t)) return Number(t);
  const i = DAY_NAMES.indexOf(t.slice(0, 3));
  return i >= 0 ? i : null;
}
