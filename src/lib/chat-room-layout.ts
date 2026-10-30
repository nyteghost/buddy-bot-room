import { ALL_MODES, type Mode } from "./agents";

/** Keep six independent histories, but only show two conversation workspaces. */
export const MY_PALS_MODES = ["smart", "direct", "solve"] as const satisfies readonly Mode[];
export const PAL_LOUNGE_MODES = ["roundtable", "broadcast", "debate"] as const satisfies readonly Mode[];
export type ChatRoom = "my-pals" | "pal-lounge";

export const chatRoomForMode = (mode: Mode): ChatRoom =>
  (MY_PALS_MODES as readonly Mode[]).includes(mode) ? "my-pals" : "pal-lounge";
export const chatModesForRoom = (room: ChatRoom): readonly Mode[] =>
  room === "my-pals" ? MY_PALS_MODES : PAL_LOUNGE_MODES;

export function activeChatMode(open: Record<Mode, boolean>, room: ChatRoom): Mode {
  return chatModesForRoom(room).find((m) => open[m]) ?? (room === "my-pals" ? "smart" : "roundtable");
}

/** Exactly one sub-mode can be open within each chat room. */
export function activateChatMode(open: Record<Mode, boolean>, mode: Mode): Record<Mode, boolean> {
  const active = chatModesForRoom(chatRoomForMode(mode));
  return Object.fromEntries(ALL_MODES.map((m) => [m, active.includes(m) ? m === mode : open[m]])) as Record<Mode, boolean>;
}

export function closeChatRoom(open: Record<Mode, boolean>, room: ChatRoom): Record<Mode, boolean> {
  const modes = chatModesForRoom(room);
  return Object.fromEntries(ALL_MODES.map((m) => [m, modes.includes(m) ? false : open[m]])) as Record<Mode, boolean>;
}

export function isChatRoomOpen(open: Record<Mode, boolean>, room: ChatRoom): boolean {
  return chatModesForRoom(room).some((m) => open[m]);
}

export const chatModeNames: Record<Mode, string> = {
  smart: "Ask naturally",
  direct: "One Pal",
  solve: "Solve together",
  roundtable: "Roundtable",
  broadcast: "Independent answers",
  debate: "Debate",
};

export type AssistSuggestion = "just-start" | "brain-dump" | "lounge" | null;
/** Suggest actions without silently sending, creating or changing anything. */
export function suggestAssist(text: string): AssistSuggestion {
  const input = text.trim().toLowerCase();
  if (!input || input.length > 1200 || input.startsWith("/")) return null;
  if (/\b(have|let|ask)\s+(all|the)\s+(my\s+)?pals?\b.*\b(discuss|debate|talk|argue)\b|\b(pal\s+lounge|roundtable)\b/.test(input)) return "lounge";
  if (/\b(i('m| am)?\s+(stuck|overwhelmed)|can'?t\s+(start|begin|focus)|don't\s+know\s+where\s+to\s+start|putting\s+off|procrastinat|help\s+me\s+(start|begin))\b/.test(input)) return "just-start";
  if (/\b(too\s+much\s+to\s+do|brain\s*dump|organize\s+my\s+(tasks?|day)|remind\s+me|remember\s+to)\b/.test(input)) return "brain-dump";
  return null;
}
