// Self-hosted (Docker) only. The Docker image runs the Vite dev server, which does not go through
// src/server.ts, so the password gate, health endpoint and server log are installed here too.
import type { Plugin } from "vite";
import { gate } from "./src/lib/gate.server";
import { logServer } from "./src/lib/server-log.server";
import { startScheduler } from "./src/lib/scheduler.server";
import { startWatcher } from "./src/lib/unraid.server";
import { ensureSettings } from "./src/lib/settings.server";

export function selfHostedPlugin(): Plugin {
  return {
    name: "buddy-self-hosted",
    configureServer(server) {
      // Load the settings saved in the app first, then start the Unraid watcher (no-op unless an Unraid address is set)
      // and the daily jobs (backup, morning brief; no-op unless configured).
      void ensureSettings().then(() => { startWatcher(); startScheduler(); });
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
          if (url.pathname === "/__health") {
            res.statusCode = 200;
            res.end("ok");
            return;
          }
          const chunks: Buffer[] = [];
          // Only the login form needs its body read; any other request must reach the app with its body intact.
          const isLogin = req.method === "POST" && ["/__login", "/__signin", "/__signup"].includes(url.pathname);
          if (isLogin) for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers as Record<string, string | string[] | undefined>)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
          headers.delete("content-length");
          headers.delete("transfer-encoding");
          const request = new Request(url, {
            method: req.method ?? "GET",
            headers,
            ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
          });
          const stopped = await gate(request, process.env["BUDDY_PASSWORD"]);
          if (!stopped) return next();
          res.statusCode = stopped.status;
          stopped.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await stopped.arrayBuffer()));
        } catch (error) {
          logServer("error", "self-hosted middleware failed", error);
          next();
        }
      });
    },
  };
}
