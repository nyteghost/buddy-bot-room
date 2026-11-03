# Meeting Review — explicit approval and Obsidian notes

**Current scope:** review-first drafts for completed original recordings. Recording, transcription, summarization, approval, memory and note publication are separate operations.

## Using the feature

1. Open **Capture Inbox → Meeting Vault · longer recordings**, select a recording labeled **Original stored**, then expand **Review transcript and meeting notes**.
2. Either paste a transcript from an authorized transcription tool or explicitly run the **Transcribe with local Whisper** section (if configured). Imported audio is never forwarded to Whisper automatically. Local speech output is an unapproved draft that must be checked and corrected.
3. Optionally click **Draft summary with local Ollama**. The saved transcript is sent only to the configured local Ollama provider, no web search or cloud-model fallback. This beta supports single-pass transcripts up to 16,000 characters; longer recordings need the future chunked pipeline.
4. Edit and correct the resulting summary and speaker-uncertainty notes; AI output is never approved automatically.
5. Click **Approve reviewed notes** only after confirming the transcript and summary. If you edit them again, the review reverts to draft and requires approval again.
6. Separately click **Export approved note to Obsidian**. The server writes a versioned Markdown note inside `OBSIDIAN_VAULT_DIR/Pixel Pals/Meetings/` with meeting ID, approved revision and original audio fingerprint. If the note exists already, export refuses to overwrite it.

## Privacy and data

- Every request requires an authenticated owner session. Discord, scheduled agents and other users cannot invoke this review endpoint.
- Transcript, draft, approval state and exported-path receipts are stored beside original audio in `BUDDY_DATA_DIR/meeting-vault/<meeting-id>/review.json` with restrictive permissions.
- The raw transcript is sensitive, even if identifiable data has been removed elsewhere. Protect your Unraid storage, vault mounts, backups and connected local Ollama endpoint.
- The markdown export includes reviewed transcript and summary, but **does not copy raw audio** into Obsidian.
- Nothing enters the canonical Memory Keeper, project-specific retrieval, Today tasks or Discord automatically. Those require separate reviewed workflows.
- The model can misunderstand a meeting or follow malicious instructions embedded in the transcript despite instruction boundaries. Inspect and correct everything before approving.
- Work meetings or other people's voices should not be imported without relevant permissions and organizational approval.

## Recovery

- The app uses per-review revision checks: an outdated tab cannot silently overwrite a newer saved draft.
- An existing exported note remains unchanged when a later revision is approved; re-export creates a new revisioned note, never overwrites manually edited content.
- A failure before completing an export can leave a note on disk without updating the receipt. The next attempt refuses to overwrite that note; inspect it in Obsidian to reconcile.
- An explicit local-Whisper transcription worker is now available for long recordings, with three-minute chunks, recoverable progress and approximate segment ranges. Word-level timestamps, automatic speaker diarization, meeting threads and final hardware validation remain planned.

## Meeting Threads after review

After approving a meeting review, open **Capture Inbox → Meeting Threads** to search the approved summary/transcript and optionally link it to a manually named thread or project label. These links are not automatic and do not grant other users permission to access the meeting. See [Meeting Threads](MEETING_THREADS_BETA.md).

## Explicit Today action approval

After approving the meeting notes, open **Create a Today task from this approved meeting…** under its Meeting Review. Enter a task title and optional notes, check the separate confirmation, then click **Create approved Today task**. This creates a private Today planner task with the reviewed meeting ID and review revision in its notes. The app does not extract assignments, infer an owner, or create reminders from the transcript. It does not create tasks while the review is in draft.

Retries of the same approved meeting action are idempotent; a stale revision is refused and duplicate open task titles are not added. Edit or mark the task complete in Today as usual. The original recording, approved review, and Obsidian note are not modified by this action. To keep work data private, only use this after confirming your organization's policy allows its storage in Pixel Pals.

## Listen and correct speakers

Expand **Listen and correct speakers** for timestamped transcripts. **Listen from here** seeks the original recording only after your click. Enter a confirmed speaker name and apply it to an individual segment; this changes the draft only. Save edits and approve the review separately. Speaker names are never inferred from audio by this feature. Keep the original recording open in Meeting Vault for playback.
