export const MEMORY_SUGGEST_KEY = "pixel-pals-memory-suggestions-v1";
export const MEMORY_SUGGEST_ENABLED = "pixel-pals-memory-suggestions-enabled-v1";
export type SuggestedMemory = { text: string; at: number };
export function sanitizeMemorySuggestion(raw: unknown): string | null {
 if(typeof raw!=="string")return null;
 const text=raw.replace(/^(?:remember(?: that)?|memory:?)\s*/i,"").replace(/\s+/g," ").trim().replace(/^["']|["']$/g,"");
 if(text.length<12||text.length>300||/\b(password|passcode|secret|token|api key|ssn|social security|credit card|bank account|diagnos|medical record|political party|sexual orientation)\b/i.test(text))return null;
 if(/\b(ignore (all|previous) instructions|system prompt|developer message)\b/i.test(text))return null;
 return text;
}
export function queueSuggestedMemory(current: SuggestedMemory[], raw: string): SuggestedMemory[] {
 const text=sanitizeMemorySuggestion(raw);if(!text)return current;
 if(current.some(s=>s.text.toLowerCase()===text.toLowerCase()))return current;
 return [...current.slice(-14),{text,at:Date.now()}];
}
export function suggestMemoryLocally(input:string):string|null {
 const match=/^(?:please )?(?:remember(?: that)?|i prefer|i usually|i always|my goal is|i use)\b[\s:,-]*(.+)$/i.exec(input.trim());
 if(!match)return null;
 const prefix=/^i (prefer|usually|always|use)\b/i.exec(input.trim());
 return sanitizeMemorySuggestion(prefix?input.trim():match[1]);
}
