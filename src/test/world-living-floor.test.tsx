import {afterEach,describe,expect,it,vi} from "vitest";
import {act,cleanup,render,screen} from "@testing-library/react";
import {WorldGuest,guestGait,worldMotionFor} from "@/components/world-guest";
import {WorldAtmosphere} from "@/components/world-atmosphere";
import {worldDepthScale,worldDepthZ,worldRoomPlan} from "@/lib/world-floor";
import {setWorldFixtureUse} from "@/lib/world-presence";

afterEach(()=>{cleanup();vi.useRealTimers();setWorldFixtureUse("test-actor","dcc",null);});
const position=(element:HTMLElement)=>({x:element.style.getPropertyValue("--world-guest-x"),y:element.style.getPropertyValue("--world-guest-y")});
describe("Living World calibrated floor in the room",()=>{
 it("places guests by their feet with depth order and perspective from the same point",()=>{
  render(<WorldGuest id="arcade-ghost" theme="normal" active/>);
  const guest=screen.getByRole("button",{name:"Wave to Arcade Ghost"});
  const y=parseFloat(guest.style.getPropertyValue("--world-guest-y"));
  expect(Number.isFinite(y)).toBe(true);
  expect(guest.style.getPropertyValue("--world-z")).toBe(String(worldDepthZ(y)));
  expect(guest.style.getPropertyValue("--world-depth-scale")).toBe(String(worldDepthScale(y)));
  expect(guest.getAttribute("data-movement")).toBe("floating");
 });
 it("freezes built-in guests in Focus Mode without snapping back, then resumes wandering",()=>{
  vi.useFakeTimers();
  const view=render(<WorldGuest id="moon-mage" theme="dcc" active/>);
  const guest=screen.getByRole("button",{name:"Wave to Moon Mage"});
  act(()=>vi.advanceTimersByTime(4000));
  const before=position(guest);
  view.rerender(<WorldGuest id="moon-mage" theme="dcc" active paused/>);
  act(()=>vi.advanceTimersByTime(6000));
  expect(position(guest)).toEqual(before);
  expect(guest.getAttribute("data-paused")).toBe("true");
  view.rerender(<WorldGuest id="moon-mage" theme="dcc" active/>);
  const seen=new Set<string>();
  for(let i=0;i<40;i++){act(()=>vi.advanceTimersByTime(500));seen.add(JSON.stringify(position(guest)));}
  expect(seen.size).toBeGreaterThan(3);
 });
 it("maps wander actions onto the existing 32px gesture atlas",()=>{
  expect(worldMotionFor("interaction")).toBe("work");
  expect(worldMotionFor("turn")).toBe("look");
  expect(worldMotionFor("talk")).toBe("talk");
  expect(worldMotionFor("walk")).toBe("walk");
  expect(guestGait("tiny-dragon")).toBe("flying");
  expect(guestGait("goku")).toBe("humanoid");
 });
 it("draws a glow for each piece of furniture and lights it while in use",()=>{
  const {container}=render(<WorldAtmosphere theme="dcc"/>);
  const glows=[...container.querySelectorAll<HTMLElement>(".world-fixture")];
  expect(glows.map(glow=>glow.dataset["fixture"])).toEqual(worldRoomPlan("dcc").fixtures.map(fixture=>fixture.id));
  const portal=container.querySelector<HTMLElement>('[data-fixture="stairwell"]')!;
  expect(portal.getAttribute("data-active")).toBe("false");
  act(()=>setWorldFixtureUse("test-actor","dcc","stairwell"));
  expect(portal.getAttribute("data-active")).toBe("true");
  act(()=>setWorldFixtureUse("test-actor","dcc",null));
  expect(portal.getAttribute("data-active")).toBe("false");
 });
});
