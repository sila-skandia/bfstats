r"""Each installed mod's Conquest script, as the map dossier extractor reads it.

Run from the repository root. Read-only. Uses `scripts/extract_map_dossiers.py`'s
own level reading (patch archives over the base, the mod's inheritance chain
underlaid nearest first), so every count is about the files a dossier is built
from. Backs the map dossier's use of ledger TKT-1, TKT-3 and TKT-4
(`features/map-dossier/README.md`).

    python3 features/bf1942-engine-reference/surveys/dossier_conquest_scripts.py

Per mod it reports:

  script    Conquest levels, and whether each runs a root `Conquest.con` or has
            only `GameTypes/Conquest.con` (the fallback the extractor takes)
  inherited the root script is a parent mod's copy of the level (the level
            ships none of its own), and whether the level's own `GameTypes/`
            copy states different numbers, which the server never runs
  moves     dossiers whose tickets or bleed differ between the GameTypes-first
            read the extractor used until 2026-09-27 and the root-first read
  gains     the GameTypes-first read found no tickets at all and the root
            script states them; and how many `GameTypes/` copies are only a
            `run ..\Conquest.con` that hands over to the root script
  extra     script commands besides the two the dossier reads that change the
            round's ticket arithmetic (`maxNrOfPlayers`, the ratios)
  layers    the dossier reads `Conquest/{ControlPoints,ControlPointTemplates,
            ObjectSpawnTemplates,ObjectSpawns}.con` directly; whether the
            script actually runs each from `Conquest/` (nested `run`s followed)

Measured 2026-09-27 over the 15 installed mods (1,134 Conquest levels):
every Conquest level has a root script, so the `GameTypes/` fallback never
applies to Conquest; no script sets any `extra` command, so every dossier's
numbers are a 16-player server's at the server's ticket ratio; and every layer
file the dossier reads is one the script runs from `Conquest/` (the five levels
that never run one, four copies of Coral Sea and EoD's cs_minimetzel, ship no
such file). Root first moves 176 dossiers: 15 in bf1942 / XPack1 / XPack2,
republished that day, and 161 in 12 other mods, not republished (the
vanilla-only extraction scope in `CLAUDE.md`). 32 of those gain numbers from
nothing: bf1918 levels whose `GameTypes/Conquest.con` is the single line
`run ..\Conquest.con`, which the GameTypes-first read took for a script that
sets no tickets. 28 levels run a parent's root script; one (FHSW's crete-1941)
ships a `GameTypes/` copy that disagrees with it.
"""
from __future__ import annotations

import posixpath
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, "scripts")  # relative to the repo root
import extract_map_dossiers as dossiers  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
READ = ("controlpoints", "controlpointtemplates", "objectspawntemplates", "objectspawns")
RUN = re.compile(r"^\s*run\s+(\S+)", re.I | re.M)
EXTRA = re.compile(r"^\s*game\.(maxnrofplayers|setnumberofticketperplayer|setticketratio|"
                   r"setteamratio|setticketlostatendpermin|setticketloseperdeath|"
                   r"setcurrentnumberoftickets)\b(.*)$", re.I | re.M)


def numbers(text: str) -> list[tuple]:
    """Each team's (tickets, bleed) as the dossier parses them out of `text`."""
    level = dossiers.LevelFiles()
    level._files["conquest.con"] = text
    return [(t["tickets"], t["ticketLossPerMin"]) for t in dossiers.parse_teams(level)]


def runs(files: dossiers.LevelFiles, key: str, depth: int = 0, seen: set | None = None) -> list[str]:
    """Every file `key` runs, following runs of the level's other scripts.

    A `run` resolves against the including script's own directory, then the
    level root, as the exporter's `_resolve_run` (`tools/bf1942-models/bf42/level.py`)
    does. A root script sits at the level root, so its own runs read the same
    either way.
    """
    seen = set() if seen is None else seen
    if key in seen or depth > 4:
        return []
    seen.add(key)
    here = posixpath.dirname(key)
    out = []
    for target in RUN.findall(files._files.get(key, "")):
        rel = target.strip('"').replace("\\", "/").lower().removesuffix(".con")
        candidates = [posixpath.normpath(posixpath.join(here, rel))] if here else []
        candidates.append(posixpath.normpath(rel))
        path = next((c for c in candidates if c + ".con" in files._files), candidates[-1])
        out.append(path)
        out += runs(files, path + ".con", depth + 1, seen)
    return out


def main() -> None:
    mod_dirs = {p.name.lower(): p for p in (GAME / "Mods").iterdir() if p.is_dir()}
    own = {name: dossiers.read_levels(path) for name, path in mod_dirs.items()}
    for name, mod_dir in sorted(mod_dirs.items()):
        # The extractor's underlay, on copies: it mutates the level it is given.
        levels = {}
        for level, files in own[name].items():
            levels[level] = dossiers.LevelFiles()
            levels[level]._files = dict(files._files)
        for parent in dossiers.mod_search_path(mod_dir)[1:]:
            if parent in own and mod_dirs[parent] != mod_dir:
                for level, files in levels.items():
                    if level in own[parent]:
                        files.underlay(own[parent][level])
        tally: Counter = Counter()
        seen: defaultdict = defaultdict(list)
        for level, files in sorted(levels.items()):
            root = files._files.get("conquest.con")
            gt = files._files.get("gametypes/conquest.con")
            if root is None and gt is None:
                continue
            tally["conquest levels"] += 1
            script = root if root is not None else gt
            tally["script: root" if root is not None else "script: GameTypes only"] += 1
            if root is not None and "conquest.con" not in own[name][level]._files:
                mine = own[name][level]._files.get("gametypes/conquest.con")
                differs = mine is not None and numbers(mine) != numbers(root)
                tally["inherited root" + (", own GameTypes differs" if differs else "")] += 1
                if differs:
                    seen["inherited root, own GameTypes differs"].append(level)
            # The read this replaced: GameTypes/ first, and an empty file skipped.
            before = gt if gt else (root or "")
            if numbers(before) != numbers(script):
                tally["moves"] += 1
            if (all(t is None for t, _ in numbers(before))
                    and any(t is not None for t, _ in numbers(script))):
                tally["gains: the GameTypes-first read found no tickets"] += 1
            if gt and any(r.replace("\\", "/").lower().removesuffix(".con") == "../conquest"
                          for r in RUN.findall(gt)):
                tally["GameTypes/ copy runs the root script"] += 1
            for command, argument in EXTRA.findall(script):
                tally[f"extra: {command.lower()}"] += 1
                seen[f"extra {command.lower()}"].append(f"{level} {argument.strip()}")
            ran = runs(files, "conquest.con" if root is not None else "gametypes/conquest.con")
            for base in READ:
                where = sorted({r.rsplit("/", 1)[0] for r in ran
                                if "/" in r and r.rsplit("/", 1)[1] == base})
                if where == ["conquest"]:
                    continue
                shipped = f"conquest/{base}.con" in files._files
                label = (f"from {'+'.join(where)}/" if where else "never run") + \
                        (", dossier reads it" if shipped else ", not shipped")
                tally[f"layers: {base} {label}"] += 1
                seen[f"{base} {label}"].append(level)
        if not tally:
            continue
        print(f"{name}:")
        for key, count in sorted(tally.items()):
            print(f"    {key}: {count}")
        for key, found in sorted(seen.items()):
            print(f"    e.g. {key}: {', '.join(found[:6])}{' ...' if len(found) > 6 else ''}")


if __name__ == "__main__":
    main()
