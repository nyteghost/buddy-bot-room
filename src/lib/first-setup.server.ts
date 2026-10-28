/**
 * One-time first-owner setup code for self-hosted accounts.
 *
 * An explicit BUDDY_PASSWORD takes precedence. Otherwise create a random code
 * in the private data volume and print it to container logs for the operator.
 * Never display the generated code to unauthenticated web visitors.
 */
import { randomHex } from "./accounts";

const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\\/+$/, "");
const codeFile = () => `${dir()}/initial-setup.code`;
let logged = false;

export async function firstRunSetupCode(): Promise<string> {
  const configured = (process.env["BUDDY_PASSWORD"] ?? "").trim();
  if (configured) return configured;
  if (!dir()) throw new Error("A data directory is required for first-run setup.");
  const fs = await import("node:fs/promises");
  await fs.mkdir(dir(), { recursive: true, mode: 0o700 });
  let code: string;
  try {
    code = (await fs.readFile(codeFile(), "utf8")).trim();
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
    const generated = randomHex(16);
    try {
      await fs.writeFile(codeFile(), generated, { encoding: "utf8", mode: 0o600, flag: "wx" });
      code = generated;
    } catch (writeError) {
      if ((writeError as { code?: string }).code !== "EEXIST") throw writeError;
      code = (await fs.readFile(codeFile(), "utf8")).trim();
    }
  }
  if (!/^[0-9a-f]{32}$/.test(code)) throw new Error("Invalid first-run setup code file.");
  if (!logged) {
    logged = true;
    console.warn("Pixel Pals first-run setup code: " + code + " (read it from the container logs; only needed to create the first owner account)");
  }
  return code;
}

export async function clearFirstRunSetupCode(): Promise<void> {
  if ((process.env["BUDDY_PASSWORD"] ?? "").trim() || !dir()) return;
  const fs = await import("node:fs/promises");
  await fs.unlink(codeFile()).catch((error: { code?: string }) => {
    if (error.code !== "ENOENT") throw error;
  });
}
