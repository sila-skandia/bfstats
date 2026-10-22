"""The page's soldier slides, and holds, on steep terrain as the server's does.

`lab/slope_slide_probe.mjs` drove a sidecar soldier over terrain faces on
vanilla Wake's North Base shore (2026-10-22), let go of every key on the face
and logged the server's soldier per ack. `slope_slide_harness.mjs` replays the
same words through the page's own `Soldier.step(1/30)` on Wake's heightmap and
material map, uncorrected after the start. The law is PHY-34: the friction
budget is `A 4.8 g dt Ny^5` sliding and `A 7.2 g dt Ny^5` to break a standing
grip, so on Wake's material 3/10 (A 0.9) a soldier already sliding keeps
sliding past ~41.5 deg, and one standing still holds to ~46 deg.

What the server did, and the page must:
  slide40  walked down onto 40.5 deg and let go: slid on down the fall line,
           over 42.4 deg, speeding up to 3.3 m/s, 5.7 m in 2.8 s, and stopped
           dead on the 30.7 deg triangle below
  hold38   let go on 38.3 deg while walking down: stopped in 0.55 m and held
  climb42  ran up a 42.1 deg face and let go on it: stopped in 0.4 m and held,
           standing, crouched and standing again, for ten seconds
  runUp46  ran north up x 1265 over a 46.5 deg band: slowed with the grade,
           horizontal 5.7 m/s flat, 5.3 on 28 deg, 3.66 on 46.5, and got over
  walkUp46 walked up the same line at 2.1 m/s: stalled 17 cm onto the band in
           half a second, slid back 0.2 m with W still held, and stayed
On 28 to 33 deg faces (C, G1, G2 in the probe) the server's soldier stopped
within ten ticks of letting go and held, as the page does; from a near
standstill at the waterline he could not run up 43.9 deg (D) at all.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

try:
    from test_move_law import MODULES, VIEWER
except ImportError:          # run as tests.test_slope_slide
    from tests.test_move_law import MODULES, VIEWER

FIXTURES = Path(__file__).resolve().parent / "fixtures"
HARNESS = Path(__file__).resolve().parent / "slope_slide_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs"),
             str(FIXTURES / "slope_slide_wake.ndjson.gz"),
             str(FIXTURES / "slope_slide_wake_terrain.json.gz")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


class SlopeSlideTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_server_slid_on_forty_degrees_and_held_below(self) -> None:
        # The fixture itself: what the server's soldier did.
        r = self.results
        self.assertGreater(r["slide40"]["server"]["moved"], 5.0)
        self.assertGreater(r["slide40"]["server"]["peakSpeed"], 3.0)
        self.assertLess(r["hold38"]["server"]["moved"], 0.7)
        self.assertLess(r["climb42"]["server"]["moved"], 0.5)
        for key in ("slide40", "hold38", "climb42", "runUp46", "walkUp46"):
            self.assertLess(r[key]["server"]["tailDrift"], 0.01, key)
        self.assertLess(r["runUp46"]["server"]["on46"], 0.7 * r["runUp46"]["server"]["flat"])
        self.assertGreater(r["walkUp46"]["server"]["slidBack"], 0.1)

    def test_the_page_slides_with_the_server_on_forty_degrees(self) -> None:
        s = self.results["slide40"]
        self.assertAlmostEqual(s["page"]["moved"], s["server"]["moved"], delta=0.3)
        self.assertAlmostEqual(s["page"]["dropped"], s["server"]["dropped"], delta=0.3)
        self.assertAlmostEqual(s["page"]["peakSpeed"], s["server"]["peakSpeed"], delta=0.15)
        self.assertGreaterEqual(s["slidingAcks"], 40)
        self.assertLess(s["speedGap"], 0.15)
        # and stops where he did, on the 30.7 deg triangle, and stays
        self.assertLess(s["apartAtEnd"], 0.2)
        self.assertLess(s["page"]["tailDrift"], 0.01)

    def test_the_page_holds_where_the_server_held(self) -> None:
        for key in ("hold38", "climb42", "runUp46"):
            s = self.results[key]
            with self.subTest(segment=key):
                self.assertAlmostEqual(s["page"]["moved"], s["server"]["moved"], delta=0.1)
                self.assertLess(s["page"]["tailDrift"], 0.01)
                self.assertLess(s["apartAtEnd"], 0.4)

    def test_running_uphill_slows_with_the_grade_as_the_servers_did(self) -> None:
        s = self.results["runUp46"]
        for span in ("flat", "on28", "on46"):
            with self.subTest(span=span):
                self.assertAlmostEqual(s["page"][span], s["server"][span], delta=0.1)
        # he got over the band, as far up as the server's soldier
        self.assertAlmostEqual(s["page"]["furthest"], s["server"]["furthest"], delta=0.5)
        self.assertGreater(s["page"]["furthest"], 1168.0)

    def test_walking_uphill_stalls_and_slides_back_where_the_servers_did(self) -> None:
        s = self.results["walkUp46"]
        self.assertAlmostEqual(s["page"]["flat"], s["server"]["flat"], delta=0.1)
        self.assertAlmostEqual(s["page"]["on28"], s["server"]["on28"], delta=0.1)
        # stalls on the 46.5 deg band where the server's soldier did (z 1164.16),
        # short of it by nothing and past it by nothing
        self.assertAlmostEqual(s["page"]["furthest"], s["server"]["furthest"], delta=0.1)
        self.assertLess(s["page"]["furthest"], 1164.5)
        # slides back down it with W held, as far
        self.assertGreater(s["page"]["slidBack"], 0.1)
        self.assertAlmostEqual(s["page"]["slidBack"], s["server"]["slidBack"], delta=0.1)
        # and comes to rest at its foot
        self.assertLess(s["apartAtEnd"], 0.3)
        self.assertLess(s["page"]["tailDrift"], 0.01)


if __name__ == "__main__":
    unittest.main()
