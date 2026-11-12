// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorldIsoOffice } from "@/components/world-iso-office";
import { WORLD_ISO_PAL_IDS } from "@/lib/world-iso-schedule";
import type { HdOfficePal } from "@/components/world-hd-office";

vi.mock("@/lib/reduced-motion", () => ({ useReducedMotion: () => true }));
vi.mock("@/lib/power", () => ({ lowPower: { use: () => false }, useTabHidden: () => false }));
const pals: HdOfficePal[] = WORLD_ISO_PAL_IDS.map(id => ({ id, name: id, enabled: true, real: null }));

describe("isolated isometric Office component (unmounted in the real app)", () => {
 it("renders a synthetic diamond office with the stable nine-Pal roster", () => {
  const { container } = render(<WorldIsoOffice pals={pals} visitors={[]} visible playful paused={false} synthetic />);
  expect(screen.getByTestId("iso-preview-svg")).toBeTruthy();
  expect(screen.getByTestId("iso-preview-floor")).toBeTruthy();
  expect(container.querySelectorAll("[data-iso-actor]").length).toBe(9);
  expect(container.querySelectorAll("[data-iso-prop]").length).toBeGreaterThanOrEqual(9);
  expect(container.querySelector("[data-iso-preview]")?.getAttribute("data-running")).toBe("false");
  expect(container.querySelector("[data-iso-fallback]")).toBeNull();
 });
 it("only shows a real-work badge for authoritative real activity", () => {
  const active: HdOfficePal[] = pals.map(p => p.id === "nova" ? { ...p, real: "focus" } : p);
  const { container } = render(<WorldIsoOffice pals={active} visitors={[]} visible playful paused={false} synthetic={false} />);
  expect(container.querySelectorAll("[data-iso-real]").length).toBe(1);
  expect(container.querySelector('[data-iso-real="focus"]')).toBeTruthy();
  expect(screen.getByText(/Real activity — focus/)).toBeTruthy();
 });
 it("accepts an externally owned camera state without editing active camera controls", () => {
  render(<WorldIsoOffice pals={pals.slice(0, 1)} visitors={[]} visible playful={false} paused synthetic={false}
   camera={{ x: 1376, y: 800, zoom: 0.5 }} viewport={{ width: 900, height: 600 }} />);
  expect(screen.getByTestId("iso-preview-svg")).toBeTruthy();
 });
});
