import { createRoot } from "react-dom/client";
import { DeckPlanner } from "@/components/deck-planner/planner";

createRoot(document.getElementById("root")!).render(
  <div className="mx-auto max-w-5xl px-4 py-6"><DeckPlanner /></div>,
);
