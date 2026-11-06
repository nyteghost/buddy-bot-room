import { deflateSync } from "node:zlib";
import { starterCustomCharacter, type WorldCustomCharacter } from "@/lib/world-custom-packs";

function crc(bytes:Buffer){
 let value=0xffffffff;
 for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=value&1?0xedb88320^(value>>>1):value>>>1;}
 return (value^0xffffffff)>>>0;
}
export function pngChunk(type:string,bytes:Buffer){
 const label=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);
 head.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc(Buffer.concat([label,bytes])));
 return Buffer.concat([head,label,bytes,tail]);
}
export function hdPng(options:{opaque?:boolean;empty?:boolean;scanlines?:Buffer}={}){
 const header=Buffer.alloc(13);header.writeUInt32BE(256);header.writeUInt32BE(256,4);header[8]=8;header[9]=6;
 const rows=Buffer.alloc(256*1025);
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){
  const p=y*1025+1+x*4;rows[p]=200;rows[p+1]=80;rows[p+2]=30;
  rows[p+3]=options.empty?0:options.opaque||x>80&&x<170&&y>30&&y<230?255:0;
 }
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",header),pngChunk("IDAT",deflateSync(options.scanlines??rows)),pngChunk("IEND",Buffer.alloc(0))]);
}
export function hdCharacter(version=1):WorldCustomCharacter{
 return {...starterCustomCharacter(),hd3:{version,artStatus:"prototype",movement:"humanoid",directions:{s:{idle:{frames:[{src:"data:image/png;base64,"+hdPng().toString("base64"),durationMs:100}],loop:true}}}}};
}
