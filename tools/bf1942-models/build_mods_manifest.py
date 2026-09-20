#!/usr/bin/env python3
"""Write `viewer/models/mods.json` — the registry the three viewer pages switch on.

    python3 build_mods_manifest.py                 # scan ./viewer, write models/mods.json

Vanilla keeps the tree it has always had (`models/`, `maps/`, `models/poses/`)
because that tree is already published; a mod gets a sibling subtree under a
`mods/<id>/` folder in each of the two asset roots:

    viewer/models/mods.json        the registry, written by this script
    viewer/models/                 vanilla models.json, damage.json, *.glb
    viewer/models/thumbs/          vanilla browse thumbnails
    viewer/models/poses/           vanilla poses-matrix.json, *.pose.glb
    viewer/models/mods/eod/        EoD models.json, damage.json, *.glb
    viewer/models/mods/eod/thumbs/
    viewer/models/mods/eod/poses/  EoD poses-matrix.json, *.pose.glb
    viewer/maps/                   vanilla maps.json, <level>/scene.glb
    viewer/maps/_shared/sounds/    vanilla deduplicated samples (MP3)
    viewer/maps/mods/eod/          EoD maps.json, <level>/scene.glb
    viewer/maps/mods/eod/_shared/sounds/

Two properties fall out of that shape and both are the point:

* every extractor already takes `--out`, so a mod needs no new flag — it is
  `--mod EoD --out viewer/models/mods/eod`, and `models.json` / `maps.json` are
  written *inside* that directory by the same code that writes vanilla's;
* `viewer/models/mods/eod` and `viewer/maps/mods/eod` are each a self-contained
  subtree, so publishing a mod is the existing per-tree upload pointed one
  directory deeper. Nothing about vanilla moves.

This script only records what is on disk. A mod with no `maps.json` gets a zero
count for the Maps tab and the pages drop it from that tab's picker, which is
how production behaves before a mod's assets have been uploaded.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Display names for the Refractor mods this pipeline can reach. A folder not
# listed here still works; it just shows under its own directory name.
MOD_NAMES = {
    "bf1942": ("Battlefield 1942", "BF1942"),
    "eod": ("Eve of Destruction", "EoD"),
    "desertcombat": ("Desert Combat", "DC"),
    "dc_final": ("Desert Combat Final", "DC Final"),
    "fh": ("Forgotten Hope", "FH"),
    "fhsw": ("Forgotten Hope: Secret Weapon", "FHSW"),
    "gcmod": ("Galactic Conquest", "GC"),
    "bf1918": ("Battlefield 1918", "BF1918"),
    "interstate": ("Interstate '82", "I82"),
    "xpack1": ("The Road to Rome", "RtR"),
    "xpack2": ("Secret Weapons of WWII", "SWoWWII"),
}

# (version, url, info) for the Custom Game dialog - see
# `extract_custom_game_layout.py`, which decodes the dialog's chrome but not
# this table. Each mod's own `init.con` sets these with
# `game.setCustomGameVersion` / `...Url` / `...Info` (case and the leading
# `set` both drift between mods); `...Info` is sometimes a literal string and
# sometimes a `lexiconAll.dat` key in that mod's own lexicon, resolved by
# hand here. Vanilla ships no `setCustomGameInfo` at all - the real game
# falls back to `menu/CustomGameMenu`'s own placeholder text, which is
# editor lorem ipsum DICE never replaced, so a real line is written for it
# here instead of reproducing that.
MOD_INFO = {
    "bf1942": ("1.61", "http://www.battlefield1942.com",
              "The original game: 23 maps across five theaters."),
    "eod": ("2.50", "http://www.eodmod.com",
            "Gooooooooooooood Morning Vietnaaaaaaaaaaaam !"),
    "desertcombat": ("0.7", "http://www.DesertCombat.com",
                     "Developed by Trauma Studios, Inc."),
    "dc_final": ("0.8", None, "The final installment of Desert Combat."),
    "fh": ("0.7", "http://www.fhmod.org", None),
    "fhsw": ("0.73", "http://wbmuse.blog89.fc2.com/", None),
    "gcmod": ("8.5", "http://www.galacticconquest.rf.gd",
             "It is a period of civil war. The Galactic Empire faces a "
             "constant threat from Rebel forces, who wish to bring freedom "
             "to all those oppressed by the Empire."),
    "bf1918": ("3.4b", "https://www.moddb.com/mods/battlefield-1918", None),
    "interstate": ("1.8", "http://www.bf1982.com", "Shoot or Race"),
    "xpack1": ("1.6", "http://www.battlefield1942.com", None),
    "xpack2": ("1.6", "http://www.battlefield1942.com", None),
}


def _count(path: Path, key: str | None = None) -> int:
    """Entries in a manifest file, or 0 if it is absent or unreadable."""
    if not path.is_file():
        return 0
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return 0
    if key is not None:
        data = data.get(key, [])
    return len(data) if isinstance(data, (list, dict)) else 0


def describe(mod_id: str, models_dir: Path, maps_dir: Path, viewer: Path | None = None) -> dict:
    name, short = MOD_NAMES.get(mod_id, (mod_id, mod_id))
    poses_dir = models_dir / "poses"
    entry = {
        "id": mod_id,
        "name": name,
        "short": short,
        "paths": {
            "models": models_dir.as_posix(),
            "maps": maps_dir.as_posix(),
            "poses": poses_dir.as_posix(),
        },
    }
    version, url, info = MOD_INFO.get(mod_id, (None, None, None))
    if version:
        entry["version"] = version
    if url:
        entry["url"] = url
    if info:
        entry["info"] = info
    if viewer is not None:
        mod_icon = models_dir / "icon.png"
        static_icon = Path("icons") / "mods" / f"{mod_id}.png"
        if (viewer / mod_icon).is_file():
            entry["icon"] = mod_icon.as_posix()
        elif (viewer / static_icon).is_file():
            entry["icon"] = static_icon.as_posix()
    return entry


def scan(viewer: Path) -> list[dict]:
    """Vanilla first, then every mod subtree under either asset root."""
    entries: list[dict] = [describe("bf1942", Path("models"), Path("maps"), viewer)]

    ids: list[str] = []
    for root in (viewer / "models" / "mods", viewer / "maps" / "mods"):
        if not root.is_dir():
            continue
        for child in sorted(root.iterdir()):
            if child.is_dir() and child.name.lower() not in ids:
                ids.append(child.name.lower())
    for mod_id in sorted(ids):
        entries.append(describe(
            mod_id,
            Path("models") / "mods" / mod_id,
            Path("maps") / "mods" / mod_id,
            viewer,
        ))

    for entry in entries:
        paths = entry["paths"]
        entry["counts"] = {
            "models": _count(viewer / paths["models"] / "models.json"),
            "maps": _count(viewer / paths["maps"] / "maps.json"),
            "poses": _count(viewer / paths["poses"] / "poses-matrix.json", "pairs"),
        }
    return entries


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--viewer", type=Path, default=HERE / "viewer")
    args = ap.parse_args()

    viewer = args.viewer.expanduser()
    if not viewer.is_dir():
        sys.exit(f"viewer dir not found: {viewer}")

    mods = scan(viewer)
    # On the assets volume, not at the viewer root. The mesh image bakes in
    # everything under `viewer/` *except* `models/` and `maps/`, which the
    # Deployment replaces with PVC subPath mounts — so a file at the root can
    # only change on an image build, while the registry has to change when
    # assets are uploaded. `models/` is the mount both the Models and the Poses
    # tabs already read, so the registry rides along with the models upload.
    (viewer / "models").mkdir(parents=True, exist_ok=True)
    (viewer / "models" / "mods.json").write_text(
        json.dumps({"mods": mods}, indent=2) + "\n")
    for entry in mods:
        counts = entry["counts"]
        print(f"{entry['id']:14s} {counts['models']:5d} models "
              f"{counts['maps']:4d} maps {counts['poses']:5d} poses",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
