/**
 * Voice input through your own Whisper server (an OpenAI-compatible /v1/audio/transcriptions endpoint, for example the
 * optional `whisper` service in the Portainer stack). The address comes only from WHISPER_URL, never from the request,
 * and audio is never kept.
 */
const base = (): string => (process.env["WHISPER_URL"] ?? "").trim().replace(/\/+$/, "");
const model = (): string => (process.env["WHISPER_MODEL"] ?? "Systran/faster-whisper-small").trim().slice(0, 120);
const MAX_BYTES = 8_000_000;

export async function handleStt(request: Request): Promise<Response> {
  const url = base();
  if (request.method === "GET") {
    if (!url) return Response.json({ enabled: false });
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
      return Response.json({ enabled: res.ok });
    } catch {
      return Response.json({ enabled: false });
    }
  }
  if (!url) return Response.json({ error: "Voice input isn't set up. Start the stack with the `voice` profile (see the README)." }, { status: 503 });
  const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!/^(audio|video)\/(webm|ogg|mp4|mpeg|wav|x-wav|m4a|aac)$/.test(type)) return Response.json({ error: "That isn't a supported audio format." }, { status: 415 });
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return Response.json({ error: "No audio was recorded." }, { status: 400 });
  if (audio.byteLength > MAX_BYTES) return Response.json({ error: "That recording is too long. Keep it under about a minute." }, { status: 413 });
  const ext = type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : type.includes("mpeg") ? "mp3" : "webm";
  const form = new FormData();
  form.append("file", new Blob([audio], { type }), `clip.${ext}`);
  form.append("model", model());
  form.append("response_format", "json");
  try {
    const res = await fetch(`${url}/v1/audio/transcriptions`, { method: "POST", body: form, signal: AbortSignal.timeout(90_000) });
    if (!res.ok) return Response.json({ error: `The speech server answered ${res.status}. The first use can fail while it downloads the model; try again in a minute.` }, { status: 502 });
    const json = (await res.json()) as { text?: unknown };
    return Response.json({ text: typeof json.text === "string" ? json.text.trim().slice(0, 4000) : "" });
  } catch {
    return Response.json({ error: "Couldn't reach the speech server." }, { status: 502 });
  }
}

const CLIP_FORMATS: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", webm: "audio/webm", m4a: "audio/mp4", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac" };
const MAX_CLIP_BASE64 = 20 * 1024 * 1024;

/** Echo's recorder: transcribes one long recording (base64 in JSON) with your own Whisper and returns plain text. No speaker labels. */
export async function handleTranscribe(request: Request): Promise<Response> {
  const url = base();
  if (!url) return Response.json({ error: "Transcription isn't set up. Start the stack with the `voice` profile (see the README)." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { audio?: unknown; format?: unknown };
  const audio = typeof body.audio === "string" ? body.audio : "";
  const type = typeof body.format === "string" ? CLIP_FORMATS[body.format] : undefined;
  if (!audio || !type) return Response.json({ error: "Send a recording to transcribe." }, { status: 400 });
  if (audio.length > MAX_CLIP_BASE64) return Response.json({ error: "That recording is too long. Each part must be under about 15 minutes." }, { status: 413 });
  const bytes = Buffer.from(audio, "base64");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), `clip.${body.format as string}`);
  form.append("model", model());
  form.append("response_format", "json");
  try {
    const res = await fetch(`${url}/v1/audio/transcriptions`, { method: "POST", body: form, signal: AbortSignal.any([request.signal, AbortSignal.timeout(600_000)]) });
    if (!res.ok) return Response.json({ error: `The speech server answered ${res.status}. The first use can fail while it downloads the model; try again in a minute.` }, { status: 502 });
    const json = (await res.json()) as { text?: unknown };
    const text = typeof json.text === "string" ? json.text.trim() : "";
    return new Response(text || "(no speech heard)", { headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch {
    return Response.json({ error: "Couldn't reach the speech server." }, { status: 502 });
  }
}
