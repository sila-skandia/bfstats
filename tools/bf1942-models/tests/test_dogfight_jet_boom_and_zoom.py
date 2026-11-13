"""Boom and zoom on Desert Combat's jets (features/dogfight-lessons-jets,
boom-and-zoom.md): `viewer/dogfight-lessons/jets/boom-and-zoom.js` and its plans
`jetBzDip` and `jetBzAceMeet` (`viewer/dogfight-lessons/jets/plan-boom-and-zoom.js`),
flown on the published F-16 and MiG-29 (`fixtures/dc-jets.json`) under the
roof every jet pilot flies (`viewer/dogfight-jet-ceiling.js` `underRoof`, as
reworked in `868247883`).

What the jet file's words say, held here number by number:

- The pilot who never looks up is shot down from all nine starts, in one
  pass or two, 13 to 52 s in.
- The one who meets the dive is never hit, and after the one dive the ace
  never gets above them again: under the top of the sky there is nowhere
  higher to go.
- The way out is up: straight on, climbing 3 degrees to the top of the sky,
  where a jet is fastest; they give the chase up (9 of 9). Run low, as the
  Spitfire's Dip does, and they follow you down (0 of 9). Nothing gets on
  top of them (the Flip and the Ninja, 0 of 9 each).

The story's numbers come from the school's nine starts (x by speed, as
`jet_school.jet_lesson` flies them); each verdict from the measure's nine
(`dogfight-measure.js` STARTS, scored with `scoreMove`, as the theatre's
`movesOn` scores a lesson on the airframe it flies).
"""

from __future__ import annotations

import functools
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from jet_school import jet_lesson, jet_moves, jet_tops, shot_down

TOOLS = Path(__file__).resolve().parents[1]
VIEWER = TOOLS / "viewer"

