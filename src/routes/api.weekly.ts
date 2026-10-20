import { createFileRoute } from "@tanstack/react-router";

async function run(request: Request): Promise<Response> {
  const [{ currentUser }, w] = await Promise.all([import("@/lib/accounts.server"), import("@/lib/weekly.server")]);
  if (!(await currentUser(request))?.owner) return Response.json({ error: "Only the owner account can open the weekly review." }, { status: 403 });
  if (request.method === "POST") return Response.json(await w.sendWeekly());
  const r = await w.makeWeekly();
  return Response.json({ ok: true, text: `**${r.title}**\n\n${r.body}` });
}

export const Route = createFileRoute("/api/weekly")({ server: { handlers: { GET: ({ request }) => run(request), POST: ({ request }) => run(request) } } });
