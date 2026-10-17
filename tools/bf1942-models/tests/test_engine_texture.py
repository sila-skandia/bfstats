"""A texture resolves only by the routes the client's TextureManager has.

`ArchivePool.engine_texture` is the client's load (0x006429d0, 0x00642340):
the extensions of its codec set in order (`.bmp`, `.dds`, `.rcm`, `.tga`), a
`fileExists` on each that tries the mounted archives and then the level folder
on the search path, and only for a name that exists the walk of the level's
alternative paths. A name nothing answers is drawn with
`texture/defaultTexture` (`getTexture` 0x00643040), which the level bake now
draws too (`Assembler(engine_textures=True)`).
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from bf42.rfa import DEFAULT_TEXTURE, ArchivePool, write_rfa  # noqa: E402


class EngineTextureTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _rfa(self, name: str, files: dict[str, bytes]) -> Path:
        path = self.tmp / name
        write_rfa(path, files)
        return path

    def _pool(self, chain: dict[str, bytes], level: dict[str, bytes] | None = None,
              others: dict[str, dict[str, bytes]] | None = None,
              alternatives: list[str] | None = None) -> ArchivePool:
        """A level bake's texture pool, built as `mount_level_pools` builds it."""
        pool = ArchivePool()
        pool.add(self._rfa("texture.rfa", chain))
        if level is not None:
            pool.add_level(self._rfa("Tobruk.rfa", level), label="Tobruk")
        for name, files in (others or {}).items():
            path = self._rfa(f"{name}.rfa", files)
            pool.add_level(path, label=name)
            pool.mount_level(path, (".dds", ".tga"))
        pool.set_alternative_paths(alternatives or [])
        pool.set_level_folder("Tobruk")
        return pool

    def test_the_chain_answers_by_its_path(self) -> None:
        pool = self._pool({"texture/sherma_i.dds": b"d"})
        self.assertEqual(pool.engine_texture("texture/Sherma_I"), "texture/sherma_i.dds")

    def test_the_spelled_extension_is_dropped_and_dds_comes_before_tga(self) -> None:
        # FH's su76m_gun shader spells `.tga`; the archive ships the `.dds`.
        pool = self._pool({"texture/su_76msummer.dds": b"d",
                           "texture/two.tga": b"t", "texture/two.dds": b"d"})
        self.assertEqual(pool.engine_texture("texture/SU_76MSummer.tga"),
                         "texture/su_76msummer.dds")
        self.assertEqual(pool.engine_texture("texture/two.tga"), "texture/two.dds")

    def test_a_bmp_is_tried_before_the_dds(self) -> None:
        pool = self._pool({"texture/x.bmp": b"b", "texture/x.dds": b"d"})
        self.assertEqual(pool.engine_texture("texture/x"), "texture/x.bmp")

    def test_the_level_folder_fills_a_name_the_chain_lacks(self) -> None:
        pool = self._pool({}, level={"bf1942/levels/Tobruk/Texture/tobruk_sign.dds": b"d"})
        self.assertEqual(pool.engine_texture("texture/tobruk_sign"),
                         "bf1942/levels/Tobruk/Texture/tobruk_sign.dds")

    def test_the_chain_wins_a_name_the_level_folder_also_ships(self) -> None:
        pool = self._pool({"texture/sky.dds": b"chain"},
                          level={"bf1942/levels/Tobruk/texture/sky.dds": b"level"})
        self.assertEqual(pool.engine_texture("texture/sky"), "texture/sky.dds")

    def test_alttextures_textures_and_nested_folders_answer_nothing_by_themselves(self) -> None:
        pool = self._pool({}, level={
            "bf1942/levels/Tobruk/AltTextures/p4main_f.dds": b"a",
            "bf1942/levels/Tobruk/Textures/wall.dds": b"t",
            "bf1942/levels/Tobruk/Custom Textures/crate.dds": b"c",
            "bf1942/levels/Tobruk/Texture/Africa/sherma_i.dds": b"n",
        })
        for name in ("texture/p4main_f", "texture/wall", "texture/crate", "texture/sherma_i"):
            # The exporter's fill-in found them; the game draws the default.
            self.assertIsNotNone(pool.resolve_ext(name, (".dds", ".tga")), name)
            self.assertIsNone(pool.engine_texture(name), name)

    def test_another_level_s_texture_folder_answers_nothing(self) -> None:
        pool = self._pool({}, others={"Kursk": {"bf1942/levels/Kursk/Texture/t34_b.dds": b"k"}})
        self.assertIsNotNone(pool.resolve_ext("texture/t34_b", (".dds", ".tga")))
        self.assertIsNone(pool.engine_texture("texture/t34_b"))
        # By its full path it opens, as `.rs` files and alternative paths name it.
        self.assertEqual(pool.engine_texture("bf1942/levels/Kursk/Texture/t34_b"),
                         "bf1942/levels/Kursk/Texture/t34_b.dds")

    def test_an_alternative_path_repaints_a_texture_the_game_has(self) -> None:
        # Tobruk's `Texture/Africa`: the desert Sherman over the chain's.
        pool = self._pool({"texture/sherma_i.dds": b"green",
                           "texture/africa/sherma_i.dds": b"desert"},
                          alternatives=["Texture/Africa"])
        self.assertEqual(pool.engine_texture("texture/Sherma_I"), "texture/africa/sherma_i.dds")

    def test_an_alternative_path_never_supplies_a_texture_the_game_lacks(self) -> None:
        pool = self._pool({"texture/africa/sherw2_f.dds": b"desert"},
                          alternatives=["Texture/Africa"])
        self.assertEqual(pool.resolve_ext("texture/sherW2_f", (".dds", ".tga")),
                         "texture/africa/sherw2_f.dds")
        self.assertIsNone(pool.engine_texture("texture/sherW2_f"))

    def test_an_alternative_path_reaches_a_level_folder(self) -> None:
        # FHSW names `bf1942/levels/_TEXTURE_SPECIAL/texture/...` folders.
        pool = self._pool({"texture/hand01.dds": b"bare"}, others={"_TEXTURE_SPECIAL": {
            "bf1942/levels/_TEXTURE_SPECIAL/texture/winter/hand01.dds": b"glove"}},
            alternatives=["bf1942/levels/_TEXTURE_SPECIAL/texture/winter/"])
        self.assertEqual(pool.engine_texture("texture/hand01"),
                         "bf1942/levels/_TEXTURE_SPECIAL/texture/winter/hand01.dds")

    def test_no_basename_or_prefix_fallback(self) -> None:
        pool = self._pool({"texture/ItalyBritts/britt1_r.dds": b"n",
                           "texture/fh_pahile_c.dds": b"p"})
        self.assertIsNotNone(pool.resolve_ext("texture/britt1_r", (".dds", ".tga")))
        self.assertIsNotNone(pool.resolve_ext("texture/pahile_c", (".dds", ".tga")))
        self.assertIsNone(pool.engine_texture("texture/britt1_r"))
        self.assertIsNone(pool.engine_texture("texture/pahile_c"))

    def test_a_fallback_mod_outside_the_chain_is_not_mounted(self) -> None:
        pool = ArchivePool()
        pool.add(self._rfa("texture.rfa", {}))
        pool.add(self._rfa("fh_texture.rfa", {"texture/palm.dds": b"p"}), mounted=False)
        self.assertIsNotNone(pool.resolve_ext("texture/palm", (".dds", ".tga")))
        self.assertIsNone(pool.engine_texture("texture/palm"))

    def test_the_default_texture_is_vanilla_s(self) -> None:
        pool = self._pool({"texture/defaultTexture.dds": b"grey"})
        self.assertEqual(pool.engine_texture(DEFAULT_TEXTURE), "texture/defaultTexture.dds")

    def test_a_mesh_archive_image_opens_by_its_path(self) -> None:
        meshes = ArchivePool()
        meshes.add(self._rfa("treeMesh.rfa", {"treeMesh/Billboards/palm.dds": b"b"}))
        pool = self._pool({})
        pool.absorb_images(meshes)
        self.assertEqual(pool.engine_texture("treeMesh/Billboards/palm"),
                         "treeMesh/Billboards/palm.dds")
        self.assertIsNone(pool.engine_texture("texture/palm"))


