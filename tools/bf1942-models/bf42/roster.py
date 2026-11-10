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
    # Road to Rome files Italy under `ItKit`, and its three cross-nation
    # engineers under `ItBritKit` / `ItGerKit` / `ItUSKit` — the theatre prefixed
    # onto the nation rather than suffixed. Secret Weapons names its two elite
    # formations instead of a country.
    "it": "Italian",
    "itbrit": "British",
    "itger": "German",
    "itus": "US",
    # A formation's kit folder and its soldier template disagree on the
    # spelling the same way `ger`/`german` do: `GerEliteKit` beside
    # `GermanEliteSoldier`, `CommandoKit` beside `BritishCommandoSoldier`.
    # Without both halves the soldier resolves to no nation at all.
    "commando": "British Commandos",
    "britishcommando": "British Commandos",
    "gerelite": "German Elite",
    "germanelite": "German Elite",
    "vietcong": "Viet Cong",
    # Eve of Destruction files its kits under short faction folders the WWII
    # spellings above do not cover — `VCKit`, `NVAKit`, `ARVNKit`. Without these
    # every Vietnam kit resolves to no nation at all, which reads in a UI as a
    # mod with no armies rather than as a gap in this table.
    "vc": "Viet Cong",
    "vcfemale": "Viet Cong",
    "civilvc": "Viet Cong",
    "nva": "NVA",
    "arvn": "ARVN",
    "sf": "Special Forces",
    "navyseals": "Navy SEALs",
    "pathetlaos": "Pathet Lao",
    "rambo": "Rambo",
    # Desert Combat: `IraqKit` / `Iraqkit` and `IraqSoldier`.
    "iraq": "Iraqi",
    "auss": "Australian",
    "australian": "Australian",
    "dutch": "Dutch",
    "fin": "Finnish",
    "finish": "Finnish",
    "finnish": "Finnish",
    "fre": "French",
    "french": "French",
    "hun": "Hungarian",
    "hungarian": "Hungarian",
    "ita": "Italian",
    "italian": "Italian",
    "italiandesert": "Italian",
    "pol": "Polish",
    "polish": "Polish",
    # BF1918 spells its armies two ways, as the WWII games do: a soldier
    # template's prefix (`KukSoldier`, `TurSoldier`, `EngSoldier`) and a kit
    # folder (`Austrian_Kit`, `Turkish_Kit`, `English_Kit`). Imperial Russia
    # is not the Soviet Union. WWI Japan (`JapanSoldier`, team 2) shares
    # WWII's label, which is why a side is read off the teams first
    # (`Roster.sides`), never off a label the level data contradicts.
    "anz": "ANZAC",
    "bel": "Belgian",
    "belgian": "Belgian",
    "bulgarian": "Bulgarian",
    "bulgaria": "Bulgarian",
    "eng": "British",
    "english": "British",
    "frz": "French",
    "japan": "Japanese",
    "kan": "Canadian",
    "kuk": "Austro-Hungarian",
    "austrian": "Austro-Hungarian",
    "romanian": "Romanian",
    "romania": "Romanian",
    "rus": "Russian",
    "senegal": "Senegalese",
    "serb": "Serbian",
    "serbia": "Serbian",
    "tur": "Ottoman",
    "turkish": "Ottoman",
    "usa": "US",
}

# `side_of` reads every label absent from this set as Allied, so a label that
# names an Axis formation without naming its country has to be listed in its own
# right: Secret Weapons' `GerEliteKit` resolves to "German Elite", which shares
# no string with "German" and so put the whole elite-soldier kit line — its
# rifles, its knife, the soldier himself — on the Allied side.
#
# This is the fallback only. The engine has no sides, only teams (SIDE-1): a
# level dresses team 1 and team 2 (`game.setTeamSkin`), spawns vehicles per
# team (`setObjectTemplate <team>`), and a kit names its team (`setKitTeam`).
# `Roster.sides` reads that number first (`TEAM_SIDES`). Italy and Japan are
# team 1 in WWII and team 2 in BF1918, so no table of nations answers both.
# The Central Powers are listed for a template that only a kit with no
# `setKitTeam` reaches.
AXIS_NATIONS = {"German", "German Elite", "Japanese", "Italian", "Hungarian",
                "Finnish", "Austro-Hungarian", "Ottoman", "Bulgarian"}

