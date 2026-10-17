"""A level's `scene.json` as named layers, each rebuilt on its own.

`extract_map.py` bakes a level into `scene.glb` plus `scene.json`. Most of
`scene.json` is read straight out of the level's con files and archives and
has nothing to do with the geometry: the control points' settings, the spawn
lists, the tickets, the fog, the damage tables, the sounds, the AI scripts.
Those are the layers below. Each is a pure function of the game install (the
level archive, the mod's object and game archives), so a change to one is
delivered by recomputing that one and rewriting its keys in every published
`scene.json` (`patch_scene.py`) rather than re-baking the level.

One layer is terrain the glb need not draw: `heightmap`, the level's whole
`Heightmap.raw` as `terrain/heightmap.png`, which the viewer's colliders stand
on (the drawn tiles leave the sea floor of 29 levels undrawn).

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
import re
import sys
from pathlib import Path

import extract_map as em
from bf42.ai_level import add_cover_values, load_level_ai, write_level_search_maps
from bf42.ctf import TemplateBlocks, flag_bases
from bf42.level import (discover_level_sounds, load_briefing, load_tickets,
                        mode_template_edits)
from bf42 import rs
from bf42.rfa import ArchivePool, find_archives_dir
from extract_models import build_library, build_pools, load_damage_tables, mod_chain
from extract_spawn_layout import load_chain_lexicon

# name -> (top-level keys, keys inside each `modes[<mode>]` entry)
LAYERS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "controlPoints": (("controlPoints",), ("controlPoints",)),
    "spawns": (("soldierSpawns", "vehicleSoldierSpawns", "objectSpawns"),
               ("soldierSpawns", "objectSpawns", "vehicleSoldierSpawns")),
    "game": (("gameplayMode", "combatArea", "tickets", "gameTypes", "briefing"),
             ("gameTypes", "tickets", "combatArea", "flagBases", "objectives")),
    "environment": (("waterLevel", "fogColor", "fogStart", "fogEnd",
                     "sunDirection", "camera", "lighting", "drawDistance",
                     "targetTriCount"), ()),
    "damage": (("damage",), ()),
    "materials": (("depthWriteOff", "materialDiffuse", "alphaBlend",
                   "alphaLodDistance"), ()),
    "sounds": (("sounds",), ()),
    "ai": (("ai",), ()),
    "heightmap": (("heightmap",), ()),
    "terrainShade": (("terrainShade",), ()),
    "terrainDetail": (("terrainDetail",), ()),
    # No scene.json key: the level's `lightmaps/*.png`, which the glb names.
    "lightmaps": ((), ()),
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
    "sky", "water", "lighting", "drawDistance", "targetTriCount",
    "gameplayMode",
    "controlPoints", "soldierSpawns", "vehicleSoldierSpawns", "objectSpawns",
    "tickets", "modes", "gameTypes", "briefing", "minimap", "envmap",
    "lensFlare", "damage", "depthWriteOff", "materialDiffuse", "sounds", "ai",
    "heightmap",
    # Added 2026-10-11 and patched onto trees that already had every key
    # above, where a patch appends: last here too, in the order a patch of
    # both layers writes them, so a re-bake puts them where the patch did.
    "alphaBlend", "alphaLodDistance", "terrainShade",
    # Added 2026-10-12, the same way.
    "terrainDetail",
)
MODE_KEY_ORDER = ("gameTypes", "controlPoints", "soldierSpawns",
                  "objectSpawns", "vehicleSoldierSpawns", "tickets",
                  "combatArea", "flagBases", "objectives")

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
        self._ordered_objects = None
        self._library = None
        self._library_done = False
        self._damage_tables = None
        self._damage_done = False
        self._by_mode = None
        self._lexicon = None

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

    @property
    def lexicon(self) -> dict[str, str]:
        """The mod chain's merged `lexiconAll.dat` (nearest mod's record wins,
        the parent's files fill the rest). The briefing keys of `Menu/Init.con`
        resolve through it. An empty dict when the chain ships no lexicon:
        the keys then stay as the con wrote them."""
        self._load()
        if self._lexicon is None:
            from bf42.modmenu import MenuSources
            try:
                self._lexicon = load_chain_lexicon(
                    MenuSources(self._chain).lexicon_paths)
            except Exception:
                self._lexicon = {}
        return self._lexicon

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
            # Nearest mod and newest patch first: the pool keeps the first
            # registration of a path, and `paths` is farthest first. Only the
            # scripts `Init.con` runs, wherever they sit: a load never walks a
            # level's `Objects/` on its own (LOAD-5).
            runs = em.level_run_scripts(self.files)
            for path in reversed(self.paths):
                objects.add_level_objects(path, label=f"{self.info.name} objects",
                                          runs=runs)
            self._pools = (meshes, textures, objects, game)
        return self._pools

    @property
    def ordered_objects(self):
        """The objects pool in the order the engine runs its scripts: what
        the level's `Init.con` reaches, then the mod's `objects/`
        (`em.LevelFirst`, `em.level_run_order`)."""
        if self._ordered_objects is None:
            self._ordered_objects = em.LevelFirst(
                self.pools[2], em.level_run_order(self.files))
        return self._ordered_objects

    @property
    def library(self):
        """The object library with the level's control point templates in,
        flag cloth detached (what the assembler places), and the level's
        sounds re-discovered against it. None without the object pass."""
        if not self._library_done:
            self._library_done = True
            if self.include_objects:
                info, files = self.info, self.files
                # The level's own templates first: they win (`em.LevelFirst`).
                library = build_library(self.ordered_objects)
                # A level's flags live in `<mode>/ControlPointTemplates.con`,
                # which `build_library` never reads.
                if info.gameplay.mode:
                    cpt = files.find(f"{info.gameplay.mode}/ControlPointTemplates.con")
                    if cpt:
                        library.add_con(cpt, files.read(cpt).decode("latin-1", "replace"))
                        em.detach_flag_cloth(library, info)
                    # The templates the layer's game type reopens: its
                    # script runs after `Init.con` and the mod's `objects/`,
                    # which `build_library` stops at.
                    for path, text in mode_template_edits(
                            files, info.gameplay.mode, info.game_types):
                        library.add_con(path, text)
                # Building ambience (windmills, factories with a
                # `loadSoundScript`) is only visible through the library --
                # and so is which of a mode script's placements are statics.
                info.sounds = discover_level_sounds(
                    files, info.static_objects, library, self.pools[2],
                    mode_statics=em.union_mode_statics(info, library),
                    spawned=em.union_spawned_objects(info))
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

    def flag_templates(self, game_type=None) -> TemplateBlocks:
        """The `FlagBase`, `Flag` and `AnimatedBundle` templates a level load
        declares, first `create` winning, in the order it runs its scripts:
        the level's `Init.con`, every object script (the level's own first,
        `em.LevelFirst`), then the game type's own script (`bf42/ctf.py`)."""
        blocks = TemplateBlocks()
        init = self.files.find("Init.con")
        if init:
            blocks.add_text(self.files.read(init).decode("latin-1", "replace"))
        objects = self.pools[2]
        for name in em.LevelFirst(objects).names():
            if not name.lower().endswith(".con"):
                continue
            blob = objects.try_read(name)
            if blob is not None and b"bjecttemplate" in blob.lower():
                blocks.add_text(blob.decode("latin-1", "replace"))
        source = getattr(game_type, "source", None)
        if source:
            try:
                blocks.add_text(self.files.read(source).decode("latin-1", "replace"))
            except KeyError:
                pass
        return blocks

    @property
    def vehicle_soldier_spawns_by_mode(self) -> dict[str, list[dict]]:
        """Each mode's fleet deck spawn points (none without the object pass,
        which is what a terrain-only bake has always written)."""
        if self._by_mode is None:
            self._by_mode = {}
            if self.include_objects:
                game = self.pools[3]
                for name, layer in self.info.modes.items():
                    self._by_mode[name] = em._vehicle_soldier_spawn_report(
                        self.info, self.ordered_objects, game, layer)
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


