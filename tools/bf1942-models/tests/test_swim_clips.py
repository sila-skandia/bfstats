"""The swim clip selection under node: which of the engine's swim states a
drawn soldier plays, and how he gets into and out of it.

The law is `animations/AnimationStatesSwim.con` (vanilla `animations.rfa`) and
`BFSoldier::updateSwimming` (lnxded `0x08282190`):

* entering is `setAnimationState(0, "Lb_StartSwim")` / `(1, "Ub_StartSwim")`
  (`0x082823f7`, `0x08282426`), a one-shot at speed 2.6
  (`3pAnimationsTweaking.con`) whose `addTransitionWhenDone` is the stroke;
* `Lb_Floating` goes to `Lb_SwimForward` on `c_PIThrottle 0.5 1` and to
  `Lb_SwimBackward` on `-1 -0.5`, and both strokes `returnToState
  Lb_Floating` -- the tread is anything inside the band;
* leaving is `Lb_EndSwim` / `Ub_EndSwim`, the entry clip at -3.2, then
  `Lb_Stand` / `Ub_Stand`;
* every swim state is `setMorphFactor 4.0` but `Ub_EndSwim`'s 1.0.

`swim.js` runs that machine, `soldier-actions.js` holds a bot's two half-bodies
in it, `remote-gait.js` picks it for a remote, `netcode.js` carries it and
`swim.js` `switchFamily` morphs the whole-body rigs. See
`features/viewer-swimming/README.md` §14-§16.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("swim_clips_harness.mjs")
MODULES = ["swim.js", "soldier-actions.js", "remote-gait.js", "netcode.js", "mouse-input.js"]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def entered(log: list[dict], half: str) -> list[str]:
    return [e["name"] for e in log if e["half"] == half]


def first(log: list[dict], half: str, name: str) -> dict:
    return next(e for e in log if e["half"] == half and e["name"] == name)


class HalfBodyTests(unittest.TestCase):
    """The bots' body: `SoldierActions` following `SwimState`."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_whole_course_is_the_engines_states_in_order(self) -> None:
        log = self.results["course"]["log"]
        self.assertEqual(
            ["walk.lower", "Lb_StartSwim", "Lb_SwimForward", "Lb_Floating",
             "Lb_SwimBackward", "Lb_Floating", "Lb_EndSwim", "walk.lower"],
            entered(log, "lower"))
        self.assertEqual(
            ["walk.upper", "Ub_StartSwim", "Ub_SwimForward", "Ub_Floating",
             "Ub_SwimBackward", "Ub_Floating", "Ub_EndSwim", "walk.upper"],
            entered(log, "upper"))

    def test_the_entry_hands_over_to_the_stroke_after_its_one_pass(self) -> None:
        log = self.results["course"]["log"]
        start = first(log, "lower", "Lb_StartSwim")["t"]
        stroke = first(log, "lower", "Lb_SwimForward")["t"]
        # 1 / 2.6 s, to the 30 Hz tick.
        self.assertAlmostEqual(self.results["startSeconds"], 1 / 2.6, places=6)
        self.assertAlmostEqual(stroke - start, 1 / 2.6, delta=1 / 30 + 1e-6)

    def test_the_exit_plays_out_before_the_gait_comes_back(self) -> None:
        log = self.results["course"]["log"]
        end = first(log, "lower", "Lb_EndSwim")["t"]
        back = [e for e in log if e["half"] == "lower" and e["name"] == "walk.lower"][-1]["t"]
        self.assertAlmostEqual(self.results["endSeconds"], 1 / 3.2, places=6)
        self.assertAlmostEqual(back - end, 1 / 3.2, delta=1 / 30 + 1e-6)

    def test_a_half_press_treads_water(self) -> None:
        # Throttle 0.4 is inside the +-0.5 band: `Lb_Floating` stays.
        log = self.results["course"]["log"]
        backward_out = [e for e in log if e["half"] == "lower"
                        and e["name"] == "Lb_Floating"][-1]["t"]
        end = first(log, "lower", "Lb_EndSwim")["t"]
        between = [e["name"] for e in log
                   if e["half"] == "lower" and backward_out < e["t"] < end]
        self.assertEqual([], between)

    def test_each_state_is_entered_with_its_own_morph(self) -> None:
        log = self.results["course"]["log"]
        for e in log:
            if "Swim" in e["name"] or "Floating" in e["name"]:
                want = 1.0 if e["name"] == "Ub_EndSwim" else 4.0
                self.assertEqual(want, e["morph"], e)
        # And back on the gait at the gait's own.
        self.assertEqual(2.0, [e for e in log if e["name"] == "walk.lower"][-1]["morph"])

    def test_fire_reload_and_stance_change_do_nothing_while_swimming(self) -> None:
        # `c_AsmHideWeapon` leaves him no item, and the swim states hold both
        # machines: the log is the dry run's exactly.
        self.assertEqual(self.results["course"]["log"],
                         self.results["courseNoFire"]["log"])

    def test_a_tree_without_the_swim_bundle_stays_on_the_gait(self) -> None:
        names = entered(self.results["unbound"]["log"], "lower")
        self.assertFalse([n for n in names if "Swim" in n or "Floating" in n])


