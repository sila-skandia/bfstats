"""What a soldier wears, and what he carries.

A `BFSoldier` template declares a body, a head and two hands. It has no helmet,
no hat, no pack, and no property that could swap one in — so every extracted
soldier in this pipeline has always come out bare-headed, correctly, because
that is the whole of what his template says.

The rest of him belongs to the kit. A `Kit` template `addTemplate`s two kinds of
thing: the weapons it carries, and `KitPart` templates that are its appearance.
A `KitPart` has exactly three properties and never a fourth --

    ObjectTemplate.create KitPart Medic_helm_us
    ObjectTemplate.geometry Medic_helm_us
    ObjectTemplate.setBoneName A
    ObjectTemplate.setCopyLinksCount 0

-- of which `setBoneName` is the entire channel. Across every mod in the install
it names one of three bones of `animations/UsSoldier.ske`: `A`, a child of
`Bip01 Head` so headgear rides the animated head; `backpack`; and `HipPack`.
Nothing else. That closed vocabulary is why this module is short.

Which kit a soldier wears is not in the object tree either. The level says it,
pairing `game.setTeamSkin <team> <soldier>` with `game.setKit <team> <slot>
<kit>`, so `sweep_levels` is also the liveness test: a kit no level names is
declared-but-dead, and the install is full of them.

See `features/bf1942-3d-models/kits.md` for the evidence behind each rule.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from . import con as con_mod
from . import roster as roster_mod
from .rfa import ArchivePool

# `Objects/Items/<Nation>Kit[<Theatre>]/[<Unit>/]<Class>/Objects.con`.
#
# Three things the older `roster.KIT_SOURCE` could not see, all of them real
# content rather than edge cases: a theatre suffix (`GerKitdesert` is the Afrika
# Korps, the kits `GermanDesertSoldier` actually wears), an optional unit segment
# (FH/FHSW file `JapKit/SNLF/1SNLF_OfficerMp18/`), and `BaseKit`, which has no
# class segment at all and turns out to be dead everywhere it appears.
KIT_SOURCE = re.compile(
    r"objects/items/(?P<nation>\w+?)kit(?P<theatre>desert|winter|summer)?/"
    r"(?:(?P<unit>\w+)/)?(?P<cls>\w+)/objects\.con$")
BASE_KIT_SOURCE = re.compile(r"objects/items/basekit/objects\.con$")

# What `setBoneName` means. The engine offers no others.
BONE_SLOTS = {"a": "head", "backpack": "back", "hippack": "hip"}

# `setType` is the engine's own role vocabulary and is stable across every mod
# in the install — mods with thousands of kits do not invent new ones. Prefer it
# over the folder name, which mods spell freely.
TYPE_LABELS = {
    "at": "Anti-tank",
    "antitank": "Anti-tank",
    "assault": "Assault",
    "engineer": "Engineer",
    "engineerlandmine": "Engineer",
    "medic": "Medic",
    "scout": "Scout",
    "rocketpack": "Rocket pack",
}

KIT_PART_KINDS = {"kitpart", "activekitpart"}
HAND_FIRE_ARMS = "handfirearms"

# `itemIndex` is the inventory slot a weapon occupies in the soldier's hands —
# the number key that selects it. Which slot is "the primary" is settled by a
# census of vanilla's 28 `HandFireArms`: 1 is the knife, 2 the pistol, 4 the
# grenade or explosive pack, 5 binoculars, mine or medpack, 6 the repair pack,
# 11 the detonator — and 3 is every rifle, SMG, LMG and launcher, exactly one
# per kit. It is also the slot the engine selects on spawn, which is why a
# soldier appears holding his Thompson and not his knife.
PRIMARY_ITEM_INDEX = 3

# EoD ships every kit twice: `VC_Scout` and `VC_Scout_CHUTE` differ by the base
# carrying a `nochute` flag its twin does not. Same weapons, same hat. 115 of the
# 116 pairs are identical in every other respect, so the twin is a duplicate for
# browsing purposes and folding it away takes EoD from 194 bound kits to 102.
CHUTE_SUFFIX = "_CHUTE"


@dataclass
class WornPart:
    """One `KitPart` — a mesh bolted to a bone of the wearer's skeleton."""
    template: str
    geometry: str | None
    bone: str
    slot: str                       # head | back | hip
    position: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)
    # `setRandomGeometries N` picks among `<name>1..<name>N` at spawn. We keep
    # every roll rather than silently showing slot 1, because in FH the count is
    # a probability weight over a smaller set of real meshes and in EoD the
    # rolls are visibly different hats.
    alternatives: list[str] = field(default_factory=list)
    # A part with no geometry of its own that delegates to a `SimpleObject`
    # child (FH's `German_Helmets3` -> `German_CapHolder`). Recorded so a report
    # can say "resolved through a holder" rather than "had no mesh".
    via_holder: bool = False


