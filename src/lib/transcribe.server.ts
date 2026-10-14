import { isAbortError } from "./ai/stream-errors.server";

const MODEL = "google/gemini-4-argon";
const FORMATS = ["wav", "mp3", "webm", "m4a", "ogg", "aac", "flac"] as const;
const MAX_BASE64 = 20 * 1024 * 1024;

const PROMPT = `Transcribe this recording word for word.
Label each speaker by how their voice sounds, numbering them in order of first appearance: "Man 1", "Man 2", "Woman 1", "Woman 2". If you cannot tell, use "Person 1", "Person 2".
Keep the same label for the same voice throughout. Start a new line each time the speaker changes, formatted exactly as:
Man 1: words spoken
Output only the transcript. If there is no speech, output: (no speech heard)`;

/** Streams a speaker-labelled transcript of one complete recording as plain text. */
export async function handleTranscribe(request: Request) {
  try {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return Response.json({ error: "Transcription is not configured." }, { status: 401 });
    const body = (await request.json()) as { audio?: unknown; format?: unknown };
    const audio = typeof body.audio === "string" ? body.audio : "";
    const format = FORMATS.find((f) => f === body.format);
    if (!audio || !format) return Response.json({ error: "Send a recording to transcribe." }, { status: 400 });
    if (audio.length > MAX_BASE64) return Response.json({ error: "That recording is too long — keep clips under about 15 minutes." }, { status: 413 });

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: request.signal,
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "input_audio", input_audio: { data: audio, format } }] }],
      }),
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text();
      console.error(`Transcription failed [${upstream.status}]: ${detail}`);
      let message = "The recording could not be transcribed.";
      try { const p = JSON.parse(detail); message = p.message ?? p.error?.message ?? message; } catch { /* keep */ }
      return Response.json({ error: message }, { status: upstream.status });
    }
    const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
    const enc = new TextEncoder();
    let buffer = "";
    const out = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) return controller.close();
          buffer += next.value;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") { reader.cancel().catch(() => {}); return controller.close(); }
            if (!data) continue;
            try {
              const choice = JSON.parse(data).choices?.[0];
              if (choice?.delta?.content) controller.enqueue(enc.encode(choice.delta.content));
              if (choice?.finish_reason) { reader.cancel().catch(() => {}); return controller.close(); }
            } catch { /* partial */ }
          }
        } catch (error) {
          if (request.signal.aborted || isAbortError(error)) controller.close();
          else { console.error(error); controller.error(error); }
        }
      },
      cancel(reason) { reader.cancel(reason).catch(() => {}); },
    });
    return new Response(out, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) return new Response(null, { status: 499 });
    console.error(error);
    return Response.json({ error: "The recording could not be transcribed." }, { status: 500 });
  }
}
