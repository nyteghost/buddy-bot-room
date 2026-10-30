import { createFileRoute } from "@tanstack/react-router";
import { handlePalWork } from "@/lib/focus-artifact.server";
export const Route=createFileRoute("/api/pal-work")({
 server:{handlers:{POST:({request})=>handlePalWork(request)}}
});