class WholeBodyTests(unittest.TestCase):
    """The morph as a cross-fade on the whole-body rigs (local, still, remote)."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_morph_seconds(self) -> None:
        m = self.results["morph"]
        self.assertEqual({"lower": 0.25, "upper": 0.25}, m["into"])
        self.assertEqual({"lower": 0.25, "upper": 0.25}, m["stroke"])
        self.assertEqual({"lower": 0.25, "upper": 1.0}, m["exit"])
        self.assertAlmostEqual(0.5, m["out"]["lower"])
        self.assertAlmostEqual(1 / 0.7, m["out"]["upper"])
        self.assertAlmostEqual(0.05, m["die"]["lower"])
        self.assertIsNone(m["dry"])
        self.assertIsNone(m["fresh"])

    def test_the_switch_fades_into_and_out_of_the_water_and_cuts_on_land(self) -> None:
        r = self.results
        self.assertEqual([1, 1], [a["weight"] for a in r["switchFresh"]["walk"]])
        self.assertEqual([None, None], [a["fade"] for a in r["switchFresh"]["walk"]])
        self.assertEqual([["in", 0.25]] * 2, [a["fade"] for a in r["switchInto"]["swimFloat"]])
        self.assertEqual([["out", 0.25]] * 2, [a["fade"] for a in r["switchInto"]["walk"]])
        self.assertEqual([["in", 0.25]] * 2,
                         [a["fade"] for a in r["switchStroke"]["swimForward"]])
        self.assertEqual([0, 0], [a["weight"] for a in r["switchStroke"]["walk"]])
        out = r["switchOut"]["stand"]
        self.assertEqual("in", out[0]["fade"][0])
        self.assertAlmostEqual(0.5, out[0]["fade"][1])
        self.assertAlmostEqual(1 / 0.7, out[1]["fade"][1])
        self.assertEqual([None, None], [a["fade"] for a in r["switchDry"]["walk"]])
        self.assertEqual([0, 0], [a["weight"] for a in r["switchDry"]["stand"]])

    def test_family_of_pair(self) -> None:
        for family, got in self.results["familyOfPair"].items():
            self.assertEqual(family, got)
        self.assertIsNone(self.results["familyOfNull"])


class RemoteTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_snapshot_swim_state_outranks_the_gait(self) -> None:
        r = self.results["remote"]
        self.assertEqual("swimForward", r["forward"])
        self.assertEqual("swimFloat", r["float"])
        self.assertEqual("swimBackward", r["backward"])
        self.assertEqual("swimFloat", r["fallbackFloat"])
        self.assertEqual("walk", r["unbound"])
        self.assertEqual("run", r["dry"])
        self.assertEqual("stand", r["unknown"])

    def test_the_wire_carries_every_state_in_the_spare_flag_bits(self) -> None:
        w = self.results["wire"]
        self.assertEqual({"swimStart": 1, "swimFloat": 2, "swimForward": 3,
                          "swimBackward": 4, "swimEnd": 5, "swimDie": 0}, w["codes"])
        for sent, got in w["roundTrip"].items():
            self.assertEqual(None if sent == "null" else sent, got["swim"])
            self.assertTrue(got["crouch"])
            self.assertTrue(got["alive"])
            self.assertFalse(got["prone"])
        self.assertEqual(w["bytesDry"], w["bytesSwim"])


if __name__ == "__main__":
    unittest.main()
