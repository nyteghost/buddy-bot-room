import { describe, expect, it } from "vitest";
import { filterSetupItems, groupItems, INTEGRATIONS } from "@/lib/setup";
import { SETTING_FIELDS } from "@/lib/settings";

const items = INTEGRATIONS.map((item) => ({ ...item, configured: item.id === "discord" || item.id === "ollama" }));
describe("Settings navigation and search", () => {
  it("keeps every integration discoverable inside exactly one category", () => {
    const grouped = groupItems(items).flatMap((g) => g.items.map((item) => item.id));
    expect(new Set(grouped).size).toBe(items.length);
    expect(grouped.length).toBe(items.length);
  });
  it("finds Discord by its user-facing fields and preserves status filters", () => {
    expect(filterSetupItems(items, SETTING_FIELDS, "discord").map((i) => i.id)).toEqual(["discord"]);
    expect(filterSetupItems(items, SETTING_FIELDS, "bot token").map((i) => i.id)).toContain("discord");
    expect(filterSetupItems(items, SETTING_FIELDS, "bot token", "unconfigured").map((i) => i.id)).toEqual(["telegram"]);
    expect(filterSetupItems(items, SETTING_FIELDS, "bot token", "configured").map((i) => i.id)).toEqual(["discord"]);
  });
  it("finds calendar feeds and Obsidian without exposing stored secret values", () => {
    expect(filterSetupItems(items, SETTING_FIELDS, "calendar feed").some((i) => i.id === "calendar")).toBe(true);
    expect(filterSetupItems(items, SETTING_FIELDS, "vault folder").some((i) => i.id === "obsidian")).toBe(true);
    expect(filterSetupItems(items, SETTING_FIELDS, "no such integration")).toEqual([]);
  });
});
