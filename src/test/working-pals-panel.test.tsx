import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkingPalsPanel } from "@/components/working-pals-panel";
import { newMission, type PalMission } from "@/lib/working-pals";

const api = vi.fn();
let rows: PalMission[] = [];
const id="35d921a7-4c98-40b1-b7df-b6176d31a9bb";
beforeEach(() => {
  rows = [];
  api.mockReset();
  api.mockImplementation(async (url: string, options?:RequestInit) => {
    if (url!=="/api/working-pals") throw Error("Unexpected endpoint");
    if (!options) return Response.json({missions:rows});
    const payload=JSON.parse(String(options.body)) as Record<string,unknown>;
    const op=payload["op"];
    if (op==="propose") {
      const record=newMission(payload,id,new Date().toISOString());
      if (!record) return Response.json({error:"Invalid proposal"},{status:400});
      rows=[record];
      return Response.json({mission:record});
    }
    const job=rows[0]!;
    if (op==="approve") {
      job.status="approved";job.approvedAt=new Date().toISOString();job.revision++;
      return Response.json({mission:job});
    }
    if (op==="run") {
      job.status="completed";job.result="Start by opening the planner.";job.revision++;
      return Response.json({ok:true});
    }
    return Response.json({error:"Unexpected action"},{status:400});
  });
  vi.stubGlobal("fetch",api);
});
afterEach(() => {cleanup();vi.unstubAllGlobals();});
it("requires an explicit approval followed by a separate Run click before any job executes",async()=>{
  render(<WorkingPalsPanel open />);
  expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("Summarize my next steps"),{target:{value:"Help me start"}});
  fireEvent.change(screen.getByPlaceholderText("Help me choose the smallest next step for my plan…"),{target:{value:"What one thing should I do first?"}});
  fireEvent.click(screen.getByRole("button",{name:"Add for approval"}));
  expect(await screen.findByText("Help me start")).toBeInTheDocument();
  await waitFor(()=>expect(rows[0]?.status).toBe("proposed"));
  expect(api.mock.calls.filter(x=>x[1] && JSON.parse(String(x[1].body)).op==="run")).toHaveLength(0);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Approve"})).toBeEnabled());
  fireEvent.click(screen.getByRole("button",{name:"Approve"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Run approved job"})).toBeEnabled());
  expect(rows[0]?.status).toBe("approved");
  fireEvent.click(screen.getByRole("button",{name:"Run approved job"}));
  expect(await screen.findByText("Start by opening the planner.")).toBeInTheDocument();
  expect(api.mock.calls.filter(x=>x[1] && JSON.parse(String(x[1].body)).op==="run")).toHaveLength(1);
});
