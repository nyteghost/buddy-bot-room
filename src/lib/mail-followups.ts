import type { MailSummary } from "./mailbox";
/** Conservative, explainable subject-only hint. Never reads a body, sends or schedules. */
export function followupHint(mail: Pick<MailSummary,"subject"|"from">): string|null {
 const text=mail.subject.trim();
 if(!text) return null;
 if(/\b(action required|please respond|response requested|needs approval|approval needed|deadline|please review|follow[- ]?up|rsvp)\b/i.test(text))
   return "Possible follow-up: " + text.slice(0,120);
 return null;
}
export function mailToTask(mail:Pick<MailSummary,"subject"|"from">):string{
 const subject=(mail.subject||"Email").replace(/\s+/g," ").trim().slice(0,120);
 const from=(mail.from||"sender").replace(/\s+/g," ").trim().slice(0,60);
 return "Review email: "+subject+(from?" ("+from+")":"");
}
