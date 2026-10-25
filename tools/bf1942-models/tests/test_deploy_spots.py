"""`viewer/deploy-spots.js` -- every flag draws its rings, and only its rings.

The regression: carrier + control-point parity gave land flags a `groups`
array for the first time (`[spawnGroupId, secondSpawnGroupId]`), and the
deploy painter read it as ship deck spots
(`groups.map(g => ({ group: g.group, position: g.position }))`). A numeric
group id has no `.group` and no `.position`, so every land flag mapped to
`{ group: undefined, position: undefined }` spots, and both the ring painter
(`drawSpawnRings`) and the click picker skip position-less spots. The deploy
screen then showed no white dots while number keys and the flag list still
spawned — click-through worked because the spots were never the spawn path.

Driven headless by `deploy_spots_harness.mjs`, the same way `nation.js` is
tested in `test_nation_js.py`: the harness feeds the module the exact flag
shapes `soldier.js` `spawnFlags` builds, so this is the contract between that
join and the deploy screen that reads it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from page_source import page_source  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("deploy_spots_harness.mjs")
MODULES = {"deploy-spots.js": VIEWER / "deploy-spots.js"}


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


class DeploySpotShapeTests(unittest.TestCase):
    """The painter contract itself: spots with positions."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_single_group_land_flag_draws_one_ring_at_its_position(self) -> None:
        spots = self.results["landSingle"]
        self.assertEqual(1, len(spots))
        self.assertIsNone(spots[0]["group"])
        self.assertEqual([0, 0, 0], spots[0]["position"])

    def test_a_dual_group_land_flag_still_draws_one_ring(self) -> None:
        # The regression: groups [2, 6] mapped through the deck shape yields
        # two position-less spots and the flag vanishes from the map.
        spots = self.results["landDual"]
        self.assertEqual(1, len(spots))
        self.assertIsNone(spots[0]["group"])
        self.assertEqual([100, 0, 100], spots[0]["position"])

    def test_a_standalone_base_row_draws_one_ring(self) -> None:
        spots = self.results["standalone"]
        self.assertEqual(1, len(spots))
        self.assertEqual([50, 0, 50], spots[0]["position"])

    def test_a_ship_draws_one_ring_per_deck_group(self) -> None:
        spots = self.results["ship"]
        self.assertEqual(2, len(spots))
        self.assertEqual([64, 65], [s["group"] for s in spots])
        self.assertEqual([[200, 5, 200], [210, 5, 210]],
                         [s["position"] for s in spots])

    def test_a_flag_with_no_position_draws_nothing(self) -> None:
        self.assertEqual([], self.results["empty"])
        self.assertEqual([], self.results["flagless"])
        self.assertEqual([], self.results["missing"])

    def test_a_ship_without_deck_positions_falls_back_to_its_hull(self) -> None:
        spots = self.results["shipNoDeckPositions"]
        self.assertEqual(1, len(spots))
        self.assertEqual([7, 0, 7], spots[0]["position"])

    def test_every_good_spot_survives_the_painters_position_filter(self) -> None:
        drawable = self.results["drawable"]
        self.assertEqual(1, drawable["landSingle"])
        self.assertEqual(1, drawable["landDual"])
        self.assertEqual(1, drawable["standalone"])
        self.assertEqual(2, drawable["ship"])

    def test_the_old_reading_drew_nothing_for_a_land_flag(self) -> None:
        # The defect, stated as shapes: numeric ids through
        # `g => ({ group: g.group, position: g.position })` are two
        # position-less spots, and the painter skips both.
        buggy = self.results["buggyLandDual"]
        self.assertEqual(2, len(buggy))
        self.assertEqual(0, self.results["drawable"]["buggyLandDual"])
        for spot in buggy:
            self.assertNotIn("position", {k for k, v in spot.items() if v is not None})


