"""The object template id table a level load builds, computed from the game files.

The server's CreateObject event (0x07) names an object's template by a u32 id,
never by name. The id is the template's place in the order the process first
created template names: `ObjectTemplateManager::createTemplate(uint classId,
string name)` (lnxded 0x081d5a30; the client's copy is BF1942.exe 0x0056db00,
the same code) looks the name up case-blind, returns the existing template
when it is there (LOAD-1), returns nothing when the class manager knows no
such class, and otherwise stamps the new template with the counter at
`this+0x20` and increments it. Nothing else writes the counter: the
constructor zeroes it (lnxded 0x081d52c0, client 0x0056e160) and `deleteAll`
(lnxded 0x081d6020, client 0x0056d9f0), which `Game::load` calls at the top
of every level load, leaves it alone. It starts again only because the
process does: the dedicated server re-executes itself at the end of a
level's last round (`GameServer::gameStatusEndGame` 0x08152ca0 ->
`Setup::restartBf1942exe` 0x080c7290 -> `execl`), and a joined client
relaunches itself with `+restart 1 +joinServer` when the server announces the
change (GameStatus 5; BF1942.exe 0x0048ff90 -> 0x006b4130 -> 0x00454dd0,
`CreateProcessA`). Ledger LOAD-12..LOAD-18.

So a level's table is a pure function of the install, the mod, the level and
the game type. Id 0 is the code-made `ObjectManagerCamera`
(`ObjectManager::getCamera` 0x0819e2f0 creates it, class `Camera`, before the
first level); the level's templates count from 1, in this order:

1. the level's `Init.con` and everything it runs (`Game::load` 0x0805b4b0,
   after `deleteAll` at 0x0805b77b);
2. every `.con` the FileManager lists under `objects/` (`loadAllConFiles`
   0x0805a830: each mod's `objects` archives, one key per path, opened from
   the nearest mod, run in `strcasecmp` order, `/ai/` paths only on an AI
   level; LOAD-5, LOAD-8);
3. the level's root `<mode>.con` with `v_arg1 = host` (TKT-3).

The console rules that decide which `ObjectTemplate.create` lines run at all
are the engine's (`OldConsole::handleCommand` 0x083de990, `run` 0x083ec3c0):
`rem` lines, `beginRem`/`endRem` nesting up to ten deep, `if`/`elseIf`/`else`/
`endIf` on `v_arg<N>` and `var` variables, `return`, `run`/`include` relative
to the running file unless `console.useRelativePaths 0`, `.con` appended to a
name with no dot, `echo X -> v_y`, and `game.gamePlayMode -> v_y` (FH's
`bf1942/game/is_coop.con` sets `v_is_coop` that way). A `create` line with
more than two arguments creates nothing (FHSW's `ObjectTemplate.create
SimpleObject SimpleObject KV2RaseiniaSimple`; measured, not traced).

Checked against every tid a recording names: the 19 vanilla tables in
`sidecar/templates/`, lab server recordings of Desert Combat, FHSW and
FHSWEurope, and BF1942.exe client recordings on public vanilla and Secret
Weapons servers (`tests/test_template_table.py`).
"""

from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass, field
from pathlib import Path

from .rfa import RfaArchive, find_archives_dir

# `game.gamePlayMode` per game type script (`Setup::startHostGame` 0x080c4080
# hands `setGameStartup` the script by GPM; TKT-3).
PLAY_MODES = {
    "ctf": "GPM_CTF",
    "conquest": "GPM_CQ",
    "tdm": "GPM_TDM",
    "coop": "GPM_COOP",
    "objectivemode": "GPM_OBJECTIVEMODE",
}

# Id 0: `ObjectManager::getCamera` (lnxded 0x0819e2f0, client 0x005030e0)
# creates this template from code, class `Camera`, before any level loads.
CODE_TEMPLATE = "ObjectManagerCamera"

_PATCH = re.compile(r"^(.*)_(\d+)$")
_VAR = re.compile(r"^v_arg(\d+)$", re.IGNORECASE)
# `OldConsole::handleCommand`'s beginRem refuses to nest past ten.
_MAX_REM_DEPTH = 10
_MAX_RUN_DEPTH = 32


def mode_name(mode: str | None) -> str:
    """`conquest.con` / `Conquest` / `GPM_CQ` -> `conquest`."""
    m = re.sub(r"\.con$", "", str(mode or "conquest").strip(), flags=re.IGNORECASE).lower()
    for name, gpm in PLAY_MODES.items():
        if m == gpm.lower():
            return name
    return m


def level_name(level: str) -> str:
    """`bf1942/levels/wake/` -> `wake`."""
    return re.split(r"[\\/]", str(level).strip().rstrip("/\\"))[-1].lower()


