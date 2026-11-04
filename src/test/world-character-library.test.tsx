import { render,fireEvent,screen } from "@testing-library/react";
import {describe,expect,it,vi} from "vitest";
import {WorldCharacterLibrary} from "@/components/world-character-library";
import {WorldGuest} from "@/components/world-guest";
import {WorldCustomGuest} from "@/components/world-custom-guest";
import {GreenJacketVisitor} from "@/components/world-visitor";
import {starterCustomCharacter} from "@/lib/world-custom-packs";
describe("Character Universe in-app Library",()=>{
 it("lists Goku, Homer, originals and can add an optional visual visitor",()=>{
  const toggle=vi.fn(),save=vi.fn().mockResolvedValue(true),remove=vi.fn().mockResolvedValue(true);
  const view=render(<WorldCharacterLibrary enabledIds={["green-jacket"]} customCharacters={[]} syncStatus="Saved on Unraid" onToggle={toggle} onSave={save} onDelete={remove}/>);
  fireEvent.click(view.container.querySelector("details > summary")!);
  expect(screen.getByText("Goku · Fan Tribute")).toBeTruthy();
  expect(screen.getByText("Homer · Fan Tribute")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Enable Goku · Fan Tribute"}));
  expect(toggle).toHaveBeenCalledWith("goku",true);
  view.unmount();
 });
 it("opens the editor for original safe 32px art",()=>{
  const existing=starterCustomCharacter();
  const view=render(<WorldCharacterLibrary enabledIds={[]} customCharacters={[existing]} syncStatus="Local backup" onToggle={()=>{}} onSave={async()=>true} onDelete={async()=>true}/>);
  fireEvent.click(view.container.querySelector("details > summary")!);
  fireEvent.click(screen.getByRole("button",{name:"Create character"}));
  expect(screen.getByRole("group",{name:"32 by 32 pixel drawing grid"}).querySelectorAll("button").length).toBe(1024);
  fireEvent.click(screen.getByRole("button",{name:"Paint pixel 1, 1"}));
  expect(screen.getByRole("button",{name:"Save character"})).toBeTruthy();
  view.unmount();
 });
});

describe("room-wide guest emotes in rendered sprites",()=>{
 it("celebrates with builtin, custom and Green Jacket visitors",()=>{
  const cue={action:"celebrate" as const,at:Date.now()};
  const builtIn=render(<WorldGuest id="moon-mage" theme="normal" active={false} cue={cue}/>);
  expect(builtIn.container.querySelector(".world-guest")?.getAttribute("data-action")).toBe("celebrate");
  builtIn.unmount();
  const custom=render(<WorldCustomGuest character={starterCustomCharacter()} index={0} theme="normal" active={false} cue={cue}/>);
  expect(custom.container.querySelector(".world-custom-guest")?.getAttribute("data-action")).toBe("celebrate");
  custom.unmount();
  const jacket=render(<GreenJacketVisitor theme="normal" active={false} cue={cue}/>);
  expect(jacket.container.querySelector(".world-visitor")?.getAttribute("data-action")).toBe("celebrate");
  jacket.unmount();
 });
});

describe("room object reactions in the character library",()=>{
 it("looks toward room objects without opening AI tools",()=>{
  const cue={action:"inspect-prop" as const,targetId:"calendar" as const,at:Date.now()};
  const builtIn=render(<WorldGuest id="moon-mage" theme="normal" active={false} cue={cue}/>);
  expect(builtIn.container.querySelector(".world-guest")?.getAttribute("data-action")).toBe("look");
  builtIn.unmount();
  const custom=render(<WorldCustomGuest character={starterCustomCharacter()} index={0} theme="normal" active={false} cue={cue}/>);
  expect(custom.container.querySelector(".world-custom-guest")?.getAttribute("data-action")).toBe("look");
  custom.unmount();
  const jacket=render(<GreenJacketVisitor theme="normal" active={false} cue={cue}/>);
  expect(jacket.container.querySelector(".world-visitor")?.getAttribute("data-action")).toBe("look");
  jacket.unmount();
 });
});
