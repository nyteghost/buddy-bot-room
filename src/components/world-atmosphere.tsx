import type { CharacterMode } from "@/lib/hellraiser";
/** Decorative room animation; no remote data or AI calls. */
export function WorldAtmosphere({theme}:{theme:CharacterMode}){
 return <div aria-hidden="true" className={`world-atmosphere world-atmosphere-${theme}`}>
  <span className="world-light"/><span className="world-specks"/>
  <span className="world-glimmer"/><span className="world-shadow"/>
 </div>;
}
