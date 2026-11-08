import { useEffect, useState, useSyncExternalStore } from "react";
import { WORLD_ROOM_APPEARANCE_DEFAULT, getWorldRoomAppearance, subscribeWorldRoomAppearance, worldDeviceHints, type WorldDeviceHints, type WorldRoomAppearance } from "./world-presentation";

/** Room Appearance preferences for this device (live across tabs). */
export function useWorldRoomAppearance(): WorldRoomAppearance {
 return useSyncExternalStore(subscribeWorldRoomAppearance, getWorldRoomAppearance, () => WORLD_ROOM_APPEARANCE_DEFAULT);
}
/** Device hints, updated on resize (debounced by the browser's resize cadence). */
export function useWorldDeviceHints(): WorldDeviceHints {
 const [hints, setHints] = useState<WorldDeviceHints>(() => worldDeviceHints());
 useEffect(() => {
  const update = () => setHints(prev => { const next = worldDeviceHints(); return prev.width === next.width && prev.coarse === next.coarse && prev.saveData === next.saveData ? prev : next; });
  window.addEventListener("resize", update);
  return () => window.removeEventListener("resize", update);
 }, []);
 return hints;
}
