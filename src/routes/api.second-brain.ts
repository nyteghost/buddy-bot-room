import { createFileRoute } from "@tanstack/react-router";
import { handleSecondBrain } from "@/lib/second-brain.server";
export const Route=createFileRoute("/api/second-brain")({server:{handlers:{GET:({request})=>handleSecondBrain(request),POST:({request})=>handleSecondBrain(request)}}});
