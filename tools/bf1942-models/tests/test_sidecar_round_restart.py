"""A round restart with the local player inside the hull the server destroys.

Wake co-op, 2026-10-24: the owner switched from the gunner's seat of Sherman
532 to its driver's seat, and 280 ms later a second human's join restarted
the round. The server killed everyone, destroyed every hull and made each
again under its old netId at its spawn, then sent GameStatus 3 after 1. The
page showed a second Sherman at the airfield spawn beside the one he had
been in, and the re-made 532 was never drawn again, even when a bot drove it.

The session's own rows (`fixtures/sidecar_wake_round_restart.ndjson.gz`) are
replayed through `net-sidecar.js`, the seat law `server-seat.js` and
`server-entities.js` by `sidecar_round_restart_harness.mjs`; the sidecar's
`ghost-writer.mjs` is checked on the same sequence.
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
SIDECAR = HERE.parent / "sidecar"
HARNESS = HERE / "sidecar_round_restart_harness.mjs"
FIXTURE = HERE / "fixtures" / "sidecar_wake_round_restart.ndjson.gz"

# The airfield Sherman's spawn (createObject at t 424.083), in the page's
# frame (z negated).
SPAWN = (1392.5, -737.0)


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
        for name in _closure("server-entities.js", "net-sidecar.js", "server-seat.js"):
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
        proc = subprocess.run(["node", str(work / "harness.mjs"), str(FIXTURE), str(SIDECAR)],
                              capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class RoundRestartTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()
        cls.s = cls.out["session"]

    def test_driving_the_hull_draws_no_second_copy(self) -> None:
        """In the driver's seat the page draws its own prediction, so the
        server's 532 has no entity (the 2026-10-18 clone)."""
        got = self.s["checks"]["driving"]
        self.assertEqual(got["seat"], {"hull": 532, "index": 0})
        self.assertEqual(got["entities532"], [])

    def test_the_restart_takes_the_player_out_dead(self) -> None:
        """His death row ends the seat (quietly) and kills him; nothing leaves
        him seated in the hull the server destroyed."""
        got = self.s["checks"]["afterRestart"]
        self.assertIsNone(got["seat"])
        self.assertFalse(got["alive"])
        self.assertEqual(self.s["died"], 1)
        self.assertEqual([x["why"] for x in self.s["left"]], ["killed"])

    def test_status_three_after_one_is_a_restart(self) -> None:
        """GameStatus 1 -> 3 is `restartMap`'s `resetTimers` (ROUND-10): one
        restart row, and the page starts its round over."""
        self.assertEqual(len(self.s["restartRows"]), 1)
        self.assertAlmostEqual(self.s["restartRows"][0], 424.033, places=3)
        self.assertEqual(self.s["restarts"], 1)

    def test_a_hull_destroyed_under_him_takes_him_out(self) -> None:
        """With no death row first: the page leaves the seat on the hull's own
        DestroyObject, and only on that hull's."""
        got = self.out["goneUnderHim"]
        self.assertEqual(got["stillIn"], 900)
        self.assertIsNone(got["seat"])
        self.assertTrue(got["alive"])
        self.assertEqual(got["plans"], [{"type": "vehicleGone", "leave": True, "die": False, "restart": False}])
        self.assertFalse(got["serverSeat"])

    def test_the_restarts_control_points_are_not_captures(self) -> None:
        """The points the restart resets come as the round's first word, as
        on a join: no capture line."""
        self.assertEqual(self.s["loudCaptures"], 0)

    def test_the_remade_hull_is_a_new_object(self) -> None:
        self.assertIsNotNone(self.s["genBefore"])
        self.assertNotEqual(self.s["genBefore"], self.s["genAfter"])

    def test_nothing_stands_for_the_remade_hull_until_it_is_in_scope(self) -> None:
        """Retail makes it disabled and turns it on at its first ghost record
        (GhostManager::readData 0x08142142). Until then: no hull at all,
        neither the old one nor one at the spawn."""
        self.assertEqual(self.s["checks"]["afterRestart"]["entities532"], [])
        self.assertEqual(self.s["checks"]["beforeRecord"]["entities532"], [])

    def test_one_hull_for_532_at_its_spawn_once_in_scope(self) -> None:
        """The first record of the re-made 532 (a bot boards it at its spawn,
        t 449.127): exactly one hull, at the server's pose, drawn."""
        got = self.s["checks"]["afterRecord"]["entities532"]
        self.assertEqual(len(got), 1)
        x, _, z = got[0]["at"]
        self.assertAlmostEqual(x, SPAWN[0], delta=0.5)
        self.assertAlmostEqual(z, SPAWN[1], delta=0.5)
        self.assertTrue(got[0]["visible"])
        self.assertTrue(self.s["inScope532"])

    def test_destroy_and_remake_in_one_frame_is_a_fresh_entity(self) -> None:
        """A wrecked hull destroyed and made again between two frames: the
        old entity (its wreck, its pose) does not stand in for the new one."""
        got = self.out["oneFrame"]
        self.assertTrue(got["wreckedBefore"])
        self.assertFalse(got["sameEntity"])
        self.assertEqual(got["count"], 1)
        self.assertEqual(got["at"], [50.0, 100.0, -60.0])
        self.assertFalse(got["destroyedAfter"])

    def test_the_ghost_writer_reopens_a_remade_object(self) -> None:
        """sidecar/ghost-writer.mjs: the re-made hull's first record writes a
        k:"o" again (the 2026-10-24 sidecar wrote one at 423.9 only)."""
        self.assertEqual(self.out["ghostWriter"], [423.9, 449.127])


if __name__ == "__main__":
    unittest.main()
