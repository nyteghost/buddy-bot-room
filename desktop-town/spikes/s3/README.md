# S3 — local AI / gaming inference spike (INCOMPLETE)

Scope: isolated benchmark only; no production integration, no installation or service changes.

## Inspected source
- Immutable baseline beta: `099f0698bddc494a5cdfd819f0d32944a766e341`.
- PR #43 accepted snapshot: `c541af26ed0169fd3ea18ad4dea70208cdf6d88b`, `src/lib/strata.server.ts`. Existing adapter is TypeScript, OpenAI-compatible, private IPv4/Tailscale only, bounded to 2 active and 4 queued requests, includes abort-aware streaming transport. Its `strataChat` helper itself requests nonstreaming JSON; the separate `strataSdkFetch` supports streaming. Do not port to Rust without evidence.
- PR #44 Stage 4A integrates the Strata foundation, but does not establish production Pal streaming/voice routing.
- PR #43 observed Strata model: `qwen3.8-flash-next-coder-iq1_m` (coder-oriented, heavily quantized; conversational quality unverified).

## Run (explicit, opt-in)
`python3 -m unittest discover -s desktop-town/spikes/s3 -p 'test_*.py' -v`

`python3 desktop-town/spikes/s3/benchmark.py --model MODEL_ID --base http://127.0.0.1:1234/v1 --runs 20 --output s3-local-results.json`

Only literal loopback is permitted by default. Private IPv4/Tailscale targets require `--allow-remote`; public addresses and DNS names are rejected even with that flag. Set `S3_API_KEY` in environment for bearer authentication; never commit it. Output contains timing and model metadata, never conversations or secrets. The harness does not load/unload models.

## Model matrix — candidates, NOT measured
| Candidate | Intended use | GPU fit / quality |
|---|---|---|
| Existing Strata `qwen3.8-flash-next-coder-iq1_m` | Existing coder baseline | Fit, conversational quality, context and latency require hardware test |
| Qwen3 4B Instruct or comparable chat-tuned 4B Q4 | Natural Pal conversation | Candidate for 10 GB GPU, but actual memory and TTFT unverified |
| Small CPU quantized instruct model | Emergency user-initiated chat | Throughput and gaming CPU contention unverified |

Model names/quantization must be confirmed against installed server catalogs and licenses before selection.

## Proposed policies (not implemented)
- Normal: at most 2 active user requests, at most 4 queued, explicit cancellation and timeout.
- Gaming: at most 1 active user request, no autonomous/background inference; prioritize game VRAM headroom and voice push-to-talk.
- Paused: no background inference and no new generation until explicitly resumed.
- Offline/unavailable: keep simulation running, show local AI unavailable, no network fallback. Remote inference is separate opt-in configuration, never implicit.
- On cancellation, abort transport AND verify server-side generation has stopped using server metrics or logs; client abort alone is insufficient.

## Acceptance evidence still required
This harness measures basic streaming TTFT/chunk rate and failure. It does **not** yet implement a concurrency scheduler, cancellation acknowledgment timer, server-side generation-stop verification, simulated SSE integration tests, timeout recovery tests, GPU telemetry, FPS capture, CPU fallback or cold-start measurement. No RTX 3080 or game access is available in this execution environment. Do not claim the S3 gate passed.

Hardware QA: record `nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv` before/after each model; capture cold model-load time, 20 warm TTFTs, output tokens/s (not SSE chunks/s), 20 cancellation tests, interrupted-server recovery, game baseline and inference-on average/1%-low FPS over matched scenes, CPU/RAM and VRAM time series, OOM and process logs. Use the owner's approved benchmark game. Acceptance: warm TTFT p95 <=3s, cancel ACK <=500ms with generation stopped and slot freed, no OOM, average FPS loss <=3%, 1%-low loss <=5%. Independent QA must reproduce on hardware.

**Status:** PARTIAL / QA BLOCKED. No production modifications. No model or GPU policy approved yet.
