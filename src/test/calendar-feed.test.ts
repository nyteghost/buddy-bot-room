import { afterEach, describe, expect, it, vi } from "vitest";
import { publicCalendarAddress, safeCalendarUrl, fetchCalendarSnapshot, removeUnsubscribedCalendarSnapshots } from "@/lib/calendar-feed.server";
import { randomUUID, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile, readdir } from "node:fs/promises";

let folder = "";
afterEach(async () => {
  vi.unstubAllEnvs();
  if (folder) await rm(folder, { recursive: true, force: true });
  folder = "";
});
describe("Calendar subscription boundary", () => {
  it("rejects credentials, local networks, HTTP, redirects and nonpublic DNS responses", async () => {
    const resolver = async () => ["8.8.8.8"];
    expect(await safeCalendarUrl("webcal://calendar.example.com/secret.ics", resolver))
      .toBe("https://calendar.example.com/secret.ics");
    await expect(safeCalendarUrl("http://calendar.example.com/secret.ics", resolver)).rejects.toThrow();
    await expect(safeCalendarUrl("https://user:pass@calendar.example.com/feed", resolver)).rejects.toThrow();
    await expect(safeCalendarUrl("https://127.0.0.1/private.ics", resolver)).rejects.toThrow();
    await expect(safeCalendarUrl("https://service.local.ics/my.ics", async () => ["192.168.1.23"])).rejects.toThrow();
    await expect(safeCalendarUrl("https://calendar.example.com/feed", async () => ["8.8.8.8", "10.0.0.4"])).rejects.toThrow();
  });
  it("blocks internal IP ranges but allows public IPv4 and IPv6", () => {
    for (const value of ["127.0.0.1", "10.1.2.3", "192.168.12.4", "172.24.0.5",
      "169.254.169.254", "100.64.0.1", "198.19.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1"]) {
      expect(publicCalendarAddress(value), value).toBe(false);
    }
    expect(publicCalendarAddress("8.8.8.8")).toBe(true);
    expect(publicCalendarAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("removes an ICS cache snapshot when the owner unsubscribes", async () => {
    folder = await mkdtemp(join(tmpdir(), "calendar-delete-"));
    vi.stubEnv("BUDDY_DATA_DIR", folder);
    const removed = "https://calendar.example.com/work-private.ics?token=hidden";
    const remain = "https://calendar.example.com/personal.ics";
    const key = createHash("sha256").update(removed).digest("hex").slice(0, 40);
    await mkdir(join(folder, "calendar-cache"));
    await writeFile(join(folder, "calendar-cache", key + ".json"), "cached private calendar");
    await removeUnsubscribedCalendarSnapshots(removed + "," + remain, remain);
    expect(await readdir(join(folder, "calendar-cache"))).toEqual([]);
  });
  it("uses hashed private disk snapshots offline without storing the secret link in filenames", async () => {
    folder = await mkdtemp(join(tmpdir(), "calendar-safe-"));
    vi.stubEnv("BUDDY_DATA_DIR", folder);
    const url = "https://calendar.invalid/private?token=" + randomUUID();
    const key = createHash("sha256").update(url).digest("hex").slice(0,40);
    await mkdir(join(folder, "calendar-cache"));
    const now = Date.now();
    const body = "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nEND:VEVENT\nEND:VCALENDAR";
    await writeFile(join(folder, "calendar-cache", key + ".json"), JSON.stringify({ savedAt: now-2000, body }), { mode: 0o600 });
    const recent = await fetchCalendarSnapshot(url, false, now);
    expect(recent.stale).toBe(false);
    expect(recent.cached).toBe(true);
    const old = await fetchCalendarSnapshot(url, true, now);
    expect(old.stale).toBe(true);
    expect(old.text).toBe(body);
    expect((await readdir(join(folder, "calendar-cache"))).join()).not.toContain("token");
  });
});