# What the viewer calls each team. Team 1 is "Axis" and team 2 "Allied"
# everywhere downstream (`dogfight-arena.js` `teamOf`, `proving-ground.js`,
# `tank-arena.js`), whatever the mod's war: in BF1918 "Axis" is the Central
# Powers and "Allied" the Entente.
TEAM_SIDES = {1: "Axis", 2: "Allied"}

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


def level_pool(path: Path) -> ArchivePool | None:
    """A level's base archive, overlaid by its own numbered patches.

    Refractor overlays a level with `<Stem>_NNN.rfa` siblings in the same
    directory — `Wake_003.rfa` over `Wake.rfa`, mixed case and all (vanilla
    ships `Berlin.rfa`, `Berlin_000.rfa` *and* `berlin_003.rfa` side by
    side). `discover_levels` already strips these siblings from the level
    list because they are not levels of their own; this is the other half.
    Reading a level's `Init.con` (or any other level `.con`) has to see the
    patch's copy when one exists, because that is the file the game loads.
    Five vanilla `_003` layers rewrite the Pacific maps' US side to
    `USMarineSoldier` and `USMarine_*` kits — the base `USSoldier`/`US_*`
    lines are dead the moment the patch archive exists, yet were the only
    ones this pipeline used to read.

    The suffix is matched the same permissive way `discover_levels` and
    `level.find_level_archives` already do — any run of digits after the
    last underscore, not just three — because real installs are not
    consistent: WarFront patches every level with a four-digit `_0351`
    build stamp, and XPack1's `Salerno` carries both `_001` and `_003`.

    `ArchivePool.add` is first-registered-wins, so the layers are added in
    `level_patches` order and the base last — base entries only fill in what
    no patch overrides, the same overlay order the engine itself applies. A
    patch that will not open is skipped and the remaining layers still apply;
    the level itself is skipped (`None`) only if the base archive won't open
    either, matching every other level reader in this pipeline.
    """
    pool = ArchivePool()
    for patch_path in level_patches(path):
        try:
            pool.add(patch_path)
        except Exception:
            continue
    try:
        pool.add(path)
    except Exception:
        return None
    return pool


def level_patches(path: Path) -> list[Path]:
    """A level's numbered patch archives, highest-numbered first.

    The order a first-registered-wins pool wants them in, ahead of the base
    archive `path` itself (see `level_pool`).
    """
    stem_lower = path.stem.lower()
    patches: list[tuple[int, str, Path]] = []
    for sibling in path.parent.iterdir():
        if sibling == path or not sibling.is_file() or sibling.suffix.lower() != ".rfa":
            continue
        base, sep, suffix = sibling.stem.rpartition("_")
        if not sep or not suffix.isdigit() or base.lower() != stem_lower:
            continue
        patches.append((int(suffix), sibling.name.lower(), sibling))
    patches.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [patch_path for _, _, patch_path in patches]


