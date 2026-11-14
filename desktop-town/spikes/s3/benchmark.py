#!/usr/bin/env python3
"""Isolated S3 OpenAI-compatible SSE measurement; no provider discovery or fallback.

All sockets are nonblocking and deadline-driven; the stream never uses a buffered
socket reader. Cancellation is observed at most POLL_SECONDS after an idle read.
This is a client-side cancellation guarantee, not proof of server GPU cessation.
"""
import argparse
import errno
import ipaddress
import json
import math
import os
import select
import socket
import ssl
import threading
import time
import urllib.parse

POLL_SECONDS = 0.025
MAX_HEADERS = 32768
MAX_SSE_EVENT = 65536
MAX_WIRE_CHUNK = 1048576
POLICIES = {"normal": (2, 4, True), "gaming": (1, 1, False), "paused": (0, 0, False)}
RFC1918 = tuple(ipaddress.ip_network(net) for net in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
CGNAT = ipaddress.ip_network("100.64.0.0/10")
LOCALHOST = ipaddress.ip_address("127.0.0.1")


class Cancelled(Exception):
    """Client cancellation acknowledged; not proof the provider stopped work."""


class ProviderError(Exception):
    """Provider HTTP, protocol, or malformed-stream failure."""


class TransportError(Exception):
    """Network-level disconnect/reset/connect failure."""


def endpoint(base, allow_remote=False):
    """Return explicit literal IPv4 URL; no DNS, special-use IPs or cloud fallback."""
    try:
        u = urllib.parse.urlsplit(base)
        port = u.port  # Force validation, including zero and >65535.
    except ValueError as exc:
        raise ValueError("Invalid endpoint or port") from exc
    if (u.scheme not in ("http", "https") or not u.hostname or
            u.username is not None or u.password is not None or
            u.query or u.fragment or u.path not in ("", "/", "/v1", "/v1/") or
            (port is not None and not 1 <= port <= 65535) or
            (u.netloc.endswith(":") or "\\" in base)):
        raise ValueError("Invalid endpoint")
    try:
        ip = ipaddress.ip_address(u.hostname)
    except ValueError as exc:
        raise ValueError("Literal IPv4 endpoint required; DNS disabled") from exc
    if ip.version != 4:
        raise ValueError("IPv6 not enabled for this isolated probe")
    if ip == LOCALHOST:
        return u
    if (not allow_remote or ip.is_unspecified or ip.is_multicast or
            ip.is_link_local or ip.is_reserved or
            not (any(ip in net for net in RFC1918) or ip in CGNAT)):
        raise ValueError("Remote address must be a consented RFC1918/CGNAT literal")
    return u


class Governor:
    """Policy-bound admission, including atomic validation after queue wakeup.

    On Gaming: cancel *active autonomous* requests, which retain a slot until
    their transports unwind; reject queued autonomous work. On Paused: signal
    cancellation to *all* active work, reject all queued/new work. The governor
    cannot force a noncooperative caller to stop; stream() cooperates.
    """
    def __init__(self, mode="normal"):
        if mode not in POLICIES:
            raise ValueError("Unknown mode")
        self.mode = mode
        self.active = 0
        self.waiting = 0
        self.lock = threading.Condition()
        self._jobs = {}
        self._sequence = 0

    def set_mode(self, mode):
        if mode not in POLICIES:
            raise ValueError("Unknown mode")
        with self.lock:
            self.mode = mode
            for background, cancel in self._jobs.values():
                if mode == "paused" or (mode == "gaming" and background):
                    cancel.set()
            self.lock.notify_all()

    def _permitted(self, background):
        limit, _, background_allowed = POLICIES[self.mode]
        return limit > 0 and (not background or background_allowed)

    def acquire(self, cancel=None, timeout=5, background=False):
        deadline = time.monotonic() + timeout
        cancel = cancel if cancel is not None else threading.Event()
        with self.lock:
            if cancel.is_set():
                raise Cancelled()
            if not self._permitted(background):
                raise ProviderError("Policy rejects inference")
            queued = False
            try:
                while True:
                    if cancel.is_set():
                        raise Cancelled()
                    # Critical: check policy with the lock held immediately before
                    # *every* admission, including when a queued request awakens.
                    if not self._permitted(background):
                        raise ProviderError("Mode changed; inference not permitted")
                    limit, max_waiting, _ = POLICIES[self.mode]
                    if self.active < limit:
                        self._sequence += 1
                        token = self._sequence
                        self._jobs[token] = (background, cancel)
                        self.active += 1
                        break
                    if not queued:
                        if self.waiting >= max_waiting:
                            raise ProviderError("Queue full")
                        self.waiting += 1
                        queued = True
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise TimeoutError("Admission deadline exceeded")
                    self.lock.wait(min(POLL_SECONDS, remaining))
            finally:
                if queued:
                    self.waiting -= 1
            released = False

            def release():
                nonlocal released
                with self.lock:
                    if released:
                        raise RuntimeError("Duplicate release")
                    released = True
                    self._jobs.pop(token)
                    self.active -= 1
                    self.lock.notify_all()
            release.cancel_event = cancel
            return release


def percentile(values, p):
    if not values:
        return None
    v = sorted(values)
    return v[max(0, min(len(v) - 1, math.ceil(p * len(v)) - 1))]


class DeadlineIO:
    """Nonblocking TCP/TLS transport, bounded select waits and monotonic deadline."""
    def __init__(self, u, deadline, cancel):
        self.u = u
        self.deadline = deadline
        self.cancel = cancel
        self.sock = None

    def _wait(self, want_read=False, want_write=False):
        if self.cancel.is_set():
            raise Cancelled()
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Overall request deadline exceeded")
        try:
            readable, writable, _ = select.select(
                [self.sock] if want_read else [],
                [self.sock] if want_write else [], [],
                min(POLL_SECONDS, remaining))
        except OSError as exc:
            raise TransportError("Poll failure") from exc
        if self.cancel.is_set():
            raise Cancelled()
        if time.monotonic() >= self.deadline:
            raise TimeoutError("Overall request deadline exceeded")
        return bool(readable or writable)

    def connect(self):
        host = self.u.hostname
        port = self.u.port or (443 if self.u.scheme == "https" else 80)
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.setblocking(False)
            result = self.sock.connect_ex((host, port))
            if result not in (0, errno.EINPROGRESS, errno.EALREADY, errno.EWOULDBLOCK):
                raise TransportError("TCP connect failed: " + str(result))
            if result:
                while True:
                    if self._wait(want_write=True):
                        status = self.sock.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                        if status:
                            raise TransportError("TCP connect failed: " + str(status))
                        break
            if self.u.scheme == "https":
                try:
                    self.sock = ssl.create_default_context().wrap_socket(
                        self.sock, server_hostname=host, do_handshake_on_connect=False)
                    self.sock.setblocking(False)
                    while True:
                        try:
                            self.sock.do_handshake()
                            break
                        except ssl.SSLWantReadError:
                            self._wait(want_read=True)
                        except ssl.SSLWantWriteError:
                            self._wait(want_write=True)
                except ssl.SSLError as exc:
                    raise TransportError("TLS handshake failed") from exc
        except OSError as exc:
            raise TransportError("Connect failed") from exc

    def sendall(self, data):
        data = memoryview(data)
        while data:
            if not self._wait(want_write=True):
                continue
            try:
                sent = self.sock.send(data)
            except (BlockingIOError, ssl.SSLWantWriteError):
                continue
            except ssl.SSLWantReadError:
                self._wait(want_read=True)
                continue
            except OSError as exc:
                raise TransportError("Write failed") from exc
            if not sent:
                raise TransportError("Write disconnected")
            data = data[sent:]

    def recv(self):
        while True:
            if not self._wait(want_read=True):
                continue
            try:
                return self.sock.recv(4096)
            except (BlockingIOError, ssl.SSLWantReadError):
                continue
            except ssl.SSLWantWriteError:
                self._wait(want_write=True)
            except OSError as exc:
                raise TransportError("Read failed") from exc

    def close(self):
        if self.sock is not None:
            self.sock.close()
            self.sock = None


class HTTPBody:
    """Incremental HTTP/1.1 response framing; no redirects or content decoding."""
    def __init__(self):
        self.buffer = bytearray()
        self.headers = None
        self.chunked = False
        self.chunk_left = None
        self.content_left = None
        self.done = False

    def feed(self, data):
        if self.done:
            if data:
                raise ProviderError("Unexpected bytes after HTTP body")
            return b""
        self.buffer.extend(data)
        if self.headers is None:
            marker = self.buffer.find(b"\r\n\r\n")
            if marker < 0:
                if len(self.buffer) > MAX_HEADERS:
                    raise ProviderError("Oversized HTTP headers")
                return b""
            if marker > MAX_HEADERS:
                raise ProviderError("Oversized HTTP headers")
            block = bytes(self.buffer[:marker])
            del self.buffer[:marker + 4]
            try:
                lines = block.decode("latin-1").split("\r\n")
                proto, status, *_ = lines[0].split(" ", 2)
                if proto not in ("HTTP/1.1", "HTTP/1.0"):
                    raise ValueError("HTTP version")
                status = int(status)
                headers = {}
                for line in lines[1:]:
                    k, sep, v = line.partition(":")
                    if not sep or not k:
                        raise ValueError("Bad header")
                    k = k.lower()
                    if k in headers and k in ("content-length", "transfer-encoding"):
                        raise ValueError("Ambiguous body framing")
                    headers[k] = v.strip().lower()
            except (ValueError, IndexError) as exc:
                raise ProviderError("Malformed HTTP response") from exc
            if status != 200:
                raise ProviderError("Provider HTTP " + str(status))
            if "text/event-stream" not in headers.get("content-type", ""):
                raise ProviderError("Expected SSE response")
            self.headers = headers
            framing = headers.get("transfer-encoding", "")
            if framing:
                if framing != "chunked" or "content-length" in headers:
                    raise ProviderError("Unsupported HTTP framing")
                self.chunked = True
            elif "content-length" in headers:
                try:
                    self.content_left = int(headers["content-length"])
                    if self.content_left < 0:
                        raise ValueError()
                except ValueError as exc:
                    raise ProviderError("Invalid Content-Length") from exc
        if self.chunked:
            return self._chunks()
        if self.content_left is None:
            result = bytes(self.buffer)
            self.buffer.clear()
            return result
        count = min(self.content_left, len(self.buffer))
        result = bytes(self.buffer[:count])
        del self.buffer[:count]
        self.content_left -= count
        if self.content_left == 0:
            self.done = True
        return result

    def _chunks(self):
        out = bytearray()
        while True:
            if self.chunk_left is None:
                pos = self.buffer.find(b"\r\n")
                if pos < 0:
                    if len(self.buffer) > 128:
                        raise ProviderError("Oversized chunk header")
                    break
                if pos > 128:
                    raise ProviderError("Oversized chunk header")
                line = bytes(self.buffer[:pos]).split(b";", 1)[0]
                del self.buffer[:pos + 2]
                try:
                    self.chunk_left = int(line, 16)
                    if not (0 <= self.chunk_left <= MAX_WIRE_CHUNK):
                        raise ValueError()
                except ValueError as exc:
                    raise ProviderError("Invalid HTTP chunk size") from exc
                if self.chunk_left == 0:
                    # SSE [DONE] is required independently; trailers are ignored.
                    self.done = True
                    self.buffer.clear()
                    break
            if len(self.buffer) < self.chunk_left + 2:
                break
            if self.buffer[self.chunk_left:self.chunk_left + 2] != b"\r\n":
                raise ProviderError("Invalid HTTP chunk terminator")
            out.extend(self.buffer[:self.chunk_left])
            del self.buffer[:self.chunk_left + 2]
            self.chunk_left = None
        return bytes(out)


class SSEEvents:
    """Incremental UTF-8 event parser; bounded lines/events and strict JSON payloads."""
    def __init__(self):
        self.buffer = bytearray()
        self.fields = []
        self.size = 0

    def feed(self, data):
        self.buffer.extend(data)
        if len(self.buffer) + self.size > MAX_SSE_EVENT:
            raise ProviderError("Oversized SSE event")
        events = []
        while True:
            idx = self.buffer.find(b"\n")
            if idx < 0:
                break
            line = bytes(self.buffer[:idx])
            del self.buffer[:idx + 1]
            if line.endswith(b"\r"):
                line = line[:-1]
            if line == b"":
                if self.fields:
                    try:
                        payload = b"\n".join(self.fields).decode("utf-8", errors="strict")
                    except UnicodeDecodeError as exc:
                        raise ProviderError("Invalid SSE UTF-8") from exc
                    events.append(payload)
                self.fields.clear()
                self.size = 0
            elif line.startswith(b"data:"):
                part = line[5:]
                if part.startswith(b" "):
                    part = part[1:]
                self.fields.append(part)
                self.size += len(part)
            # SSE comments, event:, id:, retry: are valid and ignored.
        return events


def stream(base, model, prompt, timeout=30, allow_remote=False, key="",
           on_token=None, cancel=None, governor=None, background=False):
    u = endpoint(base, allow_remote)
    if (not model or len(model) > 160 or not all(c.isalnum() or c in "._:/@+-" for c in model)):
        raise ValueError("Invalid model")
    if not .5 <= timeout <= 120:
        raise ValueError("Invalid timeout")
    cancel = cancel if cancel is not None else threading.Event()
    start = time.monotonic()
    deadline = start + timeout
    release = governor.acquire(cancel, max(0, deadline - start), background) if governor else None
    io = DeadlineIO(u, deadline, cancel)
    first = None
    chunks = 0
    usage = None
    done = False
    http = HTTPBody()
    sse = SSEEvents()
    try:
        if cancel.is_set():
            raise Cancelled()
        body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}],
                           "stream": True, "max_tokens": 128,
                           "stream_options": {"include_usage": True}}).encode("utf-8")
        host = u.hostname + (":" + str(u.port) if u.port else "")
        headers = ["POST /v1/chat/completions HTTP/1.1", "Host: " + host,
                   "Content-Type: application/json", "Accept: text/event-stream",
                   "Accept-Encoding: identity", "Connection: close",
                   "Content-Length: " + str(len(body))]
        if key:
            if "\r" in key or "\n" in key:
                raise ValueError("Invalid authentication token")
            headers.append("Authorization: Bearer " + key)
        io.connect()
        io.sendall(("\r\n".join(headers) + "\r\n\r\n").encode("ascii") + body)
        while not done:
            incoming = io.recv()
            if not incoming:
                raise TransportError("Provider disconnected before SSE [DONE]")
            for event in sse.feed(http.feed(incoming)):
                if cancel.is_set():
                    raise Cancelled()
                if event == "[DONE]":
                    done = True
                    break
                try:
                    obj = json.loads(event)
                    if not isinstance(obj, dict):
                        raise ValueError()
                    if isinstance(obj.get("usage"), dict) and type(obj["usage"].get("completion_tokens")) is int:
                        usage = obj["usage"]["completion_tokens"]
                    choices = obj.get("choices", [])
                    if not isinstance(choices, list):
                        raise ValueError()
                    for choice in choices:
                        if not isinstance(choice, dict):
                            raise ValueError()
                        delta = choice.get("delta") or {}
                        if not isinstance(delta, dict):
                            raise ValueError()
                        content = delta.get("content")
                        if content:
                            if not isinstance(content, str):
                                raise ValueError()
                            if first is None:
                                first = time.monotonic()
                            chunks += 1
                            if on_token:
                                on_token(content)
                except (json.JSONDecodeError, ValueError, TypeError) as exc:
                    raise ProviderError("Malformed SSE JSON event") from exc
        if cancel.is_set():
            raise Cancelled()
        if time.monotonic() > deadline:
            raise TimeoutError("Overall request deadline exceeded")
        end = time.monotonic()
        return {"ttft_ms": round((first - start) * 1000, 2) if first else None,
                "total_ms": round((end - start) * 1000, 2),
                "chunks": chunks, "completion_tokens": usage,
                "tokens_per_sec": round(usage / max(end - first, .001), 2)
                if first is not None and usage is not None else None}
    finally:
        io.close()  # A cancelled client always closes its own socket.
        if release:
            release()


