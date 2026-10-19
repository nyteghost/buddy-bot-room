// Self-hosted (Docker) only. The Docker image runs the Vite dev server, which does not go through
// src/server.ts, so the password gate, health endpoint and server log are installed here too.
import type { Plugin } from "vite";
import { gate } from "./src/lib/gate.server";
import { logServer } from "./src/lib/server-log.server";

export function selfHostedPlugin(): Plugin {
  return {
    name: "buddy-self-hosted",
    configureServer(server) {
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
          const isLogin = req.method === "POST" && url.pathname === "/__login";
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
