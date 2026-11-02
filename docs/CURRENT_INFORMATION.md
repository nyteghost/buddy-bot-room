# Current information in General Chat

Ollama models do not have built-in live internet access. Pixel Pals can give the answering model current search results, with links you can inspect.

## Enable it

1. Open Settings → Integrations → Web search (SearXNG).
2. Enter the address of your own SearXNG service, reachable from the Pixel Pals container. Save, then Test. SearXNG must allow `json` in `search.formats`.
3. Open General Chat and set **Web search mode** to **Auto** or **On**.
4. Ask a current question. Expand **Web sources** under the answer to inspect the returned links and search status.

Auto recognizes common freshness questions, including elections, current news, weather and prices. It avoids automatically searching personal questions, recognizable hidden credentials and local network addresses. On explicitly searches the submitted question; Off does not search. Existing explicit research opt-outs remain Off. Auto is a heuristic: use On when a question needs a search that Auto missed.

Pixel Pals supplies the current date and browser time zone independently of search. A date alone does not verify current events. Search failures and empty results are shown explicitly. Results can come from the existing five-minute search cache; the receipt indicates cached results. Search snippets are evidence for the model, not trusted instructions. Check primary sources for consequential answers.

Only the bounded, credential-scrubbed current question becomes a search query. Retrieved memories are not included in that query. The configured search service receives the query and may contact internet search engines. Local-Only AI blocks cloud *AI providers*; it does not make enabled web search offline. Choose Off to avoid search requests.

No search service is installed or enabled automatically by this update. Your Ollama address and firewall configuration need no changes. A configured server-side service works for mobile browsers without direct access to Ollama or SearXNG.

## Performance

General Chat starts independent model health, semantic-memory lookup and web-search work concurrently. General Chat displays temporary streaming previews and saves the complete answer with its source receipts. Credential-like content is held until final scrubbing; older API callers can still request the buffered JSON response. Background Memory Keeper and capture jobs share one worker and yield to foreground chat. This reduces redundant waiting and competing background work; it does not guarantee faster model token generation. Actual RTX 3080 throughput has not been measured by repository tests.