# Flies the lesson's demos on one jet and measures them in the words' terms.
# Run as `node measure.mjs <tools> <plane> <base 0|1>`; prints one JSON blob.
MEASURE = r"""
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [TOOLS, PLANE, BASE] = process.argv.slice(2);
const HERE = path.join(TOOLS, 'tests');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const load = name => import(pathToFileURL(path.join(viewer, name)).href);
const THREE = await load('vendor/three.module.js');
const { Aircraft } = await load('aircraft.js');
const { runDuel } = await load('dogfight-duel.js');
const { LESSONS, lessonFor, demoSides, demoById } = await load('dogfight-lessons.js');
const { scoreMove, verdictOf, STARTS, nudge } = await load('dogfight-measure.js');
const { jetMaker } = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'dc-jets.json'), 'utf8'));
const base = LESSONS.find(l => l.id === 'boom-and-zoom');
const L = BASE === '1' ? base : lessonFor(base, 'jet');
const makePlane = jetMaker(THREE, Aircraft, fixture, PLANE);
const DEG = 180 / Math.PI;
const r1 = v => Math.round(v * 10) / 10;
const sep = (A, B, i) => Math.hypot(A[i].p[0] - B[i].p[0], A[i].p[1] - B[i].p[1], A[i].p[2] - B[i].p[2]);
const NINE = [];
for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) NINE.push({ dx, dv });
const fly = (d, st) => {
  const sides = demoSides(L, d);
  sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
  return runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
};
const phases = (r, s) => r.events.filter(e => e.side === s && e.phase !== 'kill').map(e => [e.phase, r1(e.t)]);
/** The ace's dives: when each began, how far out and how high over you,
 *  how steeply down it looked at you, and the rounds it landed. */
function passes(r) {
  const [A, B] = r.tracks;
  const dives = r.events.filter(e => e.side === 0 && e.phase === 'dive').map(e => e.t);
  return dives.map((t, k) => {
    const i = Math.min(A.length - 1, Math.round(t / r.dt));
    const next = dives[k + 1] ?? Infinity;
    const flat = Math.hypot(A[i].p[0] - B[i].p[0], A[i].p[2] - B[i].p[2]);
    const above = A[i].p[1] - B[i].p[1];
    return { t: r1(t), range: Math.round(sep(A, B, i)), above: Math.round(above), down: Math.round(Math.atan2(above, flat) * DEG),
      hits: r.rounds.filter(x => x.hit && x.side === 0 && x.hitT >= t && x.hitT < next).length };
  });
}
function words(r) {
  const [A, B] = r.tracks; const n = Math.min(A.length, B.length);
  let closest = Infinity;
  for (let i = 0; i < n; i++) closest = Math.min(closest, sep(A, B, i));
  return {
    winner: r.end ? r.end.winner : null, why: r.end?.why ?? null, t: r.end ? r1(r.end.t) : null, hits: r.hits,
    fired: [0, 1].map(s => r.rounds.filter(x => x.side === s).length),
    passes: passes(r), closest: Math.round(closest),
    start: [0, 1].map(s => Math.round(r.tracks[s][0].p[1])),
    top: [0, 1].map(s => Math.round(Math.max(...r.tracks[s].map(k => k.p[1])))),
    end: [0, 1].map(s => Math.round(r.tracks[s][n - 1].p[1])), apart: Math.round(sep(A, B, n - 1)),
    acePhases: phases(r, 0), myPhases: phases(r, 1),
  };
}
const out = { era: L.era ?? null, plane: PLANE, nine: {}, l9: {} };
// `dipLow`: the Dip as the Spitfire flies it (`bzDip`, low and level) against the same ace.
for (const id of ['move', 'counter', 'dip', 'flip', 'ninja', 'dipLow']) {
  const d = id === 'dipLow' ? { ...demoById(L, 'dip'), seat: 'bzDip' } : demoById(L, id);
  if (id !== 'dipLow') out.nine[id] = NINE.map(st => ({ ...st, ...words(fly(d, st)) }));
  if (!d.kind) continue;
  const scores = STARTS.map(st => {
    const r = fly(d, st);
    const s = scoreMove(r, d.kind, 1);
    const [A, B] = r.tracks; const n = Math.min(A.length, B.length);
    // From 5 s after the move began: the closest they came; and how fast
    // they closed over the last 10 s, m/s.
    const i0 = s.t0 === null ? n : Math.round((s.t0 + 5) / r.dt);
    let after = Infinity; for (let i = i0; i < n; i++) after = Math.min(after, sep(A, B, i));
    const back = n - 1 - Math.round(10 / r.dt);
    return { ...s, closestAfter: Number.isFinite(after) ? Math.round(after) : null,
      closing10: s.t0 === null ? null : r1((sep(A, B, back) - sep(A, B, n - 1)) / 10),
      end: [0, 1].map(k => Math.round(r.tracks[k][n - 1].p[1])), endSpeeds: [0, 1].map(k => Math.round(r.tracks[k][n - 1].v)),
      hits: r.hits, acePhases: phases(r, 0), myPhases: phases(r, 1), passes: passes(r) };
  });
  out.l9[id] = { declared: id === 'dipLow' ? null : d.verdict ?? null, measured: verdictOf(scores), scores };
}
out.survival = L.survival ?? null;
console.log(JSON.stringify(out));
"""


@functools.lru_cache(maxsize=None)
def measure(plane: str = "F16", base: bool = False) -> dict:
    """The lesson's five fights on `plane`, from the school's nine starts and
    the measure's nine, in real metres and m/s (`MEASURE`)."""
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "measure.mjs"
        script.write_text(MEASURE)
        proc = subprocess.run(["node", str(script), str(TOOLS), plane, "1" if base else "0"],
                              capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"boom-and-zoom measure failed:\n{proc.stderr[-3000:]}")
    return json.loads(proc.stdout)


def spread(values: list) -> tuple:
    values = [v for v in values if v is not None]
    return (min(values), max(values))


def entered(phases: list, phase: str) -> list:
    """When each time `phase` was entered, from a `[phase, t]` list."""
    return [t for p, t in phases if p == phase]


