import type { CharacterMode } from "@/lib/hellraiser";

export type WorldProp = "console" | "firefly" | "crystal" | "torch" | "neon" | "lantern" | "portal";
/** Theme-specific original pixel props, with zero network requests. */
export function worldPropForTheme(theme: CharacterMode): WorldProp {
  switch (theme) {
    case "matrix": return "console";
    case "cyberpunk": return "neon";
    case "horror":
    case "hellraiser": return "torch";
    case "finalfantasy": return "crystal";
    case "dcc": return "portal";
    case "linux":
    case "assistant":
    case "devteam": return "console";
    default: return "firefly";
  }
}
/** Decorative environment animation; safe with low power and reduced motion. */
export function WorldAtmosphere({ theme }: { theme: CharacterMode }) {
  const prop = worldPropForTheme(theme);
  return <div aria-hidden="true" className={`world-atmosphere world-atmosphere-${theme}`} data-world-prop={prop}>
    <span className="world-light"/>
    <span className="world-specks"/>
    <span className="world-glimmer"/>
    <span className="world-shadow"/>
    <span className="world-prop-a"/>
    <span className="world-prop-b"/>
    <span className="world-prop-c"/>
  </div>;
}
