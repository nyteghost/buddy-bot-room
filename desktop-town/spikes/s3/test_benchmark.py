import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("s3", pathlib.Path(__file__).with_name("benchmark.py"))
s3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s3)

class SecurityTests(unittest.TestCase):
    def test_local_only(self):
        self.assertEqual(s3.endpoint("http://127.0.0.1:1234/v1").hostname, "127.0.0.1")
        for url in ["https://example.com/v1", "http://192.168.1.2:1234/v1", "http://localhost:1234/v1", "http://127.0.0.1:1234/v1?token=secret", "file:///etc/passwd"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                s3.endpoint(url)
    def test_explicit_private_remote(self):
        self.assertEqual(s3.endpoint("http://100.100.1.2:1234/v1", True).hostname, "100.100.1.2")
        with self.assertRaises(ValueError):
            s3.endpoint("https://8.8.8.8/v1", True)
    def test_no_fallback_on_failure(self):
        with patch.object(s3.http.client, "HTTPConnection", side_effect=OSError("offline")):
            with self.assertRaises(OSError):
                s3.stream("http://127.0.0.1:1234/v1", "test", "hello")
    def test_percentile(self):
        self.assertEqual(s3.percentile(list(range(1,21)), .95), 19)

if __name__ == "__main__":
    unittest.main()
