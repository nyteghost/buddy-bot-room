import { accountsEnabled } from "./accounts";
import { currentUser } from "./accounts.server";
import { askPals } from "./ask.server";
import { cleanStartStep, cleanStartTask, fallbackStartStep, firstStepPrompt, FOCUS_SYSTEM_PROMPT, START_ACTIONS, type StartAction } from "./focus-assist";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Private, opt-in, one-step local task coaching. Never uses a paid/cloud provider
 * or modifies a task/calendar/mailbox. Static fallback works without Ollama. */
export async function handleJustStart(request: Request): Promise<Response> {
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  if (accountsEnabled(process.env) && !(await currentUser(request))?.owner)
    return reply({ error: "Sign in as the owner to use Focus Assist." }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 2048) return reply({ error: "Task is too long." }, 413);

  let body: { task?: unknown; action?: unknown; previous?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 2048) return reply({ error: "Task is too long." }, 413);
    body = JSON.parse(raw) as typeof body;
  } catch { return reply({ error: "Invalid task request." }, 400); }

  const task = cleanStartTask(body?.task);
  if (!task) return reply({ error: "Describe one thing you'd like to start (up to 280 characters)." }, 400);
  if (!START_ACTIONS.includes(body.action as StartAction)) return reply({ error: "Invalid start action." }, 400);
  const action = body.action as StartAction;
  const previous = cleanStartStep(body.previous) ?? "";
  const basic = fallbackStartStep(task, action);
  try {
    const answer = await askPals(firstStepPrompt(task, action, previous), {
      system: FOCUS_SYSTEM_PROMPT,
      maxTokens: 100,
      localOnly: true,
    });
    if (answer.ok) {
      const step = cleanStartStep(answer.text);
      if (step) return reply({ step, source: "local-ai" });
    }
  } catch { /* No inference is required to start. */ }
  return reply({ step: basic, source: "quick-start" });
}
