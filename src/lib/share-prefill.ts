/**
 * Text handed to Pixel Pals through the address (an iPhone Shortcut's share-sheet action, or Android's share menu):
 * /?q=...  and optionally &title=...&url=... . Pure. Returns "" when there is nothing to prefill.
 */
export function sharedText(search: string, max = 2000): string {
  const p = new URLSearchParams(search);
  const parts: string[] = [];
  for (const k of ["title", "q", "text", "url"]) {
    const v = (p.get(k) ?? "").trim();
    if (v && !parts.some((x) => x.includes(v))) parts.push(v);
  }
  return parts.join("\n").slice(0, max);
}
