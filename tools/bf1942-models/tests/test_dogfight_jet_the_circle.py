"""Breaking the circle on a jet (features/dogfight-lessons-jets/the-circle.md,
`viewer/dogfight-jet-the-circle.js`).

Every try is flown on the F-16 with the plan it flies on the Spitfire. The
tries are scored as the school scores them: from the nine starts of
`dogfight-measure.js` `STARTS`, with `scoreMove`, by the same per-start
measures the Spitfire's tests read (`dogfight_dfn_ci.mjs`, run here over the
jet). `jet_lesson` (the jet harness's nine starts) checks the outcomes again
from the other set of starts.
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

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent
TRIES = {"dip": "dip", "zoom": "ninja", "back": "ninja", "chop": "flip", "reverse": "flip", "low": "flip"}

# The head of a scorer over the jet: the viewer's modules loaded in place, the
# lesson as the jet flies it, the published airframe. The body is the
# Spitfire's own circle measure, `dogfight_dfn_ci.mjs`, without its imports.
HEAD = """
import path from 'node:path';
import {{ readFileSync }} from 'node:fs';
import {{ pathToFileURL }} from 'node:url';
const TOOLS = {tools};
const HERE = path.join(TOOLS, 'tests');
const {{ installModuleHooks, viewerDir }} = await import(pathToFileURL(path.join(TOOLS, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(TOOLS, 'viewer'));
installModuleHooks(viewer);
const load = name => import(pathToFileURL(path.join(viewer, name)).href);
const THREE = await load('vendor/three.module.js');
const {{ Aircraft }} = await load('aircraft.js');
const {{ runDuel: flyDuel }} = await load('dogfight-duel.js');
// Each fight's highest point, side by side (real metres), laid on its row.
const TOPS = [];
const runDuel = o => {{ const r = flyDuel(o); TOPS.push(r.tracks.map(t => Math.round(Math.max(...t.map(k => k.p[1]))))); return r; }};
const print = console.log;
console.log = s => {{ const o = JSON.parse(s); let i = 0; for (const d of Object.values(o.demos)) for (const row of d.scores) row.top = TOPS[i++]; print(JSON.stringify(o)); }};
const LB = await load('dogfight-lessons.js');
const {{ demoSides }} = LB;
const {{ scoreMove, verdictOf, STARTS, nudge, noseOf }} = await load('dogfight-measure.js');
const {{ CI }} = await load('dogfight-pilot.js');
const {{ jetMaker }} = await import(pathToFileURL(path.join(HERE, 'jet_airframes.mjs')).href);
const fixture = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'dc-jets.json'), 'utf8'));
const makePlane = jetMaker(THREE, Aircraft, fixture, {plane});
const LESSONS = LB.LESSONS.map(l => LB.lessonFor(l, 'jet'));
"""


@functools.lru_cache(maxsize=None)
def scored(plane: str = "F16") -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    body = "\n".join(line for line in (HERE / "dogfight_dfn_ci.mjs").read_text().splitlines() if not line.startswith("import "))
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "circle_jet.mjs"
        script.write_text(HEAD.format(tools=json.dumps(str(TOOLS)), plane=json.dumps(plane)) + body)
        proc = subprocess.run(["node", str(script)], capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"circle jet scorer failed:\n{proc.stderr[-3000:]}")
    return json.loads(proc.stdout)


def span(rows: list[dict], key: str) -> tuple:
    vals = [r[key] for r in rows]
    return min(vals), max(vals)


class CircleOnAJetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.shape = scored()

    def rows(self, demo: str) -> list[dict]:
        return self.shape["demos"][demo]["scores"]

    def test_none_of_the_six_breaks_it(self) -> None:
        for demo_id, kind in TRIES.items():
            demo = self.shape["demos"][demo_id]
            with self.subTest(demo_id):
                self.assertEqual(kind, demo["kind"])
                self.assertEqual("btHunter", demo["ace"])
                self.assertEqual({"works": 0, "of": 9, "verdict": "no"}, demo["measured"])
                self.assertEqual({"works": 0, "of": 9}, {k: demo["declared"][k] for k in ("works", "of")})
        # So the lesson's verdict is no, as the Spitfire's rule has it.
        self.assertEqual("no", self.shape["survival"]["verdict"])

    def test_the_circle_is_a_deadlock(self) -> None:
        rows = self.rows("circle")
        for s in rows:
            self.assertEqual([0, 0], s["shots"], s)
            self.assertEqual([0, 0], s["hits"], s)
        self.assertEqual((50, 279), (min(s["circleRange"][0] for s in rows), max(s["circleRange"][1] for s in rows)))
        self.assertEqual((85, 102), span(rows, "fastest"))
        # The circle climbs: 142 to 189 m in 30 s from the harness's starts.
        climbed = [r["climbed"] for r in jet_lesson("the-circle")["demos"]["circle"]]
        self.assertEqual((142, 189), (min(climbed), max(climbed)))

    def test_leaving_an_equal_jet_does_not_shake_them(self) -> None:
        rows = self.rows("dip")
        for s in rows:
            self.assertAlmostEqual(8, s["t0"], delta=0.05)
            self.assertIsNone(s["letGo"], s)
            self.assertEqual([0, 0], s["hits"], s)
            self.assertEqual(0, s["myShot"], s)
            # They never fall back: the closest after the run is where it ends.
            self.assertEqual(s["closeAfter"], s["endRange"], s)
        self.assertEqual((260, 344), span(rows, "endRange"))
        self.assertEqual((21, 23), tuple(round(v) for v in span(rows, "hisShot")))

    def test_going_straight_up_costs_nothing_and_gets_nothing(self) -> None:
        rows = self.rows("zoom")
        for s in rows:
            self.assertIn("follow", s["acePhases"], s)
            self.assertEqual(0, s["myShot"], s)
        # "you are levelled off at 765 or 766 m, and they follow you up to 766
        # to 768 m" (the roof every jet's pilot flies under,
        # `dogfight-jet-ceiling.js`).
        self.assertEqual((765, 766), (min(s["top"][1] for s in rows), max(s["top"][1] for s in rows)))
        self.assertEqual((766, 768), (min(s["top"][0] for s in rows), max(s["top"][0] for s in rows)))
        # "At most you are 103 to 118 m over them, and you never slow enough to
        # go over the top."
        self.assertEqual((103, 118), span(rows, "highest"))
        self.assertTrue(all(s["overTop"] is None and "over" not in s["myPhases"] for s in rows))
        self.assertEqual(0, max(s["bestQuarter"] for s in rows))
        # "At 30 s you are level with them, 3 m under to 5 m over, both at 124
        # m/s, and they have never let you go."
        self.assertEqual((-3, 5), span(rows, "endDy"))
        self.assertEqual((124, 124), span(rows, "endSpeed"))
        self.assertTrue(all(s["letGo"] is None for s in rows))
        # "their guns bear on you for 0.4 to 1.4 s, and no round lands."
        self.assertEqual((0.4, 1.4), tuple(round(v, 1) for v in span(rows, "hisShot")))
        self.assertTrue(all(s["hits"] == [0, 0] for s in rows))

    def test_out_and_back_is_a_head_on_pass_and_they_are_behind_you_again(self) -> None:
        rows = self.rows("back")
        for s in rows:
            self.assertIsNone(s["letGo"], s)
            self.assertEqual(0, s["myShot"], s)
            self.assertEqual(0, s["hitsOnHim"], s)
        self.assertEqual((30, 40), span(rows, "closeAfter"))
        self.assertEqual((13, 35), tuple(round(v) for v in span(rows, "hisShot")))
        hit = sorted(s["hits"][0] for s in rows if s["hits"][0])
        self.assertEqual(5, len(hit))
        self.assertEqual((5, 26), (hit[0], hit[-1]))
        self.assertEqual(2, sum(1 for s in rows if s["end"] == "shot down" and s["winner"] == 0))

    def test_the_chop_only_slows_you_and_sinks_you(self) -> None:
        rows = self.rows("chop")
        for s in rows:
            self.assertEqual([0, 0], s["shots"], s)
            self.assertEqual(0, s["bestQuarter"], s)
        self.assertEqual((37, 38), span(rows, "slowest"))
        self.assertEqual((-272, -246), span(rows, "lowest"))
        self.assertEqual((-682, -602), span(rows, "endEdge"))

    def test_reversing_just_turns_the_circle_the_other_way(self) -> None:
        rows = self.rows("reverse")
        for s in rows:
            self.assertEqual(0, s["passes"], s)
            self.assertEqual([0, 0], s["shots"], s)
        self.assertEqual((92, 146), span(rows, "closeAfter"))

    def test_nose_low_gets_round_behind_them_but_never_onto_them(self) -> None:
        rows = self.rows("low")
        ups = [s["up"] for s in rows]
        self.assertNotIn(None, ups)
        self.assertEqual((100, 131), (min(u["behind"] for u in ups), max(u["behind"] for u in ups)))
        self.assertEqual((-134, -114), (min(u["dy"] for u in ups), max(u["dy"] for u in ups)))
        self.assertEqual((14, 16), (int(min(u["t"] for u in ups)), int(max(u["t"] for u in ups))))
        self.assertEqual({82, 83}, {u["v"] for u in ups})
        for s in rows:
            self.assertEqual([0, 0], s["hits"], s)
        # "the nose never comes onto them"
        self.assertTrue(all(s["myShot"] == 0 for s in rows))
        # "In seven you sit in their rear quarter at last, 27 to 37 s in"
        late = [s["flipAt"] for s in rows if s["flipAt"] is not None]
        self.assertEqual(7, len(late))
        self.assertTrue(all(26.5 <= t <= 37 for t in late), late)

    def test_nobody_goes_over_the_roof(self) -> None:
        # Under the roof (800 m) and the guard (880 m): nine starts of every
        # demo and try, the highest either plane went.
        for demo, x in jet_tops("F16", "the-circle")["the-circle"].items():
            self.assertLess(max(x["top"]), 860, demo)
        self.assertEqual(768, max(max(s["top"]) for d in self.shape["demos"].values() for s in d["scores"]))


class CircleFromTheHarnessStartsTests(unittest.TestCase):
    """The same outcomes from the jet harness's nine starts."""

    def test_nobody_is_hit_except_turning_back(self) -> None:
        demos = jet_lesson("the-circle")["demos"]
        self.assertEqual("jet", jet_lesson("the-circle")["era"])
        for demo_id in ("circle", "dip", "zoom", "chop", "reverse", "low"):
            self.assertTrue(all(r["hits"] == [0, 0] for r in demos[demo_id]), demo_id)
        # Turning back: hit 10 to 17 times in three, nobody shot down.
        self.assertEqual(0, shot_down(demos["back"], 1))
        self.assertEqual([10, 13, 17], sorted(r["hits"][0] for r in demos["back"] if r["hits"][0]))
        self.assertTrue(all(r["hits"][1] == 0 for r in demos["back"]))
        # Leaving: they never let you go.
        self.assertTrue(all("let-go" not in r["phases"][0] for r in demos["dip"]))

    def test_the_mig29_is_no_different_and_turning_back_is_worse(self) -> None:
        demos = jet_lesson("the-circle", plane="Mig29")["demos"]
        for demo_id in ("circle", "dip", "zoom", "chop", "reverse"):
            self.assertTrue(all(r["hits"] == [0, 0] for r in demos[demo_id]), demo_id)
        # Nose low, one round of yours lands in one start of nine.
        self.assertEqual([[0, 0]] * 8 + [[0, 1]], sorted(r["hits"] for r in demos["low"]))
        self.assertTrue(all("let-go" not in r["phases"][0] for r in demos["dip"]))
        self.assertEqual(5, shot_down(demos["back"], 1))
        hit = sorted(r["hits"][0] for r in demos["back"] if r["hits"][0])
        self.assertEqual([22] * 5, hit)
        # Apart at the end: the Dip at 40 s, the zoom and the chop at 30 s.
        self.assertEqual((355, 465), (min(r["apart"] for r in demos["dip"]), max(r["apart"] for r in demos["dip"])))
        self.assertEqual((327, 440), (min(r["apart"] for r in demos["zoom"]), max(r["apart"] for r in demos["zoom"])))
        self.assertEqual((53, 439), (min(r["apart"] for r in demos["chop"]), max(r["apart"] for r in demos["chop"])))
        # Over the school's STARTS, leaving gets you shot down in two.
        dip = scored("Mig29")["demos"]["dip"]["scores"]
        self.assertEqual(2, sum(1 for s in dip if s["end"] == "shot down" and s["winner"] == 0))

    def test_the_mig29_under_the_roof(self) -> None:
        tops = jet_tops("Mig29", "the-circle")["the-circle"]
        self.assertEqual(818, max(max(x["top"]) for x in tops.values()))
        self.assertTrue(all(x["past"] == [0, 0] for x in tops.values()))
        # Every way out still fails on the MiG-29 too.
        for demo_id in TRIES:
            self.assertEqual(0, scored("Mig29")["demos"][demo_id]["measured"]["works"], demo_id)


if __name__ == "__main__":
    unittest.main()
