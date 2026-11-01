import { createContext, useContext } from "react";
import type { MacroTargets } from "./food-macros";
type SharedTargets = { targets: MacroTargets; setTargets: (targets: MacroTargets) => void };
export const FoodTargetsContext = createContext<SharedTargets | null>(null);
export const useFoodTargets = () => useContext(FoodTargetsContext);