@dataclass
class Kit:
    template: str
    source: str
    nation: str | None
    kit_class: str
    theatre: str | None = None      # desert / winter / summer, from the folder
    unit: str | None = None         # FH/FHSW file kits under a unit segment
    team: int | None = None         # `setKitTeam`
    pickup: str | None = None       # the kit's own geometry: what it looks like on the ground
    worn: list[WornPart] = field(default_factory=list)
    carried: list[str] = field(default_factory=list)
    # The weapon in hand on spawn — `primary_weapon`. None for a kit that
    # carries nothing at `PRIMARY_ITEM_INDEX`, which vanilla never does.
    primary: str | None = None
    # Filled by `sweep_levels`.
    levels: list[str] = field(default_factory=list)
    soldiers: list[str] = field(default_factory=list)
    slots: list[int] = field(default_factory=list)

    @property
    def live(self) -> bool:
        """Whether any level binds this kit. Declared-but-unbound is common."""
        return bool(self.levels)

    @property
    def duplicate_of(self) -> str | None:
        """The base kit this is a parachute twin of, if it is one."""
        if self.template.endswith(CHUTE_SUFFIX):
            return self.template[: -len(CHUTE_SUFFIX)]
        return None

    def headgear(self) -> WornPart | None:
        return next((part for part in self.worn if part.slot == "head"), None)


# -- resolution ------------------------------------------------------------- #

def classify(source: str) -> tuple[str | None, str | None, str | None, str | None]:
    """(nation token, theatre, unit, class token) from a kit's declaring path."""
    match = KIT_SOURCE.search(source.lower())
    if match is None:
        return None, None, None, None
    return (match.group("nation"), match.group("theatre"),
            match.group("unit"), match.group("cls"))


def _resolve_alternatives(library: con_mod.ObjectLibrary,
                          child: con_mod.ChildRef) -> list[str]:
    """The templates an `addTemplate` can instantiate.

    `setRandomGeometries N` means "pick among `<name>1..<name>N`", and the bare
    name is deliberately absent from the library — EoD declares `VCHat1`,
    `VCHat2` and `VCHat3` and no `VCHat`. Miss this and every Viet Cong rifleman
    reports as bare-headed: it is the difference between 208 and 234 of EoD's
    240 kits resolving headgear.
    """
    if child.random_geometries and library.object(child.template) is None:
        rolled = [f"{child.template}{index}"
                  for index in range(1, child.random_geometries + 1)]
        present = [name for name in rolled if library.object(name) is not None]
        if present:
            return present
    return [child.template]


def _holder_geometry(library: con_mod.ObjectLibrary,
                     part: con_mod.ObjectTemplate) -> str | None:
    """A geometry-less KitPart's mesh, reached through its `SimpleObject` child.

    FH writes `ObjectTemplate.geometry` with no argument and hangs the real mesh
    off a `<Name>Holder` child at a small offset — that is how it mixes bare
    heads and soft caps into a helmet roll.
    """
    for child in part.children:
        holder = library.object(child.template)
        if holder is not None and holder.geometry:
            return holder.geometry
    return None


