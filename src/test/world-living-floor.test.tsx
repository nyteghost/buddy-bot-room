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

import {fireEvent} from "@testing-library/react";
import {WorldCharacterLibrary} from "@/components/world-character-library";
import {WorldHdSkin} from "@/components/world-hd-skin";
import {clearWorldPalSkins,getWorldPalSkins,WORLD_PAL_SKINS_KEY} from "@/lib/world-pal-skins";
import {starterCustomCharacter} from "@/lib/world-custom-packs";
describe("reversible HD looks for the original Pals",()=>{
 const look={...starterCustomCharacter(),id:"user-hdlook0002",name:"Test Look",hd3:{version:1,artStatus:"prototype" as const,movement:"humanoid" as const,directions:{s:{idle:{frames:[{src:"front-idle",durationMs:100}],loop:true}},e:{idle:{frames:[{src:"east-idle",durationMs:100}],loop:true},walk:{frames:[{src:"east-walk",durationMs:100}],loop:true}}}}};
 const props={enabledIds:[],customCharacters:[look],syncStatus:"Saved",onToggle:()=>{},onSave:async()=>true,onDelete:async()=>true,onInstallPack:async()=>true};
 it("assigns a look to a Pal from the Library, stores it on this device and restores in one click",()=>{
  clearWorldPalSkins();
  render(<WorldCharacterLibrary {...props}/>);
  fireEvent.change(screen.getByLabelText("Use Test Look as the look for a Pal"),{target:{value:"nova"}});
  expect(getWorldPalSkins()).toEqual({nova:"user-hdlook0002"});
  expect(JSON.parse(localStorage.getItem(WORLD_PAL_SKINS_KEY)!)).toEqual({nova:"user-hdlook0002"});
  fireEvent.click(screen.getByRole("button",{name:"Restore original Pal looks"}));
  expect(getWorldPalSkins()).toEqual({});
  expect(screen.getByLabelText("Use Test Look as the look for a Pal")).toHaveProperty("value","");
 });
 it("draws the Pal with the chosen look's supplied facing and clip, and marks fallbacks",()=>{
  const walking=render(<WorldHdSkin character={look} name="Nova" facing="e" motion={undefined} walking elapsed={0}/>);
  const art=walking.container.querySelector("img")!;
  expect(art.getAttribute("src")).toBe("east-walk");expect(art.hasAttribute("data-hd-fallback")).toBe(false);
  expect(art.getAttribute("alt")).toBe("Nova in Test Look look");
  walking.unmount();
  const borrowed=render(<WorldHdSkin character={look} name="Nova" facing="w" motion="wave" walking={false} elapsed={0}/>);
  expect(borrowed.container.querySelector("img")?.getAttribute("data-hd-fallback")).toBe("facing+clip");
 });
});

import {OfficePal} from "@/components/office-pal";
import {WorldCustomGuest} from "@/components/world-custom-guest";
import {worldCrowd} from "@/lib/world-crowd";
describe("Living World crowd wiring",()=>{
 it("guests and imported visitors join the room crowd and leave it on unmount",()=>{
  const guest=render(<WorldGuest id="arcade-ghost" theme="normal" active/>);
  const visitor=render(<WorldCustomGuest character={starterCustomCharacter()} index={0} theme="normal" active/>);
  expect(worldCrowd("normal").has("guest:arcade-ghost")).toBe(true);
  expect(worldCrowd("normal").has("custom:"+starterCustomCharacter().id)).toBe(true);
  guest.unmount();visitor.unmount();
  expect(worldCrowd("normal").size).toBe(0);
 });
 it("Classic Pals never join; Living World desk-choreography Pals are fixed obstacles; strolling Pals follow the crowd",()=>{
  const classic=render(<OfficePal id="nova" index={0} mode="linux" active={false} enabled/>);
  expect(worldCrowd("linux").has("pal:nova")).toBe(false);
  classic.unmount();
  const desk=render(<OfficePal id="byte" index={1} mode="linux" active={false} enabled world playful/>);
  expect(worldCrowd("linux").pose("pal:byte")?.mode).toBe("fixed");
  desk.unmount();
  expect(worldCrowd("linux").has("pal:byte")).toBe(false);
  vi.useFakeTimers();
  const strolling=render(<OfficePal id="sage" index={2} mode="matrix" active={false} enabled world playful/>);
  act(()=>vi.advanceTimersByTime(3000));
  const pose=worldCrowd("matrix").pose("pal:sage");
  expect(pose?.mode).not.toBe("fixed");
  expect(pose!.time).toBeGreaterThan(0);
  strolling.unmount();
 });
});
