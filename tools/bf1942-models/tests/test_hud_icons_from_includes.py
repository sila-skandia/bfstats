"""`extract_hud_pack.py` `objects_con_texts` splices `include`s: FHSW sets the
map symbol of its Bf109-G10 in `Bf109-G/Bf109-G10.inc`, and read without them
the plane drew a grey dot on FHSWEurope's maps. Skips without the install."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402
import extract_hud_pack  # noqa: E402


class HudIconsFromIncludesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not (Path(DEFAULT_GAME_DIR) / "Mods" / "FHSW").is_dir():
            raise unittest.SkipTest("no FHSW install")
        chain = mod_chain(Path(DEFAULT_GAME_DIR), "FHSW")
        cls.icons = extract_hud_pack.minimap_icons_in(extract_hud_pack.objects_con_texts(chain))

    def test_an_icon_set_in_an_include_is_read(self) -> None:
        self.assertEqual("minimap_icon_plane_16x16", self.icons.get("bf109-g10", {}).get("icon"))


if __name__ == "__main__":
    unittest.main()
