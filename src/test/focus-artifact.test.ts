import {expect,it} from "vitest";
import {cleanPalWork,examplePalWork,PAL_WORK_SYSTEM} from "@/lib/focus-artifact";
it("prepares safe local copyable work without impersonating file access",()=>{
 expect(examplePalWork("Build a swingset")).toMatch(/manufacturer's instructions/);
 expect(examplePalWork("Finish the show schedule")).toMatch(/Sample planning checklist/);
 expect(examplePalWork("Email Brian")).toMatch(/Unsent draft starter/);
 expect(cleanPalWork("".padEnd(1200,"x"))).toBeNull();
 expect(cleanPalWork("Draft")).toBe("Draft");
 expect(PAL_WORK_SYSTEM).toMatch(/local-only/);
});
