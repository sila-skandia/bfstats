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

Each id also carries its template class, the class the create line's word
resolves to (`template_class`, LOAD-19), from which the sidecar knows which
networkable reads the object's ghost body (NET-8). With `graph=True` the load
also keeps what it configures, the part of the template graph a hull's or a
soldier's ghost body depends on (`object_graph`, NET-9), which
`sidecar/ghost/derive-children.mjs` turns into the level's body layouts.

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

# The template classes the class manager knows, as `ObjectTemplateManager::
# registerTemplateClass` (vt+0xc) is handed them by the template modules'
# `init`s: ObjTemplBaseModule 0x081b2330, ObjTemplFxModule 0x081e88d0,
# ObjTemplLodModule 0x08219d80, ObjTemplVehicleModule 0x08242270 and
# ObjTemplBFModule 0x082986d0 (43 calls; `Bundle` twice, under one id). The
# map they fill (`+0x28`) is keyed by class id, so this is its iteration
# order. Ledger LOAD-19.
TEMPLATE_CLASSES: tuple[tuple[int, str], ...] = (
    (0x9471, "Bundle"), (0x9472, "Camera"), (0x9474, "EffectBundle"), (0x9475, "Emitter"),
    (0x9476, "Engine"), (0x9477, "EntryPoint"), (0x9478, "FloatingBundle"),
    (0x9479, "LensFlare"), (0x947A, "Light"), (0x947B, "Particle"),
    (0x947D, "RotationalBundle"), (0x947E, "SimpleObject"), (0x9481, "Spring"),
    (0x9483, "Wing"), (0x948A, "SpawnPoint"), (0x948B, "FreeCamera"), (0x9492, "Item"),
    (0x9493, "BFSoldier"), (0x9494, "FireArms"), (0x9495, "Projectile"), (0x9496, "Kit"),
    (0x9497, "HandFireArms"), (0x9499, "FireArmsBundle"), (0x949A, "Flag"),
    (0x949C, "AnimatedBundle"), (0x94A0, "SpriteParticle"), (0x94A1, "ObjectSpawner"),
    (0x94A2, "FlagBase"), (0x94A3, "KitPart"), (0x94A4, "SupplyDepot"),
    (0x94A5, "ControlPoint"), (0x94A7, "LodObject"), (0x94AE, "LandingGear"),
    (0x94AF, "Obstacle"), (0x94B3, "AreaObject"),
    (0x94B6, "DestroyTargetObjectiveTemplate"), (0x94B8, "ANDCompositeObjectiveTemplate"),
    (0x94BB, "TimerObjectiveTemplate"), (0x94BC, "ActiveKitPart"),
    (0xC4C2, "PlayerControlObject"), (0xC4C6, "SeatObject"), (0xC4C9, "SonarObject"),
)


def template_class(word: str) -> str | None:
    """The class an `ObjectTemplate.create <word> ...` line makes, or None.

    `getClassIDFromTemplateClassName` (lnxded 0x081d63e0) walks the class map
    in id order and takes the first registered name the word starts, case
    blind: `strncasecmp(word, name, len(word))`. So `SpriteParticle`,
    `TimerObjective` and `Simple` are classes (`SpriteParticle`,
    `TimerObjectiveTemplate`, `SimpleObject`), `Kit` is `Kit` before
    `KitPart`, and a word no name starts (`simepleobject`) is class id 0,
    which `createTemplate` (0x081d5a30) refuses: no template, no id."""
    w = word.lower()
    if not w:
        return None
    for _cid, name in TEMPLATE_CLASSES:
        if name.lower().startswith(w):
            return name
    return None


# The template properties the sidecar derives a ghost body's layout from
# (sidecar/ghost/derive-children.mjs, sidecar/template-objects.mjs). A
# property answers to its own name and to `set<name>` (CON-15): the bare
# ones are folded onto their bare spelling, the `set...` methods kept as
# they are.
GRAPH_PROPS = frozenset({
    "hasarmor", "hitpoints", "maxhitpoints", "hasmobilephysics",
    "magsize", "numofmag", "roundoffire", "addfirearmsposition", "setasynchronyfire",
    "setnumberofgears", "setautomaticreset", "setinputtoyaw", "setinputtopitch",
    "setinputtoroll", "setmaxrotation", "setminrotation", "setmaxspeed", "setacceleration",
    "setturnleftrightangle", "setpointupdownangle",
})
_BARE_PROPS = frozenset({"hasarmor", "hitpoints", "maxhitpoints", "hasmobilephysics",
                         "magsize", "numofmag", "roundoffire", "networkableinfo"})