def run_matrix(base, models, runs, timeout, allow_remote=False, key="", mode="normal"):
    endpoint(base, allow_remote)
    if mode == "paused":
        raise ValueError("Paused cannot benchmark")
    results = []
    for model in models:
        samples = []
        for _ in range(runs):
            try:
                samples.append(stream(base, model, "Reply briefly with a friendly greeting.",
                                      timeout, allow_remote, key, governor=Governor(mode)))
            except (Cancelled, ProviderError, TransportError, TimeoutError, OSError) as exc:
                samples.append({"error": type(exc).__name__})
        valid = [x for x in samples if x.get("ttft_ms") is not None]
        # The first *attempt* is the unconditioned trial. Do not turn later
        # successful requests into a fake warm sample by skipping failures.
        warm = samples[1:]
        successful_warm = [x["ttft_ms"] for x in warm if x.get("ttft_ms") is not None]
        results.append({"model": model,
                        "first_request_ttft_ms_not_cold_load": samples[0].get("ttft_ms") if samples else None,
                        "warm_ttft_p95_ms": percentile(successful_warm, .95),
                        "warm_valid": len(successful_warm), "warm_attempted": len(warm),
                        "successful": len(valid), "attempted": runs, "samples": samples,
                        "cold_model_load_ms": None, "vram_mib": None,
                        "fps_avg": None, "fps_1pct_low": None})
    return {"results": results, "hardware_acceptance": "NOT_TESTED",
            "note": "First request is not a verified cold load; require all 20 valid warm samples for acceptance."}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://127.0.0.1:1234/v1")
    p.add_argument("--model", action="append", required=True)
    p.add_argument("--runs", type=int, default=21)
    p.add_argument("--timeout", type=float, default=30)
    p.add_argument("--mode", choices=POLICIES, default="normal")
    p.add_argument("--allow-remote", action="store_true")
    p.add_argument("--output")
    a = p.parse_args()
    if not 2 <= a.runs <= 100 or not .5 <= a.timeout <= 120:
        p.error("Runs must be 2..100 and timeout 0.5..120 seconds")
    output = json.dumps(run_matrix(a.base, a.model, a.runs, a.timeout,
                                   a.allow_remote, os.environ.get("S3_API_KEY", ""), a.mode), indent=2)
    if a.output:
        with open(a.output, "x", encoding="utf-8") as f:
            f.write(output + "\n")
    print(output)


if __name__ == "__main__":
    main()
