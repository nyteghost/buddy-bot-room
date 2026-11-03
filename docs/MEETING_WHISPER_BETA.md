# Long-recording local Whisper transcription (beta)

Pixel Pals can now **explicitly** transcribe a completed Meeting Vault original using your existing local Whisper service. It is not automatic, and never uses a paid/cloud fallback.

## Setup and use

1. Configure a private local OpenAI-compatible Whisper transcription endpoint in **Settings → Dictation** (`WHISPER_URL`). The service must be reachable from the Unraid container. Accepted URL hosts are local Docker service names, localhost or RFC1918/Tailscale private IPs (or `.local`, `.lan` / `.internal` names). Public Internet Whisper endpoints are blocked here.
2. Open a completed original in **Capture Inbox → Meeting Vault → Review transcript and meeting notes**.
3. In **Transcribe with local Whisper**, confirm that the recording and its transfer to this configured local service are authorized. Click **Start local transcription**.
4. The container uses bundled ffprobe and ffmpeg to convert the original to three-minute, 16-kHz mono WAV segments, each under the bounded size limit. It sends each segment to your local Whisper API and saves the text and progress on Unraid.
5. If a connection, model, server or restart interrupts the work, review the status and choose **Resume** explicitly. Pause stops further processing; resetting saved parts requires another confirmation and does not delete the original recording.
6. Once the status says **Draft ready**, click **Reload review** to inspect the transcript. Segment time ranges are approximate and are not proof of a specific word's time or speaker identity.
7. Correct transcription and speaker notes; optionally ask local Ollama for a draft summary; approve the edited meeting review; then separately export an approved Obsidian note if desired.

## Safeguards and limits

- Owner-session authorization is checked by the API on every request. Discord commands, other users and auto-schedulers do not start recording or transcription.
- The `WHISPER_URL` is configured on the server, not provided by the HTTP caller. It must resolve to a local/private naming pattern; no automatic fallback to public providers is configured. This is not a full network isolation guarantee: consider Docker egress firewall rules.
- Original media integrity is checked against its saved SHA-256 before a transcription job starts.
- The maximum supported duration is 12 hours (240 three-minute chunks). A decoded chunk is limited to 8 MB. The 512 MB Meeting Vault original size limit still applies.
- Segment text and state are stored under `BUDDY_DATA_DIR/meeting-vault/<recording-id>/transcribed-parts` and `transcription.json` with owner-only permissions. These contain sensitive speech and may be included in backups.
- Jobs use the shared local inference lane to avoid GPU overload. A running long job can delay other AI jobs; Pause is available.
- Transcripts exceeding 100,000 characters are refused rather than silently cut off. Single-pass summary drafting currently accepts a maximum of 16,000 transcript characters; larger summaries need a subsequent reviewed chunking feature.
- An edited existing transcript is never overwritten by Whisper output. If review data changes during transcription, saved parts are preserved and an explicit retry/reconciliation is required.
- There is no automatic speaker identification. Review speaker assignments manually. Calendar entries never establish attendance or consent.
- Work meetings and others' voices require the appropriate organization permission, participant consent and secure storage controls.

## Validation still required

Automated tests cover URL allowlisting, bounded segments, owner access, explicit permission, and restart recovery. The full ffmpeg-to-Whisper path must be tested with synthetic audio and your actual installed Whisper service before relying on it. Physical iPhone lock/background behavior, network interruption and disk-space recovery also need hardware testing.

## Segment timing

New transcriptions request verbose segment timestamps and offset them to the original recording. These are ASR estimates, not verified word alignment or speaker identity. Invalid or missing segment timestamps retain the plain transcript with the existing chunk interval. Engines rejecting verbose output with HTTP 400/422 get one JSON-format retry; network and server failures do not trigger automatic retries. Audio redirects are refused and response size is bounded. Previously saved transcription parts remain unchanged.
