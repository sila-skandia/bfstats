from __future__ import annotations

import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import merge_scratch_models as m  # noqa: E402


def glb(uris: list[str], marker: bytes = b"") -> bytes:
    doc = json.dumps({"asset": {"version": "2.0"},
                      "images": [{"uri": u} for u in uris]}).encode()
    doc += b" " * (-len(doc) % 4)
    return (b"glTF" + struct.pack("<II", 2, 12 + 8 + len(doc))
            + struct.pack("<I", len(doc)) + b"JSON" + doc + marker)


def row(name: str, category: str = "land", thumb: str | None = None,
        variants: tuple[str, ...] = ()) -> dict:
    out = {"name": name, "category": category, "glb": f"{name}.glb",
           "report": f"{name}.report.json",
           "variants": [{"glb": f"{name}.glb", "report": f"{name}.report.json"},
                        *({"glb": v, "report": v[:-4] + ".report.json"} for v in variants)]}
    if thumb:
        out["thumb"] = thumb
    return out


class Fixture:
    def __init__(self, tmp: str) -> None:
        root = Path(tmp)
        self.tree = root / "viewer" / "models" / "mods" / "xpack2"
        self.store = root / "viewer" / "textures"
        self.scratch = root / "scratch" / "models" / "mods" / "xpack2"
        self.scratch_store = root / "scratch" / "textures"
        for d in (self.tree, self.store, self.scratch, self.scratch_store):
            d.mkdir(parents=True)

    def texture(self, store: Path, rel: str, data: bytes = b"webp") -> str:
        p = store / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return f"../../../textures/{rel}"

    def write(self, base: Path, name: str, uris=(), marker=b"") -> None:
        (base / name).write_bytes(glb(list(uris), marker))
        (base / (name + ".gz")).write_bytes(b"gz" + marker)
        (base / (name[:-4] + ".report.json")).write_text("{}")


class MergeTests(unittest.TestCase):
    def test_only_missing_templates_are_added_and_existing_files_are_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fx = Fixture(tmp)
            u_old = fx.texture(fx.store, "aa/old.webp")
            u_new = fx.texture(fx.scratch_store, "bb/new.webp", b"new")
            # the tree: Flettner, with a thumb and a level variant another
            # session added
            fx.write(fx.tree, "Flettner.glb", [u_old], b"mine")
            fx.write(fx.tree, "Flettner.Raid_on_Agheila.glb", [u_old], b"theirs")
            (fx.tree / "models.json").write_text(json.dumps(
                [row("Flettner", "air", "thumbs/flettner.png", ("Flettner.Raid_on_Agheila.glb",))]))
            # the scratch: Flettner (different bytes: not to be written), Willy
            fx.write(fx.scratch, "Flettner.glb", [u_old], b"scratch")
            fx.write(fx.scratch, "Willy.glb", [u_new], b"willy")
            fx.write(fx.scratch, "Willy.wreck.glb", [u_old])
            (fx.scratch / "models.json").write_text(json.dumps(
                [row("Flettner", "air"), row("Willy", "land", variants=("Willy.wreck.glb",))]))

            dry = m.merge(fx.tree, fx.scratch, fx.store, fx.scratch_store)
            self.assertEqual(1, dry["rows"])
            self.assertEqual(1, dry["textures"])
            self.assertFalse((fx.tree / "Willy.glb").exists(), "a dry run writes nothing")

            done = m.merge(fx.tree, fx.scratch, fx.store, fx.scratch_store, apply=True)
            self.assertEqual(2, done["written"])
            self.assertEqual(b"mine", (fx.tree / "Flettner.glb").read_bytes()[-4:])
            self.assertTrue((fx.tree / "Willy.glb").is_file())
            self.assertTrue((fx.tree / "Willy.glb.gz").is_file())
            self.assertTrue((fx.tree / "Willy.wreck.report.json").is_file())
            self.assertTrue((fx.store / "bb" / "new.webp").is_file())
            rows = json.loads((fx.tree / "models.json").read_text())
            self.assertEqual(["Flettner", "Willy"], [r["name"] for r in rows])
            # the existing row is kept whole: its thumb and the other
            # session's variant survive
            self.assertEqual("thumbs/flettner.png", rows[0]["thumb"])
            self.assertIn("Flettner.Raid_on_Agheila.glb",
                          [v["glb"] for v in rows[0]["variants"]])

    def test_refresh_own_rewrites_a_changed_own_file_through_its_inode(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fx = Fixture(tmp)
            u = fx.texture(fx.store, "aa/t.webp")
            fx.write(fx.tree, "Greyhound.glb", [u], b"old")
            (fx.tree / "models.json").write_text(json.dumps([row("Greyhound")]))
            fx.write(fx.scratch, "Greyhound.glb", [u], b"fixed")
            (fx.scratch / "models.json").write_text(json.dumps([row("Greyhound")]))
            link = fx.tree / "mirror.glb"
            link.hardlink_to(fx.tree / "Greyhound.glb")

            m.merge(fx.tree, fx.scratch, fx.store, fx.scratch_store,
                    own_names={"greyhound"}, apply=True)
            self.assertEqual(b"fixed", (fx.tree / "Greyhound.glb").read_bytes()[-5:])
            self.assertEqual(b"fixed", link.read_bytes()[-5:], "the mirror sees it")

    def test_a_texture_no_store_has_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fx = Fixture(tmp)
            (fx.tree / "models.json").write_text("[]")
            fx.write(fx.scratch, "Willy.glb", ["../../../textures/zz/gone.webp"])
            (fx.scratch / "models.json").write_text(json.dumps([row("Willy")]))
            out = m.merge(fx.tree, fx.scratch, fx.store, fx.scratch_store)
            self.assertEqual(["zz/gone.webp"], out["texturesNowhere"])


if __name__ == "__main__":
    unittest.main()
