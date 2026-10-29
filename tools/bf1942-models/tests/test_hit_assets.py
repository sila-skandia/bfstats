"""The hit clip bundle: `gaits/hit.gait.glb` and its one manifest key.

What this pins, each read out of the game rather than chosen:

* **The five torso states `BFSoldier::handleDamage` (lnxded `0x08270980`)
  sets on a soldier who lives through a blow are baked under their own
  names**, `extract_pose.HIT_STATES`, and the replay's own table
  (`viewer/replay-bodies.js` `HIT_STATE` / `STANCE_HIT`) asks for no other.

* **None of them loops, and each hands back to the pose.** Every one is a
  `c_AsmPlayOnce` with `returnToState _POSE_` (`AnimationStatesDie.con`), so
  the torso is back on its aim when the flinch is done.

* **An upper-only flinch keeps the weapon.** `hidesWeapon` is false: the hit
  states declare no `c_AsmHideWeapon` and the legs keep their own state.
"""

from __future__ import annotations

import json
import re
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
from test_swim_assets import UPPER3  # noqa: E402
from test_die_assets import bundle  # noqa: E402
import extract_pose  # noqa: E402

VIEWER = Path(__file__).resolve().parents[1] / "viewer"


def hit_machine() -> tuple[animstates.StateMachine, dict[str, bytes]]:
    machine = animstates.StateMachine()
    files: dict[str, bytes] = {}
    for name in extract_pose.HIT_STATES:
        path = f"h/{name}.baf"
        files[path] = pack_baf_frames(UPPER3)
        state = animstates.State(name)
        state.clips.append(animstates.ClipRef(path, 1.0, "c_AsmPlayOnce"))
        state.return_to = "_POSE_"
        state.morph_factor = 30.0 if name == "Ub_HitLie" else 3000.0
        machine.states[name.lower()] = state
    return machine, files


class HitClipBundleTests(unittest.TestCase):
    def export(self, out: Path) -> dict:
        machine, files = hit_machine()
        return extract_pose.export_hit_clips(
            machine, FakePool(files), soldier_skeleton(), out)

    def test_every_hit_state_is_baked_under_its_own_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.export(out)
            doc = bundle(out / "gaits" / "hit.gait.glb")
            self.assertEqual(list(extract_pose.HIT_STATES),
                             [a["name"] for a in doc["animations"]])
            self.assertEqual("gaits/hit.gait.glb", result["asset"])
            self.assertEqual({}, result["absent"])
            self.assertFalse(doc["extras"]["hidesWeapon"])
            for name, meta in result["clips"].items():
                self.assertFalse(meta["loop"], name)
                self.assertEqual("_POSE_", meta["returnTo"], name)

    def test_the_replay_asks_for_only_the_baked_states(self) -> None:
        text = (VIEWER / "replay-bodies.js").read_text()
        asked = set(re.findall(r"'(Ub_Hit\w+)'", text))
        self.assertTrue(asked)
        self.assertEqual(set(), asked - set(extract_pose.HIT_STATES))

    def test_a_subset_run_merges_one_key(self) -> None:
        machine, files = hit_machine()
        from bf42 import con as con_mod
        library = con_mod.ObjectLibrary()
        library.add_con("objects/soldiers/test/objects.con",
                        "ObjectTemplate.create BFSoldier TestSoldier\n")
        library.object("TestSoldier").skeleton = "animations/UsSoldier.ske"
        original = extract_pose.read_skeleton
        extract_pose.read_skeleton = lambda _pool, _path: soldier_skeleton()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp)
                (out / "gaits").mkdir()
                before = {"die": "gaits/die.gait.glb", "lower": "gaits/lower.gait.glb"}
                (out / "gaits" / "gaits.json").write_text(json.dumps(before))
                extract_pose.write_hit_assets(
                    machine, FakePool(files), library, ["TestSoldier"], out)
                manifest = json.loads((out / "gaits" / "gaits.json").read_text())
        finally:
            extract_pose.read_skeleton = original
        self.assertEqual({**before, "hit": "gaits/hit.gait.glb", "triggerShakes": {}}, manifest)

    def test_a_mod_with_no_hit_states_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = extract_pose.export_hit_clips(
                animstates.StateMachine(), FakePool({}), soldier_skeleton(), out)
            self.assertIsNone(result["asset"])
            self.assertEqual(len(extract_pose.HIT_STATES), len(result["absent"]))


class TriggerShakeTests(unittest.TestCase):
    """`gaits.json` `triggerShakes`: the soldier's camera-shake triggers
    (`CameraShakeTriggers`, lnxded `operator<<` 0x0829cf90) by the state
    `BFSoldierTemplate::init` looks up for each (0x0827aea7..0x0827af97),
    with the tree's own blocks. `CstHitShake` is what `handleDamage` enters
    on a blow he lives through (0x08270a69); the replay shakes the victim's
    first person with it (`viewer/replay-camera.js` `hurt`)."""

    def test_the_hit_shake_is_the_states_own(self) -> None:
        machine = animstates.StateMachine()
        state = animstates.State("HitShake")
        block = state.shake_slot(0)
        block.update(active=True, roll=[4.0, 50.0], pitch=[1.5, 200.0], fadeOut=5.0)
        machine.states["hitshake"] = state
        machine.states["dieshake"] = animstates.State("DieShake")   # no shake: left out
        shakes = extract_pose.trigger_shakes(machine)
        self.assertEqual(["CstHitShake"], list(shakes))
        self.assertEqual("HitShake", shakes["CstHitShake"]["state"])
        (slot,) = shakes["CstHitShake"]["cameraShake"]
        self.assertEqual([4.0, 50.0], slot["roll"])
        self.assertEqual([1.5, 200.0], slot["pitch"])
        self.assertEqual(5.0, slot["fadeOut"])
        self.assertEqual(0.0, slot["fadeIn"])
        self.assertNotIn("active", slot)

    def test_the_triggers_are_the_engines_four(self) -> None:
        self.assertEqual({"CstExplosion": "BigExplosion", "CstMachinegun": "FireMachineGunShake",
                          "CstHitShake": "HitShake", "CstDieShake": "DieShake"},
                         extract_pose.TRIGGER_SHAKES)

    def test_the_replay_reads_the_hit_trigger(self) -> None:
        text = (VIEWER / "replay-camera.js").read_text()
        self.assertIn("triggerSlots('CstHitShake')", text)
        self.assertIn("footTriggerShakes", (VIEWER / "foot-body.js").read_text())


if __name__ == "__main__":
    unittest.main()
