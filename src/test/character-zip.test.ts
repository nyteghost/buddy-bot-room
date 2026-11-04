import {describe,expect,it} from "vitest";
import {deflateSync,deflateRawSync} from "node:zlib";
import {parseCharacterZip} from "@/lib/character-zip";
import {validateCustomCharacter} from "@/lib/world-custom-packs";

function crc(bytes:Uint8Array):number{
 let n=0xffffffff;
 for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n&1)?(n>>>1)^0xedb88320:n>>>1;}
 return (n^0xffffffff)>>>0;
}
function png(width=256,height=256):Buffer{
 const block=Buffer.alloc(height*(1+width*4));
 const rowSize=1+width*4;
 for(let y=0;y<height;y++){block[y*rowSize]=0;block[y*rowSize+1]=120;block[y*rowSize+2]=180;block[y*rowSize+3]=240;block[y*rowSize+4]=255;}
 const chunk=(type:string,data:Buffer)=>{
  const code=Buffer.from(type,"ascii"),size=Buffer.alloc(4),check=Buffer.alloc(4);
  size.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([code,data])));
  return Buffer.concat([size,code,data,check]);
 };
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(block)),chunk("IEND",Buffer.alloc(0))]);
}
type Entry={name:string;bytes:Buffer;method?:0|8};
function zip(entries:Entry[]):Blob{
 const locals:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const item of entries){
  const method=item.method??0,body=method===8?deflateRawSync(item.bytes):item.bytes;
  const name=Buffer.from(item.name,"utf8"),local=Buffer.alloc(30),index=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);
  local.writeUInt32LE(crc(item.bytes),14);local.writeUInt32LE(body.length,18);
  local.writeUInt32LE(item.bytes.length,22);local.writeUInt16LE(name.length,26);
  index.writeUInt32LE(0x02014b50);index.writeUInt16LE(20,4);index.writeUInt16LE(20,6);
  index.writeUInt16LE(method,10);index.writeUInt32LE(crc(item.bytes),16);
  index.writeUInt32LE(body.length,20);index.writeUInt32LE(item.bytes.length,24);
  index.writeUInt16LE(name.length,28);index.writeUInt32LE(offset,42);
  locals.push(local,name,body);central.push(index,name);
  offset+=local.length+name.length+body.length;
 }
 const entriesSize=central.reduce((sum,b)=>sum+b.length,0),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);
 end.writeUInt16LE(entries.length,10);end.writeUInt32LE(entriesSize,12);end.writeUInt32LE(offset,16);
 const binary=Buffer.concat([...locals,...central,end]);
 return new Blob([Uint8Array.from(binary).buffer as ArrayBuffer]);
}
const manifest=(filename="sprites/idle.png")=>Buffer.from(JSON.stringify({
 format:"pixel-pals-character-addon",version:2,name:"Test HD pack",
 characters:[{id:"user-testhero001",name:"Test Hero",sprites:{idle:filename,walk:["sprites/walk.png"]}}]
}));
const sample=()=>zip([
 {name:"character-pack.json",bytes:manifest()},
 {name:"sprites/idle.png",bytes:png()},
 {name:"sprites/walk.png",bytes:png(),method:8},
]);
describe("256x256 character ZIP importer",()=>{
 it("imports PNG artwork and animation frames without executing any ZIP content",async()=>{
  const pack=await parseCharacterZip(sample());
  expect(pack.name).toBe("Test HD pack");
  expect(pack.characters).toHaveLength(1);
  const hero=pack.characters[0]!;
  expect(hero.hd?.resolution).toBe(256);
  expect(hero.hd?.idle[0]).toMatch(/^data:image\/png;base64,/);
  expect(hero.hd?.walk).toHaveLength(1);
  expect(validateCustomCharacter(hero)).not.toBeNull();
 });
 it("rejects bad dimensions, path traversal and unknown archive types",async()=>{
  const invalid=zip([{name:"character-pack.json",bytes:manifest()},{name:"sprites/idle.png",bytes:png(32,32)},{name:"sprites/walk.png",bytes:png()}]);
  await expect(parseCharacterZip(invalid)).rejects.toThrow("256x256");
  await expect(parseCharacterZip(zip([{name:"../outside.png",bytes:png()}]))).rejects.toThrow("unsafe file path");
  await expect(parseCharacterZip(new Blob([new Uint8Array([1,2,3]).buffer]))).rejects.toThrow("ZIP");
 });
 it("requires the manifest and checks the ZIP entry integrity",async()=>{
  const noManifest=zip([{name:"sprites/idle.png",bytes:png()}]);
  await expect(parseCharacterZip(noManifest)).rejects.toThrow("manifest");
  const blob=sample(),bytes=new Uint8Array(await blob.arrayBuffer());
  bytes[60]^=0x01;
  await expect(parseCharacterZip(new Blob([bytes.buffer as ArrayBuffer]))).rejects.toThrow();
 });
});
