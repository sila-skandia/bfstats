#!/usr/bin/env python3
"""Which HUD picture does every vehicle, emplacement and deployable of the
three in-scope trees (vanilla, Road to Rome, Secret Weapons) name, and does
the viewer's sprite pack hold it?

    python3 census_vehicle_icons.py                 # the table, misses first
    python3 census_vehicle_icons.py --json out.json
    python3 census_vehicle_icons.py --game-dir ~/.wine/drive_c/EA\\ Games/Battlefield\\ 1942

A vehicle's HUD block rides its PlayerControlObject nodes in the glb
(`extras.hud`, `con.py` / `assemble.py`): `vehicleIcon`, `primaryAmmoIcon`,
`secondaryAmmoIcon`. The HUD resolves each the way `viewer/hud.js`'s
`resolveTexture` does, and a name the pack does not hold drops to the layout's
literal `Vehicle/Icon_defgun.tga` -- the flak gun -- or, for an ammo icon, the
medkit. That is the defect this census exists to keep out (the Flettner, the
Greyhound, the Krupp, the M4A1, the munitions Panzer and the rocket station
drew the flak gun: their pictures live only in Raid on Agheila's own
`Menu/Texture/Vehicle/`, VHUD-13).

It reads the per-level model variants in `models.json` and the placed
vehicles of every baked `scene.glb` of the three trees.

For every named picture the table says:

    ok               the pack's sprite exists and its PNG is on disk
    level-overlay    the level's own Objects.con names another picture for
                     this template (`vehicle-level-hud.json`) and that one
                     resolves (VHUD-14)
    missing-sprite   no sprite key resolves: the HUD draws the default icon
    missing-file     the manifest names a PNG that is not on disk

and with `--game-dir` where the engine's own data keeps a missing picture:
`menu` (a menu.rfa of the chain), `level:<Name>` (a level archive's
`Menu/Texture/`), or `nowhere` (no archive: the engine itself would draw
nothing, which is not a viewer defect).
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from extract_hud_pack import sprite_key_candidates  # noqa: E402

VIEWER = HERE / "viewer"
#: (mod id, models.json relative to viewer/models, HUD pack dir relative to
#: viewer/maps). Vanilla's pack is the shared baseline; a mod's lists only
#: what differs (`pack.json` `files`), see `viewer/hud-pack.js`.
TREES: list[tuple[str, str, str]] = [
    ("bf1942", "models/models.json", "_shared/hud"),
    ("xpack1", "models/mods/xpack1/models.json", "mods/xpack1/_shared/hud"),
    ("xpack2", "models/mods/xpack2/models.json", "mods/xpack2/_shared/hud"),
]
VANILLA_PACK = "_shared/hud"
HUD_FIELDS = ("vehicleIcon", "primaryAmmoIcon", "secondaryAmmoIcon")
#: Categories whose glb carries no vehicle HUD at all (hand weapons are the
#: soldier's weapon bar, `Weapon/*`, not this panel).
SKIP_CATEGORIES = {"handweapon", "soldier"}


def glb_json(path: Path) -> dict:
    """The JSON chunk of a binary glTF."""
    with open(path, "rb") as fh:
        head = fh.read(20)
        length = struct.unpack("<I", head[12:16])[0]
        return json.loads(fh.read(length))


def hud_blocks(glb: dict) -> list[tuple[str, dict]]:
    """(node name, extras.hud) for every node carrying a vehicle HUD block."""
    out = []
    for node in glb.get("nodes", []):
        hud = (node.get("extras") or {}).get("hud")
        if isinstance(hud, dict):
            out.append((node.get("name", ""), hud))
    return out


class Pack:
    """One tree's resolved sprite pack: its manifest, and where each PNG is."""

    def __init__(self, viewer: Path, mod: str, pack_rel: str):
        maps = viewer / "maps"
        self.mod_dir = maps / pack_rel
        self.vanilla_dir = maps / VANILLA_PACK
        own: set[str] = set()
        pack_json = self.mod_dir / "pack.json"
        if mod != "bf1942" and pack_json.is_file():
            own = set(json.loads(pack_json.read_text()).get("files", []))
        self.own = own
        hud_json = self._where("hud.json") / "hud.json"
        self.sprites: dict[str, dict] = {}
        if hud_json.is_file():
            self.sprites = json.loads(hud_json.read_text()).get("sprites", {})
        level_json = self._where("vehicle-level-hud.json") / "vehicle-level-hud.json"
        self.level_hud: dict[str, dict] = {}
        if level_json.is_file():
            self.level_hud = json.loads(level_json.read_text())

    def _where(self, rel: str) -> Path:
        return self.mod_dir if rel in self.own else self.vanilla_dir

    def resolve(self, name: str) -> tuple[str, str | None]:
        """(status, sprite key) for a texture path as `hud.js` looks it up."""
        for key in sprite_key_candidates(name):
            entry = self.sprites.get(key)
            if entry is None:
                continue
            if (self._where(entry["file"]) / entry["file"]).is_file():
                return "ok", key
            return "missing-file", key
        return "missing-sprite", None


def scene_rows(viewer: Path, mod: str, pack: Pack, pack_rel: str) -> list[dict]:
    """The placed vehicles of every baked level scene of one tree: the
    templates a level places are in its `scene.glb` whether or not
    `models.json` lists them, so the census reads both."""
    out: list[dict] = []
    maps = viewer / "maps"
    root = maps / "_shared" if mod == "bf1942" else maps / "mods" / mod
    scenes = ([p for p in sorted(maps.glob("*/scene.glb")) if p.parent.name != "_shared"]
              if mod == "bf1942" else sorted(root.glob("*/scene.glb")))
    for scene in scenes:
        seen: set[tuple] = set()
        for node, hud in hud_blocks(glb_json(scene)):
            for field in HUD_FIELDS:
                name = hud.get(field)
                key = (node, field, name)
                if not name or key in seen:
                    continue
                seen.add(key)
                status, sprite = pack.resolve(name)
                out.append({"mod": mod, "template": node, "node": node, "field": field,
                            "name": name, "status": status, "sprite": sprite,
                            "levels": [scene.parent.name], "scene": True})
    return out


