"""The explosion clip bundle: `gaits/explosion.gait.glb` and its one manifest key.

A soldier a blast throws goes through the states
`animations/AnimationStatesExplosionFly.con` creates: the flight
(`Lb_ExplosionForward` / `Backward`, entered by `BFSoldier::handleUpdate`,
lnxded `0x082729bd` / `0x08272a5e`), a bounce off a wall, and the landing
(`BFSoldier::handleCollision`, `0x0827d79c` on): dead, the land states, alive,
the survive states and the get-up. What this pins, each read out of the game
rather than chosen:

* **Every state the script creates is baked under its own name**, the twenty
  `extract_pose.EXPLOSION_STATES`, so `viewer/knockback.js`'s
  `EXPLOSION_CLIPS` is the only table. The test reads the JS table back out of
  the file and holds the two lists against each other.

* **The flight loops and nothing else does.** `c_AsmLooping` on the four
  flight states, `c_AsmPlayOnce` on every landing, bounce and get-up, so a
  body on the ground holds the landing instead of taking off again.

* **The get-up is half speed.** `set3pAnimationSpeed
  Lb_ExplosionLandFrontSurviveStandUp 0.50` (`3pAnimationsTweaking.con`), the
  same clip period `1 / |speed|` every other bundle bakes (ledger ANIM-1).

* **The states' own flags ride in the bundle.** Every lower state declares
  `c_AsmHideWeapon` and `c_AsmLockFreeLook`, so the weapon is stowed through
  the whole of it; the upper ones declare nothing.

* **A subset run merges `gaits.json`.** One key, `explosion`, and every other
  key is left as it was.
"""

from __future__ import annotations

import json
import re
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import animstates  # noqa: E402
from test_gaits import pack_baf_frames  # noqa: E402
from test_stances import FakePool  # noqa: E402
from test_parachute_assets import soldier_skeleton  # noqa: E402
from test_swim_assets import LOWER3, UPPER3  # noqa: E402
import extract_pose  # noqa: E402

VIEWER = Path(__file__).resolve().parents[1] / "viewer"

HIDE = ["c_AsmHideWeapon", "c_AsmLockFreeLook"]

# The states as `AnimationStatesExplosionFly.con` creates them and
# `3pAnimationsTweaking.con` leaves their speeds: `(clip, speed, loop word,
# addTransitionWhenDone, setMorphFactor)`. The survive landings play the land
# clips again, and both get-ups the front one.
EXPLOSION_STATES: dict[str, tuple[str, float, str, str | None, float]] = {
    "Lb_ExplosionForward": ("x/fly_fwd_lower.baf", 1.0, "c_AsmLooping", None, 50.0),
    "Ub_ExplosionForward": ("x/fly_fwd_upper.baf", 1.0, "c_AsmLooping", None, 50.0),
    "Lb_ExplosionBackward": ("x/fly_back_lower.baf", 1.0, "c_AsmLooping", None, 50.0),
    "Ub_ExplosionBackward": ("x/fly_back_upper.baf", 1.0, "c_AsmLooping", None, 50.0),
    "Lb_ExplosionLandFront": ("x/land_front_lower.baf", 1.0, "c_AsmPlayOnce", None, 10.0),
    "Ub_ExplosionLandFront": ("x/land_front_upper.baf", 1.0, "c_AsmPlayOnce", None, 10.0),
    "Lb_ExplosionLandFrontSurvive": ("x/land_front_lower.baf", 1.0, "c_AsmPlayOnce",
                                     "Lb_ExplosionLandFrontSurviveStandUp", 10.0),
    "Ub_ExplosionLandFrontSurvive": ("x/land_front_upper.baf", 1.0, "c_AsmPlayOnce",
                                     "Ub_ExplosionLandFrontSurviveStandUp", 10.0),
    "Lb_ExplosionLandFrontSurviveStandUp": ("x/getup_lower.baf", 0.5, "c_AsmPlayOnce",
                                            "Lb_Stand", 10.0),
    "Ub_ExplosionLandFrontSurviveStandUp": ("x/getup_upper.baf", 0.5, "c_AsmPlayOnce",
                                            "Ub_StandAim", 10.0),
    "Lb_ExplosionLandBack": ("x/land_back_lower.baf", 1.0, "c_AsmPlayOnce", None, 10.0),
    "Ub_ExplosionLandBack": ("x/land_back_upper.baf", 1.0, "c_AsmPlayOnce", None, 10.0),
    "Lb_ExplosionLandBackSurvive": ("x/land_back_lower.baf", 1.0, "c_AsmPlayOnce",
                                    "Lb_ExplosionLandBackSurviveStandUp", 10.0),
    "Ub_ExplosionLandBackSurvive": ("x/land_back_upper.baf", 1.0, "c_AsmPlayOnce",
                                    "Ub_ExplosionLandBackSurviveStandUp", 10.0),
    "Lb_ExplosionLandBackSurviveStandUp": ("x/getup_lower.baf", 0.5, "c_AsmPlayOnce",
                                           "Lb_Stand", 10.0),
    "Ub_ExplosionLandBackSurviveStandUp": ("x/getup_upper.baf", 0.5, "c_AsmPlayOnce",
                                           "Ub_StandAim", 10.0),
    "Lb_ExplosionBounceFront": ("x/bounce_front_lower.baf", 1.0, "c_AsmPlayOnce",
                                "Lb_ExplosionBackward", 5000.0),
    "Ub_ExplosionBounceFront": ("x/bounce_front_upper.baf", 1.0, "c_AsmPlayOnce",
                                "Ub_ExplosionBackward", 5000.0),
    "Lb_ExplosionBounceBack": ("x/bounce_back_lower.baf", 1.0, "c_AsmPlayOnce",
                               "Lb_ExplosionForward", 5000.0),
    "Ub_ExplosionBounceBack": ("x/bounce_back_upper.baf", 1.0, "c_AsmPlayOnce",
                               "Ub_ExplosionForward", 5000.0),
}

