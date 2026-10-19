/**
 * Hides a reasoning model's "thinking" from the pals' replies.
 *
 * Local reasoning models (qwen3, deepseek-r1, …) often stream their scratch work inline as
 * <think>…</think>. Left alone, it clutters the bubble and eats the token budget. The filter is
 * incremental, so a tag split across two stream chunks ("<thi" + "nk>") is still caught.
 */
const OPEN_TAGS = ["<think>", "<thinking>", "<thought>"];
const CLOSE_TAGS = ["</think>", "</thinking>", "</thought>"];
const ALL_TAGS = [...OPEN_TAGS, ...CLOSE_TAGS];
const LONGEST_TAG = Math.max(...ALL_TAGS.map((t) => t.length));

function earliest(haystack: string, tags: string[]): { index: number; tag: string } | null {
  const lower = haystack.toLowerCase();
  let best: { index: number; tag: string } | null = null;
  for (const tag of tags) {
    const index = lower.indexOf(tag);
    if (index !== -1 && (!best || index < best.index)) best = { index, tag };
  }
  return best;
}

/** Index where a trailing, still-incomplete tag begins (so we can hold it back), or -1. */
function partialTagStart(text: string, tags: string[]): number {
  const from = Math.max(0, text.length - (LONGEST_TAG - 1));
  for (let i = text.lastIndexOf("<"); i >= from; i = text.lastIndexOf("<", i - 1)) {
    const rest = text.slice(i).toLowerCase();
    if (tags.some((tag) => tag.startsWith(rest))) return i;
    if (i === 0) break;
  }
  return -1;
}

export function createThinkFilter() {
  let buffer = "";
  let thinking = false;
  let trimLeading = false;

  function emit(text: string): string {
    if (!trimLeading) return text;
    const trimmed = text.replace(/^\s+/, "");
    if (trimmed) trimLeading = false;
    return trimmed;
  }

  function drain(final: boolean): string {
    let out = "";
    for (;;) {
      if (thinking) {
        const close = earliest(buffer, CLOSE_TAGS);
        if (close) {
          buffer = buffer.slice(close.index + close.tag.length);
          thinking = false;
          trimLeading = true;
          continue;
        }
        // Still inside the thought: drop it, keeping only a possible half-written closing tag.
        const keep = final ? -1 : partialTagStart(buffer, CLOSE_TAGS);
        buffer = keep === -1 ? "" : buffer.slice(keep);
        return out;
      }
      const hit = earliest(buffer, ALL_TAGS);
      if (hit) {
        out += emit(buffer.slice(0, hit.index));
        buffer = buffer.slice(hit.index + hit.tag.length);
        if (OPEN_TAGS.includes(hit.tag)) thinking = true;
        else trimLeading = true; // stray closing tag: just remove it
        continue;
      }
      const keep = final ? -1 : partialTagStart(buffer, ALL_TAGS);
      if (keep === -1) {
        out += emit(buffer);
        buffer = "";
      } else {
        out += emit(buffer.slice(0, keep));
        buffer = buffer.slice(keep);
      }
      return out;
    }
  }

  return {
    /** Feed the next streamed chunk; returns the visible text it releases. */
    push(chunk: string): string {
      buffer += chunk;
      return drain(false);
    },
    /** Call when the stream ends; releases any held-back text (an unfinished thought is dropped). */
    flush(): string {
      return drain(true);
    },
  };
}

/** One-shot version for text that arrives all at once. */
export function stripThinking(text: string): string {
  const filter = createThinkFilter();
  return (filter.push(text) + filter.flush()).trim();
}

/** Models that think out loud first. They need a bigger token budget or the answer never arrives. */
export function isReasoningModel(model: string): boolean {
  return /deepseek-r1|qwq|qwen3(?!-coder)|gpt-oss|magistral|phi4-reasoning|cogito|reasoning|thinking/i.test(model);
}

/** Reply budget per turn: short by default, roomier when the model spends tokens thinking. */
export function maxTokensFor(model: string): number {
  return isReasoningModel(model) ? 1500 : 400;
}