#: The debriefing's own words (`0x006aad90`, ledger ROUND-8): the title by
#: the local side's result and the victory type, and the heading over the
#: best players. Resolved per level through the mod chain's lexicon, so a
#: mod's own wording (Desert Combat's) rides beside its level lines.
DEBRIEFING_TITLE_KEYS = (
    "DEBRIEFING_TOTAL_VICTORY", "DEBRIEFING_MAJOR_VICTORY", "DEBRIEFING_MINOR_VICTORY",
    "DEBRIEFING_TOTAL_DEFEAT", "DEBRIEFING_MAJOR_DEFEAT", "DEBRIEFING_MINOR_DEFEAT",
    "DEBRIEFING_DRAW", "DEBRIEFING_HEADING",
    # ObjectiveMode's titles: the bare words, whatever the victory type.
    "VICTORY", "DEFEAT",
)


def _briefing_report(briefing, lexicon: dict[str, str] | None = None) -> dict | None:
    """A resolved `BriefingInfo` as scene.json carries it, or None when the
    level ships none. A field the level does not declare is left out.

    `debriefing` holds the level's eight lines by side (`allied`, `axis`) and
    the debriefing's titles from `lexicon` (`titles`), when the level declares
    any line."""
    if briefing is None:
        return None
    out: dict = {}
    if briefing.objectives is not None:
        out["objectives"] = briefing.objectives
    if briefing.map_type is not None:
        out["mapType"] = briefing.map_type
    if briefing.map_id is not None:
        out["mapId"] = briefing.map_id
    if briefing.debriefing:
        debriefing = {side: dict(sorted(lines.items()))
                      for side, lines in sorted(briefing.debriefing.items())}
        titles = {key: lexicon[key] for key in DEBRIEFING_TITLE_KEYS
                  if lexicon and key in lexicon}
        if titles:
            debriefing["titles"] = titles
        out["debriefing"] = debriefing
    return out or None


