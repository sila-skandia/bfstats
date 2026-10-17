"""Every weapon a tree's kits hand out that a player raises has its
third-person pose on disk.

The first-person rig (`viewmodels/`) is what the player sees inside; the
pose (`poses/<Soldier>__<Weapon>.pose.glb`, or its split recipe) is what the
bots hold and what the player's own body holds in the chase view on foot
(F10). A pair with a rig and no pose draws the bots with the Colt
(`bot-visuals.js` `BOT_WEAPON`) and leaves the player's third-person body on
the previous weapon (`foot-body.js`).

Both gaps were ours (2026-10-15). `extract_pose.py --kit-poses` posed one
weapon per (soldier, kit), so FHSWEurope's Doomed_Budapest had no
`SVT40Bay`, bayonet knife or `RDG33` pose; and it never read a level's own
weapons, so 203 Hill's Japanese, whose `Arisaka30` only that level declares
and animates, held a Colt. The pipeline's step now passes `--kits --maps`,
which poses every item the exported levels' kits hand out, and poses a
level's own weapons through that level's load.

The pairs are `kit_pairs` over the exported levels, the same the rigs are
built for; a pair with no rig is the rig test's business
(`test_viewmodel_rigs_on_disk`). A pair the game gives no third-person stand
pose goes in `NO_POSE` with the reason. A tree not re-extracted since lists
what it still lacks in `PENDING`.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from extract_pose import kit_pairs
from tests.test_viewmodel_rigs_on_disk import TREES
from tests.test_weapon_sounds_on_disk import ASSETS

# tree -> {"Soldier__Weapon": why the game gives it no third-person pose}
_RPG29 = ("latakia-2016's states copy the Panzershreck's with "
          "3p/Panzershreck/3PStandAimUpperPanzershreck.baf, which no archive holds "
          "(ANIM-16 drops it); the first-person clip survives")
NO_POSE: dict[str, dict[str, str]] = {"fhsweurope": {
    "GermanSoldier__RPG29": _RPG29, "RussianSoldier__RPG29": _RPG29}}

# tree -> the poses it lacked when every kit item was first asked for
# (2026-10-15), until its poses_kit step runs:
# `mod_pipeline.py run --mod <M> --only-steps poses_kit --force-steps`.
PENDING: dict[str, set[str]] = {}


def pose_stems(poses: Path) -> set[str]:
    index = json.loads((poses / "index.json").read_text())
    if isinstance(index, dict):
        stems = [*index.get("glb", []), *index.get("recipe", [])]
    else:
        stems = list(index)
    return {stem.lower() for stem in stems}


# Trees whose poses_kit step has not run since a dropped kit's pairs were
# asked for (2026-10-17, KITDROP-6: every team soldier of a level holding
# every item its kits hand out). Their kits' own pairs are still checked.
# Drop a tree from the set once its step has run.
DROPPED_PENDING: set[str] = {"vanilla", "xpack1", "xpack2", "fh", "fhsw", "fhsweurope"}


def missing_poses(models: Path, maps: Path, dropped: bool = True) -> list[str]:
    kits = json.loads((models / "kits.json").read_text())
    levels = {entry["name"].lower()
              for entry in json.loads((maps / "maps.json").read_text())}
    rigs = {stem.lower() for stem in
            json.loads((models / "viewmodels" / "index.json").read_text())}
    poses = pose_stems(models / "poses")
    loadouts_path = maps / "_shared" / "loadouts.json"
    loadouts = (json.loads(loadouts_path.read_text())
                if dropped and loadouts_path.exists() else None)
    return sorted({f"{soldier}__{weapon}" for soldier, weapon
                   in kit_pairs(kits, levels, loadouts)
                   if f"{soldier}__{weapon}".lower() in rigs
                   and f"{soldier}__{weapon}".lower() not in poses}, key=str.lower)


@unittest.skipUnless(ASSETS, "no extracted viewer assets on this machine")
class KitPosesOnDiskTests(unittest.TestCase):
    def test_every_raised_kit_item_of_a_baked_level_has_a_pose(self) -> None:
        checked = 0
        for tree, (models, maps) in TREES.items():
            models, maps = ASSETS / models, ASSETS / maps
            if not all(path.exists() for path in (
                    models / "kits.json", maps / "maps.json",
                    models / "viewmodels" / "index.json", models / "poses" / "index.json")):
                continue
            checked += 1
            allowed = {stem.lower() for stem in NO_POSE.get(tree, {})}
            allowed |= PENDING.get(tree, set())
            missing = [stem for stem in missing_poses(models, maps,
                                                      tree not in DROPPED_PENDING)
                       if stem.lower() not in allowed]
            with self.subTest(tree=tree):
                self.assertEqual([], missing,
                                 f"{tree}: kit items with a first-person rig and no "
                                 "third-person pose; run the tree's poses_kit step "
                                 "(mod_pipeline.py run --mod <M> --only-steps poses_kit "
                                 "--force-steps)")
        if not checked:
            self.skipTest("no tree with kits.json, maps.json, viewmodels/ and poses/")


if __name__ == "__main__":
    unittest.main()
