"""Who fields what, and where.

The extractor knows an object's *category* from the folder it was declared in
(`Objects/Vehicles/Land/` -> `land`). Nothing in that path says which army drove
it, so the browse facets the viewer needs — faction, side, kit class, the maps a
thing actually appears on — are derived here from two other places in the
archives:

* **Kits** (`Objects/Items/<Nation>Kit/<Class>/Objects.con`) declare a nation and
  a class in their path and then `addTemplate` their way down to the hand
  weapons. Walking that tree gives every pistol, rifle and satchel its owners.
* **Levels** pair `game.setTeamSkin <team> <soldier>` in `Init.con` with
  `Conquest/ObjectSpawnTemplates.con`, where `setObjectTemplate <team> <vehicle>`
  says which side spawns what. Sweeping every level archive gives vehicles their
  factions, the map list, and — from the soldiers a map fields — its theatre.

Everything here is read from the game files. Nothing is a hand-maintained table
of "the Tiger is German", so a mod with its own armies describes itself.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from . import con as con_mod
from . import level as level_mod
from .rfa import ArchivePool

# Soldier templates and kit path segments both name a nation, in different
# spellings. `GermanDesertSoldier` and `German_AT` are the same army.
NATION_LABELS = {
    "ger": "German",
    "german": "German",
    "germandesert": "German",
    "us": "US",
    "usmarine": "US Marines",
    "brit": "British",
    "british": "British",
    "gb": "British",
    "canadian": "Canadian",
    "russ": "Soviet",
    "russian": "Soviet",
    "jap": "Japanese",
    "japanese": "Japanese",
    "specialforces": "Special Forces",
    "vietcong": "Viet Cong",
}

AXIS_NATIONS = {"German", "Japanese"}

# `GB_AT` and `Canadian_Assault` spell their class differently to the folder that
# holds them; the folder is the one that is consistent.
KIT_CLASS_LABELS = {
    "antitank": "Anti-tank",
    "assault": "Assault",
    "engineer": "Engineer",
    "medic": "Medic",
    "scout": "Scout",
}

KIT_SOURCE = re.compile(r"objects/items/(\w+?)kit/(\w+)/objects\.con$")
SOLDIER_NATION = re.compile(r"^(\w+?)(?:desert)?soldier$")
# `Berlin_003.rfa` is a patch layer over `Berlin.rfa`, not a level of its own.
LEVEL_PATCH = re.compile(r"_\d{3}$")


def nation_label(token: str) -> str | None:
    return NATION_LABELS.get(token.strip().lower().replace("_", ""))


def side_of(nation: str) -> str:
    return "Axis" if nation in AXIS_NATIONS else "Allied"


def theatre_of(skins: list[str]) -> str:
    """Which front a level is on, from the soldiers it fields.

    A map that dresses anyone in desert kit is North Africa; Japanese or Marine
    infantry means the Pacific; Soviets mean the Eastern Front. Anything else is
    the western campaign.
    """
    lowered = [skin.lower() for skin in skins]
    if any("desert" in skin for skin in lowered):
        return "North Africa"
    if any("japanese" in skin or "usmarine" in skin for skin in lowered):
        return "Pacific"
    if any("russian" in skin for skin in lowered):
        return "Eastern Front"
    return "Western Europe"


@dataclass
class Roster:
    """Derived ownership, indexed by lowercased template name."""

    factions: dict[str, set[str]] = field(default_factory=dict)
    kit_classes: dict[str, set[str]] = field(default_factory=dict)
    levels: dict[str, set[str]] = field(default_factory=dict)
    theatres: dict[str, set[str]] = field(default_factory=dict)

    def _add(self, table: dict[str, set[str]], template: str, value: str) -> None:
        table.setdefault(template.lower(), set()).add(value)

    def entry(self, template: str) -> dict[str, list[str]]:
        key = template.lower()
        factions = sorted(self.factions.get(key, set()))
        return {
            "factions": factions,
            "sides": sorted({side_of(nation) for nation in factions}),
            "kitClasses": sorted(self.kit_classes.get(key, set())),
            "levels": sorted(self.levels.get(key, set())),
            "theatres": sorted(self.theatres.get(key, set())),
        }


def _descend(library: con_mod.ObjectLibrary, root: str, depth: int = 0,
             seen: set[str] | None = None):
    """Every template reachable from `root` through `addTemplate`."""
    seen = set() if seen is None else seen
    key = root.lower()
    if key in seen or depth > 12:
        return
    seen.add(key)
    yield root
    template = library.object(root)
    if template is None:
        return
    for child in template.children:
        yield from _descend(library, child.template, depth + 1, seen)


def add_kits(roster: Roster, library: con_mod.ObjectLibrary) -> int:
    """Nation and class for everything a kit carries.

    A kit reaches its weapons through the same `addTemplate` chain the assembler
    walks, so the hand weapon the viewer exported (`Bazooka`) is found even
    though the kit only names its wrapper.
    """
    kits = 0
    for template in library.objects.values():
        if template.kind.lower() != "kit":
            continue
        match = KIT_SOURCE.search(template.source.lower())
        if match is None:
            continue
        nation = nation_label(match.group(1))
        kit_class = KIT_CLASS_LABELS.get(match.group(2), match.group(2).title())
        if nation is None:
            continue
        kits += 1
        for carried in _descend(library, template.name):
            if nation:
                roster._add(roster.factions, carried, nation)
            roster._add(roster.kit_classes, carried, kit_class)
    return kits


def add_levels(roster: Roster, level_paths: list[tuple[str, Path]]) -> int:
    """Vehicle factions, map presence and theatre, from every level archive."""
    read = 0
    for level_name, path in level_paths:
        if LEVEL_PATCH.search(path.stem):
            continue
        pool = ArchivePool()
        try:
            pool.add(path)
        except Exception:
            continue

        names = pool.names()
        init = next((n for n in names
                     if n.lower().endswith("/init.con") and "menu" not in n.lower()), None)
        spawns = next((n for n in names
                       if n.lower().endswith("conquest/objectspawntemplates.con")), None)
        if init is None:
            continue
        read += 1

        team_skins: dict[int, str] = {}
        for line in pool.read(init).decode("latin-1").splitlines():
            tokens = line.strip().split()
            if len(tokens) >= 3 and tokens[0].lower() == "game.setteamskin":
                try:
                    team_skins[int(tokens[1])] = tokens[2]
                except ValueError:
                    continue

        theatre = theatre_of(list(team_skins.values()))

        # The soldier a team wears is itself an extractable template.
        for team, skin in team_skins.items():
            match = SOLDIER_NATION.match(skin.lower())
            nation = nation_label(match.group(1)) if match else None
            if nation:
                roster._add(roster.factions, skin, nation)
            roster._add(roster.levels, skin, level_name)
            roster._add(roster.theatres, skin, theatre)

        if spawns is None:
            continue
        templates = level_mod.parse_spawn_templates(
            pool.read(spawns).decode("latin-1"))
        for spec in templates.values():
            for team, vehicle in spec.vehicles.items():
                skin = team_skins.get(team)
                match = SOLDIER_NATION.match(skin.lower()) if skin else None
                nation = nation_label(match.group(1)) if match else None
                if nation:
                    roster._add(roster.factions, vehicle, nation)
                roster._add(roster.levels, vehicle, level_name)
                roster._add(roster.theatres, vehicle, theatre)
    return read


def build(library: con_mod.ObjectLibrary,
          level_paths: list[tuple[str, Path]]) -> tuple[Roster, int, int]:
    roster = Roster()
    kits = add_kits(roster, library)
    levels = add_levels(roster, level_paths)
    return roster, kits, levels
