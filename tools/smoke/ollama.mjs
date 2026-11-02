// Isolated Ollama protocol fixture: static replies only, no inference/downloads/egress.
import { createServer } from "node:http";
const names = ["smoke-local:7b", "qwen3.5:9b", "qwen3:8b", "qwen2.5-coder:7b"];
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  // Seerr settings smoke uses this same isolated server; no media requests are accepted.
  if (request.method === "GET" && request.url === "/api/v1/auth/me") {
    response.statusCode = request.headers["x-api-key"] === "smoke-seerr-settings-key" ? 200 : 401;
    return response.end(JSON.stringify(response.statusCode === 200 ? { id: 1 } : { error: "Invalid fixture key" }));
  }
  if (request.method === "GET" && request.url.startsWith("/api/v1/search?")) return response.end('{"results":[]}');
  if (request.method === "GET" && request.url.startsWith("/search?")) return response.end(JSON.stringify({results:[{title:"Current information fixture",url:"https://example.test/calendar",content:"Published calendar fixture for browser testing."}]}));
  if (request.method === "POST" && request.url === "/v1/audio/transcriptions") { for await (const chunk of request) { /* Consume the controlled fixture upload. */ } return response.end(JSON.stringify({text:"I need to prepare lunches."})); }
  if (request.method === "GET" && request.url === "/api/tags") return response.end(JSON.stringify({ models: names.map(name => ({ name, size: 5 * 1024 ** 3 })) }));
  if (request.method === "GET" && request.url === "/api/ps") return response.end('{"models":[]}');
  if (request.method === "GET" && request.url === "/api/version") return response.end('{"version":"smoke-fixture"}');
  if (request.method === "POST" && ["/api/generate", "/v1/chat/completions"].includes(request.url)) {
    let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 200000) { response.statusCode = 413; return response.end('{}'); } }
    let body; try { body = JSON.parse(raw); } catch { response.statusCode = 400; return response.end('{}'); }
    if (!names.includes(body.model)) { response.statusCode = 404; return response.end('{"error":"model not installed"}'); }
    if (request.url === "/api/generate") {
      if(String(body.system).includes('suggestions')){const source=JSON.parse(body.prompt).text;return response.end(JSON.stringify({response:JSON.stringify({suggestions:[{kind:'task',text:source.slice(0,200),quote:source.slice(0,200),firstStep:'Choose one small action',minutes:10,materials:[]}]}),done:true}));}
      return response.end('{"response":"","done":true}');
    }
    if (!body.stream) return response.end(JSON.stringify({ id: "smoke-food-chat", object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "Local fixture reply." }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    response.setHeader("Content-Type", "text/event-stream");
    if (JSON.stringify(body.messages?.at(-1)).includes('Streaming fixture verification')) {
      const frame=(delta,finish_reason=null)=>response.write(`data: ${JSON.stringify({id:'smoke-stream',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})}\n\n`);
      frame({role:'assistant',content:'Early streaming fixture reply. '});
      const timer=setTimeout(()=>{frame({content:'Complete streaming fixture reply.'});frame({},'stop');response.end('data: [DONE]\n\n');},4000);
      response.on('close',()=>clearTimeout(timer));
      return;
    }

    for (const [delta, reason] of [[{ role: "assistant", content: "Local fixture reply." }, null], [{}, "stop"]]) response.write(`data: ${JSON.stringify({ id: "smoke-chat", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`);
    return response.end('data: [DONE]\n\n');
  }
  response.statusCode = 404; response.end('{"error":"Unsupported fixture operation"}');
});
server.listen(Number(process.env.SMOKE_OLLAMA_PORT || 11435), "127.0.0.1");
process.on("SIGTERM", () => server.close());
