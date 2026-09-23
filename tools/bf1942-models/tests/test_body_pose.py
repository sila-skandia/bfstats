"""`viewer/body-pose.js bodyTerrain`: a parked body's ground includes the decks.

A hull placed on a drivable deck (El Alamein's Sherman_1 stands on a pad 0.68 m
above the heightfield) used to settle through it onto the terrain, because the
body world's ground was the heightfield alone, and rose 0.64 m when boarded:
its drive rides the deck. With the collider handed in, a vertex asking from
its own height finds the deck within `deckStep` above it, as a driven wheel's
probe does (`surfaceHeight(x, z, axle + DECK_STEP_UP)`); asked without a
height (the driven hull's terrain damage) it is the heightfield, as before.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "viewer" / "body-pose.js"

SCRIPT = """
import { bodyTerrain } from %s;
const heightfield = {
  height: () => 60.0,
  normal: (x, z, out) => { out[0] = 0; out[1] = 1; out[2] = 0; return out; },
  material: () => 7,
};
// A pad at 60.68 over x in [0, 10]; `deckSurface(x, z, fromY)` answers the deck
// at or below `fromY` when it is above the ground there.
const collider = {
  deckSurface(x, z, fromY) {
    if (x < 0 || x > 10 || fromY < 60.68) return null;
    return { y: 60.68, nx: 0.1, ny: 0.99, nz: 0, material: 42 };
  },
};
const plain = bodyTerrain(heightfield, null);
const decked = bodyTerrain(heightfield, null, collider, 0.5);
const n = [0, 0, 0];
const out = {
  plain: plain.height(5, 0, 60.5),
  sunk: decked.height(5, 0, 60.5),
  under: decked.height(5, 0, 59.0),
  noY: decked.height(5, 0),
  off: decked.height(20, 0, 60.5),
  normal: [...decked.normal(5, 0, n, 60.5)],
  material: decked.material(5, 0, 60.5),
  groundMaterial: decked.material(20, 0, 60.5),
};
process.stdout.write(JSON.stringify(out));
"""


class BodyTerrainDeckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", SCRIPT % json.dumps(MODULE.as_uri())],
            capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_heightfield_alone_without_a_collider(self) -> None:
        self.assertEqual(self.r["plain"], 60.0)

    def test_a_vertex_sunk_in_a_deck_stands_on_it(self) -> None:
        self.assertAlmostEqual(self.r["sunk"], 60.68)
        self.assertEqual(self.r["normal"], [0.1, 0.99, 0])
        self.assertEqual(self.r["material"], 42)

    def test_a_deck_out_of_step_reach_is_not_ground(self) -> None:
        self.assertEqual(self.r["under"], 60.0)          # 1.68 m below the deck
        self.assertEqual(self.r["noY"], 60.0)            # asked without a height
        self.assertEqual(self.r["off"], 60.0)            # off the pad
        self.assertEqual(self.r["groundMaterial"], 7)


if __name__ == "__main__":
    unittest.main()
