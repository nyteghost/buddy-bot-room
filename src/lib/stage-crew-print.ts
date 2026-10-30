import type { LayoutStage } from "@/components/deck-planner/stage-layout";

/** A physical stage. Loose/bridge deck tiles are not separate stages. */
export type CrewPrintStage = Pick<LayoutStage,"name"|"width"|"length"|"heightIn"|"valid"|"decks"|"holders"> & { extraDecks?: number };

const escape = (value: string) => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/,"");
const num = (value: number) => Number.isFinite(value) ? Math.max(0,value) : 0;

export function crewPrintData(stage: CrewPrintStage) {
  const capacities={1:0,2:0,3:0};
  for(const h of stage.holders)if(h.capacity===1||h.capacity===2||h.capacity===3)capacities[h.capacity]++;
  return {decks:stage.decks.length+Math.max(0,stage.extraDecks??0),loose:Math.max(0,stage.extraDecks??0),holders:capacities,holderTotal:capacities[1]+capacities[2]+capacities[3]};
}

function stageDiagram(stage:CrewPrintStage):string {
  const width=Math.max(1,stage.width),length=Math.max(1,stage.length);
  const padding=5;
  const shape=(x:number,y:number,w:number,h:number)=>[
    fmt(num(x)),fmt(num(y)),fmt(num(w)),fmt(num(h)),
  ];
  const decks=stage.decks.map((d,i)=>{
    const [x,y,w,h]=shape(d.x,d.y,d.w,d.h);
    return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+(d.isBridge?"#edf1f5":"#fff")+'" stroke="#111827" stroke-width=".16" vector-effect="non-scaling-stroke"><title>Deck '+(i+1)+'</title></rect>';
  }).join("");
  const holders=stage.holders.map((h,i)=>{
    const [x,y,w,hh]=shape(h.x,h.y,h.w,h.h);
    const dash=h.capacity===2?' stroke-dasharray=".7 .4"':'';
    const extra=h.capacity===3?'<rect x="'+fmt(num(h.x)+.25)+'" y="'+fmt(num(h.y)+.25)+'" width="'+fmt(Math.max(.1,num(h.w)-.5))+'" height="'+fmt(Math.max(.1,num(h.h)-.5))+'" fill="none" stroke="#111827" stroke-width=".10" vector-effect="non-scaling-stroke"/>':'';
    const labelSize=Math.max(.7,Math.min(1.3,h.w>0?h.w/4:1,h.h>0?h.h/3:1));
    return '<g><rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+hh+'" fill="none" stroke="#111827" stroke-width=".38"'+dash+' vector-effect="non-scaling-stroke"/>'+extra+
      '<text x="'+fmt(num(h.x)+num(h.w)/2)+'" y="'+fmt(num(h.y)+num(h.h)/2)+'" font-size="'+fmt(labelSize)+'" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-weight="700" fill="#111827">'+h.capacity+'x</text></g>';
  }).join("");
  return '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Deck placement for '+escape(stage.name)+'" viewBox="'+(-padding)+' '+(-padding)+' '+(width+2*padding)+' '+(length+2*padding)+'" preserveAspectRatio="xMidYMid meet">'+
    '<text x="'+fmt(width/2)+'" y="-2.2" text-anchor="middle" font-size="1.6" font-weight="700" fill="#101827">'+fmt(width)+' ft width</text>'+
    '<text x="-2.2" y="'+fmt(length/2)+'" transform="rotate(-90 -2.2 '+fmt(length/2)+')" text-anchor="middle" font-size="1.6" font-weight="700" fill="#101827">'+fmt(length)+' ft length</text>'+
    '<rect x="0" y="0" width="'+fmt(width)+'" height="'+fmt(length)+'" fill="#f8fafc" stroke="#111827" stroke-width=".36" vector-effect="non-scaling-stroke"/>'+
    decks+holders+'</svg>';
}

