#!/usr/bin/env python3
"""Export what each level hands each team, and what each kit puts in hand.

    python3 extract_loadouts.py --out ./viewer/maps/_shared/loadouts.json
    python3 extract_loadouts.py --mod EoD --out ./viewer/maps/mods/eod/_shared/loadouts.json
    python3 extract_loadouts.py --list

The map page's deploy screen has five kit rows; the game decides what a row
puts in the player's hands in two places, neither of them the level's own
scene:

* the level's `Init.con` — `game.setTeamSkin <team> <soldier>` and
  `game.setKit <team> <slot> <kit>`, replayed top to bottom (`kit.parse_level_kits`);
* the kit's `Objects.con` — the `HandFireArms` it `addTemplate`s at
  `itemIndex 3`, which is the slot the engine selects on spawn
  (`kit.primary_weapon`).

One small JSON per mod carries both halves, keyed the way the page looks them
up: levels by the lowercased archive stem (the directory `extract_map.py`
writes), kits by the name their `create` line spells. Everything in it is read
from the game files; nothing is a hand-maintained table of who carries what.

A level that runs its own copy of a kit hands out that copy (ledger LOAD-1,
LOAD-2, LOAD-5): its row goes in `levelKits[<level>][<kit>]`, beside the mod's
in `kits` (`build_manifest`, `read_chain_levels`).

A kit a level's ObjectSpawners lay on a pad (`kit.level_pads`) gets a row in
`kits` too, though no deploy-screen slot names it: Desert Combat 0.7 hands out
its M82 (`US_Sniper_hvy`) and Stinger (`US_AA`) kits only that way, and the
page makes a pad only for a kit this file knows (`deployables-page.js`).

Standard library plus the system liblzo2, same as the rest of the pipeline.
"""

from __future__ import annotations

import argparse
import gc
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import con as con_mod
from bf42 import kit as kit_mod
from bf42.modmenu import MenuSources

import extract_map as em
from extract_models import (DEFAULT_GAME_DIR, build_library, build_pools,
                            discover_levels, mod_chain)
from extract_spawn_layout import load_chain_lexicon


def _soldier_hit_points(library: con_mod.ObjectLibrary,
                        soldier: str | None) -> tuple[float | None, float | None]:
    """A bound soldier template's `hitpoints`/`maxHitpoints`, or (None, None).

    A Kit carries no hit points of its own -- they are a `BFSoldier` stat
    (`CommonSoldierData.inc`'s `HitPoints`/`MaxHitPoints`, reached through the
    bare `include` directive every nation's `Objects.con` uses; see
    `extract_models._inline_includes`) -- so this reads them off the soldier
    the level's own `game.setTeamSkin` paired with the kit's team, at the
    point a kit first enters `rows` below. Vanilla's 30/30 is identical
    across every nation; read per kit rather than hoisted to a constant in
    case a mod's soldier differs.
    """
    template = library.object(soldier) if soldier else None
    if template is None:
        return None, None
    return template.hitpoints, template.max_hitpoints


class LevelLoad:
    """What one level's load declares: its library, the level's own scripts
    first (`extract_map.LevelFirst`), and a reader for the `.con` files the
    library was built from (`ArchivePool.try_read`).

    The pool and library materialize on first use and are dropped again by
    `release()`. Holding every level's load of a chain alive at once ran the
    process out of memory (FHSW: ~200 levels, 1,397 of its kits declared in
    level archives); a caller materializes one level at a time and releases
    it unless it keeps something of theirs.
    """

    def __init__(self, library=None, read=None, chain=None, name=None):
        self._library = library
        self._read = read
        self.chain = chain
        self.name = name

    def _materialize(self) -> None:
        if self._library is not None or self.chain is None:
            return
        _m, _t, pool, _g = build_pools(self.chain, [])
        em.add_level_run_objects(pool, self.chain, self.name)
        self._library = build_library(em.LevelFirst(pool))
        self._read = pool.try_read

    @property
    def library(self):
        self._materialize()
        return self._library

    @property
    def read(self):
        self._materialize()
        return self._read

    def release(self) -> None:
        if self.chain is None:
            return   # the census load is not releasable
        self._library = None
        self._read = None


