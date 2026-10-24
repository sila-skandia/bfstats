"""The page's jumping soldier against the BF1942 dedicated server's, per tick.

`jump_law_harness.mjs` replays the words `lab/jump_law_probe.mjs` sent a real
server (vanilla Wake, team 2, spawn group 1, 2026-10-25) through the page's
`Soldier.step`, on Wake's own terrain, and measures the page's feet against
the server's at every acknowledged serial. The law it holds the page to is
PHY-1 (the impulse, on the tick of the word that carries the press) and
PHY-35 (`features/bf1942-engine-reference/ledger.md`): no jump while the lower
body is still in a jump state, 28 ticks after a standing jump and 26 after a
running one, and the pose the gate reads is the previous tick's.

Before PHY-35 the page jumped on any press once it had landed, and the server
refused every press inside the wait: a whole jump apart, up to 0.94 m at the
acked tick on the live lab (features/udp-sidecar/browser.md).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
HARNESS = Path(__file__).resolve().parent / "jump_law_harness.mjs"
MODULES = [
    "walking-body.js", "soldier-resolve.js", "soldier-pose.js",
    "soldier-locomotion.js", "point-body.js", "fixed-step.js", "parachute.js",
    "heightfield.js", "world-collider.js", "collision-materials.js",
    "soldier.js", "physics.js", "rocket-pack.js", "swim.js", "ladder-climb.js",
    "mouse-input.js", "spawn-flags.js", "static-index.js", "collision-meshes.js",
    "drivable-mask.js", "spawn-safety.js",
]
LOGS = ["jump_law_wake", "jump_law_wake_gaits"]
# Not scored: the first acks (the start state's own rounding) and the replay's
# tail. `goHeld` is scored apart (see its test).
UNSCORED = {"idle", "tail", "goHeld"}


def _work(tmp: Path) -> Path:
    (tmp / "package.json").write_text('{"type": "module"}')
    for name in MODULES:
        shutil.copyfile(VIEWER / name, tmp / name)
    return tmp


def run_harness(no_wait: bool = False) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = _work(Path(tmp))
        shutil.copyfile(HARNESS, work / "harness.mjs")
        env = dict(os.environ, NO_WAIT="1" if no_wait else "0")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs"), str(FIXTURES / "move_law_wake_terrain.json.gz"),
             *[str(FIXTURES / f"{name}.ndjson.gz") for name in LOGS]],
            capture_output=True, text=True, timeout=180, env=env)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


def run_node(script: str) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = _work(Path(tmp))
        (work / "probe.mjs").write_text(script)
        proc = subprocess.run(["node", str(work / "probe.mjs")], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"node failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout)


class JumpLawReplayTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def scored(self):
        for log in LOGS:
            for phase, s in self.results[log]["phases"].items():
                if phase not in UNSCORED:
                    yield log, phase, s

    def test_every_tick_ran_once(self) -> None:
        for log in LOGS:
            r = self.results[log]
            self.assertEqual(r["ticks"], r["calls"], log)

    def test_the_feet_follow_the_servers_jumps_to_a_millimetre_or_two(self) -> None:
        # Flat and gently sloped ground: every jump the server took and every
        # press it refused, at a stand, a walk, a run, a strafe, backing,
        # turning, crouched and getting up from it.
        for log, phase, s in self.scored():
            with self.subTest(log=log, phase=phase):
                self.assertLessEqual(s["vertical"]["absMedian"], 1.0, s)
                self.assertLessEqual(s["vertical"]["max"], 3.0, s)
                self.assertLessEqual(s["horizontal"]["absMedian"], 1.0, s)
                # A landing on a slope is one tick a few cm off sideways: the
                # page's one feet vertex against the server's five (PHY-34's
                # own "not covered").
                self.assertLessEqual(s["horizontal"]["max"], 15.0, s)

    def test_a_press_inside_the_wait_is_refused_as_the_server_refuses_it(self) -> None:
        # `reN`: a jump, then one press N ticks later. 20..27 are inside the
        # standing jump's 28 ticks, 28 and 30 are not.
        phases = self.results["jump_law_wake"]["phases"]
        for n in (20, 22, 23, 24, 25, 26, 27, 28, 30):
            v = phases[f"re{n}"]["vertical"]
            with self.subTest(n=n):
                self.assertLessEqual(v["max"], 2.0, v)

    def test_the_law_before_the_wait_misses_by_whole_jumps(self) -> None:
        # The same words with the wait taken out: a refused press becomes a
        # jump the server never made.
        before = run_harness(no_wait=True)["jump_law_wake"]["phases"]
        for n in (20, 24, 27):
            with self.subTest(n=n):
                self.assertGreater(before[f"re{n}"]["vertical"]["max"], 200.0)

    def test_a_running_start_shows_the_waits_one_tick_of_play(self) -> None:
        # `goHeld`, forward and jump held from a standstill: the server's run
        # jump waited 27 ticks here where every other run jump waited 26. The
        # clip runs on the server's frame clock (PHY-35), whose phase the
        # client cannot see; one tick apart is a ~6 cm step at the ack.
        s = self.results["jump_law_wake_gaits"]["phases"]["goHeld"]
        self.assertLessEqual(s["vertical"]["absMedian"], 2.0, s)
        self.assertLessEqual(s["vertical"]["max"], 100.0, s)


class JumpStateTests(unittest.TestCase):
    def test_the_lower_bodys_waits_and_routes(self) -> None:
        out = run_node("""
