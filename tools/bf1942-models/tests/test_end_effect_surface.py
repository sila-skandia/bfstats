"""A grenade bursts by the surface under it (gap audit entry 37).

`Projectile::startEndEffect` (lnxded 0x0831f590): a round whose template sets
`useMMOnEndEffect` (`+0x14e`, written at 0x082e35ee, tested at 0x0831f602)
asks the MaterialManager for its end effect: `material2` against 1 (water)
when the round is under the water level (`Armor::getCollisionWithWater`
0x08172ed0), else against the material it last struck
(`Armor::getLastHitMaterialIndex` 0x081740b0, -1 until a contact), an unknown
id on either side read as material 0 (`getEffectTemplate` 0x081750d0).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import con as con_mod  # noqa: E402
from extract_map import projectile_materials  # noqa: E402

HARNESS = Path(__file__).with_name("end_effect_surface_harness.mjs")
VIEWER = Path(__file__).resolve().parents[1] / "viewer"


class ExporterTests(unittest.TestCase):
    def test_the_word_reaches_the_rounds_row(self) -> None:
        library = con_mod.ObjectLibrary()
        library.add_con(
            "Objects/Test/Weapons.con",
            "ObjectTemplate.create Projectile GrenadeAlliesProjectile\n"
            "ObjectTemplate.useMMOnEndEffect 1\n"
            "ObjectTemplate.create Projectile ExpPackProjectile\n"
            "ObjectTemplate.useMMOnEndEffect 0\n"
            "ObjectTemplate.create Projectile K98Projectile\n")
        table = projectile_materials(library)
        self.assertIs(True, table["grenadealliesprojectile"]["useMMOnEndEffect"])
        # Written only when set: the constructor's 0 is what the page assumes.
        self.assertNotIn("useMMOnEndEffect", table.get("exppackprojectile", {}))
        self.assertNotIn("useMMOnEndEffect", table.get("k98projectile", {}))


class EndEffectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr[-4000:])
        cls.out = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_the_last_surface_struck_picks_the_bundle(self) -> None:
        self.assertEqual("GranadeExplDirt", self.out["grass"])
        self.assertEqual("GranadeExplDry", self.out["sand"])
        self.assertEqual("e_ExplGranade", self.out["concrete"])

    def test_under_the_water_level_it_is_material_one(self) -> None:
        self.assertEqual("e_waterimpact", self.out["water"])

    def test_an_unknown_material_is_read_as_material_zero(self) -> None:
        self.assertEqual("e_ExplGranade", self.out["airburst"])
        self.assertEqual("e_ExplGranade", self.out["unlisted"])
        self.assertEqual("e_richoStone", self.out["noRow"])

    def test_a_round_without_the_word_keeps_its_end_effect_template(self) -> None:
        self.assertEqual("e_ExplAni", self.out["fixed"])
        self.assertEqual("e_ExplGranade", self.out["noTable"])

    def test_detonate_plays_it(self) -> None:
        self.assertEqual({"effect": "GranadeExplDirt", "played": ["GranadeExplDirt"],
                          "blast": "endOfLife", "splashMaterial2": 205}, self.out["detonate"])

    def test_a_fuse_round_remembers_what_it_touched(self) -> None:
        flight = (VIEWER / "projectile-flight.js").read_text()
        self.assertIn("if (shot.body.contact) shot.lastHit = shot.body.contact;", flight)
        self.assertIn("shot.lastHit ?? null)", flight)

    def test_a_rooms_server_round_asks_the_same_question(self) -> None:
        # The server flies the round (`net-server-rounds.js` `detonate`); the
        # effect is still the surface's, off the FireArms' projectile block.
        rounds = (VIEWER / "net-server-rounds.js").read_text()
        self.assertIn("endEffectFor(guns, spec, { y: at[1] }, surface)", rounds)
        props = (VIEWER / "replay-props.js").read_text()
        self.assertIn("endEffect: projectile.endEffect ?? null, spec: projectile", props)


if __name__ == "__main__":
    unittest.main()
