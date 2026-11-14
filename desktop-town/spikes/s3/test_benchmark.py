import http.server, json, socketserver, threading, time, unittest
from unittest.mock import patch
import benchmark as s3

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    def log_message(self,*args): pass
    def do_POST(self):
        self.server.requests+=1
        self.rfile.read(int(self.headers.get("Content-Length",0)))
        if self.server.mode=="fail":
            self.send_response(503);self.send_header("Content-Length","0");self.end_headers();return
        self.send_response(200);self.send_header("Content-Type","text/event-stream");self.send_header("Connection","close");self.end_headers()
        if self.server.mode=="stall": time.sleep(.8);return
        try:
            for i in range(100 if self.server.mode=="long" else 2):
                self.wfile.write(b"data: "+json.dumps({"choices":[{"delta":{"content":"hi"}}]}).encode()+b"\n\n");self.wfile.flush()
                if self.server.mode=="long":time.sleep(.02)
            self.wfile.write(b'data: {"usage":{"completion_tokens":4},"choices":[]}\n\n');self.wfile.write(b"data: [DONE]\n\n");self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError): self.server.disconnected.set()
class Server(socketserver.ThreadingMixIn,http.server.HTTPServer):
    daemon_threads=True
    allow_reuse_address=True
class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=Server(("127.0.0.1",0),Handler);cls.server.mode="ok";cls.server.requests=0;cls.server.disconnected=threading.Event()
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.base="http://127.0.0.1:%d/v1"%cls.server.server_port
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close()
    def tearDown(self):self.server.mode="ok"
    def test_endpoint_consent(self):
        for u in ["https://example.com/v1","http://localhost:1234/v1","http://192.168.1.2:1234/v1","http://127.0.0.1:1234/v1?secret=1","http://8.8.8.8/v1","file:///tmp/foo","http://[::1]:1234/v1"]:
            with self.subTest(u=u),self.assertRaises(ValueError):s3.endpoint(u)
        self.assertEqual(s3.endpoint("http://100.100.1.2:1234/v1",True).hostname,"100.100.1.2")
        with self.assertRaises(ValueError):s3.endpoint("http://8.8.8.8/v1",True)
    def test_stream_ttft_usage(self):
        x=s3.stream(self.base,"chat-model","hello")
        self.assertEqual((x["chunks"],x["completion_tokens"]),(2,4));self.assertIsNotNone(x["ttft_ms"]);self.assertIsNotNone(x["tokens_per_sec"])
    def test_failure_recovery_no_fallback(self):
        before=self.server.requests;self.server.mode="fail"
        with self.assertRaises(s3.ProviderError):s3.stream(self.base,"model","hi")
        self.assertEqual(self.server.requests,before+1);self.server.mode="ok"
        self.assertEqual(s3.stream(self.base,"model","hi")["chunks"],2)
    def test_timeout_recovery(self):
        self.server.mode="stall"
        with self.assertRaises(TimeoutError):s3.stream(self.base,"model","hi",timeout=.5)
        self.server.mode="ok";self.assertEqual(s3.stream(self.base,"model","hi")["chunks"],2)
    def test_cancel_and_slot_release(self):
        self.server.mode="long";g=s3.Governor("gaming");cancel=threading.Event();started=threading.Event();errors=[]
        def worker():
            try:s3.stream(self.base,"model","hi",timeout=3,cancel=cancel,governor=g,on_token=lambda _:started.set())
            except Exception as e:errors.append(type(e))
        t=threading.Thread(target=worker);t.start();self.assertTrue(started.wait(1))
        tick=time.monotonic();cancel.set();t.join(1)
        self.assertFalse(t.is_alive());self.assertLess((time.monotonic()-tick)*1000,500)
        self.assertIn(s3.Cancelled,errors);self.assertEqual(g.active,0)
        self.server.mode="ok";self.assertEqual(s3.stream(self.base,"model","hi",governor=g)["chunks"],2)
    def test_governor_limits_pause(self):
        g=s3.Governor("gaming");release=g.acquire();errors=[]
        def wait():
            try:g.acquire(timeout=.08)
            except Exception as e:errors.append(type(e))
        t=threading.Thread(target=wait);t.start();t.join()
        self.assertIn(TimeoutError,errors);self.assertEqual(g.waiting,0);release()
        with self.assertRaises(s3.ProviderError):g.acquire(background=True)
        g.set_mode("paused")
        with self.assertRaises(s3.ProviderError):g.acquire()
        g.set_mode("normal");a=g.acquire();b=g.acquire();self.assertEqual(g.active,2);a();b()
    def test_queue_cancel(self):
        g=s3.Governor("gaming");release=g.acquire();cancel=threading.Event();errors=[]
        def wait():
            try:g.acquire(cancel=cancel,timeout=1)
            except Exception as e:errors.append(type(e))
        t=threading.Thread(target=wait);t.start();time.sleep(.05);cancel.set();t.join(.5)
        self.assertFalse(t.is_alive());self.assertIn(s3.Cancelled,errors);release();self.assertEqual((g.active,g.waiting),(0,0))
    def test_matrix(self):
        r=s3.run_matrix(self.base,["model-a","model-b"],3,2)
        self.assertEqual(len(r["results"]),2);self.assertEqual(r["results"][0]["successful"],3)
        self.assertIsNone(r["results"][0]["cold_model_load_ms"]);self.assertIsNotNone(r["results"][0]["warm_ttft_p95_ms"])
    def test_no_fallback_connection_error(self):
        with patch.object(s3.http.client,"HTTPConnection",side_effect=OSError("offline")):
            with self.assertRaises(OSError):s3.stream(self.base,"model","hi")
    def test_percentile(self):self.assertEqual(s3.percentile(list(range(1,21)),.95),19)
if __name__=="__main__":unittest.main()
