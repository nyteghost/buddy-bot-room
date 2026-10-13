import { describe, expect, it } from "vitest";
import { modelForProbe } from "./gpu-tier";
const GB = 1024 ** 3;
describe("gpu tier", () => {
  it("RTX gets 7B", () => expect(modelForProbe({ description: "NVIDIA GeForce RTX 4070", maxBufferSize: 4 * GB, deviceMemoryGB: 8, f16: true }).id).toBe("Qwen2.5-7B-Instruct-q4f16_1-MLC"));
  it("Apple gets 3B", () => expect(modelForProbe({ description: "apple metal-3", maxBufferSize: 2 * GB, deviceMemoryGB: 8, f16: true }).id).toBe("Llama-3.2-3B-Instruct-q4f16_1-MLC"));
  it("Intel integrated gets 1.5B f32 without f16", () => expect(modelForProbe({ description: "intel iris xe", maxBufferSize: 2 * GB, deviceMemoryGB: 8, f16: false }).id).toBe("Qwen2.5-1.5B-Instruct-q4f32_1-MLC"));
});
