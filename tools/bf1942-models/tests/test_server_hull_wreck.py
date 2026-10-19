"""`viewer/server-entities.js` `hull`: the server's word that a hull died must
WRECK it, not merely zero its Armor.

A local round wrecks through `vehicle-hits.js` (`if (change.died)
page.wreckVehicle(...)`); in authority mode the only damage signal is the
server's `hull(id, hp, destroyed)` row, so that row is where the wreck is
placed. Without the call the server's kill silently zeroed the Armor and left
the intact mesh standing -- the owner's "crashed where you'd expect but no
wrecked hull" (2026-10-18). Driven headless by `server_hull_wreck_harness.mjs`.
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
HARNESS = Path(__file__).resolve().parent / "server_hull_wreck_harness.mjs"


def _closure(entry: str) -> set[str]:
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


class ServerHullWreckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_destroyed_flag_wrecks_the_hull_once(self) -> None:
        """A `destroyed: true` row places the wreck on the transition and
        passes the Armor it just killed, and a repeat of the same row never
        wrecks it a second time."""
        got = self.out["destroyedFlag"]
        self.assertTrue(got["registered"])
        self.assertEqual(got["wreckedBefore"], 0)
        self.assertTrue(got["firstKill"]["destroyed"])
        self.assertEqual(got["firstKill"]["wrecks"], 1)
        self.assertEqual(got["secondKill"], 1)
        self.assertTrue(got["wreckedTheArmor"])

    def test_hit_points_falling_to_zero_wreck_the_hull_once(self) -> None:
        """The hp-to-the-difference path crosses into destruction exactly like
        the flag and wrecks once; a scratch that leaves it alive does not."""
        got = self.out["hpPath"]
        self.assertEqual(got["afterScratch"]["wrecks"], 0)
        self.assertTrue(got["afterZero"]["destroyed"])
        self.assertEqual(got["afterZero"]["wrecks"], 1)
        self.assertEqual(got["thenRepeat"], 1)

    def test_a_living_or_healing_hull_never_wrecks(self) -> None:
        got = self.out["livingNeverWrecks"]
        self.assertFalse(got["destroyed"])
        self.assertEqual(got["wrecks"], 0)

    def test_the_own_hull_comes_back_from_the_table_a_wreck(self) -> None:
        """A hull killed while the page drove it had no entity to wreck when the
        server's `hull` row fired; the crash ends the drive and the hull comes
        back from the table, and the standing destroyed state is applied on the
        frame the fresh entity registers -- so it comes back a wreck, once."""
        got = self.out["ownHullReappears"]
        self.assertFalse(got["drivenHadEntity"])
        self.assertEqual(got["wreckedWhileDriven"], 0)
        self.assertTrue(got["reappeared"])
        self.assertTrue(got["destroyed"])
        self.assertEqual(got["wrecks"], 1)
        self.assertEqual(got["afterAnotherFrame"], 1)

    def test_the_hulls_armor_is_surfaced_from_the_glb_onto_the_group(self) -> None:
        """The Armor lives on a PlayerControlObject node inside the glb, not on
        the bare server group; register must surface it onto the group it keys
        the damageable to, or the hull never becomes a damageable and never
        wrecks (bombing a Sherman left the intact mesh, 2026-10-19)."""
        got = self.out["armorSurfaced"]
        self.assertTrue(got["registeredWithArmor"])
        self.assertEqual(got["maxHitpoints"], 100)
        self.assertEqual(got["templateKind"], "PlayerControlObject")

    def test_every_hull_wears_its_own_copy_of_the_cached_model(self) -> None:
        """The renderer caches one scene per template; each server hull must
        clone it. Shared, it drew on one hull of the template at a time, and a
        wreck's hide pass hid it for the template's next hull, which then
        respawned an invisible group (the Wespe, 2026-10-19)."""
        got = self.out["sharedModel"]
        self.assertEqual(got["bothDraw"], [1, 1])
        self.assertEqual(got["afterWreck"], [0, 1])
        self.assertTrue(got["gone"])
        self.assertEqual(got["respawned"], [1, 1])
        self.assertTrue(got["sourceUntouched"])


if __name__ == "__main__":
    unittest.main()
