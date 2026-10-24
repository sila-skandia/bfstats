"""The 3D name tags' law, `viewer/nametags.js` (ledger HUD-16..HUD-22), run
under node by `nametags_harness.mjs`."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "viewer" / "nametags.js"
HARNESS = Path(__file__).with_name("nametags_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "nametags.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class NametagTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_server_caps_but_never_raises_the_distances(self) -> None:
        d = self.r["distances"]
        self.assertEqual({"near": 75, "scope": 300}, d["def"])
        self.assertEqual({"near": 50, "scope": 300}, d["capped"])
        self.assertEqual({"near": 75, "scope": 300}, d["above"])

    def test_a_teammate_near_fades_by_cosine_and_stops_at_the_near_range(self) -> None:
        a = self.r["alpha"]
        self.assertEqual(int(255 * 0.8090169943749475), a["friendNear"])  # cos(0.4 * pi/2)
        self.assertEqual(0, a["friendAtNear"])
        self.assertEqual(0, a["friendFar"])

    def test_an_enemy_shows_only_when_aimed_at(self) -> None:
        a = self.r["alpha"]
        self.assertEqual(0, a["enemyNear"])
        self.assertEqual(int(255 * 0.8660254037844387), a["enemyAimed"])  # cos(pi/6)

    def test_aimed_takes_the_larger_alpha_inside_the_near_range(self) -> None:
        a = self.r["alpha"]
        self.assertEqual(a["enemyAimed"], a["friendAimedFar"])
        self.assertEqual(max(int(255 * 0.8090169943749475), int(255 * 0.9876883405951378)), a["friendAimedNear"])

    def test_nothing_past_the_scope_but_a_carrier_always(self) -> None:
        self.assertEqual(0, self.r["alpha"]["beyondScope"])
        self.assertEqual(255, self.r["alpha"]["carrier"])

    def test_the_aim_lights_inside_a_tenth_of_a_second_and_fades_in_half(self) -> None:
        aim = self.r["aim"]
        self.assertLess(aim["lit"], 0.11)
        self.assertGreater(aim["lit"], 0.04)
        self.assertAlmostEqual(0.5, aim["out"], delta=1 / 60 + 1e-9)

    def test_the_text_and_the_health_suffix(self) -> None:
        t = self.r["text"]
        self.assertEqual("[Arthur Fowler]", t["plain"])
        self.assertEqual("[A] (42%)", t["medic"])
        self.assertEqual("[A]", t["medicEnemy"])
        self.assertEqual("[A]", t["medicSeated"])
        self.assertEqual("[A] (-16%)", t["engineer"])
        self.assertEqual("[A]", t["medicInSeat"])

    def test_the_colour_is_the_targets_side(self) -> None:
        c = self.r["colour"]
        self.assertEqual([0xFF, 0x28, 0x28], c["axis"])
        self.assertEqual([0x10, 0x30, 0xFF], c["allies"])
        self.assertEqual([0, 0xFF, 0], c["buddy"])
        self.assertEqual([255, 255, 127], c["carrierTrough"])
        self.assertEqual([0x10, 0x30, 0xFF], c["carrierPeak"])
        self.assertEqual([128, 128, 128], c["pulseHalf"])


if __name__ == "__main__":
    unittest.main()
