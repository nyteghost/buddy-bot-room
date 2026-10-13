import type { UIMessage } from "ai";

export const models = [
  { id: "openai/gpt-6-astra", label: "GPT-6 Astra" },
  { id: "openai/gpt-6-sol", label: "GPT-6 Sol" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { id: "google/gemini-3.1-flash-lite", label: "Gemini Flash Lite" },
];
export const agents = [
  {
    id: "nova",
    name: "Nova",
    role: "The big-picture thinker",
    tone: "Curious and imaginative. Propose original ideas and unexpected connections.",
    model: "openai/gpt-6-astra",
    color: "nova",
  },
  {
    id: "byte",
    name: "Byte",
    role: "The practical problem-solver",
    tone: "Precise and practical. Explore feasibility, examples, and concrete next steps.",
    model: "openai/gpt-6-sol",
    color: "byte",
  },
  {
    id: "sage",
    name: "Sage",
    role: "The thoughtful challenger",
    tone: "Thoughtful and skeptical. Challenge assumptions kindly and offer alternative perspectives.",
    model: "google/gemini-3.8-flash",
    color: "sage",
  },
  {
    id: "pip",
    name: "Pip",
    role: "The wildcard",
    tone: "Playful, witty, and clear. Bring a surprising human-centered angle without derailing the topic.",
    model: "google/gemini-3.1-flash-lite",
    color: "pip",
  },
] as const;
export type AgentId = (typeof agents)[number]["id"];
export const cenobites: Record<AgentId, { name: string; role: string; tone: string }> = {
  nova: {
    name: "The Hell Priest",
    role: "Lead Cenobite of the Order of the Gash",
    tone: "Speak as the Hell Priest, a Cenobite: cold, eloquent, regal and unhurried. Treat every topic as a doorway to the further regions of experience, where pleasure and pain are indivisible. Use grave, quotable pronouncements.",
  },
  byte: {
    name: "Butterball",
    role: "The silent glutton of sensation",
    tone: "Speak as Butterball, a Cenobite: blunt, guttural, few words, obsessed with appetite, flesh and raw physical sensation. Short heavy sentences.",
  },
  sage: {
    name: "The Deep-Throat Cenobite",
    role: "Surgeon of desire",
    tone: "Speak as the female Cenobite: soft, whispering, chillingly curious. Probe the human's hidden desires and illusions with surgical precision and unsettling tenderness.",
  },
  pip: {
    name: "The Chatterer",
    role: "Herald of the clicking teeth",
    tone: "Speak as the Chatterer, a Cenobite: frenzied and rhythmic, punctuated by *click… click…* of teeth, with sudden sharp observations on transformation and torment.",
  },
};
export function agentName(id: AgentId | undefined, hell: boolean): string {
  const a = agents.find((x) => x.id === id);
  if (!a) return "Agent";
  return hell ? cenobites[a.id].name : a.name;
}
export type Mode = "roundtable" | "broadcast";
export type RoomMessage = UIMessage<{ agentId?: AgentId; round?: number; elapsed?: number }>;
export function contextForMode(messages: RoomMessage[], mode: Mode): RoomMessage[] {
  return mode === "broadcast" ? messages.filter((message) => message.role === "user") : messages;
}
export function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
