"""`viewer/server-entities.js`: a hull the SERVER stands turns its propellers,
rotors and screws on the revs the server sent for its Engine children.

A client is told these; it does not derive them. `EngineNetworkable::
updateStateMask` (0x08227620) puts `PhysicsEngine+0xa0` -- the same float the
server recorder reads as revs -- on the wire under mask bit 0x080, and
`setNetUpdate` (0x08227da0) writes it back to the same offset, which is what
the tail of `PhysicsEngine::updatePhysics` spins the Engine's first child
LodObject from (ledger PHY-30).
"""

from __future__ import annotations

import json
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

VIEWER = Path(__file__).resolve().parents[1] / "viewer"
HARNESS = Path(__file__).resolve().parent / "server_engine_spin_harness.mjs"


def _closure(entry: str) -> set[str]:
    """`entry` and every viewer module it imports, transitively.

    Each import is resolved against the directory of the file that makes it, so
    a module that lives in a subdirectory can reach its siblings:
    `vendor/loaders/GLTFLoader.js` imports `../utils/BufferGeometryUtils.js`,
    which is `vendor/utils/BufferGeometryUtils.js` and not a root-level name.
    """
    seen: set[str] = set()
    queue = [entry]
    while queue:
        name = queue.pop()
        if name in seen or not (VIEWER / name).exists():
            continue
        seen.add(name)
        here = posixpath.dirname(name)
        for spec in re.findall(r"from '(\.\.?/[^']+\.js)'", (VIEWER / name).read_text()):
            queue.append(posixpath.normpath(posixpath.join(here, spec)))
    return seen


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in _closure("server-entities.js"):
            # A closure member can sit in a subdirectory (`vendor/utils/...`),
            # and copyfile will not create it.
            (work / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(VIEWER / name, work / name)
        (work / "node_modules" / "three").mkdir(parents=True)
        shutil.copyfile(VIEWER / "vendor" / "three.module.js",
                        work / "node_modules" / "three" / "three.module.js")
        (work / "node_modules" / "three" / "package.json").write_text(json.dumps({
            "name": "three", "version": "0.0.0", "type": "module",
            "main": "three.module.js", "exports": "./three.module.js"}))
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ServerEngineSpinTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_pairs_are_collected_from_a_server_stood_hull(self) -> None:
        """The propeller pair under an Engine is found on the loaded model."""
        self.assertEqual(self.out["loaded"]["props"], 1)

    def test_a_hull_with_no_engine_row_stands_still(self) -> None:
        """Nothing turns before the server says anything: blade shown at its
        authored pose, disc hidden, as a model loads with its engine off
        (`Engine+0x142` clear, PHY-14)."""
        for case in ("noRow", "revsZero"):
            pair = self.out[case][0]
            self.assertTrue(pair["blade"], case)
            self.assertFalse(pair["disc"], case)
            self.assertEqual(pair["bladeTurn"], 0, case)
            self.assertEqual(pair["discTurn"], 0, case)

    def test_the_servers_revs_turn_the_propeller(self) -> None:
        """0.96 revs -- the live maximum, the engine's 1.2 clamp over the
        writer's 1.25 -- is 20 degrees a tick: 30 ticks is 576, which reads as
        216 inside one turn. The disc is current, the blade hidden."""
        pair = self.out["flying"][0]
        self.assertEqual(pair["revs"], 0.96)
        self.assertTrue(pair["disc"])
        self.assertFalse(pair["blade"])
        self.assertAlmostEqual(pair["discTurn"], (0.96 * 20 * 30) % 360, places=1)

    def test_under_the_split_the_step_is_four_hundred(self) -> None:
        """Below 0.08 revs the step is `revs * 400` a tick, and the blurred
        disc is current only past `comparison^2` (0.0049 for a 0.07
        propeller), so 0.002 revs draws the blade."""
        slow = self.out["underThreshold"]
        self.assertTrue(slow["blade"])
        self.assertFalse(slow["disc"])
        self.assertAlmostEqual(slow["bladeTurn"], 0.002 * 400 * 30 * 0.2, places=2)

    def test_the_disc_is_current_past_the_squared_comparison(self) -> None:
        """0.05 revs is over 0.0049, so the disc shows even though the step is
        still the slow one."""
        self.assertTrue(self.out["slow"]["disc"])
        self.assertFalse(self.out["slow"]["blade"])

    def test_revs_back_to_zero_stops_the_blade_where_it_is(self) -> None:
        cut = self.out["cut"]
        self.assertEqual(cut["revs"], 0)
        self.assertTrue(cut["blade"])
        self.assertEqual(cut["held"], 0)

    def test_each_engine_of_a_four_engine_bomber_turns_on_its_own_revs(self) -> None:
        """A B17 sends four engine bodies and carries four propellers, so the
        revs pair up index for index. Measured live on 2026-10-18: object 546
        decoded four `E` children a body where every fighter decoded one."""
        bomber = self.out["bomber"]
        self.assertEqual([p["revs"] for p in bomber], [0.9, 0.9, 0.45, 0])
        self.assertEqual([p["disc"] for p in bomber], [True, True, True, False])

    def test_one_engine_shot_out_stops_that_propeller_alone(self) -> None:
        """A second at 0.9 revs is 540 degrees (180 inside a turn) and at 0.45
        is 270; the two engines at 0 do not move at all."""
        self.assertEqual(self.out["bomberLostOne"], [180, 0, 270, 0])

    def test_fewer_revs_than_propellers_fall_back_to_the_first(self) -> None:
        """One throttle drives all of a plane's engines, so a hull whose revs
        and propellers do not pair up takes the first engine's everywhere
        rather than leaving blades standing."""
        self.assertEqual(self.out["mismatched"], [0.5, 0.5, 0.5])

    def test_the_hull_the_page_drives_is_not_drawn_as_a_server_entity(self) -> None:
        """The hull the page drives it draws from its own prediction and
        corrects to the server; a server entity for it too is a second copy at
        the server's lerped pose beside the predicted one -- the clone the owner
        saw drift and stutter (2026-10-18). So while `drivenId` names it, no
        entity stands for it; the one the page does not drive keeps its entity,
        and the driven one's entity -- with its collider -- returns the moment
        the page gets out."""
        self.assertEqual(self.out["driveBefore"], {"a": True, "b": True})
        self.assertEqual(self.out["driveOwned"], {"a": False, "b": True})
        self.assertEqual(self.out["driveExit"], {"a": True, "b": True})


if __name__ == "__main__":
    unittest.main()
