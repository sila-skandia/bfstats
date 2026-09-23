"""A level's `scene.json` as named layers, each rebuilt on its own.

`extract_map.py` bakes a level into `scene.glb` plus `scene.json`. Most of
`scene.json` is read straight out of the level's con files and archives and
has nothing to do with the geometry: the control points' settings, the spawn
lists, the tickets, the fog, the damage tables, the sounds, the AI scripts.
Those are the layers below. Each is a pure function of the game install (the
level archive, the mod's object and game archives), so a change to one is
delivered by recomputing that one and rewriting its keys in every published
`scene.json` (`patch_scene.py`) rather than re-baking the level.

The rest of `scene.json` (`terrain`, `objects`, `sky`, `water`, `envmap`,
`lensFlare`, `minimap`, `skybox`) describes what the full bake wrote beside it
and is the `scene` layer, which only `extract_map.py` writes.

The full bake composes its report through these same functions, so a layer
patched onto a tree and the same layer from a fresh bake are one computation
(`tests/test_scene_layers.py` bakes a level and patches every layer back over
it: not a byte moves).

Two things a layer does NOT cover, because they are placements and placements
live in the glb:

* a flag's or a spawner's position, which vehicle a spawner makes, which mode
  a placement belongs to, and whether a flag is drawn at all;
* an ObjectSpawner's respawn window, which the glb also stamps on the spawner
  node (`extras.spawner`, preferred by `viewer/vehicle-wrecks.js`).

A change to any of those needs the full bake. See
`features/level-bake-layers/README.md` for the map of change -> layer ->
command.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import extract_map as em
from bf42.ai_level import add_cover_values, load_level_ai, write_level_search_maps
from bf42.level import discover_level_sounds, load_tickets
from bf42.rfa import ArchivePool, find_archives_dir
from extract_models import build_library, build_pools, load_damage_tables, mod_chain

# name -> (top-level keys, keys inside each `modes[<mode>]` entry)
LAYERS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "controlPoints": (("controlPoints",), ("controlPoints",)),
    "spawns": (("soldierSpawns", "vehicleSoldierSpawns", "objectSpawns"),
               ("soldierSpawns", "objectSpawns", "vehicleSoldierSpawns")),
    "game": (("gameplayMode", "combatArea", "tickets", "gameTypes"),
             ("gameTypes", "tickets", "combatArea")),
    "environment": (("waterLevel", "fogColor", "fogStart", "fogEnd",
                     "sunDirection", "camera", "lighting", "drawDistance"), ()),
    "damage": (("damage",), ()),
    "sounds": (("sounds",), ()),
    "ai": (("ai",), ()),
}

# A layer another reads from: `objectSpawns[].controlPointIndex` is the
# nearest flag within max(60, 4 * radius), and a soldier spawn's `team` is the
# flag whose spawnGroupId matches its group. So a control point's radius, team
# or spawn group reaches `spawns` too, and patching `controlPoints` recomputes
# it (identical output when nothing it reads moved).
DEPENDENTS: dict[str, tuple[str, ...]] = {"controlPoints": ("spawns",)}

# The key order `extract_map.py` has always written, kept so a full bake after
# the layer split writes the same bytes as one before it.
REPORT_ORDER = (
    "level", "worldSize", "waterLevel", "fogColor", "fogStart", "fogEnd",
    "sunDirection", "camera", "combatArea", "terrain", "objects", "skybox",
    "sky", "water", "lighting", "drawDistance", "gameplayMode",
    "controlPoints", "soldierSpawns", "vehicleSoldierSpawns", "objectSpawns",
    "tickets", "modes", "gameTypes", "minimap", "envmap", "lensFlare",
    "damage", "sounds", "ai",
)
MODE_KEY_ORDER = ("gameTypes", "controlPoints", "soldierSpawns",
                  "objectSpawns", "vehicleSoldierSpawns", "tickets",
                  "combatArea")

LAYER_KEYS = {key for top, _ in LAYERS.values() for key in top}


def expand(names: list[str]) -> list[str]:
    """The named layers plus their dependents, in `LAYERS` order."""
    wanted = set()
    for name in names:
        if name not in LAYERS:
            raise KeyError(f"unknown layer {name!r} (have: {', '.join(LAYERS)})")
        wanted.add(name)
        wanted.update(DEPENDENTS.get(name, ()))
    return [name for name in LAYERS if name in wanted]


def tree_for(maps_root: Path, mod: str) -> Path:
    """Where a mod's levels live: `viewer/maps` for vanilla, else
    `viewer/maps/mods/<mod lower>` (the game's folder names are not lower
    case, `XPack1` / `EoD`; the published trees are)."""
    return maps_root if mod.lower() == "bf1942" else maps_root / "mods" / mod.lower()


class LevelContext:
    """Everything a layer reads, loaded on first use.

    The full bake builds one and then also uses its pools for the geometry,
    so the layers it writes are computed from exactly the state a patch would
    load fresh. `out` is where the level directory is written, `final_out`
    where it will be published (they differ only in a staged batch run);
    relative sample and damage paths are measured from the latter.
    """

    def __init__(self, game_dir: Path, mod: str, level: str, *, out: Path,
                 final_out: Path | None = None,
                 shared_sounds: Path | None = None,
                 audio_format: str = "mp3",
                 texture_fallback: list[str] | None = None,
                 include_objects: bool = True) -> None:
        self.game_dir = game_dir
        self.mod = mod
        self.level = level
        self.out = out
        self.final_out = final_out or out
        self.shared_sounds = shared_sounds or (out / "_shared" / "sounds")
        self.audio_format = audio_format
        self.texture_fallback = list(texture_fallback or [])
        self.include_objects = include_objects
        # Templates whose flag assembled into the glb (lower case), None when
        # the object pass did not run. A patch reads it off the published
        # `objects` report (see `placed_from_report`).
        self.placed_flags: set[str] | None = None
        self._loaded = False
        self._pools = None
        self._library = None
        self._library_done = False
        self._damage_tables = None
        self._damage_done = False
        self._by_mode = None

    # -- the level itself ------------------------------------------------
    def _load(self) -> None:
        if self._loaded:
            return
        self._chain = mod_chain(self.game_dir, self.mod)
        (self._files, self._info, self._heightmap,
         self._paths) = em.load_level(self.game_dir, self.mod, self.level, self._chain)
        self._loaded = True

    @property
    def chain(self):
        self._load()
        return self._chain

    @property
    def files(self):
        self._load()
        return self._files

    @property
    def info(self):
        self._load()
        return self._info

    @property
    def heightmap(self):
        self._load()
        return self._heightmap

    @property
    def paths(self):
        self._load()
        return self._paths

    def level_dir(self) -> Path:
        return self.out / self.info.name.lower()

    def final_level_dir(self) -> Path:
        return self.final_out / self.info.name.lower()

    # -- the mod's archives -----------------------------------------------
    @property
    def pools(self):
        """(meshes, textures, objects, game), the level's own object
        templates already in `objects`."""
        if self._pools is None:
            self._load()
            names = list(self.texture_fallback)
            if not em._vanilla_texture_rfa_present(self.chain):
                names += list(em.TEXTURE_GAP_MODS)
            fallbacks = em._mod_dirs(self.game_dir, names)
            meshes, textures, objects, game = build_pools(self.chain, fallbacks)
            # A level can declare ObjectTemplates of its own; they have to be
            # in the pool before the library is built. See `add_level_objects`.
            for path in self.paths:
                objects.add_level_objects(path, label=f"{self.info.name} objects")
            self._pools = (meshes, textures, objects, game)
        return self._pools

    @property
    def library(self):
        """The object library with the level's control point templates in,
        flag cloth detached (what the assembler places), and the level's
        sounds re-discovered against it. None without the object pass."""
        if not self._library_done:
            self._library_done = True
            if self.include_objects:
                info, files = self.info, self.files
                library = build_library(self.pools[2])
                # A level's flags live in `<mode>/ControlPointTemplates.con`,
                # which `build_library` never reads.
                if info.gameplay.mode:
                    cpt = files.find(f"{info.gameplay.mode}/ControlPointTemplates.con")
                    if cpt:
                        library.add_con(cpt, files.read(cpt).decode("latin-1", "replace"))
                        em.detach_flag_cloth(library, info)
                # Building ambience (windmills, factories with a
                # `loadSoundScript`) is only visible through the library.
                info.sounds = discover_level_sounds(
                    files, info.static_objects, library, self.pools[2])
                self._library = library
        return self._library

    @property
    def damage_tables(self):
        if not self._damage_done:
            self._damage_done = True
            try:
                self._damage_tables = load_damage_tables(self.pools[3])
            except Exception as exc:  # a mod with no Game.rfa
                print(f"damage:   tables unavailable ({exc})", file=sys.stderr)
                self._damage_tables = None
        return self._damage_tables

    @property
    def vehicle_soldier_spawns_by_mode(self) -> dict[str, list[dict]]:
        """Each mode's fleet deck spawn points (none without the object pass,
        which is what a terrain-only bake has always written)."""
        if self._by_mode is None:
            self._by_mode = {}
            if self.include_objects:
                _m, _t, objects, game = self.pools
                for name, layer in self.info.modes.items():
                    self._by_mode[name] = em._vehicle_soldier_spawn_report(
                        self.info, objects, game, layer)
        return self._by_mode


def placed_from_report(report: dict) -> set[str] | None:
    """The placed-flag set a published `scene.json` implies.

    A bake since the layer split records it (`objects.placedControlPoints`).
    An older one only has each control point's `visible`, which is
    `template visible and placed`: every visible entry was placed, and a
    template the con marks visible that no entry shows visible was not. So
    the set is exact for everything the con has not changed since the bake;
    a flag the con newly makes visible is a new placement, which is a glb
    change and needs the full bake anyway (`patch` says so).
    """
    objects = report.get("objects") or {}
    if isinstance(objects.get("placedControlPoints"), list):
        return {name.lower() for name in objects["placedControlPoints"]}
    entries = list(report.get("controlPoints") or [])
    for mode in (report.get("modes") or {}).values():
        entries.extend(mode.get("controlPoints") or [])
    if not entries and not objects.get("controlPoints"):
        # Nothing placed and nothing to say it was: a terrain-only tree.
        return None if not objects.get("placed") else set()
    return {e["name"].lower() for e in entries if e.get("visible")}


# -- the layers -------------------------------------------------------------

def _combat_area(info) -> dict | None:
    return None if info.combat is None else {
        "min": em._to_gltf_vec((info.combat.min_x, 0.0, info.combat.min_z)),
        "max": em._to_gltf_vec((info.combat.max_x, 0.0, info.combat.max_z)),
    }


def layer_control_points(ctx: LevelContext):
    info, placed = ctx.info, ctx.placed_flags
    return ({"controlPoints": em._control_point_report(info, placed)},
            {name: {"controlPoints": em._control_point_report(info, placed, layer)}
             for name, layer in info.modes.items()})


def layer_spawns(ctx: LevelContext):
    info = ctx.info
    by_mode = ctx.vehicle_soldier_spawns_by_mode
    default = info.gameplay.mode or "Conquest"
    top = {
        "soldierSpawns": em._soldier_spawn_report(info),
        "vehicleSoldierSpawns": by_mode.get(default, []),
        "objectSpawns": em._object_spawn_report(info),
    }
    modes = {name: {
        "soldierSpawns": em._soldier_spawn_report(info, layer),
        "objectSpawns": em._object_spawn_report(info, layer),
        "vehicleSoldierSpawns": by_mode.get(name, []),
    } for name, layer in info.modes.items()}
    return top, modes


def layer_game(ctx: LevelContext):
    info, files = ctx.info, ctx.files
    area = _combat_area(info)
    top = {
        "gameplayMode": info.gameplay.mode or None,
        "combatArea": area,
        "tickets": em._tickets_report(load_tickets(files, info.gameplay.mode)),
        "gameTypes": {gt.name: {"mode": gt.mode, "tickets": em._tickets_report(gt.tickets)}
                      for gt in info.game_types.values()},
    }
    modes = {name: {
        # Which of the menu's game types load this layer. Empty for a layer
        # directory the archive ships but no GameTypes script runs.
        "gameTypes": sorted(gt.name for gt in info.game_types.values()
                            if gt.mode.lower() == name.lower()),
        "tickets": em._tickets_report(em.tickets_for_mode(info.game_types, name)),
        # No installed level scopes a combat area to a mode (all 1,301
        # archives measured); written per mode so the merge is one rule.
        "combatArea": area,
    } for name in info.modes}
    return top, modes


def layer_environment(ctx: LevelContext):
    info = ctx.info
    lighting = {}
    if info.lighting.ambient_color:
        lighting["ambient"] = list(info.lighting.ambient_color)
    if info.lighting.diffuse_color:
        lighting["diffuse"] = list(info.lighting.diffuse_color)
    if info.lighting.global_ambient:
        lighting["globalAmbient"] = list(info.lighting.global_ambient)
    if info.lighting.shadow_color is not None:
        lighting["shadowColor"] = info.lighting.shadow_color
    # The engine's draw distance is `Game.setViewDistance` (declared by every
    # vanilla level; the video slider scales it). `renderer.setViewdistance`
    # is a raw renderer poke only Tobruk carries, and the game overrides it
    # there (Game VD 300 vs the stray 700; the in-game haze wall sits at 300).
    view_distance = info.game_view_distance or info.view_distance or 700.0
    # A level with no live fogStart/fogEnd still fogs in-game: Setup defaults
    # are 1/2 m, then Game.setViewDistance (lnxded 0x080c6e20) retunes the
    # range using a 0.5f factor (0x86b05e8). Derive an undeclared range from
    # the view distance the same way. Do not honour fogLinearStart/End;
    # those strings are not in BF1942.exe.
    fog_end = info.fog_end if info.fog_end is not None else view_distance
    fog_start = info.fog_start if info.fog_start is not None else view_distance * 0.5
    return {
        "waterLevel": info.terrain.water_level,
        "fogColor": list(info.fog_color),
        "fogStart": fog_start,
        "fogEnd": fog_end,
        "sunDirection": em._to_gltf_vec(info.sun_direction),
        "camera": em._to_gltf_vec(info.camera) if info.camera else None,
        "lighting": lighting or None,
        "drawDistance": view_distance,
    }, {}


def layer_damage(ctx: LevelContext):
    # The MaterialManager tables are the mod's, written once beside the
    # shared sounds and referenced relatively from each level.
    return {"damage": em.write_damage_tables(
        ctx.damage_tables, ctx.shared_sounds.parent, ctx.final_level_dir(),
        em.projectile_materials(ctx.library))}, {}


def layer_sounds(ctx: LevelContext):
    info, library = ctx.info, ctx.library   # the library re-discovers info.sounds
    sounds = ArchivePool()
    for mod_dir in ctx.chain:
        archives = find_archives_dir(mod_dir)
        if archives is not None:
            sounds.add_dir(archives, em.SOUND_ARCHIVES)
    return {"sounds": em.extract_sounds(
        info, ctx.files, sounds, ctx.level_dir(),
        # The flags' flap is read from the object pool even on a terrain-only
        # bake; the vehicles need the library as well.
        library=library, objects=ctx.pools[2],
        vehicles=em.spawned_vehicle_templates(info),
        shared_dir=ctx.shared_sounds, audio_format=ctx.audio_format,
        final_dir=ctx.final_level_dir())}, {}


def layer_ai(ctx: LevelContext):
    info, files = ctx.info, ctx.files
    level_ai = load_level_ai(files)
    out = {}
    if level_ai is not None:
        add_cover_values(level_ai, ctx.library,
                         (inst.template for inst in info.static_objects))
        out["ai"] = level_ai.to_json()
    # The search maps the level ships baked and `ai.loadMaps` loads; written
    # (or a stale folder removed) either way, as the full bake always has.
    write_level_search_maps(files, level_ai, ctx.level_dir())
    return out, {}


COMPUTE = {
    "controlPoints": layer_control_points,
    "spawns": layer_spawns,
    "game": layer_game,
    "environment": layer_environment,
    "damage": layer_damage,
    "sounds": layer_sounds,
    "ai": layer_ai,
}


def compute(ctx: LevelContext, names) -> tuple[dict, dict[str, dict]]:
    """The named layers' top-level keys, and their per-mode keys by mode.

    A key a layer leaves out of its result is one the level does not have
    (`ai` on a level with no `AI.con`), and is removed on merge.
    """
    top: dict = {}
    modes: dict[str, dict] = {}
    for name in names:
        t, m = COMPUTE[name](ctx)
        top.update(t)
        for mode, entry in m.items():
            modes.setdefault(mode, {}).update(entry)
    return top, modes


def compose(scene: dict, top: dict, modes: dict[str, dict]) -> dict:
    """A whole report in the order the extractor has always written it:
    `scene` holds the glb-side keys, `top`/`modes` every layer."""
    merged = {**scene, **top}
    if modes:
        merged["modes"] = {
            name: {k: entry[k] for k in MODE_KEY_ORDER if k in entry}
            for name, entry in modes.items()}
    ordered = {k: merged[k] for k in REPORT_ORDER if k in merged}
    for key, value in merged.items():          # anything new goes last
        ordered.setdefault(key, value)
    return ordered


def merge(report: dict, names, top: dict, modes: dict[str, dict]) -> dict:
    """`report` with the named layers' keys replaced in place.

    Every other key keeps its position and value, so re-dumping with the
    extractor's own `indent=2` reproduces its bytes. A key the layer owns but
    did not produce is dropped; a key new to this report is appended.
    """
    owned_top = [k for n in names for k in LAYERS[n][0]]
    owned_mode = [k for n in names for k in LAYERS[n][1]]
    out: dict = {}
    for key, value in report.items():
        if key in owned_top:
            if key in top:
                out[key] = top[key]
        else:
            out[key] = value
    for key in owned_top:
        if key in top and key not in out:
            out[key] = top[key]
    if owned_mode:
        have = report.get("modes") or {}
        order = list(have)
        if set(have) != set(modes):
            if not {n for n in LAYERS if LAYERS[n][1]} <= set(names):
                raise ModeSetChanged(sorted(have), sorted(modes))
            order = list(modes)
        new_modes: dict = {}
        for mode in order:
            fresh = modes.get(mode, {})
            entry: dict = {}
            for key, value in (have.get(mode) or {}).items():
                if key not in owned_mode:
                    entry[key] = value
                elif key in fresh:
                    entry[key] = fresh[key]
            for key in MODE_KEY_ORDER:
                if key in fresh and key not in entry:
                    entry[key] = fresh[key]
            new_modes[mode] = entry
        out["modes"] = new_modes
    return out


class ModeSetChanged(Exception):
    """The level's gameplay layers differ from the published report's; only
    patching every mode-bearing layer at once can rebuild `modes`."""

    def __init__(self, have: list[str], want: list[str]) -> None:
        super().__init__(
            f"the level's modes changed ({have} -> {want}); patch "
            f"--layer controlPoints spawns game together")


def dump(report: dict) -> str:
    """The extractor's own serialisation. Every writer uses this one."""
    return json.dumps(report, indent=2)
