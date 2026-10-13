import { agents } from "./agents";
import { characterVoice, speakableText } from "./cenobite-voices";
import { isAbortError } from "./ai/stream-errors.server";
import { isCharacterMode } from "./hellraiser";

const MODEL = "google/gemini-3.1-flash-tts-preview";

export async function handleSpeech(request: Request) {
  try {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return Response.json({ error: "Voice service is not configured." }, { status: 401 });
    const body = await request.json();
    const agent = agents.find((a) => a.id === body.agentId);
    const text = typeof body.text === "string" ? speakableText(body.text) : "";
    if (!agent || !text) return Response.json({ error: "Nothing to speak." }, { status: 400 });
    const mode =
      isCharacterMode(body.characterMode)
        ? body.characterMode
        : "hellraiser";
    const cast = characterVoice(agent.id, mode);
    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: request.signal,
      body: JSON.stringify({
        model: MODEL,
        contents: [{ role: "user", parts: [{ text: `${cast.direction}\n\n${text}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cast.voice } } },
        },
        stream_format: "sse",
      }),
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text();
      console.error(`Speech failed [${upstream.status}]: ${detail}`);
      let message = "The character's voice could not be played.";
      try {
        const parsed = JSON.parse(detail);
        message = parsed.message ?? parsed.error?.message ?? message;
      } catch {
        /* keep default */
      }
      return Response.json({ error: message }, { status: upstream.status });
    }
    // The response body is consumed after this handler returns, outside its
    // try/catch. Handle cancelled reads here rather than leaking a stream error.
    const reader = upstream.body.getReader();
    const audio = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          if (request.signal.aborted || isAbortError(error)) controller.close();
          else {
            console.error(error);
            controller.error(error);
          }
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } catch (error) {
          if (!request.signal.aborted && !isAbortError(error)) console.error(error);
        }
      },
    });
    return new Response(audio, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) return new Response(null, { status: 499 });
    console.error(error);
    return Response.json({ error: "The character's voice could not be played." }, { status: 500 });
  }
}
