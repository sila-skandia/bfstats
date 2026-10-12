"""Every LOD of a static is shaded as one mesh.

The object lightmap belongs to the mesh template and is bound for whichever
LOD is drawn (ledger LM-1), and a mesh's intensity is one number for all of
them (DL-10). `viewer/level-shading.js` bound both onto LOD 0 only, so every
static with a LOD chain changed its shading as the camera crossed a LOD
distance: owner's report 2026-10-12, FHSW Battle of Foy, "objects get
'repainted' as you get up close and become very dark".

Run under node through `level_lod_shading_harness.mjs`.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

HARNESS = HERE / "level_lod_shading_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class LodShadingTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def _every(self, part: str):
        r = self.results[part]
        return r["lod0"] + r["rung1"] + r["rung2"]

    def test_a_lightmap_is_bound_on_every_lod(self) -> None:
        states = self._every("barn")
        self.assertEqual(len(states), 4)
        for s in states:
            self.assertTrue(s["lightMap"], s)
            self.assertIsNone(s["shade"], "a lightmapped mesh takes no TFACTOR stage")

    def test_a_mesh_with_no_second_uv_set_takes_no_lightmap(self) -> None:
        # FHSW's rubble01_m1 under the lightmap Battle of Foy ships for
        # vanilla's: lit and shaded like any other mesh, not sampled at one
        # corner texel.
        for s in self._every("rubble"):
            self.assertFalse(s["lightMap"], s)
            self.assertIsNotNone(s["shade"], s)

    def test_a_lod_whose_lightmap_uvs_are_one_point_is_not_lightmapped(self) -> None:
        # Vanilla's `citymesh3_m1`: every vertex of LODs 1 to 5 has its second
        # UV at 0, 0, the atlas's unlit black corner. Bound, Berlin's city
        # blocks drew black from 15 m (owner's report, 2026-10-12: "certain
        # buildings ... almost black, while the rest of the map ... fine").
        r = self.results["block"]
        self.assertTrue(r["lod0"][0]["lightMap"])
        for s in r["rung1"] + r["rung2"]:
            self.assertFalse(s["lightMap"], s)
            self.assertEqual(s["shade"], [1, 1, 1, 0], "lit, and in the open")

    def test_the_grounds_shade_reaches_every_lod(self) -> None:
        # Ground luminance 40 under Terrain.shadowAmbient 80/90/100.
        want = [round(v / 255, 4) for v in (120, 130, 140)] + [1.0]
        for part in ("well", "rubble"):
            states = self._every(part)
            self.assertEqual(len(states), 4)
            for s in states:
                self.assertEqual(s["shade"], want, (part, s))
        self.assertEqual(self.results["shaded"], 2)


class LightmappedHeaderByteTests(unittest.TestCase):
    """The `.sm` header byte the client loads an object lightmap on (LM-1)."""

    def test_the_byte_is_read(self) -> None:
        import struct

        from bf42 import stdmesh

        def sm(version: int, flag: int | None) -> bytes:
            head = struct.pack("<II6f", version, 0, 0, 0, 0, 1, 1, 1)
            if flag is not None:
                head += bytes([flag])
            return head + struct.pack("<II", 0, 0)   # no collision, no lods

        self.assertTrue(stdmesh.parse(sm(10, 1)).lightmapped)
        self.assertFalse(stdmesh.parse(sm(10, 0)).lightmapped)
        self.assertFalse(stdmesh.parse(sm(9, None)).lightmapped)


if __name__ == "__main__":
    unittest.main()
