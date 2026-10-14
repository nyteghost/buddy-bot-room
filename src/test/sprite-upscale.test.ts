import { describe, it, expect } from "vitest";
import { to128 } from "@/lib/sprite-upscale";
import { characterSprite } from "@/lib/character-sprites";
describe("128x128 sprites", () => {
  it("every pal renders on a 128 by 128 grid", () => {
    const g = to128(characterSprite("sage", "linux"));
    expect(g.length).toBe(128);
    expect(g.every((r) => r.length === 128)).toBe(true);
  });
});
