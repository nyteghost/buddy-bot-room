import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TranscriptMoments } from "@/components/transcript-moments";
afterEach(cleanup);
it("requires a deliberate speaker action and only changes the editable draft", () => {
  const change = vi.fn();
  render(<TranscriptMoments id="fixture" text="[00:00:01 - 00:00:03] Hello" onChange={change} />);
  fireEvent.click(screen.getByText("Listen and correct speakers"));
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Confirmed speaker name"), { target: { value: "Alex" } });
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply speaker to this segment" }));
  expect(change).toHaveBeenCalledWith("[00:00:01 - 00:00:03] {Speaker: Alex} Hello");
});
