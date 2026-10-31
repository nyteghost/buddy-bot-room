import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StuckHelp } from "@/components/stuck-help";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("I'm stuck choices", () => {
  it("opens the choices without inference or changing the current step", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const apply = vi.fn();
    render(<StuckHelp task="Write a report" step="Write one sentence" onUseStep={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "I'm stuck" }));
    expect(screen.getByRole("button", { name: "Explain it" })).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  });
  it("lets the user apply instant offline help while cancelling the pending refinement", () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => { signal = init?.signal; return new Promise(() => {}); }));
    const apply = vi.fn(); render(<StuckHelp task="Write a report" step="Write one sentence" onUseStep={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "I'm stuck" }));
    fireEvent.click(screen.getByRole("button", { name: "Make it smaller" }));
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use this smaller step" }));
    expect(apply).toHaveBeenCalledWith(expect.stringContaining("find the document")); expect(signal?.aborted).toBe(true);
  });
  it("ignores an old response after a different choice is selected", async () => {
    const pending: Array<(response: Response) => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => pending.push(resolve))));
    const apply = vi.fn(); render(<StuckHelp task="Write a report" step="Write one sentence" onUseStep={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "I'm stuck" }));
    fireEvent.click(screen.getByRole("button", { name: "Explain it" }));
    fireEvent.click(screen.getByRole("button", { name: "Show a sample" }));
    await act(async () => pending[1]!(Response.json({ choice: "sample", text: "The current sample", source: "local-ai" })));
    await act(async () => pending[0]!(Response.json({ choice: "explain", text: "Obsolete explanation", source: "local-ai" })));
    expect(screen.getByText("The current sample")).toBeTruthy(); expect(screen.queryByText("Obsolete explanation")).toBeNull(); expect(apply).not.toHaveBeenCalled();
  });
  it("cancels when the task changes and never silently applies an explanation", async () => {
    let respond!: (response: Response) => void; let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => { signal = init?.signal; return new Promise<Response>(resolve => { respond = resolve; }); }));
    const apply = vi.fn(); const view = render(<StuckHelp task="First task" step="Find the file" onUseStep={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "I'm stuck" })); fireEvent.click(screen.getByRole("button", { name: "Explain it" }));
    view.rerender(<StuckHelp task="Different task" step="Open the page" onUseStep={apply} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => respond(Response.json({ choice: "explain", text: "A late explanation", source: "local-ai" })));
    expect(screen.queryByText("A late explanation")).toBeNull(); expect(apply).not.toHaveBeenCalled();
  });
});
