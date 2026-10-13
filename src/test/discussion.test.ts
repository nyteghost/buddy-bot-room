import { describe, expect, it } from "vitest";
import { contextForMode, type RoomMessage } from "@/lib/agents";

const transcript: RoomMessage[] = [
  { id: "human", role: "user", parts: [{ type: "text", text: "Discuss cities" }] },
  {
    id: "nova",
    role: "assistant",
    parts: [{ type: "text", text: "Build greener cities" }],
    metadata: { agentId: "nova" },
  },
  {
    id: "byte",
    role: "assistant",
    parts: [{ type: "text", text: "Start with transit" }],
    metadata: { agentId: "byte" },
  },
];
describe("Discussion visibility", () => {
  it("roundtable participants see each earlier reply", () => {
    expect(contextForMode(transcript, "roundtable").map((m) => m.id)).toEqual([
      "human",
      "nova",
      "byte",
    ]);
  });
  it("broadcast participants cannot see other replies", () => {
    expect(contextForMode(transcript, "broadcast").map((m) => m.id)).toEqual(["human"]);
  });
});
