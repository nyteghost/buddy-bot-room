import type { Facing } from "./pal-art";
/** Eight generated native 32px compass views; bespoke art can replace these per character. */
export function worldFacingSprite(front:string[],facing:Facing,walkFrame=0,chest=false):string[]{
 if(front.length!==32||front.some(row=>row.length!==32))return front;
 const rear=["n","ne","nw"].includes(facing),side=facing==="e"||facing==="w";
 const diagonal=["ne","se","nw","sw"].includes(facing),west=["w","nw","sw"].includes(facing);
 const counts=new Map<string,number>();
 for(const row of front.slice(0,5))for(const p of row)if(p!==".")counts.set(p,(counts.get(p)??0)+1);
 const crown=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]??"h";
 const base=rear&&!chest?front.map((row,y)=>y<16?row.replace(/[^.]/g,crown):row):front;
 const width=side?.76:diagonal?.88:1;
 const view=base.map(row=>Array.from({length:32},(_,x)=>{
  const source=Math.round((x-15.5)/width+15.5),sx=west?31-source:source;
  return sx<0||sx>=32?".":row[sx]??".";
 }));
 const phase=Number.isFinite(walkFrame)?((Math.trunc(walkFrame)%4)+4)%4:0;
 if(phase!==0&&!chest){const step=phase===1?-1:phase===3?1:0;
  for(let y=25;y<31;y++){const src=view[y]!,dst=Array<string>(32).fill(".");
   for(let x=0;x<32;x++)if(src[x]!==".")dst[Math.max(0,Math.min(31,x+(x<16?step:-step)))]=src[x]!;
   view[y]=dst;
  }
 }
 return view.map(row=>row.join(""));
}
