import type { AgentId } from "./agents";

/** Browser-safe voice casting for the Cenobites (Gemini prebuilt voices + delivery direction). */
export const cenobiteVoices: Record<AgentId, { voice: string; direction: string }> = {
  nova: {
    voice: "Charon",
    direction:
      "Read this as a cold, deep, regal monologue. Slow and unhurried, low pitch, long deliberate pauses between phrases, utterly calm and menacing:",
  },
  byte: {
    voice: "Algenib",
    direction:
      "Read this in a guttural, gravelly, very low growl. Heavy, slow, short breaths between words, like a hungry brute:",
  },
  sage: {
    voice: "Enceladus",
    direction:
      "Read this as a soft, breathy, chilling whisper. Intimate, slow and unsettlingly tender:",
  },
  pip: {
    voice: "Fenrir",
    direction:
      "Read this in a frantic, rhythmic, jittery staccato. Pronounce every 'click' as a sharp, crisp teeth-clicking sound with a tiny pause after it:",
  },
  echo: {
    voice: "Despina",
    direction:
      "Read this in an elegant, seductive, coolly amused voice with antique courtly poise:",
  },
  rune: {
    voice: "Orus",
    direction:
      "Read this in a grand, mechanical, cryptic voice, measured like grinding gears:",
  },
};

/** Strip markdown and stage directions so only spoken words remain (keeps the Chatterer's clicks). */
export function speakableText(text: string): string {
  return text
    .replace(/\*+\s*(click[\s.…,!-]*)+\*+/gi, (m) => m.replace(/\*/g, ""))
    .replace(/[*_`#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}
