"""The break turn on a jet (features/dogfight-lessons-jets/break-turn.md,
`viewer/dogfight-jet-break-turn.js`): what its words claim, flown from the
harness's nine starts on the published F-16.

In this lesson side 0 (the harness's ACE) is the pilot under attack, who
cruises straight or breaks, and side 1 (YOU) the attacker; in the Dip, the
Flip and the Ninja side 0 is the school's hunter and side 1 the pilot who
flies the move. The moves' verdict counts, and the numbers their lines
quote, are from the measure's own nine starts (`dogfight-measure.js`
STARTS, scored with `scoreMove`, as `movesOn` scores them), flown by
`MEASURE` below; the harness's nine are held beside them.
"""

from __future__ import annotations

import functools
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from jet_school import jet_lesson, shot_down

TOOLS = Path(__file__).resolve().parents[1]


def demo(name: str, base: bool = False) -> list[dict]:
    return jet_lesson("break-turn", demo=name, base=base)["demos"][name]


# The moves flown from the measure's nine starts, scored as the school scores
# them, with what the words quote of each fight in real metres and m/s.
# Run as `node measure.mjs <tools> <plane>`; prints one JSON blob.
MEASURE = r"""
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [TOOLS, PLANE] = process.argv.slice(2);
const HERE = path.join(TOOLS, 'tests');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const load = name => import(pathToFileURL(path.join(viewer, name)).href);
const THREE = await load('vendor/three.module.js');
const { Aircraft } = await load('aircraft.js');
const { runDuel } = await load('dogfight-duel.js');
const { LESSONS, lessonFor, demoSides } = await load('dogfight-lessons.js');
const { scoreMove, verdictOf, STARTS, nudge, noseOf } = await load('dogfight-measure.js');
const { jetMaker } = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'dc-jets.json'), 'utf8'));
const L = lessonFor(LESSONS.find(l => l.id === 'break-turn'), 'jet');
const makePlane = jetMaker(THREE, Aircraft, fixture, PLANE);
const DEG = 180 / Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b) || 1)))) * DEG;
const r1 = v => Math.round(v * 10) / 10;
const out = {};
for (const d of L.demos) {
  if (!d.kind) continue;
  const scores = STARTS.map(st => {
    const sides = demoSides(L, d);
    sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
    const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
    const s = scoreMove(r, d.kind, 1);
    const [A, B] = r.tracks; const n = Math.min(A.length, B.length);
    const enter = (T, ph) => { const k = T.find(x => x.ph === ph); return k ? r1(k.t) : null; };
    const iTop = B.reduce((bi, k, i) => (k.p[1] > B[bi].p[1] ? i : bi), 0);
    const i8 = Math.round(8 / r.dt);
    // The circle, 12 to 42 s: how far apart, and how far above you they are.
    let rLo = Infinity, rHi = 0, uLo = Infinity, uHi = -Infinity;
    for (let i = Math.round(12 / r.dt); i < Math.min(n, Math.round(42 / r.dt)); i++) {
      const R = len(sub(A[i].p, B[i].p)); rLo = Math.min(rLo, R); rHi = Math.max(rHi, R);
      const u = A[i].p[1] - B[i].p[1]; uLo = Math.min(uLo, u); uHi = Math.max(uHi, u);
    }
    const iDive = B.findIndex(k => k.ph === 'dive');
    // On your six as the score counts it: off your tail, their nose on you, inside 400 m.
    const six = [];
    for (let j = 0; j < n; j++) {
      const rel = sub(B[j].p, A[j].p);
      if (ang(noseOf(B[j]).map(v => -v), rel.map(v => -v)) < 60 && ang(noseOf(A[j]), rel) < 30 && len(rel) < 400) six.push(B[j].t);
    }
    const ho = r.events.find(e => e.side === 0 && e.phase === 'headon');
    return {
      ok: s.ok, hitsOnMe: s.hitsOnMe ?? 0, hitsOnHim: s.hitsOnHim ?? 0, hisShot: s.hisShot ?? 0, myShot: s.myShot ?? 0,
      sixLost: s.sixLost ?? 0, opening: s.opening ?? null, endRange: s.endRange ?? null,
      hitsA: r.rounds.filter(x => x.hit && x.side === 0).map(x => r1(x.hitT)),
      hitsB: r.rounds.filter(x => x.hit && x.side === 1).map(x => r1(x.hitT)),
      topB: Math.round(B[iTop].p[1]), topBt: r1(B[iTop].t), vTopB: Math.round(B[iTop].v),
      topA: Math.round(Math.max(...A.map(k => k.p[1]))), slowA: Math.round(Math.min(...A.slice(i8).map(k => k.v))),
      letGo: enter(A, 'let-go'), run: enter(B, 'dip-run') ?? enter(B, 'leave'), zoom: enter(B, 'flip-zoom'),
      vEndB: Math.round(B[n - 1].v),
      rLo: Math.round(rLo), rHi: Math.round(rHi), uLo: Math.round(uLo), uHi: Math.round(uHi), headon: ho ? r1(ho.t) : null,
      diveT: iDive >= 0 ? r1(B[iDive].t) : null, diveR: iDive >= 0 ? Math.round(len(sub(A[iDive].p, B[iDive].p))) : null,
      diveUp: iDive >= 0 ? Math.round(B[iDive].p[1] - A[iDive].p[1]) : null, sixFrom: six.length ? r1(six[0]) : null,
    };
  });
  const v = verdictOf(scores);
  out[d.id] = { works: v.works, verdict: v.verdict, declared: d.verdict?.works ?? null, survival: L.survival.verdict, scores };
}
console.log(JSON.stringify(out));
"""


