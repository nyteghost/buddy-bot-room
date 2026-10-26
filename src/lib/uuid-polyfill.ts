/**
 * Browsers only provide crypto.randomUUID on secure pages (https:// or localhost). Opening Pixel Pals by plain
 * address (http://10.0.0.5:8090) therefore broke every chat message. This adds the same function from
 * crypto.getRandomValues, which works everywhere. It does nothing when the real one exists.
 */
export function randomUuidV4(bytes: Uint8Array): string {
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}

export function installUuidPolyfill(c: Crypto | undefined = typeof crypto === "undefined" ? undefined : crypto): void {
  if (!c || typeof c.randomUUID === "function" || typeof c.getRandomValues !== "function") return;
  Object.defineProperty(c, "randomUUID", {
    configurable: true,
    value: () => randomUuidV4(c.getRandomValues(new Uint8Array(16))),
  });
}

installUuidPolyfill();
