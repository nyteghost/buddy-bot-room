import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import mascot from "@/assets/mascot.png";
import { TodayPlanner } from "@/components/today-planner";

function TodayPage() {
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-4 pb-24 pt-4">
      <header className="mb-4 flex items-center gap-3 border-b border-border pb-3">
        <img src={mascot} width={36} height={36} alt="" draggable={false} style={{ imageRendering: "pixelated" }} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight">Today</h1>
          <p className="text-xs text-muted-foreground">{date}</p>
        </div>
        <a href="/" className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent"><ArrowLeft className="size-4" /> Pixel Pals</a>
      </header>
      <TodayPlanner />
    </main>
  );
}

export const Route = createFileRoute("/today")({
  component: TodayPage,
  head: () => ({ meta: [{ title: "Today" }, { name: "description", content: "A loose, kind day planner: capture, plan, and pick what to do now." }, { name: "apple-mobile-web-app-capable", content: "yes" }, { name: "apple-mobile-web-app-title", content: "Today" }] }),
});
