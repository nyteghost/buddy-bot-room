import { readDiscussions, writeDiscussions, type SavedDiscussion } from "./saved-discussions";

/**
 * Where saved chats live when you're signed out. In the self-hosted Docker build they go to the server
 * (a file on the buddy-data volume, so every browser on your network sees the same chats); everywhere
 * else, or if the server store isn't available, they stay in this browser.
 */
let serverOk: boolean | null = null;

async function useServer(): Promise<boolean> {
  if (!__SELF_HOSTED__) return false;
  if (serverOk !== null) return serverOk;
  try {
    const res = await fetch("/api/store");
    serverOk = res.ok;
  } catch {
    serverOk = false;
  }
  return serverOk;
}

export async function storeWhere(): Promise<"server" | "browser"> {
  return (await useServer()) ? "server" : "browser";
}

export async function listLocalOrServer(): Promise<SavedDiscussion[]> {
  if (!(await useServer())) return readDiscussions();
  const res = await fetch("/api/store");
  if (!res.ok) throw new Error("The server couldn't load saved chats.");
  const json = (await res.json()) as { rows?: SavedDiscussion[] };
  return json.rows ?? [];
}

export async function saveLocalOrServer(row: SavedDiscussion): Promise<void> {
  if (!(await useServer())) return writeDiscussions([row, ...readDiscussions().filter((r) => r.id !== row.id)]);
  const res = await fetch("/api/store", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The server couldn't save this chat.");
}

export async function deleteLocalOrServer(id: string): Promise<void> {
  if (!(await useServer())) return writeDiscussions(readDiscussions().filter((r) => r.id !== id));
  const res = await fetch(`/api/store?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("The server couldn't delete this chat.");
}
