"""A gun's muzzle is the game's own EffectBundle, played as particles.

Retail fires a gun's `addTemplate e_MuzzHeavy` / `e_shell1250mm` children as
ordinary EffectBundles: one flash mesh, one glow sprite and one casing per
round, each living its own `timeToLive`. The viewer used to strobe the baked
emitter nodes instead and replay `em_MuzzHeavy`'s `sizeOverTime 0.12 -> 9.4` as
node scale on a 1.76 m mesh, which is the fireball on every vehicle MG, and no
casing ever left the gun. `muzzle_bundle_harness.mjs` drives `gunfire.js` and
`effects.js` under node with the Browning's shapes (features/muzzle-effects-parity).

The python half pins `effect_names_for_firearms`, which is what puts those
bundles into `_shared/effects.glb`, and the effect library's alpha test.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_gunfire_layers import MODULES as GUNFIRE_MODULES, THREE_PACKAGE, VIEWER  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "muzzle_bundle_harness.mjs"
MODULES = {**GUNFIRE_MODULES, "effects.js": VIEWER / "effects.js"}


def run_harness() -> dict:
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
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class MuzzleBundleTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_bundles_are_found_by_their_authored_name(self):
        self.assertEqual(["e_MuzzHeavy", "e_shell1250mm"], self.results["bundles"])

    def test_one_shot_from_outside_is_flash_glow_and_casing(self):
        third = self.results["third"]
        self.assertEqual(2, third["runs"])
        self.assertEqual(["Em_shell1250mm", "em_MuzzHeavy", "em_MuzzHeavy_glow"],
                         third["particles"])
        self.assertEqual([], third["bakedLit"])

    def test_flash_mesh_draws_at_its_authored_size(self):
        # IMP-5: no sizeModifier, so the 0.12 -> 9.4 ramp does not apply.
        self.assertEqual([1, 1, 1], self.results["third"]["flashScale"])

    def test_glow_is_its_authored_size(self):
        scale = self.results["third"]["glowScale"]
        # SPR-7: `size 0.43` is a half-extent on the +-0.5 quad.
        self.assertAlmostEqual(0.86, scale[0], places=5)
        self.assertAlmostEqual(0.86, scale[1], places=5)

    def test_flash_rides_the_gun(self):
        self.assertAlmostEqual(1.0, self.results["third"]["flashMoved"], places=5)

    def test_casing_is_thrown_and_falls(self):
        casing = self.results["third"]["casing"]
        self.assertIsNotNone(casing)
        self.assertLess(casing["dy"], 0.0)
        self.assertLess(casing["dvy"], -2.0)   # half of 14.73 m/s^2 for 1/3 s
        self.assertGreater(casing["speed"], 0.5)
        # No sizeModifier: the casing draws at its authored 8.5 cm, not size 1.7.
        self.assertEqual([1, 1, 1], casing["scale"])

    def test_every_particle_dies_and_is_pooled(self):
        third = self.results["third"]
        self.assertEqual(0, third["afterASecond"])
        self.assertGreater(third["burstLive"], 0)
        self.assertEqual(0, third["burstAfter"])
        # A ten-round burst reuses a handful of pooled meshes, not thirty.
        self.assertLessEqual(third["pooled"], 16)

    def test_a_held_trigger_reuses_its_runs_and_records(self):
        third = self.results["third"]
        runs, records, meshes = third["poolsAfterFirst"]
        self.assertGreater(runs, 0)
        self.assertGreater(records, 0)
        self.assertLessEqual(runs, 6)
        self.assertLessEqual(records, 16)
        self.assertEqual(third["poolsAfterFirst"], third["poolsAfterSecond"])

    def test_first_person_is_the_seat_sprite_only(self):
        self.assertEqual(["em_1P_MuzzHeavy"], self.results["first"]["particles"])

    def test_without_the_library_the_baked_flash_obeys_imp5(self):
        fallback = self.results["fallback"]
        self.assertIn("em_MuzzHeavy", fallback["bakedLit"])
        self.assertAlmostEqual(1.0, fallback["flashScale"], places=5)
        self.assertAlmostEqual(0.86, fallback["glowScale"], places=5)

    def test_a_viewmodel_gun_keeps_the_baked_path(self):
        viewmodel = self.results["viewmodel"]
        self.assertEqual(0, viewmodel["particles"])
        self.assertIn("em_MuzzHeavy", viewmodel["bakedLit"])


class FireArmsEffectNamesTests(unittest.TestCase):
    def test_addtemplate_and_visible_barrel_bundles_are_named(self):
        from bf42 import con as con_mod
        from bf42 import effects as effects_mod
        lib = con_mod.ObjectLibrary()
        lib.add_con("Objects/Test/Objects.con", """
ObjectTemplate.create FireArms Browning
ObjectTemplate.addTemplate e_MuzzHeavy
ObjectTemplate.setPosition 0/0.1/0.8
ObjectTemplate.addTemplate e_Shell1250mm
ObjectTemplate.create FireArms CorsairGuns
ObjectTemplate.visibleBarrelTemplate e_MuzzHeavy
ObjectTemplate.create FireArms BombRack
ObjectTemplate.create EffectBundle e_MuzzHeavy
ObjectTemplate.create EffectBundle e_Shell1250mm
ObjectTemplate.create EffectBundle e_NotAGun
""")
        self.assertEqual({"e_MuzzHeavy", "e_Shell1250mm"},
                         effects_mod.effect_names_for_firearms(lib))


class AdditiveAlphaTestTests(unittest.TestCase):
    def test_only_a_caller_that_asks_carries_the_cutoff(self):
        from bf42 import gltf
        builder = gltf.GlbBuilder()
        plain = builder.add_material("flash", additive=True)
        tested = builder.add_material("flash", additive=True, additive_alpha_test=0.7)
        mats = builder._materials
        self.assertNotIn("alphaTest", mats[plain].get("extras", {}))
        self.assertEqual(0.7, mats[tested]["extras"]["alphaTest"])
        self.assertTrue(mats[tested]["extras"]["additive"])


if __name__ == "__main__":
    unittest.main()
