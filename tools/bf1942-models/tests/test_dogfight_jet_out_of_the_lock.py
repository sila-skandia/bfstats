"""Out of their lock on a jet (features/dogfight-lessons-jets/out-of-the-lock.md):
every number and claim the jet words make, flown on the published F-16.

The demos from the harness's nine starts (`jet_lesson`); the Dip, the Flip
and the Ninja from the measure's nine (`dogfight-measure.js` `STARTS`) and
scored as `movesOn` scores them, by a runner of this file's own (`moves()`),
which also reads the bank of the look turn off the tracks.
"""

from __future__ import annotations

import functools
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from jet_school import jet_lesson, jet_tops, shot_down

TOOLS = Path(__file__).resolve().parent.parent
LESSON = "out-of-the-lock"

RUNNER = r"""
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [TOOLS, plane, base] = process.argv.slice(2);
const HERE = path.join(TOOLS, 'tests');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const load = name => import(pathToFileURL(path.join(viewer, name)).href);
const THREE = await load('vendor/three.module.js');
const { Aircraft } = await load('aircraft.js');
const { runDuel } = await load('dogfight-duel.js');
const { LESSONS, lessonFor, demoSides } = await load('dogfight-lessons.js');
const { scoreMove, verdictOf, STARTS, nudge } = await load('dogfight-measure.js');
const { bankOf } = await load('dogfight-flight.js');
const { jetMaker } = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'dc-jets.json'), 'utf8'));
const makePlane = jetMaker(THREE, Aircraft, fixture, plane);
const B = LESSONS.find(l => l.id === 'out-of-the-lock');
const L = base === 'base' ? B : lessonFor(B, 'jet');
const dist = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
const out = { era: L.era ?? null, survival: L.survival, moves: {}, look: [] };
for (const d of L.demos.filter(x => x.kind)) {
  const scores = [];
  for (const st of STARTS) {
    const sides = demoSides(L, d);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
    const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
    const [A, Y] = r.tracks;
    const s = scoreMove(r, d.kind, 1);
    // His landing shot from the move on, and how far you were from him then.
    const his = A.map((k, i) => ({ k, i })).filter(x => x.k.o && x.k.t >= s.t0);
    scores.push({ ...s, hits: r.hits, hisFired: A.some(k => k.f), acePhases: [...new Set(A.map(k => k.ph))],
      hisShotRange: his.length ? [Math.round(Math.min(...his.map(x => dist(x.k, Y[x.i])))), Math.round(Math.max(...his.map(x => dist(x.k, Y[x.i]))))] : null,
      aceMinSpeed: Math.round(Math.min(...A.filter(k => k.t >= s.t0 + 3).map(k => k.v))),
      runSpeed: [Math.round(Math.min(...Y.filter(k => k.ph === 'dip-run' && k.t > 20).map(k => k.v))), Math.round(Math.max(...Y.filter(k => k.ph === 'dip-run' && k.t > 20).map(k => k.v)))] });
  }
  out.moves[d.id] = { claimed: d.verdict, ...verdictOf(scores), scores };
}
// The look turn's bank, from 2 s in until the hard turn, from the harness's nine starts.
const flat = L.demos.find(x => x.id === 'flat');
for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) {
  const sides = demoSides(L, flat);
  sides[1] = { ...sides[1], start: { ...sides[1].start, at: [sides[1].start.at[0] + dx, sides[1].start.at[1], sides[1].start.at[2]], speed: sides[1].start.speed + dv } };
  const r = runDuel({ makePlane, seconds: 12, groundAt: () => 0, sides });
  const Y = r.tracks[1];
  const bank = Y.filter(k => k.ph === 'watch' && k.t >= 2).map(k => Math.abs(bankOf({ x: k.q[0], y: k.q[1], z: k.q[2], w: k.q[3] }).bank));
  out.look.push({ bank: bank.length ? [Math.round(Math.min(...bank)), Math.round(Math.max(...bank))] : null,
                  turned: Y.some(k => k.ph === 'turn'), lost: Y.some(k => k.ph === 'clear') });
}
console.log(JSON.stringify(out));
"""


@functools.lru_cache(maxsize=None)
def moves(plane: str = "F16", base: bool = False) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "ol_moves.mjs"
        script.write_text(RUNNER)
        proc = subprocess.run(["node", str(script), str(TOOLS), plane, "base" if base else "jet"],
                              capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"out-of-the-lock moves runner failed:\n{proc.stderr[-3000:]}")
    return json.loads(proc.stdout)


def demo(demo_id: str, base: bool = False, plane: str = "F16") -> list[dict]:
    return jet_lesson(LESSON, plane=plane, demo=demo_id, base=base)["demos"][demo_id]


