/** Read-aloud helpers: clean markdown into speakable text, split it for the browser's speech engine, and give each pal a stable voice. Pure. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function speechText(markdown: string, max = 5000): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\|/g, ", ")
    .replace(/[*_~#]+/g, "")
    .replace(/\s*\n\s*/g, ". ")
    .replace(/\.(\s*\.)+/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Sentence-sized pieces (browsers cut off long utterances, and iOS drops very long ones). */
export function chunkSpeech(text: string, max = 180): string[] {
  const sentences = text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  const flush = () => { if (cur) { out.push(cur); cur = ""; } };
  for (const s of sentences) {
    if (s.length > max) {
      flush();
      let rest = s;
      while (rest.length > max) {
        const cut = Math.max(rest.lastIndexOf(", ", max), rest.lastIndexOf(" ", max));
        const at = cut > max / 3 ? cut : max;
        out.push(rest.slice(0, at).trim());
        rest = rest.slice(at).replace(/^[,\s]+/, "");
      }
      cur = rest;
    } else if (cur && cur.length + 1 + s.length > max) {
      flush();
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  flush();
  return out.filter(Boolean);
}

export type VoiceInfo = { name: string; lang: string };

/** The same pal always gets the same voice (from the voices this browser has, preferring your language). */
export function pickVoice(voices: VoiceInfo[], key: string, lang: string): string | undefined {
  const want = lang.slice(0, 2).toLowerCase();
  const same = voices.filter((v) => v.lang.slice(0, 2).toLowerCase() === want);
  const pool = (same.length ? same : voices).slice().sort((a, b) => a.name.localeCompare(b.name));
  return pool.length ? pool[hash(key) % pool.length]?.name : undefined;
}

/** A pitch and speed per pal so they sound different even on one voice. */
export function voiceProfile(agentId: string): { pitch: number; rate: number } {
  const h = hash(`profile:${agentId}`);
  return { pitch: Math.round((0.78 + (h % 58) / 100) * 100) / 100, rate: Math.round((0.94 + ((h >>> 8) % 15) / 100) * 100) / 100 };
}