def layer_game(ctx: LevelContext):
    info, files = ctx.info, ctx.files
    area = _combat_area(info)
    top = {
        "gameplayMode": info.gameplay.mode or None,
        "combatArea": area,
        "tickets": em._tickets_report(load_tickets(files, info.gameplay.mode)),
        "gameTypes": {gt.name: {"mode": gt.mode, "tickets": em._tickets_report(gt.tickets)}
                      for gt in info.game_types.values()},
        # The loading screen's mission-briefing text: the multiplayer trio of
        # `Menu/Init.con` (a file the rest of the pipeline never opens), with
        # its lexicon keys resolved through the chain's merged lexiconAll.dat.
        # One string per level, no mode scoping anywhere in the data.
        "briefing": _briefing_report(load_briefing(files, ctx.lexicon), ctx.lexicon),
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
    # Capture the Flag's two flag bases, on the layer the Ctf game type loads
    # (`bf42/ctf.py`; viewer/ctf.js plays them). Only a game type the menu
    # offers (a `GameTypes/Ctf.con`) has any: the 40 root `Ctf.con` scripts
    # with no GameTypes entry are never run.
    for gt in info.game_types.values():
        if gt.name.lower() != "ctf" or gt.mode not in modes:
            continue
        bases = flag_bases(gt.objects, ctx.flag_templates(gt), em._to_gltf_vec)
        if bases:
            modes[gt.mode]["flagBases"] = bases
    # ObjectiveMode's objectives, on the layer its game type loads
    # (`bf42/level.py` `ObjectiveSetup`; viewer/objectives.js plays them).
    for gt in info.game_types.values():
        if gt.objectives is None or gt.mode not in modes:
            continue
        report = _objectives_report(gt.objectives)
        if report:
            modes[gt.mode]["objectives"] = report
    return top, modes


#: `ObjectTemplate.create` kind -> the short name the viewer keys on.
_OBJECTIVE_KIND = {"destroytargetobjective": "DestroyTarget",
                   "andcompositeobjective": "ANDComposite",
                   "timerobjective": "Timer"}


def _objectives_report(setup) -> dict | None:
    """An `ObjectiveSetup` as scene.json carries it (ledger OBJ-1..OBJ-6).

    One `objectives` entry per placed spawner that spawns an objective, named
    by the spawner (what a composite's members and the roots name), with the
    objective template's kind, side, delay and kind's own words. `targets`
    are the pads a DestroyTarget objective watches, at their glTF position,
    so the page can find the hull each one stands up. None when the chain
    places no objective at all.
    """
    entries = []
    for placement, spec in setup.objective_spawners():
        kind = _OBJECTIVE_KIND.get(spec.kind.lower())
        if kind is None:
            continue
        entry = {"spawner": placement.name, "template": spec.name, "kind": kind,
                 "team": spec.team, "delay": spec.delay}
        if spec.objective_name:
            entry["objectiveName"] = spec.objective_name
        if kind == "DestroyTarget":
            entry["target"] = spec.target
        elif kind == "ANDComposite":
            entry["members"] = list(spec.members)
        elif kind == "Timer":
            entry["timeLimit"] = spec.time_limit
        entries.append(entry)
    if not entries:
        return None
    targets = []
    for placement in setup.target_pads():
        targets.append({
            "name": placement.name, "spawner": placement.template,
            "template": setup.spawned(placement), "team": setup.spawner_team(placement),
            "position": em._to_gltf_vec(placement.position),
        })
    return {
        "defender": setup.defender,
        "defenderLoseTicketsOnDeath": setup.defender_lose_tickets_on_death,
        "attackerLoseTicketsOnDeath": setup.attacker_lose_tickets_on_death,
        "roots": {str(team): name for team, name in sorted(setup.roots.items())},
        "objectives": entries,
        "targets": targets,
    }


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
    # The animated-mesh light terms (ledger DL-5, DL-6): written resolved, a
    # declared value or the client's own initial one (0.3 and 1.0), so a
    # scene.json that carries them is one the layer wrote and the viewer can
    # tell it from one written before the layer existed.
    lighting["animatedMeshAmbient"] = list(
        info.lighting.animated_mesh_ambient or (0.3, 0.3, 0.3))
    lighting["animatedMeshDiffuseFactor"] = (
        info.lighting.animated_mesh_diffuse_factor
        if info.lighting.animated_mesh_diffuse_factor is not None else 1.0)
    # The engine's draw distance is `Game.setViewDistance` (declared by every
    # vanilla level; the video slider scales it). `renderer.setViewdistance`
    # is a raw renderer poke only Tobruk carries, and the game overrides it
    # there (Game VD 300 vs the stray 700; the in-game haze wall sits at 300).
    view_distance = info.game_view_distance or info.view_distance or 700.0
    # The fog range is the client's own after the level's scripts have run
    # (ledger FOG-4, `bf42/level.py` `engine_set_view_distance`): the view
    # distance sets it, a quarter of it to all of it and each 50 m less on a
    # level that sees past 200 m, and a declared `fogStart`/`fogEnd` replaces
    # a word only where the client keeps it. Until 2026-10-12 an undeclared
    # range was written as half the view distance to all of it (FOG-3, read
    # off the server, whose function sets no fog): Battle of Foy's haze began
    # at 175 m where the game's begins at 37.5.
    fog_start = info.engine_fog_start
    fog_end = info.engine_fog_end
    return {
        "waterLevel": info.terrain.water_level,
        "fogColor": list(info.fog_color),
        "fogStart": fog_start,
        "fogEnd": fog_end,
        "sunDirection": em._to_gltf_vec(info.sun_direction),
        "camera": em._to_gltf_vec(info.camera) if info.camera else None,
        "lighting": lighting or None,
        "drawDistance": view_distance,
        # `GeometryTemplate.targetTriCount`, the client's terrain tessellation
        # budget (read at PatchTerrain init; 4000 on the 1024 m levels, 5000
        # on the 2048 m ones). Informational: the viewer ships the full
        # heightmap grid, which is deliberately more detailed than the
        # engine's budget. `lodDistance`, authored beside it, is dead in the
        # retail binary and is not carried (level-content.md Gap 10).
        "targetTriCount": info.terrain.target_tri_count,
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
        vehicles=em.spawned_vehicle_templates(info, library),
        shared_dir=ctx.shared_sounds, audio_format=ctx.audio_format,
        final_dir=ctx.final_level_dir())}, {}


