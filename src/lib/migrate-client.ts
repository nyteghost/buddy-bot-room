import { runMigrations, type KV } from "./migrate";
import { CLIENT_VERSION_KEY, clientMigrations } from "./migrations";

const localKV: KV = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { localStorage.setItem(k, v); },
  remove: (k) => { try { localStorage.removeItem(k); } catch { /* optional storage */ } },
};

/** Brings the saved settings in this browser up to the current format (once per page load). Safe to call anywhere; does nothing on the server.
 *  A migration that changes a key read during the first render should write a NEW key name (the "-v2" habit) instead of editing the old one. */
export function runClientMigrations(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  void runMigrations(localKV, clientMigrations, CLIENT_VERSION_KEY).catch(() => undefined);
}
