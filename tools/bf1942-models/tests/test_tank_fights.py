"""Tank fights found in round recordings (features/battle-schools, "Tank
fights from the recordings").

`tank_fights_harness.mjs` writes a 30 s round in the recorder's own format (a
Sherman shelling a Tiger driving past 300 m away, three led shells and the
kill; a shell straight up, the Tiger's shell fired away from the Sherman, a
shell at a jeep), reads it with the viewer's reader, and runs
`viewer/tank-fights-detect.js` on it, then on two variants: the Tiger opening
hurt, and its driver getting out before a kill.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "tank_fights_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"tank fights harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class TankFightsTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_a_tank_is_a_driven_life_the_tank_test_passes(self) -> None:
        # The jeep is driven and shot at, and is no tank.
        tanks = self.out["tanks"]
        self.assertEqual(["Sherman", "Tiger"], [t["tmpl"] for t in tanks])
        self.assertEqual([[1], [2]], [t["drivers"] for t in tanks])
        self.assertEqual(["medium", "heavy"], [t["weight"] for t in tanks])
        # Without a test, whatever fires a main gun with 100 hit points or more.
        self.assertEqual(["Sherman", "Tiger"], self.out["untested"])

    def test_the_fight_is_found_and_opens_before_the_first_shell(self) -> None:
        fights = self.out["fights"]
        self.assertEqual(1, len(fights))
        f = fights[0]
        self.assertEqual(("Gunner", "Sherman"), (f["sides"][0]["name"], f["sides"][0]["tmpl"]))
        self.assertEqual(("Panzer", "Tiger"), (f["sides"][1]["name"], f["sides"][1]["tmpl"]))
        self.assertNotEqual(f["sides"][0]["team"], f["sides"][1]["team"])
        # First aimed shell at 10 s, 5 s of lead-in.
        self.assertAlmostEqual(5.0, f["t0"], places=3)

    def test_shells_not_aimed_at_the_tank_do_not_count(self) -> None:
        # The Sherman fired five shells: three at the Tiger, one straight up,
        # one at the jeep. The Tiger's one went away from the Sherman.
        gunner, panzer = self.out["fights"][0]["sides"]
        self.assertEqual((5, 3, 3), (gunner["shots"], gunner["aimed"], gunner["hits"]))
        self.assertEqual((1, 0, 0), (panzer["shots"], panzer["aimed"], panzer["hits"]))
        self.assertFalse(self.out["fights"][0]["mutual"])
        aimed = [s["aimed"] for s in self.out["sampled"]["shots"]]
        self.assertEqual([True, False, False, True, False, True], aimed)

    def test_the_kill_and_the_range_of_the_killing_shell(self) -> None:
        f = self.out["fights"][0]
        self.assertEqual("killed", f["end"]["why"])
        self.assertEqual(1, f["end"]["side"])
        self.assertEqual(0, f["winner"])
        self.assertEqual("line", f["kill"]["how"])
        self.assertEqual(18, f["kill"]["shotT"])
        # Muzzle to the Tiger's hull when the third shell left, not at the kill.
        self.assertEqual("shot", f["rangeHow"])
        self.assertAlmostEqual(self.out["killShot"]["range"], f["range"], places=3)
        self.assertGreater(f["range"], 300)
        # Closed 3 s after the kill.
        self.assertAlmostEqual(f["kill"]["t"] + 3, f["t1"], places=3)

    def test_full_hit_points_and_the_upset(self) -> None:
        f = self.out["fights"][0]
        self.assertTrue(f["fullHpStart"])
        self.assertEqual([100, 125], [s["hpStart"] for s in f["sides"]])
        # A medium Sherman killing a heavy Tiger.
        self.assertTrue(f["upset"])
        # range x 1.5 (one class lighter) x 1.25 (full hit points).
        self.assertAlmostEqual(round(f["range"] * 1.5 * 1.25, 1), f["score"], places=1)
        hurt = self.out["hurt"][0]
        self.assertFalse(hurt["fullHpStart"])
        self.assertEqual(100, hurt["sides"][1]["hpStart"])
        self.assertTrue(hurt["upset"])
        self.assertLess(hurt["score"], f["score"])

    def test_a_fight_without_a_kill_says_how_it_ended(self) -> None:
        left = self.out["left"]
        self.assertEqual(1, len(left))
        f = left[0]
        self.assertEqual("left", f["end"]["why"])
        self.assertEqual(1, f["end"]["side"])
        self.assertAlmostEqual(17.0, f["end"]["t"], places=3)
        self.assertIsNone(f["winner"])
        self.assertIsNone(f["range"])
        self.assertFalse(f["upset"])

    def test_weight_classes(self) -> None:
        # 0 (unknown) medium, 50 and 99 light, 100 and 124 medium, 125 and 166
        # heavy; the AI's LightArmour makes a 110 light.
        self.assertEqual(["medium", "light", "light", "medium", "medium", "heavy", "heavy", "light"], self.out["weights"])

    def test_main_gun_names(self) -> None:
        guns = dict(self.out["mainGun"])
        self.assertTrue(guns["ShermanGunBarrel"])
        self.assertTrue(guns["M36GunBarrelAP"])
        self.assertTrue(guns["PanzerIILcannon"])
        for name in ["Coaxial_MG34", "AA_Allies_GunBarrel", "WespeTracGunBarrel", "Mg34V", "L3_33_20mmMG"]:
            self.assertFalse(guns[name], name)

    def test_the_sampled_fight(self) -> None:
        s = self.out["sampled"]
        self.assertEqual(0.2, s["dt"])
        self.assertEqual([97, 97], s["samples"])
        self.assertEqual([[0, 125], [8.3, 80], [12.3, 40], [16.4, 0]], s["hp"][1])


if __name__ == "__main__":
    unittest.main()
