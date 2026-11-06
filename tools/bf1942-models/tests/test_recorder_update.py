"""`viewer/recorder-update.js`, under node, through `recorder_update_harness.mjs`
(features/recorder-update-notice).

After a share, a recording written by a BF42++ older than the newest release
gets a note telling its uploader to update. A header with no `build` stamp is
older (every build before bf42plus 3979cd2 writes none); one stamped before the
release's day is older; the server recorder is never told. The card itself is
checked in a browser.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "recorder_update_harness.mjs"
BATTLEVIEW = HERE.parents[2] / "ui" / "src" / "views" / "v4" / "BattleViewV4.vue"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RecorderUpdateTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_recording_without_a_build_stamp_is_outdated(self) -> None:
        self.assertEqual(self.results["noStamp"], {"outdated": True, "build": None})

    def test_the_released_build_and_later_are_current(self) -> None:
        for key in ("released", "sameDayEarlier", "newer"):
            self.assertFalse(self.results[key]["outdated"], key)

    def test_a_build_from_before_the_release_day_is_outdated(self) -> None:
        self.assertEqual(self.results["dayBefore"], {"outdated": True, "build": "Oct 17 2026 23:59:59"})

    def test_a_stamp_it_cannot_read_is_not_called_old(self) -> None:
        self.assertFalse(self.results["unreadableStamp"]["outdated"])

    def test_the_server_recorder_and_non_headers_are_left_alone(self) -> None:
        for key in ("server", "notHeader", "nothing"):
            self.assertIsNone(self.results[key], key)

    def test_the_compiler_date_is_read_with_its_padded_day(self) -> None:
        self.assertEqual(self.results["day"], 1793836800000)  # 2026-11-05 UTC
        self.assertIsNone(self.results["dayBad"])

    def test_the_header_is_the_first_line(self) -> None:
        self.assertEqual(self.results["read"], {"k": "h", "v": 5, "plus": "2.0"})
        self.assertIsNone(self.results["readBad"])

    def test_it_shows_nothing_without_a_page(self) -> None:
        self.assertFalse(self.results["shownWithoutDocument"])

    def test_the_release_matches_the_battleview_page(self) -> None:
        """BattleView's download button and this note name the same release."""
        latest = self.results["latest"]
        self.assertGreater(latest["fixes"], 0)
        self.assertIn(latest["tag"], latest["dll"])
        self.assertIn(latest["tag"], latest["release"])
        page = BATTLEVIEW.read_text(encoding="utf-8")
        tag = re.search(r"const CLIENT_TAG = '([^']+)'", page)
        self.assertIsNotNone(tag)
        self.assertEqual(tag.group(1), latest["tag"])


if __name__ == "__main__":
    unittest.main()
