import { describe, expect, it } from "vitest";
import { DISCORD_COMMANDS, discordAllowed, discordConfig, interactionQuestion } from "../lib/discord";

const configured = {
  DISCORD_ENABLED: "on", DISCORD_BOT_TOKEN: "unit-test-token",
  DISCORD_APP_ID: "123456789012345678", DISCORD_OWNER_USER_ID: "223456789012345678",
  DISCORD_GUILD_ID: "323456789012345678",
};
describe("Discord Companion owner-only command guards", () => {
  it("requires explicit enablement, valid ids and a token", () => {
    expect(discordConfig({ ...configured, DISCORD_ENABLED: "off" })).toBeNull();
    expect(discordConfig({ ...configured, DISCORD_BOT_TOKEN: "" })).toBeNull();
    expect(discordConfig({ ...configured, DISCORD_OWNER_USER_ID: "abc" })).toBeNull();
    expect(discordConfig(configured)?.appId).toBe(configured.DISCORD_APP_ID);
  });
  it("requires both the configured owner and the configured server", () => {
    const cfg = discordConfig(configured)!;
    expect(discordAllowed(cfg.ownerId, cfg.guildId, cfg)).toBe(true);
    expect(discordAllowed("999456789012345678", cfg.guildId, cfg)).toBe(false);
    expect(discordAllowed(cfg.ownerId, "999456789012345678", cfg)).toBe(false);
    expect(discordAllowed(undefined, cfg.guildId, cfg)).toBe(false);
  });
  it("accepts only a bounded /ask option", () => {
    const i = { id: "1", token: "test", application_id: configured.DISCORD_APP_ID,
      type: 2, data: { name: "ask", options: [{ name: "question", value: "  How do I start?  " }] } };
    expect(interactionQuestion(i)).toBe("How do I start?");
    expect(interactionQuestion({ ...i, type: 3 })).toBeNull();
    expect(interactionQuestion({ ...i, data: { name: "ping" } })).toBeNull();
    expect(interactionQuestion({ ...i, data: { name: "ask", options: [{ name: "question", value: "x".repeat(1801) }] } })).toBeNull();
  });
  it("registers only explicit slash commands, never reads arbitrary messages", () => {
    expect(DISCORD_COMMANDS.map((x) => x.name)).toEqual(["ask", "ping", "help"]);
  });
});
