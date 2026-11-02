/** Chat-only credential removal. Never apply this to intentional provider/settings credentials. */
export type ScrubOptions = { maskIdentifiers?: boolean };
const assignment =
  /(\b(?:[a-z0-9_]*(?:password|passwd|api_key|apikey|access_token|refresh_token|id_token|client_secret|session_token|session_id|auth_token|secret_key|private_key|pwd|secret|username|login|[a-z0-9_]+_user)[a-z0-9_]*|pwd|pass|user|token|authorization|x-api-key|cookie|set-cookie|user|username|login|email)\b["']?\s*[:=]\s*)(\[hidden[^\]]*\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)/gi;
const prose =
  /(\b(?:password|passwd|api[ _-]?key|access token|refresh token|session token|client secret|username|login|login email)\s+is\s+)[^\r\n]+/gi;
export function scrubChatText(input: string, options: ScrubOptions = {}): string {
  let out = input.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    "[hidden private key]",
  );
  out = out.replace(
    /\b(?:gsk_[a-zA-Z0-9]{12,}|AIza[a-zA-Z0-9_-]{20,}|AQ\.[a-zA-Z0-9_.-]{20,}|sk-[a-zA-Z0-9_-]{12,}|nvapi-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{12,}|github_pat_[a-zA-Z0-9_]{12,}|glpat-[a-zA-Z0-9_-]{12,}|xox[baprs]-[a-zA-Z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|npm_[a-zA-Z0-9]{16,})\b/g,
    "[hidden]",
  );
  out = out.replace(
    /\beyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\b/g,
    "[hidden token]",
  );
  out = out.replace(/\bssh-(?:rsa|ed25519)\s+[a-zA-Z0-9+/=]{40,}/g, "[hidden SSH key]");
  out = out.replace(/\b(Bearer|Basic)\s+[a-zA-Z0-9._~+/=-]{4,}/gi, "$1 [hidden]");
  out = out.replace(/^(\s*(?:Set-Cookie|Cookie)\s*:\s*)[^\r\n]+/gim, "$1[hidden cookies]");
  out = out.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, (raw) => {
    try {
      const url = new URL(raw);
      let changed = false;
      if (url.username || url.password) {
        url.username = "REDACTED";
        url.password = "REDACTED";
        changed = true;
      }
      for (const key of [...url.searchParams.keys()])
        if (
          /(?:token|secret|password|passwd|api.?key|signature|credential|authorization|^auth$|^sig$|^key$|^code$)/i.test(
            key,
          )
        ) {
          url.searchParams.set(key, "REDACTED");
          changed = true;
        }
      return changed ? url.toString() : raw;
    } catch {
      return raw;
    }
  });
  // Controlled inputs may append characters after an already-redacted placeholder.
  out = out.replace(/(\[hidden[^\]]*\])[a-zA-Z0-9._~+/=-]+/g, "$1");
  out = out.replace(assignment, (_m, prefix: string, value: string) => {
    if (/^["']?\[hidden[^\]]*\]["']?$/.test(value)) return prefix + value;
    return (
      prefix +
      (value.startsWith('"') ? '"[hidden]"' : value.startsWith("'") ? "'[hidden]'" : "[hidden]")
    );
  });
  out = out.replace(
    /((?:^|\s)--(?:password|passwd|token|api-key|client-secret|username|login)(?:=|\s+))(?:("(?:\\.|[^"\\])*")|('[^']*')|[^\s]+)/gi,
    "$1[hidden]",
  );
  out = out.replace(/(\bsshpass\s+-p\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, "$1[hidden]");
  out = out.replace(
    /(\b(?:curl|wget)\b[^\r\n]*?\s(?:-u|--user)\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
    "$1[hidden]",
  );
  out = out.replace(prose, (_m, prefix: string) => prefix + "[hidden]");
  if (options.maskIdentifiers)
    out = out.replace(
      /\b[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
      "[hidden email]",
    );
  return out;
}
const credentialKey =
  /^(?:password|passwd|pwd|pass|user|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?(?:token|id|key)|client[_-]?secret|secret|authorization|cookie|set-cookie|user|username|login|email)$/i;
/** Clone message/context data and preserve IDs/roles/binary payloads. Do not pass an engine/settings object. */
export function scrubChatData<T>(value: T, options: ScrubOptions = {}, depth = 0): T {
  if (depth > 30) return "[deep content omitted]" as T;
  if (typeof value === "string") return scrubChatText(value, options) as T;
  if (Array.isArray(value)) return value.map((v) => scrubChatData(v, options, depth + 1)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        credentialKey.test(key) && typeof v === "string"
          ? "[hidden]"
          : scrubChatData(v, options, depth + 1),
      ]),
    ) as T;
  }
  return value;
}
/** Explicitly scoped cleanup: never inspect engine/provider/settings credential storage. */
export function scrubBrowserChatHistory(
  storage: Pick<Storage, "length" | "key" | "getItem" | "setItem">,
): number {
  let changed = 0;
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
    (k): k is string => !!k,
  );
  for (const key of keys) {
    if (
      ![
        "pixel-pals-conversation-v1",
        "pixel-pals-conversations-v2",
        "pixel-pals-saved-discussions-v1",
        "pixel-pals-focus-food-v1",
      ].includes(key) &&
      !key.startsWith("pixel-pals-assistant-draft-")
    )
      continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    try {
      let next: string;
      if (key.startsWith("pixel-pals-assistant-draft-")) next = scrubChatText(raw);
      else {
        const value = JSON.parse(raw);
        if (key === "pixel-pals-focus-food-v1") {
          if (value && Array.isArray(value.chatHistory))
            value.chatHistory = scrubChatData(value.chatHistory);
          next = JSON.stringify(value);
        } else next = JSON.stringify(scrubChatData(value));
      }
      if (next !== raw) {
        storage.setItem(key, next);
        changed++;
      }
    } catch {
      /* Malformed history is left intact, never reset. */
    }
  }
  return changed;
}
