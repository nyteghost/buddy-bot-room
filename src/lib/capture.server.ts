import { currentUser, tokenUser } from "./accounts.server";
import { addCapture, captureLabel, parseCapture, parseCaptures, type Capture, type CaptureKind } from "./capture";
import { createReminder } from "./reminders.server";

const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const file = () => `${dir()}/capture.json`;

let chain: Promise<unknown> = Promise.resolve();
const locked = <T,>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => undefined); return run; };

async function read(): Promise<Capture[]> {
  if (!dir()) return [];
  try { return parseCaptures(JSON.parse(await (await fs()).readFile(file(), "utf8"))); } catch { return []; }
}
async function write(list: Capture[]): Promise<void> {
  const f = await fs();
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${file()}.tmp`, JSON.stringify(list), { encoding: "utf8", mode: 0o600 });
  await f.rename(`${file()}.tmp`, file());
}

/** Store one captured item for the browser to pick up. */
export async function saveCapture(kind: CaptureKind, text: string): Promise<string> {
  if (!dir()) return "Capture needs BUDDY_DATA_DIR (the data volume).";
  await locked(async () => write(addCapture(await read(), kind, text, crypto.randomUUID().slice(0, 8), Date.now())));
  return `Saved as a ${captureLabel(kind)}. It shows up in Pixel Pals the next time you open it.`;
}

/** For Telegram and other typed text: returns a reply when the text was a capture, otherwise null so the caller treats it as a question. */
export async function captureFromText(text: string): Promise<string | null> {
  const p = parseCapture(text);
  if (!p) return null;
  if (p.kind === "remind") return createReminder(p.text);
  return saveCapture(p.kind, p.text);
}

/** POST { op: "add", text } works with a session or a Shortcut token; { op: "take" } (hand over and clear) needs a signed-in owner session. */
export async function handleCapture(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { op?: string; text?: string };
  const session = await currentUser(request);
  if (body.op === "take") {
    if (!session?.owner) return Response.json({ error: "Only the owner can collect captures." }, { status: 403 });
    const items = await locked(async () => { const all = await read(); if (all.length) await write([]); return all; });
    return Response.json({ items });
  }
  const user = session ?? (await tokenUser(request));
  if (!user?.owner) return Response.json({ error: "Only the owner account can capture." }, { status: 403 });
  const p = parseCapture(String(body.text ?? ""));
  const text = String(body.text ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (!text) return Response.json({ text: "Nothing to save." }, { status: 400 });
  if (p) return Response.json({ text: p.kind === "remind" ? await createReminder(p.text) : await saveCapture(p.kind, p.text) });
  return Response.json({ text: await saveCapture("note", text) });
}
