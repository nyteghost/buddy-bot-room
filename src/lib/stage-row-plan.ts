/** Inventory-aware one-row stage planning.
 *
 * A stage exactly 8ft deep can be assembled as one sequence of 4x8 decks,
 * supported by adjacent 1-, 2-, or 3-deck holders. A bridge deck occupies
 * ONE 4ft slot between two holder-supported runs (never at a free edge).
 * Each candidate is validated against the *remaining* inventory, so stage
 * two is planned using the stock already allocated to stage one.
 *
 * This is a layout heuristic, not a structural approval for any bridge span.
 * Stage crews must verify manufacturer-approved bridge support and loads.
 */
import type { Stock, Result, PlanPrefs, Deck, Holder, Bridge } from "./deck-solver";

type Counts = { one:number; two:number; three:number; bridges:number; holders:number };
const prefsAvoidSingles=(count:number)=>count>1?1:0;

function bestCounts(cells:number, stock:Stock, allowTwo:boolean):Counts|null {
  const candidates:Counts[]=[];
  for(let three=0;three<=Math.min(stock.three,Math.floor(cells/3));three++){
    for(let two=0;two<=Math.min(allowTwo?stock.two:0,Math.floor(cells/2));two++){
      for(let one=0;one<=Math.min(stock.one,cells);one++){
        const holders=three+two+one;
        if(holders===0)continue;
        const bridges=cells-(three*3+two*2+one);
        // Exactly one bridge deck can be placed in each internal gap.
        if(bridges<0||bridges>holders-1)continue;
        candidates.push({one,two,three,bridges,holders});
      }
    }
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>
    // Primary: use the fewest holders. Bridges reduce equipment, not deck count.
    (a.holders-b.holders)
    // Secondary: among equally economical layouts, use as many safe bridge
    // positions as possible (matches the user's two-stage 92x8 method).
    || (b.bridges-a.bridges)
    || (prefsAvoidSingles(a.one)-prefsAvoidSingles(b.one))
    // Keep large holders together to simplify carrying and setup.
    || (b.three-a.three)
    || (a.one-b.one)
  );
  return candidates[0];
}

export function planSingleRowStage(width:number,length:number,stock:Stock,prefs:PlanPrefs):Result|null {
  const alongX=length===8 && width>=8 && width%4===0;
  const alongY=width===8 && length>=8 && length%4===0;
  if(!alongX && !alongY)return null;
  const cells=(alongX?width:length)/4;
  if(!Number.isSafeInteger(cells) || cells>stock.decks || cells>72)return null;
  const counts=bestCounts(cells,stock,prefs.allowTwo);
  if(!counts)return null;
  const holders:Holder[]=[],decks:Deck[]=[],bridges:Bridge[]=[];
  const capacities:(1|2|3)[]=[
    ...Array<3>(counts.three).fill(3),
    ...Array<2>(counts.two).fill(2),
    ...Array<1>(counts.one).fill(1),
  ];
  let pos=0,number=0;
  for(let i=0;i<capacities.length;i++){
    const size=capacities[i];
    const label="H"+(++number);
    const x=alongX?pos*4:0;
    const y=alongX?0:pos*4;
    holders.push({x,y,w:alongX?size*4:8,h:alongX?8:size*4,capacity:size,label});
    for(let j=0;j<size;j++){
      const slot=pos+j;
      decks.push({x:alongX?slot*4:0,y:alongX?0:slot*4,w:alongX?4:8,h:alongX?8:4});
    }
    pos+=size;
    // Spread bridge gaps between the first adjacent holders; for a row
    // with six 3-deck holders, every intervening gap becomes a bridge.
    if(i<counts.bridges){
      const bridgeLabel="B"+(bridges.length+1);
      const bx=alongX?pos*4:0,by=alongX?0:pos*4;
      decks.push({x:bx,y:by,w:alongX?4:8,h:alongX?8:4,isBridge:true});
      bridges.push({x:bx,y:by,w:alongX?4:8,h:alongX?8:4,label:bridgeLabel,
        between:[label,"H"+(number+1)]});
      pos++;
    }
  }
  if(pos!==cells) return null;
  return {ok:true,decks,holders,bridges};
}
