"""On their tail on Desert Combat's jets (features/dogfight-lessons-jets,
on-his-tail.md): `viewer/dogfight-jet-on-his-tail.js` and its plan
`jetOtLeave` (`viewer/dogfight-jet-plan-on-his-tail.js`), flown on the
published F-16 and MiG-29 (`fixtures/dc-jets.json`).

What the jet file's words say, held here number by number:

- Rushing in is nobody's kill, as on the Spitfire, with fewer hits: 0 to 3.
- Leaving their circle when they are across it going away, the Spitfire's way
  out, is shot down from all nine starts: a jet's cannon opens fire from
  about 530 m, not 268, and half a circle does not get you that far.
- Never going in (straight on at their break) gets clear and unhit from all
  nine.
- The high yo-yo and the climb beside their break get no shot (0 of 9 each).

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

from jet_school import jet_lesson, shot_down

TOOLS = Path(__file__).resolve().parents[1]
VIEWER = TOOLS / "viewer"

# Flies the lesson's demos on one jet and measures them in the words' terms.
# Run as `node measure.mjs <tools> <plane> <base 0|1>`; prints one JSON blob.
MEASURE = r"""
// argv: <tools dir> <plane> <base 0|1>
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
const { LESSONS, lessonFor, demoSides } = await load('dogfight-lessons.js');
const { scoreMove, verdictOf, STARTS, nudge, noseOf } = await load('dogfight-measure.js');
const { jetMaker } = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'dc-jets.json'), 'utf8'));
const base = LESSONS.find(l => l.id === 'on-his-tail');
const L = BASE === '1' ? base : lessonFor(base, 'jet');
const makePlane = jetMaker(THREE, Aircraft, fixture, PLANE);
const DEG = 180 / Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b) || 1)))) * DEG;
const r1 = v => Math.round(v * 10) / 10;
const NINE = [];
for (const dx of [-30, 0, 30]) for (const dv of [-3, 0, 3]) NINE.push({ dx, dv });
const fly = (d, st) => {
  const sides = demoSides(L, d);
  sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
  return runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
};
/** One fight in the lesson's words: real metres and m/s. */
function words(r) {
  const [A, B] = r.tracks; const n = Math.min(A.length, B.length);
  const R = i => len(sub(A[i].p, B[i].p));
  const iBrk = A.findIndex(k => k.ph === 'break');
  const brkT = iBrk >= 0 ? A[iBrk].t : null;
  let minR = Infinity, iMin = 0;
  for (let i = Math.max(0, iBrk); i < n; i++) if (R(i) < minR) { minR = R(i); iMin = i; }
  const after = [], off = [], rate = [];
  for (let i = iMin + Math.round(5 / r.dt); i < n - 1; i++) {
    after.push(R(i)); off.push(ang(noseOf(B[i]), sub(A[i].p, B[i].p)));
  }
  // The breaker's turn, 5 to 15 s after the pass: degrees a second, and across.
  const i1 = iMin + Math.round(5 / r.dt), i2 = Math.min(n - 2, i1 + Math.round(10 / r.dt));
  const hd = i => Math.atan2(A[i + 1].p[0] - A[i].p[0], A[i + 1].p[2] - A[i].p[2]);
  let turn = 0;
  for (let i = i1; i < i2; i++) { let dh = hd(i + 1) - hd(i); if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI; turn += dh; }
  const degS = i2 > i1 ? Math.abs(turn) * DEG / ((i2 - i1) * r.dt) : null;
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[s.length >> 1]) : null; };
  const mine = r.rounds.filter(x => x.hit && x.side === 1);
  const iFire = B.findIndex(k => k.f);
  return {
    winner: r.end ? r.end.winner : null, why: r.end?.why ?? null, t: r.end ? r1(r.end.t) : null, hits: r.hits,
    breakAt: brkT === null ? null : r1(brkT), breakRange: iBrk >= 0 ? Math.round(R(iBrk)) : null,
    breakSpeeds: iBrk >= 0 ? [Math.round(A[iBrk].v), Math.round(B[iBrk].v)] : null,
    fireFrom: iFire >= 0 ? Math.round(R(iFire)) : null,
    pass: Math.round(minR), passAfter: brkT === null ? null : r1(A[iMin].t - brkT),
    behind: med(after), noseOff: med(off), degS: degS === null ? null : r1(degS),
    across: degS ? Math.round(2 * A[i1].v / (degS / DEG)) : null, aceSpeed: A[i1] ? Math.round(A[i1].v) : null,
    myHitsFrom: mine.length ? r1(Math.min(...mine.map(x => x.hitT)) - brkT) : null,
    myHitsTo: mine.length ? r1(Math.max(...mine.map(x => x.hitT)) - brkT) : null,
    myHitRange: mine.length ? [Math.min(...mine.map(x => Math.round(R(Math.min(n - 1, Math.round(x.hitT / r.dt)))))), Math.max(...mine.map(x => Math.round(R(Math.min(n - 1, Math.round(x.hitT / r.dt))))))] : null,
    aceShot: r1(A.filter(k => k.o).length * r.dt), myShotAfter: r1(B.slice(iMin + Math.round(5 / r.dt)).filter(k => k.o).length * r.dt),
    acePhases: [...new Set(r.events.filter(e => e.side === 0 && e.phase !== 'kill').map(e => e.phase))],
    top: [Math.round(Math.max(...A.map(k => k.p[1]))), Math.round(Math.max(...B.map(k => k.p[1])))],
    slowest: [Math.round(Math.min(...A.map(k => k.v))), Math.round(Math.min(...B.map(k => k.v)))],
  };
}
const out = { era: L.era ?? null, nine: {}, l9: {} };
for (const d of L.demos) {
  out.nine[d.id] = NINE.map(st => ({ ...st, ...words(fly(d, st)) }));
  if (!d.kind) continue;
  const scores = STARTS.map(st => {
    const r = fly(d, st);
    const s = scoreMove(r, d.kind, 1);
    const A = r.tracks[0], B = r.tracks[1];
    const i0 = s.t0 === null ? 0 : Math.round(s.t0 / r.dt);
    const iCh = A.findIndex((k, i) => i >= i0 && (k.ph === 'reverse' || k.ph === 'chase'));
    let chaseMin = null;
    if (iCh >= 0) { chaseMin = Infinity; for (let i = iCh; i < Math.min(A.length, B.length); i++) chaseMin = Math.min(chaseMin, len(sub(A[i].p, B[i].p))); chaseMin = Math.round(chaseMin); }
    return { ...st, ...s, chaseMin, downAfter: r.end?.why === 'shot down' && s.t0 !== null ? r1(r.end.t - s.t0) : null };
  });
  out.l9[d.id] = { declared: d.verdict ?? null, measured: verdictOf(scores), scores };
}
out.survival = L.survival;
console.log(JSON.stringify(out));
"""


def measure(plane: str = "F16", base: bool = False) -> dict:
    """The lesson's four fights on `plane`, from the school's nine starts and
    the measure's nine, in real metres and m/s (`MEASURE`)."""
    return _measure(plane, base)


