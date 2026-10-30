/**
 * Generate multi-resolution Windows ICO and app-window PNG from the ShowPilot
 * user-approved cleaned ShowPilot original artwork. All frames are embedded in a single ICO (not a 256-only icon).
 * No external binary commands, installer or network service are needed at work.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const src = new URL("../src/assets/showpilot-approved.webp", import.meta.url);
const out = path.resolve("desktop");
await fs.mkdir(out, {recursive:true});
const artwork = await fs.readFile(src);
const sizes = [16,24,32,48,64,128,256];
const images = await Promise.all(sizes.map(size =>
  sharp(artwork,{density:288}).resize(size,size,{fit:"contain"}).png().toBuffer()
));
const header = Buffer.alloc(6);
header.writeUInt16LE(0,0);
header.writeUInt16LE(1,2);
header.writeUInt16LE(sizes.length,4);
let offset = header.length + sizes.length * 16;
const directory = sizes.map((size,i)=>{
  const frame = Buffer.alloc(16);
  frame.writeUInt8(size===256?0:size,0);
  frame.writeUInt8(size===256?0:size,1);
  frame.writeUInt8(0,2);
  frame.writeUInt8(0,3);
  frame.writeUInt16LE(1,4);
  frame.writeUInt16LE(32,6);
  frame.writeUInt32LE(images[i].length,8);
  frame.writeUInt32LE(offset,12);
  offset += images[i].length;
  return frame;
});
await fs.writeFile(path.join(out,"showpilot.ico"),Buffer.concat([header,...directory,...images]));
await fs.writeFile(path.join(out,"showpilot.png"),images[images.length-1]);
console.log("ShowPilot app icon generated:", sizes.join(","),"px");
