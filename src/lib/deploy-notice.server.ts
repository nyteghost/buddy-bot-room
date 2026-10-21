/** After a restart, tells your phone which version just came up (once per new version). */
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fsp = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");

export async function announceVersion(): Promise<void> {
  const d = dir();
  const commit = typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "local";
  const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";
  if (!d || commit === "local") return;
  const f = await fsp();
  const file = `${d}/last-version.json`;
  let last = "";
  try { last = String((JSON.parse(await f.readFile(file, "utf8")) as { commit?: unknown }).commit ?? ""); } catch { /* first run */ }
  if (last === commit) return;
  await f.mkdir(d, { recursive: true });
  await f.writeFile(file, JSON.stringify({ commit, at: new Date().toISOString() }), "utf8");
  if (!last) return; // first run ever: just remember it
  const { pushNotice } = await import("./schedules.server");
  await pushNotice("Pixel Pals updated", `Now running ${commit}${version ? ` (build ${version})` : ""}.`);
}
