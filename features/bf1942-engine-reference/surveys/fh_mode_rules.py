"""Forgotten Hope's game rules as data: every level's control points per game
type, the tickets its script sets, and every command its mode scripts run.

Run from the repository root. Backs `features/fh-mod-extraction/`.

    python3 features/bf1942-engine-reference/surveys/fh_mode_rules.py \
        --levels Gold_Beach-1944 Omaha_Charlie-Sector-1944      # per-point dump
    python3 features/bf1942-engine-reference/surveys/fh_mode_rules.py --census

The dump walks each game type's ROOT script the way a host does (TKT-3,
`bf42.level.script_files`), then reads the control point layer from the
directories that script runs (`GameType.files`). The census counts every
`namespace.command` in the chains of every level of the mod, with the number of
levels that use it, and lists the `if` conditions that are not the host check.

`--mod` takes any installed mod folder (default FH).
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, 'tools/bf1942-models')  # relative to the repo root
from bf42 import level as lv  # noqa: E402
from bf42.rfa import RfaArchive  # noqa: E402,F401
from extract_models import discover_levels, mod_chain  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
LAW_FIELDS = ("team", "radius", "only_takeable_by_team", "time_to_get_control",
              "time_to_lose_control", "lose_control_when_enemy_close",
              "lose_control_when_not_close", "disable_when_losing_control",
              "disable_if_enemy_inside_radius", "unable_to_change_team",
              "area_value", "spawn_group_id", "second_spawn_group_id",
              "object_spawner_id", "min_nr_to_take_control")


def open_level(mod: str, level: str, chain):
    paths = lv.find_level_archives(GAME, mod, level, chain=chain)
    return lv.load_level_files(paths, level)


def dump_level(files, level: str) -> None:
    print(f"\n######## {level}")
    gts = lv.load_game_types(files)
    for name, gt in gts.items():
        gp = lv.load_gameplay_objects(files, gt.mode, sources=gt.files or None)
        print(f"\n== {name}: script {gt.source}, layer {gt.mode}, files {gt.files}")
        print(f"   runs {gt.runs}")
        tk = gt.tickets
        if tk:
            print(f"   tickets {tk}")
        placed = gp.created_control_points()
        print(f"   {len(placed)} control points")
        for inst in placed:
            t = gp.template_for(inst)
            short = {"team": "team", "radius": "r", "only_takeable_by_team": "only",
                     "time_to_get_control": "get", "time_to_lose_control": "lose",
                     "lose_control_when_enemy_close": "enemyClose",
                     "lose_control_when_not_close": "notClose",
                     "disable_when_losing_control": "disWhenLosing",
                     "disable_if_enemy_inside_radius": "disIfEnemyIn",
                     "unable_to_change_team": "unable", "area_value": "area",
                     "spawn_group_id": "grp", "second_spawn_group_id": "grp2",
                     "object_spawner_id": "spawner", "min_nr_to_take_control": "min"}
            vals = []
            for f in LAW_FIELDS:
                v = getattr(t, f)
                if isinstance(v, float) and v == int(v):
                    v = int(v)
                vals.append(f"{short[f]}={'-' if v is None else int(v) if isinstance(v, bool) else v}")
            print(f"   - {inst.template} ({t.display_name}) at "
                  f"{[round(c) for c in inst.position]}: " + " ".join(vals))
        for g, s in sorted(gp.spawn_groups.items()):
            print(f"   group {g}: team={s.team} ai={int(s.only_for_ai)} "
                  f"human={int(s.only_for_human)} changeTeam={int(s.enable_to_change_team)}")


_CMD = re.compile(r"^\s*([A-Za-z_][\w]*)\.([\w]+)", re.IGNORECASE)
_BARE = re.compile(r"^\s*([A-Za-z_]\w*)\b")


def census(mod: str, chain) -> None:
    cmd_levels: dict[str, set] = defaultdict(set)
    cmd_count: Counter = Counter()
    conds: Counter = Counter()
    cond_levels: dict[str, set] = defaultdict(set)
    levels = [n for n, _a in discover_levels(chain)]
    unread = 0
    for level in levels:
        try:
            files = open_level(mod, level, chain)
            gts = lv.load_game_types(files)
        except Exception:
            unread += 1
            continue
        seen: set = set()
        # Init.con is run by `Game::load` before the mode script (SPAWNGRP-9).
        starts = [("init", files.find("Init.con"))]
        starts += [(name, gt.source) for name, gt in gts.items()]
        for name, source in starts:
            if not source or source in seen:
                continue
            seen.add(source)
            gt = type("S", (), {"source": source})
            try:
                chain_files = lv.script_files(files, gt.source)
            except Exception:
                continue
            for _path, lines in chain_files:
                for line in lines:
                    m = _CMD.match(line)
                    if m:
                        key = f"{m.group(1).lower()}.{m.group(2).lower()}"
                    else:
                        b = _BARE.match(line)
                        if not b or b.group(1).lower() in ("rem", "run", "include"):
                            continue
                        key = b.group(1).lower()
                    cmd_count[key] += 1
                    cmd_levels[key].add(level)
        # raw `if` conditions, host/client checks apart
        for rel in files.names():
            if rel.lower().endswith(".con") and "/levels/" in rel.lower():
                text = files.read(rel).decode("latin-1", "replace")
                for line in text.splitlines():
                    s = line.strip()
                    if re.match(r"(?i)(if|elseif)\s", s):
                        c = re.sub(r"\s+", " ", s.lower())
                        if c in ("if v_arg1 == host", "if v_arg1 == client",
                                 "if v_arg1 == \"host\"", "if v_arg1 == \"client\""):
                            continue
                        conds[c] += 1
                        cond_levels[c].add(level)
    print(f"{len(levels)} levels, {unread} unreadable")
    print("\n# commands in the mode-script chains (count, levels)")
    for key, n in sorted(cmd_count.items()):
        print(f"{key:55s} {n:6d} {len(cmd_levels[key]):4d}")
    print("\n# non-host `if` conditions anywhere in a level's con files")
    for c, n in conds.most_common():
        print(f"{n:5d} {len(cond_levels[c]):3d}  {c}")


def game_types_census(mod: str, chain) -> None:
    """Which game types a level can be started in, against what it ships.

    `Setup::setNextLevel` 0x080bf160 queues a mode only if
    `GameTypes/<mode>.con` exists (TKT-3), and the server then runs the ROOT
    `<mode>.con`. So a root script without a `GameTypes/` file is never run,
    and a `GameTypes/` file without a root script falls back to its own copy
    (`game_type_script`), whose `run` lines may name layer files the archive
    does not hold.
    """
    levels = [n for n, _a in discover_levels(chain)]
    unreachable, fallback, missing_layer = [], [], []
    modes: Counter = Counter()
    for level in levels:
        try:
            files = open_level(mod, level, chain)
        except Exception:
            continue
        offered = {rel.rsplit("/", 1)[-1][:-4].lower()
                   for rel in files.under("GameTypes") if rel.lower().endswith(".con")}
        for mode in offered:
            modes[mode] += 1
        for root in ("conquest", "coop", "ctf", "tdm", "objectivemode", "singleplayer"):
            if files.find(f"{root}.con") and root not in offered:
                unreachable.append((level, root))
        for mode in sorted(offered):
            if not files.find(f"{mode}.con") and files.find(f"GameTypes/{mode}.con"):
                fallback.append((level, mode))
        try:
            for name, gt in lv.load_game_types(files).items():
                for run in gt.runs:
                    if "/" in run and not files.find(run + ".con"):
                        missing_layer.append((level, name, run))
        except Exception:
            pass
    print(f"{len(levels)} levels; game types offered: {dict(modes)}")
    print(f"root script with no GameTypes/ file (never started): {len(unreachable)}")
    for row in unreachable:
        print("   ", row)
    print(f"GameTypes/ file with no root script (its own copy runs): {len(fallback)}")
    for row in fallback:
        print("   ", row)
    print(f"run lines naming a layer file the archive lacks: {len(missing_layer)}")
    for row in missing_layer[:60]:
        print("   ", row)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mod", default="FH")
    ap.add_argument("--levels", nargs="*")
    ap.add_argument("--census", action="store_true")
    ap.add_argument("--gametypes", action="store_true")
    args = ap.parse_args()
    chain = mod_chain(GAME, args.mod)
    if args.census:
        census(args.mod, chain)
    if args.gametypes:
        game_types_census(args.mod, chain)
    for level in args.levels or []:
        dump_level(open_level(args.mod, level, chain), level)


if __name__ == "__main__":
    main()
