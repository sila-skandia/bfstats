"""Retail-parity fixes to the bots of 2026-11-12 (the bots-ai cross-check).

* The anti-aircraft term `C` of a bot's AI spread (ledger AI-18, AI-68):
  `EntryTrigger::execute` 0x086257d0 hands `setBotSkill` 30 from a ground
  shooter at an air target (0x08625eb8), 10 from naval equipment
  (0x08625e8c), 0 from an aircraft or at a ground target, and
  `EntryTriggerContinously` 0x08625ff0 3 / 1. `WeaponFireArm::setBotSkill`
  0x085ee580 weighs it by `1 - 0.75 skill`: at 0.75, +13.125.
* `DecleiningSlopeCurve::calculate` 0x08655560 takes `table[trunc(100 x)]`
  with no blend, over the 101 floats `init` 0x08655170 writes;
  `SCurve::calculate` 0x08658420 blends its table (bot-sense.js).
"""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.test_bot_ai import MODULES, THREE_PACKAGE, VIEWER

HARNESS = Path(__file__).resolve().parent / "bot_retail_parity_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class BotRetailParityTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_anti_aircraft_penalty_follows_entry_trigger(self) -> None:
        p = self.results["penalty"]
        self.assertEqual(p["footAtAir"], 30.0)
        self.assertEqual(p["tankAtAir"], 30.0)
        self.assertEqual(p["shipAtAir"], 10.0)
        self.assertEqual(p["airAtAir"], 0)
        self.assertEqual(p["footAtGround"], 0)
        self.assertEqual(p["heldFootAtAir"], 3.0)
        self.assertEqual(p["heldShipAtAir"], 1.0)

    def test_a_ground_bot_spreads_wider_at_an_aircraft_by_the_binary_amount(self) -> None:
        s = self.results["spread"]
        # (1 - 0.75 x 0.75) x 30 = 13.125, the settled weapon term 5 x 0.25 x 0.25.
        self.assertAlmostEqual(s["ground"], 0.3125, places=6)
        self.assertAlmostEqual(s["air"] - s["ground"], 13.125, places=6)

    def test_bot_tick_passes_the_penalty(self) -> None:
        src = (VIEWER / "bot.js").read_text()
        self.assertIn("aaPenalty: aa,", src)
        self.assertIn("TriggerContinously", src)

    def test_declein_is_the_binary_table_without_a_blend(self) -> None:
        d = self.results["declein"]
        t = self.results["decleinTable"]
        self.assertEqual(t["n"], 101)
        self.assertAlmostEqual(t["i1"], 0.0292421058, places=9)
        self.assertEqual(d[0], 0)
        self.assertEqual(d[1], 0)            # trunc(0.5) = 0: entry 0
        self.assertEqual(d[2], 0.0292421058)  # trunc(1.99) = 1
        self.assertEqual(d[3], 0.0584842116)  # entry 2
        self.assertEqual(d[4], t["i39"])      # trunc(39.5) = 39, no blend toward 40
        self.assertEqual(d[6], 1)
        self.assertEqual(d[7], 1)

    def test_scurve_is_the_exact_table(self) -> None:
        self.assertTrue(self.results["sCurveSame"])
        self.assertAlmostEqual(self.results["scurve37"], 0.231592, places=5)


    def test_the_vehicle_split_is_the_bots_inclinations(self) -> None:
        # BBChange 0x0855e0c0: [fire, move] / (fire + move); move only [0, 1];
        # fire only [1, 0]; neither [0.5, 0.5] (AI-43 corrected).
        sp = self.results["split"]
        self.assertEqual(sp["both"], [0.75, 0.25])
        self.assertEqual(sp["moveOnly"], [0.0, 1.0])
        self.assertEqual(sp["fireOnly"], [1.0, 0.0])
        self.assertEqual(sp["neither"], [0.5, 0.5])
        self.assertEqual(sp["legacy"], [0.5, 0.5])

    def test_inclinations_smooth_by_point_eight(self) -> None:
        # step*Inclination 0x0852e2d0 / 0x0852e360: v = 0.8 v + 0.2 acc, acc = 0.
        st = self.results["step"]
        self.assertAlmostEqual(st["first"]["fire"], 2.0, places=5)
        self.assertAlmostEqual(st["first"]["move"], 1.0, places=5)
        self.assertEqual(st["first"]["fireAcc"], 0)
        self.assertAlmostEqual(st["second"]["fire"], 3.6, places=5)
        self.assertAlmostEqual(st["second"]["move"], 0.8, places=5)

    def test_change_inhibit_is_the_files_and_per_row(self) -> None:
        c = self.results["columns"]
        want = {"Avoid": 0.8, "MoveTo": 0.0, "Idle": 0.01, "Fire": 0.75, "Special": 0.0, "Scout": 0.5, "TakeCover": 1.0, "Change": 1.0}
        self.assertEqual(c["tankChange"], want)
        self.assertEqual(c["seatActive"], want)
        self.assertEqual(c["rowlessSeat"], want)
        ones = {k: 1.0 for k in want}
        self.assertEqual(c["footChange"], ones)
        self.assertEqual(c["footActive"], ones)
        self.assertEqual(c["carChange"], ones)
        self.assertIsNone(c["fixedAvoid"])
        self.assertEqual(c["fireActive"], ones)
        self.assertEqual(c["bf1918Foot"]["Fire"], 3.0)


    def test_an_unarmed_seat_weighs_manned_hulls_as_bbfireunarmed(self) -> None:
        # BBFireUnarmed 0x0856eb90: sum over seats (table[my] + basicTemp) x
        # classValue[target] (HeavyArmour 8), / max(0.1, 0.3 d), d >= 0.5, 250 m reach.
        u = self.results["unarmed"]
        self.assertAlmostEqual(u["tank100"]["best"], (2 + 3 + 1 + 0) * 8 / 30.0, places=5)
        self.assertEqual(u["tank100"]["targetId"], "t")
        self.assertAlmostEqual(u["tank1"]["best"], 6 * 8 / 0.15, places=4)
        self.assertEqual(u["far"]["best"], 0)
        self.assertEqual(u["emptyAndSoldier"]["best"], 0)
        self.assertAlmostEqual(u["lost"]["best"], (6 * 8 / 30.0) / 1.5, places=5)
        self.assertAlmostEqual(u["harmless"]["best"], 6 * 3 / 3.0 * 0.33, places=5)
        self.assertAlmostEqual(u["outside"]["best"], (6 * 8 / 30.0) * 0.75, places=5)


if __name__ == "__main__":
    unittest.main()