def kit_parts(library: con_mod.ObjectLibrary,
              kit: con_mod.ObjectTemplate) -> tuple[list[WornPart], list[str]]:
    """Split a kit's children into what it wears and what it carries."""
    worn: list[WornPart] = []
    carried: list[str] = []

    for child in kit.children:
        alternatives = _resolve_alternatives(library, child)
        first = library.object(alternatives[0])
        if first is None or first.kind.lower() not in KIT_PART_KINDS:
            # Weapons, ammo, and the behaviour-only flags (`nochute`) that are
            # KitParts without a bone. Both fall through to the carried list and
            # the bone check below filters the flags back out.
            carried.append(child.template)
            continue
        if not first.bone_name:
            continue
        slot = BONE_SLOTS.get(first.bone_name.lower())
        if slot is None:
            continue                        # GCMOD's one arm-bone oddity
        geometry = first.geometry
        via_holder = False
        if not geometry:
            geometry = _holder_geometry(library, first)
            via_holder = geometry is not None
        if not geometry:
            # Naming a bone is not the same as wearing something. EoD's
            # `nochute` and FH's `Chutedisabler` are ActiveKitParts that sit on
            # `backpack` and carry nothing but
            # `OverrideAirMovementInhibitations` — a parachute flag, not a pack.
            # Listing them as worn puts a permanent "not extracted" row on every
            # EoD kit for a thing that was never meant to be seen. A part with a
            # bone and no mesh, own or delegated, is behaviour.
            continue
        worn.append(WornPart(
            template=first.name, geometry=geometry, bone=first.bone_name,
            slot=slot, position=first.position, rotation=first.rotation,
            alternatives=[name for name in alternatives[1:]], via_holder=via_holder))

    return worn, carried


def carried_templates(library: con_mod.ObjectLibrary,
                      kit: con_mod.ObjectTemplate, depth: int = 4) -> list[str]:
    """Every template a kit reaches through `addTemplate`, declaration order.

    Depth-first, so a weapon a mod wraps in a bundle still comes out in the
    place the kit declared the wrapper. Bounded because a weapon's own tree
    (magazine, muzzle, projectile launcher) is not what a kit carries.
    """
    found: list[str] = []
    seen: set[str] = set()

    def walk(template: con_mod.ObjectTemplate, level: int) -> None:
        for child in template.children:
            key = child.template.lower()
            if key in seen:
                continue
            seen.add(key)
            found.append(child.template)
            resolved = library.object(child.template)
            if resolved is not None and level < depth:
                walk(resolved, level + 1)

    walk(kit, 0)
    return found


def primary_weapon(library: con_mod.ObjectLibrary,
                   kit: con_mod.ObjectTemplate) -> str | None:
    """The weapon a soldier spawns holding: the kit's `HandFireArms` at slot 3.

    Declaration order is the tie-break — `GerKit/Assault/Objects.con` says so
    itself, "The order is important, first the best weapons!" — so a mod that
    files two weapons at `PRIMARY_ITEM_INDEX` spawns with the first. The name
    comes back as the weapon's own `create` line spells it (`K98Sniper`,
    `Mp40`), not as the kit spells it (`k98Sniper`, `MP40`): the exported glb
    is named from the former, and a case-mismatched URL is a 404.
    """
    for name in carried_templates(library, kit):
        template = library.object(name)
        if template is None or template.kind.lower() != HAND_FIRE_ARMS:
            continue
        if template.item_index == PRIMARY_ITEM_INDEX:
            return template.name
    return None


def collect(library: con_mod.ObjectLibrary) -> dict[str, Kit]:
    """Every `Kit` template in the library, keyed lowercased."""
    kits: dict[str, Kit] = {}
    for template in library.objects.values():
        if template.kind.lower() != "kit":
            continue
        nation_token, theatre, unit, class_token = classify(template.source)
        if nation_token is None and not BASE_KIT_SOURCE.search(template.source.lower()):
            continue

        nation = roster_mod.nation_label(nation_token) if nation_token else None
        kit_class = (TYPE_LABELS.get((template.kit_type or "").lower())
                     or (roster_mod.KIT_CLASS_LABELS.get((class_token or "").lower())
                         if class_token else None)
                     or (class_token.title() if class_token else "Base"))

        worn, carried = kit_parts(library, template)
        kits[template.name.lower()] = Kit(
            template=template.name, source=template.source, nation=nation,
            kit_class=kit_class, theatre=theatre, unit=unit,
            team=template.kit_team, pickup=template.geometry,
            worn=worn, carried=carried,
            primary=primary_weapon(library, template))
    return kits


# -- levels ----------------------------------------------------------------- #

SET_KIT = re.compile(r"^\s*game\.setkit\s+(\d+)\s+(\d+)\s+(\S+)", re.IGNORECASE)
SET_TEAM_SKIN = re.compile(r"^\s*game\.setteamskin\s+(\d+)\s+(\S+)", re.IGNORECASE)


