import { afterEach, describe, expect, it, vi } from "vitest";
import { OLLAMA_WARM_REFRESH_MS, warmOllama } from "@/lib/ollama-models";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Ollama model warmup cache", () => {
  it("reuses one network request for concurrent calls and expires after the keep-alive window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    let done!: (res: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { done = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const first = warmOllama("http://ollama-cache-test:11434/v1", "qwen2.5:7b");
    const second = warmOllama("http://ollama-cache-test:11434/v1", "qwen2.5:7b");
    expect(fetcher).toHaveBeenCalledTimes(1);
    done(new Response(JSON.stringify({ done: true }), { status: 200 }));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await warmOllama("http://ollama-cache-test:11434/v1", "qwen2.5:7b")).toBe(false);
    vi.setSystemTime(Date.now() + OLLAMA_WARM_REFRESH_MS + 1);
    const third = warmOllama("http://ollama-cache-test:11434/v1", "qwen2.5:7b");
    expect(fetcher).toHaveBeenCalledTimes(2);
    done(new Response(JSON.stringify({ done: true }), { status: 200 }));
    expect(await third).toBe(true);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("http://ollama-cache-test:11434/api/generate");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ model: "qwen2.5:7b", keep_alive: "30m" });
  });

  it("does not cache failures, so a recovered Ollama server can be retried", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ done: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await warmOllama("http://ollama-failure-test:11434", "small:3b")).toBe(false);
    expect(await warmOllama("http://ollama-failure-test:11434", "small:3b")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not attempt to prewarm when no server or model is configured", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await warmOllama("", "small:3b")).toBe(false);
    expect(await warmOllama("http://ollama:11434", "")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
