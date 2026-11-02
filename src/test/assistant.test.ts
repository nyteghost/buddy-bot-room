import { expect, it } from "vitest";
import {
  newMeta,
  newKeeper,
  authorized,
  retrieve,
  contextMessages,
  sensitive,
  cosine,
  type Conversation,
  type Memory,
} from "@/lib/assistant";
const c = (id = "chat0001", project = ""): Conversation => ({
  id,
  title: "Chat",
  theme: "normal",
  mode: "direct",
  messages: [],
  updatedAt: "2026-11-01",
  assistant: { ...newMeta(), project },
});
const m = (scope: Memory["scope"], extra: Partial<Memory> = {}): Memory => ({
  id: scope,
  title: "Ollama host",
  text: "Ollama runs as a systemd service on CachyOS",
  scope,
  project: "homelab",
  conversation: "chat0001",
  status: "active",
  pinned: false,
  verified: true,
  confidence: 1,
  created: "2026-11-01",
  updated: "2026-11-01",
  revision: 1,
  key: "ollama",
  sources: [],
  conflicts: [],
  versions: [],
  ...extra,
});
it("enforces global, project, conversation and explicit private grants independently", () => {
  const home = c("chat0001", "homelab"),
    food = c("chat0002", "food");
  expect(authorized(m("global"), food)).toBe(true);
  expect(authorized(m("project"), home)).toBe(true);
  expect(authorized(m("project"), food)).toBe(false);
  expect(authorized(m("conversation"), food)).toBe(false);
  expect(authorized(m("private"), home)).toBe(false);
  home.assistant.privateIds = ["private"];
  expect(authorized(m("private"), home)).toBe(true);
  expect(authorized(m("private", { status: "deleted" }), home)).toBe(false);
});
it("does not inject unrelated project history or all memories into a general question", () => {
  const s = newKeeper();
  s.records = [
    m("global"),
    m("project", { id: "food", project: "food", text: "Food prep recipes and protein powder" }),
    m("project", {
      id: "showpilot",
      project: "showpilot",
      text: "ShowPilot engineering schedule rules",
    }),
    m("global", { id: "unrelated", title: "Recipe", text: "Use rice for lunch" }),
  ];
  const result = retrieve("How do I restart Ollama?", c(), s);
  expect(result.map((x) => x.id)).toEqual(["global"]);
  expect(retrieve("completely unrelated zzzz", c(), s)).toEqual([]);
});
it("combines keyword and semantic scores without crossing privacy boundaries", () => {
  const s = newKeeper();
  s.records = [
    m("project"),
    m("global", {
      id: "semantic",
      title: "Linux services",
      text: "Use systemctl to control the daemon",
    }),
  ];
  expect(
    retrieve("restart Ollama", c(), s, 2400, { project: 1, semantic: 0.9 }).map((x) => x.id),
  ).toEqual(["semantic"]);
  expect(cosine([1, 0], [1, 0])).toBe(1);
  expect(cosine([0, 0], [1, 0])).toBe(0);
});
it("bounds retrieved context and removes duplicate facts", () => {
  const s = newKeeper();
  s.records = Array.from({ length: 20 }, (_, i) =>
    m("global", {
      id: String(i),
      text: i < 2 ? "Ollama systemd service" : "Ollama " + String(i).repeat(300),
    }),
  );
  const result = retrieve("Ollama", c(), s, 500);
  expect(result.length).toBeLessThanOrEqual(2);
  expect(result.reduce((n, x) => n + x.text.length + 100, 0)).toBeLessThanOrEqual(500);
});
it("withholds deleted sources and stale memory-backed answers, preserving stored transcript", () => {
  const chat = c();
  const s = newKeeper();
  chat.messages = [
    { id: "source", role: "user", parts: [{ type: "text", text: "Old fact" }] },
    {
      id: "answer",
      role: "assistant",
      parts: [{ type: "text", text: "Old repeated fact" }],
      metadata: { memoryIds: ["global"], memoryEpoch: 1 },
    },
    { id: "latest", role: "user", parts: [{ type: "text", text: "New question" }] },
  ];
  s.epoch = 2;
  s.suppressed = ["chat0001:source"];
  expect(contextMessages(chat, s, 1000).map((x) => x.id)).toEqual(["latest"]);
  expect(chat.messages).toHaveLength(3);
});
it("detects credential material without rejecting ordinary questions about keys", () => {
  for (const text of [
    "API_KEY=abcdefghijk",
    "my password is hunter22",
    "Authorization: Bearer abcdefghijklmn",
    "-----BEGIN RSA PRIVATE KEY-----",
  ])
    expect(sensitive(text)).toBe(true);
  expect(sensitive("How do I create an API key for Ollama?")).toBe(false);
});
