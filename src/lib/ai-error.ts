import { redact } from "./redact";

type Loose = Record<string, unknown>;
const obj = (v: unknown): Loose | undefined => (v && typeof v === "object" ? (v as Loose) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** The provider's own words, from whichever JSON shape it used (OpenAI, Gemini, OpenRouter, NVIDIA, FastAPI, plain text). */
export function providerMessage(body: unknown): string | undefined {
  if (typeof body === "string") {
    const t = body.trim();
    if (!t) return undefined;
    try { return providerMessage(JSON.parse(t)); } catch { return t.startsWith("<") ? undefined : t.slice(0, 300); }
  }
  if (Array.isArray(body)) return providerMessage(body[0]);
  const b = obj(body);
  if (!b) return undefined;
  const err = obj(b["error"]);
  const meta = obj(err?.["metadata"]);
  const detail = b["detail"];
  return (
    str(err?.["message"]) && str(meta?.["raw"]) && !String(err?.["message"]).includes(String(meta?.["raw"]))
      ? `${str(err?.["message"])} (${String(meta?.["raw"]).slice(0, 200)})`
      : undefined
  ) ?? str(err?.["message"]) ?? str(b["error"]) ?? str(b["message"]) ?? str(detail)
    ?? (Array.isArray(detail) ? str(obj(detail[0])?.["msg"]) : undefined)
    ?? str(obj(Array.isArray(b["errors"]) ? b["errors"][0] : undefined)?.["message"]);
}

/** What the HTTP status usually means, in words a person can act on. */
export function statusHint(status: number | undefined): string | undefined {
  if (!status) return undefined;
  if (status === 401 || status === 403) return "the key was rejected: check it in AI engine settings";
  if (status === 402) return "out of credits for this key";
  if (status === 404) return "that model name isn't available for this key";
  if (status === 408 || status === 504) return "the provider took too long to answer";
  if (status === 429) return "rate limit or free quota used up: wait a bit, or spread the pals over more keys";
  if (status >= 500) return "the provider is having trouble right now";
  return undefined;
}

/** A readable reason an AI call failed: the provider's message, the HTTP status and what it usually means. */
export function explainAiError(error: unknown): string {
  const e = obj(error);
  const status = typeof e?.["statusCode"] === "number" ? (e["statusCode"] as number) : typeof e?.["status"] === "number" ? (e["status"] as number) : undefined;
  const text = providerMessage(e?.["responseBody"]) ?? providerMessage(e?.["data"]) ?? str(e?.["message"]) ?? (typeof error === "string" ? str(error) : undefined);
  const hint = statusHint(status);
  const base = text ?? (status ? `The AI service answered with an error` : "The AI service failed without saying why");
  return redact(`${base}${status ? ` (HTTP ${status})` : ""}${hint ? `: ${hint}` : ""}`).slice(0, 400);
}
