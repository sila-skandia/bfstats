"""The route probe (features/bot-map-generation, section 18).

Whether the page's own bots can finish a route to a flag on a layer's own
map, asked of the page's own route code (`viewer/nav-search.js`, as
`viewer/bot-route.js extendRoute` runs it), and how much of that route one
teammate standing still shuts. On the community map The_Maze two flags at
the top of narrow ramps were reachable by the walk test and by the map's
connectivity, and were never taken in twenty matches: every bot sent there
queued behind the first one that stopped.

`tests/route_probe_harness.mjs` writes a map by hand (a field, a passage
two cells wide, one nine cells wide, a room nothing joins) and runs
`sim/routeprobe.mjs`, the generator's reading of it and the lint on it.
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "route_probe_harness.mjs"

_OUT: dict | None = None


def run_harness() -> dict:
    global _OUT
    if _OUT is None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise AssertionError(f"route_probe_harness.mjs failed:\n{proc.stderr[-3000:]}")
        _OUT = json.loads(proc.stdout.strip().splitlines()[-1])
    return _OUT


class RouteProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_probe_reads_the_pages_own_numbers(self) -> None:
        # `bot-route.js`: the least box a leg is searched in (10 + 1 m), six
        # wider tries, and the circle a soldier plants on a still teammate.
        t = self.out["tools"]
        self.assertEqual((t["radius"], t["widenings"], t["teammate"]), (11, 6, 2))
        self.assertEqual(t["chokeMax"], 4)

    def test_open_ground_and_a_wide_passage_are_open_ways(self) -> None:
        for key in ("field", "yard"):
            w = self.out["ways"][key]
            self.assertEqual((w["ok"], w["open"], w["chokes"], w["failures"]), (True, True, 0, 0), key)

    def test_a_narrow_passage_closes_on_the_bare_map(self) -> None:
        # The cells are joined and the planner closes every leg on its first
        # plan: no test of the map alone finds the fault.
        bare = self.out["bare"]
        self.assertTrue(bare["ok"])
        self.assertEqual(bare["failures"], 0)
        self.assertEqual(bare["ends"], [225.5, -61.5])

    def test_one_standing_teammate_shuts_a_narrow_passage(self) -> None:
        # A hundred metres two cells wide: a 2 m circle on any point of it
        # is the passage, far past the most DICE's levels ask (four points).
        w = self.out["ways"]["tower"]
        self.assertTrue(w["ok"])
        self.assertFalse(w["open"])
        self.assertGreater(w["chokes"], 20)
        self.assertEqual(w["stage"], "choke")
        self.assertTrue(self.out["chokeInPassage"])

    def test_a_room_nothing_joins_fails_in_the_planner(self) -> None:
        w = self.out["ways"]["vault"]
        self.assertFalse(w["ok"])
        self.assertFalse(w["open"])
        self.assertIn(w["stage"], ("strategic", "leg"))

    def test_a_side_reaches_the_flags_it_has_an_open_way_to(self) -> None:
        lv = self.out["level"]
        self.assertEqual(lv["sides"], {"Field": [1, 2], "Tower": [], "Yard": [1, 2], "Vault": []})
        self.assertEqual(lv["reach"], {"1": ["Field", "Yard"], "2": ["Field", "Yard"]})
        self.assertEqual(lv["towerStop"], "choke")
        self.assertIn("Field>Tower", lv["shutLinks"])
        self.assertNotIn("Field>Yard", lv["shutLinks"])

    def test_the_generator_takes_out_a_flag_no_side_has_a_way_to(self) -> None:
        m = self.out["marker"]
        self.assertEqual(m["unreachable"], ["Tower", "Vault"])
        self.assertEqual(m["stops"]["Tower"], ["choke", "choke"])
        self.assertEqual(m["oneSided"], {})
        self.assertEqual(m["chokeMax"], 4)
        self.assertEqual(m["fieldChokes"], 0)
        self.assertGreater(m["towerChokes"], 20)

    def test_a_side_based_behind_a_narrow_passage_reaches_nothing(self) -> None:
        lop = self.out["lopsided"]
        self.assertEqual(lop["sides"], {"Field": [1], "Yard": [1]})
        self.assertEqual(lop["reach2"], [])

    def test_the_lint_names_a_shut_flag_a_one_sided_flag_and_a_dead_side(self) -> None:
        lint = self.out["lint"]
        # A flag in play nobody has a way to: an error each, and the reason.
        all_ = lint["all"]
        self.assertEqual(all_["facts"]["shut"], ["Tower", "Vault"])
        self.assertTrue(any("control point Tower: no bot's route to it is open" in t and "one teammate standing still" in t for t in all_["errors"]))
        self.assertTrue(any("control point Vault" in t for t in all_["errors"]))
        self.assertEqual(all_["dead"], [])
        # Nothing to say of a level whose flags both sides reach.
        self.assertEqual((lint["sound"]["errors"], lint["sound"]["warnings"]), ([], []))
        # One side alone: a warning that names it; the other side reaching nothing: a dead level.
        lop = lint["lopsided"]
        self.assertTrue(any("only side 1's bots have an open route" in t for t in lop["warnings"]))
        self.assertTrue(any("side 2's bots have an open route to none of the 2 flags in play" in t for t in lop["errors"]))
        self.assertEqual(lop["dead"], ["no-route"])


if __name__ == "__main__":
    unittest.main()
