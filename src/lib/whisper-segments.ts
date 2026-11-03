/** ASR segment times are estimates, never proof of speaker identity or word alignment. */
export function timedWhisperText(data: unknown, offset: number, duration: number): string {
  const d = data as { text?: unknown; segments?: unknown };
  if (!d || typeof d.text !== "string" || d.text.length > 10000)
    throw Error("Invalid Whisper text");
  const fallback = d.text.trim() || "[no speech recognized]";
  if (!Array.isArray(d.segments) || !d.segments.length) return fallback;
  if (d.segments.length > 2000) throw Error("Too many transcript segments");
  let previous = 0;
  const stamp = (n: number) => {
    const ms = Math.round(n * 1000);
    return (
      [
        Math.floor(ms / 3600000),
        Math.floor((ms % 3600000) / 60000),
        Math.floor((ms % 60000) / 1000),
      ]
        .map((x) => String(x).padStart(2, "0"))
        .join(":") +
      "." +
      String(ms % 1000).padStart(3, "0")
    );
  };
  const lines: string[] = [];
  for (const raw of d.segments) {
    if (!raw || typeof raw !== "object") return fallback;
    const s = raw as { start?: unknown; end?: unknown; text?: unknown };
    if (
      typeof s.start !== "number" ||
      typeof s.end !== "number" ||
      !Number.isFinite(s.start) ||
      !Number.isFinite(s.end) ||
      s.start < previous ||
      s.end < s.start ||
      s.end > duration ||
      typeof s.text !== "string"
    )
      return fallback;
    previous = s.start;
    lines.push(`[${stamp(offset + s.start)} - ${stamp(offset + s.end)}] ${s.text.trim()}`);
  }
  const result = lines.join("\n");
  return result.length <= 10000 ? result : fallback;
}
