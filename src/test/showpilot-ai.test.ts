import { describe,it,expect } from "vitest";
import {detectAiProvider} from "@/lib/showpilot-ai-providers";
import {taskContext,validateTaskResponse} from "@/lib/showpilot-ai-tasks";
import type {EventEntry} from "@/lib/work-tools";
const events:EventEntry[]=[
 {date:"2026-10-12",space:"Hall A",title:"Bridal Expo",code:"S",start:480,end:1020},
 {date:"2026-10-12",space:"BallRoom A",title:"Company Dinner",code:"MI",start:600,end:1200},
 {date:"2026-10-13",space:"Hall A",title:"Tuesday Event",code:"S",start:480,end:1020},
 {date:"2026-10-12",space:"CEPAC Theatre",title:"Not our venue",code:"S",start:600,end:800},
];
describe("ShowPilot AI provider identification",()=>{
 it("identifies clear provider prefixes without contacting services",()=>{
  expect(detectAiProvider("sk-ant-api03-FAKE").provider).toBe("anthropic");
  expect(detectAiProvider("gsk_FAKE").provider).toBe("groq");
  expect(detectAiProvider("sk-or-FAKE").provider).toBe("openrouter");
  expect(detectAiProvider("sk-proj-FAKE").provider).toBe("openai");
  expect(detectAiProvider("AIzaFAKE").provider).toBe("google");
 });
 it("does not guess a generic sk- key",()=>expect(detectAiProvider("sk-ambiguous").certainty).toBe("ambiguous"));
});
describe("ShowPilot local/online AI safety",()=>{
 it("sends only one day of scoped venue events without employees",()=>{
  const c=taskContext({date:"2026-10-12",entries:events});
  expect(c.events).toHaveLength(2);
  expect(JSON.stringify(c)).not.toContain("CEPAC");
  expect(JSON.stringify(c)).not.toContain("Tuesday Event");
 });
 it("requires valid room/day/section and a supported explanation",()=>{
  const c=taskContext({date:"2026-10-12",entries:events});
  const ok={date:c.date,room:"Hall A",section:"HALLS",task:"Verify stage riser layout",reason:"Stage needs could vary; confirm with show manager.",evidence:["Bridal Expo"]};
  const accepted=validateTaskResponse({suggestions:[ok,{...ok,room:"CEPAC Theatre"},{...ok,date:"2026-10-13"},{...ok,section:"BALLROOM"}]},c,"local");
  expect(accepted).toHaveLength(1);expect(accepted[0]?.task.text).toBe("Verify stage riser layout");
 });
 it("rejects malformed provider output rather than adding tasks",()=>{
  const c=taskContext({date:"2026-10-12",entries:events});
  expect(()=>validateTaskResponse({suggestions:"bad"},c,"online")).toThrow();
 });
});
