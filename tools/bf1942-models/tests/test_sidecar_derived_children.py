"""Vehicle ghost bodies for every vanilla vehicle: the child networkables
derived from the template graph (sidecar/ghost/derive-children.mjs ->
derived-specs.json, the fallback of children.mjs), checked against the
hand-proven Wake specs and against real wire bodies from Wake and
El Alamein. features/udp-sidecar/decodes/vehicle-children.md section 6."""
import json
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class DerivedChildrenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", str(HERE / "sidecar_derived_children_harness.mjs")],
                             capture_output=True, text=True, check=True)
        cls.r = json.loads(out.stdout)

    def _tree(self):
        if not self.r["tree"]:
            self.skipTest("the extracted vanilla Objects tree is not on this machine")

    def test_the_derivation_reproduces_the_six_wake_specs(self):
        self._tree()
        hand = self.r["hand"]
        self.assertEqual(set(hand), {"M3A1", "Daihatsu", "Sherman", "Zero", "Corsair", "Chi-ha"})
        for t, pair in hand.items():
            with self.subTest(template=t):
                self.assertEqual(pair["derived"], pair["hand"])

    def test_the_derivation_reproduces_the_hand_gunner_seats(self):
        self._tree()
        for k, pair in self.r["handSeats"].items():
            with self.subTest(seat=k):
                self.assertEqual(pair["derived"], pair["hand"])

    def test_derived_specs_json_is_the_current_derivation(self):
        self._tree()
        self.assertTrue(self.r["inSync"], "re-run node sidecar/ghost/derive-children.mjs")

    def test_mirror_pairs_share_one_networkable(self):
        # NetworkManager::analyseObject groups objects compareProperties
        # finds equal: the Corsair's inner flaps and elevators are mirror
        # pairs, the Zero's elevators differ (TailRight's maxSpeed 0/0/0).
        self._tree()
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
        for k, b in self.r["bodies"].items():
            with self.subTest(template=k):
                self.assertGreater(b["n"], 0)
                self.assertEqual(b["exact"], b["n"])

    def test_el_alamein_vehicles_read_and_the_m3a1_fallback_did_not(self):
        b = self.r["bodies"]
        for t, children in [("Willy", "ERSSSSR"), ("Spitfire", "RRRRREFF"), ("B17", "FRRRRREEEE"),
                            ("M10", "ESSSSRRFF"), ("Priest", "ESSSS"), ("PanzerIV", "ESSSSRRFF")]:
            with self.subTest(template=t):
                self.assertEqual(b[t]["children"], children)
                self.assertEqual(b[t]["exact"], b[t]["n"])
                self.assertEqual(b[t]["m3a1"], 0)

    def test_a_driven_willys_control_states_read(self):
        # 30 of 30 failed live while the Willy fell back to the M3A1's spec.
        c = self.r["control"]
        self.assertGreater(c["n"], 0)
        self.assertEqual(c["exact"], c["n"])
        self.assertTrue(all(abs(v) < 5000 for v in c["first"]))


if __name__ == "__main__":
    unittest.main()
