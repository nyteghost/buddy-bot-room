import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { testSeerrConnection, handleSeerr } from "@/lib/seerr.server";
import { handleSettings } from "@/lib/settings.server";
import { currentUser } from "@/lib/accounts.server";
vi.mock("@/lib/accounts.server", () => ({ currentUser: vi.fn() }));
let dir = "";
const clearState = () => {
  delete (globalThis as typeof globalThis & { __buddySettings?: unknown }).__buddySettings;
};
beforeEach(async () => {
  clearState();
  dir = await mkdtemp(tmpdir() + "/pixel-seerr-settings-");
  vi.stubEnv("BUDDY_DATA_DIR", dir);
  vi.stubEnv("SEERR_URL", "");
  vi.stubEnv("SEERR_API_KEY", "");
  vi.mocked(currentUser).mockResolvedValue({ username: "owner", owner: true });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(async () => {
  clearState();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
it("directs missing configuration to integrations, without old env/restart instructions", async () => {
  const r = await handleSeerr(new Request("http://localhost/api/seerr?q=test"));
  expect(r.status).toBe(503);
  const body = await r.json();
  expect(body.error).toContain("Settings → Integrations");
  expect(body.error).not.toContain(".env");
  expect(fetch).not.toHaveBeenCalled();
});
it("requires both an address and API key before testing", async () => {
  vi.stubEnv("SEERR_URL", "http://seerr.local");
  expect((await testSeerrConnection()).ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it("verifies the API key with a read-only authenticated request to the configured server", async () => {
  vi.stubEnv("SEERR_URL", "http://seerr.local/");
  vi.stubEnv("SEERR_API_KEY", "fixture-secret");
  vi.mocked(fetch).mockResolvedValue(Response.json({ id: 1, email: "owner@example.test" }));
  const result = await testSeerrConnection();
  expect(result.ok).toBe(true);
  expect(JSON.stringify(result)).not.toContain("fixture-secret");
  expect(JSON.stringify(result)).not.toContain("owner@example.test");
  expect(fetch).toHaveBeenCalledWith(
    "http://seerr.local/api/v1/auth/me",
    expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({ "X-Api-Key": "fixture-secret" }),
      redirect: "error",
    }),
  );
});
it("reports rejected keys without echoing the upstream response", async () => {
  vi.stubEnv("SEERR_URL", "http://seerr.local");
  vi.stubEnv("SEERR_API_KEY", "fixture-secret");
  vi.mocked(fetch).mockResolvedValue(Response.json({ error: "fixture-secret" }, { status: 401 }));
  const result = await testSeerrConnection();
  expect(result.ok).toBe(false);
  expect(result.note).toContain("rejected");
  expect(JSON.stringify(result)).not.toContain("fixture-secret");
});
it("does not mistake an unrelated successful web page for authenticated Seerr", async () => {
  vi.stubEnv("SEERR_URL", "http://wrong.local");
  vi.stubEnv("SEERR_API_KEY", "fixture-secret");
  vi.mocked(fetch).mockResolvedValue(new Response("<html>Login</html>"));
  expect((await testSeerrConnection()).ok).toBe(false);
});
it("keeps network exceptions and credentials out of connection messages", async () => {
  vi.stubEnv("SEERR_URL", "http://seerr.local");
  vi.stubEnv("SEERR_API_KEY", "fixture-secret");
  vi.mocked(fetch).mockRejectedValue(Error("Internal error fixture-secret"));
  const result = await testSeerrConnection();
  expect(result.ok).toBe(false);
  expect(result.note).not.toContain("fixture-secret");
});
it("saves through owner settings in the existing protected store and works immediately without restarting", async () => {
  const r = await handleSettings(
    new Request("http://localhost/api/settings", {
      method: "POST",
      body: JSON.stringify({
        values: { SEERR_URL: "http://seerr.local", SEERR_API_KEY: "fixture-secret" },
      }),
    }),
  );
  const json = await r.json();
  expect(r.ok).toBe(true);
  expect(JSON.stringify(json)).not.toContain("fixture-secret");
  expect(await readFile(dir + "/app-secrets.json", "utf8")).toContain("fixture-secret");
  expect(await readFile(dir + "/app-settings.json", "utf8")).not.toContain("fixture-secret");
  expect((await stat(dir + "/app-secrets.json")).mode & 0o777).toBe(0o600);
  vi.mocked(fetch).mockResolvedValue(Response.json({ results: [] }));
  expect((await handleSeerr(new Request("http://localhost/api/seerr?q=test"))).ok).toBe(true);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("http://seerr.local/api/v1/search?"),
    expect.objectContaining({
      headers: expect.objectContaining({ "X-Api-Key": "fixture-secret" }),
    }),
  );
});
it("refuses settings changes without owner authorization", async () => {
  vi.mocked(currentUser).mockResolvedValue(null);
  const r = await handleSettings(
    new Request("http://localhost/api/settings", {
      method: "POST",
      body: JSON.stringify({ values: { SEERR_API_KEY: "fixture-secret" } }),
    }),
  );
  expect(r.status).toBe(403);
  await expect(stat(dir + "/app-secrets.json")).rejects.toThrow();
});
