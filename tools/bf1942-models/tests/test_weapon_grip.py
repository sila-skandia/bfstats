# watches: tools/bf1942-models/bf42/pose.py tools/bf1942-models/bf42/assemble.py tools/bf1942-models/bf42/ske.py
"""A hand weapon's bound parts against its own geometry (`pose.hand_weapon_part`).

A pose's grip hangs the weapon from a clip-posed hand as `W . CLIP_WORLD_YAW`
(`pose.weapon_attachment(clip_posed=True)`), which is how the weapon's
geometry meets its skeleton. A part bound to a weapon bone has to land where
welding the weapon at that bone would put it, which is the part's parsed
transform conjugated by the X mirror; the model extractor places every hand
weapon's parts so (`assemble.is_hand_weapon_skeleton`). Secret Weapons' knives
hang their whole blade off `Mag`, 6 cm to the side of the `Base` they are
welded by: without it the blade lay 10.5 cm from the right palm, up the
sleeve.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bf42 import pose  # noqa: E402

GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"


def close(a, b, tol=1e-6) -> bool:
    if isinstance(a, (int, float)):
        return abs(a - b) <= tol
    return all(close(x, y, tol) for x, y in zip(a, b))


class HandWeaponPartTests(unittest.TestCase):
    def test_it_is_the_x_mirror_conjugation(self) -> None:
        rotation = ((0.0, -1.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0))
        r, t = pose.hand_weapon_part((rotation, (0.1, 0.2, 0.3)))
        self.assertEqual(t, (-0.1, 0.2, 0.3))
        # A turn about Z reverses; X's row and column flip, their corner stays.
        self.assertEqual(r, ((0.0, 1.0, 0.0), (-1.0, 0.0, 0.0), (0.0, 0.0, 1.0)))

    def test_twice_is_nothing(self) -> None:
        rt = (((0.6, 0.0, 0.8), (0.0, 1.0, 0.0), (-0.8, 0.0, 0.6)), (0.3, -0.2, 0.1))
        self.assertTrue(close(pose.hand_weapon_part(pose.hand_weapon_part(rt))[0], rt[0]))
        self.assertTrue(close(pose.hand_weapon_part(pose.hand_weapon_part(rt))[1], rt[1]))


class WeldAtTheBoneTests(unittest.TestCase):
    """The grip's weld times a part under it is the weld at the part's bone."""

    CASES = [
        ("XPack2", "Animations/EliteKnife.ske", "Base", "Mag"),
        ("XPack2", "Animations/CommandoKnife.ske", "Base", "Mag"),
        ("bf1942", "animations/JohnsonLMG.ske", None, "Mag"),
    ]

    def test_a_part_lands_where_its_own_bone_would_weld_it(self) -> None:
        from bf42.rfa import RfaArchive
        from bf42 import ske
        checked = 0
        for mod, path, main_name, bone in self.CASES:
            archive = GAME_DIR / "Mods" / mod / "Archives" / "Animations.rfa"
            if not archive.is_file():
                continue
            rfa = RfaArchive(str(archive))
            name = next((e for e in rfa.entries if str(e).lower() == path.lower()), None)
            if name is None:
                continue
            skeleton = ske.parse(rfa.read(name), name)
            main = skeleton.main_index(main_name, None)
            part = skeleton.index(bone)
            grip = pose.weapon_attachment(skeleton, main, clip_posed=True)
            under = pose.rt_mul(grip, pose.hand_weapon_part(skeleton.relative(part, main)))
            at_bone = pose.weapon_attachment(skeleton, part, clip_posed=True)
            with self.subTest(path):
                self.assertTrue(close(under[0], at_bone[0], 1e-5))
                self.assertTrue(close(under[1], at_bone[1], 1e-5))
                # Without it the part is mirrored in x: the knife's blade by
                # 13 cm, the Johnson's side magazine by 21 cm.
                plain = pose.rt_mul(grip, skeleton.relative(part, main))
                moved = sum((a - b) ** 2 for a, b in zip(plain[1], at_bone[1])) ** 0.5
                self.assertGreater(moved, 0.1)
            checked += 1
        if not checked:
            self.skipTest("no BF1942 install with these archives")



class ExtractedKnifeTests(unittest.TestCase):
    """The model extractor places the knife's blade with the rule."""

    def test_the_blade_node_is_where_the_engine_draws_it(self) -> None:
        import json
        import struct
        import subprocess
        import tempfile
        if not (GAME_DIR / "Mods" / "XPack2" / "Archives" / "Objects.rfa").is_file():
            self.skipTest("no Secret Weapons install")
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([sys.executable, str(ROOT / "extract_models.py"), "--mod", "XPack2",
                            "--out", tmp, "EliteKnife"], check=True, capture_output=True)
            data = (Path(tmp) / "EliteKnife.glb").read_bytes()
        length = struct.unpack("<I", data[12:16])[0]
        doc = json.loads(data[20:20 + length])
        node = next(n for n in doc["nodes"] if n.get("extras", {}).get("boundBone") == "Mag")
        # `Mag` from `Base`, parsed: (0.0633, 0.0147, 0.1022); the rule
        # negates x, and the glTF mirror z: the blade on the hand's palm side.
        self.assertTrue(close(node["translation"], [-0.0633, 0.0147, -0.1022], 1e-3))
        # Marked, so `patch_weapon_parts.py` leaves it alone.
        self.assertTrue(node["extras"].get("handWeaponPart"))


if __name__ == "__main__":
    unittest.main()