@functools.lru_cache(maxsize=None)
def measure(plane: str = "F16") -> dict:
    """The Dip, the Flip and the Ninja from the measure's nine on `plane`."""
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "measure.mjs"
        script.write_text(MEASURE)
        proc = subprocess.run(["node", str(script), str(TOOLS), plane], capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"break-turn measure failed:\n{proc.stderr[-3000:]}")
    return json.loads(proc.stdout)


class FlyingStraightTests(unittest.TestCase):
    def test_flying_straight_is_shot_down_every_time(self) -> None:
        # "the pilot who flew straight was shot down every time, 30 to 40 s in"
        runs = demo("without")
        self.assertEqual(9, shot_down(runs, 0))
        self.assertTrue(all(29 <= r["t"] <= 41 for r in runs), [r["t"] for r in runs])
        self.assertTrue(all(r["hits"][0] == 0 for r in runs))
        # "they close to 25 to 30 m behind you and stay there"
        self.assertTrue(all(20 <= r["closest"] <= 35 for r in runs), [r["closest"] for r in runs])
        # "cruised straight at 86 m/s"
        self.assertTrue(all(84 <= r["speed"][0] <= 88 for r in runs), [r["speed"] for r in runs])

    def test_as_written_the_attacker_flies_through_a_slow_target(self) -> None:
        # The Spitfire's 52 m/s cruise, 67 on the F-16: the attacker comes
        # within a few metres of its tail and on past it, and it survives
        # eight starts of nine with 5 to 20 rounds in it.
        runs = demo("without", base=True)
        self.assertEqual(1, shot_down(runs, 0))
        self.assertTrue(all(r["closest"] <= 10 for r in runs), [r["closest"] for r in runs])
        alive = [r for r in runs if r["winner"] is None]
        self.assertTrue(all(5 <= r["hits"][1] <= 21 for r in alive), [r["hits"] for r in alive])
        self.assertTrue(all("lost" in r["phases"][1] for r in alive))


