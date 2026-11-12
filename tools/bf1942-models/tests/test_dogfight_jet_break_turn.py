"""The break turn on a jet (features/dogfight-lessons-jets/break-turn.md,
`viewer/dogfight-lessons/jets/break-turn.js`): what its words claim, flown from the
harness's nine starts on the published F-16.

In this lesson side 0 (the harness's ACE) is the pilot under attack, who
cruises straight or breaks, and side 1 (YOU) the attacker; in the Dip, the
Flip and the Ninja side 0 is the school's hunter and side 1 the pilot who
flies the move. The moves' verdict counts, and the numbers their lines
quote, are from the measure's own nine starts (`dogfight-measure.js`
STARTS, scored with `scoreMove`, as `movesOn` scores them), flown by
`MEASURE` below; the harness's nine are held beside them. Every jet pilot
flies under the roof (`dogfight-jet-ceiling.js`); the Dip is the jet's own
(`jetBtDip`, `viewer/dogfight-lessons/jets/plan-break-turn.js`).
"""

from __future__ import annotations

import functools
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from jet_school import jet_lesson, jet_steps, jet_tops, shot_down

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
    // Where the move leaves (the jet Dip's run, the Ninja's), where the
    // hunter lets go, and the heights the words quote.
    const iOut = B.findIndex(k => k.ph === 'dip-out' || k.ph === 'leave');
    const iLet = A.findIndex(k => k.ph === 'let-go');
    const zoomed = B.filter(k => ['zoom', 'over', 'dip-zoom', 'dip-over'].includes(k.ph));
    let minAll = Infinity, aboveMax = -Infinity;
    for (let j = 0; j < n; j++) { minAll = Math.min(minAll, len(sub(A[j].p, B[j].p))); aboveMax = Math.max(aboveMax, A[j].p[1] - B[j].p[1]); }
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
      sep0: Math.round(len(sub(A[0].p, B[0].p))), minAll: Math.round(minAll), aboveMax: Math.round(aboveMax),
      outT: iOut >= 0 ? r1(B[iOut].t) : null, rLet: iLet >= 0 ? Math.round(len(sub(A[iLet].p, B[iLet].p))) : null,
      letLo: iLet >= 0 ? Math.round(Math.min(...A.slice(iLet).map(k => k.p[1]))) : null,
      lowB: Math.round(Math.min(...B.map(k => k.p[1]))), zoomTop: zoomed.length ? Math.round(Math.max(...zoomed.map(k => k.p[1]))) : null,
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
        # seven starts of nine with 6 to 17 rounds in it.
        runs = demo("without", base=True)
        # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
        self.assertEqual(2, shot_down(runs, 0))
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
        # "never came within 56 m of the breaker"; "they never land a round on you".
        runs = demo("counter")
        self.assertTrue(all(r["winner"] is None for r in runs))
        self.assertTrue(all(r["hits"][0] == 0 and r["hits"][1] <= 1 for r in runs), [r["hits"] for r in runs])
        # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12);
        # moved by the Spitfire retune of the shared `breakTurn` (reverses at 6 m across, was 8)
        self.assertEqual(56, min(r["closest"] for r in runs))
        self.assertTrue(all("yoyo" in r["phases"][1] for r in runs))
        # 40 to 70 m above their circle (the median); at the bell, above them.
        self.assertTrue(all(r["height"][1] > r["height"][0] + 30 for r in runs), [r["height"] for r in runs])


