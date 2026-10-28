# Mail performance report

Branch `perf/mail`, merged into the beta branch (`upgrade/local-first`). Everything below says whether it was **measured**, **tested** or is **unverified**.

> **Read this first.** No real mail account was available. All timings come from a **simulated IMAP server** (`src/test/helpers/fake-imap.ts`) with a fixed 40 ms round-trip delay and 5,000 messages in the inbox. The shape of the result (fewer connections, fewer logins, fewer commands, fewer bytes) carries over to a real provider. The exact milliseconds will not: Gmail's real latency, TLS cost and server-side work differ. Nothing here has been run against Gmail, Outlook, iCloud or Fastmail.

## What was slow (confirmed in the code)

1. **One TCP + TLS connection and one LOGIN per operation.** Every list, open, move, delete, flag change and search opened a fresh connection, signed in, ran its commands and logged out. A normal browsing session (inbox, three reads, Sent, inbox) paid for 6 connections and 6 logins.
2. **Repeated mailbox-wide work.** Listing ran `UID SEARCH ALL` over the whole folder and then fetched headers; folder discovery (`LIST`) ran on every call.
3. **Search by the client for nothing but plain words.** There was no sender, subject, date or unread syntax; everything went through `TEXT`.
4. **No reuse of anything.** Opening a message downloaded it again every time; going Back from a message reloaded the list.
5. **Frontend race.** A slow answer for the previous folder could overwrite the folder you had just switched to.

## What changed

### IMAP connections (`src/lib/imap-client.server.ts`, rewritten)
- Bounded **per-account pool**, keyed by host, port, user and a hash of the password (never the password itself), so accounts and password changes never share a connection.
- Each connection is leased **exclusively** for one operation, so commands from two operations can never interleave and folder selection (a connection-level state) can't be corrupted. Every operation does its own `SELECT`/`EXAMINE`.
- Idle connections close after `IMAP_IDLE_SECONDS` (default 90); connections older than 10 minutes are retired; a connection idle for more than 10 seconds is checked with `NOOP` before reuse.
- Dropped, timed-out or half-finished connections are destroyed, never returned to the pool. Timeouts: connect 15 s, command 25 s, whole operation 40 s.
- **Safe retry:** if a *reused* connection turns out to be dead before anything completed, and the first command is read-only, the operation is retried once on a fresh connection. Anything that could have changed mail (move, delete, store, append) is never retried.
- Sign-in failures back off for 30 s so a wrong password can't hammer the provider or lock the account.
- Waiters queue for up to 30 s when all connections are busy. `closeAllImap()` shuts everything down. Stats are available through `imapStats()` (no secrets).
- The browser never sees a connection, host credentials or the pool key.

### Inbox, folders, search (`src/lib/mailbox.server.ts`, `mailbox.ts`, `mail-cache.ts`)
- The newest page is fetched **by message number** from the `EXISTS` count in the `SELECT` reply: no mailbox-wide `UID SEARCH`.
- Paging with `offset` (`newestRange`): no gaps or overlaps.
- **Server-side IMAP SEARCH** with operators: `from:` `to:` `subject:` `since:YYYY-MM-DD` `before:YYYY-MM-DD` `is:unread` `is:read`, plain words search the whole message as before. Values are quoted and escaped so a search can't inject IMAP commands. Bad dates get a plain explanation before any network call.
- **In-memory caches only** (nothing is written to disk): folder list (60 s), message lists, opened bodies. Lists are checked against the server every time with the `SELECT` numbers (UIDVALIDITY + UIDNEXT + EXISTS); a change shows new mail at once. Body keys include UIDVALIDITY, so a rebuilt folder never serves old content. Moves, deletes, read/unread changes, notes and the Refresh button invalidate the account's cache. Entries are bounded in count and size, per account.
- Bodies are plain text only (as before), so there is no HTML to sanitise. Attachments are listed by name and are not downloaded.

### Frontend (`src/components/mailbox.tsx`)
- Only the newest list request may update the screen; older ones are aborted and ignored (fixes the folder race).
- Folders you've already visited show immediately from a small in-session cache while the fresh copy loads.
- Back from a message no longer reloads the list; delete, move and mark-unread do reload. Refresh asks the server for a fresh copy (`fresh=1`).
- "Load older" pages back through the folder; the search box hint lists the operators.
- Not profiled in a browser. Verified by type-checking only; there is no component test harness in the repo.

## Measurements (simulated server, 40 ms RTT, 5,000 messages, median of 5 cold runs)

Reproduce: `bun --preload ./scripts/bench-preload.ts scripts/bench-mail.mts` (`MAIL_BENCH_RTT`, `MAIL_BENCH_N`, `MAIL_BENCH_RUNS`). The "before" column is the old per-request client run through the same harness.

