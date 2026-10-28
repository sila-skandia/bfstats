"""The load settle stands a pad's hull on the terrain the server collides with.

`ResponsePhysics::checkVsTerrain` asks `PatchTerrain::getHeightAndNormal`
(the terrain's vtable `+0x54`, lnxded `0x083d6f10`): the plane of the cell's
triangle and its face normal (TERR-16). The body world's ground
(`viewer/body-pose.js` `bodyTerrain`) read the bilinear height with a
central-difference normal over two cells instead, so a flat cell beside a
quay wall had its normal tilted 58 degrees, and a parked hull on it was pushed
off the quay in its load settle: FHSWEurope Mareth Line's `jeeps` Willy and
the Kubelwagen of the same pad came to rest 20 m down in the harbour, and
Bizerte's `truck` pad's GMC 18.6 m down beside a moored tanker
(features/fhsweurope-extraction, 2026-10-28 "Load-settle outliers").

A hull the level placed up to 1.5 m over a static (a hangar floor, a bridge
deck) is let down onto it (`vehicle-bodies.js` `dropsOntoAStatic`), as the
engine's col0 meets the static's faces on the way down; the terrain-only
settle world dropped Ural Mountains' IS4 39 m through its hangar floor and
The Great Pursuit's KingtigerP 17 m through its bridge. And the room server's
level settle (`server/level-bodies.mjs` `bodySpecFor`) leaves a static root
out, as the page does (PHY-17).

Way to Paris's fourth `armedUC_Spawner` is retail's own: its line
`Object.absolutePosition825.06/47.37/1067.69` has no space, so the console's
first word is the whole line, `Object` + `absolutePosition825.06/...` is no
console object (CON-11, CON-15), and the spawner stays where `Object.create`
made it, the identity matrix (`BObject` ctor `0x08191480`): the world's
origin, 36.9 m under the terrain at the map's corner. The terrain lifts its
AMX13 out (SPAWN-28) onto the ground there.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "load_settle_terrain_harness.mjs"
sys.path.insert(0, str(ROOT))

from bf42.level import parse_static_objects  # noqa: E402


class LoadSettleTerrainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS), str(VIEWER)],
                              capture_output=True, text=True, timeout=900)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
        line = [ln for ln in proc.stdout.splitlines() if ln.startswith("{")][-1]
        cls.r = json.loads(line)
        cls.pads = {}
        for p in cls.r["pads"]:
            cls.pads.setdefault(p["level"], p)
            cls.pads[f"{p['level']}/{p['template']}"] = p

    def test_a_flat_cell_beside_a_wall_is_flat(self) -> None:
        flat = self.r["flatBesideWall"]
        self.assertEqual(flat["normal"], [0, 1, 0])
        self.assertAlmostEqual(flat["height"], 97 * 65535 / 65536, places=3)
        # What the body world read before: the wall two cells away tilted it.
        self.assertGreater(flat["centralDifference"][0], 0.8)

    def test_the_wall_cell_has_its_triangle_face_normal(self) -> None:
        wall = self.r["onWall"]
        self.assertGreater(wall["normal"][0], 0.98)       # 21 m over 4 m
        self.assertLess(wall["height"], 97)

    def pad(self, level: str, template: str | None = None) -> dict:
        pad = self.pads.get(f"{level}/{template}" if template else level)
        if pad is None:
            self.skipTest(f"{level} is not baked here")
        self.assertTrue(pad["found"], pad)
        return pad

    def test_mareth_lines_quay_willy_rests_on_its_pad(self) -> None:
        pad = self.pad("fht_battle_of_mareth_line-1943")
        self.assertLess(pad["horizontal"], 1.0, pad)       # 26.7 m into the harbour before
        self.assertGreater(pad["pos"][1], 96.9, pad)       # 76.6 before
        self.assertGreater(pad["up"], 0.99, pad)

    def test_bizertes_quay_truck_rests_on_its_pad(self) -> None:
        pad = self.pad("bizerte-1943")
        self.assertLess(pad["horizontal"], 1.0, pad)
        self.assertGreater(pad["pos"][1], 95.8, pad)
        self.assertGreater(pad["up"], 0.99, pad)

    def test_way_to_paris_origin_spawner_lifts_its_hull_onto_the_corner(self) -> None:
        pad = self.pad("way_to_paris-1946")
        # On the ground at the map's corner, upright, not 36 m under it.
        self.assertLess(pad["horizontal"], 15.0, pad)
        self.assertGreater(pad["pos"][1], pad["ground"] - 0.5, pad)
        self.assertLess(pad["pos"][1], pad["ground"] + 2.0, pad)
        self.assertGreater(pad["up"], 0.99, pad)

    def test_a_hull_placed_over_a_hangar_floor_lands_on_it(self) -> None:
        pad = self.pad("ural_mountains-1947")
        # The floor's top is 65.85; the terrain 26.8 under it, where it fell before.
        self.assertLess(pad["horizontal"], 0.5, pad)
        self.assertGreater(pad["pos"][1], 65.85, pad)
        self.assertLess(pad["pos"][1], 67.0, pad)
        self.assertGreater(pad["up"], 0.99, pad)

    def test_a_hull_placed_over_a_bridge_deck_lands_on_it(self) -> None:
        pad = self.pad("the_great_pursuit")
        # The deck's top is 109.35; the river bed 92.5 under it.
        self.assertLess(pad["horizontal"], 0.5, pad)
        self.assertGreater(pad["pos"][1], 109.35, pad)
        self.assertLess(pad["pos"][1], 110.9, pad)

    def test_a_static_root_is_no_body_in_the_rooms_settle(self) -> None:
        pad = self.pad("earned_in_blood")
        # Shoved 33 m by `killerCage_RemoverAllies` when the room settled that.
        self.assertLess(pad["horizontal"], 1.0, pad)

    def test_a_hull_beside_a_pad_the_round_never_fills_stays_on_its_own(self) -> None:
        # `mobile_aa_allies` hands out a team-2 LightAA_MkI under the axis base,
        # which never changes hands: retail never spawns it (SPAWN-2). Settled
        # with the round's hulls, 0.5 m away, it pushed the Type94 4.25 m.
        pad = self.pad("fht_pasir_panjang-1942", "Type94_20mmType98AA")
        self.assertLess(pad["horizontal"], 0.5, pad)
        self.assertGreater(pad["up"], 0.99, pad)

    def test_a_pad_the_round_opens_without_settles_alone(self) -> None:
        # The T-34_1942's pad is filed under a point the axis holds and has
        # no axis entry; the KV9 2.3 m from it is axis. The two shoved each
        # other 2.3 and 3.2 m.
        kv9 = self.pad("the_storm", "KV9")
        t34 = self.pad("the_storm", "T-34_1942")
        self.assertLess(kv9["horizontal"], 0.5, kv9)
        self.assertLess(t34["horizontal"], 0.5, t34)

    def test_two_planes_placed_in_each_other_push_apart(self) -> None:
        # Retail's own: both pads team 2 at an unchangeable point, no delay at
        # the start (SPAWN-10), and the Cub's col0 1.8 m inside the
        # Mosquito's. The Cub rests 3-4.5 m from its pad, upright.
        pad = self.pad("operation_blackknight-1945", "Cub_Rosie_the_Rocketeer")
        self.assertGreater(pad["horizontal"], 2.5, pad)
        self.assertLess(pad["horizontal"], 6.0, pad)
        self.assertGreater(pad["up"], 0.95, pad)

    def test_the_template_a_pad_stands_first(self) -> None:
        first = self.r["first"]
        self.assertIsNone(first["otherSideOnly"])         # SPAWN-2: no entry, nothing
        self.assertEqual(first["ownSide"], "type94_20mmtype98aa")
        self.assertEqual(first["bothSides"], "T88HMC")    # the holder's
        self.assertIsNone(first["neutralNoTeam"])         # SPAWN-19: off
        self.assertEqual(first["neutralOwnTeam"], "b")    # its own Object.setTeam
        self.assertEqual(first["noPoint"], "b")           # the baked vehicle

    def test_a_template_named_with_digits_is_its_whole_tag(self) -> None:
        self.assertEqual(self.r["templateOf"]["tagged"], "T-34_1942")
        self.assertEqual(self.r["templateOf"]["suffixedName"], "Sherman")

    def test_a_position_glued_to_its_word_places_nothing(self) -> None:
        text = ("Object.create armedUC_Spawner\n"
                "Object.absolutePosition825.06/47.37/1067.69\n"
                "Object.rotation 135/0/0\n")
        [spawner] = parse_static_objects(text)
        self.assertEqual(spawner.position, (0.0, 0.0, 0.0))
        self.assertEqual(spawner.rotation, (135.0, 0.0, 0.0))


if __name__ == "__main__":
    unittest.main()
