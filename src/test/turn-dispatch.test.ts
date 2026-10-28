import { describe, expect, it } from "vitest";
import { dispatchTurn, type DispatchDeps } from "@/lib/turn-dispatch";

type P = { kind: string };
function setup(over: Partial<DispatchDeps<P>> = {}, fail: Record<string, unknown> = {}) {
  const calls: string[] = [];
  let answered = false;
  const step = (name: string, deliver = true) => async () => {
    calls.push(name);
    if (fail[name]) throw fail[name];
    if (deliver) answered = true;
  };
  const deps: DispatchDeps<P> = {
    engine: { kind: "auto", ollamaUrl: "http://o:11434/v1" },
    provider: { kind: "groq" },
    realData: false, blockPaid: false, hasWebGpu: true,
    aborted: () => false, hasAnswer: () => answered, clearAnswer: () => { answered = false; },
    runChain: async (p) => { await step(`chain:${p.kind}`)(); },
    localChain: step("localChain"), runOllama: step("ollama"), runBrowserModel: step("browser"),
    cloudFallback: async (why) => { calls.push("cloudFallback"); throw why; },
    ollamaBenchedWithBackup: () => false, benchOllama: () => { calls.push("bench"); },
    log: () => {},
    ...over,
  };
  return { deps, calls, partial: () => { answered = true; } };
}
const run = (s: ReturnType<typeof setup>) => dispatchTurn(s.deps).then(() => "ok", (e: Error) => e.message);

describe("privacy: mail, calendar and task details never leave your own AI", () => {
  for (const kind of ["auto", "auto-ollama", "groq", "gemini", "anthropic", "custom"]) {
    it(`with ${kind}, real data goes only to the local path and never to a cloud chain`, async () => {
      const s = setup({ engine: { kind, ollamaUrl: "" }, realData: true }, { localChain: new Error("down"), ollama: new Error("down") });
      const out = await run(s);
      expect(out).toMatch(/didn't send your mail, calendar or task details to a cloud AI/);
      expect(s.calls.some((c) => c.startsWith("chain:") || c === "browser" || c === "cloudFallback")).toBe(false);
    });
  }
  it("uses the browser-to-Ollama path for auto-ollama and the server's Ollama otherwise", async () => {
    expect((await (async () => { const s = setup({ engine: { kind: "auto-ollama", ollamaUrl: "" }, realData: true }); await run(s); return s.calls; })())).toEqual(["ollama"]);
    expect((await (async () => { const s = setup({ realData: true }); await run(s); return s.calls; })())).toEqual(["localChain"]);
  });
  it("an Ollama-only engine (ollama / local / local-server) is not rerouted by real data", async () => {
    const s = setup({ engine: { kind: "ollama", ollamaUrl: "u" }, realData: true });
    expect(await run(s)).toBe("ok");
    expect(s.calls).toEqual(["ollama"]);
  });
  it("a failure after text has started is reported as is", async () => {
    const s = setup({ realData: true }, { localChain: new Error("stream broke") });
    s.partial();
    expect(await run(s)).toBe("stream broke");
  });
});

describe("engine routes", () => {
  it("auto: the rotation's provider answers; in-browser takes over only if it fails and WebGPU exists", async () => {
    const ok = setup(); expect(await run(ok)).toBe("ok"); expect(ok.calls).toEqual(["chain:groq"]);
    const f = setup({}, { "chain:groq": new Error("429") }); expect(await run(f)).toBe("ok"); expect(f.calls).toEqual(["chain:groq", "browser"]);
    const noGpu = setup({ hasWebGpu: false }, { "chain:groq": new Error("429") }); expect(await run(noGpu)).toBe("429");
    const started = setup({}, { "chain:groq": new Error("cut off") }); started.partial(); expect(await run(started)).toBe("cut off");
  });
  it("auto with no provider uses the in-browser model; a cloud engine with none explains what to add", async () => {
    const s = setup({ provider: undefined }); expect(await run(s)).toBe("ok"); expect(s.calls).toEqual(["browser"]);
    expect(await run(setup({ engine: { kind: "groq", ollamaUrl: "" }, provider: undefined }))).toMatch(/Add at least one free key/);
    expect(await run(setup({ engine: { kind: "groq", ollamaUrl: "" }, provider: undefined, blockPaid: true }))).toMatch(/spend cap is reached/);
  });
  it("auto-ollama: free key first, then Ollama; both failing names both problems", async () => {
    const e = { kind: "auto-ollama", ollamaUrl: "" };
    const first = setup({ engine: e }); await run(first); expect(first.calls).toEqual(["chain:groq"]);
    const noKey = setup({ engine: e, provider: undefined }); await run(noKey); expect(noKey.calls).toEqual(["ollama"]);
    const fall = setup({ engine: e }, { "chain:groq": new Error("rate limit") }); expect(await run(fall)).toBe("ok"); expect(fall.calls).toEqual(["chain:groq", "ollama"]);
    const both = setup({ engine: e }, { "chain:groq": new Error("rate limit"), ollama: new Error("Ollama is off") });
    expect(await run(both)).toBe("The cloud AI didn't answer (rate limit), and Ollama is off");
  });
  it("ollama engine: benches it on failure and falls back to the next AI; skips the wait when benched", async () => {
    const e = { kind: "ollama", ollamaUrl: "http://pc:11434/v1" };
    const bad = setup({ engine: e }, { ollama: new Error("refused") });
    expect(await run(bad)).toBe("refused");
    expect(bad.calls).toEqual(["ollama", "bench", "cloudFallback"]);
    const skip = setup({ engine: e, ollamaBenchedWithBackup: () => true });
    expect(await run(skip)).toMatch(/Can't reach your local server at http:\/\/pc:11434\/v1/);
    expect(skip.calls).toEqual(["bench", "cloudFallback"]);
  });
  it("local-server: needs a provider, tries it, then the cloud fallback chain", async () => {
    const e = { kind: "local-server", ollamaUrl: "" };
    expect(await run(setup({ engine: e, provider: undefined }))).toBe("Local AI isn't available.");
    const f = setup({ engine: e }, { "chain:groq": new Error("down") });
    expect(await run(f)).toBe("down");
    expect(f.calls).toEqual(["chain:groq", "cloudFallback"]);
  });
  it("local engine always uses the in-browser model", async () => {
    const s = setup({ engine: { kind: "local", ollamaUrl: "" } }); await run(s); expect(s.calls).toEqual(["browser"]);
  });
  it("stops quietly when cancelled mid-fallback", async () => {
    const s = setup({ aborted: () => true }, { "chain:groq": new Error("aborted") });
    expect(await run(s)).toBe("aborted");
    expect(s.calls).toEqual(["chain:groq"]);
  });
});
