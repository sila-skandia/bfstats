"""`viewer/texture-url.js`: content-addressed textures are asked for by an
epoch URL, so a 404 the edge cached before a texture was published is never
read again (2026-11-13, production's white terrain)."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "viewer" / "texture-url.js"
NGINX = ROOT.parents[1] / "mesh" / "nginx.conf"

SCRIPT = """
const m = await import(process.argv[1]);
const urls = [
  'https://mesh.bfstats.io/textures/31/31d2c6da93720189d9a4571fdad88b68.webp',
  '/maps/wake/../../textures/0a/0a1b2c3d4e5f60718293a4b5c6d7e8f9.png',
  'https://mesh.bfstats.io/textures/31/31d2c6da93720189d9a4571fdad88b68.webp?r=2',
  'https://mesh.bfstats.io/maps/wake/scene.glb',
  'https://mesh.bfstats.io/textures/readme.txt',
  'data:image/png;base64,AAAA',
];
let set = null;
const manager = { setURLModifier(f) { set = f; } };
m.withTextureEpoch(manager);
m.withTextureEpoch(manager);
process.stdout.write(JSON.stringify({ epoch: m.TEXTURE_EPOCH, out: urls.map(m.textureUrl),
  viaManager: set ? set(urls[0]) : null, marked: manager.__textureEpoch === true }));
"""


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class TextureUrlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", "--input-type=module", "-e", SCRIPT, str(MODULE)],
                              capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_content_addressed_texture_gets_the_epoch(self) -> None:
        out = self.r["out"]
        self.assertEqual(out[0], "https://mesh.bfstats.io/textures/31/31d2c6da93720189d9a4571fdad88b68.webp?r=2")
        self.assertTrue(out[1].endswith(".png?r=2"))

    def test_anything_else_is_untouched(self) -> None:
        out = self.r["out"]
        self.assertTrue(out[2].endswith("?r=2") and out[2].count("?") == 1, "no second query")
        self.assertEqual(out[3], "https://mesh.bfstats.io/maps/wake/scene.glb")
        self.assertEqual(out[4], "https://mesh.bfstats.io/textures/readme.txt")
        self.assertEqual(out[5], "data:image/png;base64,AAAA")

    def test_the_loaders_manager_resolves_through_it(self) -> None:
        self.assertTrue(self.r["marked"])
        self.assertTrue(self.r["viaManager"].endswith("?r=2"))


class NginxKeepsNo404Tests(unittest.TestCase):
    def test_textures_and_glbs_send_their_year_long_header_on_success_only(self) -> None:
        text = NGINX.read_text()
        for location in ("location /textures/ {", "location /glbs/ {"):
            block = text[text.index(location):text.index("}", text.index(location))]
            line = next(l for l in block.splitlines() if "add_header Cache-Control" in l)
            self.assertIn("immutable", line, location)
            self.assertNotIn("always", line, f"{location}: a 404 must not carry the year")


if __name__ == "__main__":
    unittest.main()
