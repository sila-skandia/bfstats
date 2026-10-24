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

Three more (2026-10-25). A man killed in a seat stays in it (DIE-11), drawn
slumped while the server keeps his soldier (a body in a seat is compared as
`<id>s`, so one drawn on the ground at the spot he boarded is a miss). A seek
drew none of the bodies already lying: the harness seeks a second replay to
120 frames back and forth, paused and playing, and every body must be there
at once and on the next frames. And a man this client never saw alive left no
body at all, when it came into scope after he was back.
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
# The first 60 s of sidecar-2026-10-24-13-07-56 (Tobruk), cut the same way:
# men killed in the join's world dump whom this client never saw alive, their
# bodies scoped in after they were back.
UNSEEN = HERE / "fixtures" / "sidecar_tobruk_unseen_bodies.ndjson.gz"


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

    def test_a_body_killed_in_a_seat_is_drawn_in_it(self) -> None:
        """The Ho-Ha's three passengers killed at 104.388 (9436, 9462, 9745)
        lie in their seats to their DestroyObject at 114.413, and 9097 and
        9471 in theirs. The code before drew each on the ground where he had
        boarded (174 mismatches)."""
        self.assertGreaterEqual(self.out["seatedDeaths"], 10)
        self.assertEqual(self.out["seatedDrawn"], [9097, 9436, 9462, 9471, 9745])
        self.assertGreater(self.out["seatedFrames"], 300)

    def test_a_seek_shows_every_body_lying_there(self) -> None:
        """The code before drew none of them until playback walked across a
        death (249 mismatches over the same seeks)."""
        self.assertEqual(self.out["seeks"], 120)
        self.assertGreater(self.out["seekLying"], 100)
        self.assertEqual(self.out["seekMismatches"], 0, self.out["seekMisses"])


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

    def test_a_seek_shows_every_body_lying_there(self) -> None:
        self.assertGreater(self.out["seekLying"], 100)
        self.assertEqual(self.out["seekMismatches"], 0, self.out["seekMisses"])

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
        674 lies to its destroy at 47.55, past the 10 s corpse clock. The
        file's four men killed in a seat all went with a hull that blew up:
        their soldiers were destroyed on the instant, and no body is drawn."""
        self.assertGreater(self.out["deaths"], 30)
        self.assertEqual(self.out["seatedDeaths"], 4)
        self.assertEqual(self.out["seatedFrames"], 0)
        self.assertEqual(self.out["mismatches"], 0, self.out["misses"])

    def test_a_seek_shows_every_body_lying_there(self) -> None:
        self.assertGreater(self.out["seekLying"], 50)
        self.assertEqual(self.out["seekMismatches"], 0, self.out["seekMisses"])


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

    def test_a_seek_shows_every_body_lying_there(self) -> None:
        self.assertGreater(self.out["seekLying"], 20)
        self.assertEqual(self.out["seekMismatches"], 0, self.out["seekMisses"])


class ReplayBodiesUnseenTests(unittest.TestCase):
    """A man the client never saw alive: no sample of his soldier before his
    death row, so playback had no death to play, and his body came into scope
    only after he was back. The replay laid none (the live page drew them)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness(UNSEEN)

    def test_every_such_body_is_drawn_while_in_scope(self) -> None:
        """8726, 10166, 10533, 10848 and 11041 were never drawn before; 10848
        died at 27.006, its man was back at 27.066, and it lay in scope from
        31.97 to its destroy at 33.97."""
        unseen = self.out["unseen"]
        for nid in ("8726", "10166", "10533", "10848", "11041"):
            self.assertIn(nid, unseen)
        for nid, u in unseen.items():
            self.assertGreater(u["wanted"], 0, nid)
            self.assertEqual(u["drawn"], u["wanted"], nid)

    def test_the_replay_draws_exactly_the_servers_bodies(self) -> None:
        self.assertEqual(self.out["mismatches"], 0, self.out["misses"])
        self.assertEqual(self.out["seekMismatches"], 0, self.out["seekMisses"])


if __name__ == "__main__":
    unittest.main()
