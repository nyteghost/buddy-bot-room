import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocusCompanion } from "@/components/focus-companion";
import { ResumeFocusCard } from "@/components/resume-focus-card";
import { getFocusCheckpoint, saveFocusCheckpoint } from "@/lib/focus-checkpoint-store";
import { FOCUS_CHECKPOINT_KEY, type FocusSession } from "@/lib/focus-companion";
const saved: FocusSession = { task: "Write a report", step: "Write the first sentence", stepNumber: 2, completed: ["Open the document"], pal: "echo", mode: "quiet" };
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("Home focus recovery", () => {
  it("updates immediately after explicit save and resumes only on a click", () => {
    const resume = vi.fn();
    render(<ResumeFocusCard onResume={resume} />);
    expect(screen.queryByRole("region", { name: "Where was I?" })).toBeNull();
    act(() => { expect(saveFocusCheckpoint(saved)).toBe(true); });
    expect(screen.getByText(/Write the first sentence/)).toBeTruthy();
    expect(resume).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Resume my saved step" }));
    expect(resume).toHaveBeenCalledWith(saved);
  });
  it("survives remount and clears only the checkpoint when dismissed", () => {
    localStorage.setItem("unrelated-note", "Keep this");
    saveFocusCheckpoint(saved);
    const view = render(<ResumeFocusCard onResume={vi.fn()} />);
    view.unmount();
    render(<ResumeFocusCard onResume={vi.fn()} />);
    expect(screen.getByText(saved.task)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss checkpoint" }));
    expect(getFocusCheckpoint()).toBeNull();
    expect(localStorage.getItem("unrelated-note")).toBe("Keep this");
  });
  it("handles malformed storage and synchronizes another tab's saved place", () => {
    localStorage.setItem(FOCUS_CHECKPOINT_KEY, "not valid JSON");
    render(<ResumeFocusCard onResume={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Where was I?" })).toBeNull();
    act(() => {
      localStorage.setItem(FOCUS_CHECKPOINT_KEY, JSON.stringify(saved));
      window.dispatchEvent(new StorageEvent("storage", { key: FOCUS_CHECKPOINT_KEY }));
    });
    expect(screen.getByText(saved.task)).toBeTruthy();
  });
  it("keeps the last saved checkpoint if a replacement cannot be stored", () => {
    saveFocusCheckpoint(saved);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
    expect(saveFocusCheckpoint({ ...saved, task: "Different task" })).toBe(false);
    expect(getFocusCheckpoint()?.task).toBe(saved.task);
  });
});

it("cancels old step suggestions when a different checkpoint replaces the session", async () => {
  let respond!: (value: Response) => void;
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>(resolve => { respond = resolve; });
  }));
  const change = vi.fn();
  const view = render(<FocusCompanion key="original" session={saved} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Done with step" }));
  const resumed = { ...saved, task: "Resume a different task" };
  view.rerender(<FocusCompanion key="resumed" session={resumed} onChange={change} />);
  expect(signal?.aborted).toBe(true);
  change.mockClear();
  await act(async () => { respond(Response.json({ step: "Late stale suggestion", source: "local-ai" })); });
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByText(resumed.task)).toBeTruthy();
});
