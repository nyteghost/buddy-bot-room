import { useState } from "react";
import { useCalmInterval } from "@/lib/power";
import type { CharacterMode } from "@/lib/hellraiser";
import type { Sky } from "@/lib/live-room";
import { worldRoomPlan } from "@/lib/world-floor";
import { useWorldFixtureVersion, worldFixtureInUse } from "@/lib/world-presence";

export type WorldTime = "morning" | "day" | "evening" | "night";
/** Browser-local scene lighting; no tracking, geolocation or external request. */
export function worldTimeForHour(hour: number): WorldTime {
  if (!Number.isFinite(hour)) return "day";
  const h=((Math.floor(hour)%24)+24)%24;
  if(h>=5&&h<10)return "morning";
  if(h>=10&&h<18)return "day";
  if(h>=18&&h<22)return "evening";
  return "night";
}

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
export function WorldAtmosphere({ theme, active = true, sky = "clear" }: { theme: CharacterMode; active?: boolean; sky?: Sky }) {
  const prop = worldPropForTheme(theme);
  const [time,setTime]=useState<WorldTime>(()=>worldTimeForHour(new Date().getHours()));
  useCalmInterval(()=>setTime(worldTimeForHour(new Date().getHours())),60_000,active);
  useWorldFixtureVersion();
  const fixtures=worldRoomPlan(theme).fixtures;
  return <div aria-hidden="true" className={`world-atmosphere world-atmosphere-${theme}`} data-world-prop={prop} data-world-time={time} data-world-weather={sky}>
    <span className="world-light"/>
    <span className="world-specks"/>
    <span className="world-glimmer"/>
    <span className="world-shadow"/>
    <span className="world-timewash"/>
    <span className="world-night-stars"/>
    <span className="world-weather-window"/>
    <span className="world-weather-front"/>
    <span className="world-prop-a"/>
    <span className="world-prop-b"/>
    <span className="world-prop-c"/>
    {fixtures.map(fixture=><span key={fixture.id} className="world-fixture" data-kind={fixture.kind} data-fixture={fixture.id} data-active={worldFixtureInUse(theme,fixture.id)} style={{left:fixture.glow.x+"%",top:fixture.glow.y+"%"}}/>)}
  </div>;
}
