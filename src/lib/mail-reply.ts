/** Prompt for drafting a reply. Only the sender, subject and the user's own notes are included; message bodies are never read. */
export function replyPrompt(from: string, subject: string, intent: string): string {
  const clean = (s: string, n: number) => s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  const say = clean(intent, 400);
  return [
    `Write a short, friendly reply email. It is a reply to a message from "${clean(from, 80)}" with the subject "${clean(subject, 120)}".`,
    say ? `Here is what I want to say: ${say}` : "I haven't said what I want to reply, so keep it a polite acknowledgement and ask one clarifying question.",
    "I haven't shared the original message, so don't invent details from it. Write only the email text (greeting, body, sign-off) that I can copy into my mail app, with placeholders like [name] where you need something I haven't given you.",
  ].join("\n");
}
