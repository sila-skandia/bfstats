"""A level bake keeps every texel the retail packs ship (features/retail-look-parity).

The three retail packs hold 2492 .dds textures, the largest 1024 pixels on a
side (153 of them; 651 are 512). The level bake's cap was 512, which halved
every 1024 terrain tile (4 texels a metre in retail, 2 in the bake) and every
1024 vehicle texture a level placed. Measured on Wake, El Alamein, Berlin and
Kursk: all their 1024 tiles and 11 to 14 object textures each.
"""
import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
RETAIL_LARGEST_TEXTURE = 1024


def default_of(path: str) -> int:
    text = (HERE / path).read_text()
    m = re.search(r'"--max-texture",\s*type=int,\s*default=(\d+)', text)
    assert m, f"{path} has no --max-texture default"
    return int(m.group(1))


class TextureCapTest(unittest.TestCase):
    def test_the_level_bake_does_not_halve_a_retail_texture(self) -> None:
        for path in ("extract_map.py", "extract_maps_all.py", "extract_effects.py"):
            with self.subTest(path):
                self.assertGreaterEqual(default_of(path), RETAIL_LARGEST_TEXTURE)


if __name__ == "__main__":
    unittest.main()
