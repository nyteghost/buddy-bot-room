import { createHash, randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { validWorldHdPng } from "./world-hd";
import * as fs from "node:fs/promises";
import type { WorldCustomCharacter } from "./world-custom-packs";

const ASSET_PREFIX = "/api/character-universe?asset=";
const MAX_ASSET_STORE_BYTES = 512 * 1024 * 1024;
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const hashBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const assetHash = (src: string) => /^\/api\/character-universe\?asset=([a-f0-9]{64})$/.exec(src)?.[1];

/** Decode the bounded scanlines so malformed or explosive IDAT streams never enter storage. */
export function validateDecodedCharacterPng(bytes: Uint8Array): void {
 if (!validWorldHdPng(bytes)) throw Error("Invalid HD PNG artwork.");
 const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
 const color = data[25]!;
 const channels = color === 6 ? 4 : color === 2 ? 3 : color === 4 ? 2 : 1;
 const stride = 256 * channels;
 const compressed: Buffer[] = [];
 let paletteAlpha: Buffer | undefined;
 let paletteEntries = 0;
 let rgbTransparent: number[] | undefined;
 for (let offset = 8; offset < data.length;) {
  const size = data.readUInt32BE(offset);
  const type = data.toString("ascii", offset + 4, offset + 8);
  const chunk = data.subarray(offset + 8, offset + 8 + size);
  if (type === "IDAT") compressed.push(chunk);
  if (type === "PLTE") paletteEntries = size / 3;
  if (type === "tRNS" && color === 3) paletteAlpha = chunk;
  if (type === "tRNS" && color === 2) rgbTransparent = [chunk.readUInt16BE(0), chunk.readUInt16BE(2), chunk.readUInt16BE(4)];
  offset += size + 12;
 }
 const expected = (stride + 1) * 256;
 const decoded = inflateSync(Buffer.concat(compressed), {maxOutputLength: expected});
 if (decoded.length !== expected) throw Error("PNG scanline length is invalid.");
 let previous = new Uint8Array(stride);
 let transparent = false, visible = false;
 for (let y = 0; y < 256; y++) {
  const offset = y * (stride + 1);
  const filter = decoded[offset]!;
  if (filter > 4) throw Error("PNG scanline filter is invalid.");
  const row = new Uint8Array(stride);
  for (let x = 0; x < stride; x++) {
   const left = x >= channels ? row[x - channels]! : 0;
   const up = previous[x]!;
   const corner = x >= channels ? previous[x - channels]! : 0;
   let predictor = 0;
   if (filter === 1) predictor = left;
   else if (filter === 2) predictor = up;
   else if (filter === 3) predictor = Math.floor((left + up) / 2);
   else if (filter === 4) {
    const p = left + up - corner;
    const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
    predictor = a <= b && a <= c ? left : b <= c ? up : corner;
   }
   row[x] = (decoded[offset + 1 + x]! + predictor) & 255;
  }
  for (let x = 0; x < stride; x += channels) {
   let alpha = 255;
   if (color === 6 || color === 4) alpha = row[x + channels - 1]!;
   else if (color === 3) {
    const index = row[x]!;
    if (index >= paletteEntries) throw Error("PNG palette index is invalid.");
    alpha = paletteAlpha?.[index] ?? 255;
   } else if (rgbTransparent?.every((value, index) => row[x + index] === value)) alpha = 0;
   transparent ||= alpha < 255;
   visible ||= alpha > 0;
  }
  previous = row;
 }
 if (!transparent || !visible) throw Error("HD PNG artwork must contain visible art and transparency.");
}

async function readAsset(root: string, hash: string): Promise<Buffer> {
 if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("Invalid character asset reference.");
 const path = `${root}/character-assets/${hash}.png`;
 const info = await fs.lstat(path);
 if (!info.isFile() || info.isSymbolicLink() || info.size > 520_000) throw Error("Invalid stored character asset.");
 const bytes = await fs.readFile(path);
 if (hashBytes(bytes) !== hash) throw Error("Stored character artwork failed its integrity check.");
 return bytes;
}

export async function characterAssetResponse(root: string, hash: string): Promise<Response> {
 if (!/^[a-f0-9]{64}$/.test(hash)) return Response.json({error: "Invalid character asset."}, {status: 400});
 try {
  const bytes = await readAsset(root, hash);
  return new Response(new Uint8Array(bytes), {headers: {
   "content-type": "image/png", "cache-control": "private, no-store",
   "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'",
  }});
 } catch {
  return Response.json({error: "Character artwork is unavailable."}, {status: 404});
 }
}

/** Asset files are immutable and never deleted by library edits or failed imports. */
export async function persistCharacterAssets(root: string, characters: WorldCustomCharacter[]): Promise<WorldCustomCharacter[]> {
 const copies = structuredClone(characters);
 const pending = new Map<string, Buffer>();
 const referenced = new Set<string>();
 for (const character of copies) {
  if (!character.hd3) continue;
  for (const actions of Object.values(character.hd3.directions)) {
   if (!actions) continue;
   for (const clip of Object.values(actions)) {
    if (!clip) continue;
    for (const frame of clip.frames) {
     const existing = assetHash(frame.src);
     if (existing) { referenced.add(existing); continue; }
     if (!frame.src.startsWith("data:image/png;base64,")) throw Error("Invalid character artwork.");
     const bytes = Buffer.from(frame.src.slice(22), "base64");
     if (bytes.length > 520_000) throw Error("Character artwork exceeds its size limit.");
     const hash = hashBytes(bytes);
     if (!pending.has(hash)) validateDecodedCharacterPng(bytes);
     pending.set(hash, bytes);
     frame.src = ASSET_PREFIX + hash;
    }
   }
  }
 }
 for (const hash of referenced) await readAsset(root, hash);
 if (!pending.size) return copies;
 const directory = `${root}/character-assets`;
 await fs.mkdir(directory, {recursive: true, mode: 0o700});
 let total = 0;
 const existingHashes = new Set<string>();
 for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
  if (!entry.isFile() || !/^[a-f0-9]{64}\.png$/.test(entry.name)) continue;
  total += (await fs.stat(`${directory}/${entry.name}`)).size;
  existingHashes.add(entry.name.slice(0, -4));
 }
 for (const [hash, bytes] of pending) if (!existingHashes.has(hash)) total += bytes.length;
 if (total > MAX_ASSET_STORE_BYTES) throw Error("Character artwork storage has reached its 512 MiB limit. Existing artwork is retained.");
 for (const [hash, bytes] of pending) {
  const target = `${directory}/${hash}.png`;
  if (existingHashes.has(hash)) { await readAsset(root, hash); continue; }
  const temporary = `${directory}/.pending-${randomUUID()}`;
  try {
   await fs.writeFile(temporary, bytes, {flag: "wx", mode: 0o600});
   try { await fs.link(temporary, target); }
   catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; await readAsset(root, hash); }
  } finally { await fs.rm(temporary, {force: true}); }
 }
 return copies;
}

export async function hydrateCharacterAssets(root: string, characters: WorldCustomCharacter[]): Promise<WorldCustomCharacter[]> {
 const copies = structuredClone(characters);
 const cache = new Map<string, string>();
 let bytes = 0;
 for (const character of copies) {
  if (!character.hd3) continue;
  for (const actions of Object.values(character.hd3.directions)) {
   if (!actions) continue;
   for (const clip of Object.values(actions)) {
    if (!clip) continue;
    for (const frame of clip.frames) {
     const hash = assetHash(frame.src);
     if (!hash) continue;
     let source = cache.get(hash);
     if (!source) { source = "data:image/png;base64," + (await readAsset(root, hash)).toString("base64"); cache.set(hash, source); }
     bytes += source.length;
     if (bytes > MAX_EXPORT_BYTES) throw Error("Export is too large. Back up the Character Universe data and character-assets folder together.");
     frame.src = source;
    }
   }
  }
 }
 if (JSON.stringify({format:"pixel-pals-character-universe",version:1,characters:copies}).length > MAX_EXPORT_BYTES)
  throw Error("Export exceeds the portable backup size limit. Back up the data directory instead.");
 return copies;
}
