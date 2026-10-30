import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";

const nativeRequire = createRequire(import.meta.url);
function core() {
  const module = { exports: {} as Record<string, (...args: any[]) => any> };
  const electron = { app: {getPath: () => "unused"},ipcMain:{handle:()=>{}},
    safeStorage:{isEncryptionAvailable:()=>true},shell:{openExternal: async()=>{} } };
  const sandbox = {
    module, exports: module.exports,
    require:(id:string)=>id==="electron"?electron:nativeRequire(id),
    fetch:()=>{throw Error("No network in tests");},
    URL,URLSearchParams,AbortSignal,setTimeout,Buffer,console,
  };
  runInNewContext(readFileSync(resolve(process.cwd(),"desktop/google-calendar.cjs"),"utf8"),sandbox,{filename:"google-calendar.cjs"});
  return module.exports;
}

describe("ShowPilot Google Calendar desktop integration", () => {
  const source = core();
  it("accepts only a Desktop OAuth JSON and rejects service accounts and web apps", () => {
    const example = JSON.stringify({installed:{client_id:"12345-abc.apps.googleusercontent.com",client_secret:"test-secret"}});
    const result = source.credentialFromJson(example);
    expect(result.client_id).toBe("12345-abc.apps.googleusercontent.com");
    expect(result.client_secret).toBe("test-secret");
    expect(() => source.credentialFromJson('{"web":{"client_id":"abc.apps.googleusercontent.com"}}')).toThrow(/Desktop/);
    expect(() => source.credentialFromJson('{"type":"service_account"}')).toThrow(/Desktop/);
  });
  it("keeps dates in Eastern time, with overnight shifts on the correct next day", () => {
    expect(source.localDateTime("2026-11-02",660)).toBe("2026-11-02T11:00:00");
    expect(source.localDateTime("2026-11-02",1560)).toBe("2026-11-03T02:00:00");
    expect(source.localDateTime("2026-12-31",1500)).toBe("2027-01-01T01:00:00");
  });
  it("builds a stable, private ShowPilot-owned calendar event and never includes a password", () => {
    const shift={id:"ppshift20261102s660",date:"2026-11-02",start:660,end:1200,raw:"11a-8p",note:"Hall A"};
    const doc=source.calendarBody(shift,"Work");
    expect(doc.summary).toBe("Work");
    expect(doc.start.timeZone).toBe("America/New_York");
    expect(doc.start.dateTime).toBe("2026-11-02T11:00:00");
    expect(doc.end.dateTime).toBe("2026-11-02T20:00:00");
    expect(doc.extendedProperties.private.showpilotId).toBe("ppshift20261102s660");
    expect(doc.extendedProperties.private.showpilotSource).toBe("showpilot-myshifts");
    expect(doc.description).toContain("Hall A");
  });
  it("validates complete multi-shift updates, rejecting invalid dates and duplicated IDs", () => {
    const shift={id:"ppshift20261102s660",date:"2026-11-02",start:660,end:1200,raw:"11a-8p"};
    expect(source.validateSync({title:"Mark Work",shifts:[shift]}).shifts).toHaveLength(1);
    expect(() => source.validateSync({title:"Mark Work",shifts:[shift,shift]})).toThrow(/same stable ID/);
    expect(() => source.validateSync({title:"Work",shifts:[{...shift,date:"2026-02-30"}]})).toThrow(/Invalid shift date/);
    expect(() => source.validateSync({title:"Work",shifts:[{...shift,end:600}]})).toThrow(/Invalid shift/);
    expect(() => source.validateSync({title:"Work",shifts:[]})).toThrow(/Select 1/);
  });
});