@dataclass
class TeamLoadout:
    """What a level's `Init.con` hands one team: its soldier, and a kit per slot.

    The slot number is the row of the spawn screen's kit column — the game's
    `Kit/SelectedKit` — so slot 2 is the third row whatever kit sits there.
    Kit names are kept as the level spells them; `extract_loadouts` resolves
    them against the library.
    """
    soldier: str | None = None
    slots: dict[int, str] = field(default_factory=dict)


def parse_level_kits(text: str) -> dict[int, TeamLoadout]:
    """`game.setTeamSkin` and `game.setKit` out of an `Init.con`, replayed.

    Last write wins, per team and per slot, because that is what the engine
    does: `Init.con` is executed top to bottom and a later
    `game.setKit 2 0 <x>` replaces slot 0 rather than adding to it.

    This is not pedantry. `Liberation_of_Caen` sets team 2 twice — the five
    `Canadian_*` kits under `CanadianSoldier`, then immediately the five `GB_*`
    kits under `BritishSoldier`. Counting mentions makes all five Canadian kits
    look live; replaying the file shows they are overwritten before the map
    ever loads, and Canada is a nation whose kits never spawn anywhere in
    vanilla. That is also why all five wear the same `Canadian_helmet` and why
    `CanadianKit/Medic/Objects.con` declares a `Medic_helm_brit` part it never
    uses: unfinished content.
    """
    teams: dict[int, TeamLoadout] = {}
    for line in text.splitlines():
        skin = SET_TEAM_SKIN.match(line)
        if skin:
            teams.setdefault(int(skin.group(1)), TeamLoadout()).soldier = skin.group(2)
            continue
        bound = SET_KIT.match(line)
        if bound:
            team = teams.setdefault(int(bound.group(1)), TeamLoadout())
            team.slots[int(bound.group(2))] = bound.group(3)
    return teams


def level_loadouts(level_paths: list[tuple[str, Path]]) -> dict[str, dict[int, TeamLoadout]]:
    """Per level, what each team is handed — every level archive with an `Init.con`.

    Patch layers (`Berlin_003.rfa`) and archives that will not open are
    skipped, the way `roster.add_levels` skips them.
    """
    loadouts: dict[str, dict[int, TeamLoadout]] = {}
    for level_name, path in level_paths:
        if roster_mod.LEVEL_PATCH.search(path.stem):
            continue
        pool = ArchivePool()
        try:
            pool.add(path)
        except Exception:
            continue
        init = next((name for name in pool.names()
                     if name.lower().endswith("/init.con")
                     and "menu" not in name.lower()), None)
        if init is None:
            continue
        loadouts[level_name] = parse_level_kits(pool.read(init).decode("latin-1"))
    return loadouts


def sweep_levels(kits: dict[str, Kit], level_paths: list[tuple[str, Path]]) -> int:
    """Bind kits to the levels and soldiers that field them.

    This is also the liveness test. `game.setKit` is the only thing in the game
    that says a kit is in play, and the install is full of kits that nothing
    names: vanilla's five `BaseKit` entries, all five Canadian kits, XPack2's
    seven, 46 of EoD's. Filtering on it costs nothing — the sweep has to happen
    anyway for the map list.
    """
    loadouts = level_loadouts(level_paths)
    for level_name, teams in loadouts.items():
        for team_id, team in teams.items():
            for slot, name in team.slots.items():
                kit = kits.get(name.lower())
                if kit is None:
                    continue
                if level_name not in kit.levels:
                    kit.levels.append(level_name)
                if slot not in kit.slots:
                    kit.slots.append(slot)
                if team.soldier and team.soldier not in kit.soldiers:
                    kit.soldiers.append(team.soldier)
    return len(loadouts)


def browsable(kits: dict[str, Kit]) -> list[Kit]:
    """Live kits, with EoD's parachute twins folded into their base kit.

    A twin whose base is missing or itself dead is kept — it is the only copy
    of that loadout, and dropping it would silently lose content.
    """
    keep: list[Kit] = []
    for kit in kits.values():
        if not kit.live:
            continue
        base = kit.duplicate_of
        if base is not None:
            twin = kits.get(base.lower())
            if twin is not None and twin.live:
                # Fold the twin's map list up rather than discarding it: a
                # parachute map fields the kit just as much as a ground one.
                for level in kit.levels:
                    if level not in twin.levels:
                        twin.levels.append(level)
                continue
        keep.append(kit)
    return sorted(keep, key=lambda k: (k.nation or "~", k.kit_class, k.template))
