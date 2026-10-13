import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("preview React runtime stability", () => {
  it("does not serve fresh optimized modules under stale React URLs", () => {
    const config = readFileSync("vite.config.ts", "utf8");
    expect(config).toContain("ignoreOutdatedRequests: false");
    expect(config).toContain("noDiscovery: true");
    for (const dependency of ["@mlc-ai/web-llm", "streamdown", "@radix-ui/react-select"]) {
      expect(config).toContain(`"${dependency}"`);
    }
  });
  it("can render the error fallback without a working hook dispatcher", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    const fallback = root.slice(root.indexOf("function ErrorComponent"), root.indexOf("export const Route"));
    expect(fallback).not.toMatch(/\buse[A-Z]\w*\(/);
    expect(fallback).toContain("window.location.reload()");
  });
});