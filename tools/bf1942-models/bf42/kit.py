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
declared-but-dead, and the install is full of them. A level can also put a kit
on the ground: an `ObjectSpawner` whose `setObjectTemplate` names a Kit lays it
on a pad for anyone to take (Desert Combat's M82 and Stinger kits,
`level_pads`). Such a kit is live too, though no spawn-screen row hands it out.

See `features/bf1942-3d-models/kits.md` for the evidence behind each rule.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from . import con as con_mod
from . import level as level_mod
from . import roster as roster_mod

# `Objects/Items/<Nation>Kit[<Theatre>]/[<Unit>/]<Class>/Objects.con`.
#
# Three things the older `roster.KIT_SOURCE` could not see, all of them real
# content rather than edge cases: a theatre suffix (`GerKitdesert` is the Afrika
# Korps, the kits `GermanDesertSoldier` actually wears), an optional unit segment
# (FH/FHSW file `JapKit/SNLF/1SNLF_OfficerMp18/`), and `BaseKit`, which has no
# class segment at all and turns out to be dead everywhere it appears. The path
# only labels a kit; `collect` takes kits it does not match too.
KIT_SOURCE = re.compile(
    r"objects/items/(?P<nation>\w+?)kit(?P<theatre>desert|winter|summer)?/"
    r"(?:(?P<unit>\w+)/)?(?P<cls>\w+)/objects\.con$")

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
class RandomItem:
    """One `addTemplate` a kit rolls on every spawn: `setRandomGeometries N`.

    The engine never instantiates the bare name. `BundleTemplate::
    addBundleChilds` (lnxded `0x081a8300`) walks the kit's children in
    declaration order and, for each child whose count is at least 1, bumps
    one process-wide counter (`world::randomCounter`, `0x08720754`), wraps it
    to 1 once it passes N, and looks up `"%s%d"` of the name and the counter
    (`.rodata 0x086b16b5`). A variant the library lacks is logged
    (`addBundleChilds() template not found`) and the child is skipped. So FHSW's
    `RandomGBTankcommander` is never a weapon: the soldier holds
    `RandomGBTankcommander1..4`, a No2 three times out of four and a Sten the
    fourth. Ledger KIT-1..KIT-3.
    """
    template: str                       # as the kit's `addTemplate` spells it
    count: int                          # N
    variants: list[str | None] = field(default_factory=list)  # 1..N, None where undeclared

    def as_dict(self) -> dict:
        return {"template": self.template, "count": self.count,
                "variants": list(self.variants)}


def random_items(library: con_mod.ObjectLibrary,
                 kit: con_mod.ObjectTemplate) -> list[RandomItem]:
    """Every rolled child of `kit`, in the order the engine rolls them.

    Worn parts count as much as weapons: a helmet roll and a weapon roll bump
    the same counter, so the list is the kit's whole stride per spawn. Each
    variant is spelled as its own `create` line spells it, which is what every
    extracted file is named after.
    """
    rolled: list[RandomItem] = []
    for child in kit.children:
        count = child.random_geometries or 0
        if count < 1:
            continue
        variants = []
        for index in range(1, count + 1):
            template = library.object(f"{child.template}{index}")
            variants.append(template.name if template is not None else None)
        rolled.append(RandomItem(child.template, count, variants))
    return rolled


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
    # Every child the kit rolls per spawn, in roll order (`RandomItem`). A
    # carried item named here is a bundle, never a weapon: `variants_of`.
    random: list[RandomItem] = field(default_factory=list)
    # Filled by `sweep_levels`. `levels` holds every level the kit is in play
    # on, the ones whose pads place it (`pads`) included.
    levels: list[str] = field(default_factory=list)
    soldiers: list[str] = field(default_factory=list)
    slots: list[int] = field(default_factory=list)
    # The levels whose placed ObjectSpawners lay this kit on a pad, and every
    # soldier those levels field: the pickup has no team test (KITDROP rows,
    # `features/kit-drops`), so either side's man can end up holding it.
    pads: list[str] = field(default_factory=list)
    pickup_soldiers: list[str] = field(default_factory=list)

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

    def variants_of(self, item: str | None) -> list[str] | None:
        """The declared variants a rolled item can hand out, deduplicated in
        roll order, or None when `item` is not rolled."""
        if not item:
            return None
        for rolled in self.random:
            if rolled.template.lower() == item.lower():
                return list(dict.fromkeys(v for v in rolled.variants if v))
        return None


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


# `ObjectTemplate.overrideAirMovementInhibitations <bool>` inside a create block.
_AIR_MOVEMENT = re.compile(
    r"^\s*objecttemplate\.overrideairmovementinhibitations\s+(\S+)", re.IGNORECASE)
