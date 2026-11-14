"""Adversarial deterministic loopback regression suite for S3 (no GPU needed)."""
import http.server
import json
import socket
import socketserver
import threading
import time
import unittest
from unittest.mock import patch

import benchmark as s3

TOKEN = b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'
USAGE = b'data: {"usage":{"completion_tokens":4},"choices":[]}\n\n'
DONE = b'data: [DONE]\n\n'


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_POST(self):
        self.server.requests += 1
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        mode = self.server.mode
        if mode == "header_delay":
            time.sleep(.22)
        if mode == "fail":
            self.send_response(503)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if mode == "redirect":
            self.send_response(302)
            self.send_header("Location", "https://example.com/v1")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if mode == "reset":
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "close")
        if mode == "chunked":
            self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        if mode == "stall":
            time.sleep(.9)
            return
        if mode == "header_delay":
            content = TOKEN + USAGE + DONE
        elif mode == "slow_token":
            time.sleep(.22)
            content = TOKEN + USAGE + DONE
        elif mode == "malformed":
            content = b'data: {this-is-not-json}\n\n' + DONE
        elif mode == "utf8_bad":
            content = b'data: \xff\n\n' + DONE
        elif mode == "truncated":
            content = TOKEN
        elif mode == "oversized":
            content = b'data: ' + b'x' * 65537 + b'\n\n'
        elif mode == "fragmented":
            content = b': ping\r\n' + TOKEN.replace(b'\n', b'\r\n') + DONE
        elif mode == "fragmented_bad":
            content = b'data: {invalid-json}\r\n\r\n' + DONE
        elif mode == "chunked":
            content = TOKEN + USAGE + DONE
        elif mode == "long":
            content = TOKEN * 100
        else:
            content = TOKEN * 2 + USAGE + DONE
        try:
            if mode in ("fragmented", "fragmented_bad"):
                for byte in content:
                    self.wfile.write(bytes([byte])); self.wfile.flush(); time.sleep(.0002)
            elif mode == "trickle":
                for byte in (TOKEN + DONE):
                    self.wfile.write(bytes([byte])); self.wfile.flush(); time.sleep(.03)
            elif mode == "long":
                for _ in range(120):
                    self.wfile.write(TOKEN); self.wfile.flush(); time.sleep(.02)
                self.wfile.write(DONE); self.wfile.flush()
            elif mode == "chunked":
                for fragment in [content[:7], content[7:17], content[17:]]:
                    self.wfile.write(("%x\r\n" % len(fragment)).encode() + fragment + b'\r\n')
                    self.wfile.flush()
                self.wfile.write(b'0\r\n\r\n'); self.wfile.flush()
            else:
                self.wfile.write(content); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            self.server.disconnected.set()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = Server(("127.0.0.1", 0), Handler)
        cls.server.mode = "ok"
        cls.server.requests = 0
        cls.server.disconnected = threading.Event()
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:%d/v1" % cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close()

    def tearDown(self):
        self.server.mode = "ok"

    def probe(self, mode, **kwargs):
        self.server.mode = mode
        return s3.stream(self.base, "chat-model", "hello", **kwargs)

    def test_01_endpoint_local_only(self):
        self.assertEqual(s3.endpoint("http://127.0.0.1/v1").hostname, "127.0.0.1")
        for url in ["http://localhost:1234/v1", "https://example.com/v1",
                    "http://192.168.1.2/v1", "file:///etc/passwd", "http://[::1]/v1",
                    "http://127.0.0.1/v1?x=1", "http://127.0.0.1/v1#abc",
                    "http://user:pass@127.0.0.1/v1", "http://127.0.0.1:0/v1",
                    "http://127.0.0.1:65536/v1", "http://127.0.0.1:/v1"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                s3.endpoint(url)

    def test_02_endpoint_remote_allowlist(self):
        for address in ["10.3.4.5", "172.20.2.1", "192.168.4.1", "100.100.1.2"]:
            url = "http://" + address + ":1234/v1"
            with self.assertRaises(ValueError):
                s3.endpoint(url)
            self.assertEqual(s3.endpoint(url, True).hostname, address)

    def test_03_reject_special_and_public_addresses(self):
        for address in ["169.254.169.254", "0.0.0.0", "192.0.2.1", "198.51.100.1",
                        "203.0.113.1", "240.0.0.1", "224.0.0.1", "255.255.255.255",
                        "8.8.8.8", "198.18.0.1", "127.0.0.2", "192.0.0.1", "100.63.0.1"]:
            with self.subTest(address=address), self.assertRaises(ValueError):
                s3.endpoint("http://" + address + ":1234/v1", True)

    def test_04_stream_ttft_and_usage(self):
        result = self.probe("ok")
        self.assertEqual((result["chunks"], result["completion_tokens"]), (2, 4))
        self.assertIsNotNone(result["ttft_ms"])
        self.assertIsNotNone(result["tokens_per_sec"])

    def test_05_delayed_headers_within_deadline(self):
        result = self.probe("header_delay", timeout=.6)
        self.assertGreater(result["ttft_ms"], 180)

    def test_06_delayed_first_token_within_deadline(self):
        result = self.probe("slow_token", timeout=.6)
        self.assertGreater(result["ttft_ms"], 180)

    def test_07_incremental_fragmentation_and_crlf(self):
        result = self.probe("fragmented", timeout=3)
        self.assertEqual(result["chunks"], 1)

    def test_08_chunked_http_transfer_encoding(self):
        self.assertEqual(self.probe("chunked")["completion_tokens"], 4)

    def test_09_malformed_sse_classification(self):
        with self.assertRaises(s3.ProviderError):
            self.probe("malformed")

    def test_10_bad_utf8_classification(self):
        with self.assertRaises(s3.ProviderError):
            self.probe("utf8_bad")

    def test_11_oversized_event_rejected(self):
        with self.assertRaises(s3.ProviderError):
            self.probe("oversized")

    def test_12_truncated_stream_error(self):
        with self.assertRaises(s3.TransportError):
            self.probe("truncated")

    def test_13_connection_reset_classified(self):
        with self.assertRaises(s3.TransportError):
            self.probe("reset")

    def test_14_failure_recovery(self):
        initial = self.server.requests
        with self.assertRaises(s3.ProviderError):
            self.probe("fail")
        self.assertEqual(self.server.requests, initial + 1)
        self.assertEqual(self.probe("ok")["chunks"], 2)

    def test_15_redirect_refused_no_fallback(self):
        with self.assertRaisesRegex(s3.ProviderError, "302"):
            self.probe("redirect")

    def test_16_stalled_stream_deadline_no_cpu_spin(self):
        wall = time.monotonic(); cpu = time.process_time()
        with self.assertRaises(TimeoutError):
            self.probe("stall", timeout=.5)
        elapsed = time.monotonic() - wall
        cpu_elapsed = time.process_time() - cpu
        self.assertLess(elapsed, .75)
        self.assertLess(cpu_elapsed, .18, "Stalled nonblocking reads must not spin")
        self.assertEqual(self.probe("ok")["chunks"], 2)

    def _cancel(self, mode, cancellation_delay=.06):
        self.server.mode = mode
        cancel = threading.Event()
        g = s3.Governor("gaming")
        errors = []
        def runner():
            try:
                s3.stream(self.base, "chat-model", "hello", timeout=3,
                          governor=g, cancel=cancel)
            except Exception as exc:
                errors.append(type(exc))
        thread = threading.Thread(target=runner, daemon=True)
        thread.start()
        time.sleep(cancellation_delay)
        start = time.monotonic()
        cancel.set()
        thread.join(.5)
        self.assertFalse(thread.is_alive(), "Transport cancellation failed to interrupt read")
        self.assertLess((time.monotonic() - start) * 1000, 500)
        self.assertEqual(errors, [s3.Cancelled])
        self.assertEqual(g.active, 0)

    def test_17_cancel_stalled_headers(self):
        self._cancel("header_delay", .035)

    def test_18_cancel_stalled_body(self):
        self._cancel("stall", .05)

    def test_19_cancel_byte_trickle(self):
        self._cancel("trickle", .1)

    def test_20_cancel_active_generation(self):
        self._cancel("long", .08)

    def test_21_governor_basic_policy(self):
        g = s3.Governor("normal")
        a, b = g.acquire(), g.acquire()
        self.assertEqual((g.active, g.waiting), (2, 0))
        a(); b()
        with self.assertRaises(RuntimeError):
            a()
        g.set_mode("gaming")
        with self.assertRaises(s3.ProviderError):
            g.acquire(background=True)
        g.set_mode("paused")
        with self.assertRaises(s3.ProviderError):
            g.acquire()

    def test_22_queue_saturation_and_accounting(self):
        g = s3.Governor("gaming")
        hold = g.acquire()
        state = []
        gate = threading.Event()
        def waiter():
            try:
                release = g.acquire(timeout=1)
                state.append("admitted")
                release()
            except Exception as exc:
                state.append(type(exc).__name__)
            gate.set()
        thread = threading.Thread(target=waiter, daemon=True)
        thread.start()
        deadline = time.monotonic() + .3
        while g.waiting != 1 and time.monotonic() < deadline:
            time.sleep(.001)
        self.assertEqual(g.waiting, 1)
        with self.assertRaisesRegex(s3.ProviderError, "Queue full"):
            g.acquire(timeout=.1)
        hold()
        self.assertTrue(gate.wait(.5))
        thread.join(.5)
        self.assertEqual(state, ["admitted"])
        self.assertEqual((g.active, g.waiting), (0, 0))

    def test_23_normal_to_gaming_race_queued_background_rejected(self):
        g = s3.Governor("normal")
        a, b = g.acquire(), g.acquire()
        outcome = []
        def waiter():
            try:
                release = g.acquire(timeout=1, background=True)
                outcome.append("INCORRECT_BACKGROUND_ADMISSION")
                release()
            except Exception as exc:
                outcome.append(type(exc).__name__)
        thread = threading.Thread(target=waiter, daemon=True)
        thread.start()
        deadline = time.monotonic() + .3
        while g.waiting != 1 and time.monotonic() < deadline:
            time.sleep(.001)
        self.assertEqual(g.waiting, 1)
        with g.lock:
            # Reproduce QA's exact synchronized race while holding condition.
            g.set_mode("gaming")
            a(); b()
        thread.join(.5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(outcome, ["ProviderError"])
        self.assertEqual((g.active, g.waiting), (0, 0))

    def test_24_gaming_to_paused_cancels_active_and_queued(self):
        g = s3.Governor("gaming")
        cancelled = threading.Event()
        hold = g.acquire(cancel=cancelled)
        errors = []
        def waiter():
            try:
                release = g.acquire(timeout=1)
                release()
                errors.append("INCORRECT_ADMISSION")
            except Exception as exc:
                errors.append(type(exc).__name__)
        thread = threading.Thread(target=waiter, daemon=True)
        thread.start()
        deadline = time.monotonic() + .3
        while g.waiting != 1 and time.monotonic() < deadline:
            time.sleep(.001)
        g.set_mode("paused")
        self.assertTrue(cancelled.is_set())
        thread.join(.5)
        self.assertEqual(errors, ["ProviderError"])
        hold()
        self.assertEqual((g.active, g.waiting), (0, 0))

    def test_25_active_autonomous_cancelled_on_gaming(self):
        g = s3.Governor("normal")
        autonomous = threading.Event()
        conversational = threading.Event()
        a = g.acquire(cancel=autonomous, background=True)
        b = g.acquire(cancel=conversational, background=False)
        g.set_mode("gaming")
        self.assertTrue(autonomous.is_set())
        self.assertFalse(conversational.is_set())
        self.assertEqual(g.active, 2)
        a(); b()
        self.assertEqual(g.active, 0)

    def test_26_queue_cancellation(self):
        g = s3.Governor("gaming")
        hold = g.acquire()
        cancel = threading.Event()
        errors = []
        def waiter():
            try:
                g.acquire(cancel=cancel, timeout=1)
            except Exception as exc:
                errors.append(type(exc).__name__)
        thread = threading.Thread(target=waiter, daemon=True)
        thread.start()
        time.sleep(.04)
        cancel.set()
        thread.join(.5)
        self.assertFalse(thread.is_alive())
        hold()
        self.assertEqual(errors, ["Cancelled"])
        self.assertEqual((g.active, g.waiting), (0, 0))

    def test_27_concurrent_error_and_success_accounting(self):
        g = s3.Governor("normal")
        self.assertEqual(self.probe("ok", governor=g)["chunks"], 2)
        with self.assertRaises(s3.ProviderError):
            self.probe("fail", governor=g)
        with self.assertRaises(s3.TransportError):
            self.probe("reset", governor=g)
        self.assertEqual((g.active, g.waiting), (0, 0))

    def test_28_matrix_has_warm_sample_count_and_no_fake_cold_load(self):
        data = s3.run_matrix(self.base, ["model-a", "model-b"], 3, 2)
        self.assertEqual(len(data["results"]), 2)
        self.assertEqual(data["results"][0]["warm_valid"], 2)
        self.assertIsNone(data["results"][0]["cold_model_load_ms"])

    def test_29_fail_closed_no_cloud_fallback(self):
        with patch.object(s3.socket, "socket", side_effect=OSError("offline")):
            with self.assertRaises(s3.TransportError):
                s3.stream(self.base, "chat-model", "hello")

    def test_30_percentile(self):
        self.assertEqual(s3.percentile(list(range(1, 21)), .95), 19)

    def test_31_fragmented_malformed_event_fails(self):
        with self.assertRaisesRegex(s3.ProviderError, "Malformed SSE"):
            self.probe("fragmented_bad", timeout=2)

    def test_32_slow_byte_trickle_absolute_deadline(self):
        wall = time.monotonic()
        cpu = time.process_time()
        with self.assertRaises(TimeoutError):
            self.probe("trickle", timeout=.5)
        self.assertLess(time.monotonic() - wall, .75)
        self.assertLess(time.process_time() - cpu, .18)

    def test_33_transition_cancels_real_autonomous_stream(self):
        self.server.mode = "long"
        governor = s3.Governor("normal")
        started = threading.Event()
        failures = []
        def background():
            try:
                s3.stream(self.base, "chat-model", "hello", timeout=3,
                          governor=governor, background=True,
                          on_token=lambda _: started.set())
            except Exception as exc:
                failures.append(type(exc))
        t = threading.Thread(target=background, daemon=True)
        t.start()
        self.assertTrue(started.wait(.5))
        tick = time.monotonic()
        governor.set_mode("gaming")
        t.join(.5)
        self.assertFalse(t.is_alive())
        self.assertEqual(failures, [s3.Cancelled])
        self.assertEqual((governor.active, governor.waiting), (0, 0))
        self.assertLess((time.monotonic() - tick)*1000, 500)

    def test_34_simultaneous_requests_success_failure_slot_integrity(self):
        g = s3.Governor("normal")
        errors = []
        passed = []
        barrier = threading.Barrier(3)
        def success():
            barrier.wait()
            try:
                passed.append(s3.stream(self.base,"m","hello",timeout=2,governor=g))
            except Exception as exc:
                errors.append(type(exc).__name__)
        def fails():
            barrier.wait()
            try:
                s3.stream("http://127.0.0.1:1/v1","m","hello",timeout=2,governor=g)
            except s3.TransportError:
                passed.append("expected_transport_failure")
            except Exception as exc:
                errors.append(type(exc).__name__)
        a=threading.Thread(target=success); b=threading.Thread(target=fails)
        a.start(); b.start(); barrier.wait(); a.join(3); b.join(3)
        self.assertFalse(a.is_alive() or b.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(len(passed), 2)
        self.assertEqual((g.active,g.waiting), (0,0))

    def test_35_cancellation_during_callback_preempts_done_in_same_packet(self):
        cancel = threading.Event()
        with self.assertRaises(s3.Cancelled):
            s3.stream(self.base, "chat-model", "hello", cancel=cancel,
                      on_token=lambda _: cancel.set())


if __name__ == "__main__":
    unittest.main()