class MountedFiles:
    """The FileManager's view of a mod chain's archives.

    `FileManager::addArchive` (0x0841f110) keys an archive by its path under
    `Archives/` without the extension and without a `_<digits>` patch suffix
    (LOAD-8); `open` tries the archives whose key prefixes the path, earliest
    mounted first, and the first that holds the entry wins (RFA-1): the
    nearest mod, and within a mod the highest patch before its base. An
    archive is indexed only when a path under its key is asked for, so a mod
    with hundreds of levels costs the few archives a load reads.
    """

    def __init__(self, chain: list[Path]) -> None:
        self._mounts: list[list] = []      # [key, path, archive | None, {lower: name}]
        for mod_dir in chain:
            archives = find_archives_dir(mod_dir)
            if archives is None:
                continue
            groups: dict[str, list[tuple[int, Path]]] = {}
            for p in sorted(archives.rglob("*")):
                if not (p.is_file() and p.suffix.lower() == ".rfa"):
                    continue
                rel = p.relative_to(archives).with_suffix("").as_posix().lower()
                m = _PATCH.match(rel)
                base, patch = (m.group(1), int(m.group(2))) if m else (rel, -1)
                groups.setdefault(base, []).append((patch, p))
            for base, found in groups.items():
                for _patch, p in sorted(found, key=lambda t: -t[0]):
                    self._mounts.append([base, p, None, None])
        self.read_paths: list[Path] = []

    def _index(self, mount: list) -> dict[str, str]:
        if mount[2] is None:
            mount[2] = RfaArchive(mount[1])
            mount[3] = {n.lower(): n for n in mount[2].entries}
            self.read_paths.append(mount[1])
        return mount[3]

    def read(self, path: str) -> str | None:
        lp = posixpath.normpath(path.replace("\\", "/")).lower().lstrip("/")
        for mount in self._mounts:
            if lp.startswith(mount[0]):
                name = self._index(mount).get(lp)
                if name is not None:
                    return mount[2].read(name).decode("latin-1")
        return None

    def list(self, prefix: str) -> list[str]:
        """Every entry under `prefix`, one per path, in no particular order."""
        lp = prefix.lower()
        out: dict[str, None] = {}
        for mount in self._mounts:
            if lp.startswith(mount[0]) or mount[0].startswith(lp.rstrip("/")):
                for low in self._index(mount):
                    if low.startswith(lp):
                        out.setdefault(low)
        return list(out)

    def close(self) -> None:
        for mount in self._mounts:
            if mount[2] is not None:
                mount[2].close()
                mount[2] = None


def _tokens(line: str) -> list[str]:
    """A console line's words: whitespace-delimited, a `"..."` run one word
    (`getArgs` 0x083de4d0, CON-11)."""
    out: list[str] = []
    for m in re.finditer(r'"([^"]*)"?|(\S+)', line):
        out.append(m.group(1) if m.group(1) is not None else m.group(2))
    return out


@dataclass
class Console:
    """Just enough of `OldConsole` to know which templates a load creates."""

    files: MountedFiles
    play_mode: str = "GPM_CQ"
    names: list[str] = field(default_factory=lambda: [CODE_TEMPLATE])
    sources: list[str] = field(default_factory=lambda: ["code"])
    _seen: dict[str, int] = field(default_factory=lambda: {CODE_TEMPLATE.lower(): 0})
    variables: dict[str, str] = field(default_factory=dict)
    relative: bool = True
    missing: list[str] = field(default_factory=list)

    def create(self, name: str, source: str) -> None:
        key = name.lower()
        if key in self._seen:
            return
        self._seen[key] = len(self.names)
        self.names.append(name)
        self.sources.append(source)

    def value(self, word: str, args: list[str]) -> str:
        m = _VAR.match(word)
        if m:
            i = int(m.group(1)) - 1
            return args[i] if 0 <= i < len(args) else ""
        return self.variables.get(word.lower(), word)

    def condition(self, words: list[str], args: list[str]) -> bool:
        if len(words) == 3 and words[1] in ("==", "!="):
            same = self.value(words[0], args).lower() == self.value(words[2], args).lower()
            return same if words[1] == "==" else not same
        return False

    def run(self, path: str, args: list[str], depth: int = 0) -> bool:
        text = self.files.read(path)
        if text is None:
            self.missing.append(path)
            return False
        self.execute(text, path, args, depth)
        return True

    def execute(self, text: str, path: str, args: list[str], depth: int) -> None:
        here = posixpath.dirname(path.replace("\\", "/"))
        frames: list[list[bool]] = []     # [enclosing block runs, an arm was taken]
        active = True
        rem_depth = 0
        for raw in text.splitlines():
            words = _tokens(raw)
            if not words:
                continue
            word = words[0].lower()
            # rem, beginRem and endRem are tested before anything else, and a
            # line inside an open beginRem is dropped whatever it says
            # (handleCommand 0x083defde, 0x083df005, 0x083df36d, 0x083df556).
            if word == "rem":
                continue
            if word == "beginrem":
                if rem_depth < _MAX_REM_DEPTH:
                    rem_depth += 1
                continue
            if word == "endrem":
                if rem_depth > 0:
                    rem_depth -= 1
                continue
            if rem_depth:
                continue
            if word in ("if", "elseif"):
                cond = self.condition(words[1:], args)
                if word == "if":
                    take = active and cond
                    frames.append([active, take])
                elif frames:
                    outer, taken = frames[-1]
                    take = outer and not taken and cond
                    frames[-1][1] = taken or take
                else:
                    continue
                active = take
                continue
            if word == "else":
                if frames:
                    outer, taken = frames[-1]
                    active = outer and not taken
                    frames[-1][1] = True
                continue
            if word == "endif":
                if frames:
                    active = frames.pop()[0]
                continue
            if not active:
                continue
            if word == "return":
                return
            if word in ("var", "const") and len(words) > 1:
                rest = raw.strip().split(None, 1)[1]
                if "=" in rest:
                    name, value = rest.split("=", 1)
                    self.variables[name.strip().lower()] = self.value(value.strip(), args)
                else:
                    self.variables.setdefault(words[1].lower(), "")
                continue
            if len(words) >= 3 and words[-2] == "->":
                target = words[-1].lower()
                if word == "echo":
                    self.variables[target] = " ".join(self.value(w, args) for w in words[1:-2])
                elif word == "game.gameplaymode":
                    self.variables[target] = self.play_mode
                elif word == "game.gamemode":
                    self.variables[target] = "GMMultiplayer"
                else:
                    self.variables[target] = ""
                continue
            if word == "console.userelativepaths" and len(words) > 1:
                self.relative = words[1] != "0"
                continue
            if word in ("run", "include") and len(words) > 1:
                target = words[1].replace("\\", "/")
                if "." not in target:
                    target += ".con"            # OldConsole::run: no dot, `.con` added
                if self.relative and not target.startswith("/"):
                    target = posixpath.join(here, target)
                full = posixpath.normpath(target.lstrip("/"))
                sub = [self.value(w, args) for w in words[2:]] if word == "run" else args
                if depth < _MAX_RUN_DEPTH:
                    self.run(full, sub, depth + 1)
                continue
            if word == "objecttemplate.create" and len(words) == 3:
                self.create(words[2], path)


