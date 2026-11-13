import { setWorldRoomAppearance, worldPresentation, worldPresentationDefault, WORLD_PIXEL_MAX_WIDTH, type WorldPresentationChoice } from "@/lib/world-presentation";
import { lowPower } from "@/lib/power";
import { useWorldDeviceHints, useWorldRoomAppearance } from "@/lib/world-presentation-react";
import { clearWorldPalLook, useWorldPalPixelSkins, useWorldPalSkins, useWorldSkinCharacters, worldPalAppearances } from "@/lib/world-pal-skins";
import { worldLookArtNote } from "@/lib/world-hd-animation";
import { agentName, type AgentId } from "@/lib/agents";



const LOOKS: Array<{ value: WorldPresentationChoice; label: string; hint: string }> = [
 { value: "auto", label: "Auto", hint: "HD on larger screens, Pixel on phones" },
 { value: "hd", label: "HD", hint: "Detailed characters in a larger room with a camera" },
 { value: "pixel", label: "Pixel", hint: "Compact retro pixel rooms (today's Living World)" },
];

/**
 * Room Appearance (per device). Only changes how the room is drawn on this device: Pals, memories,
 * conversations, tasks, permissions and server data are shared and never change with the look.
 */
export function WorldRoomAppearance() {
 const appearance = useWorldRoomAppearance(), hints = useWorldDeviceHints();
 const resolved = worldPresentation(appearance.look, hints), auto = worldPresentationDefault(hints);
 const low = lowPower.use();
 const isoEligible = appearance.hdOffice && resolved === "hd" && hints.width > WORLD_PIXEL_MAX_WIDTH &&
  !hints.coarse && !hints.mobile && !hints.saveData && !low;
 return <fieldset className="world-room-appearance mb-3 rounded-md border border-border/60 p-2">
  <legend className="px-1 text-xs font-semibold">Room appearance</legend>
  <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Living Universe look">
   {LOOKS.map(l => <button key={l.value} type="button" role="radio" aria-checked={appearance.look === l.value} title={l.hint}
    className={"world-look-option" + (appearance.look === l.value ? " is-selected" : "")} onClick={() => setWorldRoomAppearance({ look: l.value })}>
    {l.label}{l.value === "auto" ? ` (${auto === "hd" ? "HD" : "Pixel"} here)` : ""}
   </button>)}
  </div>
  <label className="mt-2 flex items-start gap-2 text-xs">
   <input type="checkbox" checked={appearance.hdOffice} onChange={e => setWorldRoomAppearance({ hdOffice: e.target.checked })} aria-describedby="hd-office-hint" />
   <span><span className="font-semibold">HD office preview</span> <span id="hd-office-hint" className="text-muted-foreground">— the Office theme in the larger HD room when the look is HD. Other themes and Pixel keep today's Living World.</span></span>
  </label>
  <label className="mt-1 flex items-start gap-2 text-xs">
   <input type="checkbox" aria-label="Isometric Office (grey-box preview)" checked={appearance.isoOffice === true} disabled={!isoEligible}
    onChange={e => setWorldRoomAppearance({ isoOffice: e.target.checked })} />
   <span><span className="font-semibold">Isometric Office (grey-box preview)</span> <span className="text-muted-foreground">— experimental synthetic 2:1 Office, available only on desktop with HD Office and Linux/Office theme. Off by default; Classic, Pixel and flat HD stay available.</span></span>
  </label>
  <label className="mt-1 flex items-start gap-2 text-xs">
   <input type="checkbox" checked={appearance.synthetic} disabled={!appearance.hdOffice} onChange={e => setWorldRoomAppearance({ synthetic: e.target.checked })} />
   <span><span className="font-semibold">Synthetic HD placeholders</span> <span className="text-muted-foreground">— code-drawn stand-ins to preview HD scale for Pals without approved HD art.</span></span>
  </label>
  <PalAppearances showing={resolved} />
  <p className="mt-1 text-[11px] text-muted-foreground" role="status">
   This device shows {resolved === "hd" ? "HD" : "Pixel"}{appearance.hdOffice && resolved === "hd" ? appearance.isoOffice && isoEligible ? " (isometric grey-box in the Office theme; otherwise flat HD)" : " (flat HD office preview in the Office theme)" : ""}. Saved on this device only; your Pals, memories and tasks are the same in every look.
  </p>
 </fieldset>;
}

/** One Pal, two appearances: the Desktop HD and Mobile Pixel looks of each Pal that has any. */
function PalAppearances({ showing }: { showing: "hd" | "pixel" }) {
 const list = worldPalAppearances(useWorldPalSkins(), useWorldPalPixelSkins(), useWorldSkinCharacters());
 if (!list.length) return null;
 return <div className="world-pal-appearances mt-2 text-xs" role="group" aria-label="Pal appearances">
  <p className="font-semibold">Pal appearances <span className="font-normal text-muted-foreground">— cosmetic only; each Pal stays one Pal with the same memories, chats, tasks and permissions.</span></p>
  <ul className="mt-1 space-y-1">
   {list.map(a => {
    const shown = showing === "hd" ? a.hd ?? a.pixel : a.pixel ?? a.hd;
    const name = agentName(a.pal as AgentId, false);
    return <li key={a.pal} data-pal={a.pal} data-showing={shown === a.hd ? "hd" : "pixel"}>
     <strong>{name}</strong>: Desktop HD — {a.hd ? a.hd.name : "original"} · Mobile Pixel — {a.pixel ? a.pixel.name : "original"}
     <span className="text-muted-foreground"> · this device shows {shown ? shown.name : "the original " + name}{shown ? " (" + worldLookArtNote(shown) + ")" : ""}</span>
     {" "}<button type="button" className="world-look-option" onClick={() => clearWorldPalLook(a.pal)} aria-label={"Restore " + name + "'s original look"}>Restore original</button>
    </li>;
   })}
  </ul>
 </div>;
}
