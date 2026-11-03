# Meeting Vault — long meeting recording imports (beta)

This is **original-audio storage only**, not yet the Pal Meeting Memory transcription and summarization pipeline.

## How to use it

1. Record a meeting using **iPhone Voice Memos** or another reliable recorder. Keep the original on your phone. Browser/PWA recording is not yet considered reliable when iOS locks or changes apps.
2. Confirm employer policy and participant consent before recording, sending, or keeping meeting audio on personal Unraid. Private transfer over Tailscale does **not** mean employer authorization.
3. Open **Pixel Pals → Capture Inbox → Meeting Vault · longer recordings**. Select the original supported audio file (.m4a, .mp3, .wav, .webm, .ogg, .aac, .flac). Size limit: 512 MiB per recording. This first version supports up to 40 records in the vault.
4. Optionally name the meeting. Check the permission confirmation checkbox and press **Save or resume original audio**.
5. The client uploads 1 MiB chunks, each with a browser-computed SHA-256 checksum. The server checks byte counts and hashes and stores the received parts with restrictive permissions. Once all parts are received, it assembles the original and saves a full-file SHA-256 fingerprint.
6. If the network disconnects, keep the phone original, return here, reselect the **same file** and choose Save or resume again. Uploads already recorded on the server are skipped; a mismatching repeat chunk is rejected.
7. A completed recording shows **Original stored** with an audio player and SHA-256. No AI summary, project link, task, permanent memory or note is created.
8. To permanently delete an original, use **Delete recording…** and approve the separate confirmation. Deletion uses a revision check.

## Storage and privacy

- Each meeting is stored in a UUID-named folder within BUDDY_DATA_DIR/meeting-vault, with record metadata, verified original audio, and temporary chunks. Directories are mode 0700 and original files mode 0600.
- Original audio is **not encrypted at rest by the application**. Protect Unraid shares, accounts, storage snapshots, and backups. Files contain raw audio; credential scrubbing in text cannot sanitize audio.
- Audio playback is an owner-session-only same-origin endpoint supporting HTTP byte ranges, not a public download link. The Discord bot, other app users and cloud AI are not given access by this feature.
- The original remains on Unraid after the upload. Meeting notes are expected to live beside it in a future approved-review workflow; they are **not written yet**.
- Temporary upload parts are removed after successful assembly. Abandoned incomplete imports remain in the vault until manually deleted; the app does not silently delete originals.

## Reliability and limitations

- Resume works when the original is reselected and has the same name, size, and accepted MIME type. Idempotent chunk verification catches mismatching retries.
- Browser file access is not persistent across iPhone reloads, and uploads require the page to stay active. Start with Voice Memos for long meetings.
- The server stores one full-file SHA-256 fingerprint based on the assembled upload. Per-chunk checksums protect the transfer; no independent full-file hash from iOS is compared yet.
- A maximum of 1 MiB per upload request avoids loading the whole audio in server memory; finalization streams one part at a time. Importing a 512 MiB file still requires space for its chunks and assembled original during finalization.
- Hardware tests are still required for iPhone file selection, upload interruptions, network conditions, player seek, and available disk space. Do not delete your Voice Memo until you have verified storage and playback.
- Coming later: transcription through approved local Whisper processing, review-first transcript and summaries, manual speaker corrections, protected Meeting Vault notes, approved Obsidian export, Meeting Threads, project Smart Linking and optional Discord voice recording.

## Troubleshooting

If an import fails, leave the partial record in place, keep the original file and reselect that same file to resume. If the file's contents changed, the server rejects the conflicting chunk rather than silently replacing your original. Report problems without uploading private audio or secret URLs into public support channels.
## Local Whisper transcription and review (later beta increment)

Once Original stored is visible, expand **Review transcript and meeting notes**. You can paste a transcript, edit your speaker uncertainty notes and save a private draft. Optional local AI summary generation is separate and limited to 16,000 transcript characters for a single pass. Review and explicitly approve the result, then choose whether to export a note into Obsidian. Neither importing nor approving automatically publishes a note or creates tasks. See [Meeting Review](MEETING_REVIEW_BETA.md).

## Explicit local Whisper

Under each completed recording's **Review transcript and meeting notes**, choose **Transcribe with local Whisper** if your private Whisper endpoint is configured. Transcription is never started by uploading audio; it requires a separate confirmation. The worker processes the recording in three-minute segments and saves progress on Unraid so interrupted jobs can be manually resumed. It does not create approved notes or verified speaker labels. See [Local Whisper](MEETING_WHISPER_BETA.md).
