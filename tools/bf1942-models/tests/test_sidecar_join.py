"""The page's join against a real server: connect, load the server's level,
wait out its world dump, and only then deploy.

BF1942-AUSTRALIA, Midway co-op, 63 bots (2026-10-24): the page loaded Aberdeen
first and reloaded onto Midway, and on the second run the owner deployed on the
Enterprise and fell through it. The carrier came into this client's ghost scope
at 49.461 s, the tick of the spawn, and the page had not yet fetched its glb,
so there was no deck to stand on.

`sidecar_join_harness.mjs` replays the session's own rows
(`fixtures/sidecar_midway_join.ndjson.gz`) through `net-sidecar.js` and
`server-entities.js`. features/udp-sidecar/browser.md, "The join".
"""

from __future__ import annotations

import json
import posixpath
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE.parent / "viewer"
HARNESS = HERE / "sidecar_join_harness.mjs"
FIXTURE = HERE / "fixtures" / "sidecar_midway_join.ndjson.gz"


def _closure(*entries: str) -> set[str]:
    seen: set[str] = set()
    queue = list(entries)
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
        for name in _closure("server-entities.js", "net-sidecar.js"):
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
        proc = subprocess.run(["node", str(work / "harness.mjs"), str(FIXTURE)],
                              capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class SidecarJoinTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()
        cls.first = cls.out["first"]

    def test_nothing_is_known_before_the_set_level(self) -> None:
        """Connected, no SetLevel yet: no level to load, and the address for
        the "CONNECTING TO" line."""
        self.assertIsNone(self.first["levelBefore"])
        self.assertFalse(self.first["readyBefore"])
        self.assertEqual(self.first["address"], "159.196.188.2:14567")

    def test_the_level_is_the_servers_from_its_set_level(self) -> None:
        self.assertAlmostEqual(self.first["levelAt"], 0.325, places=3)
        level = self.first["level"]
        self.assertEqual(level["level"], "midway")
        self.assertEqual(level["mod"], "bf1942")
        self.assertFalse(level["modeDefault"])

    def test_the_world_is_ready_at_the_end_of_the_dump(self) -> None:
        """Not before DataBaseComplete: 23.2 s after the SetLevel on this
        server, the server's pace (retail's own client took 23.2 s too)."""
        self.assertAlmostEqual(self.first["dbCompleteAt"], 23.558, places=3)
        self.assertAlmostEqual(self.first["readyAt"], self.first["dbCompleteAt"], places=3)
        self.assertGreater(self.first["readyAt"] - self.first["levelAt"], 20)
        self.assertGreaterEqual(self.first["readyAt"], self.first["lastCreatePlayerAt"])

    def test_the_carriers_model_is_asked_for_during_the_dump(self) -> None:
        """Prewarmed from its CreateObject, long before it comes into scope
        with the spawn (49.461 s)."""
        asked = self.first["modelsAskedAt"].get("Enterprise")
        self.assertIsNotNone(asked)
        # Its CreateObject is at 2.843 s, 46 s before the spawn.
        self.assertLess(asked, 3.0)
        self.assertAlmostEqual(self.first["enterpriseScopeAt"], 49.461, places=3)

    def test_a_deck_spawn_waits_for_the_carriers_collider(self) -> None:
        """At the spawn the carrier is in scope with no collider: the body is
        held, whether its entity exists yet or not; once its glb has landed
        it stands. A body far from it is never held."""
        self.assertTrue(self.first["pendingNoEntityAtSpawn"])
        self.assertTrue(self.first["pendingAtSpawn"])
        self.assertFalse(self.first["pendingAfterLoad"])
        self.assertFalse(self.first["far"])

    def test_a_page_joining_mid_round_is_ready_on_the_snapshot(self) -> None:
        got = self.out["midRound"]
        self.assertEqual(got["level"], "midway")
        self.assertFalse(got["beforeState"])
        self.assertTrue(got["ready"])

    def test_a_level_change_waits_for_the_new_dump(self) -> None:
        """Rejoining: not ready from the drop to the new world's end; the
        SetLevel is a load the page answers with its loading screen."""
        got = self.out["levelChange"]
        self.assertEqual(got["steps"], [True, False, False, True, True])
        self.assertEqual(got["level"], "wake")
        self.assertTrue(got["change"]["load"])
        self.assertEqual(got["change"]["level"], "wake")

    def test_an_in_place_restart_is_not_a_load(self) -> None:
        got = self.out["levelChange"]
        self.assertTrue(got["restart"]["same"])
        self.assertNotIn("load", got["restart"])
        self.assertTrue(got["readyAfterRestart"])


if __name__ == "__main__":
    unittest.main()