_CREATE = re.compile(r"^\s*objecttemplate\.create\s+\S+\s+(\S+)", re.IGNORECASE)


def overrides_air_movement(library: con_mod.ObjectLibrary,
                           kit: con_mod.ObjectTemplate, read) -> bool:
    """Whether the kit carries an `ActiveKitPart` that sets
    `overrideAirMovementInhibitations` -- EoD's and DC Final's `nochute`,
    FH's `Chutedisabler`, XPack2's rocket pack.

    The word writes `ActiveKitPartTemplate+0x188` (`setOverrideAirMovement
    Inhibitations` 0x08263c70, console word at 0x082fe723), and
    `BFSoldier::handlePlayerInput` reads it off every active kit part the
    soldier wears: any set byte skips the free-fall branch (0x08275e70 ..
    0x08275ea4), so the soldier never enters `Lb_ParachuteFall` and 9 never
    opens a chute (PARA-1, PARA-4). The library keeps no such field, so the
    part's own create block is read back: `read(path)` returns the bytes of
    the `.con` that declared it (the objects pool's `try_read`), or None.
    """
    for child in kit.children:
        part = library.object(child.template)
        if part is None or part.kind.lower() != "activekitpart":
            continue
        blob = read(part.source) if part.source else None
        if not blob:
            continue
        current = None
        text = con_mod.strip_comments(blob.decode("latin-1", "replace"))
        for line in text.splitlines():
            created = _CREATE.match(line)
            if created:
                current = created.group(1).lower()
                continue
            if current != part.name.lower():
                continue
            word = _AIR_MOVEMENT.match(line)
            if word:
                try:
                    if float(word.group(1)) != 0:
                        return True
                except ValueError:
                    continue
    return False


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

    A rolled child (`RandomItem`) is judged by its variants and comes back as
    the kit spells the bundle: which variant is in hand is decided per spawn,
    not here.
    """
    rolled = {item.template.lower(): item for item in random_items(library, kit)}
    for name in carried_templates(library, kit):
        item = rolled.get(name.lower())
        if item is not None:
            variant = next((library.object(v) for v in item.variants if v), None)
            if (variant is not None and variant.kind.lower() == HAND_FIRE_ARMS
                    and variant.item_index == PRIMARY_ITEM_INDEX):
                return item.template
            continue
        template = library.object(name)
        if template is None or template.kind.lower() != HAND_FIRE_ARMS:
            continue
        if template.item_index == PRIMARY_ITEM_INDEX:
            return template.name
    return None


def pose_candidates(kit: Kit, posable: dict[str, str]) -> list[str]:
    """The weapons to pose a kit's wearer holding, best first.

    The spawn weapon, then every other item the kit carries, in declaration
    order -- each only if `posable` has it. `posable` maps a lowercased weapon
    name to the spelling the pose files use (the animation state machine's).
    More than one, because a weapon the state machine names can still fail to
    pose: its clip may be missing from the archive.

    A rolled item stands for its variants, in roll order: the state machine
    names `Ub_StandAimRandomGBTankcommander1`, never the bundle.
    """
    candidates: list[str] = []
    for name in [kit.primary, *kit.carried]:
        for held in kit.variants_of(name) or [name]:
            spelled = posable.get(held.lower()) if held else None
            if spelled is not None and spelled not in candidates:
                candidates.append(spelled)
    return candidates


def pose_candidate_sets(kit: Kit, posable: dict[str, str]) -> list[tuple[str, ...]]:
    """`pose_candidates` once per weapon a spawn can put in hand.

    A kit whose spawn weapon is rolled is seen holding any of its variants, so
    each posable variant leads a set of its own, followed by the kit's other
    candidates as the fallback. Any other kit is the one set it always was.
    """
    ordered = pose_candidates(kit, posable)
    leads = [posable[v.lower()] for v in kit.variants_of(kit.primary) or []
             if v.lower() in posable]
    if not leads:
        return [tuple(ordered)] if ordered else []
    return [(lead, *[c for c in ordered if c not in leads]) for lead in dict.fromkeys(leads)]


def collect(library: con_mod.ObjectLibrary) -> dict[str, Kit]:
    """Every `Kit` template in the library, keyed lowercased.

    The engine finds a kit by name, wherever its `.con` sits, so the folder is
    only a label. Kits filed outside `Objects/Items/<Nation>Kit/...` -- bf1918's
    `Austrian_Kit_Early/`, FinnWars' `FinSummer_1941/`, bg42's `GerAir/`, and
    the ones a level declares in its own archive (FHSW's night and marker
    variants) -- are collected with no nation rather than dropped; a level
    binding one is the whole of what makes it live (`sweep_levels`). Vanilla,
    both XPacks and EoD file every kit by the convention, so their manifests do
    not move.
    """
    kits: dict[str, Kit] = {}
    for template in library.objects.values():
        if template.kind.lower() != "kit":
            continue
        nation_token, theatre, unit, class_token = classify(template.source)

        nation = roster_mod.nation_label(nation_token) if nation_token else None
        if nation is None and nation_token is None:
            # Filed outside the convention (a level's own archive: DC Final's
            # `DC_First_Light/objects/AntiAir2`), the kit's name is the only
            # label left, and mods prefix it the way they name the folder:
            # `US_AA2`, `Iraq_AA2`. A prefix the table does not know stays None.
            nation = roster_mod.nation_label(template.name.split("_", 1)[0])
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
            primary=primary_weapon(library, template),
            random=random_items(library, template))
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
    `beginrem .. endrem` blocks are skipped (the engine's parser does not
    execute them): `Liberation_of_Caen` sets team 2 twice, the five
    `Canadian_*` kits under `CanadianSoldier` live, then immediately the five
    `GB_*` kits under `BritishSoldier` inside a `beginrem` block. A MoonGamers
    round's recorded join database carries the `Canadian_*` kit objects, so
    the live server runs the Canadian binding and the block is a comment.
    """
    teams: dict[int, TeamLoadout] = {}
    in_block = False
    for raw in text.splitlines():
        line = raw.strip()
        low = line.lower()
        if in_block:
            if low.startswith("endrem"):
                in_block = False
            continue
        if low.startswith("beginrem"):
            in_block = True
            continue
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

    Reads a level through `roster.level_pool`, so a numbered patch archive's
    own `Init.con` overrides the base's the way the engine actually loads
    it — see that function for why (five vanilla Pacific maps rebind their
    US side to Marine kits this way). A level whose base archive will not
    open at all is skipped, the way `roster.add_levels` skips it. The file
    read is the level's root `Init.con`, the one the engine runs
    (`roster.level_init_con`), not the first file of that name in the
    archive: DC_Coastal_Hammer's `CustomObjects/INIT.con` binds no kits.
    """
    loadouts: dict[str, dict[int, TeamLoadout]] = {}
    for level_name, path in level_paths:
        pool = roster_mod.level_pool(path)
        if pool is None:
            continue
        init = roster_mod.level_init_con(pool.names())
        if init is None:
            continue
        loadouts[level_name] = parse_level_kits(pool.read(init).decode("latin-1"))
    return loadouts


def spell_soldiers(loadouts: dict[str, dict[int, "TeamLoadout"]],
                   library: con_mod.ObjectLibrary) -> None:
    """Respell every team's soldier as the library's template spells it (in
    place). A name the library lacks is kept as the level wrote it."""
    for teams in loadouts.values():
        for team in teams.values():
            template = library.object(team.soldier) if team.soldier else None
            if template is not None:
                team.soldier = template.name


def spawner_templates(files: level_mod.LevelFiles) -> dict[str, str]:
    """Every template a placed `ObjectSpawner` of the level names, in any
    gameplay layer it ships: lowercased name -> the spelling the spawner wrote.

    The layers are the ones a bake writes `objectSpawns` for
    (`extract_map.load_level`): the default mode, every other mode directory
    the archive holds (`find_gameplay_modes`), and a layer of its own for each
    game type whose `run` lines straddle two directories
    (`compose_game_type_layers`). The page builds its pads from the active
    layer's. A spawner template no `ObjectSpawns.con` places spawns nothing,
    so only placed ones count, and both sides' entries count: a pad filed
    under a control point hands out the holder's (`CPEnable`, SPAWN-2).

    A layer that will not parse is left out and the others still count:
    FHSW's `telemark-1943/ObjectiveMode/ObjectSpawns.con` carries ten
    `Object.absolutePosition` lines with no argument, which
    `parse_static_objects` raises on.
    """
    default = level_mod.find_gameplay_mode(files) or "Conquest"
    modes = level_mod.find_gameplay_modes(files)
    if default not in modes:
        modes.insert(0, default)
    layers: dict[str, level_mod.GameplayObjects] = {}
    for mode in modes:
        try:
            layers[mode] = level_mod.load_gameplay_objects(files, mode)
        except Exception:  # noqa: BLE001 - one malformed layer
            continue
    try:
        level_mod.compose_game_type_layers(files, level_mod.load_game_types(files), layers)
    except Exception:  # noqa: BLE001 - the directory layers still stand
        pass
    named: dict[str, str] = {}
    for layer in layers.values():
        for inst in layer.object_spawns:
            spec = layer.object_spawn_templates.get(inst.template.lower())
            if spec is None:
                continue
            for name in spec.vehicles.values():
                named.setdefault(name.lower(), name)
    return named


def level_pads(level_paths: list[tuple[str, Path]],
               chain: list[Path] | None = None) -> dict[str, dict[str, str]]:
    """Per level, what its placed ObjectSpawners name (`spawner_templates`).

    With `chain` (the mod's, nearest first) a level is read the way a bake
    reads it, through every copy of it down the chain (`find_level_archives`),
    so the names are the ones its `scene.json` pads carry. Without, through its
    own archive and numbered patches. Most of what comes back is vehicles;
    `bind_pads` keeps the kits. A level whose archives will not open is
    skipped, as `level_loadouts` skips it.
    """
    game_dir = chain[0].parent.parent if chain else None
    out: dict[str, dict[str, str]] = {}
    for level_name, path in level_paths:
        try:
            if chain:
                paths = level_mod.find_level_archives(
                    game_dir, chain[0].name, level_name, chain=chain)
            else:
                paths = [path, *reversed(roster_mod.level_patches(path))]
            if not paths:
                continue
            files = level_mod.load_level_files(paths, level_name)
        except Exception:
            continue
        out[level_name] = spawner_templates(files)
    return out


def bind_pads(kits: dict[str, Kit], loadouts: dict[str, dict[int, TeamLoadout]],
              pads: dict[str, dict[str, str]],
              levels: set[str] | None = None) -> int:
    """Bind the kits a level's pads place (`level_pads`) to it. Returns the
    number of (level, kit) pairs bound.

    A kit on a pad is in play on that level, so the level joins its `levels`
    and its `pads`. Whoever takes it holds its weapons in his own sleeves, and
    the pickup has no team test, so every soldier the level fields joins its
    `pickup_soldiers`. A kit no `game.setKit` slot hands out anywhere (Desert
    Combat 0.7's `US_Sniper_hvy` and `US_AA`) is drawn, in a browser, on the
    soldier the level dresses its own team in (`setKitTeam`), or on every
    soldier the level fields when the kit names no team. `levels`, when
    given, limits the binding to those level names.
    """
    bound = 0
    for level_name, named in sorted(pads.items()):
        if levels is not None and level_name not in levels:
            continue
        teams = loadouts.get(level_name, {})
        fielded = [team.soldier for _, team in sorted(teams.items()) if team.soldier]
        for key in sorted(named):
            kit = kits.get(key)
            if kit is None:
                continue
            bound += 1
            if level_name not in kit.levels:
                kit.levels.append(level_name)
            if level_name not in kit.pads:
                kit.pads.append(level_name)
            for soldier in fielded:
                if soldier not in kit.pickup_soldiers:
                    kit.pickup_soldiers.append(soldier)
            if kit.slots:
                continue
            own = teams.get(kit.team) if kit.team is not None else None
            for soldier in ([own.soldier] if own and own.soldier else fielded):
                if soldier not in kit.soldiers:
                    kit.soldiers.append(soldier)
    return bound


def sweep_levels(kits: dict[str, Kit], level_paths: list[tuple[str, Path]],
                 library: con_mod.ObjectLibrary | None = None,
                 pads: dict[str, dict[str, str]] | None = None) -> int:
    """Bind kits to the levels and soldiers that field them.

    This is also the liveness test. `game.setKit` is the only thing in the game
    that hands a kit to a spawning soldier, and the install is full of kits
    that nothing names: vanilla's five `BaseKit` entries, all five Canadian
    kits, XPack2's seven, 46 of EoD's. Filtering on it costs nothing — the
    sweep has to happen anyway for the map list. With `pads` (`level_pads`
    over the same levels), a kit a level's ObjectSpawners place is bound too
    (`bind_pads`), after every slot.

    With `library`, a soldier is recorded as his own `create` line spells him.
    The engine finds a template by name case-blind (`getTemplate`,
    `0x081d5f10`), so Counterattack-1950's `game.setTeamSkin 2 frenchsoldier`
    dresses `FrenchSoldier` -- but every file this pipeline writes is named
    after the `create` line, and a case-sensitive server 404s the other.
    """
    loadouts = level_loadouts(level_paths)
    if library is not None:
        spell_soldiers(loadouts, library)
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
    if pads:
        bind_pads(kits, loadouts, pads, {name for name, _path in level_paths})
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
