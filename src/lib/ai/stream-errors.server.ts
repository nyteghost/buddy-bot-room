/** Cancellation is expected control flow, including when wrapped by the HTTP layer. */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("name" in error && error.name === "AbortError") return true;
  return "cause" in error && error.cause !== error ? isAbortError(error.cause) : false;
}

export function logStreamError({ error }: { error: unknown }) {
  if (!isAbortError(error)) console.error(error);
}