def layer_ai(ctx: LevelContext):
    info, files = ctx.info, ctx.files
    level_ai = load_level_ai(files)
    out = {}
    if level_ai is not None:
        # A template table, so a mode script's statics join it untagged: a
        # lookup for a template the active layer does not place is never made.
        placed = [inst.template for inst in info.static_objects]
        placed += [inst.template for inst, _modes
                   in em.union_mode_statics(info, ctx.library)]
        add_cover_values(level_ai, ctx.library, placed)
        out["ai"] = level_ai.to_json()
    # The search maps the level ships baked and `ai.loadMaps` loads; written
    # (or a stale folder removed) either way, as the full bake always has.
    write_level_search_maps(files, level_ai, ctx.level_dir())
    return out, {}


def layer_heightmap(ctx: LevelContext):
    # The whole `Heightmap.raw`, drawn patches and undrawn alike: what the
    # viewer's colliders stand everything on (`viewer/heightfield.js`
    # `heightfieldFromSamples`). A pure function of the level's terrain, so a
    # tree gains it without a geometry bake.
    return {"heightmap": em.write_terrain_heightmap(ctx.heightmap, ctx.level_dir())}, {}


def layer_terrain_detail(ctx: LevelContext):
    # The terrain's detail texture (`GeometryTemplate.detailTexName`), which
    # the viewer adds to every colour tile (TERR-15). A side file and a key,
    # so a level whose detail went missing is mended without a geometry bake.
    # A level with no detail texture has no key.
    detail = em.write_terrain_detail(ctx.files, ctx.info, ctx.level_dir())
    return ({"terrainDetail": detail} if detail else {}), {}


