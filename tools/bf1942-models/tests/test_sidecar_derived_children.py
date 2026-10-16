"""Vehicle ghost bodies from the install: the child networkables, widths,
hit points, mobility and turning parts derived from the template graph a
level load builds (bf42/template_table.py `object_graph` ->
sidecar/ghost/derive-children.mjs `deriveLevel`, served by children.mjs),
checked against what they replace and against real wire bodies from Wake and
El Alamein. features/udp-sidecar/decodes/vehicle-children.md section 7,
wire.md section 26.

What they replace, field for field: the six Wake specs, six gunner seats and
the joint rows once written by hand (fixtures/sidecar_hand_specs.json), the
vanilla derivation from an extracted Objects tree (sidecar/ghost/
derived-specs.json, now the fallback) and the hulls built from the exported
models (sidecar/hulls.json, likewise), on every vanilla level."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME_DIR = Path(os.environ.get("BF1942_DIR") or Path.home() / ".wine/drive_c/EA Games/Battlefield 1942")
VANILLA = ["wake", "el_alamein", "midway", "aberdeen", "battle_of_the_bulge", "battleaxe", "berlin", "bocage",
           "coral_sea", "gazala", "guadalcanal", "iwo_jima", "kharkov", "kursk", "liberation_of_caen",
           "market_garden", "omaha_beach", "stalingrad", "tobruk"]


class DerivedChildrenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cache = tempfile.mkdtemp(prefix="sidecar-derived-")
        env = {**os.environ, "SIDECAR_CACHE": cls.cache, "VANILLA_LEVELS": ",".join(VANILLA)}
        out = subprocess.run(["node", str(HERE / "sidecar_derived_children_harness.mjs")],
                             capture_output=True, text=True, check=True, env=env)
        cls.r = json.loads(out.stdout.strip().splitlines()[-1])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.cache, ignore_errors=True)

    def _install(self):
        if not self.r["install"]:
            self.skipTest("the BF1942 install is not on this machine")

    def test_the_computed_specs_reproduce_the_six_hand_specs(self):
        self._install()
        self.assertEqual(set(self.r["hand"]), {"M3A1", "Daihatsu", "Sherman", "Zero", "Corsair", "Chi-ha"})
        for t, fields in self.r["hand"].items():
            for k, same in fields.items():
                with self.subTest(template=t, field=k):
                    self.assertIs(same, True, same)

    def test_the_computed_specs_reproduce_the_hand_gunner_seats(self):
        self._install()
        self.assertEqual(len(self.r["handSeats"]), 6)
        for k, fields in self.r["handSeats"].items():
            for f, same in fields.items():
                with self.subTest(seat=k, field=f):
                    self.assertIs(same, True, same)

    def test_the_hand_joint_rows_are_served_and_only_the_daihatsu_ramp_is_not_derived(self):
        self._install()
        for k, j in self.r["handJoints"].items():
            with self.subTest(seat=k):
                self.assertTrue(j["served"])
                # The ramp leaves carry no gun, which the joint rule needs.
                self.assertEqual(j["derived"], k != "Daihatsu+0")

    def test_every_vanilla_level_reproduces_the_vanilla_derivation(self):
        self._install()
        s = self.r["specs"]
        self.assertEqual(s["templates"], s["of"])          # all 54, somewhere
        self.assertGreater(s["compared"], 1000)
        # Kasserine Pass and Battle of Britain declare their own vehicles
        # (LOAD-2) and are not in VANILLA; every other level's are the
        # objects/ ones, the same as the extracted tree's.
        self.assertEqual(s["diffs"], [])

    def test_every_vanilla_level_reproduces_the_exported_hulls(self):
        self._install()
        h = self.r["hulls"]
        self.assertGreater(h["compared"], 1000)
        self.assertEqual(h["diffs"], [])
        # Battle of Britain's own templates (a level not in VANILLA, which
        # declares its own vehicles); every other exported hull is compared.
        self.assertEqual(sorted(h["missing"]), sorted([
            "Britain_Factory", "Britain_Factory_AI", "Clacton_RadarTower", "East_Harwick_RadarTower",
            "Felixstowe_RadarTower", "Ju88A", "RadarTower", "West_Harwick_RadarTower"]))

    def test_mirror_pairs_share_one_networkable(self):
        # NetworkManager::analyseObject groups objects compareProperties
        # finds equal: the Corsair's inner flaps and elevators are mirror
        # pairs, the Zero's elevators differ (TailRight's maxSpeed 0/0/0).
        self._install()
        f = self.r["fresh"]
        self.assertIn("CorsairFlapLeftMiddle=CorsairFlapRightMiddle", f["Corsair"]["nodes"])
        self.assertIn("CorsairFlapTailLeft=CorsairFlapTailRight", f["Corsair"]["nodes"])
        self.assertEqual(f["Corsair"]["children"], "OERRRRRFF")
        self.assertIn("ZeroFlapTailLeft", f["Zero"]["nodes"])
        self.assertIn("ZeroFlapTailRight", f["Zero"]["nodes"])
        self.assertEqual(f["Zero"]["children"], "ERRRRRRFF")
        self.assertIn("WillyFrontWheelR=WillyFrontWheelL", f["Willy"]["nodes"])
        self.assertEqual(f["Willy"]["children"], "ERSSSSR")

    def test_every_fixture_body_reads_to_its_last_bit(self):
        self._install()
        for k, b in self.r["bodies"].items():
            with self.subTest(template=k):
                self.assertGreater(b["n"], 0)
                self.assertEqual(b["exact"], b["n"])

    def test_el_alamein_vehicles_read(self):
        self._install()
        b = self.r["bodies"]
        for t, children in [("Willy", "ERSSSSR"), ("Spitfire", "RRRRREFF"), ("B17", "FRRRRREEEE"),
                            ("M10", "ESSSSRRFF"), ("Priest", "ESSSS"), ("PanzerIV", "ESSSSRRFF")]:
            with self.subTest(template=t):
                self.assertEqual(b[t]["children"], children)
                self.assertEqual(b[t]["exact"], b[t]["n"])

    def test_a_driven_willys_control_states_read(self):
        # 30 of 30 failed live while the Willy fell back to the M3A1's spec.
        self._install()
        c = self.r["control"]
        self.assertGreater(c["n"], 0)
        self.assertEqual(c["exact"], c["n"])
        self.assertTrue(all(abs(v) < 5000 for v in c["first"]))


if __name__ == "__main__":
    unittest.main()
