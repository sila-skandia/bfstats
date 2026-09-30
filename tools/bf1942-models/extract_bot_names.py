#!/usr/bin/env python3
"""Export the names a server gives its bots on each level, for the map page.

    python3 extract_bot_names.py --out ./viewer/maps/_shared/bot-names.json
    python3 extract_bot_names.py --mod DC_Final --out ./viewer/maps/mods/dc_final/_shared/bot-names.json
    python3 extract_bot_names.py --mod DesertCombat --list

How the engine names a bot (ledger AI-8, AI-134..AI-137):

* `GameServer::loadBots(0)` runs the level's `SinglePlayer/Skirmish.con` once,
  when the server starts. The dedicated server's only way in is
  `Setup::startHostGame`, which passes mode 0 (co-op included: the lab's Wake
  round named its Allies from `BritishNames`, the file `Skirmish.con` runs,
  not `Bots.con`'s `AmericanNames`). The script `run`s name files such as
  `bf1942/game/common/GermanNames`, resolved along `game.addModPath`, nearest
  mod first: a Desert Combat level that runs `germannames` gets DC's Arabic
  list, one that runs `britishnames` gets vanilla's, since DC ships none.
* Each name file is `game.addFirstNameOnTeam <team> <name>` and
  `game.addSecondNameOnTeam <team> <name>` lines. The team is written in the
  file, not chosen by the level; teams other than 1 and 2 are dropped. Both
  methods take exactly two arguments, so a line whose name is two words
  (DC's `Al Bahrani`) is refused by the console and adds nothing.
* `Game::getRandomNameForTeam` pairs the lists **by index**: a bot is
  `first[i] + " " + second[i]` for a random `i` below the shorter list's
  length (`game.randomNames` would pair them independently; no shipped script
  sets it). Twenty draws, then the pairs in order, then the last draw with
  `1`, `2`, ... appended; a team with an empty list is `Player`, `Player2`,
  ... The page does that part (`viewer/bot-names.js`).

This file therefore carries, per level, which name scripts its
`SinglePlayer/Skirmish.con` runs, in order, and each script's lists as the
console would build them. A level whose archives ship no `Skirmish.con` (DC's
own maps, Aberdeen, Coral Sea) loads no names: it is listed with none.

Levels are keyed by the lowercased archive stem, the directory
`extract_map.py` writes, like `_shared/loadouts.json`.

Standard library plus the system liblzo2, same as the rest of the pipeline.
"""

from __future__ import annotations

import argparse
import json
import posixpath
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.rfa import ArchivePool, find_archives_dir, find_game_dir

from extract_models import (DEFAULT_GAME_DIR, GAME_ARCHIVES, discover_levels,
                            level_underlay, mod_chain)

# The script `GameServer::loadBots(int)` 0x08131ef0 runs for any mode but 2
# (rodata 0x086bff13), under the level's own directory.
SKIRMISH_SCRIPT = "SinglePlayer/Skirmish.con"

# `Game::addFirstNameOnTeam` 0x0805fc70 / `addSecondNameOnTeam` 0x0805fce0,
# registered with min = max = 2 arguments (the record at 0x087800c0 writes
# 2 and 2 at +0x14 / +0x18). `OldConsole::handleCommand` refuses a line with
# more (`jg` at 0x083e4828 to "Too many arguments, the max no of arguments
# is").
NAME_METHODS = {"game.addfirstnameonteam": "first", "game.addsecondnameonteam": "second"}
NAME_ARGS = 2

# `Game` holds one list pair for each of teams 1 and 2 (`team - 1 < 2`).
TEAMS = (1, 2)


def tokenize(line: str) -> list[str]:
    """A console line's tokens, as `OldConsole::getArgs` 0x083de4d0 cuts them.

    Space and tab separate; a `"` opens a run that keeps its spaces and is
    not part of the token. Line ends are not the console's business here:
    they are stripped first.
    """
    tokens: list[str] = []
    current: list[str] = []
    quoted = False
    started = False
    for ch in line.rstrip("\r\n"):
        if ch == '"':
            quoted = not quoted
            started = True
            continue
        if not quoted and ch in " \t":
            if started:
                tokens.append("".join(current))
                current, started = [], False
            continue
        current.append(ch)
        started = True
    if started:
        tokens.append("".join(current))
    return tokens


