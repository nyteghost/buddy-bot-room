/** A free (or trial-credit) LLM API provider from the community list. */
export type FeedProvider = { name: string; site: string; kind: "free" | "trial"; summary: string };

const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

/**
 * Reads the community "Free LLM API resources" README: H2 sections "Free Providers" and "Providers with trial credits",
 * each provider an H3 like `### [Name](https://site)` followed by a **Limits:** or **Credits:** note.
 * Returns an empty list if the layout isn't recognised.
 */
export function parseProviderReadme(md: string): FeedProvider[] {
  const out: FeedProvider[] = [];
  let kind: FeedProvider["kind"] | null = null;
  let current: FeedProvider | null = null;
  let wantSummary = false;
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2 && !line.startsWith("###")) {
      current = null; wantSummary = false;
      const title = h2[1] ?? "";
      kind = /trial credits/i.test(title) ? "trial" : /free providers/i.test(title) ? "free" : null;
      continue;
    }
    if (!kind) continue;
    const h3 = /^###\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(line);
    if (h3) {
      current = { name: plain(h3[1] ?? ""), site: h3[2] ?? "", kind, summary: "" };
      out.push(current);
      wantSummary = false;
      continue;
    }
    if (!current) continue;
    const label = /^\*\*(Limits|Credits):?\*\*:?\s*(.*)$/i.exec(line);
    if (label) {
      const inline = plain(label[2] ?? "");
      if (inline) current.summary = inline.slice(0, 180);
      else wantSummary = true;
      continue;
    }
    if (wantSummary && line) {
      const text = plain(line.replace(/^[-*]\s+/, ""));
      if (text && !/^\|/.test(line)) { current.summary = text.slice(0, 180); wantSummary = false; }
    }
  }
  return out;
}

/** Key pages for the big providers I know. Anything else links to the provider's own site. */
const KEY_PAGES: [RegExp, string][] = [
  [/openrouter/i, "https://openrouter.ai/keys"],
  [/google ai studio|gemini/i, "https://aistudio.google.com/apikey"],
  [/nvidia/i, "https://build.nvidia.com/settings/api-keys"],
  [/mistral/i, "https://console.mistral.ai/api-keys"],
  [/hugging ?face/i, "https://huggingface.co/settings/tokens"],
  [/groq/i, "https://console.groq.com/keys"],
  [/cohere/i, "https://dashboard.cohere.com/api-keys"],
  [/cerebras/i, "https://cloud.cerebras.ai"],
  [/cloudflare/i, "https://dash.cloudflare.com/profile/api-tokens"],
  [/fireworks/i, "https://fireworks.ai/account/api-keys"],
];

export function keyPageFor(p: Pick<FeedProvider, "name" | "site">): { url: string; isKeyPage: boolean } {
  const hit = KEY_PAGES.find(([re]) => re.test(p.name));
  return hit ? { url: hit[1], isKeyPage: true } : { url: p.site, isKeyPage: false };
}

/** Names Pixel Pals can already use, so the list can mark them. */
export const SUPPORTED_NAMES = [/openrouter/i, /google ai studio|gemini/i, /nvidia/i, /groq/i];
export const isSupported = (name: string): boolean => SUPPORTED_NAMES.some((re) => re.test(name));
