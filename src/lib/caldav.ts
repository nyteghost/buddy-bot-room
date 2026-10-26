import { unfold, wallToUtc } from "./ics";
import type { Repeat } from "./reminders";

/**
 * Just enough CalDAV/iCalendar to keep tasks and reminders in sync with a Radicale server (and so with the iPhone's Reminders app).
 * To-dos are VTODO items. Pure: no network here, see caldav.server.ts.
 */
export type Vtodo = {
  uid: string;
  summary: string;
  done: boolean;
  /** Due time in ms, or null. */
  due: number | null;
  /** A repeat Pixel Pals understands; undefined for none or for rules it doesn't (those are left alone). */
  repeat: Repeat | undefined;
};

const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const unesc = (s: string): string => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").replace(/\s+/g, " ").trim();
const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Fold long lines the way iCalendar wants (continuation lines start with a space). */
export function fold(line: string): string {
  if (line.length <= 70) return line;
  const out: string[] = [];
  let rest = line;
  out.push(rest.slice(0, 70)); rest = rest.slice(70);
  while (rest.length) { out.push(` ${rest.slice(0, 69)}`); rest = rest.slice(69); }
  return out.join("\r\n");
}

const DAY2 = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
export function rruleOf(r: Repeat): string {
  const nth = /^nth:(-?\d):(\d)$/.exec(r);
  if (nth) return `FREQ=MONTHLY;BYDAY=${nth[1]}${DAY2[Number(nth[2])]}`;
  if (r === "biweekly") return "FREQ=WEEKLY;INTERVAL=2";
  if (r === "quarterly") return "FREQ=MONTHLY;INTERVAL=3";
  return r === "weekdays" ? "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" : r === "weekly" ? "FREQ=WEEKLY" : r === "monthly" ? "FREQ=MONTHLY" : "FREQ=DAILY";
}

/** Only the plain repeats map back; anything fancier (every 2 weeks, yearly, "until") returns undefined and is left as the phone has it. */
export function repeatFromRrule(rule: string): Repeat | undefined {
  const o: Record<string, string> = {};
  for (const part of rule.split(";")) { const [k = "", v = ""] = part.split("="); o[k.toUpperCase()] = v.toUpperCase(); }
  if (o["COUNT"] || o["UNTIL"]) return undefined;
  if (o["FREQ"] === "WEEKLY" && o["INTERVAL"] === "2" && (o["BYDAY"] ?? "").split(",").filter(Boolean).length <= 1) return "biweekly";
  if (o["FREQ"] === "MONTHLY" && o["INTERVAL"] === "3" && !o["BYDAY"]) return "quarterly";
  const nth = o["FREQ"] === "MONTHLY" && (!o["INTERVAL"] || o["INTERVAL"] === "1") ? /^(-1|[1-4])(SU|MO|TU|WE|TH|FR|SA)$/.exec(o["BYDAY"] ?? "") : null;
  if (nth) return `nth:${nth[1]}:${DAY2.indexOf(nth[2] ?? "")}` as Repeat;
  if (o["INTERVAL"] && o["INTERVAL"] !== "1") return undefined;
  if (o["FREQ"] === "DAILY") return "daily";
  if (o["FREQ"] === "MONTHLY" && !o["BYDAY"]) return "monthly";
  if (o["FREQ"] === "WEEKLY") {
    const days = (o["BYDAY"] ?? "").split(",").filter(Boolean).sort().join(",");
    if (days === "FR,MO,TH,TU,WE") return "weekdays";
    return days.split(",").filter(Boolean).length <= 1 ? "weekly" : undefined;
  }
  return undefined;
}

type Prop = { name: string; params: Record<string, string>; value: string };
function prop(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon < 1) return null;
  const [name = "", ...rest] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rest) { const [k = "", v = ""] = p.split("="); params[k.toUpperCase()] = v.replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function dueMs(p: Prop, tz: string): number | null {
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/.exec(p.value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] === undefined) return wallToUtc(y, mo, d, 9, 0, 0, tz); // date only: 9am that day
  if (m[7]) return Date.UTC(y, mo - 1, d, Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  let zone = tz;
  const tzid = p.params["TZID"];
  if (tzid) { try { new Intl.DateTimeFormat("en-US", { timeZone: tzid }); zone = tzid; } catch { /* use fallback */ } }
  return wallToUtc(y, mo, d, Number(m[4]), Number(m[5]), Number(m[6] ?? 0), zone);
}

/** The first VTODO in a calendar object. Alarms inside it are ignored. Null if there isn't one or it has no id. */
export function parseVtodo(data: string, tz = "UTC"): Vtodo | null {
  let inTodo = false;
  let inAlarm = false;
  const t: Vtodo = { uid: "", summary: "", done: false, due: null, repeat: undefined };
  let sawTodo = false;
  for (const line of unfold(data)) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VTODO") { inTodo = true; sawTodo = true; continue; }
    if (upper === "END:VTODO") break;
    if (!inTodo) continue;
    if (upper === "BEGIN:VALARM") { inAlarm = true; continue; }
    if (upper === "END:VALARM") { inAlarm = false; continue; }
    if (inAlarm) continue;
    const p = prop(line);
    if (!p) continue;
    if (p.name === "UID") t.uid = p.value.trim();
    else if (p.name === "SUMMARY") t.summary = unesc(p.value);
    else if (p.name === "STATUS") { if (/^(COMPLETED|CANCELLED)$/i.test(p.value.trim())) t.done = true; }
    else if (p.name === "COMPLETED") t.done = true;
    else if (p.name === "DUE") t.due = dueMs(p, tz);
    else if (p.name === "RRULE") t.repeat = repeatFromRrule(p.value);
  }
  return sawTodo && t.uid ? t : null;
}

