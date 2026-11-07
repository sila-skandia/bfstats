"""`viewer/download-meter.js`: every file the page downloads is counted for
the loading screen's download line, and progress.js's `downloadLine` words it.

The loading bar can sit on one number for seconds while a replay fetches its
vehicles; the line under the prompt shows files and bytes still arriving
(features/loading-download-progress). This copies the meter, progress.js and
its imports into a temp dir and runs `node harness.mjs`, the shape of
`test_asset_retry.py`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("download_meter_harness.mjs")
MODULES = ["download-meter.js", "progress.js", "audio.js", "loading-audio-ui.js", "preview-mute.js"]

MB = 1048576


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class DownloadMeterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def snap(self, key: str) -> tuple:
        s = self.out[key]
        return (s["files"], s["done"], s["loaded"], s["total"], s["active"])

    def test_size_is_the_unzipped_size(self) -> None:
        # nginx's gzipped glb carries X-File-Size; a gzipped body's
        # Content-Length is the zipped size, which the reader never sees.
        self.assertEqual(self.out["sizes"],
                         {"fileSize": 2000, "plainLength": 900, "gzipNoFileSize": None, "none": None})

    def test_bytes_count_as_they_are_read(self) -> None:
        self.assertEqual(self.snap("partway"), (1, 0, 4, 10, 1))
        self.assertEqual(self.out["json"], {"a": 1})
        # The stream pulls a chunk ahead of its reader: what has arrived, not
        # what has been consumed, is what was downloaded.
        self.assertEqual(self.snap("afterJson"), (2, 1, 15, 17, 1))
        self.assertEqual(self.snap("sceneRead"), (2, 2, 17, 17, 0))

    def test_unknown_size_counts_what_arrived(self) -> None:
        self.assertEqual(self.snap("unknownSize"), (3, 3, 20, 20, 0))

    def test_a_404_and_a_post_are_no_file(self) -> None:
        self.assertEqual(self.out["missing"], 404)
        self.assertEqual(self.snap("afterMissing"), (3, 3, 20, 20, 0))

    def test_response_answers_like_the_original(self) -> None:
        self.assertEqual(self.out["urlKept"], "")  # Node's stub Response has no url; carried over

    def test_reset_drops_finished_files(self) -> None:
        self.assertEqual(self.snap("afterReset"), (0, 0, 0, 0, 0))

    def test_failures_end_the_file_and_still_throw(self) -> None:
        self.assertIn("Failed to fetch", self.out["netError"])
        self.assertIn("network error", self.out["broken"])

    def test_an_unread_body_stops_counting_once_idle(self) -> None:
        fresh = self.out["unreadFresh"]
        self.assertEqual((fresh["files"], fresh["active"]), (3, 1))
        self.assertEqual(self.out["unreadIdle"]["active"], 0)
        self.assertEqual(self.snap("unreadAfterReset"), (0, 0, 0, 0, 0))

    def test_a_download_in_flight_survives_reset(self) -> None:
        self.assertEqual(self.snap("carried"), (1, 0, 2, 4, 1))

    def test_images_count_from_call_to_load(self) -> None:
        self.assertEqual(self.snap("imagesPending"), (2, 0, 0, 0, 2))
        self.assertEqual(self.snap("imagesDone"), (2, 2, 1234, 1234, 0))
        self.assertEqual(self.out["imageOnLoad"], 1)


class DownloadLineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.lines = run_harness()["lines"]

    def test_downloading(self) -> None:
        self.assertEqual(self.lines["active"], "23 / 41 FILES  ·  54.3 MB / 78.0 MB  ·  4.2 MB/s")
        self.assertEqual(self.lines["noRate"], "0 / 2 FILES")

    def test_everything_in_names_the_phase(self) -> None:
        self.assertEqual(self.lines["allIn"], "41 FILES IN  ·  78.0 MB  ·  preparing the level")
        self.assertEqual(self.lines["oneIn"], "1 FILE IN  ·  2 KB")
        self.assertEqual(self.lines["none"], "preparing the level")


if __name__ == "__main__":
    unittest.main()
