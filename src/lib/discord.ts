/** Discord Companion command definitions and explicit owner/guild authorization. No network access here. */
export type DiscordConfig = {
  token: string;
  appId: string;
  ownerId: string;
  guildId: string;
};

const snowflake = (value: string): boolean => /^\d{17,20}$/.test(value);

export function discordConfig(env: Record<string, string | undefined>): DiscordConfig | null {
  const token = (env["DISCORD_BOT_TOKEN"] ?? "").trim();
  const appId = (env["DISCORD_APP_ID"] ?? "").trim();
  const ownerId = (env["DISCORD_OWNER_USER_ID"] ?? "").trim();
  const guildId = (env["DISCORD_GUILD_ID"] ?? "").trim();
  if (env["DISCORD_ENABLED"] !== "on" || !token || !snowflake(appId) || !snowflake(ownerId) || !snowflake(guildId)) return null;
  return { token, appId, ownerId, guildId };
}

export function discordAllowed(userId: string | undefined, guildId: string | undefined, config: Pick<DiscordConfig, "ownerId" | "guildId">): boolean {
  return userId === config.ownerId && guildId === config.guildId;
}

export const DISCORD_COMMANDS = [
  {
    name: "ask",
    description: "Ask your Pixel Pals assistant (saved in General Chat)",
    type: 1,
    options: [{ type: 3, name: "question", description: "What would you like to ask?", required: true, max_length: 1800 }],
  },
  { name: "ping", description: "Check the Pixel Pals Discord bridge", type: 1 },
  { name: "help", description: "How to use the Pixel Pals Discord Companion", type: 1 },
] as const;

export type DiscordInteraction = {
  id: string;
  token: string;
  type: number;
  application_id: string;
  guild_id?: string;
  user?: { id: string };
  member?: { user?: { id: string } };
  data?: { name?: string; options?: { name?: string; value?: unknown }[] };
};

export function interactionQuestion(interaction: DiscordInteraction): string | null {
  if (interaction.type !== 2 || interaction.data?.name !== "ask") return null;
  const value = interaction.data.options?.find((x) => x.name === "question")?.value;
  return typeof value === "string" && value.trim() && value.length <= 1800 ? value.trim() : null;
}
