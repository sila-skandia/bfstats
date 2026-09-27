"""`viewer/replay-open.js` under node, through `replay_open_harness.mjs`.

A recording opened from disk (Open recording, or dropped anywhere on
map.html) is held in the browser only across the reload to
`map.html?mod=<mod>&map=<level>&replay=local:<name>`, so the recording's own
mod, level and game type load behind the loading screen; the page that plays
it lets it go. That rests on what
is read out of the file before any level loads, and on the URL it is played
from; both are pinned here. The picker, the drop, the browser's store and the
loading screen's line are checked in a page (features/round-replay-ux,
"Opening a recording").
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_open_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayOpenTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_date_is_the_recording_pcs_own_clock(self) -> None:
        # The header's `start` names no zone: the page shows its wall clock as
        # written, whatever zone the viewer is in.
        at = self.results["recordedAt"]
        self.assertEqual(at["minutes"], "27 Sep 2026, 14:09")
        self.assertEqual(at["seconds"], "27 Sep 2026, 14:09:21")
        self.assertEqual(at["midnight"], "3 Jan 2026, 00:05")
        for key in ("empty", "missing", "garbage", "badMonth"):
            self.assertEqual(at[key], "", key)

    def test_raw_event_files_name_their_level_mod_and_server(self) -> None:
        # v2 and v3 write the server's info (0x1A), its name (0x1B) and the
        # level (0x36) as raw events.
        for version in ("v2", "v3"):
            info = self.results[version]
            self.assertEqual(info["level"], "wake", version)
            self.assertEqual(info["mode"], "conquest", version)
            self.assertEqual(info["mod"], "bf1942", version)
            self.assertEqual(info["server"], "BF1942 server1", version)
        self.assertEqual(self.results["v2"]["start"], "2026-09-15T21:06:19")

    def test_named_event_files_name_theirs(self) -> None:
        info = self.results["v5"]
        self.assertEqual(info["level"], "anzio")
        self.assertEqual(info["mode"], "coop")
        self.assertEqual(info["mod"], "XPack1")
        self.assertEqual(info["server"], "MoonGamers.com | Est. 2004")
        self.assertEqual(info["version"], 5)

    def test_the_loading_screen_says_when_and_where(self) -> None:
        self.assertEqual(self.results["note"], "Replay  ·  27 Sep 2026, 14:09  ·  MoonGamers.com | Est. 2004")
        self.assertEqual(self.results["noteBare"], "Replay")

    def test_level_names_read_as_words(self) -> None:
        self.assertEqual(self.results["titled"], ["El Alamein", "Wake Island", "Kursk", "Battle of the Bulge"])

    def test_a_kept_recording_is_keyed_by_its_file_name(self) -> None:
        self.assertEqual(self.results["keys"], ["replay_20260927-140921", "REPLAY_1", "my_round_2_", "recording", "a_b_c"])

    def test_it_plays_from_a_url_naming_its_mod_and_level(self) -> None:
        # The page's own side, room, level and game type stay behind: the
        # recording's replace them. Its developer switch carries over.
        href = self.results["href"]
        self.assertEqual(href["path"], "map.html")
        self.assertEqual(href["params"], {
            "mod": "bf1942", "map": "Kursk", "replay": "local:replay_20260927-140921", "dev": "1",
        })
        # Readable as written: the colon is not escaped.
        self.assertIn("replay=local:replay_20260927-140921", href["search"])
        self.assertEqual(self.results["local"], [True, False, False])


if __name__ == "__main__":
    unittest.main()
