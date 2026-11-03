import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { currentUser } from "@/lib/accounts.server";
import { handleCalendarUploads, calendarUploads } from "@/lib/calendar-uploads.server";
vi.mock("@/lib/accounts.server", () => ({ currentUser: vi.fn() }));
let dir = "";
const api = (data?: unknown) =>
  handleCalendarUploads(
    new Request(
      "http://localhost/api/calendar?uploads=1",
      data ? { method: "POST", body: JSON.stringify(data) } : {},
    ),
  );
const sample = {
  op: "import",
  confirm: true,
  name: "Personal",
  color: "#123456",
  body: "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR",
};
beforeEach(async () => {
  dir = await mkdtemp(tmpdir() + "/calendar-import-");
  vi.stubEnv("BUDDY_DATA_DIR", dir);
  vi.mocked(currentUser).mockResolvedValue({ username: "owner", owner: true });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
it("requires owner and explicit transfer permission", async () => {
  vi.mocked(currentUser).mockResolvedValueOnce(null);
  expect((await api(sample)).status).toBe(403);
  expect((await api({ ...sample, confirm: false })).status).toBe(400);
  expect(await calendarUploads()).toEqual([]);
});
it("retains protected originals, prevents duplicate retries and returns metadata only", async () => {
  await api(sample);
  await api(sample);
  const data = await (await api()).json();
  expect(data.snapshots).toHaveLength(1);
  expect(data.snapshots[0].body).toBeUndefined();
  expect((await stat(dir + "/calendar-uploads.json")).mode & 0o777).toBe(0o600);
  const row = data.snapshots[0];
  await api({ op: "visibility", id: row.id, revision: row.revision, enabled: false });
  expect((await calendarUploads())[0]?.body).toBe(sample.body);
  expect((await calendarUploads())[0]?.enabled).toBe(false);
  expect(
    (await api({ op: "visibility", id: row.id, revision: row.revision, enabled: true })).status,
  ).toBe(409);
});
it("refuses invalid imports and corruption without replacing saved data", async () => {
  expect((await api({ ...sample, body: "not ICS" })).status).toBe(400);
  await writeFile(dir + "/calendar-uploads.json", "bad data");
  expect((await api(sample)).status).toBe(400);
  expect(await readFile(dir + "/calendar-uploads.json", "utf8")).toBe("bad data");
});
