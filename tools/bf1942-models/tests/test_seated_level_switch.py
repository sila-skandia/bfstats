"""A level switch ends the local player's seat (`tests/seated_level_switch_harness.mjs`).

Switching level from a Sherman's seat left the player seated in the next
level's Zero: `show()` cleared the vehicle registry with the pilot box still
ticked (`markPilot(true)` on the way in) and then read the box again as the
free-fly shortcut -- `setPilot(true)` with no seat picks the level's first
aircraft. No soldier, no deploy screen (the briefing's READY opens it only
with the box unticked), and no world record behind the seat, so
`world-vehicle-tick.js` never ran for him and no gun he boarded from then on
fired. `show()` now ends the seat through `leavePilot` before the registry
goes (`level-load.js`), and the box is not read again.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "seated_level_switch_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class SeatedLevelSwitchTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_seat_is_held_before_the_switch(self) -> None:
        before = self.results["withFix"]["before"]
        self.assertEqual(before, {"seat": "Sherman:Sherman", "pilotBox": True, "worldRecord": True, "mounted": True})

    def test_leave_pilot_ends_the_seat_and_unticks_the_box(self) -> None:
        r = self.results["withFix"]
        self.assertEqual(r["afterLeave"], {"seat": None, "pilotBox": False, "worldRecord": True, "mounted": False})
        # The last man out parks the hull, and the room hears the exit.
        self.assertEqual(r["shermanReset"], 1)
        self.assertEqual(r["netRows"], ["enter", "exit"])

    def test_nothing_of_the_seat_reaches_the_next_level(self) -> None:
        r = self.results["withFix"]
        self.assertEqual(r["after"], {"seat": None, "pilotBox": False, "worldRecord": False, "mounted": False})
        self.assertEqual(r["drives"], 0)

    def test_without_it_the_box_seats_him_in_the_next_levels_aircraft(self) -> None:
        # The control: what the page did before the seat was ended first.
        r = self.results["control"]
        self.assertEqual(r["after"]["seat"], "Zero:Zero")
        self.assertTrue(r["after"]["pilotBox"])
        self.assertFalse(r["after"]["worldRecord"])
        self.assertEqual(r["shermanReset"], 0)
        # A drive was built for the seat, and the held trigger never reached it.
        self.assertEqual(r["drives"], 1)
        self.assertEqual(r["firePulls"], 0)

    def test_a_fresh_entry_on_the_next_level_fires(self) -> None:
        r = self.results["redeploy"]
        self.assertEqual(r["seat"], "Sherman:Sherman")
        self.assertTrue(r["worldRecord"])
        self.assertTrue(r["mounted"])
        self.assertEqual(r["firePulls"], 1)

    def test_the_page_ends_the_seat_before_the_registry_goes(self) -> None:
        level = (VIEWER / "level-load.js").read_text()
        show = level[level.index("async function show(entry)"):]
        leave_at = show.index("page.leavePilot();")
        # After the scene has loaded (a failed load keeps the old level), and
        # before the registry forgets the seat it would otherwise give back.
        self.assertGreater(leave_at, show.index("load.finish('scene');"))
        self.assertLess(leave_at, show.index("page.vehicles.clear();"))
        # The box is never read again as a seat to take.
        self.assertNotIn("page.setPilot(true)", show)
        self.assertNotIn("if (page.optPilot.checked) page.setPilot(", show)

    def test_the_page_hands_the_level_leave_pilot(self) -> None:
        page = (VIEWER / "map.html").read_text()
        bag = re.search(r"const level = createLevel\(bag\((.*?)\n\)\);", page, re.S)
        self.assertIsNotNone(bag, "map.html builds no level bag")
        self.assertRegex(bag.group(1), r"from\(\(\) => localPlayer, `[^`]*\bleavePilot\b")


if __name__ == "__main__":
    unittest.main()
