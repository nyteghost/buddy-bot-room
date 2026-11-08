import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { WorldHdOffice, type HdOfficePal } from "@/components/world-hd-office";
import { WorldRoomAppearance } from "@/components/world-room-appearance";
import { starterCustomCharacter } from "@/lib/world-custom-packs";
import { AMBIENT_FORBIDDEN_WORDS } from "@/lib/world-ambient";
import { getWorldRoomAppearance, setWorldRoomAppearance } from "@/lib/world-presentation";

afterEach(() => { cleanup(); setWorldRoomAppearance({ look: "auto", hdOffice: false, synthetic: false }); });
const NAMES = ["Nova", "Byte", "Sage", "Pip", "Echo", "Rune", "Tux", "Saiyan", "Mimic"];
const IDS = ["nova", "byte", "sage", "pip", "echo", "rune", "claude", "saiyan", "mimic"] as const;
const pals = (real: Partial<Record<string, HdOfficePal["real"]>> = {}, enabled: number = IDS.length): HdOfficePal[] =>
 IDS.map((id, i) => ({ id, name: NAMES[i]!, enabled: i < enabled, real: real[id] ?? null }));
const visitors = (n: number) => Array.from({ length: n }, (_, i) => ({ ...starterCustomCharacter(), name: "Visitor " + i }));

describe("Living Universe HD office (feature-flagged preview)", () => {
 it("shows the enabled Pals and at most six visitors", () => {
  const { container } = render(<WorldHdOffice pals={pals({}, 7)} visitors={visitors(8)} visible playful={false} paused={false} synthetic={false} />);
  expect(container.querySelectorAll('.hd-actor[data-actor^="pal:"]')).toHaveLength(7);
  expect(container.querySelectorAll('.hd-actor[data-actor^="custom:"]')).toHaveLength(6);
  expect(container.querySelectorAll(".hd-prop").length).toBeGreaterThan(10);
 });
 it("only real agent state shows a Pal working; ambient life is described as ambient", () => {
  render(<WorldHdOffice pals={pals({ nova: "responding", sage: "focus" })} visitors={[]} visible playful={false} paused={false} synthetic={false} />);
  const list = within(screen.getByRole("list", { name: "Who is in the room" })).getAllByRole("listitem").map(li => li.textContent ?? "");
  expect(list[0]).toBe("Nova: Responding to you (real activity)");
  expect(list[2]).toBe("Sage: Focus session with you (real activity)");
  for (const line of list.filter(l => !l.includes("(real activity)"))) {
   expect(line).toContain("(ambient animation");
   const ambient = line.slice(line.indexOf(":") + 1, line.indexOf("(")).toLowerCase();
   for (const word of AMBIENT_FORBIDDEN_WORDS) expect(ambient).not.toContain(word);
  }
  const tags = document.querySelectorAll(".hd-tag-real");
  expect([...tags].map(t => t.textContent)).toEqual(["Responding to you", "Focus session with you"]);
 });
 it("has camera controls: zoom, fit room and follow", () => {
  render(<WorldHdOffice pals={pals()} visitors={[]} visible playful={false} paused={false} synthetic={false} />);
  expect(screen.getByText("50%")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByText("63%")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Fit room" }));
  expect(screen.getByText("33%")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Follow a character" }), { target: { value: "pal:nova" } });
  expect(screen.getByText("Following Nova")).toBeInTheDocument();
  const room = screen.getByRole("application");
  fireEvent.keyDown(room, { key: "Escape" });
  expect(screen.queryByText("Following Nova")).not.toBeInTheDocument();
  fireEvent.keyDown(room, { key: "+" });
  expect(screen.getByText("41%")).toBeInTheDocument();
 });
 it("following a character brings them on screen even when the room is calm (no animation frames)", () => {
  const { container } = render(<WorldHdOffice pals={pals()} visitors={[]} visible playful={false} paused={false} synthetic={false} />);
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  for (const id of IDS) {
   fireEvent.change(screen.getByRole("combobox", { name: "Follow a character" }), { target: { value: "pal:" + id } });
   expect((container.querySelector(`.hd-actor[data-actor="pal:${id}"]`) as HTMLElement).style.visibility).toBe("visible");
  }
 });
 it("does not animate when the room is calm, paused (Focus Mode) or hidden", () => {
  const { container, rerender } = render(<WorldHdOffice pals={pals()} visitors={[]} visible playful={false} paused={false} synthetic={false} />);
  expect(container.querySelector(".hd-office")?.getAttribute("data-running")).toBe("false");
  rerender(<WorldHdOffice pals={pals()} visitors={[]} visible={false} playful paused={false} synthetic={false} />);
  expect(container.querySelector(".hd-office")?.getAttribute("data-running")).toBe("false");
  rerender(<WorldHdOffice pals={pals()} visitors={[]} visible playful paused synthetic={false} />);
  expect(container.querySelector(".hd-office")?.getAttribute("data-running")).toBe("false");
 });
 it("uses native Pal sprites unless synthetic placeholders are switched on", () => {
  const { container, rerender } = render(<WorldHdOffice pals={pals({}, 1)} visitors={[]} visible playful={false} paused={false} synthetic={false} />);
  expect(container.querySelector('[data-actor="pal:nova"]')?.getAttribute("data-art")).toBe("native");
  rerender(<WorldHdOffice pals={pals({}, 1)} visitors={[]} visible playful={false} paused={false} synthetic />);
  expect(container.querySelector('[data-actor="pal:nova"]')?.getAttribute("data-art")).toBe("synthetic");
  expect(screen.getByText(/synthetic placeholders/)).toBeInTheDocument();
 });
});

describe("Room Appearance setting", () => {
 it("chooses Auto/HD/Pixel and the HD office preview per device", () => {
  render(<WorldRoomAppearance />);
  fireEvent.click(screen.getByRole("radio", { name: "HD" }));
  expect(getWorldRoomAppearance().look).toBe("hd");
  const flag = screen.getByRole("checkbox", { name: /HD office preview/ });
  const synthetic = screen.getByRole("checkbox", { name: /Synthetic HD placeholders/ });
  expect(synthetic).toBeDisabled();
  fireEvent.click(flag);
  expect(getWorldRoomAppearance().hdOffice).toBe(true);
  expect(synthetic).not.toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: "Pixel" }));
  expect(screen.getByRole("status").textContent).toContain("This device shows Pixel");
 });
});
