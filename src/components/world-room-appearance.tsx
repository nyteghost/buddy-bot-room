import { setWorldRoomAppearance, worldPresentation, worldPresentationDefault, type WorldPresentationChoice } from "@/lib/world-presentation";
import { useWorldDeviceHints, useWorldRoomAppearance } from "@/lib/world-presentation-react";

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
   <input type="checkbox" checked={appearance.synthetic} disabled={!appearance.hdOffice} onChange={e => setWorldRoomAppearance({ synthetic: e.target.checked })} />
   <span><span className="font-semibold">Synthetic HD placeholders</span> <span className="text-muted-foreground">— code-drawn stand-ins to preview HD scale for Pals without approved HD art.</span></span>
  </label>
  <p className="mt-1 text-[11px] text-muted-foreground" role="status">
   This device shows {resolved === "hd" ? "HD" : "Pixel"}{appearance.hdOffice && resolved === "hd" ? " (HD office preview in the Office theme)" : ""}. Saved on this device only; your Pals, memories and tasks are the same in every look.
  </p>
 </fieldset>;
}
