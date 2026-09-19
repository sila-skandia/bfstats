"""`viewer/combat-area.js` -- `game.setActiveCombatArea`, driven headless by
`combat_area_harness.mjs`.

The module reproduces what the retail game does when a player leaves the
combat area. Every number these tests pin was read out of the unstripped Linux
dedicated server (`bf1942_lnxded (1).static`, 1.61) or out of `menu/InGame`,
and the module's own header carries the addresses:

  * `Game::setActiveCombatArea(float, float, float, float)` at 0x08061840
    takes an ORIGIN and a SIZE, not two corners. Berlin proves it without any
    decompiling: `1536 1536 512 512` on a 2048 m world is x 1536..2048 read as
    origin+size and the impossible x 1536..512 read as a corner pair.
  * `Game::setTimeAllowedOutSideWorld(unsigned char)` -> Game+0x6c, default
    10 s (`GameServer::init`, 0x08131dbb, `mov BYTE PTR [ebx+0x6c], 0xa`).
  * `GameServer::setDamageForBeingOutSideWorld(float)` -> GameServer+0x2e8,
    default 5.0 (0x08131db1, `mov DWORD PTR [ebx+0x2e8], 0x40a00000`).
  * In `GameServer::gameStatusPlaying(float dt)` the damage is applied as
    `dt * damageForBeingOutSideWorld` every frame (0x0815247b-0x08152480), so
    it is a RATE, not a lump at the buzzer; the in-bounds branch zeroes the
    per-player accumulator at player+0x178 (0x08152553).

So a 30 HP soldier gets a 10 second warning and then takes six more seconds to
die. That 16 second figure is the test below.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("combat_area_harness.mjs")
MODULES = {"combat-area.js": VIEWER / "combat-area.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class CombatAreaTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # ---- the engine's constants ------------------------------------------

    def test_the_engine_defaults_are_ten_seconds_and_five_hp_a_second(self) -> None:
        c = self.results["constants"]
        self.assertEqual(10, c["timeAllowed"])
        self.assertEqual(5, c["damagePerSecond"])

    def test_the_warning_is_the_layouts_own_string_misspelling_included(self) -> None:
        # menu/InGame entry #42's TextNode carries this as its Wstring default
        # under the name `Outside/OutsideText`. It is NOT the lexicon's
        # `DESSERTION_MESSAGE` ("Warning! You are leaving combat area.
        # Deserters will be shot."), which is a different wording that node
        # never reads. Pinned verbatim because an invented string here is
        # exactly the kind of thing the next reader would trust.
        self.assertEqual(
            "Warning! You are leaving the combat area! Desserters will be shot!",
            self.results["constants"]["text"])

    def test_the_warning_colour_is_the_layouts_own(self) -> None:
        r, g, b = self.results["constants"]["color"]
        self.assertAlmostEqual(0.8515629768371582, r)
        self.assertAlmostEqual(0.3515625, g)
        self.assertAlmostEqual(0.3515625, b)

    # ---- reading the rect out of scene.json ------------------------------

    def test_berlins_rect_survives_the_extractors_z_negation(self) -> None:
        # `extract_map.py` runs both corners through `_to_gltf_vec`, which
        # negates z -- so `min.z` arrives as the LARGER of the two and a naive
        # min<=v<=max test would find every position outside.
        rect = self.results["rects"]["berlinReal"]
        self.assertEqual({"minX": 1536, "maxX": 2048,
                          "minZ": -2048, "maxZ": -1536}, rect)

    def test_a_level_with_no_area_yields_no_rect(self) -> None:
        # 12 of the 23 vanilla levels, Wake among them, declare no
        # `game.setActiveCombatArea` at all and carry `combatArea: null`.
        for key in ("wake", "missing", "nullExtras"):
            with self.subTest(key):
                self.assertIsNone(self.results["rects"][key])

    def test_malformed_or_degenerate_declarations_yield_no_rect(self) -> None:
        # A zero-area rect is a level saying nothing, not a level where every
        # position is outside and everyone bleeds out.
        for key in ("malformed", "nonFinite", "degenerate"):
            with self.subTest(key):
                self.assertIsNone(self.results["rects"][key])

    # ---- the test itself --------------------------------------------------

    def test_the_edge_is_inside_and_one_metre_past_it_is_not(self) -> None:
        inside = self.results["inside"]
        self.assertTrue(inside["centre"])
        self.assertTrue(inside["cornerMin"])
        self.assertTrue(inside["cornerMax"])
        for key in ("westOut", "eastOut", "northOut", "southOut"):
            with self.subTest(key):
                self.assertFalse(inside[key])

    def test_no_rect_means_everywhere_is_inside(self) -> None:
        self.assertTrue(self.results["inside"]["noRect"])
        self.assertEqual(0, self.results["distance"]["noRect"])

    def test_distance_outside_is_the_gap_to_the_nearest_edge(self) -> None:
        d = self.results["distance"]
        self.assertEqual(0, d["inside"])
        self.assertEqual(10, d["west10"])
        # 3 m west of minX and 4 m north of maxZ -> the 3-4-5 corner.
        self.assertEqual(5, d["corner"])

    # ---- the timer and the damage ----------------------------------------

    def test_a_level_with_no_area_never_warns_or_damages(self) -> None:
        inert = self.results["inert"]
        self.assertFalse(inert["active"])
        for frame in inert["frames"]:
            self.assertTrue(frame["inside"])
            self.assertEqual(0, frame["countdown"])
            self.assertEqual(0, frame["damage"])

    def test_the_countdown_runs_down_from_the_allowance(self) -> None:
        frames = self.results["walkOut"]["frames"]
        # Frame 0 is inside: no warning. Then one second a frame.
        self.assertEqual([0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0],
                         [f["countdown"] for f in frames])

    def test_damage_starts_only_after_the_allowance_and_is_a_rate(self) -> None:
        frames = self.results["walkOut"]["frames"]
        damage = [f["damage"] for f in frames]
        # Nothing for the first ten seconds outside, then 5 HP per second of
        # dt -- `dt * damageForBeingOutSideWorld`, every frame.
        self.assertEqual([0] * 11, damage[:11])
        self.assertEqual([5, 5], damage[11:])

    def test_a_thirty_hp_soldier_dies_sixteen_seconds_after_leaving(self) -> None:
        # 10 s of warning, then 30 HP at 5 HP/s is 6 s more. The whole point
        # of reading the engine rather than guessing: an instant kill at the
        # buzzer would have been the obvious wrong implementation.
        lethality = self.results["lethality"]
        self.assertAlmostEqual(10.1, lethality["firstDamageAt"], places=6)
        self.assertAlmostEqual(16.0, lethality["deadAt"], places=6)

    def test_coming_back_inside_zeroes_the_accumulator(self) -> None:
        # The engine's own `mov DWORD PTR [esi+0x178], 0` on the in-bounds
        # branch (0x08152553): the allowance is not a budget spent once.
        back = self.results["reenter"]["back"]
        self.assertTrue(back["inside"])
        self.assertEqual(0, back["outsideFor"])
        self.assertTrue(back["entered"])
        again = self.results["reenter"]["outAgain"]
        self.assertEqual(1, again["outsideFor"])
        self.assertEqual(9, again["countdown"])
        self.assertTrue(again["left"])

    def test_a_junk_timestep_cannot_poison_the_accumulator(self) -> None:
        self.assertEqual([0, 0, 0], self.results["junkDt"])

    # ---- what it hands the HUD -------------------------------------------

    def test_inside_the_area_the_countdown_is_zero_so_the_group_culls(self) -> None:
        # `menu/InGame` gates the whole group on `0 < Outside/OutsideTime`, so
        # a zero is how the layout is told to draw nothing.
        vars_ = self.results["feedInside"]
        self.assertEqual(0, vars_["Outside/OutsideTime"])

    def test_outside_it_feeds_the_countdown_text_and_colour(self) -> None:
        # `hud.js` lists a text leaf's `var` as required, so the string has to
        # be fed even though it never changes -- an unfed one culls the line
        # and leaves an empty plate.
        vars_ = self.results["feedOutside"]
        self.assertEqual(8, vars_["Outside/OutsideTime"])
        self.assertEqual(self.results["constants"]["text"],
                         vars_["Outside/OutsideText"])
        self.assertAlmostEqual(0.8515629768371582, vars_["Outside/Color/Red"])

    # ---- a mod that overrides the constants -------------------------------

    def test_a_level_may_override_both_constants(self) -> None:
        # `Game.damageForBeingOutSideWorld` is a real con verb: bfheroes sets
        # it to 120-350 across its levels. Vanilla never does (surveyed every
        # .con in all 72 vanilla archives: zero hits), so vanilla runs on the
        # engine defaults above.
        over = self.results["overridden"]
        self.assertEqual(3, over["timeAllowed"])
        self.assertEqual(300, over["damagePerSecond"])
        self.assertEqual([2, 1, 0, 0, 0], [f["countdown"] for f in over["frames"]])
        self.assertEqual([0, 0, 0, 300, 300], [f["damage"] for f in over["frames"]])

    def test_the_accumulator_is_clamped_back_to_the_allowance(self) -> None:
        # The engine writes the allowance itself into player+0x178 on every
        # damage frame (`mov al,[ecx+0x6c]` 0x081524a8, `fild` 0x081524ac,
        # `fstp [esi+0x178]` 0x081524b2) instead of letting the total grow.
        # A minute out of the area therefore reads 10, not 60.
        clamp = self.results["clamp"]
        self.assertEqual(10, clamp["afterSixtySeconds"]["outsideFor"])
        self.assertEqual(10, clamp["atFirstDamage"]["outsideFor"])

    def test_the_clamp_costs_no_damage(self) -> None:
        # Each later frame re-crosses the allowance by its own dt, so the
        # clamp is bookkeeping: 50 of the 60 one-second frames damage, at the
        # engine's 5 HP a second.
        clamp = self.results["clamp"]
        self.assertEqual(50, clamp["damagingFrames"])
        self.assertEqual(250.0, clamp["totalDamage"])
        self.assertEqual(5, clamp["afterSixtySeconds"]["damage"])
        self.assertEqual(0, clamp["afterSixtySeconds"]["countdown"])

    def test_the_area_is_inclusive_on_all_four_edges(self) -> None:
        # Read out of the four x87 comparisons at 0x081523c1 / 0x081523d7 /
        # 0x081523ec / 0x08152403: each branch leaves the area only on a
        # strict `>`, so standing exactly on an edge is still inside.
        edges = self.results["edges"]
        self.assertTrue(edges["minCorner"])
        self.assertTrue(edges["maxCorner"])
        self.assertFalse(edges["justOutsideMinX"])
        self.assertFalse(edges["justOutsideMaxX"])
        self.assertFalse(edges["justOutsideMinZ"])
        self.assertFalse(edges["justOutsideMaxZ"])


if __name__ == "__main__":
    unittest.main()