class DeployGroupSelectionTests(unittest.TestCase):
    """The click/selection law beside the painter."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_nothing_is_chosen_before_a_click(self) -> None:
        # Retail's map has no default: BfMap+0xd4 is zero until a click
        # (SPAWNGRP-12), so a ship offers no group, the helm or any other.
        d = self.results["deployGroup"]
        self.assertIsNone(d["shipUnclicked"])
        self.assertIsNone(d["helmUnclicked"])
        self.assertIsNone(d["allSeats"])
        self.assertIsNone(d["land"])

    def test_a_clicked_group_sticks(self) -> None:
        d = self.results["deployGroup"]
        self.assertEqual(65, d["shipChosen"])
        self.assertEqual(73, d["helmChosen"])
        # a control point's own second group is one of its groups
        self.assertEqual(6, d["landNamed"])

    def test_a_group_of_another_flag_is_not_this_flags(self) -> None:
        d = self.results["deployGroup"]
        self.assertIsNone(d["shipStale"])
        self.assertIsNone(d["landOther"])
        self.assertIsNone(d["none"])

    def test_a_flags_group_ids(self) -> None:
        g = self.results["groupIds"]
        self.assertEqual([1], g["landSingle"])
        self.assertEqual([2, 6], g["landDual"])
        self.assertEqual([64, 65], g["ship"])
        self.assertEqual([4], g["bare"])
        self.assertEqual([], g["none"])

    def test_the_servers_table_decides_a_land_flags_ring(self) -> None:
        r = self.results["served"]
        self.assertEqual([6], r["landHeldAllied"])
        self.assertEqual([], r["landHeldAlliedAxis"])
        self.assertEqual([1], r["landSideFromTable"])
        self.assertEqual([], r["landSideFromTableAxis"])
        self.assertEqual([], r["landOff"])
        self.assertEqual([None], r["landUnknown"])
        self.assertEqual([None], r["landNotLive"])

    def test_the_servers_table_decides_a_decks_rings(self) -> None:
        r = self.results["served"]
        self.assertEqual([73, 74], r["helmByTable"])
        # 72 and 74 are not in the table, so the page's own point state
        # stands for them (both up); 73 is the table's, on, though the page
        # holds its point down.
        self.assertEqual([72, 73, 74], r["deckDownByPage"])
        self.assertEqual([74], r["deckOtherSide"])
        self.assertEqual([True, False, False, None, None, None], r["draws"])

    def test_a_group_no_human_can_spawn_on_is_not_drawn(self) -> None:
        # SPAWNGRP-11: retail draws, and lets a click take, only a group whose
        # active byte is set; Midway's helm group 72 never shows.
        self.assertEqual([73, 74], self.results["offScreen"]["helmOff"])

    def test_a_ship_whose_every_group_is_down_draws_nothing(self) -> None:
        self.assertEqual([], self.results["offScreen"]["shipDown"])

    def test_one_live_point_keeps_its_group_drawn(self) -> None:
        self.assertEqual([5], self.results["offScreen"]["halfOn"])


class DeployWiringTests(unittest.TestCase):
    """The page reads the module, not a copy of it.

    The page (`map.html` and the modules it was split into, `page_source.py`)
    is wiring no node harness imports whole, so the law above is pinned the
    way `test_idle_vehicle.py` pins its own call sites: on the source text.
    A second `flagMapSpots` growing back in the page is the way this defect
    returns uninoticed.
    """

    source = page_source()

    def test_the_page_imports_the_spot_module(self) -> None:
        self.assertIn("from './deploy-spots.js'", self.source)

    def test_the_page_has_no_second_spot_implementation(self) -> None:
        self.assertNotIn("function flagMapSpots(", self.source,
                         "a second flagMapSpots in map.html would bypass the tested module")
        self.assertNotIn("flag.groups.map(g => ({ group: g.group", self.source)

    def test_the_page_has_no_second_group_implementation(self) -> None:
        self.assertEqual(1, self.source.count("function activeDeployGroup("))

    def test_the_painters_call_sites_read_the_module(self) -> None:
        # The painter and the click picker both read the spots through
        # `spawning.js` `deploySpots`, the one wrapper over `flagMapSpots`
        # (it adds the server's table on a sidecar page). A call site may
        # name the module that now holds its argument or the function
        # (`page.deploySpots`, `capture.flags`).
        owner = r"(?:\w+\.)*"
        for call in (r"return flagMapSpots\(flag, \{ team: spawning\.deployTeamId, table: servedTable\(\) \}\)",
                     r"for \(const spot of " + owner + r"deploySpots\(flag\)\)",
                     r"for \(const spot of deploySpots\(" + owner + r"flags\[index\]\)\)",
                     r"spot\.group === " + owner + r"activeDeployGroup\(flag\)"):
            with self.subTest(call=call):
                self.assertRegex(self.source, call)


if __name__ == "__main__":
    unittest.main()
