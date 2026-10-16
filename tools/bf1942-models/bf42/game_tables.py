"""Two tables a retail client builds from its own install, for the UDP sidecar.

The sidecar (`sidecar/`) joins a real server with no game running, so what
BF1942.exe derives from the game files at load time it has to derive the same
way. These two used to be lifted from bf42plus client recordings; this module
reads them from the install instead (`sidecar_tables.py` is the command line
the sidecar runs, `sidecar/game-tables.mjs` the caller).

**The animation state table.** `AnimationStateMachine` (one per process,
`dice::anim::activeAnimationStateMachine`, lnxded 0x0873fc9c) holds its states
in a vector at `+0x10` in creation order and their names in a
`std::map<string,int>` at `+0x41c` (`findState` 0x08328610). The vector is
what `animations/AnimationStates.con` builds through `createState` /
`copyState` / `copyState2`, under the file rules `bf42/animstates.py` follows
(ledger ANIM-16: a clip the install lacks is not added, a copy never replaces
a state, a copy left with no clip is deleted). `Game::load` rebuilds it at
every level load with the level mounted, so it is a level's table as much as
a mod's (`anim_state_table`). A soldier's ghost body carries
its lower and upper state as an index into that vector, read in
`readUnsigned(0, count - 1)` bits, so the sidecar needs the count to decode a
body at all and the names to say what the soldier is doing. Each state's
flag word (`+0x24`, `getCurrentStateFlags` 0x0832b110) is the OR of its
`setFlag` lines, whose `c_Asm*` constants `ObjTemplBFModule::init`
(0x082986d0) registers with `addConstantHelper` (0x08298280) at
0x0829911a..0x0829923a.

**Control point names.** `ObjectTemplate.setControlPointName <word>`
(`ConsoleClass651::executeObjectMethod`, lnxded 0x08309c90) assigns the word
to the active template's `+0x1e4`. The word is a lexicon key: the English
`lexiconAll.dat` turns `Landing_Beach` into "Landing Beach". The templates
are the level's, declared by the files the round's game type script runs:
the level's root `<mode>.con` (ledger TKT-3) runs `<layer>/ControlPointTemplates`
outside its `if v_arg1 == host` arm, so a joining client declares the same
templates the host does.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from pathlib import Path

from . import animstates
from . import level as level_mod
from .rfa import ArchivePool, find_archives_dir

# `ObjTemplBFModule::init` 0x082986d0: the `c_Asm*` console constants, as
# `addConstantHelper(name, value)` registers them (lnxded 0x0829911a..
# 0x0829923a). The other four it registers (`c_AsmLooping` 1,
# `c_AsmPlayLooping` 1, `c_AsmPlayOnce` 0, `c_AsmFaceState` 0) are clip and
# other-state words, not flags.
ASM_FLAGS = {
    "c_asmhideweapon": 0x02,
    "c_asmlockfreelook": 0x04,
    "c_asmisswimming": 0x08,
    "c_asmisclimbing": 0x10,
    "c_asmiscrouching": 0x20,
    "c_asmislying": 0x40,
}


def flag_value(word: str) -> int | None:
    """A `setFlag` argument's value: a known constant or a plain integer."""
    key = word.strip().lower()
    if key in ASM_FLAGS:
        return ASM_FLAGS[key]
    try:
        return int(key, 0)
    except ValueError:
        return None


def mounted_archives(chain: Iterable[Path]) -> list[Path]:
    """Every top-level archive of a mod chain (nearest mod first, a patch
    before its base), as `game.addModPath` mounts them. The level and
    `Game.rfa` archives one folder down (`Archives/bf1942/`) are not here."""
    out: list[Path] = []
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        if archives is None:
            continue
        found = [child for child in archives.iterdir()
                 if child.is_file() and child.suffix.lower() == ".rfa"]
        out.extend(sorted(found, key=lambda p: p.stem.lower(), reverse=True))
    return out


def level_archives(game_dir: Path, mod: str, chain: list[Path], level: str) -> list[Path]:
    """A level's archive and its patches in every mod of the chain, in
    `find_level_archives`' overlay order (farthest mod first, base before
    patch, so the last one wins)."""
    level = level.strip("/").split("/")[-1]
    return level_mod.find_level_archives(game_dir, mod, level, chain=chain)


