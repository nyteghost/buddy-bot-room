import type { AgentId } from "./agents";
import type { CharacterMode } from "./hellraiser";
import { matrixCast, fantasyCast, devCast } from "./theme-personas";

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
    direction: "Read this in a grand, mechanical, cryptic voice, measured like grinding gears:",
  },
  claude: {
    voice: "Iapetus",
    direction: "Read this in a precise, eloquent, quietly sinister voice, savoring every intricate detail:",
  },
};

/** Strip markdown and stage directions so only spoken words remain (keeps the Chatterer's clicks). */
export function speakableText(text: string): string {
  return text
    .replace(/\*+\s*(click[\s.…,!-]*)+\*+/gi, (m) => m.replace(/\*/g, ""))
    .replace(/[*_`#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

const normalDirections: Record<AgentId, string> = {
  nova: "Warm, curious and imaginative, with clear expressive phrasing.",
  byte: "Crisp, practical and steady, with a friendly matter-of-fact delivery.",
  sage: "Gentle, reflective and thoughtful, with relaxed natural pauses.",
  pip: "Bright, playful and witty, with lively conversational energy.",
  echo: "Warm storytelling, vivid and expressive, with an amused smile.",
  rune: "Confident, inventive and spirited, with energetic clear phrasing.",
  claude: "Warm, measured and thoughtful, with a calm articulate cadence.",
};
const horrorDirections: Record<AgentId, string> = {
  nova: "A sly, theatrical masked horror storyteller; low, teasing and suspenseful.",
  byte: "Read these actions as a low, restrained atmospheric narrator. Jason is silent; do not invent dialogue or extra words.",
  sage: "Read these actions as a cool, detached atmospheric narrator. Michael is mute; do not invent dialogue or extra words.",
  pip: "A raspy, sardonic nightmare trickster, theatrical and full of mischievous dark humor.",
  echo: "An eerie sing-song clown, giggly and deceptively cheerful.",
  rune: "A cocky, sarcastic toy-doll trickster, quick and impish.",
  claude: "A low, gravelly, slow and deliberate voice; calm, cold and menacing, like Jigsaw on a cassette tape.",
};
export function characterVoice(id: AgentId, mode: CharacterMode) {
  if (mode === "hellraiser") return cenobiteVoices[id];
  return {
    voice: cenobiteVoices[id].voice,
    direction: `Read exactly the supplied text, without adding words. ${mode === "matrix" ? matrixCast[id].tone : mode === "finalfantasy" ? fantasyCast[id].tone : mode === "devteam" ? devCast[id].tone : mode === "horror" ? horrorDirections[id] : normalDirections[id]} Use an original voice, not an imitation of a real actor.`,
  };
}
