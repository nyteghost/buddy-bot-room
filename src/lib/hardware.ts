/** Pure helpers for describing the machine a local model would run on. */
export type Gpu = { name: string; vramGb: number };
export type Hardware = { cpu: string; cores: number; ramGb: number; gpus: Gpu[]; gpuSource: "nvidia-smi" | "override" | "none" };

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Parses `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` (memory in MiB). */
export function parseNvidiaSmi(text: string): Gpu[] {
  const gpus: Gpu[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(",").map((p) => p.trim());
    const mib = Number(parts[parts.length - 1]);
    const name = parts.slice(0, -1).join(", ");
    if (name && Number.isFinite(mib) && mib > 0) gpus.push({ name, vramGb: round1(mib / 1024) });
  }
  return gpus;
}

/** The memory a model can use: the biggest single GPU, or a conservative slice of system RAM when there is none. */
export function modelBudgetGb(hw: Hardware): { gb: number; onGpu: boolean } {
  const vram = Math.max(0, ...hw.gpus.map((g) => g.vramGb));
  if (vram > 0) return { gb: vram, onGpu: true };
  return { gb: Math.min(hw.ramGb * 0.5, 6), onGpu: false };
}

export function describeHardware(hw: Hardware): string {
  const gpu = hw.gpus.length ? hw.gpus.map((g) => `${g.name} (${g.vramGb} GB)`).join(", ") : "no GPU visible to Pixel Pals";
  return `${hw.cpu || "CPU"} · ${hw.cores} threads · ${hw.ramGb} GB RAM · ${gpu}`;
}
