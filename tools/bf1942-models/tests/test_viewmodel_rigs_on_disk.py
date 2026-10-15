"""Every weapon a tree's kits hand out has its first-person rig on disk.

`extract_viewmodel.py --kits` exports one rig a (soldier, item) pair
(`kit_pairs`), and `viewmodels/index.json` lists what it wrote. A pair with
no rig is a weapon raised with no arms and no gun: FHSW's
`RandomGerGrenadierRG2` on Battle_Of_Foy (the behaviour audit's
`kit.no-first-person-rig`).

That one was ours, not the game's. Its `Ub_StandAim` state is a copy of
GrenadeAxis's that a later copy seemed to replace with clips from a folder no
archive holds (`StandWalkRun/1p/RandomGerGrenadierRG2/`); the engine keeps
the first copy (ledger ANIM-16), so the rig exists in the game, and the
re-export that followed the parser's fix (26d9523d) took only the rigs whose
clips moved, not the ones that had become exportable: 17 FHSW pairs
(grenades, smoke, charges).

Trees checked: vanilla, XPack1, XPack2, FH, FHSW, FHSWEurope, each when it
is on this PC. A pair the game itself gives no first-person idle goes in
`NO_RIG` with the missing clip's path, and a pair whose weapon nothing the
level loads declares (the mod's data) in `NO_TEMPLATE` with where it is
declared instead.

The pairs include a level's own copy of a kit (`levelVariants`) and the
weapons only a level declares, which a rig is built for through that level's
load (2026-10-15: FHSWEurope's 203 Hill, whose Russians held a bare
third-person `GrenadeRus` with no hands). A tree not re-extracted since then
lists what it still lacks in `PENDING`.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from extract_viewmodel import kit_pairs
from tests.test_weapon_sounds_on_disk import ASSETS

TREES = {"vanilla": ("models", "maps"),
         "xpack1": ("models/mods/xpack1", "maps/mods/xpack1"),
         "xpack2": ("models/mods/xpack2", "maps/mods/xpack2"),
         "fh": ("models/mods/fh", "maps/mods/fh"),
         "fhsw": ("models/mods/fhsw", "maps/mods/fhsw"),
         "fhsweurope": ("models/mods/fhsweurope", "maps/mods/fhsweurope")}

# tree -> {"Soldier__Weapon": the 1P idle clip the install does not hold}
NO_RIG: dict[str, dict[str, str]] = {}

# tree -> {"Soldier__Weapon": where the weapon is declared, if anywhere}
NO_TEMPLATE: dict[str, dict[str, str]] = {"fhsweurope": {
    "ItalianSoldier__CarcanoSniper": "argyrokastro-1940 hands it out; only "
                                     "battle_of_nikolayevka-1943 declares it",
    "GreekSoldier__CarcanoSniper": "argyrokastro-1940 hands it out (a pad kit); only "
                                   "battle_of_nikolayevka-1943 declares it",
    "ChineseSoldier__sigke7": "yellow_sea-1937 hands it out; battle_of_abyssinia-1936, "
                              "guangxi_counterattack-1940 and wuhan_outskirts-1938 declare it",
    "ChineseSoldier__sigke7_Lay": "as sigke7",
}}

# tree -> the rigs it lacked when level copies' items and level-declared
# weapons were first asked for (2026-10-15), until its viewmodels step runs:
# `mod_pipeline.py run --mod <M> --only-steps viewmodels --force-steps`.
PENDING: dict[str, set[str]] = {"fhsw": {
    'britishsoldier__molli5',
    'britishsoldier__mortar-flare_support',
    'britishsoldier__randomp08p38',
    'britishsoldier__randomsmokeitem4ger',
    'britishsoldier__taimatu2',
    'britishsoldier__taimatu5',
    'fmgermansoldier16__knifeallies',
    'fmgermansoldier16__knifeaxis',
    'fmgermansoldier__ammopack88x571',
    'fmgermansoldier__lantern',
    'fmgermansoldier__ppsh',
    'fmgermansoldier__randomsmokeitem5ger',
    'fmgermansoldier__smokegren_m8',
    'fmgermansoldier__taimatu5',
    'frenchsoldier__knifeaxis',
    'germandesertsoldier__lantern',
    'germandesertsoldier__molli5',
    'germandesertsoldier__stenmk5',
    'germandesertsoldier__taimatu5',
    'germansoldier16__knifeallies',
    'germansoldier__lantern',
    'germansoldier__m1917_revolver',
    'germansoldier__randomp08p38',
    'germansoldier__randomsmokeitem4ger',
    'germansoldier__randomsmokeitem5ger',
    'germansoldier__taimatu5',
    'italiansoldier__knifeallies',
    'italiansoldier__m1917_revolver',
    'japanesesoldier__drops_med',
    'japanesesoldier__m1917_revolver',
    'japanesesoldier__molli5',
    'japanesesoldier__randomjpofficerpistol',
    'japanesesoldier__spawnradiodeploy',
    'polishsoldier__knifeaxis',
    'russiansoldier__ammopackmortar81mm_link3',
    'russiansoldier__deploy_m-31',
    'russiansoldier__handheld_flag_soviet',
    'russiansoldier__handheld_mortar_ammo',
    'russiansoldier__knifeaxis',
    'russiansoldier__randomsmokeitem5rdg2',
    'russiansoldier__satchel',
    'russiansoldier__satchelshort',
    'russiansoldier__smokegren_m8',
    'turbowrenchbritishsoldier__taimatu',
    'turbowrenchbritishsoldier__taimatu2',
    'turbowrenchgermansoldier__knifeaxis',
    'turbowrenchgermansoldier__lantern',
    'turbowrenchgermansoldier__taimatu4',
    'turbowrenchjapanesesoldier__arisakacarbine',
    'turbowrenchjapanesesoldier__drops_med',
    'turbowrenchjapanesesoldier__randomsmokeitem4type112',
    'turbowrenchussoldier__colabottle',
    'turbowrenchussoldier__knifeallies',
    'turbowrenchussoldier__randomsmokeitem4m82',
    'ussoldier__arisakacarbine',
    'ussoldier__arisakacarbinebay',
    'ussoldier__colabottle',
    'ussoldier__garandgrenade_smoke',
    'ussoldier__m1917_revolver',
    'ussoldier__molli6',
    'ussoldier__mortar-flare_support',
    'ussoldier__randommarineengineer',
    'ussoldier__spawnradiodeploy',
    'volkssturmsoldier__ammopackmortar81mm_link3',
    'volkssturmsoldier__deploy_m-31',
    'volkssturmsoldier__handheld_flag_soviet',
    'volkssturmsoldier__handheld_mortar_ammo',
    'volkssturmsoldier__knifeaxis'
}}


def missing_rigs(models: Path, maps: Path) -> list[str]:
    kits = json.loads((models / "kits.json").read_text())
    levels = {entry["name"].lower()
              for entry in json.loads((maps / "maps.json").read_text())}
    index = {stem.lower() for stem in
             json.loads((models / "viewmodels" / "index.json").read_text())}
    return [f"{soldier}__{weapon}" for soldier, weapon in kit_pairs(kits, levels)
            if f"{soldier}__{weapon}".lower() not in index]


@unittest.skipUnless(ASSETS, "no extracted viewer assets on this machine")
class KitRigsOnDiskTests(unittest.TestCase):
    def test_every_kit_pair_of_a_baked_level_has_a_rig(self) -> None:
        checked = 0
        for tree, (models, maps) in TREES.items():
            models, maps = ASSETS / models, ASSETS / maps
            if not ((models / "kits.json").exists() and (maps / "maps.json").exists()
                    and (models / "viewmodels" / "index.json").exists()):
                continue
            checked += 1
            allowed = {stem.lower() for stem in
                       [*NO_RIG.get(tree, {}), *NO_TEMPLATE.get(tree, {})]}
            allowed |= PENDING.get(tree, set())
            missing = [stem for stem in missing_rigs(models, maps)
                       if stem.lower() not in allowed]
            with self.subTest(tree=tree):
                self.assertEqual([], missing,
                                 f"{tree}: kit items with no first-person rig; "
                                 "export them (extract_viewmodel.py --mod <M> "
                                 "--out <models>/viewmodels <Soldier> <Weapon> ...)")
        if not checked:
            self.skipTest("no tree with kits.json, maps.json and viewmodels/index.json")

    def test_every_listed_rig_is_a_file(self) -> None:
        for tree, (models, _maps) in TREES.items():
            folder = ASSETS / models / "viewmodels"
            if not (folder / "index.json").exists():
                continue
            gone = [stem for stem in json.loads((folder / "index.json").read_text())
                    if not (folder / f"{stem}.fp.glb").exists()]
            with self.subTest(tree=tree):
                self.assertEqual([], gone)


if __name__ == "__main__":
    unittest.main()
