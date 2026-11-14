# S3 — Local AI / Gaming Performance Spike

**Status:** deterministic simulation tests pass locally; hardware and provider-side cancellation acceptance BLOCKED. No production changes.

## Source review
- Base: `099f0698bddc494a5cdfd819f0d32944a766e341`.
- PR #43 accepted snapshot `c541af26ed0169fd3ea18ad4dea70208cdf6d88b`, `src/lib/strata.server.ts`: private IPv4/Tailscale endpoint validation, OpenAI-compatible chat, 2 active + 4 queued requests, abort-aware streaming `strataSdkFetch`. `strataChat` is nonstreaming. No Rust rewrite justified.
- PR #44 contains the Stage 4A source integration, not evidence of production voice/chat routing.
- Previously observed Strata model `qwen3.8-flash-next-coder-iq1_m` is a coder-oriented baseline, not a validated conversational model.

## Reproduce tests
```sh
python3 -m unittest discover -s desktop-town/spikes/s3 -p 'test_*.py' -v
```
Ten deterministic tests: SSE parsing, TTFT, completion usage, explicit network consent, no fallback, timeout and recovery, provider error and recovery, cancellation/slot release, queue cancellation, concurrency and policies, model matrix, percentile. Simulated server validates transport and slot release, **not provider-side generation cessation**. The implementation has no cloud fallback, no service discovery and no secrets logging.

## Owner-run model comparison (do not run against production without permission)
Use an explicitly configured, isolated OpenAI-compatible inference service. Local loopback is the default. To benchmark a different private IPv4/Tailscale machine, explicitly supply `--allow-remote` and `--base`. No DNS names or public endpoints are accepted. Set `S3_API_KEY` in the environment if needed; never commit credentials.

```sh
python3 desktop-town/spikes/s3/benchmark.py --base http://127.0.0.1:1234/v1 --model MODEL_A --model MODEL_B --runs 21 --output s3-results.json
```
21 runs = first request plus 20 subsequent warm requests. The first request is **not** a verified cold model load. Output has TTFT p95, SSE chunk count and real output tokens/sec only if server reports `usage.completion_tokens`. Unsupported metrics remain null, not estimated.

## Model comparison matrix (not measured)
| Candidate | Purpose | Caveat |
|---|---|---|
| Existing Strata `qwen3.8-flash-next-coder-iq1_m` | Existing coder baseline | Conversational quality and GPU footprint unverified |
| Installed chat-tuned ~4B Q4 instruct model | Primary natural Pal chat candidate | Confirm exact model/license and RTX 3080 VRAM headroom |
| Installed small quantized CPU instruct model | Optional local CPU-only fallback | Measure latency, RAM and gaming CPU contention; never switch silently |

For each candidate, evaluate 20 fixed Pal-personality prompts with human-scored consistency, coherence, tone, safety and memory-boundary adherence. Keep prompt set private and constant across models.

## Resource policy proposal — NOT integrated into Pixel Pals
| Mode | Active | Queued | Autonomous requests | Behavior |
|---|---:|---:|---|---|
| Normal | 2 | 4 | Allowed | Explicit user chat prioritized |
| Gaming | 1 | 1 | Disabled | User-initiated chat only, avoid GPU model loading while game needs VRAM |
| Paused | 0 | 0 | Disabled | Reject new inference, keep desktop town running |

The isolated `Governor` enforces these admission limits; mode changes do not forcibly cancel existing running requests. Production integration must add explicit cancellation and policy transition semantics. No automatic cloud fallback or silent CPU/provider switching; owner consent required for each configured remote endpoint. Offline Pal movement/simulation must continue even if AI is down.

## Hardware acceptance protocol
1. Verify hardware with `nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv`; record driver, OS, server version, quantization, context length and loaded-model state.
2. Use an isolated service and document model unload/reload commands supported by that service. Measure true cold model load time separately; run 21 completions per candidate for 20 warm TTFT samples.
3. Sample GPU VRAM/utilization, CPU and RSS at 1-second intervals; log GPU OOM or driver errors. Repeat with CPU-only inference explicitly configured, capturing CPU saturation and RAM.
4. Issue 20 cancellations during active generation; measure client acknowledgment (target <=500ms). Confirm via **provider logs/metrics** that generation stops, KV cache or worker is released, and a fresh request immediately acquires the freed slot. Client socket close alone is insufficient.
5. Choose one reproducible game scene with owner approval; collect at least three matched 5-minute baseline runs and three inference-on runs. Capture frame times with a game-compatible profiler (e.g. MangoHud on Linux or PresentMon on Windows). Compare average FPS and 1% low FPS with identical settings, route, resolution and background load. Targets: average FPS loss <=3%, 1%-low loss <=5%.
6. Verify fullscreen game, voice push-to-talk if enabled, remote opt-in, unavailable provider, timeout, interrupted stream and recovery; repeat after model unload. Do not transmit conversations to remote endpoints without explicit opt-in.

## Evidence and blockers
Local deterministic tests were run in an isolated Python environment: **10 passed**. GitHub exact-head CI has not been independently confirmed. No RTX 3080 access, no verified true cold-start, no measured GPU memory, no game FPS data, no server-side cancellation confirmation, no voice benchmark, no CPU-only model measurements. **S3 is not accepted for release.** Independent AI/Gaming QA must reproduce on target hardware. All changes confined to `desktop-town/spikes/s3/**`.
