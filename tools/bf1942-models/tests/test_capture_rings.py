"""The page's capture progress rings (`viewer/capture-rings.js`), its own
addition: retail rings only ObjectiveMode's objectives (ledger OBJ-7), and
a control point's ghost body carries no timer (NET-16), so on a server the
ring is an estimate from the capture law over the server's positions.

Pinned against the lab (features/capture-progress-rings, 2026-10-25,
Gazala Conquest, no bots, `lab/capture_probe.mjs`):

- a neutral point (0PEN_BASE_crossing, `timeToGetControl 10`, radius 50):
  the server's word came 10.00 s after the probe's soldier, by the server's
  own position, first stood in the radius; the estimate took it on the same
  tick;
- an enemy point (ALLIES_village, team 2, `timeToLoseControl 10`): run down
  to neutral 10.07 s after, taken 20.07 s after; the estimate 0.03 s and 0
  s ahead;
- the same capture as a sidecar recorded it, through the page's own sidecar
  state (`net-sidecar.js`) and the page's tick: the ring filled through all
  nine frames and stood full when the word came, 0.1 s after the estimate.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "capture_ring_harness.mjs"
NET_HARNESS = HERE / "capture_ring_net_harness.mjs"
FIX = HERE / "fixtures"
POINTS = FIX / "capture_gazala_points.json"


def run(*args: str) -> dict:
    proc = subprocess.run(["node", *map(str, args)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr)
    return json.loads(proc.stdout)


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class CaptureRingTests(unittest.TestCase):
    def test_the_frame_is_picked_as_the_client_picks_an_objectives(self) -> None:
        # trunc(x * 8 + 0.5) over the nine Objective000..100 frames (OBJ-7).
        r = run(HARNESS)
        self.assertEqual(r["spriteCount"], 9)
        self.assertEqual(r["frames"], ["objective000", "objective000", "objective012",
                                       "objective050", "objective100", "objective100"])

    def test_the_law_state_reads_as_a_ring(self) -> None:
        p = run(HARNESS)["progress"]
        # Being taken: the get timer run down, in the taker's colour.
        self.assertEqual(p["getting"], {"kind": "getting", "team": 2, "fraction": 0.75})
        # Being run down: the lose timer left, in the holder's colour.
        self.assertEqual(p["losing"], {"kind": "losing", "team": 1, "fraction": 0.75})
        self.assertIsNone(p["held"])

    def test_a_neutral_point_taken_on_the_servers_tick(self) -> None:
        c = run(HARNESS, FIX / "capture_gazala_crossing.ndjson.gz", POINTS)["capture"]
        (change,) = c["changes"]
        self.assertEqual((change["name"], change["from"], change["to"]), ("0PEN_BASE_crossing", 0, 1))
        self.assertAlmostEqual(change["sinceInside"], 10.0, delta=0.05)
        self.assertAlmostEqual(change["lead"], 0.0, delta=0.05)
        self.assertEqual(change["ringBefore"], {"kind": "getting", "team": 1, "sprite": "objective100"})
        # The ring fills through every frame on the way.
        sprites = [x["sprite"] for x in c["rings"] if x["name"] == "0PEN_BASE_crossing"]
        self.assertEqual(sorted(set(sprites)), sorted({f"objective{f}" for f in
                                                      ("000", "012", "025", "037", "050", "062", "075", "087", "100")}))

    def test_an_enemy_point_run_down_then_taken(self) -> None:
        c = run(HARNESS, FIX / "capture_gazala_village.ndjson.gz", POINTS)["capture"]
        lost, got = c["changes"]
        self.assertEqual((lost["from"], lost["to"], got["to"]), (2, 0, 1))
        self.assertAlmostEqual(lost["sinceInside"], 10.07, delta=0.05)
        self.assertAlmostEqual(got["sinceInside"], 20.07, delta=0.05)
        self.assertAlmostEqual(lost["lead"], 0.0, delta=0.05)
        self.assertAlmostEqual(got["lead"], 0.0, delta=0.05)
        # Draining in the holder's colour before it fell.
        losing = [x for x in c["rings"] if x["kind"] == "losing"]
        self.assertTrue(losing and all(x["team"] == 2 for x in losing))

    def test_a_late_word_finds_the_estimate_already_there(self) -> None:
        # The words held back 9 ticks (0.3 s): the shadow moves on by its own
        # law (a lost point starts its get timer at once) and keeps the ring
        # full until the take is confirmed.
        c = run(HARNESS, FIX / "capture_gazala_village.ndjson.gz", POINTS, "Conquest", "9")["capture"]
        lost, got = c["changes"]
        self.assertAlmostEqual(lost["lead"], 0.33, delta=0.05)
        self.assertAlmostEqual(got["lead"], 0.3, delta=0.05)
        self.assertEqual(got["ringBefore"]["sprite"], "objective100")

    def test_the_page_net_path_on_a_sidecar_recording(self) -> None:
        r = run(NET_HARNESS, FIX / "capture_gazala_sidecar.ndjson.gz", POINTS)
        self.assertEqual(r["source"], "net")
        (word,) = r["words"]
        self.assertEqual((word["name"], word["to"]), ("0PEN_BASE_crossing", 1))
        self.assertEqual(word["ringBefore"], {"kind": "getting", "team": 1, "sprite": "objective100"})
        (corr,) = r["corrections"]
        self.assertGreaterEqual(corr["lead"], 0)
        self.assertLess(corr["lead"], 0.3)
        sprites = [s["sprite"] for s in r["samples"] if s["name"] == "0PEN_BASE_crossing"]
        self.assertEqual(sprites[0], "objective000")
        self.assertEqual(sprites, sorted(sprites))


if __name__ == "__main__":
    unittest.main()
