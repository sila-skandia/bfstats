"""A moving deck carries the soldier standing on it, by the friction alone
(`viewer/deck-carry.js`, `viewer/walking-body.js` `#contactLaw`,
`tests/deck_carry_harness.mjs`).

Retail has no parenting: the object a soldier stands on is kept only for the
netcode (`BFSoldier::handleCollision` 0x0827d3b0 writes `+0x558`, read by
`BFSoldierNetworkable::updateStateMask` 0x082228e4 alone). An object contact's
speed is `getTangentSpeed` of both roots at the hit (`checkObjectVsObject`
0x08259690, `PhysicsNode::getTangentSpeed` 0x08254b90), meaned into `+0x74`
by `impulseOn` 0x08258900, and `addFriction` 0x0825b6e0 works on `+0x74` less
the soldier's own surface speed (0x0825b887..0x0825b8ae). So the friction
pulls them onto the deck's point speed, spin included, and their command is a
speed over the deck. The page's soldier met its friction against the fixed
world: the 2026-11-12 audit measured a soldier left behind at the deck's whole
speed, off the stern of a 40 m deck at 8 m/s within 3 s.

The friction is soldier law PHY-34 unchanged (measured on the lab to 1 mm,
`tests/test_move_law.py`): its 0.1 m^2/s^2 handler gate, now on the relative
speed, leaves the air drag of the deck's speed un-cancelled below 0.32 m/s,
so a soldier standing still creeps aft by a few decimetres a second at
destroyer speed. That creep is the engine's law as read, not a tolerance.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "deck_carry_harness.mjs"


class DeckCarryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=180)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_straight_deck_carries_them(self) -> None:
        for run in self.r["straight"]:
            with self.subTest(speed=run["speed"]):
                # Before: 3, 9 and 24 m aft, and off the stern at 8 m/s.
                self.assertIsNone(run["offAt"])
                self.assertEqual(2.0, run["y"])
                # The start (the deck going from rest to its speed in one tick,
                # the kinetic budget 4.8 g dt a tick) and the creep under the
                # handler gate: under 1.5 m in 3 s at 8 m/s.
                self.assertLess(abs(run["drift"]["x"]), 0.2 * run["speed"] + 0.1)
                self.assertLess(abs(run["drift"]["z"]), 1e-3)
                # Their own speed is the deck's, within the gate's 0.32 m/s.
                self.assertLess(abs(run["v"]["x"] - run["speed"]), 0.32)

    def test_a_turning_deck_does_not_throw_them_off(self) -> None:
        run = self.r["turning"]
        # Before: 8.6 m sideways and off the side, 15 m from the pivot.
        self.assertIsNone(run["offAt"])
        self.assertEqual(2.0, run["y"])
        self.assertLess(abs(run["drift"]["x"]) + abs(run["drift"]["z"]), 1.0)
        # Their speed is the deck's point speed, 3 m/s round the pivot.
        self.assertAlmostEqual(3.0, (run["v"]["x"] ** 2 + run["v"]["z"] ** 2) ** 0.5, delta=0.32)

    def test_a_deck_gathering_way_takes_them_with_it(self) -> None:
        run = self.r["accelerating"]
        self.assertIsNone(run["offAt"])
        self.assertLess(abs(run["drift"]["x"]), 1.5)
        self.assertLess(abs(run["v"]["x"] - 8.0), 0.32)

    def test_they_run_over_the_deck_at_their_own_speed(self) -> None:
        still, moving = self.r["still"], self.r["walking"]
        self.assertIsNone(moving["offAt"])
        # The run over a deck at 8 m/s is the run over a still one, less the
        # deck's start (about a metre, as above).
        self.assertGreater(moving["drift"]["x"], 8.0)
        self.assertLess(abs(moving["drift"]["x"] - still["drift"]["x"]), 1.5)
        self.assertAlmostEqual(still["v"]["x"] + 8.0, moving["v"]["x"], delta=0.32)

    def test_a_landing_craft_well_carries_them(self) -> None:
        run = self.r["well"]
        self.assertIsNone(run["offAt"])
        self.assertEqual(2.0, run["y"])
        self.assertLess(abs(run["drift"]["x"]), 1.5)


if __name__ == "__main__":
    unittest.main()
