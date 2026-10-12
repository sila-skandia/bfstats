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

Trees checked: vanilla, XPack1, XPack2, FH, FHSW, each when it is on this
PC. A pair the game itself gives no first-person idle goes in `NO_RIG` with
the missing clip's path; there is none today.
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
         "fhsw": ("models/mods/fhsw", "maps/mods/fhsw")}

# tree -> {"Soldier__Weapon": the 1P idle clip the install does not hold}
NO_RIG: dict[str, dict[str, str]] = {}


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
            allowed = {stem.lower() for stem in NO_RIG.get(tree, {})}
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
