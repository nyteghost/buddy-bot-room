import { scrubChatText, type ScrubOptions } from "./chat-scrub";

/** Decode line-oriented protocols across arbitrary UTF-8/network boundaries. */
export async function* responseLines(response: Response, signal?: AbortSignal) {
  if (!response.body) throw Error("The response stream is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      signal?.throwIfAborted();
      pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (pending.length > 4_000_000) throw Error("Response frame exceeded the size limit.");
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        yield pending.slice(0, end).replace(/\r$/, "");
        pending = pending.slice(end + 1);
      }
      if (chunk.done) break;
    }
    if (pending) yield pending;
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Never release an unfinished token. Credential-like lines and everything after them
 * wait for final scrubbing, including quoted multi-line values and private keys. */
export function answerPreview(raw: string, options: ScrubOptions = {}): string {
  const risky =
    /(?:password|passwd|pwd|token|secret|authorization|cookie|username|login|email|api[ _-]?key|bearer|basic|ssh|curl|wget|BEGIN|\bpass\b|\buser\b|_user)|[a-z][a-z0-9+.-]*:\/\/|--user\b/i.exec(
      raw,
    );
  let safe = raw;
  if (risky) safe = raw.slice(0, raw.lastIndexOf("\n", risky.index) + 1);
  const lastSpace = Math.max(safe.lastIndexOf(" "), safe.lastIndexOf("\n"), safe.lastIndexOf("\t"));
  return scrubChatText(safe.slice(0, lastSpace + 1), options);
}
