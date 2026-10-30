import { useEffect, useState } from "react";
import { Gift, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FocusSession } from "@/lib/focus-companion";

const KEY="pixel-pals-quests-optin-v1";
export const QUEST_DECORATIONS=[
  { symbol:"🌱", label:"A little plant" },
  { symbol:"📚", label:"A cozy book nook" },
  { symbol:"🪴", label:"A second plant" },
  { symbol:"🕯️", label:"A warm desk light" },
  { symbol:"🎨", label:"A tiny art corner" },
];
export function questDecorations(steps:number):typeof QUEST_DECORATIONS {
  return QUEST_DECORATIONS.slice(0,Math.min(QUEST_DECORATIONS.length,Math.max(0,Math.floor(steps))));
}
/** One tiny, *optional* scene. Nothing unlocks from surveillance or daily attendance. */
export function QuestCorner({session}:{session:FocusSession|null}){
  const [enabled,setEnabled]=useState(false);
  useEffect(()=>{try { setEnabled(localStorage.getItem(KEY)==="1"); }catch{/* optional */}},[]);
  const toggle=(next:boolean)=>{setEnabled(next);try{localStorage.setItem(KEY,next?"1":"0");}catch{/* optional */}};
  const deco=questDecorations(session?.completed.length??0);
  return <section className="grid gap-2 rounded-xl border p-3" aria-label="Tiny Quest Corner">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="flex items-center gap-2 text-sm font-semibold"><Gift className="size-4"/> Tiny Quest Corner</h3><p className="text-xs text-muted-foreground">A little adventure for getting started. No points, streaks or penalties.</p></div>
      <Button variant="outline" size="sm" aria-pressed={enabled} onClick={()=>toggle(!enabled)}>{enabled?"Hide quests":"Enable quests"}</Button>
    </div>
    {enabled&&<div className="grid gap-2 rounded-lg bg-muted p-3">
      <p className="text-sm font-medium">{session?"Your Pal is decorating a cozy corner!":"Invite a Pal to work with you to unlock a little decoration."}</p>
      <div className="flex gap-3 text-2xl" aria-label={deco.length+" decorations unlocked"}>{deco.length?deco.map((d,i)=><span key={i} title={d.label} aria-label={d.label}>{d.symbol}</span>):<span aria-hidden="true">🌿</span>}</div>
      {session&&deco.length===0&&<p className="text-xs text-muted-foreground">Your first started step will earn a small plant.</p>}
      {!!deco.length&&<p className="text-xs text-muted-foreground"><Sparkles className="inline size-3.5"/> {deco[deco.length-1]?.label} — unlocked by your own marked step.</p>}
      {deco.length>=QUEST_DECORATIONS.length&&<p className="text-xs text-muted-foreground">Your cozy corner is ready. More decorations can come later.</p>}
      <p className="text-xs text-muted-foreground">Decorations follow only this optional Focus Together session; they're not a separate score or saved commitment.</p>
    </div>}
  </section>;
}