def _tga(rgba: bytes) -> bytes:
    """A 1 x 1 uncompressed 32-bit TGA of one BGRA pixel."""
    r, g, b, a = rgba
    return bytes([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 32, 8, b, g, r, a])


class LevelBakeDefaultTextureTests(unittest.TestCase):
    """A level bake's material draws what the client draws."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _assembler(self, engine: bool):
        from bf42 import con as con_mod
        from bf42.assemble import Assembler
        path = self.tmp / "texture.rfa"
        write_rfa(path, {"texture/defaultTexture.tga": _tga(b"\x4c\x48\x4a\xff"),
                         "texture/africa/sherw2_f.tga": _tga(b"\xc0\xa0\x60\xff")})
        textures = ArchivePool()
        textures.add(path)
        textures.set_alternative_paths(["Texture/Africa"])
        textures.set_level_folder("Tobruk")
        assembler = Assembler(ArchivePool(), textures, ArchivePool(), con_mod.ObjectLibrary())
        assembler.engine_textures = engine
        return assembler

    def test_a_missing_texture_draws_the_default_texture(self) -> None:
        from bf42 import gltf
        from bf42.assemble import Report
        assembler = self._assembler(engine=True)
        builder, report = gltf.GlbBuilder(), Report(root="x", configuration="complex", lod=0)
        index = assembler._texture_index(builder, "texture/sherW2_f", report)
        self.assertIsNotNone(index)
        self.assertEqual(index, assembler._texture_index(builder, "texture/pf_w2_r", report))
        self.assertEqual(index, assembler._texture_cache[DEFAULT_TEXTURE])
        # Still reported as a miss, for the audits.
        self.assertEqual(report.missing_textures, ["texture/sherW2_f", "texture/pf_w2_r"])

    def test_a_sky_face_takes_the_level_s_special_sky_or_the_default(self) -> None:
        # FHSW's Battle for Ortona: `textureManager.alternativePath
        # texture/SPECIAL_sky` reaches the level's own texture/Special_Sky/.
        import extract_map as em
        path = self.tmp / "texture.rfa"
        write_rfa(path, {"texture/defaultTexture.tga": _tga(b"\x4c\x48\x4a\xff"),
                         "texture/Sky_IwoJima_03.tga": _tga(b"\x60\x80\xc0\xff")})
        level = self.tmp / "Battle_for_ortona-1943.rfa"
        write_rfa(level, {"bf1942/levels/Battle_for_ortona-1943/texture/Special_Sky/"
                          "Sky_IwoJima_03.tga": _tga(b"\x90\x90\x90\xff")})
        textures = ArchivePool()
        textures.add(path)
        textures.add_level(level, label="Battle_for_ortona-1943")
        textures.set_alternative_paths(["texture/SPECIAL_sky"])
        textures.set_level_folder("Battle_for_ortona-1943")
        _w, _h, rgba = em._decode_pool_image(textures, "texture/Sky_IwoJima_03", engine=True)
        self.assertEqual(tuple(rgba[:3]), (0x90, 0x90, 0x90))
        _w, _h, rgba = em._decode_pool_image(textures, "texture/Sky_Gone_01", engine=True)
        self.assertEqual(tuple(rgba[:3]), (0x4c, 0x48, 0x4a))
        # The old lookup kept the chain's face.
        _w, _h, rgba = em._decode_pool_image(textures, "texture/Sky_IwoJima_03")
        self.assertEqual(tuple(rgba[:3]), (0x60, 0x80, 0xc0))

    def test_a_model_export_keeps_the_pool_s_own_lookup(self) -> None:
        from bf42 import gltf
        from bf42.assemble import Report
        assembler = self._assembler(engine=False)
        builder, report = gltf.GlbBuilder(), Report(root="x", configuration="complex", lod=0)
        assembler._texture_index(builder, "texture/sherW2_f", report)
        self.assertEqual(report.resolved_textures["texture/sherW2_f"],
                         "texture.rfa:texture/africa/sherw2_f.tga")


if __name__ == "__main__":
    unittest.main()