def layer_materials(ctx: LevelContext):
    """Two `.rs` words a glb material does not carry, by lower-case name.

    `depthWriteOff`: the materials that declare `depthWrite false`. The client
    writes depth for every material unless it says otherwise (its `+0x32` byte
    starts at 1, ledger DL-8), so the list is the exception: 96 of vanilla,
    XPack1 and XPack2's 509 `transparent true` materials. A glTF `alphaMode
    BLEND` carries no such bit and three's loader turns depth writing off for
    all of them, which painted a hull's interior over itself (the Ilyushin's
    instrument panel, behind its own cowl). The viewer reads this key to give
    every other blended interior material its depth back.

    `materialDiffuse`: the lit materials whose `materialDiffuse` is not white,
    grouped by colour (`{"0.588235 0.588235 0.588235": [names]}`). It is the
    Diffuse of the material the client hands Direct3D, whose Ambient is always
    white (ledger DL-7, DL-9), so it scales the sun's term of the fixed-function
    sum and not the ambient floor. Forgotten Hope exported 1812 of its 9392
    materials at 3ds max's default 0.588 grey; the viewer lit them all as
    white. `lighting false` materials are left out: nothing lights them.

    Names are what the glb's materials are called (the `.rs` block's name).
    Where two files declare one name, the order is the one a mesh's shader
    file is found in (`ArchivePool.add_level_meshes`): the mod chain's
    archives and the object scripts' `Art/` overrides, then the level's own
    archive, then the other levels'.
    """
    # The level's own `StandardMesh/` and the other levels' archives, mounted
    # the way a bake mounts them, so a patch reads the files a bake read.
    em.mount_level_pools(ctx)
    meshes, _textures, objects, _game = ctx.pools
    seen: dict[str, rs.Shader] = {}
    own = f"bf1942/levels/{ctx.info.name.lower()}/"

    def nearest_first(name: str) -> tuple[int, str]:
        # Two files can declare one block name with different words (a wreck's
        # `.rs` repeating its hull's, a level's older copy of a chain mesh)
        # and the pool lists its names in no fixed order, so the order is
        # made: the level's own archive fills what the chain does not
        # declare, and another level's, mounted at its own path, what neither
        # declares.
        low = name.lower()
        if "/levels/" not in low:
            return (0, low)
        return (1 if low.startswith(own) else 2, low)

    for pool in (objects, meshes):
        for name in sorted(pool.names(), key=nearest_first):
            if not name.lower().endswith(".rs"):
                continue
            blob = pool.try_read(name)
            if blob is None:
                continue
            for key, shader in rs.parse(blob.decode("latin-1", "replace")).items():
                if key == shader.name.lower() and key not in seen:
                    seen[key] = shader
    diffuse: dict[str, list[str]] = {}
    for key, shader in seen.items():
        colour = material_diffuse(shader)
        if colour is not None:
            diffuse.setdefault(" ".join(f"{c:g}" for c in colour), []).append(key)
    return {
        "depthWriteOff": sorted(k for k, v in seen.items() if not v.depth_write),
        "materialDiffuse": {c: sorted(names) for c, names in sorted(diffuse.items())},
        "alphaBlend": sorted(k for k, v in seen.items() if blends_near(v)),
        "alphaLodDistance": alpha_lod_distances(objects),
    }, {}


