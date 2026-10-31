import { accountsEnabled } from "./accounts";
import { currentUser } from "./accounts.server";
import { askPals } from "./ask.server";
import { cleanStartTask, cleanStartStep, usefulStartStep } from "./focus-assist";
import { STUCK_CHOICES, STUCK_SYSTEM, helpPrompt, offlineStuckHelp, type StuckChoice } from "./stuck-help";
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function handleStuckHelp(request: Request): Promise<Response> {
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  if (accountsEnabled(process.env) && !(await currentUser(request))?.owner) return reply({ error: "Owner access required" }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return reply({ error: "Request too large" }, 413);
  let body: unknown;
  try { const raw = await request.text(); if (raw.length > 4096) return reply({ error: "Request too large" }, 413); body = JSON.parse(raw); }
  catch { return reply({ error: "Invalid request" }, 400); }
  if (!body || typeof body !== "object") return reply({ error: "Invalid request" }, 400);
  const input = body as { task?: unknown; step?: unknown; choice?: unknown };
  const task = cleanStartTask(input.task);
  if (!task || !STUCK_CHOICES.includes(input.choice as StuckChoice)) return reply({ error: "Choose a task and one kind of help" }, 400);
  const step = cleanStartStep(input.step) ?? "";
  const choice = input.choice as StuckChoice;
  const fallback = offlineStuckHelp(task, step, choice);
  if (request.signal.aborted) return reply({ error: "Cancelled" }, 499);
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
    const result = await askPals(helpPrompt(task, step, choice), { system: STUCK_SYSTEM, maxTokens: 240, localOnly: true, signal });
    if (request.signal.aborted) return reply({ error: "Cancelled" }, 499);
    if (result.ok) {
      const text = choice === "smaller" ? cleanStartStep(result.text) : result.text.trim();
      const limit = choice === "smaller" ? 180 : 1100;
      if (text && text.length <= limit && !/\b(i (opened|accessed|sent|updated|changed|saved) your|i have (opened|read|sent|edited))\b/i.test(text) &&
          (choice !== "smaller" || usefulStartStep(task, text, step)) &&
          (!/\b(build|assemble|repair|install|swingset|swing set)\b/i.test(task) || !/\b(drill|saw|cut|fasten|tighten|bolt on|wiring)\b/i.test(text)))
        return reply({ choice, text, source: "local-ai" });
    }
  } catch { /* Offline help is always available. */ }
  return request.signal.aborted ? reply({ error: "Cancelled" }, 499) : reply({ choice, text: fallback, source: "offline" });
}
