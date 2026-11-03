# Meeting Threads — approved-only search and manual grouping

This first Meeting Threads increment is a private, owner-only way to retrieve decisions across meetings without exposing unreviewed drafts or pretending a calendar invitation proves attendance.

## Find a meeting

1. Complete a Meeting Vault original, review its transcript and summary, and click **Approve reviewed notes**.
2. Open **Capture Inbox → Meeting Threads · reviewed notes and decisions**.
3. Search for a decision, topic or phrase. The index searches approved meeting titles, summaries and transcripts only. Its excerpts are bounded and do not search the broader Obsidian vault, mail, or private Memory Keeper records.
4. Each result includes the reviewed date, summary/excerpt and the source meeting. The original SHA-256 is retained as an internal evidence receipt.

## Connect meetings manually

Choose **Link to thread** to enter a thread name (e.g., Weekly planning) and optional project identifier. This is deliberately manual. A project label organizes the meeting list; it does not share the meeting with other project members, Discord, other Pals or the Memory Keeper.

Changes require the latest link revision. You can unlink a meeting without deleting the recording, review, or existing Obsidian note.

## Limits

- Owner-session only; no public API keys, Discord bot permissions or automatic scheduled access.
- Only approved reviews are indexed. Editing a reviewed transcript returns it to draft, which removes it from Meeting Threads until re-approved.
- Search is keyword-based, not semantic BM25/embedding hybrid search. It returns a short passage of existing text; it cannot verify claims or infer attendance.
- Speaker identities, action ownership and precise word-level timestamps remain unverified until manually corrected. The existing approximate three-minute audio ranges are not precise evidence.
- No task, reminder, approved memory or Obsidian note is created by adding or removing a thread label.

Future work includes verified timestamp evidence, reviewable Smart Linking suggestions, per-meeting action item approval, and pre-meeting briefing suggestions sourced from confirmed notes.

## On-demand preparation brief

After linking at least one **reviewed** meeting into a named thread, click **Prepare brief** beside its thread name (and project label, when set). Pixel Pals assembles up to 12 most recently approved meeting summaries into a plain-text briefing. Each entry includes its meeting ID, approval date, original audio SHA-256, and thread-link revision. Use **Copy brief** only when you have permission to share these meeting details. The brief is generated only when you click, remains on your current device, and is not sent to any AI model, Discord, or external app.

The feature requires an owner session and an exact thread and project match. Unreviewed, unlinked, or other-project meetings are excluded. No upcoming calendar attendance, speaker identity, task owner or action completion is assumed. The on-demand brief is a source compilation, **not** a future-meeting calendar notification or autonomous AI action. Older approved summaries may be outdated; check their recordings before relying on decisions.
