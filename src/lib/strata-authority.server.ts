/**
 * Protected Strata invocation gate. Server-held credentials are privileged even
 * when the legacy optional account/shared-password installation mode is enabled.
 * This check runs for every request-facing askPals call and before Pal inference.
 *
 * Unattended authority is deliberately scoped to a persisted, explicitly
 * approved running Working Pal, or the owner's configured Telegram chat.
 * Merely retaining an owner's engine settings grants no authority.
 */
import { readFile } from "node:fs/promises";
import { accountsEnabled } from "./accounts";
import { currentUser, ownerName } from "./accounts.server";
import { validMission, type PalMission } from "./working-pals";

export type StrataAuthority =
  | { kind: "owner-request"; request: Request }
  | { kind: "approved-working-pal"; missionId: string; revision: number }
  | { kind: "owner-telegram"; chatId: string };

export class StrataOwnerError extends Error {
  readonly code = "owner-auth";
  constructor() {
    super("Owner sign-in or explicitly approved unattended authority is required for protected Strata inference.");
    this.name = "StrataOwnerError";
  }
}

const dataDir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const telegramEnabled = () => /^\d+:[\w-]{20,}$/.test((process.env["TELEGRAM_BOT_TOKEN"] ?? "").trim());

export async function assertStrataAuthority(authority?: StrataAuthority): Promise<void> {
  // Fail closed even if signed owner cookies, saved engine settings, or old
  // working mission files exist but accounts are administratively disabled.
  if (!accountsEnabled(process.env) || !authority) throw new StrataOwnerError();
  if (authority.kind === "owner-request") {
    const user = await currentUser(authority.request);
    if (user?.owner) return;
    throw new StrataOwnerError();
  }
  // Both unattended modes also require a real persisted owner account, not just
  // a retained legacy owner settings file or a caller-supplied owner flag.
  if (!(await ownerName())) throw new StrataOwnerError();
  if (authority.kind === "owner-telegram") {
    const configuredChatId = (process.env["TELEGRAM_CHAT_ID"] ?? "").trim();
    if (telegramEnabled() && configuredChatId && authority.chatId === configuredChatId) return;
    throw new StrataOwnerError();
  }
  if (authority.kind === "approved-working-pal") {
    if (!/^[0-9a-f-]{36}$/i.test(authority.missionId) ||
        !Number.isSafeInteger(authority.revision) || authority.revision < 1)
      throw new StrataOwnerError();
    try {
      const rows: unknown = JSON.parse(await readFile(dataDir() + "/working-pals.json", "utf8"));
      if (Array.isArray(rows) && rows.length <= 50) {
        const mission = rows.find((x: unknown): x is PalMission =>
          validMission(x) && x.id === authority.missionId);
        // The runner advances a previously approved mission into running state.
        // Status, approval, revision, and the validated read-only execution
        // intent must all match, so stale/revoked proposals cannot infer.
        if (mission?.status === "running" && mission.approvedAt && mission.startedAt &&
            mission.revision === authority.revision && mission.source === "owner-ui" &&
            mission.execution === "local-summary-only") return;
      }
    } catch { /* invalid/missing mission store is never authority */ }
  }
  throw new StrataOwnerError();
}