def span(values) -> tuple:
    values = list(values)
    return min(values), max(values)


class TheLookTurnTests(unittest.TestCase):
    """What broke the lock as written, and what the jet's watchers change."""

    def test_as_written_the_gentle_turn_loses_them_once_in_nine(self) -> None:
        # The Spitfire's 20 degrees of bank on the F-16: the hunter slides
        # into the cone, is lost, and shoots down a pilot flying straight.
        for demo_id in ("flat", "counter"):
            runs = demo(demo_id, base=True)
            self.assertEqual(1, shot_down(runs, 1), demo_id)
            down = [r for r in runs if r["winner"] == 0]
            self.assertIn("clear", down[0]["phases"][1], demo_id)
            self.assertNotIn("turn", down[0]["phases"][1], demo_id)

    def test_the_jets_watchers_hold_the_spitfires_rate_of_turn(self) -> None:
        # "Hold the Spitfire's rate of turn instead, 26 to 39 degrees of bank,
        # and you have them in sight until they are in."
        look = moves()["look"]
        self.assertEqual(9, len(look))
        for row in look:
            self.assertTrue(row["turned"], row)
            self.assertFalse(row["lost"], row)
            self.assertTrue(26 <= row["bank"][0] and row["bank"][1] <= 39, row)

    def test_the_jet_file_is_laid_over_the_lesson(self) -> None:
        jet = jet_lesson(LESSON, demo="flat")
        self.assertEqual("jet", jet["era"])
        self.assertIsNone(jet_lesson(LESSON, demo="flat", base=True)["era"])
        self.assertEqual(["watch", "turn"], demo("flat")[0]["phases"][1])


class TheLockOnAJetTests(unittest.TestCase):
    def test_flying_straight_is_shot_down_every_time(self) -> None:
        # "shot down every time, 10 to 12 s in."
        runs = demo("without")
        self.assertEqual(9, shot_down(runs, 1))
        self.assertTrue(all(10 <= r["t"] <= 12 for r in runs), [r["t"] for r in runs])

    def test_turning_hard_nobody_is_hit_and_they_stay_behind_you(self) -> None:
        # "They follow you round, never closer than 64 m, and once the turn is
        # on their nose cannot come onto you: nobody is hit. ... the circle
        # climbs: both of you go up about 310 m in 45 s, until the roof levels
        # the turn off at about 760 m. Up there the air is thin and the turn
        # slows; you end at 120 m/s, 667 to 673 m from them, and they are
        # hunting you again." Before the roof (`underRoof`, every jet pilot)
        # the circle went on climbing to 802-812 m and ended at 97 to 98 m/s,
        # them still in `lag`.
        runs = demo("flat")
        for r in runs:
            self.assertIsNone(r["winner"], r)
            self.assertEqual([0, 0], r["hits"], r)
            self.assertTrue(64 <= r["closest"] <= 70, r)
            # Their landing shot is the lock before the turn, 1.7 s at most.
            self.assertLessEqual(r["shots"][0], 1.7, r)
            self.assertTrue(305 <= r["climbed"] <= 315, r)
            self.assertTrue(all(745 <= h <= 760 for h in r["height"]), r)
            self.assertTrue(120 <= r["speed"][1] <= 121, r)
            # 665-672 before; re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12).
            self.assertTrue(667 <= r["apart"] <= 673, r)
            self.assertEqual(["track", "lag", "hunt"], r["phases"][0], r)

    def test_nobody_goes_over_the_roof(self) -> None:
        # Neither plane, in any demo or move, tops 860 m on the F-16 (the
        # nine starts): the highest is the turn's 759 m. The Ninja, which
        # went to 912 m in four starts before the roof, tops 737 m.
        tops = jet_tops("F16", LESSON)[LESSON]
        self.assertEqual({"flat", "counter", "dip", "flip", "ninja"}, set(tops))
        self.assertLessEqual(max(h for d in tops.values() for h in d["top"]), 860, tops)
        self.assertEqual(759, max(h for d in tops.values() for h in d["top"]))
        self.assertEqual(737, tops["ninja"]["top"][1])

    def test_the_chop_is_never_flown(self) -> None:
        # "in nine fights the chop was never flown, and the fight was the hard turn."
        chop, flat = demo("counter"), demo("flat")
        for c, f in zip(chop, flat):
            self.assertEqual(["watch", "turn"], c["phases"][1], c)
            self.assertEqual((c["hits"], c["closest"], c["climbed"]), (f["hits"], f["closest"], f["climbed"]))

    def test_the_mig_29_flies_it_the_same(self) -> None:
        # The look turn is a rate, not a bank, so it fits the MiG-29 too
        # (pace 1.5), where the F-16's fixed 25 degrees would not. Nobody is
        # shot down. The hard turn is never hit. On the MiG-29 the chop is
        # flown, in 6 of 9, and in 3 of those they land 4 to 7 rounds on you.
        self.assertEqual(9, shot_down(demo("without", plane="Mig29"), 1))
        for demo_id in ("flat", "counter"):
            runs = demo(demo_id, plane="Mig29")
            self.assertTrue(all(r["winner"] is None for r in runs), demo_id)
            base = demo(demo_id, plane="Mig29", base=True)
            self.assertEqual(1, shot_down(base, 1), demo_id)
        self.assertTrue(all(r["hits"] == [0, 0] for r in demo("flat", plane="Mig29")))
        chop = demo("counter", plane="Mig29")
        self.assertEqual(6, sum(1 for r in chop if "chop" in r["phases"][1]))
        self.assertEqual([[5, 0], [7, 0], [4, 0]], [r["hits"] for r in chop if r["hits"] != [0, 0]])

    def test_the_mig_29_stays_under_the_roof(self) -> None:
        # Measured: 799 m at most (you, turning hard), where the chop went
        # to 1,427 m and the Ninja to 1,664 m before the roof.
        tops = jet_tops("Mig29", LESSON)[LESSON]
        self.assertEqual(799, max(h for d in tops.values() for h in d["top"]), tops)


