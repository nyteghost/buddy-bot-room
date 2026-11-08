/** Synthetic 256x256 transparent character ZIP for browser smoke. Generated in memory, never checked in as artwork. */
import { deflateRawSync, deflateSync } from "node:zlib";

const crcTable=Array.from({length:256},(_,n)=>{
 let value=n;
 for(let i=0;i<8;i++)value=(value&1)?(0xedb88320^(value>>>1)):(value>>>1);
 return value>>>0;
});
function crc32(bytes){
 let crc=0xffffffff;
 for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);
 return (crc^0xffffffff)>>>0;
}
function pngChunk(name,bytes){
 const kind=Buffer.from(name,"ascii"),length=Buffer.alloc(4),check=Buffer.alloc(4);
 length.writeUInt32BE(bytes.length);
 check.writeUInt32BE(crc32(Buffer.concat([kind,bytes])));
 return Buffer.concat([length,kind,bytes,check]);
}
function png256(pose,tint=0){
 const width=256,height=256,raw=Buffer.alloc(height*(1+width*4));
 for(let y=0;y<height;y++){
  const start=y*(1+width*4);
  for(let x=0;x<width;x++){
   const head=y>=35&&y<130&&x>=84&&x<172;
   const torso=y>=131&&y<214&&x>=68&&x<188;
   const leg=y>=214&&y<245&&((x>=78&&x<108)||(x>=148&&x<178));
   const wave=pose==="wave"&&x>=177&&x<208&&y>=84&&y<148;
   if(!head&&!torso&&!leg&&!wave)continue;
   const at=start+1+4*x;
   raw[at]=head?243:50+tint;raw[at+1]=wave?195:head?177:132;
   raw[at+2]=head?90:232-tint;raw[at+3]=255;
  }
 }
 const ihdr=Buffer.alloc(13);
 ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  pngChunk("IHDR",ihdr),pngChunk("IDAT",deflateSync(raw)),pngChunk("IEND",Buffer.alloc(0)),
 ]);
}
export function hdCharacterSmokeZip(version=2){
 let manifest={
  format:"pixel-pals-character-addon",version:2,name:"Smoke HD Pack",
  characters:[{id:"user-smokebot2026",name:"Smoke HD Bot",sprites:{
   idle:"smoke/idle.png",walk:["smoke/walk.png"],wave:["smoke/wave.png"],
  }}],
 };
 if(version===3){
  const clip=(file,loop=true)=>({frames:[{file:"smoke/"+file+".png",durationMs:180}],loop});
  const actions={idle:clip("idle"),walk:{frames:[{file:"smoke/idle.png",durationMs:120},{file:"smoke/wave.png",durationMs:240}],loop:true},wave:clip("wave",false),signature:clip("wave",false)};
  manifest={format:"pixel-pals-character-addon",version:3,name:"Smoke HD Pack",characters:[{
   id:"user-smokebot2026",name:"Smoke HD Bot",resolution:256,revision:1,artStatus:"prototype",movement:"humanoid",
   directions:Object.fromEntries(["s","se","e","ne","n","nw","w","sw"].map(direction=>[direction,actions])),
  }]};
 }
 const entries=[
  {name:"character-pack.json",data:Buffer.from(JSON.stringify(manifest))},
  {name:"smoke/idle.png",data:png256("idle")},
  {name:"smoke/walk.png",data:png256("walk")},
  {name:"smoke/wave.png",data:png256("wave")},
 ];
 return zipOf(entries);

}
function zipOf(entries){
 const localParts=[],centralParts=[];let offset=0;
 for(const {name,data} of entries){
  const label=Buffer.from(name),compressed=deflateRawSync(data);
  const local=Buffer.alloc(30),central=Buffer.alloc(46);
  const crc=crc32(data);
  local.writeUInt32LE(0x04034b50,0);
  local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);
  local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);
  local.writeUInt32LE(data.length,22);local.writeUInt16LE(label.length,26);
  central.writeUInt32LE(0x02014b50,0);
  central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt16LE(8,10);
  central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);
  central.writeUInt32LE(data.length,24);central.writeUInt16LE(label.length,28);
  central.writeUInt32LE(offset,42);
  localParts.push(local,label,compressed);
  centralParts.push(central,label);
  offset+=local.length+label.length+compressed.length;
 }
 const size=centralParts.reduce((sum,p)=>sum+p.length,0),eocd=Buffer.alloc(22);
 eocd.writeUInt32LE(0x06054b50,0);
 eocd.writeUInt16LE(entries.length,8);eocd.writeUInt16LE(entries.length,10);
 eocd.writeUInt32LE(size,12);eocd.writeUInt32LE(offset,16);
 return Buffer.concat([...localParts,...centralParts,eocd]);
}
/** Synthetic idle-only v3 pack (one front frame), shaped like the private Nova Desktop HD / Mobile Pixel samples. */
export function idleOnlySmokeZip(id,name,revision,tint){
 const manifest={format:"pixel-pals-character-addon",version:3,name:name+" pack",characters:[{id,name,resolution:256,revision,artStatus:"prototype",movement:"humanoid",height:"adult",
  directions:{s:{idle:{frames:[{file:"art/idle-s.png",durationMs:1200}],loop:true}}}}]};
 return zipOf([{name:"character-pack.json",data:Buffer.from(JSON.stringify(manifest))},{name:"art/idle-s.png",data:png256("idle",tint)}]);
}
