import { afterEach, describe, expect, it, vi } from "vitest";
import { isAbortError, logStreamError } from "@/lib/ai/stream-errors.server";

afterEach(() => vi.restoreAllMocks());
describe("AI stream cancellation", () => {
  it("does not report an explicit cancellation as a runtime crash", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    logStreamError({ error: new DOMException("This operation was aborted", "AbortError") });
    expect(log).not.toHaveBeenCalled();
  });
  it("recognizes an HTTP error wrapping a cancellation", () => {
    expect(isAbortError(new Error("HTTPError", {
      cause: new DOMException("This operation was aborted", "AbortError"),
    }))).toBe(true);
  });
  it("continues reporting genuine provider errors", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Provider unavailable");
    logStreamError({ error });
    expect(log).toHaveBeenCalledWith(error);
    expect(isAbortError(error)).toBe(false);
  });
});