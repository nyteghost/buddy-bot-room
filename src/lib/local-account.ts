/** Settings that follow a Google account in the self-hosted build. Pure validation shared by server and tests. */
export type LocalSettings = { engineKind: string; characterMode: string; groqKey: string; geminiKey: string; openrouterKey: string; nvidiaKey: string };

const KINDS = ["cloud", "local", "auto", "ollama", "auto-ollama"];
const short = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

export function normalizeLocalSettings(v: unknown): LocalSettings | null {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const engineKind = short(r["engineKind"], 20);
  const characterMode = short(r["characterMode"], 40);
  const groqKey = short(r["groqKey"], 500);
  const geminiKey = short(r["geminiKey"], 500);
  const openrouterKey = short(r["openrouterKey"], 500);
  const nvidiaKey = short(r["nvidiaKey"], 500);
  if (engineKind === null || !KINDS.includes(engineKind) || characterMode === null || groqKey === null || geminiKey === null || openrouterKey === null || nvidiaKey === null) return null;
  return { engineKind, characterMode, groqKey, geminiKey, openrouterKey, nvidiaKey };
}

/** A file name for one account that reveals nothing and can't escape the folder. */
export async function accountFileName(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(`pixel-pals-account:${email.trim().toLowerCase()}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("") + ".json";
}
