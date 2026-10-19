/** Keyboard shortcuts as pure data, so the mapping can be tested without a DOM. */
export type ShortcutAction = "palette" | "newChat" | "focusComposer" | "toggleSidebar" | "stop" | "debugLog" | "focusMode";
export type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };

export const shortcutList: { keys: string; action: ShortcutAction; label: string }[] = [
  { keys: "Ctrl+K", action: "palette", label: "Command palette" },
  { keys: "Ctrl+Shift+O", action: "newChat", label: "New chat" },
  { keys: "Ctrl+/", action: "focusComposer", label: "Focus the message box" },
  { keys: "Ctrl+B", action: "toggleSidebar", label: "Collapse or expand the sidebar" },
  { keys: "Ctrl+Shift+F", action: "focusMode", label: "Focus mode: just the chat" },
  { keys: "Ctrl+Shift+L", action: "debugLog", label: "Open the debug log" },
  { keys: "Esc", action: "stop", label: "Stop the discussion (when nothing else is open)" },
];

export function matchShortcut(e: KeyLike, running: boolean, dialogOpen: boolean): ShortcutAction | null {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && !e.altKey) {
    if (!e.shiftKey && k === "k") return "palette";
    if (e.shiftKey && k === "o") return "newChat";
    if (!e.shiftKey && k === "/") return "focusComposer";
    if (!e.shiftKey && k === "b") return "toggleSidebar";
    if (e.shiftKey && k === "l") return "debugLog";
    if (e.shiftKey && k === "f") return "focusMode";
    return null;
  }
  if (k === "escape" && running && !dialogOpen && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return "stop";
  return null;
}