/** A fresh VTODO resource. */
export function buildVtodo(t: { uid: string; summary: string; done: boolean; due?: number | null | undefined; repeat?: Repeat | undefined }, now: number): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pixel Pals//Tasks//EN", "BEGIN:VTODO", `UID:${t.uid}`, `DTSTAMP:${stamp(now)}`, `CREATED:${stamp(now)}`, `LAST-MODIFIED:${stamp(now)}`, `SUMMARY:${esc(t.summary)}`, `STATUS:${t.done ? "COMPLETED" : "NEEDS-ACTION"}`];
  if (t.done) lines.push(`COMPLETED:${stamp(now)}`, "PERCENT-COMPLETE:100");
  if (t.due) lines.push(`DUE:${stamp(t.due)}`);
  if (t.repeat && t.due) lines.push(`RRULE:${rruleOf(t.repeat)}`);
  lines.push("END:VTODO", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * Change only what changed in an existing resource, so everything else the phone stored (alarms, notes, sort order) survives.
 * `change` lists the fields to rewrite; a null due removes the due date.
 */
export function patchVtodo(raw: string, change: { summary?: string; done?: boolean; due?: number | null }, now: number): string {
  const lines = unfold(raw).filter((l) => l.length > 0);
  const out: string[] = [];
  let inTodo = false;
  let inAlarm = false;
  const drop = new Set<string>(["LAST-MODIFIED", "DTSTAMP"]);
  if (change.summary !== undefined) drop.add("SUMMARY");
  if (change.done !== undefined) ["STATUS", "COMPLETED", "PERCENT-COMPLETE"].forEach((n) => drop.add(n));
  if (change.due !== undefined) drop.add("DUE");
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VTODO") inTodo = true;
    if (upper === "BEGIN:VALARM") inAlarm = true;
    if (upper === "END:VALARM") { inAlarm = false; out.push(line); continue; }
    if (upper === "END:VTODO") {
      out.push(`DTSTAMP:${stamp(now)}`, `LAST-MODIFIED:${stamp(now)}`);
      if (change.summary !== undefined) out.push(`SUMMARY:${esc(change.summary)}`);
      if (change.done !== undefined) out.push(`STATUS:${change.done ? "COMPLETED" : "NEEDS-ACTION"}`, ...(change.done ? [`COMPLETED:${stamp(now)}`, "PERCENT-COMPLETE:100"] : []));
      if (change.due) out.push(`DUE:${stamp(change.due)}`);
      inTodo = false;
      out.push(line);
      continue;
    }
    if (inTodo && !inAlarm) {
      const name = line.split(/[:;]/)[0]?.toUpperCase() ?? "";
      if (drop.has(name)) continue;
    }
    out.push(line);
  }
  return out.map(fold).join("\r\n") + "\r\n";
}

const NS = `xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"`;
export const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?><D:propfind ${NS}><D:prop><D:resourcetype/><D:displayname/></D:prop></D:propfind>`;
export const QUERY_BODY = `<?xml version="1.0" encoding="utf-8"?><C:calendar-query ${NS}><D:prop><D:getetag/><C:calendar-data/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VTODO"/></C:comp-filter></C:filter></C:calendar-query>`;
export function mkcalendarBody(name: string, color = "#7c6cf0"): string {
  const x = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c);
  return `<?xml version="1.0" encoding="utf-8"?><C:mkcalendar ${NS} xmlns:I="http://apple.com/ns/ical/"><D:set><D:prop><D:displayname>${x(name)}</D:displayname><C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set><I:calendar-color>${x(color)}</I:calendar-color></D:prop></D:set></C:mkcalendar>`;
}

const decode = (s: string): string => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#13;/g, "\r").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (name: string) => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, "i");

/** Pull href, etag and calendar data out of a WebDAV multistatus answer (any namespace prefix). */
export function parseMultistatus(xml: string): { href: string; etag: string; data: string }[] {
  const out: { href: string; etag: string; data: string }[] = [];
  const re = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const block = m[1] ?? "";
    const href = decode(tag("href").exec(block)?.[1] ?? "").trim();
    const data = decode(tag("calendar-data").exec(block)?.[1] ?? "");
    if (href && data) out.push({ href, etag: decode(tag("getetag").exec(block)?.[1] ?? "").trim(), data });
  }
  return out;
}
