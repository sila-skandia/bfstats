"""Which script a game mode runs: the level's root `<Mode>.con` against its
`GameTypes/<Mode>.con`, across every installed mod's levels.

Run from the repository root. Backs ledger row TKT-2: the dedicated server runs
`bf1942/levels/<level>/<mode>.con` (`Game::load` 0x0805b4b0 joins the level path
and the startup name), and `GameTypes/<mode>.con` is only checked for existence
when a map is queued (`Setup::setNextLevel` 0x080bf160). The exporter read the
GameTypes copy. This counts where the two differ in what a round starts with:
the tickets, the bleed, the layer files the script runs, and any other command
that moves the ticket arithmetic (`maxNrOfPlayers`, the ratios).

    python3 features/bf1942-engine-reference/surveys/mode_script_root_vs_gametypes.py
    python3 .../mode_script_root_vs_gametypes.py --mods bf1942 XPack1 XPack2 --detail

A level is read the way the extractor reads it (`find_level_archives` over the
mod's inheritance chain, patches over the base, the nearest mod winning), so
"root" and "GameTypes" are the files the engine's case-insensitive,
first-mounted-wins lookup would open for that mod.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, 'tools/bf1942-models')  # relative to the repo root
from bf42 import con as con_mod  # noqa: E402
from bf42.level import (find_level_archives, load_level_files,  # noqa: E402
                        parse_tickets)
from bf42.rfa import find_archives_dir, find_levels_dir  # noqa: E402
from extract_models import mod_chain  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
# The startup names `Setup::startHostGame` 0x080c4080 hands to setGameStartup,
# per GPM: 1 ctf, 2 conquest, 3 tdm, 4 coop, 5 ObjectiveMode.
MODES = ("Conquest", "Ctf", "Tdm", "Coop", "ObjectiveMode")
RUN = re.compile(r"^\s*run\s+(\S+)", re.I)
# Commands that change what `gamaStatusFirstPreGame` 0x08150710 or the bleed
# computes, besides the two `parse_tickets` reads.
EXTRA = re.compile(r"^\s*game\.(maxnrofplayers|setnumberofticketperplayer|"
                   r"setticketratio|setteamratio|setticketlostatendpermin|"
                   r"setticketloseperdeath|setcurrentnumberoftickets)\b(.*)$",
                   re.I | re.M)


def own_levels(mod_dir: Path) -> list[str]:
    """The levels a mod ships archives for itself (not the ones it inherits)."""
    archives = find_archives_dir(mod_dir)
    levels = find_levels_dir(archives) if archives else None
    if levels is None:
        return []
    names = set()
    for rfa in levels.iterdir():
        if rfa.suffix.lower() != ".rfa":
            continue
        stem = rfa.stem
        base, _, tail = stem.rpartition("_")
        names.add((base if base and tail.isdigit() else stem).lower())
    return sorted(names)


def summary(text: str) -> dict:
    body = con_mod.strip_comments(text)
    t = parse_tickets(body)
    runs = [m.group(1).replace("\\", "/").lower() for m in map(RUN.match, body.splitlines()) if m]
    extra = sorted({(m.group(1).lower(), m.group(2).strip()) for m in EXTRA.finditer(body)})
    return {"tickets": (t.team1, t.team2), "loss": (t.loss_per_min_team1, t.loss_per_min_team2),
            "runs": runs, "extra": extra}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mods", nargs="*", help="mod folder names (default: every installed mod)")
    ap.add_argument("--detail", action="store_true", help="print every differing level")
    args = ap.parse_args()
    mods_dir = GAME / "Mods"
    by_lower = {d.name.lower(): d for d in mods_dir.iterdir() if d.is_dir()}
    wanted = [by_lower[m.lower()] for m in args.mods] if args.mods else sorted(by_lower.values())
    grand: dict[str, int] = {}
    for mod_dir in wanted:
        chain = mod_chain(GAME, mod_dir.name)
        tally: dict[str, int] = {}
        details: list[str] = []
        for level in own_levels(mod_dir):
            paths = find_level_archives(GAME, mod_dir.name, level, chain=chain)
            if not paths:
                continue
            try:
                files = load_level_files(paths, level)
            except Exception as error:  # a damaged archive: say so, keep going
                details.append(f"  {level}: unreadable ({error})")
                continue
            for mode in MODES:
                root = files.find(f"{mode}.con")
                gt = files.find(f"GameTypes/{mode}.con")
                if not root and not gt:
                    continue
                key = ("root+gt" if root and gt else "root only" if root else "gametypes only")
                tally[f"{mode}: {key}"] = tally.get(f"{mode}: {key}", 0) + 1
                if not (root and gt):
                    if gt and args.detail:
                        details.append(f"  {level} {mode}: no root script (the server runs nothing for it)")
                    continue
                r = summary(files.read(root).decode("latin-1", "replace"))
                g = summary(files.read(gt).decode("latin-1", "replace"))
                for field in ("tickets", "loss", "runs", "extra"):
                    if r[field] != g[field]:
                        tally[f"{mode}: {field} differ"] = tally.get(f"{mode}: {field} differ", 0) + 1
                        if args.detail:
                            show = (lambda v: v) if field != "runs" else (lambda v: [x for x in v if "/" in x])
                            details.append(f"  {level} {mode} {field}: root {show(r[field])}  gametypes {show(g[field])}")
                if r["extra"]:
                    tally[f"{mode}: root sets {'/'.join(sorted({c for c, _ in r['extra']}))}"] = \
                        tally.get(f"{mode}: root sets {'/'.join(sorted({c for c, _ in r['extra']}))}", 0) + 1
        print(f"{mod_dir.name}:")
        for k, v in sorted(tally.items()):
            print(f"    {k}: {v}")
            grand[k] = grand.get(k, 0) + v
        for line in details:
            print(line)
    print("all:")
    for k, v in sorted(grand.items()):
        print(f"    {k}: {v}")


if __name__ == "__main__":
    main()
