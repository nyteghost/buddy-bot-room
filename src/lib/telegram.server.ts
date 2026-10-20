import { logServer } from "./server-log.server";
import { askPals } from "./ask.server";
import { captureFromText } from "./capture.server";
import { collectStatus } from "./status.server";

/**
 * Optional Telegram bot: message your pals from your phone. TELEGRAM_BOT_TOKEN comes from @BotFather;
 * TELEGRAM_CHAT_ID is the only chat allowed to talk to it (everyone else is ignored). Long-polling, so no public URL is needed.
 */
const token = () => (process.env["TELEGRAM_BOT_TOKEN"] ?? "").trim();
const allowed = () => (process.env["TELEGRAM_CHAT_ID"] ?? "").trim();
export const telegramEnabled = (): boolean => /^\d+:[\w-]{20,}$/.test(token());

const api = (method: string) => `https://api.telegram.org/bot${token()}/${method}`;

export async function telegramSend(text: string, chatId = allowed()): Promise<boolean> {
  if (!telegramEnabled() || !chatId) return false;
  try {
    const res = await fetch(api("sendMessage"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3800) }), signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
}

type Update = { update_id: number; message?: { chat?: { id?: number }; text?: string } };

/** What to answer for one incoming message. Exported for tests. */
export async function handleTelegramText(text: string, chatId: string): Promise<string | null> {
  const want = allowed();
  if (!want) return `Your chat id is ${chatId}. Set TELEGRAM_CHAT_ID=${chatId} on the server and restart to let this chat talk to your pals.`;
  if (chatId !== want) return null;
  const t = text.trim();
  if (!t) return null;
  if (/^\/(start|help)\b/i.test(t)) return "Hi! Send any question and your pals will answer using your free keys or Local AI. Start a message with note:, todo:, remember: or remind (for example: remind me in 1h stretch) to save it instead. /status checks your services. Paid providers are never used from here.";
  if (/^\/status\b/i.test(t)) return collectStatus();
  const sn = /^\/?snooze(?:\s+(.*))?$/i.exec(t);
  if (sn) return (await import("./reminders.server")).snooze("", (sn[1] ?? "").trim());
  const captured = await captureFromText(t);
  if (captured) return captured;
  const r = await askPals(t.startsWith("/") ? t.slice(1) : t);
  return r.ok ? `${r.text}\n\n— ${r.via}` : `Couldn't answer: ${r.error}`;
}

const holder = globalThis as unknown as { __buddyTelegram?: boolean };

export function startTelegram(): void {
  if (holder.__buddyTelegram || !telegramEnabled()) return;
  holder.__buddyTelegram = true;
  logServer("info", "Telegram bot started");
  void (async () => {
    let offset = 0;
    let wait = 2000;
    for (;;) {
      try {
        const res = await fetch(`${api("getUpdates")}?timeout=25&offset=${offset}`, { signal: AbortSignal.timeout(35_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { result?: Update[] };
        wait = 2000;
        for (const u of json.result ?? []) {
          offset = u.update_id + 1;
          const chat = u.message?.chat?.id;
          const text = u.message?.text;
          if (chat === undefined || !text) continue;
          const reply = await handleTelegramText(text, String(chat)).catch(() => "Something went wrong on the server.");
          if (reply) await telegramSend(reply, String(chat));
        }
      } catch (e) {
        logServer("warn", `Telegram poll failed: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`);
        await new Promise((r) => setTimeout(r, wait));
        wait = Math.min(wait * 2, 60_000);
      }
    }
  })();
}
