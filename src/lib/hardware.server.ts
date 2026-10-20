import type { Hardware } from "./hardware";
import { parseNvidiaSmi } from "./hardware";

let cache: { at: number; value: Hardware } | null = null;

/** CPU, RAM and GPU of the machine running Pixel Pals. The GPU needs nvidia-smi inside the container (set OLLAMA_RUNTIME=nvidia) or LOCAL_VRAM_GB. */
export async function readHardware(): Promise<Hardware> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const os = await import(/* @vite-ignore */ "node:" + "os");
  const cpus = os.cpus();
  let gpus: Hardware["gpus"] = [];
  let gpuSource: Hardware["gpuSource"] = "none";
  const override = Number(process.env["LOCAL_VRAM_GB"]);
  try {
    const cp = await import(/* @vite-ignore */ "node:" + "child_process");
    const out = await new Promise<string>((resolve, reject) =>
      cp.execFile("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { timeout: 3000 }, (err: unknown, stdout: string) => (err ? reject(err) : resolve(stdout))),
    );
    gpus = parseNvidiaSmi(out);
    if (gpus.length) gpuSource = "nvidia-smi";
  } catch {
    /* no NVIDIA GPU visible here */
  }
  if (!gpus.length && Number.isFinite(override) && override > 0) {
    gpus = [{ name: process.env["LOCAL_GPU_NAME"] || "GPU", vramGb: override }];
    gpuSource = "override";
  }
  const value: Hardware = {
    cpu: (cpus[0]?.model ?? "").replace(/\s+/g, " ").trim(),
    cores: cpus.length,
    ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    gpus,
    gpuSource,
  };
  cache = { at: Date.now(), value };
  return value;
}