def blends_near(shader: rs.Shader) -> bool:
    """A `transparent true` material that also names an alpha test: the bake
    writes it `alphaMode MASK` at that reference, which is how the client
    draws it past the geometry's `alphaLodDistance` only. Nearer than that it
    blends, with the reference at 0 (ledger DL-12)."""
    return (shader.transparent and shader.alpha_test is not None
            and not shader.additive)


_ALPHA_LOD = re.compile(
    r"(?im)^\s*GeometryTemplate\.(create\s+\S+\s+(\S+)|alphaLodDistance\s+(-?[0-9.]+))")


def alpha_lod_distances(objects) -> dict[str, float]:
    """`GeometryTemplate.alphaLodDistance` by lower-case geometry name, where
    a script sets one. The word is the mesh template's `+0x104`, 100 m until
    set (client `0x005b5c28`, setter `0x005b5e50`); 22 vanilla geometries set
    0 (barbed wire, fences: never blended) and 15 set 750."""
    out: dict[str, float] = {}
    for name in sorted(objects.names(), key=str.lower):
        if not name.lower().endswith(".con"):
            continue
        blob = objects.try_read(name)
        if blob is None or b"lphaloddistance" not in blob.lower():
            continue
        current = None
        for match in _ALPHA_LOD.finditer(blob.decode("latin-1", "replace")):
            if match.group(2):
                current = match.group(2).lower()
            elif current is not None and current not in out:
                try:
                    out[current] = float(match.group(3))
                except ValueError:
                    pass
    return dict(sorted(out.items()))


_TERRAIN_WORD = re.compile(
    r"(?im)^\s*Terrain\.(shadowAmbient|shadowBorderFadeTime|shadowSamplingCullY|"
    r"shadowStaticObjectsCullBox)\s+(\S+)")


def terrain_shadow_words(files) -> dict:
    """The four `Terrain.*` words that steer an object's shade, from the
    scripts a level load runs, over the constructor's values."""
    from bf42 import terrainshade
    words = {
        "ambient": list(terrainshade.DEFAULT_SHADOW_AMBIENT),
        "fadeTime": terrainshade.DEFAULT_FADE_TIME,
        "cullY": terrainshade.DEFAULT_CULL_Y,
        "cullBox": list(terrainshade.DEFAULT_CULL_BOX),
    }
    keys = {"shadowambient": "ambient", "shadowborderfadetime": "fadeTime",
            "shadowsamplingcully": "cullY", "shadowstaticobjectscullbox": "cullBox"}
    for script in ("Init.con", "Init/Terrain.con"):
        path = files.find(script)
        if not path:
            continue
        text = files.read(path).decode("latin-1", "replace")
        for match in _TERRAIN_WORD.finditer(text):
            key = keys[match.group(1).lower()]
            try:
                values = [float(v) for v in match.group(2).split("/")]
            except ValueError:
                continue
            if key in ("ambient", "cullBox"):
                if len(values) == 3:
                    words[key] = values
            elif values:
                words[key] = values[0]
    return words