def _prop_word(op: str) -> str:
    if op.startswith("set") and op[3:] in _BARE_PROPS:
        return op[3:]
    return op


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
    # Each id's template class (TEMPLATE_CLASSES' spelling); id 0 is a Camera.
    classes: list[str] = field(default_factory=lambda: ["Camera"])
    sources: list[str] = field(default_factory=lambda: ["code"])
    _seen: dict[str, int] = field(default_factory=lambda: {CODE_TEMPLATE.lower(): 0})
    variables: dict[str, str] = field(default_factory=dict)
    relative: bool = True
    missing: list[str] = field(default_factory=list)
    # With `graph`, what the load configures as well: per template its
    # `networkableInfo`, the GRAPH_PROPS lines and its `addTemplate` children
    # with their `setPosition` / `setRotation` (`templates`, by lower-case
    # name), and the NetworkableInfos `NetworkableInfo.createNewInfo` made
    # (`infos`; those with `setIsUnique 1` in `unique_infos`, with
    # `setForceNetworkableId 1` in `forced_infos`).
    graph: bool = False
    templates: dict[str, dict] = field(default_factory=dict)
    infos: set[str] = field(default_factory=set)
    unique_infos: set[str] = field(default_factory=set)
    forced_infos: set[str] = field(default_factory=set)
    _active: dict | None = None
    _active_info: str | None = None

    def create(self, word: str, name: str, source: str) -> None:
        cls = template_class(word)
        key = name.lower()
        # createTemplate (0x081d5a30): class id 0 makes nothing; a name the
        # hash holds already calls setActive(0), so the lines after a
        # redeclaration configure nothing (LOAD-1).
        if cls is None or key in self._seen:
            self._active = None
            return
        self._seen[key] = len(self.names)
        self.names.append(name)
        self.classes.append(cls)
        self.sources.append(source)
        if self.graph:
            self._active = {"name": name, "cls": cls, "info": None, "props": {}, "children": []}
            self.templates[key] = self._active

    def configure(self, op: str, words: list[str]) -> None:
        """An `ObjectTemplate.<op>` line other than `create`, for the graph."""
        if op in ("active", "activesafe"):
            # `active <name>` reopens a declared template; a name nothing
            # declared opens nothing (LOAD-9, `con.py` the same).
            self._active = self.templates.get(words[-1].lower()) if words else None
            return
        t = self._active
        if t is None:
            return
        op = _prop_word(op)
        if op == "addtemplate" and words:
            t["children"].append([words[0], None, None])
        elif op in ("setposition", "setrotation") and words and t["children"]:
            try:
                vec = [float(v) for v in words[0].replace(",", "/").split("/")[:3]]
            except ValueError:
                return
            t["children"][-1][1 if op == "setposition" else 2] = vec
        elif op == "networkableinfo":
            t["info"] = words[0] if words else ""
        elif op in GRAPH_PROPS:
            t["props"].setdefault(op, []).append(words)

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
            if word == "objecttemplate.create":
                if len(words) == 3:
                    self.create(words[1], words[2], path)
                elif self.graph:
                    self._active = None
                continue
            if self.graph:
                if word.startswith("objecttemplate."):
                    self.configure(word[len("objecttemplate."):], words[1:])
                elif word == "networkableinfo.createnewinfo" and len(words) > 1:
                    self._active_info = words[1].lower()
                    self.infos.add(self._active_info)
                elif (word in ("networkableinfo.setisunique", "networkableinfo.setforcenetworkableid")
                      and len(words) > 1 and self._active_info):
                    flags = self.unique_infos if word.endswith("unique") else self.forced_infos
                    if _truthy(words[1:]):
                        flags.add(self._active_info)
                    else:
                        flags.discard(self._active_info)


@dataclass
class TemplateTable:
    mod: str
    level: str
    mode: str
    names: list[str]                     # index = template id
    sources: list[str]
    inputs: list[Path]
    missing: list[str]
    classes: list[str] = field(default_factory=list)   # index = template id
    console: Console | None = None       # the load, with its graph when asked for

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


def template_table(game_dir: Path, mod: str, level: str, mode: str | None,
                   graph: bool = False) -> TemplateTable:
    """Replay a level load of `level` under game type `mode` for `mod` and
    return the template id table it builds, each id with its class. With
    `graph`, the table's `console` also holds what the load configured
    (`Console.templates`, `infos`). Raises FileNotFoundError when the mod or
    the level's `Init.con` is not in the install."""
    lv = level_name(level)
    md = mode_name(mode)
    chain = mod_chain(Path(game_dir), mod)
    files = MountedFiles(chain)
    try:
        console = Console(files, play_mode=PLAY_MODES.get(md, "GPM_CQ"), graph=graph)
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
                             list(dict.fromkeys(files.read_paths)), console.missing,
                             console.classes, console if graph else None)
    finally:
        files.close()


# The classes whose templates the sidecar describes for a ghost body: a hull
# (a PlayerControlObject, the root of a vehicle's descriptor) and a soldier.
# Any armoured template is described too, since its hit point field's width
# is its armour's maximum.
GRAPH_ROOT_CLASSES = frozenset({"PlayerControlObject", "BFSoldier"})


def _truthy(words: list[str] | None) -> bool:
    try:
        return bool(words) and float(words[0]) != 0
    except ValueError:
        return False


def object_graph(console: Console) -> dict:
    """The part of a load's template graph a ghost body's layout depends on,
    as JSON: every template reachable through `addTemplate` from a
    GRAPH_ROOT_CLASSES or armoured template, with its class, networkable
    info, GRAPH_PROPS lines and children, and the NetworkableInfos the load
    made. Shape: {"templates": [[name, class, info, props, children], ...],
    "infos": [lower names], "unique": [...], "forced": [...]}; a child is
    [name, setPosition or null, setRotation or null]."""
    templates = console.templates
    todo = [k for k, t in templates.items()
            if t["cls"] in GRAPH_ROOT_CLASSES or _truthy((t["props"].get("hasarmor") or [None])[-1])]
    seen: set[str] = set()
    while todo:
        key = todo.pop()
        if key in seen:
            continue
        seen.add(key)
        for child in templates[key]["children"]:
            ck = child[0].lower()
            if ck in templates and ck not in seen:
                todo.append(ck)
    rows = [[t["name"], t["cls"], t["info"], t["props"], t["children"]]
            for k, t in templates.items() if k in seen]
    return {"templates": rows, "infos": sorted(console.infos), "unique": sorted(console.unique_infos),
            "forced": sorted(console.forced_infos)}
