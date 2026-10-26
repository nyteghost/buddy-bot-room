/**
 * Local-Only AI mode: when on (the default), every model call goes to the Ollama on your own server and nothing else,
 * so no free-tier key, paid key or custom endpoint can be used by accident, by a scheduled job or by a retry.
 * Pure helpers; the server-side guard that uses them is in ai/guard.server.ts.
 */
export const LOCAL_ENGINE = "ollama-server";

/** ON unless explicitly turned off ("off", "0", "false", "no"). An empty or missing value means ON. */
export function isLocalOnly(value: string | undefined | null): boolean {
  return !["off", "0", "false", "no"].includes((value ?? "").trim().toLowerCase());
}

/** Whether an engine kind may run. In Local-Only mode only the stack's own Ollama may. */
export function engineAllowed(kind: unknown, localOnly: boolean): boolean {
  return !localOnly || kind === LOCAL_ENGINE;
}

export function blockedMessage(kind: unknown): string {
  const name = typeof kind === "string" && kind ? kind : "that engine";
  return `Local-Only AI mode is on, so ${name} is blocked. Choose Local AI (Ollama) in engine settings, or turn Local-Only AI off in Settings → Local AI.`;
}

/** The same host, port and scheme: used to prove a request really goes to the approved Ollama address. */
export function sameEndpoint(url: string, approved: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(approved);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}
