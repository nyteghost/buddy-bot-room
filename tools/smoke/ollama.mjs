// Isolated, read-only Ollama stand-in. No model generation, downloads or external network.
import { createServer } from "node:http";
const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method === "GET" && request.url === "/api/tags") return response.end(JSON.stringify({ models: [{ name: "smoke-local:7b", size: 1000 }] }));
  if (request.method === "GET" && request.url === "/api/ps") return response.end('{"models":[]}');
  response.statusCode = 404; response.end('{"error":"Read-only smoke fixture"}');
});
server.listen(Number(process.env.SMOKE_OLLAMA_PORT || 11435), "127.0.0.1");
process.on("SIGTERM", () => server.close());
