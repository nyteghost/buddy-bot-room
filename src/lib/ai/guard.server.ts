import { blockedMessage, engineAllowed, isLocalOnly, sameEndpoint } from "../local-only";
import { logServer } from "../server-log.server";
import { strataConfigured, strataPrivateBase } from "../strata.server";

/** Read on every call, so flipping the setting takes effect immediately (saved settings are copied into the environment). */
export const localOnlyOn = (): boolean => isLocalOnly(process.env["LOCAL_ONLY_AI"]);

export class LocalOnlyError extends Error {
  readonly code = "local-only";
  constructor(kind: unknown) { super(blockedMessage(kind)); this.name = "LocalOnlyError"; }
}

/**
 * The one gate every model call passes through. Throws unless the engine is allowed AND, in Local-Only mode,
 * the address really is the approved Ollama (so a wrong base URL can't slip through behind a "local" label).
 */
export function assertInferenceAllowed(kind: unknown, baseUrl: string, approvedLocal: string): void {
  if (!localOnlyOn()) return;
  const approvedStrata = strataConfigured() ? strataPrivateBase(process.env["STRATA_URL"] ?? "") : null;
  const allowed = kind === "strata-server"
    ? !!approvedStrata && baseUrl === approvedStrata
    : kind === "ollama-server" && !!approvedLocal && sameEndpoint(baseUrl, approvedLocal);
  if (!engineAllowed(kind, true) || !allowed) {
    logServer("warn", `local-only: blocked ${String(kind)} call`);
    throw new LocalOnlyError(kind);
  }
}
