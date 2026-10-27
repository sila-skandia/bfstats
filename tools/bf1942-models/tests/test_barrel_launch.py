"""Where a gun's round leaves from when it declares both barrels and a
`projectilePosition` (ledger XHIT-16).

`FireArms::fireBarrel` (lnxded 0x0828aba0) puts the round at the launch
frame's position plus `projectilePosition + barrel[i].position`, the sum read
at 0x0828b093, on the rows of the barrel's own turn times the frame. The
exporter writes a barrel as a muzzle node at its offset and turn and, when a
gun declares both, carries `projectilePosition` beside the barrels
(`bf42/assemble.py` `_fire_arms`). The page launched from the muzzle node
alone until 2026-10-28, which dropped the offset on 4,388 FireArms of the
model trees: vanilla's Yamato main battery (`projectilePosition 0/0/-14`,
barrel `0/0/14.5`) fired 14 m ahead of where the engine does, its plane guns
2 m short, and every FHSW ship round selector, whose FireArms hang 25 m under
the drawn gun and lift the round back with `projectilePosition 0/26/1`,
launched the chosen round 26 m under the barrel.

The replay launches a recorded round the same way (`replay-hulls.js`
`recordedLaunch`, `recorded_launch_harness.mjs`). `barrel_launch_harness.mjs` runs `round-launch.js` `barrelLaunch` and
`gun-groups.js` `cameraLaunch` under node. The synthetic cases need no assets;
the glb cases read the FHSWEurope Hamakaze and Flak 18/36 and skip when they
are not extracted.
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
from test_gunfire_layers import MODULES, THREE_PACKAGE, VIEWER  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "barrel_launch_harness.mjs"
RECORDED_HARNESS = Path(__file__).resolve().parent / "recorded_launch_harness.mjs"
FHSWE = VIEWER / "models" / "mods" / "fhsweurope"
HAMAKAZE = FHSWE / "Hamakaze.glb"
FLAK = FHSWE / "Flak18_36.glb"


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


def rotate(q, v):
    x, y, z, w = q
    ux, uy, uz = x, y, z
    # v + 2 u x (u x v + w v)
    cx = uy * v[2] - uz * v[1] + w * v[0]
    cy = uz * v[0] - ux * v[2] + w * v[1]
    cz = ux * v[1] - uy * v[0] + w * v[2]
    return (v[0] + 2 * (uy * cz - uz * cy),
            v[1] + 2 * (uz * cx - ux * cz),
            v[2] + 2 * (ux * cy - uy * cx))


def gun(name, muzzles, projectile_position=None, translation=(0, 0, 0)):
    """A FireArms node (index 0) with its muzzle children, glTF axes."""
    fire = {"velocity": 100.0, "muzzles": len(muzzles)}
    if projectile_position is not None:
        fire["projectilePosition"] = list(projectile_position)
    nodes = [{"name": name, "translation": list(translation),
              "extras": {"templateKind": "FireArms", "fireArms": fire},
              "children": list(range(1, len(muzzles) + 1))}]
    for i, (position, rotation) in enumerate(muzzles):
        nodes.append({"name": f"{name} muzzle {i + 1}", "translation": list(position),
                      "rotation": list(rotation),
                      "extras": {"templateKind": "Muzzle", "muzzle": {"index": i}}})
    return nodes


IDENTITY = (0.0, 0.0, 0.0, 1.0)


def close(test, a, b, tol=1e-3):
    test.assertTrue(all(abs(x - y) <= tol for x, y in zip(a, b)), f"{a} != {b}")


def distance(a, b):
    return math.dist(a, b)


class SyntheticLaunchTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        turn = quat_from_ypr(90.0, 0.0, 0.0)
        # A camera 2 m up, its gun's barrel and offset as the Hamakaze's.
        camera_rig = gun("CamGun", [((0.4, 0.0, -5.9), IDENTITY)], (0.0, 26.0, -1.0))
        camera_rig.append({"name": "Cam", "translation": [0, 2, 0]})
        cls.turn = turn
        cls.results = run_harness([
            # Vanilla's Yamato main battery: barrel `0/0/14.5`,
            # `projectilePosition 0/0/-14`, glTF z negated.
            {"name": "yamato", "guns": ["YamatoFatCannon"],
             "nodes": gun("YamatoFatCannon", [((0.0, 0.0, -14.5), IDENTITY)], (0.0, 0.0, 14.0),
                          translation=(0.0, 12.0, -50.0))},
            # A barrel turned 90 degrees: its offset and the gun's offset both
            # ride the turned frame.
            {"name": "turned", "guns": ["Turned"],
             "nodes": gun("Turned", [((0.0, 0.0, -1.0), turn)], (0.0, 0.0, -2.0))},
            # No barrels: the one muzzle sits at `projectilePosition` and the
            # glb carries no offset beside it.
            {"name": "barrelless", "guns": ["Plain"],
             "nodes": gun("Plain", [((0.0, 19.963, -2.367), IDENTITY)], None,
                          translation=(1.0, 2.0, 3.0))},
            {"name": "camera", "guns": ["CamGun"], "camera": "Cam",
             "nodes": camera_rig, "roots": [0, 2]},
        ])

    def test_the_yamato_fires_half_a_metre_ahead_of_its_gun(self) -> None:
        shot = self.results["yamato"]["guns"]["YamatoFatCannon"][0]
        close(self, shot["origin"], (0.0, 12.0, -50.5))
        # Where the page put it before: the barrel, 14 m further on.
        close(self, shot["muzzleWorld"], (0.0, 12.0, -64.5))
        close(self, shot["dir"], (0.0, 0.0, -1.0))

    def test_a_turned_barrel_carries_both_offsets_on_its_turn(self) -> None:
        shot = self.results["turned"]["guns"]["Turned"][0]
        close(self, shot["origin"], rotate(self.turn, (0.0, 0.0, -3.0)))
        close(self, shot["dir"], rotate(self.turn, (0.0, 0.0, -1.0)))

    def test_a_barrelless_gun_still_fires_from_its_muzzle(self) -> None:
        shot = self.results["barrelless"]["guns"]["Plain"][0]
        close(self, shot["origin"], shot["muzzleWorld"])
        close(self, shot["origin"], (1.0, 21.963, 0.633))

    def test_a_camera_gun_adds_the_offset_beside_its_barrel(self) -> None:
        shot = self.results["camera"]["guns"]["CamGun"][0]
        close(self, shot["origin"], (0.4, 28.0, -6.9))


class RecordedLaunchTests(unittest.TestCase):
    """A replayed round starts from the recorded launch matrix plus the same
    two offsets: the recorder writes `fireBarrel`'s matrix argument, before
    the engine adds them (features/server-replay-recorder `write_fire`)."""

    def test_a_recorded_round_adds_the_offset_beside_its_barrel(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(RECORDED_HARNESS)], capture_output=True,
                              text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        out = json.loads(proc.stdout)
        # Recorded at (10, 20, 30) firing down +X: 14.5 - 14 = 0.5 m on.
        close(self, out["withOffset"]["origin"], (10.5, 20.0, -30.0))
        close(self, out["barrelOnly"]["origin"], (24.5, 20.0, -30.0))
        close(self, out["withOffset"]["dir"], (1.0, 0.0, 0.0))


@unittest.skipUnless(HAMAKAZE.exists() and FLAK.exists(), "FHSWEurope models not extracted")
class SelectorLaunchTests(unittest.TestCase):
    """The chosen round leaves from the drawn barrel; the other from 50 m
    under it, where its `BulletCatcher25m` waits (fhswe-mechanics-audit
    item 12)."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        ham = {"glb": str(HAMAKAZE), "guns": ["HamakazeGun_APHE", "HamakazeGun_AA"],
               "refs": ["HamakazeGun_Dummy"]}
        flak = {"glb": str(FLAK), "guns": ["Flak18/36GunAP_Invis", "Flak18/36GunAA_Invis"],
                "refs": ["Flak18/36GunBarrel"]}
        cls.results = run_harness([
            {"name": "hamRest", **ham},
            {"name": "hamTurned", **ham,
             "turns": [{"node": "HamakazeCannon_Invis_GunSelector", "degrees": -180}]},
            {"name": "flakRest", **flak},
            {"name": "flakTurned", **flak,
             "turns": [{"node": "Flak18/36GunSelector", "degrees": -180}]},
        ])

    def nearest(self, case: str, gun: str, ref: str) -> list[float]:
        refs = self.results[case]["refs"][ref]
        return [min(distance(shot["origin"], r) for r in refs)
                for shot in self.results[case]["guns"][gun]]

    def test_the_hamakaze_launches_the_chosen_round_at_its_drawn_barrels(self) -> None:
        for case, chosen, other in (("hamRest", "HamakazeGun_APHE", "HamakazeGun_AA"),
                                    ("hamTurned", "HamakazeGun_AA", "HamakazeGun_APHE")):
            with self.subTest(case):
                # One metre up and one ahead of the drawn muzzle: the `.con`'s 26 m
                # lift over a 25 m drop, and its 1 m forward.
                for d in self.nearest(case, chosen, "HamakazeGun_Dummy"):
                    self.assertLess(d, 1.6)
                for d in self.nearest(case, other, "HamakazeGun_Dummy"):
                    self.assertGreater(d, 40.0)
                # Before the fix the chosen round left from its muzzle node,
                # 26 m under the drawn gun.
                for shot in self.results[case]["guns"][chosen]:
                    self.assertGreater(distance(shot["origin"], shot["muzzleWorld"]), 25.0)

    def test_the_flak_launches_the_chosen_round_at_its_barrel(self) -> None:
        for case, chosen, other in (("flakRest", "Flak18/36GunAP_Invis", "Flak18/36GunAA_Invis"),
                                    ("flakTurned", "Flak18/36GunAA_Invis", "Flak18/36GunAP_Invis")):
            with self.subTest(case):
                # Two metres back from the drawn muzzle, inside the barrel:
                # the `.con` lifts the round to the gun base's height and
                # 2.367 m forward of it (`projectilePosition 0/19.963/2.367`
                # under a selector 20 m down), short of the 4.35 m barrel.
                # Barrel-less, so the engine launches there too (XHIT-16's
                # index -1).
                for d in self.nearest(case, chosen, "Flak18/36GunBarrel"):
                    self.assertAlmostEqual(d, 1.98, delta=0.05)
                for d in self.nearest(case, other, "Flak18/36GunBarrel"):
                    self.assertGreater(d, 30.0)
                # Barrel-less: the launch point is the muzzle node, as before.
                for shot in self.results[case]["guns"][chosen]:
                    close(self, shot["origin"], shot["muzzleWorld"])


if __name__ == "__main__":
    unittest.main()
