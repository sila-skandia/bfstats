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

A rolled kit item (`Random*` with `setRandomGeometries N`) is never a pair:
the engine never makes the bundle, only `<bundle><counter>` (ledger KIT-1,
`BundleTemplate::addBundleChilds` lnxded `0x081a8300`), and the page rolls
the same way (`viewer/random-items.js`), so each variant is asked for. That
holds for a level copy's items too (2026-10-17: FHSW's Kiew and Berlin
Outskirts copies were asked for `RandomP08P38`, `RandomSmokeItem4Ger` and
`RandomSmokeItem4RDG2` themselves).
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from bf42.glbstore import rig_index_pairs, rig_index_stems, rig_pair_stems
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

# tree -> the rigs it lacks until its viewmodels step next runs
# (`mod_pipeline.py run --mod <M> --only-steps viewmodels --force-steps`).
# Every rig the 2026-10-15 list named was written by the 2026-10-17 run. What
# is left is what a level copy's rolled item hands out, asked for since
# 2026-10-17 instead of the bundle (KIT-1, `extract_pose.kit_pair_levels`):
# FHSW's Kiew copy of `4German_OfficerMp40` rolls `RandomP08P381..3` and
# `RandomSmokeItem4Ger1..6`, and the kit's pad soldiers (the British, who take
# it on Operation_Rattrap) are asked for them as they are for its own items.
PENDING: dict[str, set[str]] = {"fhsw": {
    *(f"britishsoldier__randomp08p38{n}" for n in range(1, 4)),
    *(f"britishsoldier__randomsmokeitem4ger{n}" for n in range(1, 7)),
}}


# Trees whose viewmodels step has not run since a dropped kit's pairs were
# asked for (2026-10-17, KITDROP-6: every team soldier of a level with every
# item its kits hand out; 2,028 rigs across the six trees). Their kits' own
# pairs are still checked. Drop a tree from the set once its step has run.
DROPPED_PENDING: set[str] = {"fhsweurope"}   # its viewmodels/poses_kit step is still running


def missing_rigs(models: Path, maps: Path, dropped: bool = True) -> list[str]:
    """The pairs with no rig: the kits' own, and with `dropped` (and a
    `_shared/loadouts.json`) each level's team soldiers holding whatever any
    of its kits hands out (KITDROP-6). Pairs the extractor recorded in
    `absent.json` are exempt, as the kits audit exempts them: the ENGINE
    deletes their cloned states (ANIM-16), so retail shows the bare pose and
    no rig is owed (battle_of_palembang's Deploy_47mmType1mobile)."""
    kits = json.loads((models / "kits.json").read_text())
    levels = {entry["name"].lower()
              for entry in json.loads((maps / "maps.json").read_text())}
    # A pair is covered by its own rig file or by a painted `pairs` row (one
    # rig a weapon, bf1942-rig-index/2): either way it has arms.
    index = {stem.lower() for stem in rig_pair_stems(
        json.loads((models / "viewmodels" / "index.json").read_text()))}
    try:
        index |= {f"{r['soldier']}__{r['weapon']}".lower() for r in
                  json.loads((models / "viewmodels" / "absent.json").read_text())}
    except (OSError, ValueError, KeyError, TypeError):
        pass
    loadouts_path = maps / "_shared" / "loadouts.json"
    loadouts = (json.loads(loadouts_path.read_text())
                if dropped and loadouts_path.exists() else None)
    return [f"{soldier}__{weapon}" for soldier, weapon in kit_pairs(kits, levels, loadouts)
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
            # The engine itself deletes these rigs' state clones (ANIM-16); the
            # extractor records them beside the index.
            absent = models / "viewmodels" / "absent.json"
            if absent.exists():
                allowed |= {f"{row['soldier']}__{row['weapon']}".lower()
                            for row in json.loads(absent.read_text())}
            missing = [stem for stem in missing_rigs(models, maps,
                                                     tree not in DROPPED_PENDING)
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
            doc = json.loads((folder / "index.json").read_text())
            gone = [stem for stem in rig_index_stems(doc)
                    if not (folder / f"{stem}.fp.glb").exists()]
            # ... and every painted pair's target and skin are files too.
            stems = {stem.lower() for stem in rig_index_stems(doc)}
            for pair, row in rig_index_pairs(doc).items():
                if row["rig"].lower() not in stems:
                    gone.append(f"{pair} -> {row['rig']}")
                if row.get("skin") and not (folder / str(row["skin"])).exists():
                    gone.append(f"{pair} -> {row['skin']}")
            with self.subTest(tree=tree):
                self.assertEqual([], gone)


if __name__ == "__main__":
    unittest.main()