class TheMovesOnAJetTests(unittest.TestCase):
    """The Dip, the Flip and the Ninja, scored as the school scores them."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.m = moves()["moves"]

    def test_each_verdict_is_what_the_nine_runs_give(self) -> None:
        for kind in ("dip", "flip", "ninja"):
            d = self.m[kind]
            self.assertEqual(9, d["of"], kind)
            self.assertEqual((d["claimed"]["works"], d["claimed"]["of"]), (d["works"], d["of"]), kind)
        # As written, on the F-16, the same: none of the three works.
        base = moves(base=True)["moves"]
        self.assertEqual([0, 0, 0], [base[k]["works"] for k in ("dip", "flip", "ninja")])

    def test_the_dip_never_gets_out(self) -> None:
        # "Never hit, never out. They had their nose on you from 300 to 340 m
        # behind for 23 to 24 s of the fight, but they hold their fire to
        # 190 m and never closed to it; they never gave the chase up, and at
        # 40 s they were 306 to 323 m behind you." The pass: within about
        # 45 m. "You both run at about 100 m/s": you at 98 to 103.
        for s in self.m["dip"]["scores"]:
            self.assertEqual([0, 0], s["hits"], s)
            self.assertFalse(s["hisFired"], s)
            self.assertNotIn("let-go", s["acePhases"], s)
            # 43-45 before; re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12).
            self.assertTrue(42 <= s["minRange"] <= 44, s)
            self.assertTrue(23 <= s["hisShot"] <= 24, s)
            self.assertTrue(300 <= s["hisShotRange"][0] and s["hisShotRange"][1] <= 480, s)
            self.assertTrue(306 <= s["endRange"] <= 323, s)
            self.assertLessEqual(s["opening"], 0, s)
            self.assertTrue(98 <= s["runSpeed"][0] and s["runSpeed"][1] <= 103, s)
        self.assertGreaterEqual(sum(1 for s in self.m["dip"]["scores"] if s["hisShotRange"][1] <= 340), 5)

    def test_the_flip_and_the_ninja_never_get_on_top(self) -> None:
        # "they follow you up at 60 to 68 m/s ... The Flip and the Ninja landed
        # a single hit in one fight of nine and none in the rest", "They never hit you".
        # 60-67 m/s and 5 hits before; re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12).
        for kind in ("flip", "ninja"):
            scores = self.m[kind]["scores"]
            for s in scores:
                self.assertEqual(0, s["hits"][0], (kind, s))
                self.assertEqual(0, s["hitsOnMe"], (kind, s))
                self.assertFalse(s["killed"], (kind, s))
                self.assertEqual(0, s["attacks"], (kind, s))
                self.assertLess(s["bestQuarter"], 2, (kind, s))
                self.assertTrue(60 <= s["aceMinSpeed"] <= 68, (kind, s))
            self.assertEqual([0] * 8 + [1], sorted(s["hits"][1] for s in scores), kind)

    def test_the_survival_verdict_follows_from_the_three(self) -> None:
        verdicts = ["works" if self.m[k]["works"] >= 7 else "partly" if self.m[k]["works"] >= 3 else "no"
                    for k in ("dip", "flip", "ninja")]
        self.assertEqual(["no", "no", "no"], verdicts)
        self.assertEqual("no", moves()["survival"]["verdict"])


if __name__ == "__main__":
    unittest.main()