class TheBreakTests(unittest.TestCase):
    def test_the_break_comes_at_once_and_is_never_shot_down(self) -> None:
        # "they are in reach from the start: turn at once"; "never was, and
        # took 0 to 4 hits".
        runs = demo("move")
        self.assertTrue(all(r["winner"] is None for r in runs))
        self.assertTrue(all(r["phases"][0][0] == "break" for r in runs), [r["phases"][0] for r in runs])
        self.assertTrue(all(r["hits"][1] <= 4 for r in runs), [r["hits"] for r in runs])
        self.assertEqual(4, max(r["hits"][1] for r in runs))

    def test_they_come_past_and_the_breaker_reverses_into_them(self) -> None:
        # "they come past your tail 4 to 7 s later, 40 to 75 m from you. As
        # they cross, reverse"; "they swing back in behind you, about 110 m back"
        runs = demo("move")
        self.assertTrue(all(40 <= r["closest"] <= 75 for r in runs), [r["closest"] for r in runs])
        self.assertTrue(all({"reverse", "turn"} <= set(r["phases"][0]) for r in runs))
        self.assertTrue(all(90 <= r["apart"] <= 130 for r in runs), [r["apart"] for r in runs])
        # "their extra speed is gone (both of you at 70 to 85 m/s)"
        self.assertTrue(all(65 <= v <= 85 for r in runs for v in r["speed"]), [r["speed"] for r in runs])

    def test_the_patient_attacker_stays_above_and_nobody_is_shot_down(self) -> None:
        # "never came within 59 m of the breaker"; "they never land a round on you".
        runs = demo("counter")
        self.assertTrue(all(r["winner"] is None for r in runs))
        self.assertTrue(all(r["hits"][0] == 0 and r["hits"][1] <= 1 for r in runs), [r["hits"] for r in runs])
        self.assertEqual(59, min(r["closest"] for r in runs))
        self.assertTrue(all("yoyo" in r["phases"][1] for r in runs))
        # 40 to 70 m above their circle (the median); at the bell, above them.
        self.assertTrue(all(r["height"][1] > r["height"][0] + 30 for r in runs), [r["height"] for r in runs])