def anim_state_table(chain: list[Path], warn: Callable[[str], None] | None = None,
                     level: list[Path] | None = None,
                     ) -> tuple[list[list], list[Path]]:
    """The engine's animation state vector for a mod on a level:
    `[index, name, flags]` rows in index order, and the archives read.

    `Game::load` (0x0805b4b0) runs `Animations/AnimationStates.con`
    (.rodata 0x086b1740, at 0x0805bb36) on every level load, after the
    level's `Init.con` (0x0805b940) and before `objects/` (0x0805bc39), and
    the script's first line `AnimationStateMachine.init` (0x08327250)
    deletes the old machine and builds a new one. So the table is the level's
    as well as the mod's: FH, FHSW and FHSWEurope levels ship
    `bf1942/levels/<L>/animations/` scripts and clips that the chain's
    scripts run and copy (ledger LOAD-10). `level` is that level's archives
    (`level_archives`); their `animations/` folder is searched ahead of the
    chain, nearest copy first, the order `extract_viewmodel` reads them in
    (which copy wins a name both ship is not traced; no shipped level does)."""
    paths = mounted_archives(chain)
    pool = ArchivePool()
    level_used: list[Path] = []
    for path in reversed(level or []):
        if pool.add_level_root(path, ("animations",)):
            level_used.append(path)
    for path in paths:
        pool.add(path)
    paths = level_used + paths

    def read(path: str) -> str | None:
        blob = pool.try_read(path)
        return blob.decode("latin-1") if blob is not None else None

    try:
        machine = animstates.parse(read, has_clip=lambda p: pool.find(p) is not None)
    finally:
        for _label, archive in pool._archives:
            archive.close()
    unknown: set[str] = set()
    rows: list[list] = []
    for index, state in enumerate(machine.states.values()):
        flags = 0
        for word in state.flags:
            value = flag_value(word)
            if value is None:
                unknown.add(word)
                continue
            flags |= value
        rows.append([index, state.name, flags])
    if unknown and warn:
        warn(f"setFlag words with no known value (counted as 0): {sorted(unknown)}")
    return rows, paths


_CREATE = re.compile(r"^\s*objecttemplate\.create\s+(\S+)\s+(\S+)", re.IGNORECASE)
_ACTIVE = re.compile(r"^\s*objecttemplate\.active(?:template)?\s+(\S+)", re.IGNORECASE)
_CP_NAME = re.compile(r"^\s*objecttemplate\.setcontrolpointname\s+(\S+)", re.IGNORECASE)


def control_point_names_from_lines(lines: Iterable[str]) -> dict[str, str]:
    """Control point template -> its `setControlPointName` word, from the
    lines a level load runs, in order. The setter writes the active
    template, which `ObjectTemplate.create` and `ObjectTemplate.active` set;
    a template created again keeps the name its last block gave it."""
    out: dict[str, str] = {}
    spelled: dict[str, str] = {}      # lower -> the spelling `create` used
    active: str | None = None
    for line in lines:
        made = _CREATE.match(line)
        if made:
            kind, name = made.group(1).lower(), made.group(2)
            active = name if kind == "controlpoint" else None
            if active is not None:
                spelled.setdefault(name.lower(), name)
            continue
        picked = _ACTIVE.match(line)
        if picked:
            key = picked.group(1).lower()
            active = spelled.get(key)
            continue
        named = _CP_NAME.match(line)
        if named and active is not None:
            out[spelled[active.lower()]] = named.group(1)
    return out


def control_point_names(game_dir: Path, mod: str, chain: list[Path], level: str,
                        mode: str, arg: str = "client",
                        ) -> tuple[dict[str, str], list[Path]]:
    """`{template: setControlPointName word}` for the control points a round
    of `mode` on `level` declares, and the level archives read. `arg` is the
    script's `v_arg1`: a joining client is not `host`."""
    level = level.strip("/").split("/")[-1]
    mode = re.sub(r"\.con$", "", mode.strip(), flags=re.IGNORECASE)
    paths = level_archives(game_dir, mod, chain, level)
    if not paths:
        raise FileNotFoundError(f"no archive for level {level!r} in {mod}")
    files = level_mod.load_level_files(paths, level)
    try:
        script = level_mod.game_type_script(files, mode)
        if script is None:
            raise FileNotFoundError(f"{level} has no {mode}.con")
        lines: list[str] = []
        for _path, run in level_mod.script_files(files, script, [arg]):
            lines.extend(run)
    finally:
        for archive in files.archives:
            archive.close()
    return control_point_names_from_lines(lines), paths
