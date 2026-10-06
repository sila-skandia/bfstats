"""The upper body's camera shake: the weapon's fire kick and the sniper's aim sway.

Desert Combat declares 303 `setCameraShake*` lines on its `Ub_*` states and
vanilla 286 of its own (the Bazooka's 1 m jolt, the Thompson's buzz, the
snipers' kick and sway), and the page played none of them (the adversarial
sweep's CW15). `bf42/animstates.py` now parses them, `extract_viewmodel.py`
writes each clip family's into the viewmodel's extras, and `fire-shake.js` is
`getCameraShakeTransform` over them (ledger CS-8..CS-11), put on the drawn view
only.

`fire_shake_harness.mjs` drives `fire-shake.js` under node. The archive case
parses the installed game's state machines and skips without them.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_gunfire_layers import THREE_PACKAGE, VIEWER  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "fire_shake_harness.mjs"
MODULES = {
    "fire-shake.js": VIEWER / "fire-shake.js",
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class FireShakeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_bazooka_jolts_at_full_strength_and_fades_in_a_third_of_a_second(self) -> None:
        # No fade in: the factor snaps to 1 on the first frame (CS-8), and the
        # channel is amplitude x sin(rate x t), t one frame in: up-down
        # 1 m x sin(500 / 60).
        bazooka = self.results["bazooka"]
        first = bazooka["first"]
        self.assertEqual(1, first["factor"])
        self.assertAlmostEqual(math.sin(500 / 60), first["y"], places=9)
        self.assertAlmostEqual(0.8 * math.sin(100 / 60), first["x"], places=9)
        self.assertAlmostEqual(0.25 * math.sin(900 / 60), first["pitch"], places=9)
        # `fadeOut 3`: 3 a second off from the next frame on.
        self.assertAlmostEqual(0.75, bazooka["trace"]["0.1"]["factor"], places=6)
        self.assertAlmostEqual(0.15, bazooka["trace"]["0.3"]["factor"], places=6)
        # Under 0.001 the next slot starts; it has no block, so the shake ends
        # and its clock goes back to 0.
        end = bazooka["trace"]["0.5"]
        self.assertFalse(end["live"])
        self.assertEqual(-1, end["slot"])
        self.assertEqual(0, end["t"])

    def test_an_automatic_with_no_fade_out_shakes_for_the_whole_burst(self) -> None:
        thompson = self.results["thompson"]["trace"]
        self.assertEqual(1, thompson["1"]["factor"])
        self.assertEqual(1, thompson["5"]["factor"])
        self.assertTrue(thompson["5"]["live"])

    def test_the_sniper_kick_chains_into_its_slow_drift(self) -> None:
        # CS-7: slot 0 fades at 4 a second, then slot 1 snaps in and holds.
        trace = self.results["sniperFire"]["trace"]
        self.assertEqual(0, trace["0.2"]["slot"])
        self.assertAlmostEqual(1 - 4 * (0.2 - 1 / 60), trace["0.2"]["factor"], places=6)
        self.assertEqual(1, trace["0.26"]["slot"])
        self.assertEqual(1, trace["0.3"]["factor"])
        self.assertEqual(1, trace["3"]["slot"])
        self.assertTrue(trace["3"]["live"])

    def test_the_sniper_sway_fades_to_its_floor_and_stays(self) -> None:
        # `fadeOut 0.25` with `minFactor 0.075`: about 3.7 s down to the floor,
        # where a frame's fall never reaches 0.001, so the sway never ends.
        trace = self.results["sniperAim"]["trace"]
        self.assertAlmostEqual(1 - 0.25 * (1 - 1 / 60), trace["1"]["factor"], places=6)
        self.assertAlmostEqual(0.075, trace["4"]["factor"], places=9)
        self.assertAlmostEqual(0.075, trace["10"]["factor"], places=9)
        self.assertEqual(0, trace["10"]["slot"])

    def test_a_fade_in_is_a_rate(self) -> None:
        trace = self.results["fadeIn"]["trace"]
        self.assertAlmostEqual(0.3, trace["0.5"]["factor"], places=6)
        self.assertAlmostEqual(0.6, trace["1"]["factor"], places=6)
        self.assertEqual(1, trace["2"]["factor"])

    def test_a_time_limit_ends_the_shake(self) -> None:
        trace = self.results["timed"]["trace"]
        self.assertTrue(trace["0.05"]["live"])
        self.assertFalse(trace["0.15"]["live"])

    def test_only_a_state_unlike_the_current_one_restarts_it(self) -> None:
        # CS-9: the same state again (a fire loop's own c_PIFire transition)
        # leaves the shake running; leaving it and coming back restarts it.
        restart = self.results["restart"]
        self.assertFalse(restart["same"])
        self.assertEqual(restart["before"], restart["afterSame"])
        self.assertTrue(restart["other"])
        self.assertFalse(restart["noneLive"])
        self.assertEqual(0, restart["tAfterEnd"])
        self.assertTrue(restart["again"])
        self.assertTrue(restart["againLive"])
        self.assertEqual(1, restart["againFactor"])

    def test_the_view_turns_and_moves_in_its_own_frame_with_the_engines_signs(self) -> None:
        # The camera faces world -X, so its right is world -Z. A positive
        # pitch tips the view down, a positive yaw turns it right, a positive
        # roll leans its up to the right (CS-11), and every move is along the
        # camera's own axes. Each is undone.
        camera = self.results["camera"]
        s = math.sin(math.radians(10))
        self.assertAlmostEqual(-s, camera["pitch"]["fwd"][1], places=9)
        self.assertAlmostEqual(-s, camera["yaw"]["fwd"][2], places=9)
        self.assertAlmostEqual(-s, camera["roll"]["up"][2], places=9)
        self.assertEqual([0, 1, 0], [round(v, 9) for v in camera["up"]["moved"]])
        self.assertEqual([0, 0, -1], [round(v, 9) for v in camera["right"]["moved"]])
        self.assertEqual([-1, 0, 0], [round(v, 9) for v in camera["forward"]["moved"]])
        for case in camera.values():
            self.assertTrue(case["back"])


GAME = Path("~/.wine/drive_c/EA Games/Battlefield 1942").expanduser()


class ShippedShakeTests(unittest.TestCase):
    """The blocks the packs ship, through the exporter's own state machine."""

    @classmethod
    def setUpClass(cls) -> None:
        if not (GAME / "Mods" / "bf1942" / "Archives").is_dir():
            raise unittest.SkipTest("the game is not installed")
        import extract_viewmodel as ev
        # The archive pools hold their files open for the life of the run.
        warnings.simplefilter("ignore", ResourceWarning)
        cls.machines = {}
        for mod in ("bf1942", "DesertCombat"):
            if not (GAME / "Mods" / mod).is_dir():
                continue
            meshes, _textures, _objects, _game = ev.build_pools(ev.mod_chain(GAME, mod), [])
            cls.machines[mod] = ev.state_machine(meshes)

    def upper(self, mod: str) -> dict:
        machine = self.machines.get(mod)
        if machine is None:
            self.skipTest(f"{mod} is not installed")
        return {s.name: s.camera_shake_extras() for s in machine.states.values()
                if s.name.lower().startswith("ub_") and s.camera_shake_extras()}

    def test_vanilla_names_42_upper_states(self) -> None:
        upper = self.upper("bf1942")
        self.assertEqual(42, len(upper))
        bazooka = upper["Ub_FireBazooka"][0]
        self.assertEqual([1.0, 500.0], bazooka["upDown"])
        self.assertEqual(3.0, bazooka["fadeOut"])
        self.assertEqual(0.075, upper["Ub_StandAimK98Sniper"][0]["minFactor"])
        self.assertEqual(2, len(upper["Ub_FireK98Sniper"]))

    def test_desert_combat_adds_its_own_to_vanillas(self) -> None:
        upper = self.upper("DesertCombat")
        self.assertEqual(101, len(upper))
        self.assertIn("Ub_FireBazooka", upper)
        self.assertEqual([1.0, 500.0], upper["Ub_FireStinger"][0]["upDown"])
        self.assertEqual([0.25, 900.0], upper["Ub_FireM16A2"][0]["pitch"])


if __name__ == "__main__":
    unittest.main()
