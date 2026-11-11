# Strata on CachyOS — Pixel Pals native local AI routing

**Status: Draft PR #43, source implemented; NOT merged, deployed, or activated on live Unraid.**
This branch adds an explicit protected `strata-server` option to Pal conversations,
General Chat and the existing read-only Working Pals/`askPals` path. Existing
Ollama/cloud defaults are unchanged. There is no implicit provider migration.

## Verified prerequisites, without disclosing private credentials

The owner previously verified from Unraid over a private Tailscale route:
authenticated `GET /v1/models` and `POST /v1/chat/completions` worked on the
CachyOS Strata service, which listed `qwen3.8-flash-next-coder-iq1_m`.
This confirms inference connectivity, not a full deployed Pixel Pals streaming
and concurrency acceptance. No bearer key or private endpoint is committed.

## Owner-only setup (requires a **separate** rollout approval)

In owner Settings → Basics → Strata, set:

- `STRATA_ENABLED=on` — disabled by default, required for any Strata call.
- `STRATA_URL` — literal private LAN/Tailscale IPv4, port, optional `/v1`.
  Public addresses, DNS, embedded usernames, query strings, arbitrary paths,
  and redirects fail closed. This setting must not include a bearer token.
- `STRATA_API_KEY` — secret. Stored in protected server secrets, never sent
  to browser clients or exposed through setup/model diagnostics.
- `STRATA_MODEL` — exact loaded ID from authenticated model discovery.
- `STRATA_FALLBACK=off` by default. `ollama` opt-in allows local-only Ollama
  fallback in General Chat and approved unattended task summaries. **Never
  cloud**. Pal conversation Strata-only failure remains visible and retryable
  rather than silently falling back to cloud; choose Ollama explicitly.

Use the owner-only **Test** action to validate a private authenticated
`/v1/models` request and exact model presence. The UI never accepts a
request-supplied API key or base URL for native Strata. Models are selected
from the **server** config, ignoring injected browser `engine.model`.

To use Strata after a separately authorized rollout:
1. Select **Strata (gaming PC)** in the Pal Room AI engine dialog to opt into
   Strata-only Pal responses.
2. In General Chat, choose **Private Strata** explicitly; Auto also chooses
   Strata when the saved overall engine choice is Strata.
3. Approved read-only Working Pals and unattended `askPals` use Strata
   **only when the owner's saved engine selection is Strata**, and still honor
   existing review/approval, memory/identity, tool and source restrictions.
   If Strata is not available and no owner-enabled Ollama fallback exists,
   the work is marked unavailable; jobs are not rerouted to cloud providers.

## Server-side safeguards

- Local-Only guard admits `strata-server` **only at exactly the configured,
  validated private origin and canonical `/v1` path**. All other cloud/custom
  providers remain forbidden when Local-Only is enabled.
- Strata transport uses the protected server bearer and *only*
  `/v1/models` and `/v1/chat/completions`. Redirects disabled.
- Maximum 2 in-flight local Strata API operations and 4 queued, with bounded
  queue wait; slots stay held until body/stream consumption, cancellation or
  error. SDK streaming and non-streaming replies use the same guarded fetch.
- Server-side timeout/abort and response-size caps; canceled streams and
  sleeping-PC failures return safe status/error text and never expose the key.
- Provider/model are labeled for actual routed responses; model discovery
  checks the configured ID. Reasoning models receive an adequate output-token
  budget. Non-streaming results with `finish_reason=length` are explicitly
  marked as potentially truncated; **stream-completion truncation UX still
  needs end-to-end mounted-client QA**.
- No autonomous AI tool invocation, file/database writes, mail, imports,
  memory-permission escalation, or secret-sharing is introduced by routing.
  Previously authorized conversation scopes remain authoritative.

## Capability audit and explicit non-routes

- **Memory Keeper text generation** still uses native Ollama `/api/generate`
  and its own `MEMORY_KEEPER_MODEL`. It is NOT migrated to Strata by this PR.
- **Embeddings** still use the optional Ollama `/api/embed`, with existing
  keyword-retrieval fallback where embeddings are unavailable. A Strata
  `/v1/chat/completions` endpoint is **not** an embedding endpoint.
- Ollama model pull, keep-alive, RAM/VRAM management and `/api/tags` paths
  remain Ollama-specific. Do not substitute the Strata URL for `OLLAMA_URL`.
- Discord Companion still explicitly requests Ollama and is outside this
  assignment; General Chat and owner-approved Working Pals are covered.
- The separate ADHD Assistant migration is in its own PR/repo and is not
  changed by Pixel Pals PR #43.

## Verification and rollout gates

The branch includes fake API contract/regression tests for strict URL/key
handling, client injection, model matching, 401/404/429, offline service,
aborted streams, streamed Pal chat, Local-Only and no-cloud behavior.
CI must verify TypeScript, full tests, production build, and existing-app
smoke. **Existing smoke is not a live Strata regression test**.
A separate owner-approved deploy requires: provider/auth test from the real
Pixel Pals container namespace, real Strata streamed chat and aborted turn,
long answer/truncation check, concurrent throughput, browser/phone QA,
then an explicitly reversible switch with Ollama retained as a safe option.

**Never merge, deploy, edit Unraid appdata, Caddy/Tailscale, ports, credentials,
or production data as part of this implementation.**

Tracking: [PR #43](https://github.com/nyteghost/buddy-bot-room/pull/43),
[Issue #30](https://github.com/nyteghost/buddy-bot-room/issues/30).
