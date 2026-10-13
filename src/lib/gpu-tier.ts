/** Picks the best Hugging Face (mlc-ai) model the detected GPU can comfortably run. Browser-safe, pure. */
export type GpuProbe = { description: string; maxBufferSize: number; deviceMemoryGB: number; f16: boolean };
export type GpuTier = "high" | "mid" | "light";

const models: Record<GpuTier, { f16: string; f32: string; label: string; size: string }> = {
  high: { f16: "Qwen2.5-7B-Instruct-q4f16_1-MLC", f32: "Qwen2.5-7B-Instruct-q4f32_1-MLC", label: "Qwen 2.5 7B", size: "~4.5 GB" },
  mid: { f16: "Llama-3.2-3B-Instruct-q4f16_1-MLC", f32: "Llama-3.2-3B-Instruct-q4f32_1-MLC", label: "Llama 3.2 3B", size: "~1.8 GB" },
  light: { f16: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", f32: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", label: "Qwen 2.5 1.5B", size: "~1 GB" },
};

const GB = 1024 ** 3;

export function gpuTier(p: GpuProbe): GpuTier {
  const d = p.description.toLowerCase();
  const integrated = /intel|iris|uhd|vega|adreno|mali|integrated|swiftshader|llvmpipe/.test(d);
  const dedicated = /nvidia|geforce|rtx|gtx|radeon rx|\brx ?\d|arc a/.test(d);
  const apple = /apple|m[1-4]/.test(d);
  if (dedicated && !integrated && p.maxBufferSize >= 2 * GB && p.deviceMemoryGB >= 8) return "high";
  if ((dedicated || apple) && p.maxBufferSize >= GB && p.deviceMemoryGB >= 8) return "mid";
  return "light";
}

export const localModelChoices = (["high", "mid", "light"] as GpuTier[]).map((tier) => ({ tier, ...models[tier] }));

export function modelForProbe(p: GpuProbe) {
  const tier = gpuTier(p);
  const m = models[tier];
  return { tier, id: p.f16 ? m.f16 : m.f32, label: m.label, size: m.size };
}
