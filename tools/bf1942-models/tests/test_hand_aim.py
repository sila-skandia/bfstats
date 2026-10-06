"""A hand weapon's barrels fire along their own turns (ledger XHIT-12).

Every armed hand weapon declares `fireInCameraDof 1`, so `FireArms::Fire`
(lnxded 0x0828a090) launches from the player's camera and `fireBarrel`
(0x0828aba0) turns that frame by the barrel's `addFireArmsPosition` rotation
before the round goes down its forward. Desert Combat's Remington and
Saiga12k declare eight barrels at the FireArms' origin, turned up to 1.5
degrees: the pellet pattern. The hand weapon's `aimRay` used to ignore the
barrel it was handed, so all eight pellets left down the view axis inside the
0.25 degree `setMinDev` cone, a slug.

`hand_aim_harness.mjs` fires the barrels through `gunfire.js` down
`hand-aim.js`'s ray, with the eye and the hand posed apart so that only the
eye's frame can be what the rounds follow. The synthetic cases need no assets;
the glb cases read the baked Remington and Thompson out of the viewer trees
and skip when those are not extracted.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.gltf import quat_from_ypr  # noqa: E402
from test_gunfire_layers import MODULES as GUNFIRE_MODULES, THREE_PACKAGE, VIEWER  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "hand_aim_harness.mjs"
MODULES = {**GUNFIRE_MODULES, "hand-aim.js": VIEWER / "hand-aim.js"}

# `Objects/HandWeapons/Remington/Objects.con` in Desert Combat 0.7's
# Objects.rfa: the eight `addFireArmsPosition 0/0/0 <yaw>/<pitch>/0` lines
# after "Tan reduced the choke some". Saiga12k declares the same eight.
REMINGTON_TURNS = [
    (1.25, -0.8), (0.5, -0.7), (-0.35, 1.25), (0.4, 0.26),
    (-0.22, 1.0), (-1.5, 0.35), (1.0, 0.22), (-0.85, -1.25),
]
REMINGTON_MIN_DEV = 0.25     # `setMinDev 0.25`
REMINGTON_STATS = {"projectile": {"template": "9mm_Projectile", "kind": "bullet",
                                  "timeToLive": 1.0, "gravity": 0.0,
                                  "damage": {"hasCollisionEffect": True, "dieAfterColl": True}},
                   "roundOfFire": 1.0, "magSize": 8, "numOfMag": 5, "velocity": 500.0,
                   "muzzles": 8}

DC_REMINGTON = VIEWER / "models" / "mods" / "desertcombat" / "viewmodels" / "USSoldier__Remington.fp.glb"
DC_SAIGA = VIEWER / "models" / "mods" / "desertcombat" / "viewmodels" / "IraqSoldier__Saiga12k.fp.glb"
THOMPSON = VIEWER / "models" / "viewmodels" / "USSoldier__Thompson.fp.glb"


def expected(yaw: float, pitch: float) -> tuple[float, float]:
    """A barrel turn as the eye sees it: Refractor's yaw turns toward +X (to
    the right) and its pitch is positive nose-down, the convention of every
    `setRotation` (`bf42/gltf.py` `quat_from_ypr`). Returned as the harness's
    yaw right / pitch up, degrees."""
    return yaw, -pitch


def run_harness(cases: list[dict]) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        spec = work / "spec.json"
        spec.write_text(json.dumps({"cases": cases}))
        proc = subprocess.run(["node", str(work / "harness.mjs"), str(spec)],
                              capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)["cases"]


def synthetic_remington() -> dict:
    return {"name": "Remington", "fireArms": REMINGTON_STATS,
            "muzzles": [{"translation": [0, 0, 0], "rotation": list(quat_from_ypr(y, p, 0.0))}
                        for y, p in REMINGTON_TURNS]}


def angle_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Degrees between two yaw/pitch directions."""
    def vec(yaw: float, pitch: float) -> tuple[float, float, float]:
        y, p = math.radians(yaw), math.radians(pitch)
        return (math.sin(y) * math.cos(p), math.sin(p), math.cos(y) * math.cos(p))
    u, v = vec(*a), vec(*b)
    dot = max(-1.0, min(1.0, sum(x * y for x, y in zip(u, v))))
    return math.degrees(math.acos(dot))


class ShotgunPatternTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cases = [
            {"name": "remington", "nodes": synthetic_remington(), "spread": 0},
            {"name": "remingtonCone", "nodes": synthetic_remington(),
             "spread": REMINGTON_MIN_DEV, "pulls": 40},
            {"name": "remingtonThrown", "nodes": synthetic_remington(), "spread": 0,
             "release": [0.22, -0.10, -0.40]},
            {"name": "rifle", "spread": 0,
             "nodes": {"name": "Thompson", "fireArms": {**REMINGTON_STATS, "muzzles": 1},
                       "muzzles": [{"translation": [0, 0, 0]}]}},
            # Desert Combat's RPG-7: `projectilePosition 0.01/-0.017/0.73`,
            # baked as its one barrel's offset.
            {"name": "offset", "spread": 0,
             "nodes": {"name": "RPG7", "fireArms": {**REMINGTON_STATS, "muzzles": 1},
                       "muzzles": [{"translation": [0.01, -0.017, -0.73]}]}},
        ]
        for name, path in (("glbRemington", DC_REMINGTON), ("glbSaiga", DC_SAIGA),
                           ("glbThompson", THOMPSON)):
            if path.exists():
                cases.append({"name": name, "glb": str(path), "spread": 0})
        cls.results = run_harness(cases)

    def pellets(self, case: str) -> list[dict]:
        return self.results[case]["pulls"][0]

    def test_a_pull_fires_one_pellet_per_barrel(self) -> None:
        self.assertEqual(8, self.results["remington"]["muzzles"])
        self.assertEqual(8, len(self.pellets("remington")))

    def test_each_pellet_leaves_along_its_barrels_turn_in_the_eyes_frame(self) -> None:
        for (yaw, pitch), pellet in zip(REMINGTON_TURNS, self.pellets("remington")):
            want = expected(yaw, pitch)
            self.assertLess(angle_between((pellet["yaw"], pellet["pitch"]), want), 1e-3,
                            f"barrel {yaw}/{pitch}: {pellet}")

    def test_the_pellets_leave_from_the_eye(self) -> None:
        for pellet in self.pellets("remington"):
            self.assertLess(max(abs(v) for v in pellet["origin"]), 1e-4)

    def test_the_cone_wanders_each_pellet_about_its_own_barrel(self) -> None:
        # Each barrel draws its own deviation (`fireBarrel`, per call), so every
        # pellet stays within `minDev` of its own turn, and the eight turns
        # still make a pattern wider than one cone.
        worst = 0.0
        for pull in self.results["remingtonCone"]["pulls"]:
            self.assertEqual(8, len(pull))
            for (yaw, pitch), pellet in zip(REMINGTON_TURNS, pull):
                worst = max(worst, angle_between((pellet["yaw"], pellet["pitch"]),
                                                 expected(yaw, pitch)))
        self.assertLessEqual(worst, REMINGTON_MIN_DEV + 1e-6)
        self.assertGreater(worst, 0.05)   # the cone is live

    def test_the_pattern_is_not_a_slug(self) -> None:
        yaws = [p["yaw"] for p in self.pellets("remington")]
        pitches = [p["pitch"] for p in self.pellets("remington")]
        # 2.75 by 2.5 degrees across: about 1.2 by 1.1 m at 25 m, against the
        # 0.22 m one 0.25 degree cone paints there.
        self.assertAlmostEqual(2.75, max(yaws) - min(yaws), places=3)
        self.assertAlmostEqual(2.5, max(pitches) - min(pitches), places=3)

    def test_a_thrown_round_still_flies_the_turned_axis_from_the_fist(self) -> None:
        for plain, thrown in zip(self.pellets("remington"), self.pellets("remingtonThrown")):
            self.assertLess(angle_between((plain["yaw"], plain["pitch"]),
                                          (thrown["yaw"], thrown["pitch"])), 1e-4)
            for got, want in zip(thrown["origin"], [0.22, -0.10, -0.40]):
                self.assertAlmostEqual(want, got, places=5)

    def test_a_rifle_barrel_is_unchanged_down_the_view_axis(self) -> None:
        (round_,) = self.pellets("rifle")
        self.assertLess(angle_between((round_["yaw"], round_["pitch"]), (0.0, 0.0)), 1e-4)
        self.assertLess(max(abs(v) for v in round_["origin"]), 1e-4)

    def test_a_barrel_offset_is_added_in_the_eyes_frame(self) -> None:
        (round_,) = self.pellets("offset")
        for got, want in zip(round_["origin"], [0.01, -0.017, -0.73]):
            self.assertAlmostEqual(want, got, places=5)
        self.assertLess(angle_between((round_["yaw"], round_["pitch"]), (0.0, 0.0)), 1e-4)

    def test_the_baked_shotguns_fire_their_authored_turns(self) -> None:
        for case in ("glbRemington", "glbSaiga"):
            if case not in self.results:
                self.skipTest("the Desert Combat viewmodels are not extracted")
            pellets = self.pellets(case)
            self.assertEqual(8, len(pellets))
            for (yaw, pitch), pellet in zip(REMINGTON_TURNS, pellets):
                self.assertLess(angle_between((pellet["yaw"], pellet["pitch"]), expected(yaw, pitch)),
                                1e-3, f"{case} barrel {yaw}/{pitch}: {pellet}")

    def test_the_baked_thompson_still_fires_down_the_view_axis(self) -> None:
        if "glbThompson" not in self.results:
            self.skipTest("the vanilla viewmodels are not extracted")
        (round_,) = self.pellets("glbThompson")
        self.assertLess(angle_between((round_["yaw"], round_["pitch"]), (0.0, 0.0)), 1e-4)


if __name__ == "__main__":
    unittest.main()
