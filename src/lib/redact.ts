/** Strip secrets from anything that goes into a copyable log. Pure, browser- and server-safe. */
const PATTERNS: RegExp[] = [
  /\bgsk_[A-Za-z0-9]{20,}\b/g, // Groq
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // OpenAI / OpenRouter
  /\bnvapi-[A-Za-z0-9_-]{20,}\b/g, // NVIDIA
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /(x-api-key["':\s=]+)[A-Za-z0-9._~+/=-]{8,}/gi,
  /((?:api[_-]?key|token|password|secret)["']?\s*[:=]\s*["']?)[^\s"',&]{6,}/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, (_m, prefix: unknown) => (typeof prefix === "string" ? `${prefix}[hidden]` : "[hidden]"));
  return out;
}

/** One-line description of an unknown thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}${error.stack ? `\n${error.stack.split("\n").slice(1, 5).join("\n")}` : ""}`;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error)?.slice(0, 800) ?? String(error); } catch { return String(error); }
}