def kit_row(library: con_mod.ObjectLibrary, kit: kit_mod.Kit, soldier: str | None,
            lexicon: dict[str, str] | None = None,
            read: Callable[[str], bytes | None] | None = None) -> dict:
    """One kit's row: what it puts in hand and the art the screens draw for it.

    `soldier` is the soldier template the binding level's `game.setTeamSkin`
    pairs with the kit's team (its hit points). `read`, when given, reads the
    kit's `ActiveKitPart`s back for `overrideAirMovementInhibitations`
    (`kit.overrides_air_movement`), written only when set.
    """
    items = [
        (library.object(item).name if library.object(item) else item)
        for item in kit.carried]
    kit_template = library.object(kit.template)
    # What the number keys select: every carried weapon's
    # `itemIndex` — the inventory slot, i.e. the number key
    # that raises it (kit.py's census: 1 knife, 2 pistol, 3
    # primary, 4 grenade, 5 medpack/binoculars/...). The kit's
    # own `addWeaponIcon` list is the weapon bar's row, also in
    # slot order — the game paints it in the order it raises
    # weapons, not the order `addTemplate` declares them (the
    # vanilla US_Medic file declares Thompson, Colt, Knife,
    # MedPack, Grenade but its icons run knife, colt,
    # thompson, grenade, medpack; EoD's do the same) — so an
    # icon pairs with the weapon at the same position in
    # slot order. A carried item that declares no
    # `itemIndex` (none in vanilla) cannot be selected and is
    # left out. The sort is stable, so the kit's declaration
    # order is the tie-break for a mod that files two weapons
    # at one slot (`GerKit`: "first the best weapons!").
    weapon_icons = (list(kit_template.kit_weapon_icons)
                    if kit_template else [])
    weapons = []
    rolled = {entry.template.lower(): entry for entry in kit.random}
    for carry_index, item in enumerate(kit.carried):
        item_template = library.object(item)
        if item.lower() in rolled:
            # A rolled item keeps the kit's name here, at its variants' slot
            # (they include one weapon's file); the page rolls which variant
            # a spawn holds (`random`, below).
            item_template = next(
                (library.object(v) for v in rolled[item.lower()].variants
                 if v), None)
            if item_template is None or item_template.item_index is None:
                continue
            weapons.append({"slot": item_template.item_index,
                            "weapon": item,
                            "carryIndex": carry_index})
            continue
        if item_template is None or item_template.item_index is None:
            continue
        weapons.append({
            "slot": item_template.item_index,
            "weapon": (item_template.name if item_template
                       else item),
            "carryIndex": carry_index,
        })
    weapons.sort(key=lambda entry: entry["slot"])
    for position, entry in enumerate(weapons):
        entry["icon"] = (weapon_icons[position]
                         if position < len(weapon_icons)
                         else None)
        del entry["carryIndex"]
    hitpoints, max_hitpoints = _soldier_hit_points(library, soldier)
    row = {
        "nation": kit.nation,
        "class": kit.kit_class,
        "team": kit.team,
        "primary": kit.primary,
        "items": items,
        "weapons": weapons,
        # The HUD health bar a soldier wearing this kit draws,
        # and the row of icons the spawn screen shows under
        # the kit portrait -- `setHealthBarIcon`/
        # `setHealthBarFullIcon`/`setKitIcon`/`addWeaponIcon`
        # on the Kit template itself.
        "healthBarIcon": (
            kit_template.kit_health_bar_icon if kit_template else None),
        "healthBarFullIcon": (
            kit_template.kit_health_bar_full_icon
            if kit_template else None),
        "kitIcon": (
            {"index": kit_template.kit_icon[0],
             "icon": kit_template.kit_icon[1]}
            if kit_template and kit_template.kit_icon else None),
        # The row's label: the kit's own `setKitName` lexicon
        # key, resolved through the mod chain's lexicon — the
        # same resolution the SkirmishMenu titles get. The
        # key is kept alongside the text so a page reading an
        # older file (or a key the lexicon lacks) can still
        # fall back to its own layout's string.
        "kitName": (
            {"index": kit_template.kit_name[0],
             "key": kit_template.kit_name[1],
             "text": (lexicon or {}).get(kit_template.kit_name[1])}
            if kit_template and kit_template.kit_name else None),
        "weaponIcons": (
            list(kit_template.kit_weapon_icons)
            if kit_template else []),
        "hitpoints": hitpoints,
        "maxHitpoints": max_hitpoints,
        # Every child the kit rolls on a spawn, in the order the engine
        # rolls them (`bf42/kit.py` `RandomItem`): worn parts too, since
        # they bump the same counter. A carried item named here is a
        # bundle; the page swaps it for the variant its roll lands on.
        "random": [entry.as_dict() for entry in kit.random],
    }
    # A kit wearing `nochute` (DC Final's Lost Village nopara, EoD's non-
    # `_CHUTE` twins): the soldier never enters free fall, so he has no
    # chute to open (`kit.overrides_air_movement`, PARA-1, PARA-4).
    if (read is not None and kit_template is not None
            and kit_mod.overrides_air_movement(library, kit_template, read)):
        row["overrideAirMovementInhibitations"] = True
    # An `ActiveKitPart` that accelerates the wearer (XPack2's rocket pack:
    # `setActiveAcceleration 0/72/0`, a passive lift, a heat bar). The page's
    # `rocket-pack.js` runs `ActiveKitPart::update` over these words.
    if read is not None and kit_template is not None:
        parts = kit_mod.active_parts(library, kit_template, read)
        if parts:
            row["activeParts"] = parts
    return row


