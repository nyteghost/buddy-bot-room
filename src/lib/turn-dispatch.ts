/**
 * Which AI answers one turn, and what happens when it fails. The room supplies the actual calls; this file holds only the decisions,
 * so the privacy rule (mail, calendar and task details never go to a cloud AI) and the fallback order can be tested with fakes.
 */
export type DispatchDeps<P> = {
  engine: { kind: string; ollamaUrl: string };
  /** The provider the rotation picked for this turn, if any. */
  provider: P | undefined;
  /** The message carries mail, calendar or task details. */
  realData: boolean;
  blockPaid: boolean;
  hasWebGpu: boolean;
  aborted: () => boolean;
  /** True once some text of this turn's answer has arrived (a failure after that is final, not retried elsewhere). */
  hasAnswer: () => boolean;
  clearAnswer: () => void;
  runChain: (p: P) => Promise<void>;
  /** The stack's own Ollama through the server, as a one-provider chain (used when real data must stay local). */
  localChain: () => Promise<void>;
  /** The user's Ollama called straight from the browser. */
  runOllama: () => Promise<void>;
  runBrowserModel: () => Promise<void>;
  cloudFallback: (why: unknown) => Promise<void>;
  /** Ollama failed a moment ago and some other AI is set up: skip the wait. */
  ollamaBenchedWithBackup: () => boolean;
  benchOllama: (err: unknown) => void;
  log: (level: "warn", msg: string, err?: unknown) => void;
};

const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export async function dispatchTurn<P>(d: DispatchDeps<P>): Promise<void> {
  const { engine, provider } = d;
  const final = () => d.aborted() || d.hasAnswer();
  // Your own mail, calendar and tasks are only ever read by your own Ollama: free API tokens aren't spent on them and the details never go to a cloud AI.
  const keepLocal = d.realData && engine.kind !== "local" && engine.kind !== "ollama" && engine.kind !== "local-server";
  if (keepLocal) {
    try {
      if (engine.kind === "auto-ollama") await d.runOllama();
      else await d.localChain();
    } catch (err) {
      if (d.aborted() || d.hasAnswer()) throw err;
      throw new Error("Your own AI (Ollama) isn't reachable, so I didn't send your mail, calendar or task details to a cloud AI. Check Local AI in Settings, or ask without @mail, @calendar or @tasks.");
    }
  } else if (engine.kind === "auto-ollama") {
    // Free keys first; local Ollama takes over when no key is set or a key fails before any text.
    if (!provider) await d.runOllama();
    else {
      try { await d.runChain(provider); }
      catch (err) {
        if (final()) throw err;
        d.clearAnswer();
        d.log("warn", "Cloud AI failed, trying Ollama", err);
        try { await d.runOllama(); }
        catch (localErr) {
          if (final()) throw localErr;
          // Say what the cloud AI did, not only that Ollama is off: that is the error worth fixing.
          throw new Error(`The cloud AI didn't answer (${msg(err, String(err))}), and ${msg(localErr, "your Ollama didn't answer either")}`);
        }
      }
    }
  } else if (engine.kind === "local-server") {
    if (!provider) throw new Error("Local AI isn't available.");
    try { await d.runChain(provider); } catch (err) { await d.cloudFallback(err); }
  } else if (engine.kind === "ollama") {
    try {
      if (d.ollamaBenchedWithBackup()) throw new Error(`Can't reach your local server at ${engine.ollamaUrl}.`);
      await d.runOllama();
    } catch (err) {
      d.benchOllama(err);
      await d.cloudFallback(err);
    }
  } else if (engine.kind === "local" || (engine.kind === "auto" && !provider)) {
    await d.runBrowserModel();
  } else if (!provider) {
    throw new Error(d.blockPaid ? "Your monthly spend cap is reached and no free provider is set up. Raise the cap in AI engine settings, add a free key, or choose In-browser." : "Add at least one free key in AI engine settings (Groq, Gemini or OpenRouter), or choose In-browser.");
  } else if (engine.kind === "auto") {
    // Auto: free keys are far faster; the in-browser model takes over when a key hits its limit.
    try { await d.runChain(provider); }
    catch (err) {
      if (d.aborted() || !d.hasWebGpu || d.hasAnswer()) throw err;
      d.clearAnswer();
      await d.runBrowserModel();
    }
  } else {
    await d.runChain(provider);
  }
}
