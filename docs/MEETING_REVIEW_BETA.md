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
