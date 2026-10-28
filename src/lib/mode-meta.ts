import { ALL_MODES, type Mode } from "./agents";

/** Text and defaults that differ per conversation mode, kept out of the room component. Adding a mode means adding one entry to each table here. */
/** Builds a table with one value for every mode, so no mode can be forgotten. */
export const perMode = <T>(make: (m: Mode) => T): Record<Mode, T> => Object.fromEntries(ALL_MODES.map((m) => [m, make(m)])) as Record<Mode, T>;

export const suggestions = [
  "What would a city designed by AI look like?",
  "Is creativity uniquely human?",
  "Pitch the next big indie game",
];
export const defaultOpenModes: Record<Mode, boolean> = perMode((m) => m === "roundtable");
export const modeLabel: Record<Mode, string> = { roundtable: "Roundtable", broadcast: "Broadcast", direct: "One-on-one", solve: "Problem solving", debate: "Debate", smart: "Smart team" };
export const modeHelp: Record<Mode, string> = {
  roundtable: "Everyone hears everyone: pals react to each other, then one gives the verdict.",
  broadcast: "Each pal answers on their own, without seeing the others. Optionally a judge ranks the answers.",
  direct: "A private chat with one pal.",
  solve: "A team with roles (Diagnoser, Fixer, Skeptic) that ends in a plan you can send to Tasks.",
  debate: "Two pals argue for and against; a third judges who argued better.",
  smart: "Only as many pals as the question needs: a simple question gets one answer; a hard one goes specialist, coder, reviewer, coordinator, one after another.",
};
export const modePlaceholder: Record<Mode, string> = {
  roundtable: "Give your pals something to talk about…",
  broadcast: "Ask a question and get independent answers…",
  direct: "Message your pal…",
  solve: "Describe the problem you need solved…",
  debate: "State a claim for the pals to argue about…",
  smart: "Ask anything; the team size fits the question…",
};
export const modeSuggestions: Record<Mode, string[]> = {
  roundtable: suggestions,
  broadcast: ["Name my new indie game", "Best way to learn guitar in 3 months?", "Write a one-line pitch for a pixel café"],
  direct: ["Help me plan my week", "Explain this like I'm new to it", "What should I cook tonight?"],
  solve: ["My Plex server keeps buffering on one TV", "My Docker container restarts every few minutes", "I can't focus when I work from home"],
  debate: ["Remote work beats the office", "Cats make better pets than dogs", "AI should write first drafts of everything"],
  smart: ["My Docker container restarts every few minutes", "What should I cook tonight?", "A script of mine fails with a permission error after a reboot"],
};