def build_manifest(library: con_mod.ObjectLibrary, kits: dict[str, kit_mod.Kit],
                   loadouts: dict[str, dict[int, kit_mod.TeamLoadout]],
                   mod: str,
                   lexicon: dict[str, str] | None = None,
                   level_loads: dict[str, LevelLoad] | None = None,
                   read: Callable[[str], bytes | None] | None = None,
                   pads: dict[str, dict[str, str]] | None = None) -> dict:
    """The file the page loads, from collected kits and swept levels.

    Only kits some level binds are listed — a dead kit cannot be spawned with,
    and vanilla declares ten of them. A level naming a kit the library does
    not hold keeps the raw name so the gap is visible in the file rather than
    silently dropped; the page treats an unknown kit as no primary.

    `lexicon` is the mod chain's merged lexicon (`load_chain_lexicon` over
    `MenuSources.lexicon_paths` — the same file the SkirmishMenu titles
    resolve through): it turns each kit's `setKitName` lexicon key into the
    display string the deploy screen's row is labelled with. Absent (a test
    or a chain with no lexiconAll.dat), the key is still emitted and `text`
    is null; the page falls back to its own layout's resolved string.

    `level_loads` holds, per level (the loadouts' key), the library a load of
    that level builds when its own scripts declare something one of its
    kits reaches (`read_chain_levels`). A level's declaration of a template
    beats the mod's (LOAD-1, LOAD-2), so the kit it hands out can differ from
    the mod's of the same name: DC Final's Lost Village nopara runs its own
    twelve kits, each with a `nochute`, and First Light its own `US_AT3` with
    a Landmine. Such a row goes in `levelKits[<level>][<kit>]`; `kits` keeps
    the mod's row, so a page that does not know `levelKits` still reads a
    kit for every slot. `read` reads the `library`'s scripts, for the
    `nochute` flag (`kit_row`).

    `pads` (`kit.level_pads`, keyed like `loadouts`) adds a row for every kit
    a level's ObjectSpawners place, and a `levelKits` row where the level runs
    its own copy of one. A kit some slot also binds keeps the row the slot
    gives it (its hit points are its first slot's soldier's); a kit only pads
    place reads its soldier's off the level's team of the kit's `setKitTeam`.
    """
    rows: dict[str, dict] = {}
    # Where each row's items resolve: the AI weapon table reads them back.
    row_library: dict[str, con_mod.ObjectLibrary] = {}
    level_kits: dict[str, dict[str, dict]] = {}
    levels: dict[str, dict] = {}
    # The soldier as his `create` line spells him, not as `setTeamSkin` does:
    # every pose, rig and viewmodel is named after the former.
    kit_mod.spell_soldiers(loadouts, library)
    # A kit's row is written the first time any level meets it, a pad
    # included, and its soldier is its first slot's wherever that comes.
    slot_soldier: dict[str, str | None] = {}
    for _level_name, teams in sorted(loadouts.items()):
        for _team_id, team in sorted(teams.items()):
            for _slot, name in sorted(team.slots.items()):
                slot_soldier.setdefault(name.lower(), team.soldier)

    def bind(kit: kit_mod.Kit, soldier: str | None, level_name: str, own,
             own_kits) -> None:
        if kit.template not in rows:
            rows[kit.template] = kit_row(
                library, kit, slot_soldier.get(kit.template.lower(), soldier),
                lexicon, read)
            row_library[kit.template] = library
        level_kit = own_kits.get(kit.template.lower()) if own_kits is not None else None
        if level_kit is not None:
            row = kit_row(own.library, level_kit, soldier, lexicon, own.read)
            if row != rows[kit.template]:
                level_kits.setdefault(level_name.lower(), {})[kit.template] = row
                row_library[f"{level_name.lower()}\0{kit.template}"] = own.library

    for level_name, teams in sorted(loadouts.items()):
        own = (level_loads or {}).get(level_name)
        own_kits = kit_mod.collect(own.library) if own is not None else None
        level_entry: dict[str, dict] = {}
        for team_id, team in sorted(teams.items()):
            slots: dict[str, str] = {}
            for slot, name in sorted(team.slots.items()):
                kit = kits.get(name.lower())
                if kit is None:
                    slots[str(slot)] = name
                    continue
                slots[str(slot)] = kit.template
                bind(kit, team.soldier, level_name, own, own_kits)
            level_entry[str(team_id)] = {"soldier": team.soldier, "slots": slots}
        levels[level_name.lower()] = level_entry
        # What the level's pads place: anyone takes it, so the soldier is
        # only the hit points' label -- the kit's own side's, else the first.
        fielded = [team.soldier for _team_id, team in sorted(teams.items())]
        for key in sorted((pads or {}).get(level_name, {})):
            kit = kits.get(key)
            if kit is None:
                continue
            side = teams.get(kit.team) if kit.team is not None else None
            soldier = side.soldier if side is not None else next(
                (name for name in fielded if name), None)
            bind(kit, soldier, level_name, own, own_kits)
        # The level's own pool and library are only kept when one of its
        # rows differs from the mod's (`row_library` above) - the AI weapon
        # pass and the assembler read them back from there. Holding every
        # level's load alive at once ran the process out of memory.
        if own is not None and not any(k.startswith(f"{level_name.lower()}\0")
                                       for k in row_library):
            own.release()
    # The AI weapon templates behind every carried item (`ObjectTemplate.
    # aiTemplate <name>` -> `weaponTemplate.create <name>` in the weapon's
    # `Ai/Weapons.con`): what a bot's fire behaviour reads for deviation,
    # ranges, burst, the trigger channel and the strength-per-armour table
    # (research README §6.2-6.3, bot-behaviours.md §3).
    ai_weapons: dict[str, dict] = {}
    carried = [(row, row_library[name]) for name, row in rows.items()]
    carried += [(row, row_library[f"{level}\0{name}"])
                for level, own_rows in sorted(level_kits.items())
                for name, row in own_rows.items()]
    for row, source in carried:
        held = list(row["items"])
        for entry in row["random"]:
            held.extend(v for v in entry["variants"] if v)
        for item in held:
            if item in ai_weapons:
                continue
            template = source.object(item)
            ai_name = template.ai_template if template else None
            ai = source.ai_weapon(ai_name) if ai_name else None
            if ai is None:
                continue
            ai_weapons[item] = {
                "aiTemplate": ai.name,
                "burst": ai.burst,
                "deviation": ai.deviation,
                "deviationCorrectionTime": ai.deviation_correction_time,
                "indirect": ai.indirect,
                "minRange": ai.min_range,
                "maxRange": ai.max_range,
                "weaponActivate": ai.weapon_activate,
                "weaponFire": ai.weapon_fire,
                "strength": dict(ai.strength),
                "soundSphereRadius": ai.sound_sphere_radius,
                "healing": ai.healing,
            }
    manifest = {
        "mod": mod,
        "primaryItemIndex": kit_mod.PRIMARY_ITEM_INDEX,
        "kits": dict(sorted(rows.items())),
        "levels": levels,
        "aiWeapons": dict(sorted(ai_weapons.items())),
    }
    if level_kits:
        manifest["levelKits"] = {level: dict(sorted(own_rows.items()))
                                 for level, own_rows in sorted(level_kits.items())}
    return manifest


