import { createFileRoute } from "@tanstack/react-router";
export const Route=createFileRoute("/api/character-universe")({
 server:{handlers:{
  GET:({request})=>import("@/lib/character-universe.server").then(x=>x.handleCharacterUniverse(request)),
  POST:({request})=>import("@/lib/character-universe.server").then(x=>x.handleCharacterUniverse(request)),
 }}
});
