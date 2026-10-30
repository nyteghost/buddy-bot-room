import { expect, it } from "vitest";
import { followupHint, mailToTask } from "@/lib/mail-followups";
it("identifies subject hints without claiming knowledge of private mail contents",()=>{
 expect(followupHint({subject:"Action required: invoice",from:"Alex"})).toMatch(/Possible follow-up/);
 expect(followupHint({subject:"Photos from the weekend",from:"Alex"})).toBeNull();
 expect(mailToTask({subject:" Schedule changes ",from:"Brian"})).toBe("Review email: Schedule changes (Brian)");
});