# A template a script declares: `ObjectTemplate.create <Kind> <Name>` or the
# same for a geometry.
_DECLARED = re.compile(
    r"^\s*(?:objecttemplate|geometrytemplate)\.create\s+\S+\s+(\S+)",
    re.IGNORECASE | re.MULTILINE)


def kit_reach(library: con_mod.ObjectLibrary, names, depth: int = 6) -> set[str]:
    """`names` and every template and geometry they reach through
    `addTemplate`, lower case: what a kit's row and its worn parts read."""
    reached: set[str] = set()
    frontier = [(name.lower(), 0) for name in names if name]
    while frontier:
        name, level = frontier.pop()
        if name in reached:
            continue
        reached.add(name)
        template = library.object(name)
        if template is None:
            continue
        if template.geometry:
            reached.add(template.geometry.lower())
        if level < depth:
            frontier.extend((child.template.lower(), level + 1)
                            for child in template.children)
    return reached


def read_chain_levels(chain: list[Path], objects=None,
                      pads: dict[str, dict[str, str]] | None = None) -> tuple[
        LevelLoad, dict[str, dict[int, kit_mod.TeamLoadout]], dict[str, LevelLoad]]:
    """The mod chain's kits, what every level of it hands out, and the levels
    whose own load changes a kit they hand out.

    The census library is the chain's `Objects.rfa` with every level's own
    scripts behind it, so a kit only a level declares is bound like any other
    (DC Final's DC_First_Light `US_AA2`/`Iraq_AA2`, DC_LostVillage_nopara's
    `Iraq_Assault2`); without them those slots named kits the library did not
    hold and the page dealt its fallback (a K98 sniper, a Panzerschreck). A
    level's scripts are the ones its `Init.con` runs and nothing else of its
    archive (`extract_map.add_level_run_objects`, LOAD-5): Lost Village ships
    the nochute kits and runs none of them, Al Nas Day 2 its
    `objects/kits/kits.con`.

    A level whose own scripts declare a kit it binds, or anything such a kit
    reaches, or its soldier, gets a `LevelLoad` of its own: the chain's
    objects with that level's scripts first (`extract_map.LevelFirst`), the
    order a load runs them in. With `pads` (`kit.level_pads`), a kit the
    level's ObjectSpawners place counts as one it binds.

    `objects`, when given, is the chain's objects pool to register the
    levels' scripts into (`extract_kits.py` builds its own, for the
    assembler); otherwise one is built.
    """
    if objects is None:
        _meshes, _textures, objects, _game = build_pools(chain, [])
    levels = discover_levels(chain)
    loadouts = kit_mod.level_loadouts(levels)
    # Cheap pass first: what each level's run-reachable scripts declare, read
    # as text straight from the archives, nothing registered. This is only
    # the gate for a level's own load (`own`, below); the census itself needs
    # every level of the chain - FHSW declares 1,397 of its kits in level
    # archives - so their run-reachable scripts all register here, as the
    # engine's census would hold them, and the library builds ONCE: building
    # it twice (a chain-only probe, then the full census) starts the second
    # on top of memory the first has not returned, and ran the process out
    # of memory on a ~47 GB census.
    game_dir = chain[0].parent.parent if chain else Path()
    declared: dict[str, set[str]] = {}
    for name, _path in levels:
        try:
            paths = em.find_level_archives(game_dir, chain[0].name, name,
                                           chain=chain)
            if not paths:
                declared[name] = set()
                continue
            files = em.load_level_files(paths, name)
            names: set[str] = set()
            for script in em.level_run_scripts(files):
                blob = files.read(script)
                if blob:
                    text = con_mod.strip_comments(blob.decode("latin-1", "replace"))
                    names.update(m.group(1).lower()
                                 for m in _DECLARED.finditer(text))
            declared[name] = names
        except Exception as exc:  # noqa: BLE001 - one unreadable level
            print(f"  {name}: level scripts unreadable ({exc})", file=sys.stderr)
            declared[name] = set()
    for name, _path in levels:
        try:
            em.add_level_run_objects(objects, chain, name)
        except Exception as exc:  # noqa: BLE001 - one unreadable level
            print(f"  {name}: level scripts unreadable ({exc})", file=sys.stderr)
    gc.collect()   # the declared-scan's archives, before the census allocates
    library = build_library(objects)
    # A candidate level's own load materializes only when its row is asked
    # for (`build_manifest`), one level at a time, and is released unless the
    # level's row is kept - see `LevelLoad`.
    own: dict[str, LevelLoad] = {}
    for name, teams in sorted(loadouts.items()):
        if not declared.get(name):
            continue
        bound = [kit for team in teams.values() for kit in team.slots.values()]
        bound += [team.soldier for team in teams.values() if team.soldier]
        # Only the kits among what its pads place: a vehicle on a pad changes
        # no kit row, and a level's own load is a library build (bg42: 17
        # levels opened for their vehicles, 7x the run time, the same file).
        bound += [spelled for spelled in (pads or {}).get(name, {}).values()
                  if (placed := library.object(spelled)) is not None
                  and placed.kind.lower() == "kit"]
        if not declared[name] & kit_reach(library, bound):
            continue
        own[name] = LevelLoad(chain=chain, name=name)
    return LevelLoad(library, objects.try_read), loadouts, own


