import { CUSTOM_WORLD_LIMIT, validateCustomCharacter, type WorldCustomCharacter } from "./world-custom-packs";

/** ZIP add-on v1 is strictly data-only: 32x32 native pixel characters.
 * HD sprite assets and AI personalities are a future, separate opt-in schema. */
export const CHARACTER_ADDON_FORMAT="pixel-pals-character-addon";
export const CHARACTER_ADDON_VERSION=1;
export const CHARACTER_ADDON_MAX_ZIP_BYTES=1024*1024;
export const CHARACTER_ADDON_MAX_MANIFEST_BYTES=320*1024;
export type CharacterAddonManifest=Readonly<{
 format:typeof CHARACTER_ADDON_FORMAT;
 version:typeof CHARACTER_ADDON_VERSION;
 name:string;
 description?:string;
 characters:WorldCustomCharacter[];
}>;

const onlyKeys=(obj:Record<string,unknown>,keys:readonly string[])=>Object.keys(obj).every(k=>keys.includes(k));
const safeLabel=(s:unknown,max:number):s is string=>typeof s==="string"&&s.trim().length>0
 &&s.length<=max&&!/[\\x00-\\x1f<>]/.test(s);

/** Rejects unexpected fields rather than silently installing executable or privileged metadata. */
export function parseCharacterAddonManifest(source:unknown):CharacterAddonManifest{
 if(!source||typeof source!=="object"||Array.isArray(source))throw Error("Invalid character add-on manifest");
 const obj=source as Record<string,unknown>;
 if(!onlyKeys(obj,["format","version","name","description","characters"]))throw Error("Unexpected add-on metadata field");
 if(obj["format"]!==CHARACTER_ADDON_FORMAT||obj["version"]!==CHARACTER_ADDON_VERSION)throw Error("Unsupported character add-on version");
 if(!safeLabel(obj["name"],72))throw Error("Invalid add-on name");
 if(obj["description"]!==undefined&&
   (typeof obj["description"]!=="string"||obj["description"].length>280||/[\\x00-\\x1f<>]/.test(obj["description"])))
  throw Error("Invalid add-on description");
 const raw=obj["characters"];
 if(!Array.isArray(raw)||raw.length<1||raw.length>CUSTOM_WORLD_LIMIT)throw Error("Add-on must contain 1 to 12 characters");
 const chars:WorldCustomCharacter[]=[];
 for(const entry of raw){
  if(!entry||typeof entry!=="object"||Array.isArray(entry)||
    !onlyKeys(entry as Record<string,unknown>,["id","name","pixels","palette"]))
   throw Error("Unexpected character field");
  const valid=validateCustomCharacter(entry);
  if(!valid)throw Error("Invalid 32x32 pixel character in add-on");
  if(chars.some(c=>c.id===valid.id))throw Error("Duplicate character ID in add-on");
  chars.push(valid);
 }
 return {format:CHARACTER_ADDON_FORMAT,version:CHARACTER_ADDON_VERSION,
  name:obj["name"].trim(),...(obj["description"]!==undefined?{description:obj["description"] as string}:{}),
  characters:chars};
}

/** Import is atomic, never overwrites an existing character and never auto-enables visitors. */
export function planCharacterAddonInstall(
 manifest:CharacterAddonManifest,existing:readonly WorldCustomCharacter[],requestedIds:readonly string[],
):WorldCustomCharacter[]{
 if(requestedIds.length===0||requestedIds.length>CUSTOM_WORLD_LIMIT||
   new Set(requestedIds).size!==requestedIds.length)throw Error("Select unique characters to install");
 const ids=new Set(requestedIds),available=new Set(manifest.characters.map(c=>c.id));
 if([...ids].some(id=>!available.has(id)))throw Error("Unknown character selected");
 const existingIds=new Set(existing.map(c=>c.id));
 if([...ids].some(id=>existingIds.has(id)))throw Error("A selected character is already installed. Existing art is never overwritten");
 if(existing.length+ids.size>CUSTOM_WORLD_LIMIT)throw Error("Character Library is full; remove an unused creation before importing");
 return manifest.characters.filter(c=>ids.has(c.id));
}
