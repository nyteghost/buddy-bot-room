import { validSyncData } from "./settings-io";

/** What follows a signed-in account on the self-hosted build: a snapshot of the browser's settings. Pure validation. */
export function normalizeAccountData(v: unknown): { data: Record<string, string> } | null {
  const data = validSyncData((v && typeof v === "object" ? (v as Record<string, unknown>) : {})["data"]);
  return data ? { data } : null;
}

/** A file name for one account that reveals nothing and can't escape the folder. */
export async function accountFileName(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(`pixel-pals-account:${email.trim().toLowerCase()}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("") + ".json";
}
