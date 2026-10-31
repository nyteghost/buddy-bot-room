import { createFileRoute } from "@tanstack/react-router";
import { handleMemorySuggest } from "@/lib/memory-suggest.server";
export const Route = createFileRoute("/api/memory-suggest")({server:{handlers:{POST:({request})=>handleMemorySuggest(request)}}});
