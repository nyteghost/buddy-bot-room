import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import mascot from "@/assets/mascot.png";
import { ShowServicesTools } from "@/components/work-tools";

function WorkPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-4 pb-16 pt-4 sm:px-6">
      <header className="mb-4 flex items-center gap-3 border-b border-border pb-3">
        <img src={mascot} width={36} height={36} alt="" draggable={false} style={{ imageRendering: "pixelated" }} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight">Show Services tools</h1>
          <p className="text-xs text-muted-foreground">Events, shifts, stage decks, vendors, floor maps. Files are read in this browser and never leave your device.</p>
        </div>
        <a href="/" className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-sm text-foreground hover:bg-accent"><ArrowLeft className="size-4" /> Pixel Pals</a>
      </header>
      <ShowServicesTools page />
    </main>
  );
}

export const Route = createFileRoute("/work")({
  component: WorkPage,
  head: () => ({ meta: [{ title: "Show Services tools" }, { name: "description", content: "Work tools: schedules, stage decks, vendors and floor-map coloring." }] }),
});