def layer_terrain_shade(ctx: LevelContext):
    """What the terrain answers when an object asks how lit its ground is
    (`PatchTerrain::getIntensity`, ledger DL-11), as two files: the level's
    shadow bits (`terrain/shadowbits.png`, `LightmapShadowBits.lsb` laid out
    for a reader that seeks, carried as a PNG's bytes) and the luminance of
    the shadowed ground (`terrain/shade.png`, one byte a 2 m cell). With them
    the four `Terrain.*` words the client combines the answer with (DL-10).
    A level with no shadow bits has no key: every object there draws at full
    light."""
    from bf42 import terrainshade
    files, info = ctx.files, ctx.info
    lsb_path = files.find("Textures/LightmapShadowBits.lsb")
    if not lsb_path:
        return {}, {}
    tiles = {(col, row): entry for col, row, entry in files.tiles()}

    def read_tile(col, row):
        entry = tiles.get((col, row))
        return files.read(entry) if entry else None

    terrain = info.terrain
    side, luma, bits, stats = terrainshade.shade_layer(
        terrain.world_size, ctx.heightmap.dim, terrain.tex_offset_x,
        terrain.tex_offset_y, files.read(lsb_path), read_tile)
    if not stats["shaded"]:
        return {}, {}
    dest = ctx.level_dir() / "terrain"
    dest.mkdir(parents=True, exist_ok=True)
    packed, _rows = terrainshade.bytes_png(bits)
    for name, data in (("shade.png", terrainshade.grey_png(side, side, bytes(luma))),
                       ("shadowbits.png", packed)):
        target = dest / name
        if not target.is_file() or target.read_bytes() != data:
            target.write_bytes(data)
    return {"terrainShade": {
        "image": "terrain/shade.png",
        "dim": side,
        "cell": terrain.world_size / side,
        "bits": "terrain/shadowbits.png",
        "bitsBytes": len(bits),
        "shaded": round(stats["shaded"], 4),
        **terrain_shadow_words(files),
    }}, {}


def layer_lightmaps(ctx: LevelContext):
    """The level's object lightmaps, `lightmaps/<mesh>_<x>-<y>-<z>.png`, the
    files a `scene.glb` names in each static's `extras.lightmap`. Rewritten in
    place (same names, so no glb changes) when their colours move: they did
    on 2026-10-14, when the client was found to colour them through the
    level's `ObjectLightmaps/Palette.pal` (ledger LM-5). No scene.json key."""
    em.write_object_lightmaps(ctx.files, ctx.level_dir())
    return {}, {}


def material_diffuse(shader: rs.Shader) -> tuple[float, float, float] | None:
    """A lit shader's `materialDiffuse` when it is not white, else None."""
    if not shader.lighting or shader.diffuse is None:
        return None
    colour = tuple(min(1.0, max(0.0, c)) for c in shader.diffuse)
    return None if all(c >= 0.999 for c in colour) else colour


COMPUTE = {
    "controlPoints": layer_control_points,
    "spawns": layer_spawns,
    "game": layer_game,
    "environment": layer_environment,
    "damage": layer_damage,
    "materials": layer_materials,
    "sounds": layer_sounds,
    "ai": layer_ai,
    "heightmap": layer_heightmap,
    "terrainShade": layer_terrain_shade,
    "terrainDetail": layer_terrain_detail,
    "lightmaps": layer_lightmaps,
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
