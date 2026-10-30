import {describe,it,expect} from "vitest";
import {planStage,FULL_STOCK} from "@/lib/deck-solver";

describe("ShowPilot operational bridge planning",()=>{
  it("uses two supported bridge decks between three 3-deck holders for a 44x8 stage",()=>{
    const r=planStage(44,8);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.holderError).toBeUndefined();
    expect(r.decks).toHaveLength(11);
    expect(r.holders).toHaveLength(3);
    expect(r.holders.map(h=>h.capacity)).toEqual([3,3,3]);
    expect(r.bridges).toHaveLength(2);
    expect(r.bridges.map(b=>b.x)).toEqual([12,28]);
    expect(r.bridges.map(b=>b.between)).toEqual([["H1","H2"],["H2","H3"]]);
  });

  it("uses a single bridge between two 3-deck holders for a 28x8 stage",()=>{
    const r=planStage(28,8);
    expect(r.ok).toBe(true);
    if(!r.ok)return;
    expect(r.holderError).toBeUndefined();
    expect(r.holders.map(h=>h.capacity)).toEqual([3,3]);
    expect(r.bridges).toHaveLength(1);
    expect(r.bridges[0]?.between).toEqual(["H1","H2"]);
  });

  it("never assigns a bridge without two distinct holders on either side",()=>{
    for(const [w,l] of [[28,8],[44,8],[24,24],[32,16],[36,16],[20,16]]){
      const r=planStage(w,l);
      if(!r.ok||r.holderError)continue;
      const ids=new Set(r.holders.map(h=>h.label));
      expect(r.decks).toHaveLength(w*l/32);
      expect(r.bridges).toHaveLength(r.decks.filter(d=>d.isBridge).length);
      for(const b of r.bridges){
        expect(ids.has(b.between[0])).toBe(true);
        expect(ids.has(b.between[1])).toBe(true);
        expect(b.between[0]).not.toBe(b.between[1]);
      }
    }
  });
  it("matches the two 92x8 stages using a shared finite inventory",()=>{
    const first=planStage(92,8,FULL_STOCK);
    expect(first.ok).toBe(true);
    if(!first.ok)return;
    expect(first.holderError).toBeUndefined();
    expect(first.decks).toHaveLength(23);
    expect(first.holders.filter(h=>h.capacity===3)).toHaveLength(6);
    expect(first.holders).toHaveLength(6);
    expect(first.bridges).toHaveLength(5);
    const remaining={...FULL_STOCK,
      decks:FULL_STOCK.decks-first.decks.length,
      three:FULL_STOCK.three-first.holders.filter(h=>h.capacity===3).length,
      two:FULL_STOCK.two-first.holders.filter(h=>h.capacity===2).length,
      one:FULL_STOCK.one-first.holders.filter(h=>h.capacity===1).length,
    };
    const second=planStage(92,8,remaining);
    expect(second.ok).toBe(true);
    if(!second.ok)return;
    expect(second.holderError).toBeUndefined();
    expect(second.decks).toHaveLength(23);
    expect(second.holders).toHaveLength(8);
    expect(second.holders.filter(h=>h.capacity===3)).toHaveLength(2);
    expect(second.holders.filter(h=>h.capacity===2)).toHaveLength(5);
    expect(second.holders.filter(h=>h.capacity===1)).toHaveLength(1);
    expect(second.bridges).toHaveLength(6);
    expect([...first.bridges,...second.bridges]).toHaveLength(11);
    expect(first.decks.length+second.decks.length).toBe(46);
    // No piece is silently double-allocated across the two stages.
    expect(first.holders.filter(h=>h.capacity===3).length+second.holders.filter(h=>h.capacity===3).length).toBe(FULL_STOCK.three);
  });
  it("respects stock limits and avoids allocating extra holders",()=>{
    const stock={...FULL_STOCK,three:2,two:0,one:0};
    const r=planStage(28,8,stock);
    expect(r.ok).toBe(true);
    if(!r.ok)return;
    expect(r.holderError).toBeUndefined();
    expect(r.holders).toHaveLength(2);
    expect(r.bridges).toHaveLength(1);
  });
});