class BoomAndZoomOnAJetTests(unittest.TestCase):
    """`viewer/dogfight-lessons/jets/boom-and-zoom.js` on the F-16, every number its words give."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.jet = measure()

    def nine(self, demo: str) -> list[dict]:
        rows = self.jet["nine"][demo]
        self.assertEqual(9, len(rows))
        return rows

    def l9(self, demo: str) -> dict:
        got = self.jet["l9"][demo]
        self.assertEqual(9, len(got["scores"]))
        if got["declared"]:
            self.assertEqual(got["declared"]["works"], got["measured"]["works"], demo)
        return got

    def test_the_jet_file_is_laid_over_the_lesson(self) -> None:
        self.assertEqual("jet", self.jet["era"])
        self.assertIsNone(measure(base=True)["era"])

    def test_they_perch_under_the_roof_372_m_over_you(self) -> None:
        # "perched at 730 m, 372 m over you"
        for demo in ("move", "counter"):
            self.assertTrue(all(r["start"] == [730, 358] for r in self.nine(demo)), demo)
        # "They dive from 338 to 356 m above you, 589 to 621 m out, and one
        # burst lands 15 to 23 rounds."
        first = [r["passes"][0] for r in self.nine("move")]
        self.assertEqual((338, 356), spread([p["above"] for p in first]))
        # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
        self.assertEqual((589, 621), spread([p["range"] for p in first]))
        self.assertEqual((15, 23), spread([p["hits"] for p in first]))

    def test_the_pilot_who_never_looks_up_is_shot_down(self) -> None:
        # "shot down every time, in one pass or two, 13 to 52 s in"
        rows = self.nine("move")
        self.assertTrue(all(r["winner"] == 0 and r["why"] == "shot down" for r in rows), [(r["winner"], r["t"]) for r in rows])
        self.assertTrue(all(r["fired"][1] == 0 and r["hits"][1] == 0 for r in rows))
        lo, hi = spread([r["t"] for r in rows])
        self.assertTrue(12.5 <= lo and hi <= 52, (lo, hi))
        self.assertEqual([1, 1, 2, 2, 2, 2, 2, 2, 2], sorted(len(r["passes"]) for r in rows))
        self.assertEqual(9, shot_down(jet_lesson("boom-and-zoom", demo="move")["demos"]["move"], 1))

    def test_as_written_the_lessons_burst_leaves_them_alive(self) -> None:
        # The lesson with no jet file on the F-16 (a 0.6 s burst): one shot
        # down in nine, the rest hit 15 to 21 times.
        base = jet_lesson("boom-and-zoom", demo="move", base=True)["demos"]["move"]
        self.assertEqual(1, shot_down(base, 1))
        # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
        self.assertEqual((15, 21), spread([r["hits"][0] for r in base if r["winner"] is None]))

    def test_meeting_the_dive_is_never_hit(self) -> None:
        # "they pull out and zoom off without firing a round"
        rows = self.nine("counter")
        self.assertTrue(all(r["winner"] is None and r["hits"] == [0, 0] and r["fired"][0] == 0 for r in rows), rows)
        runs = jet_lesson("boom-and-zoom", demo="counter")["demos"]["counter"]
        self.assertTrue(all(r["winner"] is None and r["hits"] == [0, 0] for r in runs), [r["hits"] for r in runs])
        # "after it they never dive on you again, and the two of you end
        # level, at 764 to 770 m."
        self.assertTrue(all(len(r["passes"]) == 1 for r in rows), [r["passes"] for r in rows])
        self.assertEqual((764, 770), spread([h for r in rows for h in r["end"]]))
        # The dive comes from 181 to 251 m over you in seven; in two your
        # climb has brought you to 67 m under them by 10 s, their perch's end.
        above = sorted(r["passes"][0]["above"] for r in rows)
        self.assertEqual([67, 67], above[:2])
        self.assertEqual((181, 251), (above[2], above[-1]))

    def test_the_dip_goes_up_and_away(self) -> None:
        dip = self.l9("dip")
        self.assertEqual(9, dip["measured"]["works"])
        scores = dip["scores"]
        # The Dip is flown in all nine: their first dive comes 0 s in.
        self.assertTrue(all(4.9 <= s["t0"] <= 5.4 for s in scores), [s["t0"] for s in scores])
        self.assertTrue(all(s["passes"][0]["t"] == 0 for s in scores))
        # "Out in all nine and never hit: their guns never bore on you. They
        # dive after you once more, 16 s in, from 1.7 to 1.8 km back and only
        # 153 to 189 m above you, never get within 798 m, and give up the
        # chase 19.6 to 20.4 s in. At 90 s you are 16.8 to 17.3 km apart, you
        # at 770 m and 128 m/s."
        self.assertTrue(all(s["ok"] and s["hitsOnMe"] == 0 and s["hisShot"] == 0 and s["hits"] == [0, 0] for s in scores), scores)
        self.assertTrue(all(len(s["passes"]) == 2 for s in scores))
        again = [s["passes"][1] for s in scores]
        self.assertTrue(all(16 <= p["t"] < 17 for p in again), again)
        # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
        self.assertEqual((1732, 1828), spread([p["range"] for p in again]))
        self.assertEqual((153, 189), spread([p["above"] for p in again]))
        self.assertEqual((798, 827), spread([s["closestAfter"] for s in scores]))
        self.assertEqual((19.6, 20.4), spread([entered(s["acePhases"], "let-go")[0] for s in scores]))
        self.assertEqual((16837, 17327), spread([s["endRange"] for s in scores]))
        self.assertTrue(all(s["end"][1] == 770 and s["endSpeeds"][1] == 128 for s in scores), [(s["end"], s["endSpeeds"]) for s in scores])

    def test_run_low_as_a_spitfire_does_and_they_follow_you_down(self) -> None:
        # "Run low as a Spitfire does and they follow you down": `bzDip`
        # against the same ace, level at 215 m and 93 m/s, is never hit, but
        # they dive after you again and again and at 90 s are still closing.
        low = self.l9("dipLow")
        self.assertEqual(0, low["measured"]["works"])
        scores = low["scores"]
        self.assertTrue(all(s["hitsOnMe"] == 0 and s["opening"] < 0 for s in scores), scores)
        self.assertTrue(all(s["end"][1] == 215 and s["endSpeeds"][1] == 93 for s in scores))
        self.assertTrue(all(len(s["passes"]) >= 3 for s in scores), [len(s["passes"]) for s in scores])

    def test_against_the_lessons_ace_the_dip_had_no_dive_to_meet_in_three(self) -> None:
        # The lesson as written on the F-16 (its ace `bzAceMeet`): from the
        # lesson's perch your climb took you up to them in three starts of
        # nine before they dived, and no Dip was flown there.
        base = measure(base=True)["l9"]["dip"]["scores"]
        self.assertEqual([4, 6, 7], [i for i, s in enumerate(base) if s["t0"] is None])

    def test_the_flip_never_gets_the_shot(self) -> None:
        # "They turn to face you 1.3 to 3.3 s in, and again 12.2 to 13.4 s in.
        # In eight you go in behind them at 9.6 to 10.9 s and come within 32
        # to 59 m of them, but your guns never bear; in the ninth you never go
        # in. Nobody is hit."
        flip = self.l9("flip")
        self.assertEqual(0, flip["measured"]["works"])
        scores = flip["scores"]
        meets = [entered(s["acePhases"], "meet") for s in scores]
        self.assertEqual((1.3, 3.3), spread([m[0] for m in meets]))
        self.assertEqual((12.2, 13.4), spread([m[1] for m in meets if len(m) > 1]))
        went = [s for s in scores if s["t0"] is not None]
        self.assertEqual(8, len(went))
        self.assertEqual((9.6, 10.9), spread([round(s["t0"], 1) for s in went]))
        self.assertEqual((32, 59), spread([s["minRange"] for s in went]))
        self.assertTrue(all(s["myShot"] == 0 for s in went))
        self.assertTrue(all(s["hits"] == [0, 0] for s in scores))

    def test_the_ninja_never_gets_its_dive(self) -> None:
        # "You get over them 4.5 to 8.6 s in, but never far enough over them
        # for the dive, and you run 7.9 to 10.1 s in. Nobody fires a shot that
        # bears, and at 25 s you are 1.7 to 3.2 km apart."
        ninja = self.l9("ninja")
        self.assertEqual(0, ninja["measured"]["works"])
        scores = ninja["scores"]
        self.assertEqual((4.5, 8.6), spread([entered(s["myPhases"], "ninja-perch")[0] for s in scores]))
        self.assertFalse(any(entered(s["myPhases"], "ninja-dive") for s in scores))
        self.assertEqual((7.9, 10.1), spread([entered(s["myPhases"], "ninja-run")[0] for s in scores]))
        self.assertTrue(all(s["hits"] == [0, 0] and s["myShot"] == 0 and s["hisShot"] == 0 for s in scores))
        # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
        self.assertEqual((1702, 3178), spread([s["endRange"] for s in scores]))

    def test_the_survival_verdict_follows_from_the_three(self) -> None:
        verdicts = [self.jet["l9"][m]["measured"]["verdict"] for m in ("dip", "flip", "ninja")]
        want = "yes" if "works" in verdicts else "partly" if "partly" in verdicts else "no"
        self.assertEqual(want, self.jet["survival"]["verdict"])
        self.assertEqual("yes", want)
        # The school's own scoring of the moves agrees.
        moves = jet_moves("boom-and-zoom")
        self.assertEqual({"dip": 9, "flip": 0, "ninja": 0}, {k: m["works"] for k, m in moves.items()})

    def test_nobody_goes_near_the_top_of_the_sky(self) -> None:
        tops = jet_tops("F16", "boom-and-zoom")["boom-and-zoom"]
        self.assertEqual({"counter", "dip", "flip", "ninja"}, set(tops))
        for demo, x in tops.items():
            self.assertLess(max(x["top"]), 860, demo)
        self.assertLess(max(r["top"][0] for r in self.nine("move")), 860)

    def test_the_words_call_pilots_they(self) -> None:
        words = (VIEWER / "dogfight-lessons/jets/boom-and-zoom.js").read_text()
        body = words[words.index("export default"):]
        plan = (VIEWER / "dogfight-lessons/jets/plan-boom-and-zoom.js").read_text()
        says = "".join(plan[m.end():plan.index("},", m.end())] for m in re.finditer(r"says: \{", plan))
        for text in (body, says):
            found = re.search(r"\b(he|him|his|himself)\b", text, re.I)
            self.assertIsNone(found, found)
            self.assertTrue(all(ord(ch) < 0x2000 for ch in text))
        self.assertNotRegex(body.split("note:")[1].split("\n")[0], r"^\s*'on a jet", "the note does not open with ON A JET")


class BoomAndZoomOnTheMig29Tests(unittest.TestCase):
    """The same jet file on the MiG-29 (pace 1.5): the F-16's tuning, not its own.

    At the MiG's pace its perch (748 m) and your start (420 m) are 219 m
    apart at the Spitfire's size, not 290: its first dive lands nothing, and
    in the counter and the Dip your climb has you at its height before it
    dives at all."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.mig = measure("Mig29")

    def test_the_pilot_who_never_looks_up_is_shot_down_in_two(self) -> None:
        rows = self.mig["nine"]["move"]
        self.assertEqual(2, sum(1 for r in rows if r["winner"] == 0))
        # re-pinned 2026-11-12 on retail g and box area (features/retail-parity-cross-check-2026-11-12)
        self.assertEqual((8, 20), spread([r["hits"][0] for r in rows if r["winner"] is None]))
        self.assertTrue(all(r["passes"][0]["hits"] == 0 for r in rows), [r["passes"][0] for r in rows])

    def test_nobody_is_hit_meeting_the_dive_and_no_move_works(self) -> None:
        self.assertTrue(all(r["hits"][0] == 0 for r in self.mig["nine"]["counter"]))
        # Their one dive comes at their perch's end, from about your height.
        self.assertTrue(all(r["passes"][0]["t"] == 10 and abs(r["passes"][0]["above"]) < 20 for r in self.mig["nine"]["counter"]))
        for demo in ("dip", "flip", "ninja"):
            self.assertEqual(0, self.mig["l9"][demo]["measured"]["works"], demo)
        # The Dip is never flown: no dive comes to meet.
        self.assertTrue(all(s["t0"] is None for s in self.mig["l9"]["dip"]["scores"]))

    def test_the_mig_stays_under_the_top_of_the_sky(self) -> None:
        tops = jet_tops("Mig29", "boom-and-zoom")["boom-and-zoom"]
        self.assertEqual((771, 787), spread([h for x in tops.values() for h in x["top"]]))


if __name__ == "__main__":
    unittest.main()