def script_key(path: str) -> str:
    """A script path as the archive index spells it: forward slashes, lower
    case, `.con` added when the `run` line left it off (the console does)."""
    key = posixpath.normpath(path.replace("\\", "/")).lstrip("/").lower()
    if not posixpath.splitext(key)[1]:
        key += ".con"
    return key


@dataclass
class Segment:
    """The name commands one script issued between two of its `run` lines."""

    key: str
    teams: dict[int, dict[str, list[str]]] = field(default_factory=dict)
    rejected: list[str] = field(default_factory=list)

    def add(self, team: int, kind: str, name: str) -> None:
        lists = self.teams.setdefault(team, {"first": [], "second": []})
        lists[kind].append(name)

    def empty(self) -> bool:
        return not self.teams and not self.rejected


@dataclass
class Replay:
    """What running a level's bot script leaves in the name lists."""

    segments: list[Segment] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    origins: dict[str, str] = field(default_factory=dict)
    # `console.useRelativePaths` is the console's, not a script's: a script
    # that sets it leaves it set for the next. Every shipped script that
    # touches it ends on 1.
    relative: bool = True


Reader = Callable[[str], "tuple[str, str] | None"]


def replay(key: str, read: Reader, depth: int = 0,
           result: Replay | None = None) -> Replay:
    """Run script `key` the way the console does, keeping only name commands.

    `read(key)` returns `(text, origin)` or None. `run`/`include` descend
    into the named script (relative to this one's directory while
    `console.useRelativePaths` is 1, which is how every script leaves it);
    `rem` lines and `beginRem`..`endRem` blocks are skipped. A script's own
    commands between two `run` lines are one segment, so the lists come out
    in exactly the order the console appends to them.
    """
    result = result if result is not None else Replay()
    got = read(key)
    if got is None:
        result.missing.append(key)
        return result
    text, origin = got
    result.origins[key] = origin
    base = posixpath.dirname(key)
    in_rem = False
    part = 0

    def open_segment() -> Segment:
        return Segment(key if part == 0 else f"{key}#{part}")

    segment = open_segment()
    for raw in text.splitlines():
        tokens = tokenize(raw)
        if not tokens:
            continue
        word = tokens[0].lower()
        if in_rem:
            in_rem = word != "endrem"
            continue
        if word == "beginrem":
            in_rem = True
            continue
        if word == "rem":
            continue
        if word == "console.userelativepaths" and len(tokens) > 1:
            result.relative = tokens[1] != "0"
            continue
        if word in ("run", "include") and len(tokens) > 1 and depth < 16:
            if not segment.empty():
                result.segments.append(segment)
            part += 1
            segment = open_segment()
            target = tokens[1].replace("\\", "/")
            target = posixpath.join(base, target) if result.relative else target
            replay(script_key(target), read, depth + 1, result)
            continue
        kind = NAME_METHODS.get(word)
        if kind is None:
            continue
        args = tokens[1:]
        team = int(args[0]) if len(args) == NAME_ARGS and args[0].isdigit() else None
        if team not in TEAMS:
            segment.rejected.append(raw.strip())
            continue
        segment.add(team, kind, args[1])
    if not segment.empty():
        result.segments.append(segment)
    return result


def level_script(level_dir: str) -> str:
    return script_key(f"bf1942/levels/{level_dir}/{SKIRMISH_SCRIPT}")


def build_manifest(mod: str, levels: dict[str, Replay]) -> dict:
    """The page's file: every script segment once, and each level's in order."""
    scripts: dict[str, dict] = {}
    level_rows: dict[str, list[str]] = {}
    for name, run in sorted(levels.items()):
        keys = []
        for segment in run.segments:
            keys.append(segment.key)
            if segment.key in scripts:
                continue
            origin_key = segment.key.split("#", 1)[0]
            scripts[segment.key] = {
                "origin": run.origins.get(origin_key),
                "teams": {str(team): lists for team, lists in sorted(segment.teams.items())},
                **({"rejected": segment.rejected} if segment.rejected else {}),
            }
        level_rows[name.lower()] = keys
    return {
        "mod": mod,
        "script": SKIRMISH_SCRIPT,
        "scripts": dict(sorted(scripts.items())),
        "levels": level_rows,
    }


