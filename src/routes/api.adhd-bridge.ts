import { createFileRoute } from "@tanstack/react-router";

export const Route=createFileRoute("/api/adhd-bridge" as never)({
 server:{handlers:{
  GET:({request})=>import("@/lib/adhd-bridge.server").then(x=>x.handleAdhdBridge(request)),
  POST:({request})=>import("@/lib/adhd-bridge.server").then(x=>x.handleAdhdBridge(request)),
 }}
});
