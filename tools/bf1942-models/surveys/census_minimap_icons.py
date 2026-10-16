#!/usr/bin/env python3
"""Census: the minimap icon every placed vehicle of the EXPORTED levels names,
whether it is the base game's art or a mod's own, and whether the viewer's
minimap draws it -- per tree, over the rows of each tree's maps.json (FHSW and
FHSWEurope: the rows carrying a `loading` block), never the install's levels.

    python3 surveys/census_minimap_icons.py                       # all five trees
    python3 surveys/census_minimap_icons.py --trees fhsweurope --level bombing_the_reich-1945 -v
    python3 surveys/census_minimap_icons.py --json out.json

From tools/bf1942-models. Reads the game install (`--game-dir`, default
~/.wine/.../Battlefield 1942) for the templates and the trees' scene.glb JSON
chunks and HUD packs; writes nothing but `--json`.

What the retail data says (the "retail" side of each row):

  * A template's map symbol is `ObjectTemplate.setMinimapIcon "<Minimap/x.tga>"`
    with an optional `setMinimapIconSize <px>` (default 16 per
    `features/bf1942-3d-models/minimap-and-fullmap.md` section 2; no ledger row
    reads the size from the binary). A level's own Objects.con overrides the
    mod's (`extract_hud_pack.extract_level_icon_map`, VHUD-14's rule for the
    vehicle HUD). Unlike `extract_hud_pack.extract_icon_map`, this follows
    `include <x>.inc` the way `extract_models._inline_includes` does: FHSW sets
    155 templates' icons inside an `.inc` (`Bf109-G10.inc`), which the HUD
    pack's `minimap-icons.json` never sees.
  * The map draws a ROOT object with Armor (MMAP-3). An object an
    `ObjectSpawner` makes is created "parented to nothing" (AI-121), so a
    held object a vehicle carries -- FHSW's attitude indicator on its bombers
    -- is a map object of its own, drawn with its own icon, hidden from the
    side its `teamOnVehicle` spawner does not hold it for (MMAP-3's +0x11a).
    Such a node is reported as `carried`.

What the viewer does (`viewer/map-surfaces.js` `drawVehicles`): it walks
`mapVehicles` (the `spawners` group's children, plus the ship and static craft
`spawned-craft.js` splits off), looks the template up in
`minimap-level-icons.json[level]` then `minimap-icons.json`, and draws that
sprite at its own pixel size (`map-sprites.js` `drawSprite`), or
`icon_vehicledot_empty` when either lookup misses. A carried object is never
in `mapVehicles`, so it is never drawn.

Verdicts:

  ok        the viewer draws the sprite the data names, at its declared size
  size      right sprite, wrong size: the PNG's width is not the declared
            `setMinimapIconSize` (16 when undeclared)
  dot       the data names a sprite and the viewer draws the vehicle dot
            instead (the `.inc` gap, or art the pack lacks; vanilla Battle of
            Britain's level-owned Factory/Radar art is HUD-13's open question)
  not-drawn a carried held object with an icon: never on the viewer's map
  empty     `setMinimapIcon ""` (or `0`): no symbol; the viewer draws
            the vehicle dot (what the client does with an empty name is not
            read in the ledger)
  none      no icon declared anywhere; the viewer draws the dot, what the
            client draws is not read
  no-armor  no Armor hit points: neither the client (MMAP-3) nor the viewer
            (`map-vehicle-marks.js`) draws it; counted, not tabled

`art` is `stock` for one of the base game's minimap sprites drawn with the
base game's pixels, `mod` for a sprite the base game does not ship or a stock
name the mod repaints (PNG bytes differ from vanilla's).
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from bf42.level import find_level_archives  # noqa: E402
from bf42.rfa import ArchivePool, find_archives_dir  # noqa: E402
from extract_hud_pack import icon_key, level_con_texts  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, _inline_includes, mod_chain  # noqa: E402

VIEWER = HERE / "viewer"
MAPS = VIEWER / "maps"
VANILLA_HUD = MAPS / "_shared" / "hud"

#: tree id -> (mod folder, maps.json, HUD pack dir, rows must carry `loading`)
TREES: dict[str, tuple[str, Path, Path, bool]] = {
    "bf1942": ("bf1942", MAPS / "maps.json", VANILLA_HUD, False),
    "xpack1": ("XPack1", MAPS / "mods/xpack1/maps.json", MAPS / "mods/xpack1/_shared/hud", False),
    "xpack2": ("XPack2", MAPS / "mods/xpack2/maps.json", MAPS / "mods/xpack2/_shared/hud", False),
    "fhsw": ("FHSW", MAPS / "mods/fhsw/maps.json", MAPS / "mods/fhsw/_shared/hud", True),
    "fhsweurope": ("FHSWEurope", MAPS / "mods/fhsweurope/maps.json",
                   MAPS / "mods/fhsweurope/_shared/hud", True),
}

_CREATE = re.compile(r"(?i)^ObjectTemplate\.(?:create\s+\S+|active)\s+(\S+)")
_ICON = re.compile(r'(?i)^ObjectTemplate\.setMinimapIcon\s+"?([^"\s]*)"?')
_SIZE = re.compile(r"(?i)^ObjectTemplate\.setMinimapIconSize\s+(\d+)")


def icons_in(texts) -> dict[str, dict]:
    """template (lower) -> {icon, size?}; `icon` is "" for an explicit
    `setMinimapIcon ""`. Last declaration wins, the way a .con run does."""
    out: dict[str, dict] = {}
    for text in texts:
        current = None
        for line in text.splitlines():
            line = line.strip()
            if m := _CREATE.match(line):
                current = m.group(1).lower()
            elif current and (m := _ICON.match(line)):
                # `setMinimapIcon 0` (FHSW's `JapSpawn*`, `oldradio`) names no
                # picture (`extract_hud_pack.object_icon_textures_in`): empty.
                value = m.group(1)
                out.setdefault(current, {})["icon"] = (
                    "" if not value or value.isdigit() else icon_key(value))
            elif current and (m := _SIZE.match(line)):
                out.setdefault(current, {})["size"] = int(m.group(1))
    return {k: v for k, v in out.items() if "icon" in v}


def chain_icons(chain: list[Path]) -> dict[str, dict]:
    """Every Objects archive of the chain, nearest mod's copy of a path first,
    with `include`s spliced in."""
    pool = ArchivePool()
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        if archives is not None:
            pool.add_dir(archives, ("objects",))

    def texts():
        for entry in pool.names():
            if not entry.lower().endswith(".con"):
                continue
            raw = pool.try_read(entry)
            if raw is not None:
                yield _inline_includes(pool, entry, raw.decode("latin-1", "replace"))
    return icons_in(texts())


def level_icons(game_dir: Path, mod: str, level: str, chain: list[Path]) -> dict[str, dict]:
    paths = find_level_archives(game_dir, mod, level, chain=chain)
    if not paths:
        return {}
    try:
        return icons_in(level_con_texts(paths))
    except Exception as exc:  # truncated FHSW archives (mod-extraction s.12)
        print(f"warning: {mod}/{level}: level archives unreadable ({exc})", file=sys.stderr)
        return {}


def glb_nodes(path: Path) -> list[dict] | None:
    try:
        with path.open("rb") as fh:
            head = fh.read(20)
            if len(head) < 20 or head[:4] != b"glTF":
                return None
            length = struct.unpack("<I", head[12:16])[0]
            return json.loads(fh.read(length)).get("nodes", [])
    except OSError:
        return None


def placed_and_carried(nodes: list[dict]):
    """(placed roots the viewer's map walks, carried held objects).

    Placed: the `spawners` group's children, plus what `spawned-craft.js`
    `detachSpawnedCraft` splits off (a ship's VCSea/VCAir PCO with mass; a
    static's held PCO with mass). Carried: a nested PCO with `heldSpawner`
    that stays baked inside its host -- a retail root object of its own."""
    parent: dict[int, int] = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    spawners = next((i for i, n in enumerate(nodes)
                     if (n.get("extras") or {}).get("kind") == "spawners"
                     or n.get("name") == "spawners"), None)

    def ext(i):
        return nodes[i].get("extras") or {}

    def under(i, root):
        while i in parent:
            i = parent[i]
            if i == root:
                return True
        return False

    def subtree(i):
        stack = list(nodes[i].get("children", []))
        while stack:
            j = stack.pop()
            yield j
            stack.extend(nodes[j].get("children", []))

    placed, carried, detached = [], [], set()
    tops = nodes[spawners].get("children", []) if spawners is not None else []
    for top in tops:
        placed.append(top)
        for j in subtree(top):
            e = ext(j)
            phys = e.get("physics") or {}
            if (e.get("templateKind") == "PlayerControlObject" and (phys.get("mass") or 0) > 0
                    and phys.get("vehicleCategory") in ("VCSea", "VCAir")):
                placed.append(j)
                detached.add(j)
    for i in range(len(nodes)):
        e = ext(i)
        if e.get("templateKind") != "PlayerControlObject" or not e.get("heldSpawner"):
            continue
        if i in detached or i in tops:
            continue
        if spawners is not None and not under(i, spawners):
            phys = e.get("physics") or {}
            if (phys.get("mass") or 0) > 0 and e["heldSpawner"].get("holdObject") is True:
                placed.append(i)  # a static's held craft, split off
                continue
        host = i
        while host in parent and host not in tops and host not in detached:
            host = parent[host]
        carried.append((i, host))
    return placed, carried


class Pack:
    """A tree's HUD pack the way `hud-pack.js` resolves it."""

    def __init__(self, hud_dir: Path):
        self.dir = hud_dir
        self.sprites = json.loads((hud_dir / "hud.json").read_text()).get("sprites", {})
        self.icons = json.loads((hud_dir / "minimap-icons.json").read_text())
        lv = hud_dir / "minimap-level-icons.json"
        self.level_icons = json.loads(lv.read_text()) if lv.is_file() else {}
        pack = hud_dir / "pack.json"
        self.own = (set(json.loads(pack.read_text()).get("files", []))
                    if pack.is_file() and hud_dir != VANILLA_HUD else None)

    def png(self, key: str) -> Path | None:
        entry = self.sprites.get(key)
        if not entry:
            return None
        rel = entry["file"]
        base = self.dir if self.own is None or rel in self.own else VANILLA_HUD
        path = base / rel
        return path if path.is_file() else None

    def viewer_icon(self, level: str, template: str, name: str) -> str | None:
        lv = self.level_icons.get(level) or {}
        entry = (lv.get(template) or self.icons.get(template)
                 or lv.get(name) or self.icons.get(name))
        icon = (entry or {}).get("icon")
        return icon if icon and not icon.startswith("flag_") else None


_digest: dict[Path, str] = {}


def digest(path: Path | None) -> str | None:
    if path is None:
        return None
    if path not in _digest:
        _digest[path] = hashlib.sha1(path.read_bytes()).hexdigest()
    return _digest[path]


def tree_row(tree: str, mod: str) -> tuple[str, Path, Path, bool]:
    """`TREES`' row for any tree id (`audit_bake.minimap_findings`): its
    maps.json and HUD pack beside its levels; FHSW and FHSWEurope export the
    rows carrying a `loading` block."""
    if tree in TREES:
        return TREES[tree]
    maps = MAPS / "mods" / tree
    return (mod, maps / "maps.json", maps / "_shared" / "hud", False)


def survey_tree(tree: str, game_dir: Path, only_level: str | None,
                row: tuple[str, Path, Path, bool] | None = None) -> list[dict]:
    mod, maps_json, hud_dir, need_loading = row or TREES[tree]
    chain = mod_chain(game_dir, mod)
    lib = chain_icons(chain)
    pack = Pack(hud_dir)
    vanilla = Pack(VANILLA_HUD)
    rows = json.loads(maps_json.read_text())
    out = []
    for row in rows:
        if need_loading and not row.get("loading"):
            continue
        level_dir = row["glb"].rsplit("/", 1)[0]
        if only_level and level_dir.lower() != only_level.lower():
            continue
        nodes = glb_nodes(maps_json.parent / row["glb"])
        if nodes is None:
            print(f"warning: {tree}/{row['glb']}: no glb", file=sys.stderr)
            continue
        own = level_icons(game_dir, row.get("mod") or mod, row["name"], chain)
        placed, carried = placed_and_carried(nodes)

        def record(i, kind, host=None):
            n = nodes[i]
            e = n.get("extras") or {}
            template = (e.get("control") or n.get("name") or "").lower()
            data = own.get(template) or lib.get(template) or {}
            icon = data.get("icon")
            declared = data.get("size", 16)
            viewer = pack.viewer_icon(level_dir, template, (n.get("name") or "").lower())
            png = pack.png(icon) if icon else None
            width = pack.sprites.get(icon, {}).get("size", [None])[0] if icon else None
            stock_png = vanilla.png(icon) if icon else None
            art = (None if not icon else
                   "stock" if stock_png is not None and digest(png) == digest(stock_png) else "mod")
            armor = e.get("armor") or {}
            if armor.get("hasArmor") is False or not (armor.get("hitpoints") or 0) > 0:
                verdict = "no-armor"
            elif icon == "":
                verdict = "empty"
            elif not icon:
                verdict = "none"
            elif kind == "carried":
                verdict = "not-drawn"
            elif viewer != icon or png is None:
                verdict = "dot"
            elif width != declared:
                verdict = "size"
            else:
                verdict = "ok"
            rec = {"tree": tree, "level": level_dir, "kind": kind, "template": template,
                   "icon": icon, "size": data.get("size"), "png": width, "art": art,
                   "viewer": ("(not drawn)" if kind == "carried" else
                              viewer if viewer and pack.png(viewer) else "icon_vehicledot_empty"),
                   "verdict": verdict,
                   "source": "level" if template in own else "chain" if template in lib else None}
            if kind == "carried":
                rec["host"] = (nodes[host].get("extras") or {}).get("control") or nodes[host].get("name")
                rec["heldTeam"] = (e.get("heldSpawner") or {}).get("team")
            return rec

        out += [record(i, "placed") for i in placed]
        out += [record(i, "carried", host) for i, host in carried
                if (lambda t: (own.get(t) or lib.get(t) or {}).get("icon"))(
                    ((nodes[i].get("extras") or {}).get("control") or nodes[i].get("name") or "").lower())]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--trees", default=",".join(TREES))
    ap.add_argument("--level", help="one exported level directory, e.g. bombing_the_reich-1945")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--json", type=Path)
    ap.add_argument("-v", "--verbose", action="store_true",
                    help="list each non-ok (template, icon) with its levels")
    args = ap.parse_args()

    records = []
    for tree in args.trees.split(","):
        records += survey_tree(tree.strip(), args.game_dir, args.level)

    print("Placements whose icon is mod art (art=mod), and every non-ok one, per tree")
    print("(placements = map objects over the exported levels; templates = distinct)\n")
    header = f"{'tree':<11}{'kind':<9}{'art':<7}{'verdict':<10}{'placements':>11}{'templates':>10}{'levels':>8}"
    print(header)
    print("-" * len(header))
    groups = collections.defaultdict(list)
    for r in records:
        if r["verdict"] == "no-armor":
            continue
        if r["art"] == "mod" or r["verdict"] != "ok":
            groups[(r["tree"], r["kind"], r["art"] or "-", r["verdict"])].append(r)
    for key in sorted(groups):
        rs = groups[key]
        print(f"{key[0]:<11}{key[1]:<9}{key[2]:<7}{key[3]:<10}{len(rs):>11}"
              f"{len({r['template'] for r in rs}):>10}{len({r['level'] for r in rs}):>8}")

    skipped = collections.Counter(r["tree"] for r in records if r["verdict"] == "no-armor")
    print("\nno-armor (drawn by neither, not tabled): "
          + ", ".join(f"{t} {n}" for t, n in sorted(skipped.items())))

    if args.verbose:
        print()
        detail = collections.defaultdict(set)
        for r in records:
            if r["verdict"] != "no-armor" and (r["verdict"] != "ok" or r["art"] == "mod"):
                k = (r["tree"], r["kind"], r["verdict"], r["template"], r["icon"], r["size"],
                     r["png"], r["viewer"], r.get("host"))
                detail[k].add(r["level"])
        for k in sorted(detail, key=lambda k: tuple(str(x) for x in k)):
            tree, kind, verdict, template, icon, size, png, viewer, host = k
            via = f" on {host}" if host else ""
            print(f"{tree:<11}{kind:<8}{verdict:<10}{template}{via}: icon={icon} size={size} "
                  f"png={png} viewer={viewer} levels={len(detail[k])}")
    if args.json:
        args.json.write_text(json.dumps(records, indent=1))


if __name__ == "__main__":
    main()
