import { interactionPal } from "./discord";
import { DISCORD_COMMANDS, discordAllowed, discordConfig, interactionQuestion, type DiscordConfig, type DiscordInteraction } from "./discord";
import { askDiscordCompanion } from "./assistant.server";
import { logServer } from "./server-log.server";

/** Outbound-only, owner-bound Discord Gateway. No message-content intent or public HTTP endpoint. */
const API = "https://discord.com/api/v10";
type Run = { key: string; active: boolean; socket?: WebSocket; heartbeat?: ReturnType<typeof setInterval>; retry?: ReturnType<typeof setTimeout>; failures: number; sequence: number | null; connected: boolean };
const holder = globalThis as unknown as { __pixelDiscordRun?: Run };
const config = () => discordConfig(process.env);
export const discordEnabled = (): boolean => config() !== null;
async function api(path: string, method: string, body: unknown, botToken?: string): Promise<Response> {
  return fetch(API + path, {
    method,
    headers: { "content-type": "application/json", "user-agent": "PixelPals-DiscordCompanion",
      ...(botToken ? { authorization: "Bot " + botToken } : {}) },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12000),
  });
}
export async function testDiscordConnection(): Promise<{ ok: boolean; note: string }> {
  const cfg = config();
  if (!cfg) return { ok: false, note: "Complete the Discord IDs, bot token and Enable switch first." };
  try {
    const [bot, guild] = await Promise.all([api("/users/@me", "GET", null, cfg.token), api("/guilds/" + cfg.guildId, "GET", null, cfg.token)]);
    if (!bot.ok) return { ok: false, note: "Discord rejected the bot token (HTTP " + bot.status + ")." };
    if (!guild.ok) return { ok: false, note: "The token works, but the bot is not in that server or the server ID is wrong." };
    return { ok: true, note: holder.__pixelDiscordRun?.connected ? "Connected! Use /ping in your Discord server." : "Bot and server verified. Waiting for the Gateway connection." };
  } catch { return { ok: false, note: "Couldn't contact Discord from Unraid. Check internet access and DNS." }; }
}
async function register(cfg: DiscordConfig): Promise<void> {
  try {
    const response = await api("/applications/" + cfg.appId + "/guilds/" + cfg.guildId + "/commands", "PUT", DISCORD_COMMANDS, cfg.token);
    if (!response.ok) logServer("warn", "Discord command registration failed (HTTP " + response.status + "). Check the application ID.");
    else logServer("info", "Discord Companion slash commands registered");
  } catch { logServer("warn", "Discord command registration couldn't connect"); }
}
const content = (message: string) => ({ content: message.slice(0, 1900), allowed_mentions: { parse: [] as string[] } });
async function reply(i: DiscordInteraction, body: unknown): Promise<boolean> {
  try { return (await api("/interactions/" + i.id + "/" + i.token + "/callback", "POST", body)).ok; } catch { return false; }
}
async function finish(i: DiscordInteraction, message: string): Promise<void> {
  try { await api("/webhooks/" + i.application_id + "/" + i.token + "/messages/@original", "PATCH", content(message)); }
  catch { logServer("warn", "Discord couldn't deliver a completed response"); }
}
async function onInteraction(i: DiscordInteraction, cfg: DiscordConfig): Promise<void> {
  if (i.type !== 2 || i.application_id !== cfg.appId) return;
  const user = i.member?.user?.id ?? i.user?.id;
  if (!discordAllowed(user, i.guild_id, cfg)) {
    await reply(i, { type: 4, data: { ...content("Only the configured owner may use this command in the configured server."), flags: 64 } });
    return;
  }
  if (i.data?.name === "ping") {
    await reply(i, { type: 4, data: { ...content("Pixel Pals Discord Companion is connected."), flags: 64 } }); return;
  }
  if (i.data?.name === "help") {
    await reply(i, { type: 4, data: { ...content("Use /ask question:... to talk to Pixel Pals' local AI. Conversation history is saved in General Chat. Choose the optional pal field to pick who answers. Use /ping to check the bot. Voice recording is not included yet."), flags: 64 } }); return;
  }
  const question = interactionQuestion(i);
  const pal=interactionPal(i);
  if(!pal){await reply(i,{type:4,data:{...content("Choose a Pal from the /ask options."),flags:64}});return;}
  if (!question) { await reply(i, { type: 4, data: { ...content("Use /ask and enter a question (up to 1800 characters)."), flags: 64 } }); return; }
  // Discord requires the initial acknowledgement within three seconds.
  if (!(await reply(i, { type: 5, data: { flags: 64 } }))) return;
  const result = await askDiscordCompanion(question,pal);
  await finish(i, result.text || "No answer was returned.");
}
function stop(run: Run): void {
  run.active = false; run.connected = false;
  if (run.retry) clearTimeout(run.retry);
  if (run.heartbeat) clearInterval(run.heartbeat);
  try { run.socket?.close(1000, "Reconfiguring"); } catch { /* already disconnected */ }
}
function retry(run: Run, cfg: DiscordConfig): void {
  if (!run.active || holder.__pixelDiscordRun !== run) return;
  if (run.heartbeat) clearInterval(run.heartbeat);
  delete run.heartbeat;
  run.connected = false;
  const delay = Math.min(60000, 1500 * 2 ** Math.min(5, run.failures++));
  run.retry = setTimeout(() => { void connect(run, cfg); }, delay);
  run.retry.unref?.();
}
async function connect(run: Run, cfg: DiscordConfig): Promise<void> {
  if (!run.active || holder.__pixelDiscordRun !== run) return;
  try {
    const r = await api("/gateway/bot", "GET", null, cfg.token);
    if (!r.ok) throw Error("Gateway unavailable");
    const { url } = (await r.json()) as { url?: string };
    if (!url?.startsWith("wss://")) throw Error("Invalid Discord gateway");
    const ws = new WebSocket(url + (url.includes("?") ? "&" : "?") + "v=10&encoding=json");
    run.socket = ws;
    ws.addEventListener("message", (event) => {
      if (!run.active || run.socket !== ws) return;
      try {
        const msg = JSON.parse(String(event.data)) as { op: number; s?: number | null; t?: string; d?: Record<string, unknown> };
        if (typeof msg.s === "number") run.sequence = msg.s;
        if (msg.op === 10) {
          const ms = Math.max(1000, Number(msg.d?.["heartbeat_interval"]) || 45000);
          run.heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 1, d: run.sequence }));
          }, ms);
          run.heartbeat.unref?.();
          ws.send(JSON.stringify({ op: 2, d: { token: cfg.token, intents: 1, properties: { os: "linux", browser: "pixel-pals", device: "pixel-pals" } } }));
        } else if (msg.op === 1 && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ op: 1, d: run.sequence }));
        } else if (msg.op === 7 || msg.op === 9) ws.close();
        else if (msg.op === 0 && msg.t === "READY") {
          run.connected = true; run.failures = 0;
          logServer("info", "Discord Companion Gateway connected");
          void register(cfg);
        } else if (msg.op === 0 && msg.t === "INTERACTION_CREATE" && msg.d) {
          void onInteraction(msg.d as unknown as DiscordInteraction, cfg).catch(() => logServer("warn", "Discord interaction failed"));
        }
      } catch { logServer("warn", "Discord Gateway sent an unreadable message"); }
    });
    ws.addEventListener("close", () => { if (run.active && run.socket === ws) retry(run, cfg); });
    ws.addEventListener("error", () => { try { ws.close(); } catch { /* disconnected */ } });
  } catch { logServer("warn", "Discord connection unavailable; retrying"); retry(run, cfg); }
}
/** Idempotent; updating settings closes old connections and turns the bot off safely. */
export function startDiscord(): void {
  const cfg = config();
  const previous = holder.__pixelDiscordRun;
  const key = cfg ? [cfg.token, cfg.appId, cfg.guildId, cfg.ownerId].join("|") : "";
  if (previous?.active && cfg && previous.key === key) return;
  if (previous) stop(previous);
  if (!cfg) { delete holder.__pixelDiscordRun; return; }
  const run: Run = { key, active: true, failures: 0, sequence: null, connected: false };
  holder.__pixelDiscordRun = run;
  void connect(run, cfg);
}
