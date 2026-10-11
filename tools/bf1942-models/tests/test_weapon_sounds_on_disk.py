"""Every sample a tree's `sounds/weapons.json` names is on disk.

`extract_weapon_sounds.py` writes a weapon's report, its `layers`, its
`randomPlay` variants (`<Name>.<n>.mp3`) and its press/release/reload picks next
to the manifest. A narrow install by hand (copy the manifest entry and the base
mp3) left SW's knife stabs and RtR's bayonet stabs naming ten files that were
never copied; the viewer fetched 404s and played silence for the roll.

Trees checked: vanilla (`models/sounds`), XPack1 and XPack2 (`models/mods/*/
sounds`); the assets are found as `test_sim_vehicles.py` finds them.
"""

from __future__ import annotations

import json
import os
import subprocess
import unittest
from pathlib import Path

import extract_weapon_sounds as ews

ROOT = Path(__file__).resolve().parent.parent


def find_assets() -> Path | None:
    candidates: list[Path] = []
    if os.environ.get("BF42_VIEWER_ASSETS"):
        candidates.append(Path(os.environ["BF42_VIEWER_ASSETS"]))
    candidates.append(ROOT / "viewer")
    try:
        common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=ROOT,
                                capture_output=True, text=True, timeout=10).stdout.strip()
        if common:
            candidates.append(Path(common).parent / "tools" / "bf1942-models" / "viewer")
    except (OSError, subprocess.SubprocessError):
        pass
    for c in candidates:
        if (c / "models" / "sounds" / "weapons.json").exists():
            return c
    return None


ASSETS = find_assets()
TREES = {"vanilla": "models/sounds", "xpack1": "models/mods/xpack1/sounds",
         "xpack2": "models/mods/xpack2/sounds"}


def named_samples(node, out: set[str]) -> set[str]:
    """Every string in the manifest that names an mp3."""
    if isinstance(node, dict):
        for value in node.values():
            named_samples(value, out)
    elif isinstance(node, list):
        for value in node:
            named_samples(value, out)
    elif isinstance(node, str) and node.lower().endswith(".mp3"):
        out.add(node)
    return out


@unittest.skipIf(ASSETS is None, "no extracted viewer/models tree (set BF42_VIEWER_ASSETS)")
class WeaponSamplesOnDiskTests(unittest.TestCase):
    def test_every_named_sample_exists(self) -> None:
        checked = 0
        for tree, rel in TREES.items():
            folder = ASSETS / rel
            manifest = folder / "weapons.json"
            if not manifest.exists():
                continue
            with self.subTest(tree=tree):
                names = named_samples(json.loads(manifest.read_text()), set())
                missing = sorted(n for n in names if not (folder / n).exists())
                self.assertEqual([], missing, f"{tree}: {len(missing)} named samples are not on disk")
                checked += 1
        self.assertGreater(checked, 0)


class NarrowRunKeepsTheManifestTests(unittest.TestCase):
    """A run for named weapons merges into the manifest instead of replacing
    it (`merge_manifest`)."""

    def test_the_weapons_not_asked_for_keep_their_entries(self) -> None:
        before = {"A": {"file": "A.mp3"}, "B": {"file": "B.mp3"}}
        weapons, silent = ews.merge_manifest(before, {"Q": "no script"}, {"B": {"file": "B2.mp3"}}, {})
        self.assertEqual({"A": {"file": "A.mp3"}, "B": {"file": "B2.mp3"}}, weapons)
        self.assertEqual({"Q": "no script"}, silent)

    def test_a_weapon_now_quiet_leaves_the_loud_list(self) -> None:
        weapons, silent = ews.merge_manifest({"A": {"file": "A.mp3"}}, {}, {}, {"A": "no wav"})
        self.assertEqual({}, weapons)
        self.assertEqual({"A": "no wav"}, silent)

    def test_a_weapon_now_loud_leaves_the_quiet_list(self) -> None:
        weapons, silent = ews.merge_manifest({}, {"A": "no wav"}, {"A": {"file": "A.mp3"}}, {})
        self.assertEqual({"A": {"file": "A.mp3"}}, weapons)
        self.assertEqual({}, silent)


if __name__ == "__main__":
    unittest.main()
