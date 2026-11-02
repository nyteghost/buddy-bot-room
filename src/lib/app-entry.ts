/** Today is home; explicit links can resume chat or the saved workspace. */
export function appEntry(search: string): "today" | "chat" | "workspace" {
  const params = new URLSearchParams(search);
  if (params.get("chat") === "1") return "chat";
  if (params.get("workspace") === "1") return "workspace";
  return "today";
}
