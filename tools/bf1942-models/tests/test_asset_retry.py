"""`viewer/asset-retry.js`: failed downloads are tried again before a texture
is left white, a body that breaks off is resumed, and a real "not there" still
fails at once.

`asset-retry.js` imports nothing, so this copies it plus its harness into a
temp dir and runs `node harness.mjs`, the same shape as `test_asset_prefetch.py`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "viewer" / "asset-retry.js"
HARNESS = Path(__file__).resolve().parent / "asset_retry_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "asset-retry.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class AssetRetryFetchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_network_errors_are_retried_with_backoff(self) -> None:
        r = self.out["networkThenOk"]
        self.assertEqual(r["status"], 200)
        self.assertEqual(r["text"], "hello")
        self.assertEqual(r["calls"], 3)
        self.assertEqual(r["waits"], self.out["delays"][:2])

    def test_transient_status_is_retried(self) -> None:
        r = self.out["transientThenOk"]
        self.assertEqual((r["status"], r["calls"]), (200, 2))

    def test_not_found_is_returned_at_once(self) -> None:
        r = self.out["notFound"]
        self.assertEqual((r["status"], r["calls"], r["waits"]), (404, 1, []))

    def test_gives_up_after_every_retry(self) -> None:
        r = self.out["alwaysDown"]
        self.assertIn("Failed to fetch", r["error"])
        self.assertEqual(r["calls"], len(self.out["delays"]) + 1)

    def test_post_and_aborted_requests_are_not_retried(self) -> None:
        self.assertEqual(self.out["post"]["calls"], 1)
        self.assertEqual(self.out["aborted"]["calls"], 1)

    def test_broken_body_resumes_into_one_stream(self) -> None:
        r = self.out["resumed"]
        self.assertEqual(r["text"], "aabbccdd")
        self.assertEqual(r["calls"], 2)
        self.assertEqual(r["url"], "")  # Node's stub Response has no url; the field is carried over

    def test_resume_refused_when_file_changed(self) -> None:
        r = self.out["changed"]
        self.assertIn("changed", r["error"])
        self.assertEqual(r["calls"], 2)

    def test_live_streams_are_passed_through(self) -> None:
        self.assertIn("error", self.out["noValidator"])
        self.assertEqual(self.out["noValidator"]["calls"], 1)
        self.assertIn("error", self.out["eventStream"])
        self.assertEqual(self.out["eventStream"]["calls"], 1)

    def test_body_that_keeps_breaking_fails(self) -> None:
        r = self.out["bodyAlwaysBreaks"]
        self.assertIn("error", r)
        self.assertEqual(r["calls"], len(self.out["delays"]) + 1)


class AssetRetryImageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_image_retried_until_it_loads(self) -> None:
        r = self.out["imageRetried"]
        self.assertEqual(r["loaded"], "https://x/t.png")
        self.assertEqual((r["images"], r["probes"]), (3, 2))
        # One file to the loading manager, however many tries.
        self.assertEqual((r["started"], r["ended"], r["errors"]), (1, 1, 0))

    def test_image_404_fails_at_once(self) -> None:
        r = self.out["image404"]
        self.assertEqual(r["error"], "error")
        self.assertEqual((r["images"], r["started"], r["ended"], r["errors"]), (1, 1, 1, 1))

    def test_image_server_error_is_retried(self) -> None:
        self.assertIn("loaded", self.out["image503"])

    def test_image_gives_up_after_every_retry(self) -> None:
        r = self.out["imageAlwaysDown"]
        self.assertEqual(r["error"], "error")
        self.assertEqual(r["images"], len(self.out["delays"]) + 1)
        self.assertEqual((r["started"], r["ended"], r["errors"]), (1, 1, 1))

    def test_data_urls_are_not_retried(self) -> None:
        r = self.out["imageData"]
        self.assertEqual((r["images"], r["probes"]), (1, 0))


if __name__ == "__main__":
    unittest.main()