class TheMovesTests(unittest.TestCase):
    """The Dip, the Flip and the Ninja: every number their lines quote."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.l9 = measure()

    def test_the_dip_goes_up_through_the_top_of_the_sky_and_never_gets_away(self) -> None:
        # "You go over the top at 1,590 to 1,600 m at 34 to 44 m/s, 26 s in;
        # they level off at 950 m (1,030 m in one), never under 95 m/s, and
        # give the chase up 31 to 33 s in ... You leave from the top 44 to 47
        # s in at 35 m/s: at 50 s you are 1.2 to 1.5 km apart and closing, and
        # in one they turn to meet you and land 2 rounds as you leave."
        dip = self.l9["dip"]
        self.assertEqual(0, dip["works"])
        self.assertEqual(dip["declared"], dip["works"])
        rows = dip["scores"]
        self.assertTrue(all(1585 <= r["topB"] <= 1605 and 34 <= r["vTopB"] <= 44 for r in rows), rows)
        self.assertTrue(all(25.5 <= r["topBt"] <= 27 for r in rows), [r["topBt"] for r in rows])
        tops = sorted(r["topA"] for r in rows)
        self.assertTrue(all(950 <= h <= 956 for h in tops[:8]) and 1025 <= tops[8] <= 1035, tops)
        self.assertTrue(all(r["slowA"] >= 95 for r in rows), [r["slowA"] for r in rows])
        self.assertTrue(all(31 <= r["letGo"] <= 33 for r in rows), [r["letGo"] for r in rows])
        self.assertTrue(all(43.5 <= r["run"] <= 47 and 32 <= r["vEndB"] <= 36 for r in rows), rows)
        self.assertTrue(all(r["opening"] < 0 for r in rows), [r["opening"] for r in rows])
        far = sorted(r["endRange"] for r in rows)
        self.assertTrue(far[0] < 100 and all(1150 <= x <= 1500 for x in far[1:]), far)
        self.assertEqual([[47.0, 47.2]], [r["hitsA"] for r in rows if r["hitsA"]])
        self.assertTrue(all(r["hitsOnMe"] == 0 and r["hisShot"] <= 0.2 for r in rows), rows)
        # The harness's nine: nobody hit, they let you go, you never get away.
        runs = demo("dip")
        self.assertTrue(all(r["winner"] is None and r["hits"] == [0, 0] for r in runs))
        self.assertTrue(all("let-go" in r["phases"][0] for r in runs))
        self.assertTrue(all({"zoom", "over", "dip-run"} <= set(r["phases"][1]) for r in runs), [r["phases"][1] for r in runs])

    def test_the_flip_barely_gets_to_zoom(self) -> None:
        # "they hang 110 to 860 m away, from 100 m below you to 120 m above ...
        # until a head-on pass 40 to 45 s in; the zoom starts 44 to 45 s in,
        # in three of the nine ... Their rounds never land; yours land once, 1
        # round in the head-on pass."
        flip = self.l9["flip"]
        self.assertEqual(0, flip["works"])
        self.assertEqual(flip["declared"], flip["works"])
        rows = flip["scores"]
        self.assertEqual((110, 858), (min(r["rLo"] for r in rows), max(r["rHi"] for r in rows)))
        self.assertEqual((-97, 119), (min(r["uLo"] for r in rows), max(r["uHi"] for r in rows)))
        self.assertTrue(all(39.5 <= r["headon"] <= 45 for r in rows), [r["headon"] for r in rows])
        zooms = [r["zoom"] for r in rows if r["zoom"] is not None]
        self.assertEqual(3, len(zooms))
        self.assertTrue(all(43.5 <= z <= 45.1 for z in zooms), zooms)
        self.assertTrue(all(r["hitsA"] == [] for r in rows))
        self.assertEqual([[43.8]], [r["hitsB"] for r in rows if r["hitsB"]])
        # The harness's nine: nobody comes down, nothing lands on the Flip.
        runs = demo("flip")
        self.assertTrue(all(r["winner"] is None and r["hits"][0] == 0 for r in runs))
        self.assertTrue(all("headon" in r["phases"][0] for r in runs))
        self.assertTrue(all("flip-over" not in r["phases"][1] and "flip-guns" not in r["phases"][1] for r in runs))

    def test_the_ninja_dives_from_a_kilometre_away_and_never_fires(self) -> None:
        # "as their nose comes off you, 30 to 32 s in, you dive, 1.2 to 1.3 km
        # from them and 550 to 620 m above. They sit on your six 1.5 to 1.8 s
        # once, as you go up, without a shot."
        ninja = self.l9["ninja"]
        self.assertEqual(0, ninja["works"])
        self.assertEqual(ninja["declared"], ninja["works"])
        rows = ninja["scores"]
        self.assertTrue(all(r["myShot"] == 0 and r["hitsOnHim"] == 0 for r in rows), rows)
        self.assertTrue(all(30 <= r["diveT"] <= 32 for r in rows), [r["diveT"] for r in rows])
        self.assertTrue(all(1150 <= r["diveR"] <= 1340 and 550 <= r["diveUp"] <= 620 for r in rows), rows)
        self.assertTrue(all(1.45 <= r["sixLost"] <= 1.85 for r in rows), [r["sixLost"] for r in rows])
        self.assertTrue(all(10.5 <= r["sixFrom"] <= 12 for r in rows), [r["sixFrom"] for r in rows])
        self.assertTrue(all(1585 <= r["topB"] <= 1605 for r in rows))
        self.assertEqual([2], [r["hitsOnMe"] for r in rows if r["hitsOnMe"]])
        runs = demo("ninja")
        self.assertTrue(all(r["winner"] is None and r["hits"] == [0, 0] for r in runs))
        self.assertTrue(all("dive" in r["phases"][1] and r["shots"][1] == 0 for r in runs))
        self.assertTrue(all("let-go" in r["phases"][0] for r in runs))

    def test_the_survival_verdict_follows_from_the_three(self) -> None:
        verdicts = [d["verdict"] for d in self.l9.values()]
        want = "yes" if "works" in verdicts else "partly" if "partly" in verdicts else "no"
        self.assertEqual("no", want)
        self.assertEqual(want, self.l9["dip"]["survival"])

    def test_on_the_mig29_nothing_works_and_the_dip_never_leaves_the_top(self) -> None:
        # break-turn.md, the MiG-29: Dip, Flip and Ninja 0 of 9; in 50 s the
        # Dip never gets as far as its run.
        mig = measure("Mig29")
        self.assertEqual([0, 0, 0], [mig[k]["works"] for k in ("dip", "flip", "ninja")])
        self.assertTrue(all(r["run"] is None for r in mig["dip"]["scores"]))


class TheJetFileTests(unittest.TestCase):
    def test_it_is_laid_over_the_lesson(self) -> None:
        self.assertEqual("jet", jet_lesson("break-turn", demo="move")["era"])
        self.assertIsNone(jet_lesson("break-turn", demo="move", base=True)["era"])


if __name__ == "__main__":
    unittest.main()