def _mod_of(path: Path, chain: list[Path]) -> str:
    """The chain mod an archive belongs to, for the manifest's `origin`."""
    for mod_dir in chain:
        if mod_dir in path.parents:
            return mod_dir.name
    return path.parent.name


def chain_reader(chain: list[Path]) -> Callable[[list[Path]], Reader]:
    """A factory for one level's reader over the chain's `Game.rfa`.

    A `run` path is looked up along `game.addModPath`, nearest mod first; the
    game archives and a level's archives hold disjoint paths, so the level's
    layers (its copies down the chain, patches first) sit beside the pool.
    """
    game = ArchivePool()
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        game_dir = find_game_dir(archives) if archives is not None else None
        if game_dir is None:
            continue
        # `ArchivePool.add_dir`'s order (a patch ahead of its base), with the
        # mod in the label.
        found = [child for child in game_dir.iterdir()
                 if child.is_file() and child.suffix.lower() == ".rfa"
                 and any(child.stem.lower() == p or child.stem.lower().startswith(f"{p}_")
                         for p in GAME_ARCHIVES)]
        for child in sorted(found, key=lambda p: p.stem.lower(), reverse=True):
            game.add(child, label=f"{mod_dir.name}/{child.name}")

    def for_level(layers: list[Path]) -> Reader:
        level = ArchivePool()
        for layer in layers:
            level.add(layer, label=f"{_mod_of(layer, chain)}/{layer.name}")

        def read(key: str) -> tuple[str, str] | None:
            for pool in (level, game):
                if key in pool:
                    blob = pool.try_read(key)
                    if blob is None:
                        return None
                    return blob.decode("latin-1"), pool.source_of(key)
            return None
        return read

    return for_level


def read_chain(chain: list[Path]) -> dict[str, Replay]:
    for_level = chain_reader(chain)
    out: dict[str, Replay] = {}
    for stem, _path in discover_levels(chain):
        layers = level_underlay(chain, stem)
        try:
            out[stem] = replay(level_script(stem), for_level(layers))
        except Exception as exc:
            # One unreadable level costs its own names, as it does every
            # other level reader here.
            print(f"  {stem}: unreadable ({exc})", file=sys.stderr)
    return out


def team_lists(manifest: dict, level: str) -> dict[int, dict[str, list[str]]] | None:
    """The lists a level leaves, per team, composed the way the page does."""
    keys = manifest["levels"].get(level.lower())
    if keys is None:
        return None
    teams = {team: {"first": [], "second": []} for team in TEAMS}
    for key in keys:
        for team, lists in manifest["scripts"][key]["teams"].items():
            for kind in ("first", "second"):
                teams[int(team)][kind] += lists[kind]
    return teams


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path, default=None,
                    help="default: viewer/maps/_shared/bot-names.json for bf1942, "
                         "viewer/maps/mods/<mod>/_shared/bot-names.json otherwise")
    ap.add_argument("--list", action="store_true",
                    help="print each level's pairs per team without writing anything")
    args = ap.parse_args()

    chain = mod_chain(args.game_dir.expanduser(), args.mod)
    if not chain:
        print(f"no mod chain for {args.mod}", file=sys.stderr)
        return 1
    manifest = build_manifest(args.mod, read_chain(chain))

    for level in manifest["levels"]:
        teams = team_lists(manifest, level)
        cells = []
        for team in TEAMS:
            lists = teams[team]
            pairs = min(len(lists["first"]), len(lists["second"]))
            sample = f" {lists['first'][0]} {lists['second'][0]}" if pairs else ""
            cells.append(f"team {team}: {pairs} pairs{sample}")
        if args.list or not manifest["levels"][level]:
            print(f"  {level:32s} {'; '.join(cells)}"
                  + ("" if manifest["levels"][level] else "  (no Skirmish.con: Player, Player2, ...)"))
    rejected = sum(len(s.get("rejected", [])) for s in manifest["scripts"].values())
    print(f"{args.mod}: {len(manifest['levels'])} levels, {len(manifest['scripts'])} name scripts"
          + (f", {rejected} lines the console refuses" if rejected else ""))
    if args.list:
        return 0

    root = Path(__file__).resolve().parent / "viewer" / "maps"
    out = args.out or (root / "_shared" / "bot-names.json" if args.mod.lower() == "bf1942"
                       else root / "mods" / args.mod.lower() / "_shared" / "bot-names.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
