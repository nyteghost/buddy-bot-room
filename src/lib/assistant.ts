import { scrubChatText } from "./chat-scrub";
import type { RoomMessage } from "./agents";
export type Scope = "global" | "project" | "conversation" | "private";
export type AssistantMeta = {
  choice?: {
    provider: string;
    model: string;
    research: boolean;
    web?: import("./assistant-web").WebMode;
  };
  project: string;
  pinned: boolean;
  status: "active" | "archived" | "deleted";
  deletedAt?: string;
  draft: string;
  collect: "off" | "review" | "auto";
  privateIds: string[];
  summary: string;
  summaryThrough: number;
  summaryEpoch: number;
  processed: number;
  provider?: { kind: string; model: string };
  continuation?: { id: string; epoch: number; text: string };
  revision: number;
  suggestions?: { project?: string; title?: string; archive?: boolean };
};
export type Conversation = {
  id: string;
  title: string;
  messages: RoomMessage[];
  theme: string;
  mode: string;
  updatedAt: string;
  owner?: string;
  shared?: boolean;
  assistant: AssistantMeta;
};
export type Memory = {
  category?: "fact" | "idea";
  origin?: { capture: string; suggestion: string };
  id: string;
  title: string;
  text: string;
  scope: Scope;
  project: string;
  conversation: string;
  status: "pending" | "active" | "archived" | "deleted";
  pinned: boolean;
  verified: boolean;
  confidence: number;
  created: string;
  updated: string;
  revision: number;
  key: string;
  sources: { conversation: string; message: string; quote: string }[];
  conflicts: string[];
  versions: { text: string; at: string; scope: Scope; project: string; conversation: string }[];
};
export type KeeperJob = {
  conversation: string;
  through: number;
  epoch: number;
  attempts: number;
  next: number;
  state: "pending" | "running" | "failed";
  note: string;
};
export type KeeperState = {
  version: 1;
  epoch: number;
  records: Memory[];
  projects: { id: string; name: string }[];
  jobs: KeeperJob[];
  suppressed: string[];
  forgotten: string[];
  lastSuccess: string;
  activity: { at: string; text: string }[];
  sync: { hashes: Record<string, string>; note: string; at: string };
  vectors: Record<string, { hash: string; model: string; values: number[] }>;
};
export const newMeta = (): AssistantMeta => ({
  project: "",
  pinned: false,
  status: "active",
  draft: "",
  collect: "review",
  privateIds: [],
  summary: "",
  summaryThrough: 0,
  summaryEpoch: 0,
  processed: 0,
  revision: 1,
});
export const newKeeper = (): KeeperState => ({
  version: 1,
  epoch: 1,
  records: [],
  projects: [],
  jobs: [],
  suppressed: [],
  forgotten: [],
  lastSuccess: "",
  activity: [],
  sync: { hashes: {}, note: "Not synced", at: "" },
  vectors: {},
});
export const safeId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export const words = (s: string) =>
  [
    ...new Set(
      normalize(s)
        .split(" ")
        .filter(
          (w) =>
            w.length > 2 &&
            ![
              "the",
              "and",
              "that",
              "with",
              "what",
              "how",
              "this",
              "for",
              "you",
              "are",
              "can",
              "have",
              "from",
              "was",
              "does",
              "about",
            ].includes(w),
        ),
    ),
  ].slice(0, 40);
export function sensitive(text: string): boolean {
  return scrubChatText(text) !== text;
}

export function authorized(
  m: Memory,
  c: Pick<Conversation, "id" | "assistant">,
  pending = false,
): boolean {
  return (
    (m.status === "active" || (pending && m.status === "pending")) &&
    (m.scope === "global" ||
      (m.scope === "project" && !!c.assistant.project && m.project === c.assistant.project) ||
      (m.scope === "conversation" && m.conversation === c.id) ||
      (m.scope === "private" && c.assistant.privateIds.includes(m.id)))
  );
}
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let sum = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
    aa += a[i]! ** 2;
    bb += b[i]! ** 2;
  }
  return aa && bb ? sum / Math.sqrt(aa * bb) : 0;
}
export function retrieve(
  query: string,
  c: Conversation,
  state: KeeperState,
  budget = 2400,
  semantic: Record<string, number> = {},
): Memory[] {
  const tokens = words(query);
  const seen = new Set<string>();
  let used = 0;
  return state.records
    .filter((m) => authorized(m, c) && !sensitive(m.text))
    .map((m) => {
      const text = normalize(m.title + " " + m.text);
      const vocabulary=new Set(text.split(" "));
      const keyword = tokens.reduce((s, w) => s + (vocabulary.has(w) ? 1 : 0), 0);
      return {
        m,
        score:
          keyword * 2 + (semantic[m.id] ?? 0) * 3 + (m.verified ? 0.2 : 0) + (m.pinned ? 0.1 : 0),
        match: keyword > 0 || (semantic[m.id] ?? 0) > 0.65,
      };
    })
    .filter((x) => x.match)
    .sort((a, b) => b.score - a.score || Number(b.m.verified) - Number(a.m.verified))
    .filter(({ m }) => {
      const key = normalize(m.text);
      if (seen.has(key) || used + m.text.length + 100 > budget) return false;
      seen.add(key);
      used += m.text.length + 100;
      return true;
    })
    .slice(0, 6)
    .map((x) => x.m);
}
export function contextMessages(
  c: Conversation,
  state: KeeperState,
  budget: number,
): RoomMessage[] {
  let used = 0;
  const kept: RoomMessage[] = [];
  for (const m of [...c.messages].reverse()) {
    if (
      state.suppressed.includes(c.id + ":" + m.id) ||
      (m.metadata?.memoryIds?.length &&
        (m.metadata.memoryEpoch !== state.epoch ||
          m.metadata.memoryIds.some(
            (id) => !state.records.some((record) => record.id === id && authorized(record, c)),
          )))
    )
      continue;
    const size = JSON.stringify(m).length;
    if (used + size > budget && kept.length) break;
    kept.unshift(m);
    used += size;
  }
  return kept;
}
export function messageString(m: RoomMessage): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");
}
