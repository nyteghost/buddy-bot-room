import { useSyncExternalStore } from "react";
import { chunkSpeech, pickVoice, speechText, voiceProfile } from "./tts";

/** Read replies aloud with the browser's own speech engine: free, no keys, nothing leaves the device. Off by default. */
export type VoiceSettings = { auto: boolean; rate: number };
const key = "pixel-pals-voice-v1";
const DEFAULT: VoiceSettings = { auto: false, rate: 1 };
const listeners = new Set<() => void>();
let cache: VoiceSettings | null = null;
let speakingId: string | null = null;
let token = 0;

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const voiceSupported = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

function read(): VoiceSettings {
  if (cache) return cache;
  cache = DEFAULT;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const p = JSON.parse(raw) as Partial<VoiceSettings>;
      cache = { auto: p.auto === true, rate: typeof p.rate === "number" && p.rate >= 0.5 && p.rate <= 2 ? p.rate : 1 };
    }
  } catch { /* storage unavailable */ }
  return cache;
}

export function setVoiceSettings(patch: Partial<VoiceSettings>): void {
  cache = { ...read(), ...patch };
  try { localStorage.setItem(key, JSON.stringify(cache)); } catch { /* optional */ }
  emit();
}
export const useVoice = (): VoiceSettings => useSyncExternalStore(subscribe, read, () => DEFAULT);
export const useSpeakingId = (): string | null => useSyncExternalStore(subscribe, () => speakingId, () => null);

function setSpeaking(id: string | null) { speakingId = id; emit(); }

export function stopSpeaking(): void {
  token++;
  if (voiceSupported()) window.speechSynthesis.cancel();
  if (speakingId !== null) setSpeaking(null);
}

export type SpeakItem = { id: string; text: string; agentId: string };

/** Reads the items one after another, each pal in its own voice. Starting again (or stopSpeaking) cancels the previous run. */
export async function speakItems(items: SpeakItem[]): Promise<void> {
  if (!voiceSupported()) return;
  const synth = window.speechSynthesis;
  const mine = ++token;
  synth.cancel();
  const rate = read().rate;
  for (const item of items) {
    const clean = speechText(item.text);
    if (!clean) continue;
    if (mine !== token) return;
    setSpeaking(item.id);
    const profile = voiceProfile(item.agentId);
    const voices = synth.getVoices();
    const name = pickVoice(voices.map((v) => ({ name: v.name, lang: v.lang })), item.agentId, navigator.language || "en-US");
    const voice = voices.find((v) => v.name === name);
    for (const chunk of chunkSpeech(clean)) {
      if (mine !== token) return;
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.rate = Math.min(2, Math.max(0.5, rate * profile.rate));
        u.pitch = profile.pitch;
        if (voice) u.voice = voice;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        synth.speak(u);
      });
    }
  }
  if (mine === token) setSpeaking(null);
}
