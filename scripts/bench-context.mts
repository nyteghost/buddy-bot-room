// Context benchmark. Run: npx tsx scripts/bench-context.mts
// A 60-turn local-AI conversation with 6 early decisions. Compares the old trim (drop oldest turns, note a count) with the new digest.
// Counts how many early decisions are still visible to the model and how big the prompt is. Response quality is NOT measured (needs a model).
import { trimStart } from "../src/lib/context-trim.ts";
import { buildContext, estimateTextTokens, transcriptBudgetChars } from "../src/lib/context-budget.ts";
const decisions = ["We decided to run Pixel Pals on port 8090.", "Let's go with Tailscale for remote access.", "The backup goes to the second array every night at 2am.", "We will keep Ollama on the gaming PC at 10.200.1.50.", "Never auto-update the Unraid server.", "The deadline for the schedule is Friday."];
const filler = (i: number) => `Round ${i}: here is a long answer about unrelated details, options and tradeoffs that goes on for a while. `.repeat(5);
const items = [...decisions.map((t) => ({ role: "user", text: t, speaker: "Human" })), ...Array.from({ length: 54 }, (_, i) => ({ role: i % 2 ? "user" : "assistant", text: filler(i), speaker: i % 2 ? "Human" : "Nova" })), { role: "user", text: "Remind me what we decided?", speaker: "Human" }];
const budget = transcriptBudgetChars("ollama-server", 6000);
const oldKept = items.slice(trimStart(items, budget));
const seen = (text: string) => decisions.filter((d) => text.includes(d.split(" ").slice(2, 6).join(" "))).length;
const oldText = oldKept.map((t) => t.text).join("\n");
const nb = buildContext(items, budget);
const newText = nb.kept.map((t) => t.text).join("\n") + "\n" + nb.digest;
console.log(`budget ${budget} chars (~${estimateTextTokens("x".repeat(budget))} tokens) for ${items.length} turns`);
console.log(`OLD: kept ${oldKept.length} turns, ${oldText.length} chars, early decisions visible: ${seen(oldText)}/6`);
console.log(`NEW: kept ${nb.kept.length} turns + digest, ${newText.length} chars, early decisions visible: ${seen(newText)}/6`);
