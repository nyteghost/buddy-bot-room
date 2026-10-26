import { describe, expect, it } from "vitest";
import { parseManifest } from "@/lib/addons";
import { readFileSync } from "node:fs";

const good = { id: "hello", name: "Hello", permissions: ["commands", "window", "jobs"], commands: [{ name: "hello", help: "hi" }], window: { title: "Hello" }, jobs: [{ id: "tick", everyMinutes: 60 }] };

describe("add-on manifests", () => {
  it("accepts the example add-on", () => {
    const raw = JSON.parse(readFileSync("examples/addons/hello/addon.json", "utf8"));
    const r = parseManifest(raw, "hello");
    expect(r.ok).toBe(true);
  });
  it("fills in defaults", () => {
    const r = parseManifest(good, "hello");
    if (!r.ok) throw new Error(r.problems.join());
    expect(r.manifest.main).toBe("server.mjs");
    expect(r.manifest.window?.entry).toBe("window.html");
  });
  it("rejects a folder/id mismatch, unknown permissions and path tricks", () => {
    expect(parseManifest(good, "other")).toMatchObject({ ok: false });
    expect(parseManifest({ ...good, permissions: ["commands", "window", "jobs", "root"] }, "hello")).toMatchObject({ ok: false });
    expect(parseManifest({ ...good, main: "../../etc/passwd" }, "hello")).toMatchObject({ ok: false });
    expect(parseManifest({ ...good, window: { entry: "../x.html" } }, "hello")).toMatchObject({ ok: false });
  });
  it("needs the permission for what it uses", () => {
    expect(parseManifest({ ...good, permissions: ["window"] }, "hello")).toMatchObject({ ok: false });
    expect(parseManifest({ ...good, jobs: [{ id: "x", everyMinutes: 0 }] }, "hello")).toMatchObject({ ok: false });
  });
});