/** Self-contained HTML: independent of the planner CSS and page chrome. */
export function crewPrintDocument(eventName:string, stages:readonly CrewPrintStage[]):string {
  const title=escape(eventName.trim()||"Stage Plan");
  const pages=stages.map((s,index)=>{
    const tally=crewPrintData(s);
    const note=s.valid?"":"<p class=\"warning\">CHECK PLAN: layout cannot be built from current stock.</p>";
    const loose=tally.loose>0?'<p class="loose">Includes '+tally.loose+' extra loose deck'+(tally.loose===1?"":"s")+' not shown in the diagram.</p>':"";
    return '<article class="sheet" data-stage="'+(index+1)+'">'+
      '<div class="eyebrow">COBB CONVENTION CENTER-ATLANTA · STAGE CREW SHEET</div>'+
      '<h1>'+title+'</h1><h2>'+escape(s.name||"Stage "+(index+1))+'</h2>'+
      '<div class="dimensions"><div><span>WIDTH</span><strong>'+fmt(s.width)+' ft</strong></div>'+
      '<div><span>LENGTH</span><strong>'+fmt(s.length)+' ft</strong></div>'+
      '<div><span>HEIGHT</span><strong>'+fmt(s.heightIn)+' in</strong></div></div>'+
      '<div class="counts"><div class="major"><span>4 × 8 DECKS</span><strong>'+tally.decks+'</strong></div>'+
      '<div><span>3-DECK HOLDERS</span><strong>'+tally.holders[3]+'</strong></div>'+
      '<div><span>2-DECK HOLDERS</span><strong>'+tally.holders[2]+'</strong></div>'+
      '<div><span>1-DECK HOLDERS</span><strong>'+tally.holders[1]+'</strong></div></div>'+
      '<div class="drawing"><h3>DECK PLACEMENT · TOP VIEW</h3>'+stageDiagram(s)+'</div>'+
      '<div class="legend"><b>Diagram key:</b> solid outline = 1-deck holder · dashed = 2-deck holder · double = 3-deck holder. Each light rectangle is one 4 × 8 deck.</div>'+
      loose+note+
      '<div class="footer">STAGE '+(index+1)+' OF '+stages.length+' · '+escape(s.name||"Stage")+'</div></article>';
  }).join("");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>'+title+' — Stage Crew Sheets</title>'+
    '<meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<style>@page{size:letter portrait;margin:.45in}*{box-sizing:border-box}html,body{margin:0;padding:0;background:white;color:#111827;font-family:Arial,Helvetica,sans-serif}'+
    '.sheet{height:9.75in;width:100%;padding:0;break-inside:avoid;page-break-inside:avoid;break-after:page;page-break-after:always;display:flex;flex-direction:column;overflow:hidden}'+
    '.sheet:last-child{break-after:auto;page-break-after:auto}.eyebrow{font-size:10px;font-weight:700;letter-spacing:.09em;border-bottom:2px solid #111827;padding-bottom:9px}'+
    'h1{font-size:25px;line-height:1.15;margin:13px 0 3px;color:#000;overflow-wrap:anywhere}h2{font-size:19px;margin:0 0 17px;color:#111}'+
    '.dimensions{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:13px}.dimensions>div{border:2px solid #1f2937;padding:9px 13px}'+
    '.counts{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:8px;margin-bottom:12px}.counts>div{border:1px solid #374151;padding:9px 8px;min-height:67px}.counts .major{background:#eff3f7;border:2px solid #111827}'+
    '.dimensions span,.counts span{display:block;font-size:10px;font-weight:700;color:#20252d;letter-spacing:.04em}.dimensions strong,.counts strong{display:block;font-size:25px;color:#000;margin-top:5px}'+
    '.drawing{border:2px solid #111827;border-radius:3px;flex:1;min-height:0;display:flex;flex-direction:column;padding:10px 13px}h3{font-size:12px;letter-spacing:.05em;margin:0 0 5px;font-weight:700}'+
    '.drawing svg{width:100%;flex:1;min-height:0;max-height:5.2in;display:block}.legend{font-size:10.5px;color:#161b22;margin:11px 0 4px;line-height:1.3}'+
    '.loose{font-size:10.5px;font-weight:700;margin:5px 0}.warning{border:2px solid #111827;padding:5px 8px;font-weight:700;font-size:11px;margin:4px 0}'+
    '.footer{font-size:9px;border-top:1px solid #111827;padding-top:6px;margin-top:auto;text-align:right;color:#111827}'+
    '@media screen{body{background:#e5e7eb;padding:20px}.sheet{width:8.5in;height:11in;background:#fff;margin:0 auto 22px;padding:.45in;box-shadow:0 2px 12px #9ca3af}}'+
    '@media print{html,body{background:#fff!important}.sheet{height:9.7in!important;page-break-after:always}.sheet:last-child{page-break-after:auto}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'+
    '</style></head><body>'+pages+'</body></html>';
}

/** A hidden print frame prevents printing the whole ShowPilot UI and extra blank pages. */
export function printCrewPages(eventName:string,stages:readonly CrewPrintStage[]):void {
  if(!stages.length)throw new Error("Set up at least one stage before printing.");
  const frame=document.createElement("iframe");
  frame.title="ShowPilot crew print document";
  frame.setAttribute("aria-hidden","true");
  frame.style.cssText="position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0";
  const cleanup=()=>{try{frame.remove()}catch{}};
  frame.onload=()=>{
    const w=frame.contentWindow;
    if(!w){cleanup();return}
    w.addEventListener("afterprint",cleanup,{once:true});
    w.focus();w.print();
  };
  // Assign srcdoc before attaching: avoid printing the initial empty iframe document.
  frame.srcdoc=crewPrintDocument(eventName,stages);
  document.body.appendChild(frame);
}