| Operation | Before (ms / conns / logins / commands / KB) | After, cold (same measures) | After, pooled connection | After, repeat (cache) |
|---|---|---|---|---|
| Inbox open (30 newest) | 329 / 1 / 1 / 6 / 30 | 285 / 1 / 1 / 5 / 7 | 122 / 0 / 0 / 3 / 7 | 41 / 0 / 0 / 1 / 0 |
| Open a message | 286 / 1 / 1 / 5 / 2 | 285 / 1 / 1 / 5 / 2 | 121 / 0 / 0 / 3 / 2 | 41 / 0 / 0 / 1 / 0 |
| Switch to Sent | 325 / 1 / 1 / 6 / 4 | 285 / 1 / 1 / 5 / 4 | 122 / 0 / 0 / 3 / 4 | 41 / 0 / 0 / 1 / 0 |
| Search (subject text) | 337 / 1 / 1 / 6 / 1 | 342 / 1 / 1 / 6 / 1 | 173 / 0 / 0 / 4 / 1 | 41 / 0 / 0 / 1 / 0 |
| **Session**: inbox, 3 reads, Sent, inbox | **1833 / 6 / 6 / 38 / 70** | – | **653 / 1 / 1 / 14 / 15** | – |

What this shows:
- The big win is **not reconnecting**: about 160 ms (4 round trips of connect, TLS and login) per operation disappears once a connection is warm. The whole browsing session is about 2.8× faster in the simulation, with 1 connection and 1 login instead of 6 each.
- The first page of the inbox downloads about 4× less (7 KB vs 30 KB) because it no longer runs a mailbox-wide search first.
- A cold single operation is roughly unchanged (285–342 ms vs 286–337 ms): the extra `SELECT` that makes caching safe costs about what the removed search saved. In particular **cold search is not faster** (342 vs 337 ms, within noise). The search gain is in the new operators and in server-side filtering, not speed.
- "Repeat" rows (41 ms, 1 command, 0 KB) are cache hits that still verify freshness with one `SELECT`.
- Backend memory in the harness: heapUsed 2.3 → 6.1 MB, rss 40 → 53 MB (before: 2.2 → 6.4 MB, 40 → 56 MB). Not a measurement of a long-running server.
- Frontend responsiveness was **not measured**.

## Tests

All run against the simulated IMAP/SMTP servers; run locally under Bun (28 + 34 + 5 + the existing 4 attachment tests passed, repeated 3 times for the first two) and in CI under Vitest.

| File | Covers |
|---|---|
| `src/test/imap-pool.test.ts` (28) | reuse, reuse off, pool limit, concurrency and waiting, idle cleanup, max age, shutdown, drops, probe, timeouts, BYE, operation deadline, safe retry and no retry after a change, auth failure and backoff, account isolation, password change, no credential exposure |
| `src/test/mailbox-pipeline.test.ts` (34) | search syntax, SELECT parsing, paging, cache expiry/size, cache hits and invalidation, new mail, UIDVALIDITY change, server-side search, mark/move/delete, rapid folder switching |
| `src/test/mail-send.test.ts` (5) | one send = one connection and one DATA; **a connection that drops after the message was handed over is never retried**; refused recipient/password not retried; invalid mail never connects; 20/hour limit |

Not covered: a real provider; IDLE (not implemented); the React component (type-checked only).

## Settings (Setup window → Mail)

| Setting | Default | Meaning |
|---|---|---|
| `IMAP_POOL_MAX` | 2 | connections kept per account, 1–4 |
| `IMAP_IDLE_SECONDS` | 90 | close idle connections after this; `0` turns reuse off (old behaviour) |
| `MAIL_CACHE_SECONDS` | 30 | how long lists/bodies are remembered in memory; `0` turns the cache off |

## Known limitations
- Simulated numbers only. Please run the benchmark's logic against your own account before trusting the exact figures.
- **IMAP IDLE is not implemented.** Mail alerts and the living room still poll; polling now runs through the pool, so a poll reuses a connection instead of logging in each time. IDLE would need a long-lived connection per account, which I did not add without a measured benefit.
- Gmail's folder semantics (labels, `All Mail`) are as before; the pipeline assumes standard `SELECT` numbers and `UID MOVE`/`COPY` + `EXPUNGE` fallbacks that already existed.
- Cached data lives in server memory and is lost on restart (by design: no mail content on disk).
- `Load older` pages by message number; very large searches page by result index.
- The sent-mail rate limit counts only sends that completed. A send that was delivered but reported an error is not counted.

## Recommendations
1. Try it on the real account: open Mail, switch folders, watch for slowness, then check `Setup → Mail` values.
2. If you notice a provider disconnecting idle connections quickly, lower `IMAP_IDLE_SECONDS`.
3. Next candidates: IMAP IDLE for the alert path, lazy attachment download and preview (this is the first step of the PDF/Excel viewer work), and virtualising the list only if folders are paged far deeper than ~200 rows.
