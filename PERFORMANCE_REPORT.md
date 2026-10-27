# Performance report (branch `upgrade/local-first`)

Rules: numbers below are either counted from the real code path on a simulated clock, or timed on the authoring sandbox. Nothing is a browser profile unless it says so. Run the benchmarks yourself to compare on your machine.

## M1. Chat streaming: UI updates and browser saves

**Finding (confirmed in code):** every streamed token called `setMessages(...)`, which changed `chats`, and an effect then ran `JSON.stringify(chats)` + `localStorage.setItem` for *all five mode windows* on every token.

**Change:** `src/lib/stream-throttle.ts` (first token immediately, then at most one UI update per 50 ms, last token always delivered) and `src/lib/debounced-save.ts` (save 400 ms after things go quiet, never later than 2 s during a long reply; flushed on tab hide, page close, unmount and before a backup export). Cancelling a reply still flushes what had streamed.

**Benchmark:** `node --experimental-strip-types scripts/bench-streaming.mts` (one reply of 1,200 tokens at 25 ms/token, ~30 s, on top of an existing history of 1.5 KB messages). "OLD" is the previous behaviour modelled as one update + one full save per token; "NEW" runs the real new modules on a fake clock. Stringify time is measured, not estimated.

| history | OLD updates | OLD saves | OLD data serialized | OLD stringify time | NEW updates | NEW saves | NEW data serialized | NEW stringify time |
|---|---|---|---|---|---|---|---|---|
| short (4 msgs) | 1200 | 1200 | 7.7 MB | 35 ms | 601 | 15 | 0.1 MB | ~0 ms |
| medium (40) | 1200 | 1200 | 76.9 MB | 619 ms | 601 | 15 | 1.0 MB | 8 ms |
| long (400) | 1200 | 1200 | 769.5 MB | 2333 ms | 601 | 15 | 9.6 MB | 29 ms |

Saves drop by ~98 % and UI updates by ~50 % with no added delay on the first token.

**Not measured:** real React render counts and frame times (needs a browser profile of the running app). Check in Chrome DevTools > Performance while a long reply streams.
