import { makeBrief, sendBrief } from "./brief.server";

/** GET = the brief as text (a preview); POST = send it to your phone now. */
export async function handleBrief(request: Request) {
  if (request.method === "POST") {
    const r = await sendBrief();
    return Response.json({ ok: r.ok, text: r.ok ? `Sent to your phone:\n\n${r.text}` : `${r.error}${r.text ? `\n\n${r.text}` : ""}` });
  }
  const b = await makeBrief();
  return Response.json({ ok: true, text: `**${b.title}**\n\n${b.body}` });
}
