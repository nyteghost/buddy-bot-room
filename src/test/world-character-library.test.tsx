import { render,fireEvent,screen } from "@testing-library/react";
import {describe,expect,it,vi} from "vitest";
import {WorldCharacterLibrary} from "@/components/world-character-library";
import {starterCustomCharacter} from "@/lib/world-custom-packs";
describe("Character Universe in-app Library",()=>{
 it("lists Goku, Homer, originals and can add an optional visual visitor",()=>{
  const toggle=vi.fn(),save=vi.fn().mockResolvedValue(true),remove=vi.fn().mockResolvedValue(true);
  const view=render(<WorldCharacterLibrary enabledIds={["green-jacket"]} customCharacters={[]} syncStatus="Saved on Unraid" onToggle={toggle} onSave={save} onDelete={remove}/>);
  expect(screen.getByText("Goku · Fan Tribute")).toBeTruthy();
  expect(screen.getByText("Homer · Fan Tribute")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Enable Goku · Fan Tribute"}));
  expect(toggle).toHaveBeenCalledWith("goku",true);
  view.unmount();
 });
 it("opens the editor for original safe 32px art",()=>{
  const existing=starterCustomCharacter();
  const view=render(<WorldCharacterLibrary enabledIds={[]} customCharacters={[existing]} syncStatus="Local backup" onToggle={()=>{}} onSave={async()=>true} onDelete={async()=>true}/>);
  fireEvent.click(screen.getByRole("button",{name:"Create character"}));
  expect(screen.getByRole("group",{name:"32 by 32 pixel drawing grid"}).querySelectorAll("button").length).toBe(1024);
  fireEvent.click(screen.getByRole("button",{name:"Paint pixel 1, 1"}));
  expect(screen.getByRole("button",{name:"Save character"})).toBeTruthy();
  view.unmount();
 });
});
