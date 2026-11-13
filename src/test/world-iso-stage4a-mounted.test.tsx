// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as isoScene from "@/lib/world-iso-scene";
import { WorldIsoOfficeViewport } from "@/components/world-iso-office-viewport";
import { WORLD_ISO_PAL_IDS } from "@/lib/world-iso-schedule";
import type { HdOfficePal } from "@/components/world-hd-office";

vi.mock("@/lib/reduced-motion", () => ({ useReducedMotion: () => true }));
vi.mock("@/lib/power", () => ({ lowPower: { use: () => false }, useTabHidden: () => false }));
vi.mock("@/components/world-hd-office", () => ({
 WorldHdOffice: ({ pals }: { pals: readonly unknown[] }) => <div data-testid="original-flat-hd-office">{pals.length} Pals remain</div>,
}));
afterEach(() => vi.restoreAllMocks());
const pals: HdOfficePal[] = WORLD_ISO_PAL_IDS.map(id=>({id,name:id,enabled:true,real:null}));
const props = {pals,visitors:[],visible:true,playful:true,paused:false,synthetic:true} as const;

describe("Stage 4A mounted host (source integration contract)", () => {
 it("mounts a single synthetic scene/camera with nine original Pal identities", async () => {
  const {container}=render(<WorldIsoOfficeViewport {...props}/>);
  await waitFor(()=>expect(container.querySelectorAll("[data-iso-actor]").length).toBe(9));
  expect(container.querySelector('[data-iso-mounted="true"]')).toBeTruthy();
  expect(screen.queryByTestId("original-flat-hd-office")).toBeNull();
  expect(screen.getAllByRole("toolbar",{name:"Room camera"})).toHaveLength(1);
  fireEvent.click(screen.getByRole("button",{name:"Zoom in"}));
  fireEvent.click(screen.getByRole("button",{name:"Fit room"}));
  fireEvent.change(screen.getByRole("combobox",{name:"Follow a character"}),{target:{value:"pal:nova"}});
  expect((screen.getByRole("combobox",{name:"Follow a character"}) as HTMLSelectElement).value).toBe("pal:nova");
 });
 it("uses the true original HD renderer when scene generation fails (no parallel iso loop)", async () => {
  vi.spyOn(isoScene,"worldIsoSceneFrame").mockReturnValue(null);
  const {container}=render(<WorldIsoOfficeViewport {...props}/>);
  await waitFor(()=>expect(screen.getByTestId("original-flat-hd-office")).toBeTruthy());
  await waitFor(()=>expect(container.querySelector('[data-iso-mounted="true"]')).toBeNull());
  expect(screen.queryByRole("img",{name:/Synthetic isometric Office/})).toBeNull();
 });
});
