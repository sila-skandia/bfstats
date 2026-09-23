#!/usr/bin/env python3
"""Build one mod's interface pack: only the files that differ from vanilla's.

The interface extractors each take `--mod` and read through the mod's
`game.addModPath` chain, so running them against Eve of Destruction already
produces a *complete* pack -- every sprite, every layout, every font, every
string, whether EoD changed it or inherited it. Shipping a complete pack per
mod would mean 240-odd PNGs and four JSON files copied 16 times over for the
sake of the handful each mod actually changes.

So this runs them all into a scratch directory, compares every file it
produced against the vanilla pack byte for byte, and keeps only the ones that
differ. What lands in `viewer/maps/mods/<id>/_shared/hud/` is exactly the
mod's own chrome, and `pack.json` lists it:

    {"mod": "xpack1", "inherits": "bf1942",
     "files": ["hud.json", "conp_fre.png", ... ],
     ...}

The viewer's rule is one line (`viewer/hud-pack.js`): a pack-relative path in
`files` resolves against the mod pack, and anything else against the vanilla
pack. A mod that overrides nothing produces no `files`, so nothing is written
and the page never fetches anything extra -- the design costs nothing for a
mod with nothing to say.

    python3 extract_hud_mods.py --mod EoD
    python3 extract_hud_mods.py --mod XPack1 --out /tmp/probe/xpack1
    python3 extract_hud_mods.py --mod XPack2 --vanilla /tmp/probe/vanilla

`--vanilla` points the comparison at a scratch build of the vanilla pack
instead of `viewer/maps/_shared/hud`, which is what a worktree that must not
write into the shared asset tree needs.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_console_font import VIEWER_FONT_DIR  # noqa: E402
from extract_hud_pack import VIEWER_HUD_DIR, hud_dir_for  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402

HERE = Path(__file__).resolve().parent

#: Each extractor, and where under the pack its `--out` points. The console
#: font is the odd one: vanilla's lives at `viewer/fonts/`, outside the pack,
#: because that half of the viewer tree is baked into the image; a mod's has
#: to travel with the mod, so it goes in the pack under `console/`.
STEPS: list[tuple[str, str]] = [
    ("extract_hud_pack.py", ""),
    ("extract_spawn_layout.py", ""),
    ("extract_hud_layout.py", ""),
    ("extract_menu_layout.py", "menu"),
    ("extract_console_font.py", "console"),
    ("extract_radio.py", ""),
]

#: Arguments a step needs beyond `--mod/--game-dir/--out`.
EXTRA_ARGS = {"extract_radio.py": ["--layout-only"]}

#: Steps whose failure is survivable: the pack simply does not carry that
#: file and the viewer falls back to vanilla's. `extract_hud_layout.py` is
#: the one that can genuinely fail on a mod -- `find_top` refuses to guess
#: when a mod has restructured `menu/InGame` -- and a mod HUD that falls back
#: to vanilla's layout is much better than no pack at all.
OPTIONAL = {"extract_hud_layout.py", "extract_menu_layout.py"}


def vanilla_twin(rel: Path, vanilla_hud: Path, vanilla_fonts: Path) -> Path:
    """The vanilla file a pack-relative path is compared against."""
    if rel.parts and rel.parts[0] == "console":
        return vanilla_fonts.joinpath(*rel.parts[1:])
    return vanilla_hud / rel


def previous_pack(out: Path) -> set[str] | None:
    """What the last run of this script wrote into `out`, from its own
    `pack.json`, or None if `out` holds no pack.

    This is the only list of files this script is allowed to delete. A
    directory with no `pack.json` was not written by a previous run, so
    nothing in it is ours to remove -- see `prune`."""
    manifest = out / "pack.json"
    if not manifest.is_file():
        return None
    try:
        files = json.loads(manifest.read_text()).get("files")
    except (ValueError, OSError):
        return None
    return set(files) | {"pack.json"} if isinstance(files, list) else None


def prune(out: Path, keep: set[str]) -> None:
    """Remove the files a previous run wrote that this one does not, and
    nothing else.

    The old code walked `out` and unlinked everything it had not just
    written, and `shutil.rmtree`'d the whole directory when a mod turned out
    to differ from vanilla in nothing. Pointed at a directory that is not a
    pack -- `--mod bf1942` resolved `--out` to the shared vanilla pack, which
    in a worktree is a symlink into the main checkout -- that deleted 330
    vanilla files and anything else living beside them. Now only what a
    previous `pack.json` claims is ever unlinked.
    """
    previous = previous_pack(out)
    if previous is None:
        return
    for rel in sorted(previous - keep):
        path = out / rel
        if path.is_file():
            path.unlink()
    for directory in sorted((p for p in out.rglob("*") if p.is_dir()),
                            key=lambda p: len(p.parts), reverse=True):
        if not any(directory.iterdir()):
            directory.rmdir()
    if out.is_dir() and not any(out.iterdir()):
        out.rmdir()


def run_steps(mod: str, game_dir: Path, staging: Path, force: bool) -> list[str]:
    """Run the extractors into `staging`. Returns the steps that failed."""
    failed: list[str] = []
    for script, sub in STEPS:
        out = staging / sub if sub else staging
        cmd = [sys.executable, str(HERE / script), "--mod", mod,
               "--game-dir", str(game_dir), "--out", str(out), *EXTRA_ARGS.get(script, [])]
        if force:
            cmd.append("--force")
        result = subprocess.run(cmd)
        if result.returncode != 0:
            if script not in OPTIONAL:
                sys.exit(f"{script} failed for {mod} (exit {result.returncode})")
            print(f"warning: {script} failed for {mod}; the pack will leave "
                  f"its output out and the viewer will fall back to vanilla's",
                  file=sys.stderr)
            failed.append(script)
    return failed


def differing_files(staging: Path, vanilla_hud: Path,
                    vanilla_fonts: Path) -> tuple[list[str], int]:
    """Pack-relative paths whose bytes differ from vanilla's, and how many
    were identical."""
    changed: list[str] = []
    same = 0
    for path in sorted(staging.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(staging)
        twin = vanilla_twin(rel, vanilla_hud, vanilla_fonts)
        if twin.is_file() and twin.read_bytes() == path.read_bytes():
            same += 1
            continue
        changed.append(rel.as_posix())
    return changed, same


def sprite_diff(staging: Path, vanilla_hud: Path) -> dict:
    """How the mod's sprite manifest stands against vanilla's: how many
    sprites it overrides, how many it adds and how many it inherits."""
    mod_json = staging / "hud.json"
    van_json = vanilla_hud / "hud.json"
    if not mod_json.is_file() or not van_json.is_file():
        return {}
    mod = json.loads(mod_json.read_text()).get("sprites", {})
    van = json.loads(van_json.read_text()).get("sprites", {})
    overridden, added, inherited = [], [], 0
    for name in mod:
        if name not in van:
            added.append(name)
        elif (staging / mod[name]["file"]).read_bytes() != \
                (vanilla_hud / van[name]["file"]).read_bytes():
            overridden.append(name)
        else:
            inherited += 1
    return {
        "total": len(mod),
        "overridden": sorted(overridden),
        "added": len(added),
        "inherited": inherited,
        "dropped": sorted(set(van) - set(mod)),
    }


def string_diff(staging: Path, vanilla_hud: Path) -> dict:
    """The spawn screen's own resolved strings, mod against vanilla. This is
    the lexicon difference a player can actually read on the screen, not the
    whole-file difference."""
    def strings(path: Path) -> dict:
        if not path.is_file():
            return {}
        return json.loads(path.read_text()).get("strings", {})
    mod = strings(staging / "spawn-layout.json")
    van = strings(vanilla_hud / "spawn-layout.json")
    changed = {k: [van[k], mod[k]] for k in van if k in mod and van[k] != mod[k]}
    return {"total": len(mod), "changed": dict(sorted(changed.items()))}


def build(mod: str, game_dir: Path, out: Path, vanilla_hud: Path,
          vanilla_fonts: Path, force: bool, keep: Path | None = None) -> dict:
    if out.resolve() == vanilla_hud.resolve() or \
            out.resolve() == vanilla_fonts.resolve():
        sys.exit(f"refusing to write a mod pack into the vanilla pack itself "
                 f"({out}). A pack is the difference from vanilla, so its "
                 f"output directory can never be the thing it is compared "
                 f"against.")
    staging_ctx = None
    if keep is not None:
        keep.mkdir(parents=True, exist_ok=True)
        staging = keep
    else:
        staging_ctx = tempfile.TemporaryDirectory()
        staging = Path(staging_ctx.name)
    try:
        sources = MenuSources(mod_chain(game_dir, mod))
        failed = run_steps(mod, game_dir, staging, force)
        changed, same = differing_files(staging, vanilla_hud, vanilla_fonts)
        manifest = {
            **sources.provenance(),
            "inherits": "bf1942",
            "generator": "extract_hud_mods.py",
            "skipped": failed,
            "identical": same,
            "files": changed,
            "sprites": sprite_diff(staging, vanilla_hud),
            "strings": string_diff(staging, vanilla_hud),
        }
        if not changed:
            # Nothing of this mod's own. Do not write a pack at all: the page
            # fetches `pack.json`, gets a 404 and draws vanilla's chrome,
            # which is the right answer and costs one request.
            if out.exists():
                prune(out, set())
            return manifest
        out.mkdir(parents=True, exist_ok=True)
        wanted = set(changed) | {"pack.json"}
        prune(out, wanted)
        out.mkdir(parents=True, exist_ok=True)
        for rel in changed:
            dest = out / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(staging / rel, dest)
        (out / "pack.json").write_text(json.dumps(manifest, indent=1) + "\n")
        return manifest
    finally:
        if staging_ctx is not None:
            staging_ctx.cleanup()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--mod", required=True, help="mod to build a pack for")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--out", type=Path, default=None,
                    help="pack directory (default: the mod's own)")
    ap.add_argument("--vanilla", type=Path, default=VIEWER_HUD_DIR,
                    help=f"the vanilla pack to compare against "
                         f"(default: {VIEWER_HUD_DIR})")
    ap.add_argument("--vanilla-fonts", type=Path, default=VIEWER_FONT_DIR,
                    help="the vanilla console font directory to compare "
                         f"against (default: {VIEWER_FONT_DIR})")
    ap.add_argument("--staging", type=Path, default=None,
                    help="keep the complete pre-diff pack here instead of a "
                         "temporary directory (for inspection)")
    ap.add_argument("--force", action="store_true",
                    help="re-encode images that already exist in staging")
    args = ap.parse_args()

    game_dir = args.game_dir.expanduser()
    mod_id = MenuSources(mod_chain(game_dir, args.mod)).mod_id
    if mod_id == "bf1942":
        sys.exit("bf1942 has no pack: the vanilla pack IS the baseline every "
                 "mod pack is the difference from. Build it with the five "
                 "extractors directly (extract_hud_pack.py and friends).")
    out = args.out or hud_dir_for(mod_id)
    manifest = build(args.mod, game_dir, out, args.vanilla,
                     args.vanilla_fonts, args.force, args.staging)

    sprites = manifest.get("sprites") or {}
    print(f"{mod_id}: {len(manifest['files'])} files of its own "
          f"({manifest['identical']} identical to vanilla's); sprites "
          f"{len(sprites.get('overridden', []))} overridden, "
          f"{sprites.get('added', 0)} added, "
          f"{sprites.get('inherited', 0)} inherited; "
          f"{len(manifest['strings'].get('changed', {}))} spawn-screen "
          f"strings changed -> {out if manifest['files'] else '(no pack)'}")


if __name__ == "__main__":
    main()