def level_init_con(names: list[str]) -> str | None:
    """The `Init.con` the engine runs for a level: the one at its root.

    `Game::load` (lnxded 0x0805b785..0x0805b940) appends `Init.con` to the
    level's own directory, `bf1942/levels/<Level>/`, checks the file exists
    ("Level init.con file not found") and runs it. Nothing else of that name
    is run unless that file `run`s it. Level archives ship others: every
    `Menu/Init.con`, DC_Coastal_Hammer's `CustomObjects/INIT.con` and five
    FHSW levels' `Objects/INIT.con`, which sit ahead of the root one in the
    archive index and so were what "the first `*/init.con`" used to pick.
    Every other level in the install ships exactly one root `Init.con`.
    """
    for name in names:
        parts = name.replace("\\", "/").split("/")
        if (len(parts) >= 3 and parts[-1].lower() == "init.con"
                and parts[-3].lower() == "levels"):
            return name
    return None


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
    # The teams that field a template: the one a kit names with `setKitTeam`
    # (for the kit and everything it carries), the team a level dresses in a
    # soldier, and the team a level spawns a template for.
    teams: dict[str, set[int]] = field(default_factory=dict)
    # The same, level by level: template -> level -> teams. A side is per
    # level (SIDE-1): BF1918 spawns the A7V for team 1 on Hindenburg Line and
    # for both teams on Carriere, so only a level says who drives it there.
    level_teams: dict[str, dict[str, set[int]]] = field(default_factory=dict)

    def _add(self, table: dict, template: str, value) -> None:
        table.setdefault(template.lower(), set()).add(value)

    def _add_level_team(self, template: str, level: str, team: int) -> None:
        self._add(self.teams, template, team)
        self.level_teams.setdefault(template.lower(), {}).setdefault(level, set()).add(team)

    def level_sides(self, template: str) -> dict[str, list[str]]:
        """The sides that field `template` on each level that spawns or
        dresses it, by level name."""
        out = {}
        for level, teams in sorted(self.level_teams.get(template.lower(), {}).items()):
            sides = sorted({TEAM_SIDES[t] for t in teams if t in TEAM_SIDES})
            if sides:
                out[level] = sides
        return out

    def sides(self, template: str) -> list[str]:
        """The sides that field `template`: every team the data puts it on
        (a kit laid on the other team's pad is both teams'), else, for a
        template no team names, its nations' (`side_of`)."""
        key = template.lower()
        sides = {TEAM_SIDES[t] for t in self.teams.get(key, set()) if t in TEAM_SIDES}
        if sides:
            return sorted(sides)
        return sorted({side_of(nation) for nation in self.factions.get(key, set())})

    def entry(self, template: str) -> dict[str, list[str]]:
        key = template.lower()
        factions = sorted(self.factions.get(key, set()))
        return {
            "factions": factions,
            "sides": self.sides(template),
            "kitClasses": sorted(self.kit_classes.get(key, set())),
            "levels": sorted(self.levels.get(key, set())),
            "theatres": sorted(self.theatres.get(key, set())),
            "levelSides": self.level_sides(template),
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
        team = template.kit_team
        for carried in _descend(library, template.name):
            if nation:
                roster._add(roster.factions, carried, nation)
            roster._add(roster.kit_classes, carried, kit_class)
            if team in TEAM_SIDES:
                roster._add(roster.teams, carried, team)
    return kits


def add_levels(roster: Roster, level_paths: list[tuple[str, Path]]) -> int:
    """Vehicle factions, map presence and theatre, from every level archive.

    Reads a level through `level_pool`, so a numbered patch's rebind of
    `game.setTeamSkin` (the five vanilla Pacific maps) is what gets
    credited, not the dead base binding underneath it.
    """
    read = 0
    for level_name, path in level_paths:
        pool = level_pool(path)
        if pool is None:
            continue

        names = pool.names()
        init = level_init_con(names)
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
            roster._add_level_team(skin, level_name, team)
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
                roster._add_level_team(vehicle, level_name, team)
                roster._add(roster.levels, vehicle, level_name)
                roster._add(roster.theatres, vehicle, theatre)
    return read


def build(library: con_mod.ObjectLibrary,
          level_paths: list[tuple[str, Path]]) -> tuple[Roster, int, int]:
    roster = Roster()
    kits = add_kits(roster, library)
    levels = add_levels(roster, level_paths)
    return roster, kits, levels
