export type OllamaHealth = {
  state: "checking" | "connected" | "offline" | "configuration";
  configured: boolean;
  reachable: boolean;
  remote: boolean;
  localOnly: boolean;
  models: { name: string; gb: number }[];
  note?: string;
};
export const EMPTY_OLLAMA_HEALTH: OllamaHealth = {
  state: "checking",
  configured: false,
  reachable: false,
  remote: false,
  localOnly: false,
  models: [],
};
export function serverOllamaTransport(transport: unknown, health: OllamaHealth): boolean {
  return (
    health.localOnly ||
    (transport !== "browser" &&
      (transport === "server" || health.state === "checking" || health.configured))
  );
}
export const installedName = (model: string, names: string[]) =>
  names.find((n) => n === model || n === `${model}:latest` || `${n}:latest` === model) ?? null;
export const preferredInstalled = (names: string[]) =>
  names.includes("qwen3.5:9b")
    ? "qwen3.5:9b"
    : (names.find((n) => !/embed|nomic|bge/i.test(n)) ?? "");
export function modelProblem(model: string, names: string[]): string | null {
  return model === "auto" || model.startsWith("auto:")
    ? names.some((n) => !/embed|nomic|bge/i.test(n))
      ? null
      : "No installed local chat model is available."
    : installedName(model, names)
      ? null
      : `Requested Ollama model "${model}" is not installed. Choose an installed replacement in Local AI settings; saved Pal assignments have not been changed.`;
}
