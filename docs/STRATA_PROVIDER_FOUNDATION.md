# Strata on CachyOS — Pixel Pals local AI provider foundation

**Status:** Source-only draft; **not connected to any live reply path**. The production
Unraid app, `OLLAMA_URL`, Memory Keeper, Work Tools, existing AI settings, and
local/cloud provider policy remain unchanged. Do not turn `STRATA_ENABLED`
on until the subsequent audited provider-routing PR is accepted.

## Owner-verified network and model discovery

The owner tested Unraid → CachyOS over private Tailscale (not LAN) using
bearer-authenticated Strata `/v1/models` and `/v1/chat/completions`. These
were successful and reported loaded model `qwen3.8-flash-next-coder-iq1_m`.
The earlier 40-token response ended with `finish_reason=length`, showing a
reasoning-output budget issue, **not a network error**. No live API key was sent
to or stored in this repository.

## Proposed server Settings (not a production cutover)

- `STRATA_ENABLED=off` by default; the provider adapter refuses network calls when disabled.
- `STRATA_URL`: the private Tailscale/LAN IPv4 URL with port and optional `/v1`.
  Never put a key in it. Public hosts, DNS names, userinfo, fragments, query
  strings and non-/v1 paths are rejected. No redirects are followed.
- `STRATA_API_KEY`: a secret field stored under protected
  `BUDDY_DATA_DIR/app-secrets.json` (mode 0600), omitted from Settings
  responses and normal backups.
- `STRATA_MODEL`: exact model ID returned by `/v1/models`.

The source-only `strata.server.ts` adapter provides discovery and
non-streaming chat requests. Responses are byte-bounded, time-bounded, and
fail closed. Reasoning-output truncation is explicitly reported.

## Still required before activating Strata in Pixel Pals

1. **Integration:** Add an approved, native `strata-server` engine choice to
   the existing Pal conversation, General Chat, and server-side `askPals`
   routing. Use **only** server-stored credentials and validated address.
2. **Local-Only policy:** Extend `local-only.ts` and
   `ai/guard.server.ts` to admit only the exact configured local Strata
   address with strict provider identity and no cloud fallback. Keep Ollama
   available as an explicit owner-selected fallback, never silent cross-model
   context leakage. Cover all direct calls and bot/background workers.
3. **Memory and data:** Audit Memory Keeper and embeddings independently.
   Strata chat-completions do not imply compatible Ollama
   `/api/embed`, `/api/pull`, or VRAM/model-management APIs.
4. **Owner controls:** Authenticated model discovery, connection status,
   chosen and actual responder, clear errors when gaming PC sleeps, timeouts,
   concurrency safeguards and manual fallback. No model pull/delete or MCP
   tool-use permissions are implied.
5. **Acceptance:** CI and browser smoke, security/SSRF tests, streaming and
   mid-turn interruption, representative output-token budgets, independent
   architecture/QA review, staging with a fake model and then a live
   Tailscale check from the **actual app container namespace**.
6. **Deployment:** A separate owner-approved backup-first change window,
   tested revert to Ollama, no changes to existing appdata, Caddy, ports,
   secrets or permissions without explicit approval.

Related: [Strata integration issue #30](https://github.com/nyteghost/buddy-bot-room/issues/30),
[ADHD Assistant migration issue](https://github.com/nyteghost/adhd-assistant/issues/23),
[ADHD Strata source-only draft](https://github.com/nyteghost/adhd-assistant/pull/24).