@functools.lru_cache(maxsize=None)
def _measure(plane: str, base: bool) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "measure.mjs"
        script.write_text(MEASURE)
        proc = subprocess.run(["node", str(script), str(TOOLS), plane, "1" if base else "0"],
                              capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"on-his-tail measure failed:\n{proc.stderr[-3000:]}")
    return json.loads(proc.stdout)


def spread(rows: list[dict], key: str) -> tuple:
    values = [r[key] for r in rows if r.get(key) is not None]
    return (min(values), max(values))


class OnTheirTailOnAJetTests(unittest.TestCase):
    """`viewer/dogfight-jet-on-his-tail.js` on the F-16, every number its words give."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.jet = measure()
        cls.base = measure(base=True)

    def nine(self, demo: str) -> list[dict]:
        rows = self.jet["nine"][demo]
        self.assertEqual(9, len(rows))
        return rows

    def l9(self, demo: str, base: bool = False) -> dict:
        return (self.base if base else self.jet)["l9"][demo]

    def test_the_jet_file_is_laid_over_the_lesson(self) -> None:
        self.assertEqual("jet", self.jet["era"])
        self.assertIsNone(self.base["era"])

    def test_rushing_in_is_nobodys_kill(self) -> None:
        # "both of you open fire from about 530 m ... they break 436 to 543 m
        # out. Rushing in, you fire as they break and land 0 to 3 rounds, all
        # between 2.2 s before their break and 4 s after it. Then you come past
        # their tail 49 to 60 m from them and sit 104 to 110 m behind them in
        # their turn, your nose 51 to 53 degrees off them, and nobody comes down."
        rows = self.nine("move")
        self.assertTrue(all(r["winner"] is None for r in rows), rows)
        self.assertTrue(all(r["hits"][0] == 0 and 0 <= r["hits"][1] <= 3 for r in rows), [r["hits"] for r in rows])
        self.assertEqual(3, max(r["hits"][1] for r in rows))
        self.assertTrue(all(520 <= r["fireFrom"] <= 540 for r in rows), [r["fireFrom"] for r in rows])
        self.assertEqual((436, 543), spread(rows, "breakRange"))
        self.assertGreaterEqual(spread(rows, "myHitsFrom")[0], -2.2)
        self.assertLessEqual(spread(rows, "myHitsTo")[1], 4.0)
        self.assertEqual((49, 60), spread(rows, "pass"))
        self.assertEqual((104, 110), spread(rows, "behind"))
        self.assertEqual((51, 53), spread(rows, "noseOff"))
        # In their turn neither has a shot that would land.
        self.assertTrue(all(r["aceShot"] == 0 and r["myShotAfter"] == 0 for r in rows), rows)
        # The school's own harness agrees on the hits and the kills.
        runs = jet_lesson("on-his-tail", demo="move")["demos"]["move"]
        self.assertEqual([r["hits"] for r in rows], [r["hits"] for r in runs])
        self.assertEqual(0, shot_down(runs, 0) + shot_down(runs, 1))

    def test_their_circle_is_too_tight_for_any_lead(self) -> None:
        # "A jet turning hard at 75 m/s turns 68 to 70 degrees a second, round
        # a circle 123 to 127 m across."
        rows = self.nine("move")
        lo, hi = spread(rows, "degS")
        self.assertTrue(67.5 <= lo and hi <= 70, (lo, hi))
        self.assertEqual((123, 127), spread(rows, "across"))
        self.assertEqual((75, 75), spread(rows, "aceSpeed"))

    def test_leaving_their_circle_the_spitfires_way_is_shot_down(self) -> None:
        # "they come round in behind you, 73 to 353 m back at the closest,
        # inside their cannon's reach, and shoot you down 13 to 16 s after you
        # leave"; "shot down in nine of nine".
        dip = self.l9("dip", base=True)
        self.assertEqual(0, dip["measured"]["works"])
        rows = dip["scores"]
        self.assertTrue(all(s["end"] == "shot down" and s["winner"] == 0 for s in rows), rows)
        self.assertEqual((73, 353), spread(rows, "chaseMin"))
        lo, hi = spread(rows, "downAfter")
        self.assertTrue(13 <= lo and hi <= 16.5, (lo, hi))
        runs = jet_lesson("on-his-tail", demo="dip", base=True)["demos"]["dip"]
        self.assertEqual(9, shot_down(runs, 1))

    def test_holding_the_line_at_their_break_gets_clear_unhit(self) -> None:
        # "You arrive 15 to 18 m/s faster than them ... You go past them 80 to
        # 91 m off while they turn into you ... They do not come after you."
        rows = self.nine("dip")
        self.assertTrue(all(15 <= b[1] - b[0] <= 18 for b in (r["breakSpeeds"] for r in rows)), [r["breakSpeeds"] for r in rows])
        self.assertEqual((80, 91), spread(rows, "pass"))
        self.assertTrue(all(r["hits"] == [0, 0] and r["aceShot"] == 0 for r in rows), rows)
        self.assertTrue(all(not {"reverse", "chase"} & set(r["acePhases"]) for r in rows), [r["acePhases"] for r in rows])
        self.assertEqual(0, shot_down(jet_lesson("on-his-tail", demo="dip")["demos"]["dip"], 1))
        # The verdict: "Out in all nine and never hit: you passed them 75 to 97
        # m off, their guns never had you, they never came after you, and at
        # 40 s you were 2603 to 3193 m apart and opening."
        dip = self.l9("dip")
        self.assertEqual(9, dip["measured"]["works"])
        self.assertEqual(dip["declared"]["works"], dip["measured"]["works"])
        scores = dip["scores"]
        self.assertTrue(all(s["hitsOnMe"] == 0 and s["hisShot"] == 0 and s["chaseMin"] is None and s["opening"] > 0 for s in scores), scores)
        self.assertEqual((75, 97), spread(scores, "minRange"))
        self.assertEqual((2603, 3193), spread(scores, "endRange"))

    def test_the_yo_yo_never_gets_the_shot(self) -> None:
        # "In all nine you were never hit, and from the pull-up on your guns
        # never had them: in their rear quarter with your nose on them for 1.33
        # s at most. The 0 to 2 rounds you land come in their circle before it,
        # at 242 to 260 m. A jet keeps its speed over the top (80 to 83 m/s at
        # the end), but you get no higher than them."
        flip = self.l9("flip")
        self.assertEqual(0, flip["measured"]["works"])
        self.assertEqual(flip["declared"]["works"], flip["measured"]["works"])
        scores = flip["scores"]
        self.assertTrue(all(s["hitsOnMe"] == 0 and s["myShot"] == 0 and s["hitsOnHim"] == 0 for s in scores), scores)
        self.assertEqual(1.33, max(s["bestQuarter"] for s in scores))
        self.assertEqual((80, 83), spread(scores, "endSpeed"))
        rows = self.nine("flip")
        self.assertTrue(all(0 <= r["hits"][1] <= 2 and r["hits"][0] == 0 for r in rows), [r["hits"] for r in rows])
        landed = [x for r in rows if r["myHitRange"] for x in r["myHitRange"]]
        self.assertEqual((242, 260), (min(landed), max(landed)))
        self.assertTrue(all(r["top"][1] <= r["top"][0] for r in rows), [r["top"] for r in rows])

    def test_climbing_beside_their_break_gets_nothing_they_climb_too(self) -> None:
        # "they come up too, after you or away from you, and the two of you go
        # on up through the top of the sky, over the top between 910 and 1,690
        # m, you at 16 to 20 m/s ... once in nine they land 2 rounds on you on
        # the way up". The pilots' guard noses over at 880 m, but a jet in a
        # steep climb cannot get its nose down there and climbs on.
        rows = self.nine("ninja")
        self.assertTrue(all(r["winner"] is None for r in rows))
        tops = [h for r in rows for h in r["top"]]
        self.assertEqual((910, 1688), (min(tops), max(tops)), [r["top"] for r in rows])
        self.assertTrue(all({"climb", "reverse"} & set(r["acePhases"]) for r in rows), [r["acePhases"] for r in rows])
        self.assertEqual((16, 20), (min(r["slowest"][1] for r in rows), max(r["slowest"][1] for r in rows)))
        self.assertEqual([[2, 0]], [r["hits"] for r in rows if r["hits"] != [0, 0]])
        # "None of the nine: no kill, 2 rounds landed, in one of the nine, and
        # 0.17 s of a shot that would land. They had you for 0.23 s at most,
        # landed 1 round on you once, and sat on your tail for up to 7.4 s."
        ninja = self.l9("ninja")
        self.assertEqual(0, ninja["measured"]["works"])
        self.assertEqual(ninja["declared"]["works"], ninja["measured"]["works"])
        scores = ninja["scores"]
        self.assertFalse(any(s["killed"] for s in scores))
        self.assertEqual([2], [s["hitsOnHim"] for s in scores if s["hitsOnHim"]])
        self.assertEqual(0.17, max(s["myShot"] for s in scores))
        self.assertEqual([1], [s["hitsOnMe"] for s in scores if s["hitsOnMe"]])
        self.assertEqual(0.23, max(s["hisShot"] for s in scores))
        self.assertAlmostEqual(7.4, max(s["sixLost"] for s in scores), delta=0.05)

    def test_the_survival_verdict_follows_from_the_three(self) -> None:
        verdicts = [d["measured"]["verdict"] for d in self.jet["l9"].values()]
        want = "yes" if "works" in verdicts else "partly" if "partly" in verdicts else "no"
        self.assertEqual(want, self.jet["survival"]["verdict"])
        self.assertEqual("yes", want)

    def test_the_words_call_pilots_they(self) -> None:
        words = (VIEWER / "dogfight-jet-on-his-tail.js").read_text()
        body = words[words.index("export default"):]
        plan = (VIEWER / "dogfight-jet-plan-on-his-tail.js").read_text()
        says = plan[plan.index("says:"):plan.index("step(c)")]
        for text in (body, says):
            self.assertIsNone(re.search(r"\b(he|him|his|himself)\b", text, re.I), re.search(r"\b(he|him|his|himself)\b", text, re.I))
            self.assertTrue(all(ord(ch) < 0x2000 for ch in text))
        self.assertNotRegex(body.split("note:")[1].split("\n")[0], r"^\s*'on a jet", "the note does not open with ON A JET")


class OnTheirTailOnTheMig29Tests(unittest.TestCase):
    """The same jet file on the MiG-29 (pace 1.5): the F-16's tuning, not its own."""

    def test_holding_the_line_gets_clear_in_seven_and_the_old_way_out_is_still_fatal(self) -> None:
        mig = measure("Mig29")
        self.assertEqual(7, mig["l9"]["dip"]["measured"]["works"])
        caught = [s for s in mig["l9"]["dip"]["scores"] if not s["ok"]]
        self.assertTrue(all(s["end"] == "shot down" for s in caught), caught)
        self.assertTrue(all(r["winner"] is None for r in mig["nine"]["move"]))
        self.assertEqual(9, shot_down(jet_lesson("on-his-tail", plane="Mig29", demo="dip", base=True)["demos"]["dip"], 1))


if __name__ == "__main__":
    unittest.main()
