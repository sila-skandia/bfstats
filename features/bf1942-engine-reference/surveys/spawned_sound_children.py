r"""Sound objects under what an ObjectSpawner stands up, per level.

Run from the repository root. Read-only (the level contexts are pointed at a
scratch directory and nothing is written). Backs ledger SND-32.

    python3 features/bf1942-engine-reference/surveys/spawned_sound_children.py
    python3 features/bf1942-engine-reference/surveys/spawned_sound_children.py --mods FH -j 8

For every level of each mod's chain, with the library the bake builds for
that level (the level's own templates first), it reports:

  emitters  `sounds.areas` entries `discover_level_sounds` makes from the
            `spawned` list (`extract_map.union_spawned_objects`): a template
            one of the level's `Sounds/*.con` declares, which the object
            library does not know, hanging off (or being) the object a pad's
            ObjectSpawner places. These are what the rule adds to a level.
  static    the same kind of template reached through a static, for scale:
            the path that existed before.
  other     templates under a spawned object that bind a `loadSoundScript`
            and whose class is neither an Engine, a FireArms, nor one of
            `extract_map.PART_SOUND_KINDS`, counted by class. No rule plays
            these; listed so the next gap is measured rather than met.

Measured 2026-10-11 over bf1942, XPack1, XPack2 and FH: the table is in
`features/fh-mod-extraction/README.md` ("Midway's siren").
"""
from __future__ import annotations

import argparse
import sys
import tempfile
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, "tools/bf1942-models")  # relative to the repo root
import extract_map as em  # noqa: E402
import scene_layers as sl  # noqa: E402
from extract_models import discover_levels, mod_chain  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
PLAYED = {"engine", "firearms", *em.PART_SOUND_KINDS}


def other_sound_nodes(library, template: str) -> list[tuple[str, str]]:
    """`(class, name)` of every scripted node under `template` no rule plays."""
    root = library.objects.get(template.lower())
    if root is None:
        return []
    seen: set[str] = set()
    queue = [root]
    out: list[tuple[str, str]] = []
    while queue:
        node = queue.pop(0)
        if node.name.lower() in seen:
            continue
        seen.add(node.name.lower())
        if node.sound_script and node.kind.lower() not in PLAYED:
            out.append((node.kind, node.name))
        for ref in node.children:
            child = em._child_template(library, ref)
            if child is not None:
                queue.append(child)
    return out


def survey_level(task: tuple) -> dict:
    """One level's counts, with the library the bake builds for it."""
    game_dir, mod, name, scratch = task
    row = {"mod": mod, "level": name, "error": None, "hits": [], "static": 0,
           "other": []}
    try:
        ctx = sl.LevelContext(game_dir, mod, name, out=scratch)
        library = ctx.library
        info = ctx.info
    except Exception as exc:  # a truncated archive, a level with no terrain
        row["error"] = str(exc)
        return row
    for area in info.sounds.areas:
        if area.spawner:
            row["hits"].append(
                f"{name}: {area.name} under {area.spawner} "
                f"({area.file.rsplit('/', 1)[-1]})"
                f"{' modes ' + ','.join(area.modes) if area.modes else ''}")
        elif not area.name.endswith("_static"):
            row["static"] += 1
    spawned = {inst.template.lower()
               for inst, _m, _s in em.union_spawned_objects(info)}
    for template in sorted(spawned):
        for kind, node in other_sound_nodes(library, template):
            row["other"].append((kind, f"{template}/{node}"))
    return row


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game-dir", type=Path, default=GAME)
    ap.add_argument("--mods", nargs="*", default=["bf1942", "XPack1", "XPack2", "FH"])
    ap.add_argument("-j", "--jobs", type=int, default=4,
                    help="levels read at once (each holds a mod's library)")
    args = ap.parse_args()

    scratch = Path(tempfile.mkdtemp(prefix="spawned-sound-survey-"))
    for mod in args.mods:
        chain = mod_chain(args.game_dir, mod)
        tasks = [(args.game_dir, mod, name, scratch)
                 for name, _archive in discover_levels(chain)]
        with ProcessPoolExecutor(max_workers=max(1, args.jobs)) as pool:
            rows = list(pool.map(survey_level, tasks))
        failed = [r for r in rows if r["error"]]
        for r in failed:
            print(f"  [{mod}] {r['level']}: not read ({r['error']})", file=sys.stderr)
        hits = [h for r in rows for h in r["hits"]]
        other: Counter = Counter()
        levels_of: dict[str, set] = {}
        nodes_of: dict[str, set] = {}
        for r in rows:
            for kind, node in r["other"]:
                other[kind] += 1
                levels_of.setdefault(kind, set()).add(r["level"])
                nodes_of.setdefault(kind, set()).add(node)
        print(f"{mod}: {len(rows)} levels ({len(failed)} not read); "
              f"emitters under spawned objects {len(hits)}; "
              f"level sound objects on statics {sum(r['static'] for r in rows)}",
              flush=True)
        for line in hits:
            print(f"    {line}")
        for kind, count in other.most_common():
            print(f"    other {kind}: {count} on {len(levels_of[kind])} levels, "
                  f"{len(nodes_of[kind])} distinct "
                  f"({'; '.join(sorted(nodes_of[kind])[:6])})", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