@dataclass
class TemplateTable:
    mod: str
    level: str
    mode: str
    names: list[str]                     # index = template id
    sources: list[str]
    inputs: list[Path]
    missing: list[str]

    def tid_names(self) -> dict[str, str]:
        return {str(i): n for i, n in enumerate(self.names)}


def mod_chain(game_dir: Path, mod: str) -> list[Path]:
    """The mod and its parents, nearest first, from `game.addModPath` (as
    `extract_models.mod_chain`, without its exit on an unknown mod)."""
    mods_dir = game_dir / "Mods"
    by_lower = {d.name.lower(): d for d in mods_dir.iterdir() if d.is_dir()} if mods_dir.is_dir() else {}
    start = by_lower.get(str(mod).lower())
    if start is None:
        raise FileNotFoundError(f"no mod {mod!r} under {mods_dir}")
    chain: list[Path] = []

    def walk(directory: Path) -> None:
        if directory in chain:
            return
        chain.append(directory)
        init = next((p for p in directory.iterdir() if p.name.lower() == "init.con"), None)
        if init is None:
            return
        for line in init.read_text(errors="replace").splitlines():
            parts = line.strip().split()
            if len(parts) >= 2 and parts[0].lower() == "game.addmodpath":
                name = re.split(r"[\\/]", parts[1].strip("/\\"))[-1]
                nxt = by_lower.get(name.lower())
                if nxt is not None:
                    walk(nxt)

    walk(start)
    return chain


def template_table(game_dir: Path, mod: str, level: str, mode: str | None) -> TemplateTable:
    """Replay a level load of `level` under game type `mode` for `mod` and
    return the template id table it builds. Raises FileNotFoundError when the
    mod or the level's `Init.con` is not in the install."""
    lv = level_name(level)
    md = mode_name(mode)
    chain = mod_chain(Path(game_dir), mod)
    files = MountedFiles(chain)
    try:
        console = Console(files, play_mode=PLAY_MODES.get(md, "GPM_CQ"))
        root = f"bf1942/levels/{lv}/"
        if not console.run(root + "init.con", []):
            raise FileNotFoundError(f"no bf1942/levels/{lv}/Init.con in {chain[0].name}")
        # `/ai/` scripts load only on an AI level; co-op is the one game type
        # that makes a level one (`game.isAiLevel`, LOAD-8).
        ai_level = md == "coop"
        for path in sorted(files.list("objects/")):
            if ".con" not in path:
                continue
            if not ai_level and ("/ai/" in path or "\\ai\\" in path):
                continue
            console.run(path, [])
        console.run(root + f"{md}.con", ["host"])
        return TemplateTable(chain[0].name, lv, md, console.names, console.sources,
                             list(dict.fromkeys(files.read_paths)), console.missing)
    finally:
        files.close()
