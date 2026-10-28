import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearFirstRunSetupCode, firstRunSetupCode } from "@/lib/first-setup.server";

let path: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (path) await rm(path, { recursive: true, force: true });
  path = undefined;
});

describe("protected first-owner setup", () => {
  it("uses an explicit BUDDY_PASSWORD without writing a token", async () => {
    vi.stubEnv("BUDDY_PASSWORD", "My-Existing-Setup-Code");
    expect(await firstRunSetupCode()).toBe("My-Existing-Setup-Code");
  });

  it("creates a random private setup code and reuses it until account creation", async () => {
    path = await mkdtemp(join(tmpdir(), "pixelpals-first-run-"));
    vi.stubEnv("BUDDY_PASSWORD", "");
    vi.stubEnv("BUDDY_DATA_DIR", path);
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = await firstRunSetupCode();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(await firstRunSetupCode()).toBe(first);
    expect((await readFile(join(path, "initial-setup.code"), "utf8")).trim()).toBe(first);
    expect((await stat(join(path, "initial-setup.code"))).mode & 0o777).toBe(0o600);
    expect(log).toHaveBeenCalled();
    await clearFirstRunSetupCode();
    await expect(stat(join(path, "initial-setup.code"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