import { SoldierJumpState, jumpStateTicks } from './soldier-locomotion.js';
const route = (seq) => {
  const s = new SoldierJumpState();
  let got = null;
  for (const i of seq) { s.begin(1 / 30); got = s.transitions(i) ?? got; }
  return got;
};
const waitOf = (input) => {
  const s = new SoldierJumpState();
  s.transitions(input);
  let n = 0;
  while (s.jumping) { s.begin(1 / 30); n++; }
  return n;
};
process.stdout.write(JSON.stringify({
  ticks: [jumpStateTicks('standJump'), jumpStateTicks('runJump'), jumpStateTicks('runJumpBackward')],
  stand: route([{ act: true }]),
  go: route([{ thr: 1, act: true }]),
  back: route([{ thr: -1, act: true }]),
  strafe: route([{ yaw: 1, act: true }]),
  strafeTurning: route([{ yaw: 1, look: 0.05, act: true }]),
  walk: route([{ thr: 1, walk: true }, { thr: 1, walk: true, act: true }]),
  running: route([{ thr: 1 }, { thr: 1, act: true }]),
  waitStand: waitOf({ act: true }),
  waitRun: waitOf({ thr: 1, act: true }),
}));
""")
        self.assertEqual(out["ticks"], [28, 26, 26])
        self.assertEqual(out["stand"], "standJump")
        self.assertEqual(out["go"], "runJump")             # Lb_Stand -> Lb_RunForward -> Lb_RunJump
        self.assertEqual(out["back"], "runJumpBackward")
        self.assertEqual(out["strafe"], "runJump")
        self.assertEqual(out["strafeTurning"], "standJump")  # the turn clause comes first
        self.assertEqual(out["walk"], "standJump")
        self.assertEqual(out["running"], "runJump")
        self.assertEqual(out["waitStand"], 28)
        self.assertEqual(out["waitRun"], 26)

    def test_the_gate_reads_the_previous_ticks_pose(self) -> None:
        # A press on the tick crouch is let go of is refused; the next tick's
        # is taken (the server's jumps a tick after the release, measured).
        out = run_node("""
import { SoldierBody } from './walking-body.js';
const b = new SoldierBody();
b.place(0, 0, 0); b.plant();
b.setCrouch(true);
for (let i = 0; i < 5; i++) b.step(1 / 30, {});
const rest = () => { b.body.setVelocity(0, 0, 0); b.plant(); };
rest();
b.setCrouch(false); b.jump(); b.step(1 / 30, {});
const onRelease = b.velocity.y > 3;
rest();
b.jump(); b.step(1 / 30, {});
process.stdout.write(JSON.stringify({ onRelease, next: b.velocity.y > 3 }));
""")
        self.assertFalse(out["onRelease"])
        self.assertTrue(out["next"])


if __name__ == "__main__":
    unittest.main()
