import { describe, expect, it } from "vitest";
import { hostGpu, hostHardware, isOutOfMemory, isRemoteOllama, modelNeedGb, parseKeepAlive, planLoad, smallerFallback } from "@/lib/ollama-resources";
import type { Hardware } from "@/lib/hardware";

const GB = 1024 ** 3;
const server = (gpus: Hardware["gpus"]): Hardware => ({ cpu: "x", cores: 8, ramGb: 32, gpus, gpuSource: gpus.length ? "nvidia-smi" : "none" });

describe("which machine's GPU counts", () => {
  it("tells the stack's own Ollama from another machine", () => {
    expect(isRemoteOllama("http://ollama:11434")).toBe(false);
    expect(isRemoteOllama("http://localhost:11434")).toBe(false);
    expect(isRemoteOllama("http://10.200.1.50:11434")).toBe(true);
    expect(isRemoteOllama("not a url")).toBe(false);
  });
  it("uses the setting first, and ignores the Pixel Pals server's GPU when Ollama is remote", () => {
    expect(hostGpu({ url: "http://10.200.1.50:11434", settingGb: "10", server: server([{ name: "tdarr gpu", vramGb: 4 }]) })).toEqual({ gb: 10, source: "setting", remote: true });
    expect(hostGpu({ url: "http://10.200.1.50:11434", settingGb: "", server: server([{ name: "tdarr gpu", vramGb: 4 }]) }).source).toBe("unknown");
    expect(hostGpu({ url: "http://ollama:11434", settingGb: "", server: server([{ name: "gpu", vramGb: 12 }]) })).toEqual({ gb: 12, source: "server-gpu", remote: false });
  });
  it("falls back to what loaded models visibly use, as a lower bound", () => {
    expect(hostGpu({ url: "http://10.200.1.50:11434", settingGb: undefined, server: server([]), observedGb: 6.2 })).toEqual({ gb: 6.2, source: "observed", remote: true });
  });
  it("builds the hardware recommendations should use", () => {
    const hw = hostHardware(server([{ name: "tdarr gpu", vramGb: 4 }]), { gb: 10, source: "setting", remote: true }, "64");
    expect(hw.gpus).toEqual([{ name: "Ollama host GPU", vramGb: 10 }]);
    expect(hw.ramGb).toBe(64);
    expect(hostHardware(server([]), { gb: 0, source: "unknown", remote: true }).gpus).toEqual([]);
  });
});

describe("fit and fallback", () => {
  it("plans a load next to what is already in VRAM", () => {
    const loaded = [{ name: "qwen2.5:14b", sizeVramBytes: 9 * GB }];
    const p = planLoad({ vramGb: 10, loaded, model: "llama3.1:8b", sizeBytes: 4.9 * GB });
    expect(p.fits).toBe(false);
    expect(p.wouldUnload).toEqual(["qwen2.5:14b"]);
    expect(planLoad({ vramGb: 24, loaded, model: "llama3.1:8b", sizeBytes: 4.9 * GB }).fits).toBe(true);
    expect(planLoad({ vramGb: 10, loaded, model: "qwen2.5:14b", sizeBytes: 9 * GB })).toMatchObject({ fits: true, alreadyLoaded: true });
    expect(planLoad({ vramGb: 0, loaded: [], model: "x", sizeBytes: 40 * GB }).fits).toBe(true); // unknown VRAM: never block
  });
  it("recognises Ollama out-of-memory failures", () => {
    expect(isOutOfMemory(new Error("model requires more system memory (12.3 GiB) than is available (8.1 GiB)"))).toBe(true);
    expect(isOutOfMemory("CUDA error: out of memory")).toBe(true);
    expect(isOutOfMemory(new Error("connection refused"))).toBe(false);
  });
  it("falls back to the largest clearly smaller installed model, skipping embedding models", () => {
    const installed = [{ name: "qwen2.5:14b", gb: 9 }, { name: "llama3.1:8b", gb: 4.9 }, { name: "llama3.2:3b", gb: 2 }, { name: "nomic-embed-text:latest", gb: 0.3 }];
    expect(smallerFallback("qwen2.5:14b", installed)).toBe("llama3.1:8b");
    expect(smallerFallback("llama3.1:8b", installed)).toBe("llama3.2:3b");
    expect(smallerFallback("llama3.2:3b", installed)).toBe(null);
    expect(smallerFallback("llama3.1:8b", [{ name: "llama3.1:8b", gb: 4.9 }])).toBe(null);
  });
  it("never picks a fallback that would not fit the known VRAM", () => {
    const installed = [{ name: "big:30b", gb: 18 }, { name: "mid:14b", gb: 9 }, { name: "small:3b", gb: 2 }];
    expect(smallerFallback("huge:70b", installed, 6)).toBe("small:3b");
  });
  it("estimates the memory a model needs", () => {
    expect(modelNeedGb(4.9 * GB)).toBe(6.3);
  });
});

describe("keep-alive", () => {
  it("accepts durations and the two special values, and ignores junk", () => {
    for (const ok of ["5m", "30m", "2h", "24h", "-1", "0", " 10M "]) expect(parseKeepAlive(ok)).not.toBe(null);
    for (const bad of ["", "forever", "5", "-2", 5, null, undefined, "1d"]) expect(parseKeepAlive(bad)).toBe(null);
  });
});
