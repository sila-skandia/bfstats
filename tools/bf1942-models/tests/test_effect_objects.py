"""A level's own effects, and the objects spawn effects stand up
(`viewer/effects.js`, `viewer/effect-objects.js`, `viewer/vehicle-wrecks.js`),
driven headless by `effect_objects_harness.mjs`.

The engine rules (ledger EMT-9, ARM-8): an emitter with `isSpawnEffect 1`
makes no particle, the game creates its template as a real object at the spawn
point in the emitter's frame (`Emitter::handleUpdate` lnxded 0x081e3200 ->
`GameServer::spawnObject` 0x08132440); and every armour tier, the death tier
included, is a child of its object at the authored offset with no turn of its
own (`Armor::playEffect` 0x08172960). A level's own scripts run before the
mod's (`extract_map.LevelFirst`), so the bundles it declares are its own.

The install-gated case bakes Desert Combat's No Fly Zone and kills its control
tower: the death tier names `e_air_control_tower_desWRECKPCO`, which only the
level declares, and which stands the ruined tower up where the tower stood.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_models import DEFAULT_GAME_DIR  # noqa: E402

HARNESS = Path(__file__).with_name("effect_objects_harness.mjs")
GAME = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))


def run_harness(*args: Path) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS), *map(str, args)],
                          capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SyntheticTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_levels_bundles_answer_first_while_it_is_up(self) -> None:
        library = self.results["library"]
        self.assertEqual({"own": False, "names": 2}, library["before"])
        self.assertEqual({"own": True, "shadowed": True, "modOnly": True, "names": 3},
                         library["during"])
        self.assertEqual({"own": False, "names": 2}, library["after"])

    def test_a_death_tier_plays_in_the_dying_objects_frame(self) -> None:
        # Before ARM-8 the tier was stood up at the hull's origin on the
        # ground's normal: the 1.2 m offset was lost and the frame had no
        # heading. Now it rides an anchor at the offset, turned with the hull.
        [play] = self.results["deathFrame"]
        self.assertEqual("e_ExplGas", play["name"])
        self.assertTrue(play["attached"])
        self.assertIsNone(play["position"])
        self.assertEqual([10, 1.2, 20], play["at"]["position"])
        self.assertEqual([-1, 0, 0], play["at"]["forward"])


@unittest.skipUnless((GAME / "Mods" / "DesertCombat").is_dir(), "no Desert Combat install")
class NoFlyZoneTowerTests(unittest.TestCase):
    tower: dict

    @classmethod
    def setUpClass(cls) -> None:
        import extract_effects
        import scene_layers
        from bf42.assemble import _armor_effect_offset
        with tempfile.TemporaryDirectory() as tmp:
            ctx = scene_layers.LevelContext(GAME, "DesertCombat", "DC_No_Fly_Zone", out=Path(tmp))
            glb, cls.manifest = extract_effects.bake_level(ctx, max_texture=16)
            template = ctx.library.object("air_control_tower_des")
            armor = {
                "hitpoints": template.hitpoints,
                "effects": [{"hp": hp, "effect": name, "offset": _armor_effect_offset(offset)}
                            for hp, name, offset in template.armor_effects],
            }
            glb_path = Path(tmp) / "effects.glb"
            glb_path.write_bytes(glb)
            tower_path = Path(tmp) / "tower.json"
            tower_path.write_text(json.dumps({"name": template.name, "armor": armor}))
            cls.tower = run_harness(glb_path, tower_path)["tower"]

    def test_the_level_bakes_its_four_ruins(self) -> None:
        self.assertEqual(
            ["e_air_control_tower_desWRECKPCO", "e_air_hangar_bunker_WRECKPCO",
             "e_air_radardome_desWRECKPCO", "e_mil_hangar_desWRECKPCO"],
            sorted(self.manifest["bundles"]))
        self.assertEqual([], self.manifest["missing"])
        self.assertEqual(self.tower["levelBundles"], sorted(self.manifest["bundles"]))

    def test_destroying_the_tower_resolves_its_ruin(self) -> None:
        self.assertIn({"name": "e_air_control_tower_desWRECKPCO", "resolved": True,
                       "attached": True}, self.tower["deathPlays"])

    def test_the_ruin_stands_where_the_tower_stood(self) -> None:
        [ruin] = self.tower["spawned"]
        self.assertEqual("air_control_tower_des_wreck", ruin["name"])
        self.assertEqual("PlayerControlObject", ruin["kind"])
        self.assertEqual("e_air_control_tower_desWRECKPCO", ruin["spawnedBy"])
        self.assertEqual([-120, 31.5, 640], ruin["position"])
        self.assertEqual(0, ruin["headingError"])
        self.assertGreater(ruin["meshes"], 0)
        self.assertTrue(ruin["inScene"])
        self.assertEqual(1, self.tower["adopted"])

    def test_the_ruin_burns_with_its_own_tier(self) -> None:
        # 999999 hit points against one tier at 1000000: three smoke columns
        # and a fire from the first tick.
        self.assertEqual(["e_DefGunDamage"] * 3 + ["e_PanzFire"], self.tower["ruinTier"])

    def test_a_level_change_takes_the_ruin_away(self) -> None:
        self.assertEqual({"objects": 0, "inScene": 0}, self.tower["afterClear"])


if __name__ == "__main__":
    unittest.main()
