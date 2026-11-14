# S3 — Local AI streaming / gaming policy spike

**Phase-0 only. Independent QA re-review required. No merge, deployment, production Strata/Unraid modification, credentials or services changed.** Implementation and tests are restricted to `desktop-town/spikes/s3/**`.

## Scope and existing boundaries

- Base: `099f0698bddc494a5cdfd819f0d32944a766e341`. Review `PP-DT-001` through `PP-DT-005` and `PP-DT-QA-001` in [Issue #37](https://github.com/nyteghost/buddy-bot-room/issues/37).
- PR #43 accepted source snapshot: `c541af26ed0169fd3ea18ad4dea70208cdf6d88b`, `src/lib/strata.server.ts`. Existing TypeScript Strata adapter has private-IP/Tailscale checks, authorization and bounded concurrency. `strataChat` requests nonstreaming JSON; `strataSdkFetch` supports abort-aware streaming. Do **not** port it to Rust absent a separate justified decision. This benchmark is not wired into production Strata.
- HTTP transport is explicit, local-only by default, and **never** performs DNS discovery, HTTP redirection, proxy delegation, cloud fallback, silent model substitution, or provider retry. A private IPv4/Tailscale endpoint is only reachable if the owner deliberately supplies a literal IPv4 `--base` with `--allow-remote`. Accepted remote ranges are RFC1918 (`10/8`, `172.16/12`, `192.168/16`) and CGNAT/Tailscale (`100.64/10`). All others, including IPv6, unspecified, link-local, documentation, benchmark, reserved, multicast and public IPs are rejected. For maximal control, use loopback `127.0.0.1`. Prefer HTTPS and an explicitly consented endpoint for remote private hosts. No DNS names. Port must be 1–65535.
- Credentials: optionally set `S3_API_KEY` in the process environment; never commit it. Prompts and responses are not written to benchmark output. This program does not install, load, unload, or restart model services.

## Corrections for independent QA

| Finding | Isolated correction | Deterministic evidence |
|---|---|---|
| **F1** delayed headers, poisoned buffered reads and slow cancellation | Nonblocking TCP/TLS, 25 ms bounded poll waits, monotonic end-to-end deadline, bounded incremental HTTP header/transfer framing and SSE event decoding; `Cancelled`, `TimeoutError`, `TransportError`, `ProviderError` classified separately; active socket closed in `finally` | Delayed headers/tokens, 1-byte fragments, malformed and oversized events, connection reset, full stall/byte trickle deadlines, cancellation during headers/body/generation, no CPU spin, slot cleanup |
| **F3** background queue admitted after Gaming transition | Admission checks mode, background eligibility and active limit under one condition lock immediately before acquiring; transition wakes all waiters | Synchronized QA race, queue saturation, queued cancel, success/failure accounting, Normal→Gaming and Gaming→Paused |
| **F4** special-use IPs accepted | Exact 127.0.0.1 loopback or consented RFC1918/CGNAT literal; no broad `is_private` allowlist, validated port and prohibited URL components | Explicit negative tests for `169.254.169.254`, `0.0.0.0`, `192.0.2.1`, `240.0.0.1`, multicast, public, reserved, IPv6, hostname, redirect and invalid ports |

Important lifecycle semantics: when **Normal → Gaming**, all already-active **autonomous** requests receive cancellation signals immediately and retain their governor slots until their client transports finish closing; queued autonomous requests are rejected. Existing explicitly user-requested chats may finish under the previous limit; new admissions obey Gaming's limit of one active slot. When **Gaming → Paused**, cancellation is signalled for **all active** requests and **all queued/new requests** are rejected. The standalone governor cannot force a noncooperating external inference process to stop; the `stream()` probe observes its cancellation token and closes its transport.

A client `Cancelled` acknowledgment and freed governor slot **do not prove provider-side GPU generation, KV-cache use, or server job execution have stopped**. Provider-specific abort semantics must be independently measured and correlated with request IDs/logs/metrics under approved hardware testing. No fake server test can waive this gate.

## Run reproducible tests

Python standard library, Python 3.10+ recommended, no production access required:

```sh
python3 -B -m unittest discover -s desktop-town/spikes/s3 -p 'test_*.py' -v
```

**Developer-executed local result on corrected source:** 35 tests passed, 0 failed (Linux container, Python 3.13). Execution time about 2.36 seconds; timing is test-suite wall time, **not** an inference latency measurement. Exact-head GitHub Actions S3 CI is not authorized/available; independent QA must re-run on the pinned SHA.

## Model comparison (owner-run, isolated service only)

```sh
python3 desktop-town/spikes/s3/benchmark.py \
  --base http://127.0.0.1:1234/v1 \
  --model FIRST_INSTALLED_MODEL --model SECOND_INSTALLED_MODEL \
  --runs 21 --timeout 30 --output s3-model-comparison.json
```

21 calls = one **unconditioned** first request plus 20 warm attempts. Each candidate's `warm_valid` **must equal 20**, not merely produce a p95 from a subset. Failed samples are retained as error class names; output includes warm TTFT p95, completed usage tokens/sec if provider reports them, and explicit `null` for unsupported cold-load, VRAM and FPS metrics. The first request is **not** a verified cold model load. Reproducibly unload the model before measuring actual load time separately and record server version, quantization and context length. Do not restart production services for benchmark convenience.

| Candidate | Reason to evaluate | Acceptance status |
|---|---|---|
| Existing Strata `qwen3.8-flash-next-coder-iq1_m` | Previously reported coder baseline | Unmeasured, personality quality unproven |
| Explicitly installed chat-tuned ~4B Q4 instruct | Proposed main Pal conversation engine | Unmeasured, exact model and license unconfirmed |
| Explicitly installed small CPU-only quantized instruct | User-approved offline GPU-free fallback | Unmeasured; no silent CPU switching or background loading |

Compare 20 identical role/personality samples for answer quality, memory-scope integrity, adherence to response constraints, and refusal quality, with scores recorded separately from speed.

## Proposed broker policies — isolated governor only

| Mode | Active | Queued | Autonomous | Transition semantics |
|---|---:|---:|---|---|
| Normal | 2 | 4 | Allowed | Both interactive and autonomous admission bounded |
| Gaming | 1 | 1 | No | Cancel active autonomous work; deny queued/new autonomous requests; permit explicit chat when a slot is available |
| User Paused | 0 | 0 | No | Cancel all active work, reject all queued/new inference, maintain town simulation |

Gaming mode also should suppress background embeddings, autonomous TTS/model preloads, and GPU-hungry workloads. It must expose an accessible manual toggle, and must not presume perfect fullscreen detection. Do not automatically redirect to any network/cloud or CPU provider. These policies need product security and hardware validation before integration.

## Gaming and RTX 3080 acceptance procedure

**Target GPU nominally RTX 3080 10 GB; verify with owner hardware.** Obtain permission for a private test inference endpoint, specific model files and test game. Do not affect the user's production Strata installation.

1. Record driver/OS, GPU model and VRAM total via `nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv`, context length, quantization, backend and process tree.
2. In an isolated nonproduction inference service, document supported model unload/load commands; collect true cold load separately; then run 21 calls per model and require 20/20 valid warm TTFTs. Acceptance: warm p95 **≤3 seconds**. Measure real output tokens/sec using usage metadata or provider token telemetry (SSE chunks are not tokens).
3. Run ≥20 cancellations per model after generation starts, plus delayed header and trickle faults. Timestamp user Stop, client cancellation acknowledgment and slot release (target **≤500 ms**). Correlate unique request identifiers with **provider-side** generation stopped, released KV cache and immediately available provider worker/GPU utilization; observe any generations continuing after the client socket closes. Do not mark this pass based on the fake server or client acknowledgment alone.
4. Capture one-second GPU VRAM/utilization, CPU utilization and RSS across model load, gaming idle, gaming chat and CPU-only fallback. Inspect OOM, GPU driver and inference backend logs; no OOM allowed. Exercise timeout/recovery and no-fallback negative cases.
5. Choose a repeatable game scene and record at least **three 5-minute matched baseline runs** and **three 5-minute inference-on runs**, same graphics settings, resolution, display configuration, route and background workload. Capture frame-time logs with a compatible tool such as MangoHud (Linux) or PresentMon (Windows), and separately record model GPU memory/process consumption. Compute average FPS from frames/time; compute 1%-low FPS from slowest 1% frame-time distribution, using the same method for both groups. Report variability and individual runs, not just a single favorable mean. Targets: **≤3% average-FPS reduction; ≤5% 1%-low-FPS reduction**. Compare Normal, Gaming and Paused without bypassing game security or anti-cheat.
6. Repeat with an explicitly configured small **CPU-only** model and with inference unavailable. Verify no surprise network requests, no mandatory Unraid dependency, no leaked memory/slots, and continuous town behavior. Profile local push-to-talk/STT/TTS separately before voice performance claims.

## Remaining gates

- Real provider cancellation: does HTTP/TCP abort stop generation immediately for *each inference backend*, release its worker and KV cache, and maintain GPU headroom? What are cancellation timing percentiles and behavior under concurrent requests? **Unknown; hardware/provider evidence required.**
- Real RTX 3080 cold/warm TTFT, VRAM headroom, CPU-only fallback throughput/quality, OOM and game average/1%-low FPS: **NOT MEASURED**.
- Independent regression/CI at exact corrected branch head and PM/QA G0 decision: **PENDING / G0 HOLD**.
- All production Strata, services, Unraid, credentials, builds and release branches: **UNCHANGED**.