EXPLOSION_FILES = {
    path: pack_baf_frames(UPPER3 if "upper" in path else LOWER3)
    for path, *_rest in EXPLOSION_STATES.values()
}


def explosion_machine(states=None) -> animstates.StateMachine:
    machine = animstates.StateMachine()
    for name, (path, speed, loop, ret, morph) in (states or EXPLOSION_STATES).items():
        state = animstates.State(name)
        state.clips.append(animstates.ClipRef(path, speed, loop))
        state.return_to = ret
        state.morph_factor = morph
        if name.startswith("Lb_"):
            state.flags = list(HIDE)
        machine.states[name.lower()] = state
    return machine


def bundle(path: Path) -> dict:
    blob = path.read_bytes()
    length, = struct.unpack_from("<I", blob, 12)
    return json.loads(blob[20:20 + length])


def js_state_names() -> list[str]:
    """Every engine state name `knockback.js` asks the bundle for."""
    text = (VIEWER / "knockback.js").read_text()
    return re.findall(r"'((?:Lb|Ub)_Explosion\w+)'", text)


class ExplosionClipBundleTests(unittest.TestCase):
    def export(self, out: Path, machine=None, files=None) -> dict:
        return extract_pose.export_explosion_clips(
            machine or explosion_machine(), FakePool(files or EXPLOSION_FILES),
            soldier_skeleton(), out)

    def test_all_twenty_states_are_baked_under_their_own_names(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.export(out)
            doc = bundle(out / "gaits" / "explosion.gait.glb")

            self.assertEqual(list(EXPLOSION_STATES), list(extract_pose.EXPLOSION_STATES))
            self.assertEqual(list(extract_pose.EXPLOSION_STATES),
                             [a["name"] for a in doc["animations"]])
            self.assertEqual("gaits/explosion.gait.glb", result["asset"])
            self.assertEqual({}, result["absent"])
            self.assertEqual({}, result["errors"])

    def test_the_viewer_asks_for_exactly_the_baked_states(self) -> None:
        # One table: the names `knockback.js` plays are the names baked.
        self.assertEqual(set(extract_pose.EXPLOSION_STATES), set(js_state_names()))

    def test_the_bundle_is_clips_over_joints_with_no_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            doc = bundle(out / "gaits" / "explosion.gait.glb")
            self.assertNotIn("meshes", doc)
            self.assertNotIn("materials", doc)
            self.assertEqual(3, len(doc["nodes"]))

    def test_the_flight_loops_and_everything_after_it_holds(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.export(out)
            doc = bundle(out / "gaits" / "explosion.gait.glb")
            counts = {}
            for anim in doc["animations"]:
                sampler = anim["samplers"][0]
                counts[anim["name"]] = doc["accessors"][sampler["input"]]["count"]
            flight = {"Lb_ExplosionForward", "Ub_ExplosionForward",
                      "Lb_ExplosionBackward", "Ub_ExplosionBackward"}
            for name, meta in result["clips"].items():
                self.assertEqual(name in flight, meta["loop"], name)
                # Three frames: a loop ships four keys, a one-shot three.
                self.assertEqual(4 if name in flight else 3, counts[name], name)

    def test_the_get_up_plays_at_half_speed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            clips = self.export(Path(tmp))["clips"]
            self.assertAlmostEqual(2.0, clips["Lb_ExplosionLandFrontSurviveStandUp"]["period"],
                                   places=4)
            self.assertAlmostEqual(2.0, clips["Ub_ExplosionLandBackSurviveStandUp"]["period"],
                                   places=4)
            self.assertAlmostEqual(1.0, clips["Lb_ExplosionLandFront"]["period"], places=4)

    def test_the_states_own_words_ride_in_the_meta(self) -> None:
        # The morph factor (50 into the flight, 10 into a landing, a cut into
        # a bounce) and where a one-shot hands over: a bounce off a wall turns
        # the flight round, a survivor's landing gets up.
        with tempfile.TemporaryDirectory() as tmp:
            clips = self.export(Path(tmp))["clips"]
            self.assertEqual(50.0, clips["Lb_ExplosionForward"]["morphFactor"])
            self.assertEqual(10.0, clips["Ub_ExplosionLandBack"]["morphFactor"])
            self.assertEqual(5000.0, clips["Lb_ExplosionBounceFront"]["morphFactor"])
            self.assertEqual("Lb_ExplosionBackward",
                             clips["Lb_ExplosionBounceFront"]["returnTo"])
            self.assertEqual("Lb_ExplosionLandFrontSurviveStandUp",
                             clips["Lb_ExplosionLandFrontSurvive"]["returnTo"])
            self.assertIsNone(clips["Lb_ExplosionLandFront"]["returnTo"])

    def test_the_lower_states_stow_the_weapon(self) -> None:
        # `setFlag c_AsmHideWeapon` on every lower state, read off the state
        # machine; `BFSoldier::enableItem` (`0x082784af`) obeys it.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.export(out)
            doc = bundle(out / "gaits" / "explosion.gait.glb")
            for name, meta in result["clips"].items():
                self.assertEqual(HIDE if name.startswith("Lb_") else [], meta["flags"], name)
            self.assertTrue(doc["extras"]["hidesWeapon"])
            self.assertEqual(result["clips"], doc["extras"]["explosion"])

    def test_an_unreadable_clip_is_an_error_not_an_absence(self) -> None:
        files = dict(EXPLOSION_FILES)
        files["x/bounce_back_lower.baf"] = b"\x21garbage"
        with tempfile.TemporaryDirectory() as tmp:
            result = self.export(Path(tmp), files=files)
            self.assertIn("Lb_ExplosionBounceBack", result["errors"])
            self.assertIn("unparseable", result["errors"]["Lb_ExplosionBounceBack"])
            self.assertNotIn("Lb_ExplosionBounceBack", result["absent"])
            self.assertIn("Lb_ExplosionForward", result["clips"])

    def test_a_mod_with_no_explosion_states_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.export(out, animstates.StateMachine())
            self.assertIsNone(result["asset"])
            self.assertEqual(len(extract_pose.EXPLOSION_STATES), len(result["absent"]))
            self.assertFalse((out / "gaits").exists())

    def test_the_run_merges_its_one_key(self) -> None:
        original = extract_pose.read_skeleton
        extract_pose.read_skeleton = lambda _pool, _path: soldier_skeleton()
        from bf42 import con as con_mod
        library = con_mod.ObjectLibrary()
        library.add_con("objects/soldiers/test/objects.con",
                        "ObjectTemplate.create BFSoldier TestSoldier\n")
        library.object("TestSoldier").skeleton = "animations/UsSoldier.ske"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp)
                summary = extract_pose.write_explosion_assets(
                    explosion_machine(), FakePool(EXPLOSION_FILES), library,
                    ["TestSoldier"], out)
                manifest = json.loads((out / "gaits" / "gaits.json").read_text())
        finally:
            extract_pose.read_skeleton = original
        self.assertEqual("gaits/explosion.gait.glb", summary["body"]["asset"])
        self.assertEqual({"explosion": "gaits/explosion.gait.glb"}, manifest)


class ExplosionManifestMergeTests(unittest.TestCase):
    def test_an_explosion_run_keeps_every_other_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "gaits").mkdir()
            before = {"lower": "gaits/lower.gait.glb",
                      "grips": {"Colt": "gaits/Colt.gait.glb"},
                      "parachute": "gaits/parachute.gait.glb",
                      "canopy": "gaits/parachute.canopy.glb",
                      "swim": "gaits/swim.gait.glb", "die": "gaits/die.gait.glb"}
            (out / "gaits" / "gaits.json").write_text(json.dumps(before))
            merged = extract_pose.write_gaits_manifest(
                out, {"explosion": "gaits/explosion.gait.glb"})
            self.assertEqual({**before, "explosion": "gaits/explosion.gait.glb"}, merged)


if __name__ == "__main__":
    unittest.main()
