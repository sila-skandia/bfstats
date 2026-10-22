"""The heartbeat under 5 % tickets: `Bf1942/Game/Heartbeats.ssc`, driven by
the client's HUD call 0x006E3840 (ledger RADIO-14).

`viewer/announcer.js` `heartbeatLevel` is run headless by
`heartbeat_harness.mjs`; `extract_radio.heartbeat_script` reads the script.
Every number is BF1942.exe's: the bands at 0x006E392B..0x006E3A69, the
Objective law at 0x006E3B4A, the stop at no tickets (0x006E3AAF) and at the
debriefing (0x006AADEF).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
HARNESS = Path(__file__).with_name("heartbeat_harness.mjs")

VANILLA_SSC = """#beginMap HeartBeat
\tPitch
\tVolume
#endMap

newPatch

load @ROOT/Sound/@RTD/heartbeatloop.wav
loop
stereo
priority 11
*** Pitch ***
beginEffect
\tcontrolDestination Pitch
\tcontrolSource Extern #map<HeartBeat::Pitch>
\tenvelope Ramp
\tparam 0
\tparam 1
\tparam 0
\tparam 1
endEffect

*** Volume ***
beginEffect
\tcontrolDestination Volume
\tcontrolSource Extern #map<HeartBeat::Volume>
\tenvelope Ramp
\tparam 0
\tparam 1
\tparam 0
\tparam 1
endEffect
"""


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(ROOT / "viewer" / "announcer.js", work / "announcer.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class HeartbeatLevelTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_it_starts_under_five_percent_of_the_start(self) -> None:
        # 21..0 of 100. The share is a float: 5/100 is 0.0500000007f, above
        # the double 0.05, so the beat starts at 4; 4/100 is 0.0399999991f,
        # under 0.04, so the first level heard is 0.6, not 0.4.
        self.assertEqual([None] * 17 + [0.6, 0.7, 0.8, 1.0, None], self.r["of100"])

    def test_the_bands_over_larger_starts(self) -> None:
        self.assertEqual([None, None, 0.4, 0.6, 0.6, 0.7, 0.7, 0.8, 0.8, 1.0, 1.0, None],
                         self.r["of200"])
        self.assertEqual([None, 0.4, 0.4, 0.6, 0.7, 0.8, 1.0, 1.0, 1.0], self.r["of300"])

    def test_the_dead_half_band_never_sounds(self) -> None:
        levels = self.r["of100"] + self.r["of200"] + self.r["of300"]
        self.assertNotIn(0.5, levels)

    def test_no_tickets_and_no_start_are_silent(self) -> None:
        self.assertIsNone(self.r["negative"])
        self.assertEqual([None, None, None], self.r["noStart"])

    def test_objective_mode_counts_tickets_not_a_share(self) -> None:
        o = self.r["objective"]
        self.assertEqual([None, None], o[:2])
        self.assertAlmostEqual(0.0, o[2], places=6)      # at 10: 1 - 0.1f x 10
        self.assertAlmostEqual(0.1, o[3], places=6)
        self.assertAlmostEqual(0.5, o[4], places=6)
        self.assertAlmostEqual(0.9, o[5], places=6)
        self.assertEqual(1.0, o[6])                       # it plays on at none


class HeartbeatRoundTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_it_follows_the_local_sides_tickets(self) -> None:
        self.assertEqual([None, None, 0.6, 0.7, 0.8, 1.0], self.r["round"])
        self.assertIsNone(self.r["otherSideLow"])

    def test_the_end_of_the_round_stops_it(self) -> None:
        self.assertIsNone(self.r["roundOver"])

    def test_with_no_side_it_keeps_what_it_had(self) -> None:
        self.assertEqual(0.8, self.r["noSideHolds"])

    def test_tickets_back_above_the_floor_stop_it(self) -> None:
        self.assertIsNone(self.r["backAbove"])

    def test_a_new_level_starts_silent(self) -> None:
        self.assertIsNone(self.r["reset"])

    def test_no_tickets_clears_the_heavy_casualties_latch(self) -> None:
        self.assertEqual([True, False, False, True], self.r["heavyLatch"])


class HeartbeatScriptTests(unittest.TestCase):
    def test_the_script_reads_as_one_loop_with_identity_ramps(self) -> None:
        from extract_radio import HEARTBEAT_SSC, heartbeat_script

        class Pool:
            def try_read(self, name: str):
                return VANILLA_SSC.encode() if name == HEARTBEAT_SSC else None

        self.assertEqual({"stem": "heartbeatloop", "file": "@ROOT/Sound/@RTD/heartbeatloop.wav",
                          "loop": True, "pitch": [0.0, 1.0, 0.0, 1.0],
                          "volume": [0.0, 1.0, 0.0, 1.0]}, heartbeat_script(Pool()))

    def test_no_script_no_heartbeat(self) -> None:
        from extract_radio import heartbeat_script

        class Empty:
            def try_read(self, name: str):
                return None

        self.assertIsNone(heartbeat_script(Empty()))


if __name__ == "__main__":
    unittest.main()
