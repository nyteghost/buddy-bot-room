// AES-GCM via WebCrypto (works on the edge runtime). Output: base64(iv | ciphertext+tag).
async function key() {
  const raw = process.env["SETTINGS_ENCRYPTION_KEY"];
  if (!raw) throw new Error("Settings encryption is not configured.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptText(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64(out);
}

export async function decryptText(stored: string) {
  const buf = unb64(stored);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, await key(), buf.subarray(12));
  return new TextDecoder().decode(plain);
}
