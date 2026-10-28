// NOTE: src files use extensionless imports, so run this with a loader that resolves them (e.g. `npx tsx scripts/bench-embeddings.mts`), or from a copy with ".ts" added to the imports.
// Embedding workload benchmark. Run: node --experimental-strip-types scripts/bench-embeddings.mts
// Counts how many passages are sent for embedding per question: OLD (re-embed up to 24 candidates + the question every time)
// vs NEW (persistent cache, hybrid ranking). A fake embedder is used, so this measures WORK (texts embedded), not Ollama speed.
import { chunkText, type Chunk } from "../src/lib/rag.ts";
import { hybridRetrieve, memoryStore, type Embedder } from "../src/lib/embed-cache.ts";

const topics = ["docker", "backup", "ollama", "tailscale", "unraid", "schedule", "vendor", "mail", "reminder", "weather"];
const text = Array.from({ length: 400 }, (_, i) => `Section ${i}: notes about ${topics[i % topics.length]} number ${i}. ${"filler words ".repeat(20)}`).join("\n\n");
const chunks: Chunk[] = chunkText("notes.md", text, 400);
const questions = ["how do I back up docker", "what about tailscale", "ollama models", "vendor price", "reminder repeats", "weather alerts", "unraid backup", "mail rules"];
let embedded = 0;
const embed: Embedder = async (t) => { embedded += t.length; return { model: "nomic-embed-text", embeddings: t.map((x) => [x.length % 13, x.includes("docker") ? 1 : 0, x.includes("backup") ? 1 : 0]) }; };
const store = memoryStore();
const rows = ["pass | questions | OLD texts embedded | NEW texts embedded"];
for (const pass of ["first session", "after restart (same documents)"]) {
  embedded = 0;
  const t0 = performance.now();
  for (const q of questions) await hybridRetrieve(chunks, q, 4, { embed, store });
  const ms = performance.now() - t0;
  rows.push(`${pass} | ${questions.length} | ${questions.length * 25} | ${embedded}  (ranking compute ${ms.toFixed(0)} ms for ${questions.length} questions)`);
}
console.log(`${chunks.length} passages`);
console.log(rows.join("\n"));
