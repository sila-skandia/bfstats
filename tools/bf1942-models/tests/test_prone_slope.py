"""The page's soldier lying on a slope, against the BF1942 dedicated server's.

`lab/prone_slope_probe.mjs` ran a sidecar soldier on vanilla Wake (conquest,
no bots, 2026-10-25) to spots on terrain faces of several grades and
headings, stood him still, lay him down, and then, lying, held still,
crawled, turned on the spot, crawled the new heading, crawled turning,
crawled back and sideways, stood up, crouched and stood
(`tests/fixtures/prone_slope_wake.ndjson.gz`, cut by `lab/prone_slope_fixture.py`).
`prone_slope_harness.mjs` replays each spot's words through the page's own
`Soldier.step` on Wake's heightmap and compares his feet and his up row with
the server's at every acknowledged serial.

The law (ledger PHY-38): lying, `BFSoldier::handleUpdate` leans his
transform's up row onto the terrain's normal under his origin a tenth of the
way a tick, and back to vertical by half a tick otherwise; the terrain
contact tests his feet vertex at `origin - up`, so on a face of angle a his
origin rests `1 / cos a` over the ground under it, not 1.0 m; his command and
his drag run along the leaned rows; his heading drifts as his forward row is
laid square to the new up, and the look axis turns him about that up.
`Lb_LieToStand` holds the lying pose eleven ticks counting the press's. The
page before had him upright: 59.5 mm under the server on the 19-degree face
and 120 mm under it on the 27-degree one (202 mm high on 34 degrees, the
server) under its own reconciler, which
takes no height under 1.5 m.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_move_law import MODULES, VIEWER  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
HARNESS = Path(__file__).resolve().parent / "prone_slope_harness.mjs"
STEM = "prone_slope_wake"
PRONE = ["lie", "crawl", "still", "turn", "still2", "crawl2", "still3", "crawl-turn", "back", "side",
         "still4", "stand up"]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
        for name in [*MODULES, "netcode-reconcile.js"]:
            shutil.copyfile(VIEWER / name, work / name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs"), str(FIXTURES / f"{STEM}.ndjson.gz"),
             str(FIXTURES / f"{STEM}_terrain.json.gz")],
            capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


class ProneSlopeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_fixture_covers_several_grades(self) -> None:
        self.assertGreaterEqual(len(self.results), 3, sorted(self.results))

    def test_his_up_row_leans_with_the_servers(self) -> None:
        for spot, r in self.results.items():
            for key in PRONE:
                t = r["acked"][key]["tilt"]
                with self.subTest(spot=spot, phase=key):
                    self.assertLessEqual(t["max"], 0.05, t)

    def test_every_prone_phase_tracks_the_server_an_ack(self) -> None:
        for spot, r in self.results.items():
            for key in PRONE:
                a = r["acked"][key]
                with self.subTest(spot=spot, phase=key):
                    self.assertGreater(a["horizontal"]["n"], 4)
                    self.assertLessEqual(a["horizontal"]["median"], 1.5, a["horizontal"])
                    self.assertLessEqual(a["horizontal"]["max"], 4.0, a["horizontal"])
                    self.assertLessEqual(a["vertical"]["max"], 2.0, a["vertical"])

    def test_under_the_pages_reconciler_a_round_trip_late(self) -> None:
        # The height is the page's own law here: the reconciler takes none
        # under 1.5 m, so this is where the upright soldier's 60-120 mm showed.
        for spot, r in self.results.items():
            for key in PRONE:
                a = r["lag"][key]
                with self.subTest(spot=spot, phase=key):
                    self.assertLessEqual(a["horizontal"]["median"], 1.5, a["horizontal"])
                    self.assertLessEqual(a["horizontal"]["max"], 4.0, a["horizontal"])
                    self.assertLessEqual(a["vertical"]["max"], 2.0, a["vertical"])

    def test_uncorrected_he_stays_with_the_server(self) -> None:
        # One run from standing still on the face, the facing the page's own
        # while he lies (the turn about his up row and the lean's drift). The
        # start is already 5-7 mm and 2-5 mm off (the standing state's
        # rounding on the face, the `settle` phase), and it stays there.
        for spot, r in self.results.items():
            for key in PRONE:
                a = r["free"][key]
                with self.subTest(spot=spot, phase=key):
                    self.assertLessEqual(a["horizontal"]["max"], 12.0, a["horizontal"])
                    self.assertLessEqual(a["vertical"]["max"], 6.0, a["vertical"])


if __name__ == "__main__":
    unittest.main()