def read_chain(chain: list[Path]) -> tuple[con_mod.ObjectLibrary,
                                            dict[str, dict[int, kit_mod.TeamLoadout]]]:
    """The mod chain's census library and what every level of it hands out
    (`read_chain_levels` without the per-level loads)."""
    census, loadouts, _own = read_chain_levels(chain)
    return census.library, loadouts


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent / "viewer" / "maps"
                    / "_shared" / "loadouts.json")
    ap.add_argument("--list", action="store_true",
                    help="print the kit and level tables without writing anything")
    args = ap.parse_args()

    chain = mod_chain(args.game_dir.expanduser(), args.mod)
    if not chain:
        print(f"no mod chain for {args.mod}", file=sys.stderr)
        return 1
    # What every level's placed ObjectSpawners name: the kits among them lie
    # on pads (`kit.level_pads`), and the page arms whoever takes one.
    pads = kit_mod.level_pads(discover_levels(chain), chain)
    census, loadouts, level_loads = read_chain_levels(chain, pads=pads)
    library = census.library
    kits = kit_mod.collect(library)
    # The kit row labels resolve through the same merged lexicon the
    # SkirmishMenu titles do (extract_menu_layout.py's own call).
    lexicon = load_chain_lexicon(MenuSources(chain).lexicon_paths)
    manifest = build_manifest(library, kits, loadouts, args.mod, lexicon,
                              level_loads=level_loads, read=census.read, pads=pads)
    for level, own_rows in manifest.get("levelKits", {}).items():
        print(f"  {level}: its own {', '.join(own_rows)}", file=sys.stderr)
    bound = {name.lower() for level in manifest["levels"].values()
             for team in level.values() for name in team["slots"].values()}
    on_pads = sorted({kits[key].template for level, named in pads.items()
                      if level in loadouts for key in named
                      if key in kits and key not in bound})
    if on_pads:
        print(f"  on pads only: {', '.join(on_pads)}", file=sys.stderr)

    unarmed = [name for name, row in manifest["kits"].items() if not row["primary"]]
    unknown = sorted({name for level in manifest["levels"].values()
                      for team in level.values()
                      for name in team["slots"].values()
                      if name not in manifest["kits"]})
    print(f"{args.mod}: {len(loadouts)} levels, {len(manifest['kits'])} bound kits"
          + (f", {len(unarmed)} with no itemIndex-{kit_mod.PRIMARY_ITEM_INDEX} weapon:"
             f" {', '.join(unarmed)}" if unarmed else "")
          + (f", {len(unknown)} named but undeclared: {', '.join(unknown)}"
             if unknown else ""),
          file=sys.stderr)

    if args.list:
        for name, row in manifest["kits"].items():
            print(f"  {name:30s} {str(row['nation']):14s} {row['class']:10s} "
                  f"{str(row['primary'])}")
        for level, teams in manifest["levels"].items():
            print(f"  {level}")
            for team_id, team in teams.items():
                print(f"    team {team_id} {str(team['soldier']):22s} "
                      + "  ".join(f"{slot}:{kit}" for slot, kit in team["slots"].items()))
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(manifest, indent=1))
    print(f"-> {args.out} ({args.out.stat().st_size // 1024} KB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
