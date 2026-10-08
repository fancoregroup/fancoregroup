"""Verifica retomada, concorrência e respostas inválidas sem usar servidores externos."""
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from unittest.mock import patch
from coleta_util import ROOT, download

PAYLOAD = b"public-data-row\n" * 2000


class Handler(BaseHTTPRequestHandler):
    calls = {}
    ranges = {}

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.calls[self.path] = self.calls.get(self.path, 0) + 1
        requested = self.headers.get("Range")
        self.ranges.setdefault(self.path, []).append(requested)
        start = int(requested.split("=")[1].split("-")[0]) if requested else 0
        etag = '"v2"' if self.path == "/changed" else '"v1"'
        if self.path == "/ignore":
            start = 0
            requested = None
        if requested and start >= len(PAYLOAD):
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{len(PAYLOAD)}")
            self.end_headers()
            return
        body = PAYLOAD[start:]
        self.send_response(206 if requested else 200)
        if requested:
            self.send_header("Content-Range", f"bytes {start}-{len(PAYLOAD)-1}/{len(PAYLOAD)}")
        self.send_header("Content-Type", "text/html" if self.path == "/html" else "application/octet-stream")
        self.send_header("ETag", etag)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class DownloadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        (ROOT / ".cache").mkdir(exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.temp = TemporaryDirectory(dir=ROOT / ".cache")
        self.path = Path(self.temp.name) / "dados.bin"

    def tearDown(self):
        self.temp.cleanup()

    def partial(self, endpoint, body):
        self.path.with_suffix(".bin.part").write_bytes(body)
        self.path.with_suffix(".bin.part.http.json").write_text(json.dumps({
            "url": self.base + endpoint, "etag": '"v1"', "last_modified": None}))

    def test_resume_preserves_exact_bytes(self):
        self.partial("/resume", PAYLOAD[:3107])
        result = download(self.base + "/resume", self.path, expected_bytes=len(PAYLOAD))
        self.assertEqual(self.path.read_bytes(), PAYLOAD)
        self.assertEqual(result["sha256"], hashlib.sha256(PAYLOAD).hexdigest())
        self.assertEqual(Handler.ranges["/resume"][-1], "bytes=3107-")

    def test_server_ignoring_range_restarts_safely(self):
        self.partial("/ignore", PAYLOAD[:5000])
        download(self.base + "/ignore", self.path, expected_bytes=len(PAYLOAD))
        self.assertEqual(self.path.read_bytes(), PAYLOAD)

    def test_concurrent_calls_do_not_duplicate_transfer(self):
        url = self.base + "/concurrent"
        before = Handler.calls.get("/concurrent", 0)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: download(url, self.path), range(2)))
        self.assertEqual(self.path.read_bytes(), PAYLOAD)
        self.assertEqual(Handler.calls["/concurrent"] - before, 1)
        self.assertEqual(results[0]["sha256"], results[1]["sha256"])

    def test_html_not_accepted_as_zip(self):
        with patch("coleta_util.time.sleep"):
            with self.assertRaises(RuntimeError):
                download(self.base + "/html", self.path.with_suffix(".zip"))
        self.assertFalse(self.path.with_suffix(".zip").exists())

    def test_cached_file_checked_against_source_checksum(self):
        download(self.base + "/checksum", self.path)
        with self.assertRaises(ValueError):
            download(self.base + "/checksum", self.path, expected_md5="0" * 32)

    def test_complete_partial_restarts_after_416(self):
        self.partial("/eof", PAYLOAD)
        with patch("coleta_util.time.sleep"):
            download(self.base + "/eof", self.path)
        self.assertEqual(self.path.read_bytes(), PAYLOAD)
        self.assertEqual(Handler.ranges["/eof"], [f"bytes={len(PAYLOAD)}-", None])

    def test_changed_validator_never_mixes_versions(self):
        self.partial("/changed", b"old version" * 200)
        with patch("coleta_util.time.sleep"):
            download(self.base + "/changed", self.path)
        self.assertEqual(self.path.read_bytes(), PAYLOAD)
        self.assertEqual(Handler.ranges["/changed"], ["bytes=2200-", None])

    def test_unknown_partial_restarts_without_range(self):
        self.path.with_suffix(".bin.part").write_bytes(b"old partial")
        download(self.base + "/unknown", self.path)
        self.assertEqual(self.path.read_bytes(), PAYLOAD)
        self.assertIsNone(Handler.ranges["/unknown"][-1])

    def test_invalid_md5_discards_partial_before_retry(self):
        with patch("coleta_util.time.sleep"):
            with self.assertRaises(RuntimeError):
                download(self.base + "/invalidmd5", self.path, expected_md5="0" * 32)
        self.assertFalse(self.path.with_suffix(".bin.part").exists())
        self.assertTrue(all(value is None for value in Handler.ranges["/invalidmd5"]))


if __name__ == "__main__":
    unittest.main()
