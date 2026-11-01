import { useState } from "react";
import { PixelCharacter } from "./pixel-character";
import { foodPalAction, kitchenCaptions } from "@/lib/food-pal";
import type { FoodSession } from "@/lib/focus-food";
import "./food-pal.css";
export function FoodPal({ session, paused, open }: { session: FoodSession; paused: boolean; open: boolean }) {
  const [calm, setCalm] = useState(false);
  const action = foodPalAction(session, paused);
  const still = calm || paused || !open;
  const motion = action === "celebrate" ? "celebrate" : action === "rest" || action === "wait" ? "rest" : action === "gather" ? "look" : "work";
  return <aside className="food-pal" aria-label="Cook-along Pal" data-kitchen-action={action} data-kitchen-still={still ? "true" : "false"}>
    <div className="food-pal-bar"><strong>Your kitchen buddy</strong><button type="button" aria-pressed={calm} onClick={() => setCalm(v => !v)}>{calm ? "Animate Pal" : "Calm Pal"}</button></div>
    <div className="food-pal-scene" aria-hidden="true">
      <div className="food-pal-avatar"><PixelCharacter id="echo" motion={still ? "rest" : motion} /><span className="food-pal-hat" /></div>
      <svg className="food-pal-kitchen" viewBox="0 0 300 110" fill="none">
        <path d="M8 92H292V105H8Z" fill="var(--muted)" stroke="var(--border)" strokeWidth="3" />
        <path d="M20 105V110M280 105V110" stroke="var(--border)" strokeWidth="5" />
        <g className="kitchen-ingredients"><path d="M185 72L191 61L199 77L194 88Z" fill="#eaa566" /><path d="M189 62L184 55M191 61L197 54" stroke="#8fd8ae" strokeWidth="3" /><circle cx="213" cy="80" r="9" fill="#8fd8ae" /><path d="M214 71L217 66" stroke="#8fd8ae" strokeWidth="3" /><rect x="232" y="64" width="20" height="27" rx="3" fill="var(--background)" stroke="var(--primary)" strokeWidth="2" /></g>
        <g className="kitchen-chopping"><rect x="162" y="86" width="91" height="6" rx="2" fill="#bf9364" /><path d="M190 84L201 78L209 85" fill="#8fd8ae" /><rect x="218" y="81" width="7" height="5" fill="#8fd8ae" /><rect x="230" y="81" width="7" height="5" fill="#8fd8ae" /><g className="kitchen-knife"><path d="M169 58H191L213 75H184Z" fill="#dbe6ed" /><path d="M160 52L174 62" stroke="#bf9364" strokeWidth="7" /></g></g>
        <g className="kitchen-mixing"><path d="M165 70H247Q245 91 207 91Q171 91 165 70Z" fill="var(--primary)" /><ellipse cx="206" cy="70" rx="40" ry="7" fill="var(--background)" stroke="var(--primary)" strokeWidth="2" /><g className="kitchen-spoon"><path d="M195 47L209 73" stroke="#bf9364" strokeWidth="5" strokeLinecap="round" /><ellipse cx="210" cy="74" rx="8" ry="4" fill="#bf9364" /></g></g>
        <g className="kitchen-heating"><rect x="167" y="86" width="83" height="6" rx="2" fill="var(--foreground)" /><path d="M178 65H239V82Q239 87 232 87H185Q178 87 178 82Z" fill="var(--primary)" /><path d="M171 68H178M239 68H247M174 63H243M205 58H214" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" /><g className="kitchen-steam" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round"><path d="M190 51Q183 44 190 37" /><path d="M209 49Q202 42 209 35" /><path d="M229 51Q222 44 229 37" /></g></g>
        <g className="kitchen-plating"><ellipse cx="208" cy="84" rx="43" ry="8" fill="var(--foreground)" /><ellipse cx="208" cy="81" rx="37" ry="6" fill="var(--background)" /><path d="M190 77L199 67L211 76L221 70L231 78Z" fill="#8fd8ae" /><g className="kitchen-sparkle" stroke="var(--primary)" strokeWidth="3"><path d="M178 47V59M172 53H184M237 43V55M231 49H243" /></g></g>
        <g className="kitchen-waiting"><circle cx="210" cy="70" r="20" stroke="var(--primary)" strokeWidth="4" /><path d="M210 57V70L220 76" stroke="var(--foreground)" strokeWidth="3" strokeLinecap="round" /></g>
      </svg>
    </div>
    <p className="food-pal-caption" role="status">{kitchenCaptions[action]}</p>
    <p className="food-pal-progress">{session.stage === "prep" ? `${session.checked.length} of ${session.recipe.ingredients.length} ingredients checked` : session.stage === "done" ? "Recipe checklist complete" : `Your place: step ${session.index + 1} of ${session.recipe.steps.length}`}</p>
    <small>Pretend kitchen · no camera or food detection.</small>
  </aside>;
}
