/** Turn raw failures into something you can act on. The raw text still goes to the debug log. */
export type ErrorContext = { engine: string; ollamaUrl?: string; ollamaModel?: string };

export function friendlyError(raw: string, ctx: ErrorContext): string {
  const text = raw.trim();
  const low = text.toLowerCase();
  const local = ctx.engine === "ollama" || ctx.engine === "auto-ollama";
  if (/failed to fetch|networkerror|load failed|network request failed|econnrefused/.test(low))
    return local
      ? `Couldn't reach Ollama at ${ctx.ollamaUrl ?? "your server URL"}. Check that it's running and started with OLLAMA_ORIGINS="*" ollama serve. (${text})`
      : `Couldn't reach the server. Check your connection, then try again. (${text})`;
  if (/\b401\b|\b403\b|invalid api key|incorrect api key|unauthorized|api key not valid|permission denied/.test(low) && !/password/.test(low))
    return `The AI service rejected your API key. Re-enter it in AI engine settings. (${text})`;
  if (/\b429\b|rate limit|quota|too many requests|resource.?exhausted/.test(low))
    return `Hit a free-tier limit. Wait a minute, add a second free key, or switch the engine to Auto. (${text})`;
  if (/model.*not found|not found.*model|pull the model/.test(low) && local)
    return `Ollama doesn't have ${ctx.ollamaModel ?? "that model"}. Run: ollama pull ${ctx.ollamaModel ?? "<model>"} (${text})`;
  if (/context.*(length|window)|maximum context|too many tokens|token limit/.test(low))
    return `That chat got too long for the model. Start a new chat, or use a model with a larger context. (${text})`;
  if (/password required/.test(low)) return "Your session expired. Reload the page and enter the password again.";
  if (/timeout|timed out|aborted due to timeout/.test(low)) return `The model took too long to answer. Try again, or pick a smaller or faster model. (${text})`;
  return text || "Something went wrong. Open the Debug log and copy it to Claude.";
}