def census(viewer: Path = VIEWER, scenes: bool = True) -> list[dict]:
    """One row per (mod, template, variant, seat node, field, picture), then
    one per placed vehicle picture of every baked level scene."""
    rows: list[dict] = []
    for mod, models_rel, pack_rel in TREES:
        models_path = viewer / models_rel
        if not models_path.is_file():
            continue
        pack = Pack(viewer, mod, pack_rel)
        base = models_path.parent
        seen: set[tuple] = set()
        for model in json.loads(models_path.read_text()):
            if model.get("category") in SKIP_CATEGORIES:
                continue
            for variant in model.get("variants", []):
                if variant.get("configuration") == "wreck" or variant.get("firstPerson"):
                    continue
                glb_path = base / variant["glb"]
                if not glb_path.is_file():
                    continue
                for node, hud in hud_blocks(glb_json(glb_path)):
                    for field in HUD_FIELDS:
                        name = hud.get(field)
                        if not name:
                            continue
                        key = (mod, model["name"], node, field, name)
                        status, sprite = pack.resolve(name)
                        row = {
                            "mod": mod, "template": model["name"], "node": node,
                            "field": field, "name": name, "status": status,
                            "sprite": sprite, "levels": [],
                        }
                        if key not in seen:
                            seen.add(key)
                            rows.append(row)
                        else:
                            row = next(r for r in rows
                                       if (r["mod"], r["template"], r["node"],
                                           r["field"], r["name"]) == key)
                        level = variant.get("level")
                        if level and level not in row["levels"]:
                            row["levels"].append(level)
        if scenes:
            rows.extend(scene_rows(viewer, mod, pack, pack_rel))
        # The level's own words, laid over the glb's by the viewer.
        for level, templates in sorted(pack.level_hud.items()):
            for template, words in templates.items():
                for field in HUD_FIELDS:
                    name = words.get(field)
                    if not name:
                        continue
                    status, sprite = pack.resolve(name)
                    rows.append({
                        "mod": mod, "template": template, "node": template,
                        "field": field, "name": name,
                        "status": "level-overlay" if status == "ok" else status,
                        "sprite": sprite, "levels": [level],
                    })
    return rows


def misses(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r["status"] not in ("ok", "level-overlay")]


def locate(rows: list[dict], game_dir: Path) -> None:
    """Annotate each missing row with where the engine's data keeps the file."""
    sys.path.insert(0, str(HERE))
    from bf42.rfa import RfaArchive  # noqa: E402
    from extract_models import mod_chain  # noqa: E402
    from extract_hud_pack import chain_level_names  # noqa: E402
    from bf42.level import find_level_archives  # noqa: E402
    from bf42.modmenu import MenuSources  # noqa: E402

    for mod in {r["mod"] for r in rows if r["status"] not in ("ok", "level-overlay")}:
        chain = mod_chain(game_dir, {"bf1942": "bf1942", "xpack1": "XPack1",
                                     "xpack2": "XPack2"}[mod])
        with MenuSources(chain).open_menu() as menu:
            menu_names = {e.lower() for e in menu.entries}
        level_files: dict[str, str] = {}
        for level in chain_level_names(chain):
            for path in find_level_archives(game_dir, chain[0].name, level, chain=chain):
                with RfaArchive(path) as arch:
                    for entry in arch.entries:
                        low = entry.lower().replace("\\", "/")
                        if "/menu/texture/" in low:
                            level_files.setdefault(low.split("/menu/texture/", 1)[1], level)
        for row in rows:
            if row["mod"] != mod or row["status"] in ("ok", "level-overlay"):
                continue
            stem = row["name"].replace("\\", "/").rsplit(".", 1)[0].lower()
            where = "nowhere"
            for ext in (".dds", ".tga"):
                if f"menu/texture/{stem}{ext}" in menu_names:
                    where = "menu"
                    break
                if f"{stem}{ext}" in level_files:
                    where = f"level:{level_files[f'{stem}{ext}']}"
                    break
            row["where"] = where


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--viewer", type=Path, default=VIEWER)
    ap.add_argument("--json", type=Path, default=None, help="also write the rows here")
    ap.add_argument("--game-dir", type=Path, default=None,
                    help="classify each miss by where the engine's data keeps the file")
    ap.add_argument("--all", action="store_true", help="print the ok rows too")
    args = ap.parse_args()

    rows = census(args.viewer)
    if args.game_dir:
        locate(rows, args.game_dir.expanduser())
    bad = misses(rows)
    shown = rows if args.all else bad
    for row in sorted(shown, key=lambda r: (r["status"] == "ok", r["mod"], r["template"], r["field"])):
        levels = ",".join(row["levels"]) or "-"
        print(f"{row['status']:15} {row['mod']:7} {row['template']:24} {row['field']:18} "
              f"{row['name']:40} levels={levels}"
              + (f" where={row['where']}" if "where" in row else ""))
    by_status: dict[str, int] = {}
    for row in rows:
        by_status[row["status"]] = by_status.get(row["status"], 0) + 1
    print(f"{len(rows)} named pictures: " + ", ".join(f"{n} {k}" for k, n in sorted(by_status.items())))
    if args.json:
        args.json.write_text(json.dumps(rows, indent=1) + "\n")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
