"""Dead soldiers' bodies in the replay viewer: drawn exactly while the server
has them in scope.

The server keeps a dead man's soldier object until its DestroyObject
(`timeToLiveAfterDeath`, 10 s, DIE-9). A body can leave this client's scope
(a `d` row: ghost action 3, or the object disabled in a bf42plus client's
registry; a server recorder's `d` is the object gone) and come back (`o`)
while it lies, and a man killed again inside 10 s has two bodies lying.
`replay-bodies.js` drew each corpse for the renderer's own clock wherever it
went: a body scoped out stayed drawn (7 such scope-outs in the first 125 s of
sidecar-2026-10-24-11-53-03), and a death row on the instant a soldier was
made (a join's world dump) took the life's real death away.

`replay_bodies_harness.mjs` parses the sidecar sessions' fixtures with
`replay-recording.js`, plays them through `ReplaySoldiers` every 100 ms and
compares the bodies drawn, by netId, with the set the raw rows give.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "replay_bodies_harness.mjs"
SCOPE = HERE / "fixtures" / "sidecar_midway_bodies.ndjson.gz"
TWICE = HERE / "fixtures" / "sidecar_midway_bodies_twice.ndjson.gz"
# A bf42plus 2.0 client recording (replay_20261024-161456, Battle Axe
# conquest), its first 300 s cut to the soldiers' rows.
CLIENT = HERE / "fixtures" / "replay_client_bodies.ndjson.gz"
# A server recorder's file (replay_1791115588, El Alamein co-op), its first
# 400 s cut the same way, samples thinned to 10 Hz. It writes no
# DestroyObject: a `d` is the object gone from the world.
SERVER = HERE / "fixtures" / "replay_server_bodies.ndjson.gz"


def run_harness(fixture: Path) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS), str(fixture)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class ReplayBodiesScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness(SCOPE)

    def test_the_session_scopes_out_lying_bodies(self) -> None:
        """The fixture carries the case: bodies scoped out while they lie, and
        two that came back (8800 and 9362, at 69.892)."""
        self.assertGreaterEqual(self.out["lyingScopeOuts"], 7)
        self.assertEqual(self.out["reentered"], [8800, 9362])
        self.assertGreater(self.out["outFrames"], 100)

    def test_the_replay_draws_exactly_the_servers_bodies(self) -> None:
        """Hidden on a scope-out, drawn again on the way back in, gone on the
        DestroyObject: every frame matches the rows."""
        self.assertGreater(self.out["deaths"], 20)
        self.assertEqual(self.out["mismatches"], 0, self.out["misses"])


class ReplayBodiesTwiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness(TWICE)

    def test_the_replay_draws_exactly_the_servers_bodies(self) -> None:
        """Including 7815 (pid 195, died 25.941): his soldier was made on the
        instant of his previous death row in the join's dump, and the replay
        took that row for this life's death and drew no body for the real one."""
        self.assertGreater(self.out["deaths"], 40)
        self.assertAlmostEqual(self.out["dumpEnd"], 25.382, delta=0.01)
        self.assertEqual(self.out["mismatches"], 0, self.out["misses"])

    def test_two_bodies_of_one_man_lie_together(self) -> None:
        self.assertGreater(self.out["togetherFrames"], 50)
        for pid in ("195", "226", "228", "223", "218"):
            self.assertGreaterEqual(self.out["together"].get(pid, 0), 2, pid)


class ReplayBodiesClientTests(unittest.TestCase):
    """A bf42plus client writes `d` when an object leaves its registry or is
    disabled (a scope-out) and `o` when it is back, and the server's
    DestroyObject as an event, so a body is the same story as on the wire."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness(CLIENT)

    def test_the_file_scopes_bodies_out_and_back(self) -> None:
        self.assertGreaterEqual(self.out["lyingScopeOuts"], 10)
        self.assertGreaterEqual(len(self.out["reentered"]), 3)

    def test_the_replay_draws_exactly_the_servers_bodies(self) -> None:
        """708 is scoped out at 45.48 while it lies (the replay drew it on),
        674 lies to its destroy at 47.55, past the 10 s corpse clock."""
        self.assertGreater(self.out["deaths"], 30)
        self.assertEqual(self.out["mismatches"], 0, self.out["misses"])


class ReplayBodiesServerFileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness(SERVER)

    def test_the_replay_draws_exactly_the_bodies_in_the_world(self) -> None:
        """A body goes with its `d`; a soldier gone from the world before his
        death row (584, 704) leaves none."""
        self.assertGreater(self.out["deaths"], 20)
        self.assertGreaterEqual(self.out["lyingScopeOuts"], 10)
        self.assertEqual(self.out["mismatches"], 0, self.out["misses"])


if __name__ == "__main__":
    unittest.main()
