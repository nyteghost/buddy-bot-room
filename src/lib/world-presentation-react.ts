import { useSyncExternalStore } from "react";
import { WORLD_ROOM_APPEARANCE_DEFAULT, getWorldRoomAppearance, subscribeWorldRoomAppearance, worldDeviceHints, type WorldDeviceHints, type WorldRoomAppearance } from "./world-presentation";

/** Room Appearance preferences for this device (live across tabs). */
export function useWorldRoomAppearance(): WorldRoomAppearance {
 return useSyncExternalStore(subscribeWorldRoomAppearance, getWorldRoomAppearance, () => WORLD_ROOM_APPEARANCE_DEFAULT);
}
const SERVER_HINTS: WorldDeviceHints = Object.freeze({ width: 1280, coarse: false });
let hintsCache: WorldDeviceHints | null = null;
function hintsSnapshot(): WorldDeviceHints {
 const next = worldDeviceHints();
 if (!hintsCache || hintsCache.width !== next.width || hintsCache.coarse !== next.coarse || hintsCache.saveData !== next.saveData) hintsCache = next;
 return hintsCache;
}
function subscribeHints(listener: () => void): () => void {
 window.addEventListener("resize", listener);
 return () => window.removeEventListener("resize", listener);
}
/**
 * Device hints, updated on resize. The server snapshot (desktop) is also used while hydrating,
 * so server and first client render agree; React then re-renders with the real device.
 */
export function useWorldDeviceHints(): WorldDeviceHints {
 return useSyncExternalStore(subscribeHints, hintsSnapshot, () => SERVER_HINTS);
}
