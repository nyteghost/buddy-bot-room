import { describe, expect, it } from "vitest";
import { installUuidPolyfill, randomUuidV4 } from "@/lib/uuid-polyfill";

describe("crypto.randomUUID polyfill (plain-http pages)", () => {
  it("makes a valid version-4 UUID", () => {
    const id = randomUuidV4(new Uint8Array(16).fill(255));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("adds randomUUID when the page has none, and leaves a real one alone", () => {
    const fake = { getRandomValues: (a: Uint8Array) => { a.forEach((_, i) => (a[i] = (i * 17) & 255)); return a; } } as unknown as Crypto;
    installUuidPolyfill(fake);
    expect(typeof fake.randomUUID).toBe("function");
    expect(fake.randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
    const real = { randomUUID: () => "real", getRandomValues: () => new Uint8Array(16) } as unknown as Crypto;
    installUuidPolyfill(real);
    expect(real.randomUUID()).toBe("real");
  });
  it("gives different ids with real randomness", () => {
    expect(randomUuidV4(crypto.getRandomValues(new Uint8Array(16)))).not.toBe(randomUuidV4(crypto.getRandomValues(new Uint8Array(16))));
  });
});