class TheMovesTests(unittest.TestCase):
    """The Dip, the Flip and the Ninja under the roof: every number their lines quote."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.l9 = measure()

    def test_the_dip_goes_up_and_away_level_and_gets_away(self) -> None:
        # "Turn into them at once, about 650 m out"; "Yes, in all nine: none
        # of their rounds lands. They come past you 83 to 101 m off; your zoom
        # levels off at 756 to 759 m and they come up to 758 to 762. You leave
        # 24 s in, and at 560 to 620 m behind you, not closing, they let you
        # go 31 to 35 s in. At 50 s you are 3.6 to 4.5 km apart and opening,
        # at 127 m/s. As you go up they sit on your tail for up to 4.7 s and
        # have a shot for 0.8 s at most."
        dip = self.l9["dip"]
        self.assertEqual(9, dip["works"])
        self.assertEqual(dip["declared"], dip["works"])
        rows = dip["scores"]
        self.assertTrue(all(585 <= r["sep0"] <= 700 for r in rows), [r["sep0"] for r in rows])
        self.assertTrue(all(r["hitsA"] == [] and r["hitsB"] == [] for r in rows), rows)
        self.assertTrue(all(83 <= r["minAll"] <= 101 for r in rows), [r["minAll"] for r in rows])
        self.assertTrue(all(755 <= r["zoomTop"] <= 760 for r in rows), [r["zoomTop"] for r in rows])
        self.assertTrue(all(757 <= r["topA"] <= 763 for r in rows), [r["topA"] for r in rows])
        self.assertTrue(all(24 <= r["outT"] <= 24.7 for r in rows), [r["outT"] for r in rows])
        self.assertTrue(all(560 <= r["rLet"] <= 620 for r in rows), [r["rLet"] for r in rows])
        self.assertTrue(all(30.5 <= r["letGo"] <= 35 for r in rows), [r["letGo"] for r in rows])
        self.assertTrue(all(3600 <= r["endRange"] <= 4500 and r["opening"] > 0 for r in rows), rows)
        self.assertTrue(all(126 <= r["vEndB"] <= 129 for r in rows), [r["vEndB"] for r in rows])
        self.assertLessEqual(max(r["sixLost"] for r in rows), 4.7)
        self.assertLessEqual(max(r["hisShot"] for r in rows), 0.8)
        # The harness's nine: nobody hit, they let you go.
        runs = demo("dip")
        self.assertTrue(all(r["winner"] is None and r["hits"] == [0, 0] for r in runs))
        self.assertTrue(all("let-go" in r["phases"][0] for r in runs))
        self.assertTrue(all({"dip-break", "dip-zoom", "dip-over", "dip-out"} <= set(r["phases"][1]) for r in runs), [r["phases"][1] for r in runs])

    def test_the_dip_has_its_own_steps(self) -> None:
        # The jet Dip's four steps, all flown, in order.
        card = jet_steps("break-turn")
        self.assertEqual(["dip"], list(card["steps"]))
        times = [s["t"] for s in card["steps"]["dip"]]
        self.assertEqual(["dip-break", "dip-zoom", "dip-over", "dip-out"], [s["phase"] for s in card["steps"]["dip"]])
        self.assertTrue(all(t is not None for t in times) and times == sorted(times), times)

    def test_the_flip_barely_gets_to_zoom(self) -> None:
        # "In the circle, 12 to 42 s in, they hang 25 to 744 m away, from 41 m
        # below you to 69 m above, never dead astern inside 155 m in time:
        # the zoom comes in two of the nine, 41 s in, with no time left to
        # come back down. Their rounds never land; yours land in three of the
        # nine, 1 round each, 38 to 39 s in."
        flip = self.l9["flip"]
        self.assertEqual(0, flip["works"])
        self.assertEqual(flip["declared"], flip["works"])
        rows = flip["scores"]
        # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
        self.assertEqual((25, 744), (min(r["rLo"] for r in rows), max(r["rHi"] for r in rows)))
        self.assertEqual((-41, 69), (min(r["uLo"] for r in rows), max(r["uHi"] for r in rows)))
        zooms = [r["zoom"] for r in rows if r["zoom"] is not None]
        self.assertEqual(2, len(zooms))
        self.assertTrue(all(40.5 <= z <= 41.5 for z in zooms), zooms)
        self.assertTrue(all(r["hitsA"] == [] for r in rows))
        # Words rewritten 2026-11-12 on retail g and box area
        # (features/retail-parity-cross-check-2026-11-12): one start with a
        # round landed became three.
        self.assertEqual([[38.9], [39.3], [38.4]], [r["hitsB"] for r in rows if r["hitsB"]])
        runs = demo("flip")
        self.assertTrue(all(r["winner"] is None for r in runs))

    def test_the_ninja_is_above_them_but_never_dives(self) -> None:
        # "Your zoom levels off at 756 to 759 m, 17 to 18 s in, at 111 to 113
        # m/s; they come up to 750 to 753 m, and you are 50 to 55 m above
        # them, but their nose stays on you and the dive never comes. You
        # leave 24 s in, 8 degrees nose down: in five of nine they let you go
        # 31 s in, in four they sit 493 to 500 m behind you at 50 s. Nobody
        # lands a round." The lesson's own Dip (`btDip`) flies this flight to
        # the last decimal: the story's "in four of nine" and the survival
        # line's "500 m behind you in four of nine".
        ninja = self.l9["ninja"]
        self.assertEqual(0, ninja["works"])
        self.assertEqual(ninja["declared"], ninja["works"])
        rows = ninja["scores"]
        self.assertTrue(all(755 <= r["zoomTop"] <= 760 and 111 <= r["vTopB"] <= 113 for r in rows), rows)
        self.assertTrue(all(17 <= r["topBt"] <= 18 for r in rows), [r["topBt"] for r in rows])
        self.assertTrue(all(750 <= r["topA"] <= 753 for r in rows), [r["topA"] for r in rows])
        self.assertEqual((-55, -50), (min(r["uLo"] for r in rows), max(r["uLo"] for r in rows)))
        self.assertTrue(all(r["diveT"] is None and r["myShot"] == 0 for r in rows), rows)
        self.assertTrue(all(24 <= r["outT"] <= 24.7 for r in rows), [r["outT"] for r in rows])
        let = [r for r in rows if r["letGo"] is not None]
        self.assertEqual(5, len(let))
        self.assertTrue(all(30.5 <= r["letGo"] <= 31.5 and r["opening"] > 0 for r in let), let)
        stay = [r for r in rows if r["letGo"] is None]
        self.assertTrue(all(493 <= r["endRange"] <= 500 for r in stay), stay)
        self.assertTrue(all(r["hitsA"] == [] and r["hitsB"] == [] for r in rows), rows)
        runs = demo("ninja")
        self.assertTrue(all(r["winner"] is None and r["hits"] == [0, 0] for r in runs))
        self.assertTrue(all("dive" not in r["phases"][1] and r["shots"][1] == 0 for r in runs))

    def test_the_survival_verdict_follows_from_the_three(self) -> None:
        verdicts = [d["verdict"] for d in self.l9.values()]
        want = "yes" if "works" in verdicts else "partly" if "partly" in verdicts else "no"
        self.assertEqual("yes", want)
        self.assertEqual(want, self.l9["dip"]["survival"])

    def test_on_the_mig29_the_dip_gets_away_and_nothing_else_works(self) -> None:
        # break-turn.md, the MiG-29: the jet Dip 9 of 9, 6.7 to 7.2 km apart
        # at 50 s; the Flip and the Ninja 0 of 9 (the Ninja's run from the
        # top gets away, 6.5 to 6.9 km, but it never fires).
        mig = measure("Mig29")
        self.assertEqual([9, 0, 0], [mig[k]["works"] for k in ("dip", "flip", "ninja")])
        self.assertTrue(all(6700 <= r["endRange"] <= 7200 and r["hitsA"] == [] for r in mig["dip"]["scores"]))
        self.assertTrue(all(6500 <= r["endRange"] <= 6950 and r["opening"] > 0 and r["myShot"] == 0 for r in mig["ninja"]["scores"]))


class TheRoofTests(unittest.TestCase):
    def test_nobody_goes_near_the_top_of_the_sky(self) -> None:
        # Under the roof (dogfight-jet-ceiling.js): on the F-16 nobody in any
        # demo or move tops 860 m.
        tops = jet_tops("F16", "break-turn")["break-turn"]
        self.assertTrue(all(h < 860 for d in tops.values() for h in d["top"]), tops)
        self.assertEqual(770, max(h for d in tops.values() for h in d["top"]))
        self.assertEqual([704, 712], sorted(tops["dip"]["start"]))
        # The MiG-29 as measured: the hunter in the Flip is the highest.
        mig = jet_tops("Mig29", "break-turn")["break-turn"]
        self.assertEqual(847, max(h for d in mig.values() for h in d["top"]))
        self.assertEqual(847, max(mig["flip"]["top"]))
        self.assertEqual([735, 740], sorted(mig["dip"]["start"]))


class TheJetFileTests(unittest.TestCase):
    def test_it_is_laid_over_the_lesson(self) -> None:
        self.assertEqual("jet", jet_lesson("break-turn", demo="move")["era"])
        self.assertIsNone(jet_lesson("break-turn", demo="move", base=True)["era"])


if __name__ == "__main__":
    unittest.main()
