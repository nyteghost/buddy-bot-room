import {describe,expect,it} from "vitest";
import {draftHandoff,receivedReceipt,parseReceiverStatus,safeBridgeEndpoint,transitionHandoff} from "@/lib/adhd-bridge";

const time="2026-11-04T20:00:00.000Z";
const key="manual-handoff-2026-001";
describe("ADHD Assistant owner-approved bridge",()=>{
 it("creates a private local draft, not an approved transfer",()=>{
  const h=draftHandoff({kind:"task",title:" Check ShowPilot ",notes:"Review the schedule",due_at:"2026-11-05T14:00:00.000Z"},key,time);
  expect(h.status).toBe("draft");
  expect(h.payload.title).toBe("Check ShowPilot");
  expect(h.payload.due_at).toBe("2026-11-05T14:00:00.000Z");
  expect(h.attempts).toBe(0);
  expect(transitionHandoff(h,"approve",time).status).toBe("approved");
  expect(()=>transitionHandoff(transitionHandoff(h,"cancel",time),"approve",time)).toThrow();
 });
 it("rejects unapproved fields, invalid dates, invalid IDs and unknown actions",()=>{
  expect(()=>draftHandoff({kind:"task",title:"hello",credentials:"secret"},key,time)).toThrow();
  expect(()=>draftHandoff({kind:"delete",title:"hello"},key,time)).toThrow();
  expect(()=>draftHandoff({kind:"task",title:""},key,time)).toThrow();
  expect(()=>draftHandoff({kind:"task",title:"hello",due_at:"tomorrow"},key,time)).toThrow();
  expect(()=>draftHandoff({kind:"task",title:"hello"},"short",time)).toThrow();
 });
 it("accepts only a matching idempotent receiver receipt",()=>{
  expect(receivedReceipt({id:key,status:"received_pending_approval",duplicate:false},key)).toBe(true);
  expect(receivedReceipt({id:key,status:"approved",duplicate:true},key)).toBe(true);
  expect(receivedReceipt({id:"other",status:"approved"},key)).toBe(false);
  expect(receivedReceipt({id:key,status:"task-completed"},key)).toBe(false);
 });
 it("checks receiver approval only when identity and state are valid",()=>{
  expect(parseReceiverStatus({id:key,state:"pending",updated_at:time},key)).toBe("pending");
  expect(parseReceiverStatus({id:key,state:"approved"},key)).toBe("approved");
  expect(parseReceiverStatus({id:key,state:"rejected"},key)).toBe("rejected");
  for(const result of [{id:"wrong",state:"approved"},{id:key,state:"completed"},{id:key,state:200},null,[],{}]){
   expect(parseReceiverStatus(result,key)).toBeNull();
  }
 });
 it("keeps destinations fixed, loopback-only by default, with an explicit Docker opt-in",()=>{
  expect(safeBridgeEndpoint("http://127.0.0.1:8765")).toBe("http://127.0.0.1:8765");
  expect(safeBridgeEndpoint("http://host.docker.internal:8766")).toBeNull();
  expect(safeBridgeEndpoint("http://host.docker.internal:8766",true)).toBe("http://host.docker.internal:8766");
  expect(safeBridgeEndpoint("http://adhd-bridge:18766")).toBeNull();
  expect(safeBridgeEndpoint("http://adhd-bridge:18766",true)).toBe("http://adhd-bridge:18766");
  expect(safeBridgeEndpoint("http://other-service:18766",true)).toBeNull();
  for(const raw of ["https://example.org","http://10.0.0.1:8765","http://localhost:8765/credentials","http://foo@localhost:8765","javascript:alert(1)"]){
   expect(safeBridgeEndpoint(raw,true)).toBeNull();
  }
 });
});
