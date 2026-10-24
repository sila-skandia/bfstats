"""A sidecar page draws another soldier's rounds from the sidecar's round rows.

A server sends a client no shot. Since 2026-10-25 the sidecar writes one
`k:"f"` row for each of a soldier's rounds, from the server's launch point
(`p`, his eye for his pose) along its line (`d`), timed to the round's tick
(`ghost-writer.mjs` `_handFire`, wire.md section 44). The live page used to
draw a remote's rounds on its own timer from his fire state and his current
aim (`net-room.js` `remoteRound` off the fire state's 'shot' row), so its
count and its lines were not the server's; and the soldier's `k:"f"` row
reached the page as a hull's shot and played a second report at him.

Now `net-sidecar.js` hands a soldier's row to the page as a `handRound` row,
and `net-hand-rounds.js` draws one round for each, on the row's line, when
the page's clock for the remotes reaches it, moved with the drawn shooter.
The fire state's 'shot' row only moves his body (`net-room.js`).

The lab fixtures of `test_sidecar_fire_line.py` (the server's own rounds
logged beside a watching sidecar) are rebuilt with today's writer and fed to
the page's sidecar state and the round queue by
`sidecar_hand_rounds_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import test_sidecar_fire_line as fire_line  # noqa: E402

UNIT = r"""
import { createHandRounds } from '../viewer/net-hand-rounds.js';
const out = {};
// A shooter standing at x = 10 at the round (t 5.0), drawn at x = 10.3 now.
const then = { alive: true, inVehicle: false, x: 10, y: 0, z: 0 };
const now = { alive: true, inVehicle: false, x: 10.3, y: 0, z: 0 };
let drawn = 4.9;
const q = createHandRounds({ drawnTime: () => drawn, playerAt: () => now, playerAtTime: () => then });
q.push({ slot: 3, nid: 77, at: 5.0, pos: [10, 1.65, -2], dir: [0, 0, -2] }, 0);
out.waits = q.due(10).length === 0 && q.pending() === 1;
drawn = 5.02;
const [s] = q.due(30);
out.origin = s.origin; out.dir = s.dir; out.late = s.late; out.pending = q.pending();
// A row waits at most half a second of page time for the drawn clock, and
// one far ahead of it (a clock that is wrong) goes at once.
drawn = 4.8;
q.push({ slot: 3, at: 5.0, pos: [0, 0, 0], dir: [1, 0, 0] }, 0);
out.staleWaits = q.due(100).length;
out.staleGoes = q.due(600).length;
drawn = 1.0;
q.push({ slot: 3, at: 5.0, pos: [0, 0, 0], dir: [1, 0, 0] }, 700);
out.farAheadGoes = q.due(700).length;
// A shooter put somewhere else (a respawn) keeps the server's point.
const far = createHandRounds({ drawnTime: () => 9, playerAt: () => ({ ...now, x: 50 }), playerAtTime: () => then });
far.push({ slot: 1, at: 5, pos: [10, 1.65, -2], dir: [1, 0, 0] }, 0);
out.farOrigin = far.due(0)[0].origin;
// A row with no line: the caller falls back on the eye and the view.
const bare = createHandRounds({ drawnTime: () => null, playerAt: () => now, playerAtTime: () => then });
bare.push({ slot: 1, at: 5 }, 0);
const b = bare.due(0)[0];
out.bare = { origin: b.origin, dir: b.dir };
console.log(JSON.stringify(out));
"""


class HandRoundQueueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", "--input-type=module", "-e", UNIT], cwd=HERE,
                              capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_round_waits_for_the_drawn_clock(self) -> None:
        self.assertTrue(self.r["waits"])
        self.assertEqual(0, self.r["pending"])
        self.assertAlmostEqual(0.02, self.r["late"], places=6)

    def test_the_server_point_moves_with_the_drawn_shooter(self) -> None:
        # p (10, 1.65, -2) in BF1942's frame is (10, 1.65, 2) on the page,
        # moved 0.3 m with the shooter; d is normalised and z negated.
        o = self.r["origin"]
        self.assertAlmostEqual(10.3, o["x"], places=6)
        self.assertAlmostEqual(1.65, o["y"], places=6)
        self.assertAlmostEqual(2.0, o["z"], places=6)
        self.assertEqual({"x": 0, "y": 0, "z": 1}, self.r["dir"])

    def test_a_stale_round_goes_after_the_wait(self) -> None:
        self.assertEqual(0, self.r["staleWaits"])
        self.assertEqual(1, self.r["staleGoes"])
        self.assertEqual(1, self.r["farAheadGoes"])

    def test_a_shooter_put_elsewhere_keeps_the_server_point(self) -> None:
        self.assertEqual({"x": 10, "y": 1.65, "z": 2}, self.r["farOrigin"])

    def test_a_row_without_a_line_leaves_it_to_the_caller(self) -> None:
        self.assertEqual({"origin": None, "dir": None}, self.r["bare"])


class HandRoundRecordingTests(unittest.TestCase):
    """One round drawn for each the server fired, on the row's line."""

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        cls.r = {}
        with tempfile.TemporaryDirectory() as d:
            for case in fire_line.CASES:
                tmp = Path(d) / case
                tmp.mkdir()
                out, server = fire_line._rebuild(case, tmp)
                proc = subprocess.run(["node", str(HERE / "sidecar_hand_rounds_harness.mjs"), str(out)],
                                      capture_output=True, text=True, timeout=300)
                if proc.returncode != 0:
                    raise AssertionError(proc.stderr)
                cls.r[case] = (json.loads(proc.stdout), len(server))

    def test_every_round_row_is_drawn_once(self) -> None:
        for case, (r, _) in self.r.items():
            for law in ("retail", "lookback"):
                with self.subTest(case=case, law=law):
                    run = r[law]
                    self.assertGreater(run["rows"], 0)
                    self.assertEqual(run["rows"], run["handRows"])
                    self.assertEqual(run["rows"], run["drawn"])
                    self.assertEqual(0, run["noLine"])

    def test_the_count_is_the_servers(self) -> None:
        # The moving fixture also holds a BAR run whose server rows are in
        # another file (test_sidecar_fire_line.CASES), so it has more rows.
        for case in ("bar_sniper", "thompson_garand"):
            r, server = self.r[case]
            with self.subTest(case=case):
                self.assertEqual(server, r["retail"]["drawn"])

    def test_a_soldier_round_is_not_a_hull_shot(self) -> None:
        for case, (r, _) in self.r.items():
            with self.subTest(case=case):
                self.assertEqual(0, r["retail"]["soldierShots"])

    def test_a_still_shooter_fires_from_the_server_point(self) -> None:
        # The lab's taps were mostly standing still: the median round leaves
        # p exactly; on the move it is moved with the drawn man, about the
        # distance he walks in the drawn clock's lead.
        for case, (r, _) in self.r.items():
            for law in ("retail", "lookback"):
                with self.subTest(case=case, law=law):
                    self.assertLess(r[law]["fromP"]["median"], 0.001)
                    self.assertLess(r[law]["fromP"]["max"], 1.0)

    def test_a_round_goes_when_the_drawn_clock_reaches_it(self) -> None:
        for case, (r, _) in self.r.items():
            with self.subTest(case=case):
                # Under the retail clock the round is already due on arrival.
                self.assertGreaterEqual(r["retail"]["late"]["min"], 0)
                self.assertEqual(0, r["retail"]["waited"])
                # Under the lookback law it waited, and went no earlier than
                # its moment.
                self.assertGreater(r["lookback"]["waited"], 0)
                self.assertGreaterEqual(r["lookback"]["late"]["min"], 0)


class ReplayTracerOriginTests(unittest.TestCase):
    """The replay starts a recorded soldier's tracer at the row's `p`
    (`replay_tracer_origin_harness.mjs` drives `ReplaySoldiers.flash`)."""

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HERE / "replay_tracer_origin_harness.mjs")],
                              capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.with_p, cls.without_p, cls.press = json.loads(proc.stdout)

    def test_a_row_with_p_launches_there_and_flashes_on_the_weapon(self) -> None:
        self.assertEqual([101, 21.65, -50], self.with_p["origin"])
        self.assertEqual([100, 21.4, -50], self.with_p["flash"])
        self.assertEqual([0, 0, -1], self.with_p["dir"])

    def test_a_row_without_p_keeps_the_old_start(self) -> None:
        self.assertEqual([100, 21.4, -50], self.without_p["origin"])

    def test_a_v3_press_pos_is_not_a_launch_point(self) -> None:
        self.assertEqual([100, 21.4, -50], self.press["origin"])


if __name__ == "__main__":
    unittest.main()
