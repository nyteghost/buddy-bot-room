import { it, expect } from "vitest";
import { questDecorations } from "@/components/quest-corner";
it("unlocks only for actual step progress and caps gently",()=>{
 expect(questDecorations(0)).toHaveLength(0);
 expect(questDecorations(2).map(x=>x.label)).toEqual(["A little plant","A cozy book nook"]);
 expect(questDecorations(999)).toHaveLength(5);
 expect(questDecorations(-1)).toHaveLength(0);
});
