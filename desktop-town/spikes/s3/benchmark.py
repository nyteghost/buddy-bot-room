#!/usr/bin/env python3
"""S3 isolated OpenAI-compatible streaming benchmark. Python stdlib only.
No automatic network discovery or fallback. Explicit --allow-remote required for non-loopback.
Never logs prompt text or credentials. Does not install or alter inference services.
"""
import argparse
import json
import os
import statistics
import time
import urllib.parse
import http.client
import ipaddress

def endpoint(base, allow_remote=False):
    u = urllib.parse.urlsplit(base)
    if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password or u.query or u.fragment or u.path.rstrip("/") not in ("", "/v1"):
        raise ValueError("Invalid endpoint")
    ip = ipaddress.ip_address(u.hostname)
    if not (ip.is_loopback or (allow_remote and (ip.is_private or ip in ipaddress.ip_network("100.64.0.0/10")))):
        raise ValueError("Remote endpoint requires --allow-remote and a literal private IP")
    return u

def stream(base, model, prompt, timeout=30, allow_remote=False, key="", on_token=None):
    u = endpoint(base, allow_remote)
    port = u.port or (443 if u.scheme == "https" else 80)
    conn = (http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection)(u.hostname, port, timeout=timeout)
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}], "stream": True, "max_tokens": 128})
    start = time.monotonic()
    first = None
    tokens = 0
    done = False
    try:
        conn.request("POST", "/v1/chat/completions", body, {"Content-Type": "application/json", "Accept": "text/event-stream", **({"Authorization": "Bearer " + key} if key else {})})
        res = conn.getresponse()
        if res.status != 200:
            raise RuntimeError("Provider HTTP " + str(res.status))
        if "text/event-stream" not in res.getheader("content-type", ""):
            raise RuntimeError("Expected SSE")
        while True:
            line = res.readline(65537)
            if len(line) > 65536:
                raise RuntimeError("Oversized SSE line")
            if not line:
                break
            if not line.startswith(b"data:"):
                continue
            data = line[5:].strip()
            if data == b"[DONE]":
                done = True
                break
            obj = json.loads(data)
            for choice in obj.get("choices", []):
                delta = choice.get("delta", {}).get("content")
                if delta:
                    if first is None:
                        first = time.monotonic()
                    tokens += 1
                    if on_token:
                        on_token(delta)
        if not done:
            raise RuntimeError("Interrupted stream")
        end = time.monotonic()
        return {"ttft_ms": round((first - start) * 1000, 2) if first else None,
                "total_ms": round((end - start) * 1000, 2),
                "chunks": tokens, "chunks_per_sec": round(tokens / max(end - (first or start), .001), 2)}
    finally:
        conn.close()

def percentile(values, p):
    ordered = sorted(values)
    return ordered[max(0, min(len(ordered)-1, int(__import__("math").ceil(p * len(ordered))) - 1))]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:1234/v1")
    parser.add_argument("--model", required=True)
    parser.add_argument("--runs", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--allow-remote", action="store_true")
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    if not 1 <= args.runs <= 100 or not 0.5 <= args.timeout <= 120:
        parser.error("Invalid runs or timeout")
    endpoint(args.base, args.allow_remote)
    results = []
    for _ in range(args.runs):
        try:
            results.append(stream(args.base, args.model, "Reply briefly with a friendly greeting.", args.timeout, args.allow_remote, os.environ.get("S3_API_KEY", "")))
        except Exception as exc:
            results.append({"error": type(exc).__name__})
    good = [r["ttft_ms"] for r in results if r.get("ttft_ms") is not None]
    report = {"model": args.model, "runs": args.runs, "success": len(good),
              "warm_ttft_p95_ms": percentile(good[1:] or good, .95) if good else None,
              "measurements": results, "hardware": "UNVERIFIED", "gaming_fps": "NOT_MEASURED",
              "vram_mib": "NOT_MEASURED", "cold_start_ms": "NOT_MEASURED"}
    output = json.dumps(report, indent=2)
    if args.output:
        with open(args.output, "x", encoding="utf8") as f:
            f.write(output + "\n")
    print(output)

if __name__ == "__main__":
    main()
