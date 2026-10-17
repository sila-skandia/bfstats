"""`extract_map.write_envmap`: the level's reflection cube is what the client
binds.

`ShaderManager.setTextureParam envmap <path>` converts its texture argument
through `TextureManager::getTexture` as the line runs (0x005a82c9 ->
0x005a42d0 -> 0x00643040). The RCM codec (0x00644640) loads each of the six
faces with `loadSurface` (0x00641880): the face's own path in a mounted
archive or under the level folder, the codec extensions probed in order, no
alternative path, no basename. One face that does not load fails the cube,
and the slot holds `texture/defaultTexture`, the one-colour 2D texture the
StandardMesh envmap stage then samples (0x005bfa80..0x005bfdc4). Coral Sea
(`Corall_sea/` faces), Truk (`Piti/`), XPack1's Anzio, FH's Midway, Ramelle
and Seelow and 90 FHSW / FHSWEurope levels draw that grey, not the cube the
exporter used to fill by basename.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map  # noqa: E402
from bf42.rfa import DEFAULT_TEXTURE, ArchivePool, write_rfa  # noqa: E402


def rcm_text(folder: str, stem: str, ext: str = ".dds") -> bytes:
    faces = {"PositiveX": 2, "NegativeX": 4, "PositiveY": 5,
             "NegativeY": 6, "PositiveZ": 1, "NegativeZ": 3}
    lines = ["[CubeMap]"] + [f"{k} = bf1942\\levels\\{folder}\\Textures\\{stem}_{n:02d}{ext}"
                             for k, n in faces.items()]
    return ("\r\n".join(lines) + "\r\n").encode("latin-1")


def faces(level: str, stem: str, ext: str = ".dds") -> dict[str, bytes]:
    return {f"bf1942/levels/{level}/Textures/{stem}_{n:02d}{ext}": f"{stem}{n}".encode()
            for n in range(1, 7)}


class WriteEnvmapTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.out = self.tmp / "out"
        # Every image decodes to one texel whose red channel says which file
        # it was: 1..6 a face of the cube, 76 the default texture.
        def decode(data):
            red = 76 if data == b"grey" else int(data[-1:].decode())
            return 1, 1, bytes([red, 0, 0, 255])
        patcher = mock.patch.object(extract_map, "decode_dds", side_effect=decode)
        patcher.start()
        self.addCleanup(patcher.stop)

    def pool(self, level: str, own: dict[str, bytes],
             others: dict[str, dict[str, bytes]] | None = None,
             alternatives: list[str] | None = None) -> ArchivePool:
        """A level bake's texture pool, as `mount_level_pools` builds it."""
        pool = ArchivePool()
        chain = self.tmp / "texture.rfa"
        write_rfa(chain, {"texture/defaultTexture.dds": b"grey"})
        pool.add(chain)
        for name, files in {level: own, **(others or {})}.items():
            path = self.tmp / f"{name}.rfa"
            write_rfa(path, files)
            pool.add_level(path, label=name)
        pool.set_alternative_paths(alternatives or [])
        pool.set_level_folder(level)
        return pool

    def written_reds(self) -> dict[str, int]:
        from PIL import Image
        return {face: Image.open(self.out / "sky" / f"{face}.png").getpixel((0, 0))[0]
                for face in ("px", "nx", "py", "ny", "pz", "nz")}

    def test_the_level_s_own_cube_loads(self):
        rcm = "bf1942/levels/Wake/Textures/ENVMAP_G_.rcm"
        pool = self.pool("Wake", {rcm: rcm_text("Wake", "env_Wake"),
                                  **faces("Wake", "env_Wake")})
        written, texture = extract_map.write_envmap(pool, self.out, rcm)
        self.assertEqual(rcm, texture)
        self.assertEqual(["sky/px.png", "sky/nx.png", "sky/py.png",
                          "sky/ny.png", "sky/pz.png", "sky/nz.png"], written)
        self.assertEqual({"px": 2, "nx": 4, "py": 5, "ny": 6, "pz": 3, "nz": 1},
                         self.written_reds())

    def test_another_level_s_faces_load_by_their_full_path(self):
        # EoD's M.I.A. names Wake's faces; every level archive is mounted.
        rcm = "bf1942/levels/M_I_A/Textures/ENVMAP_G_.rcm"
        pool = self.pool("M_I_A", {rcm: rcm_text("Wake", "env_Wake")},
                         others={"Wake": faces("Wake", "env_Wake")})
        _written, texture = extract_map.write_envmap(pool, self.out, rcm)
        self.assertEqual(rcm, texture)

    def test_a_misspelt_folder_draws_the_default_texture(self):
        # Coral Sea names `Corall_sea/`; its faces are under `Coral_sea/`
        # and only a basename would find them.
        rcm = "bf1942/levels/Coral_sea/Textures/ENVMAP_G_.rcm"
        pool = self.pool("Coral_sea", {rcm: rcm_text("Corall_sea", "env_Corall"),
                                       **faces("Coral_sea", "env_Corall")})
        written, texture = extract_map.write_envmap(pool, self.out, rcm)
        self.assertEqual(DEFAULT_TEXTURE, texture)
        self.assertEqual(6, len(written))
        self.assertEqual(dict.fromkeys(("px", "nx", "py", "ny", "pz", "nz"), 76),
                         self.written_reds())

    def test_one_missing_face_fails_the_whole_cube(self):
        rcm = "bf1942/levels/Kharkov/Textures/ENVMAP_G_.rcm"
        own = {rcm: rcm_text("Kharkov", "env_Kharkov"), **faces("Kharkov", "env_Kharkov")}
        del own["bf1942/levels/Kharkov/Textures/env_Kharkov_06.dds"]
        _written, texture = extract_map.write_envmap(self.pool("Kharkov", own), self.out, rcm)
        self.assertEqual(DEFAULT_TEXTURE, texture)

    def test_a_face_probes_the_codec_extensions_but_not_the_alternative_paths(self):
        # `.tga` spelled, `.dds` shipped: loadSurface drops the extension.
        rcm = "bf1942/levels/X/Textures/ENVMAP_G_.rcm"
        pool = self.pool("X", {rcm: rcm_text("X", "env", ext=".tga"), **faces("X", "env")})
        self.assertEqual(rcm, extract_map.write_envmap(pool, self.out, rcm)[1])
        # An alternative path holding the faces' leaves never answers a face.
        pool = self.pool("Y", {rcm.replace("/X/", "/Y/"): rcm_text("Gone", "env"),
                               "texture/pacific/env_01.dds": b"1"},
                         alternatives=["Texture/Pacific"])
        self.assertEqual(DEFAULT_TEXTURE, extract_map.write_envmap(
            pool, self.out, rcm.replace("/X/", "/Y/"))[1])

    def test_a_face_the_codec_cannot_read_fails_the_cube(self):
        rcm = "bf1942/levels/X/Textures/ENVMAP_G_.rcm"
        pool = self.pool("X", {rcm: rcm_text("X", "env"), **faces("X", "env")})
        with mock.patch.object(extract_map, "decode_dds",
                               side_effect=[(1, 1, b"\0\0\0\xff")] * 3 + [ValueError("bad")]
                               + [(1, 1, bytes([76, 0, 0, 255]))]):
            _written, texture = extract_map.write_envmap(pool, self.out, rcm)
        self.assertEqual(DEFAULT_TEXTURE, texture)

    def test_an_rcm_nothing_answers_draws_the_default_texture(self):
        # FHSWEurope's Khalkhin Gol: `bf1942\levels\Battle of Khalkhin Gol\...`
        # splits at the first space; Karelia names a folder it never ships.
        pool = self.pool("Karelia", {})
        self.assertEqual(DEFAULT_TEXTURE, extract_map.write_envmap(
            pool, self.out, "Texture/Karelia/ENVMAP_G_.rcm")[1])

    def test_no_cube_named_binds_nothing(self):
        pool = self.pool("X", {"bf1942/levels/X/Textures/ENVMAP_G_.rcm": rcm_text("X", "env"),
                               **faces("X", "env")})
        self.assertEqual((None, None), extract_map.write_envmap(pool, self.out, None))
        self.assertFalse((self.out / "sky").exists())

    def test_the_rcm_walks_only_the_alternative_paths_declared_before_it(self):
        rcm = "bf1942/levels/X/Textures/ENVMAP_G_.rcm"
        own = {rcm: rcm_text("Gone", "env"),
               "bf1942/levels/X/alt/ENVMAP_G_.rcm": rcm_text("X", "env"),
               **faces("X", "env")}
        pool = self.pool("X", own, alternatives=["bf1942/levels/X/alt"])
        # Declared after the envmap line: the level's own (broken) .rcm.
        self.assertEqual(DEFAULT_TEXTURE, extract_map.write_envmap(pool, self.out, rcm, [])[1])
        # Declared before: the alternative path's copy.
        self.assertEqual("bf1942/levels/X/alt/ENVMAP_G_.rcm", extract_map.write_envmap(
            pool, self.out, rcm, ["bf1942/levels/X/alt"])[1])


class EnvmapAlternativePathsTests(unittest.TestCase):
    def test_the_paths_declared_before_the_envmap_line_are_kept(self):
        from bf42.level import LevelInfo, parse_init_con
        info = LevelInfo(name="Truk", terrain=None)
        parse_init_con("textureManager.alternativePath Texture/Pacific\n"
                       "ShaderManager.setTextureParam envmap bf1942\\levels\\Truk\\Textures\\"
                       "ENVMAP_G_.rcm\n"
                       "textureManager.alternativePath bf1942\\levels\\Truk\\Textures\n", info)
        self.assertEqual("bf1942/levels/Truk/Textures/ENVMAP_G_.rcm", info.envmap_rcm)
        self.assertEqual(["Texture/Pacific"], info.envmap_alternative_paths)
        self.assertEqual(2, len(info.texture_alternative_paths))


if __name__ == "__main__":
    unittest.main()
