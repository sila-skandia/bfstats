#!/usr/bin/env python3
"""Extract per-map battle intel from Battlefield 1942 level archives.

Every level .rfa carries the config the engine itself reads at load time, in plain
text once the LZO segments are unpacked. That config knows a great deal the stats
site does not:

    Init.con                          which armies fight, their kits, the assault team
    Init/Terrain.con                  world size, which turns positions into map coords
    GameTypes/Conquest.con            starting tickets and the per-minute bleed
    Conquest/ControlPoints.con        every flag, by name and world position
    Conquest/ControlPointTemplates.con  who starts holding each flag
    Conquest/ObjectSpawnTemplates.con   what each spawner yields per team
    Conquest/ObjectSpawns.con         how many of those spawners the level places

This script turns that into one JSON dossier per map, addressed exactly the way
map images already are (mod folder + level folder), so the API can resolve a live
server's (gameId, mapName) onto it with the manifest search path it already walks.

Standard library plus the system liblzo2 only, same as the image extractor.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))

try:
    from extract_map_images import RfaArchive, find_level_archives, mod_search_path
except ImportError:  # pragma: no cover - developer environment guard
    sys.exit(
        "Could not import the RFA reader. This script reuses the one from the\n"
        "bf1942-map-images skill at ~/.claude/skills/bf1942-map-images/scripts/."
    )

DEFAULT_GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "tournament-images/dossiers"


# --------------------------------------------------------------------------- #
# .con parsing
# --------------------------------------------------------------------------- #

def strip_comments(text: str) -> str:
    """Drop `rem` comment lines. The engine treats `rem` as a statement, not a prefix."""
    return "\n".join(
        line for line in text.splitlines()
        if not line.lstrip().lower().startswith("rem")
    )


def con_values(text: str, command: str, arity: int) -> list[tuple[str, ...]]:
    """Every invocation of a `.con` command, as a tuple of its arguments.

    Commands are case insensitive and whitespace separated:

        Game.setNumberOfTickets 2 100   ->  ("2", "100")
    """
    pattern = re.compile(
        r"^\s*" + re.escape(command) + r"\s+" + r"\s+".join([r"(\S+)"] * arity),
        re.IGNORECASE | re.MULTILINE,
    )
    return [m if isinstance(m, tuple) else (m,) for m in pattern.findall(text)]


def con_first(text: str, command: str) -> str | None:
    found = con_values(text, command, 1)
    return found[0][0] if found else None


# --------------------------------------------------------------------------- #
# Domain vocabulary
# --------------------------------------------------------------------------- #

# game.setTeamSkin names the soldier model, which is the only place a stock level
# states its nationality. Mods invent their own, so this is a longest-prefix match
# against known stems rather than an exhaustive table.
NATION_STEMS: list[tuple[str, str]] = [
    ("germandesert", "ger"),
    ("german", "ger"),
    ("usmarine", "us"),
    ("usparatrooper", "us"),
    ("us", "us"),
    ("american", "us"),
    ("british", "brit"),
    ("uk", "brit"),
    ("japanese", "jp"),
    ("jap", "jp"),
    ("russian", "rus"),
    ("soviet", "rus"),
    ("canadian", "can"),
    ("italian", "ita"),
    ("french", "fra"),
    ("polish", "pol"),
    ("finnish", "fin"),
    ("chinese", "chi"),
]

NATION_LABELS = {
    "ger": "Germany",
    "us": "United States",
    "brit": "Great Britain",
    "jp": "Japan",
    "rus": "Soviet Union",
    "can": "Canada",
    "ita": "Italy",
    "fra": "France",
    "pol": "Poland",
    "fin": "Finland",
    "chi": "China",
}

# The base game has five kit roles and mods do not. FHSW alone declares 571 distinct
# kits — Australian close-quarters Owen gunners, tank commanders, flamethrowers — so
# flattening a mod's kit onto the stock five throws away most of what it says. The kit
# template is kept whole; a role is derived only as a fallback for art, since the stock
# five are the only ones the base game draws icons for.
KIT_ROLE_WORDS = {
    "scout": "scout", "sniper": "scout", "recon": "scout", "chopperpilot": "scout",
    "assault": "assault", "smg": "assault", "rifleman": "assault", "trooper": "assault",
    "specops": "assault", "grunt": "assault", "infantry": "assault",
    "at": "at", "antitank": "at", "tankhunter": "at",
    "panzerschreck": "at", "bazooka": "at", "grenadelauncher": "at",
    "medic": "medic",
    "engineer": "engineer", "pioneer": "engineer", "sapper": "engineer",
}

# Theatre suffixes a level appends to an otherwise ordinary kit name.
KIT_THEATRES = {"desert", "snow", "winter", "pacific", "para", "paratrooper"}

# Split camel case and letter/digit runs alike: "Support2" -> "support 2",
# "AssaultArisaka38" -> "assault arisaka 38".
_CAMEL_SPLIT = re.compile(
    r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])"
)

# Words that read wrong title-cased.
KIT_ACRONYMS = {"at", "mp", "mg", "smg", "lmg", "bar", "ppsh", "rd"}

# Template names the engine resolves to art under a different stem. Everything else
# matches by normalising both sides (lowercase, punctuation removed).
ICON_ALIASES = {
    "kubelwagen": "kubel",
    "stuka": "ju87",
    "sub7c": "subviic",
    "stationary_mg42": "mg42",
    "stationary_browning": "browning",
    "aa_allies": "allies86",
    "flak_38": "flak38",
    "blackmedal": "blkmedal",
    "type38": "type38",
    "elco80": "elco",
    "elco80raft": "elcoraft",
    # Variants the game gives no separate icon: fall back to the base machine.
    "aichival-t": "aichival",
    "sbd-t": "sbd",
    "fletcher2": "fletcher",
    "hatsuzuki2": "hatsuzuki",
    "hiryu": "shokaku",
    "hornet": "enterprise",
    # Emplacements & Stationary
    "stationary_dshk": "dshk",
    "tripod_dshk": "tripoddshk",
    "tripod_browning": "tripodbrowning",
    "boforsa": "bofors",
    "boforsb": "bofors",
    "boforsc": "bofors",
    "boforsd": "bofors",
    "boforse": "bofors",
    # EoD vehicles
    "zil131open": "zil",
    "eod_zil131covered": "zilcovered",
    "eod_zil131radio": "zilradio",
    "gaz69c": "gaz69closed",
    "loach_minigun": "loach",
    "race_wheelbarrow": "wheelbarrow",
    "monster_willy": "willy",
    "cammo_raft": "cammoraft",
    "t34-85": "t34",
    "uss_kittyhawk": "kittyhawk",
    "mi4t_spwn": "mi4t",
    "eod_huey_slick_spwn": "hueyslick",
    "eod_huey_dustoff_spwn": "hueydustoff",
    "eod_t63apc_spwnx": "t63apc",
}

# Spawner entries that are scenery or scripting, not materiel.
NON_VEHICLE_TEMPLATES = {"paratrooperspawnobject", "none", ""}

# Template names the game never spells out for the player. Anything absent falls back
# to a prettified template name, which is already readable for most of the roster
# (sherman, tiger, corsair) and for every mod this table knows nothing about.
VEHICLE_LABELS = {
    "aaallies": "M45 Quadmount",
    "aabase": "AA Emplacement",
    "aichival": "Aichi D3A Val",
    "aichivalt": "Aichi D3A Val (Torpedo)",
    "b17": "B-17 Flying Fortress",
    "bf109": "Messerschmitt Bf 109",
    "bf110": "Messerschmitt Bf 110",
    "blackmedal": "Black Medal",
    "chiha": "Type 97 Chi-Ha",
    "corsair": "F4U Corsair",
    "daihatsu": "Daihatsu Landing Craft",
    "defgun": "Coastal Defence Gun",
    "elco80": "Elco 80 PT Boat",
    "flak38": "Flak 38",
    "gato": "USS Gato",
    "hanomag": "Sd.Kfz. 251 Hanomag",
    "hatsuzuki": "Hatsuzuki Destroyer",
    "hatsuzuki2": "Hatsuzuki Destroyer",
    "hoha": "Type 1 Ho-Ha",
    "fletcher": "Fletcher Destroyer",
    "fletcher2": "Fletcher Destroyer",
    "ilyushin": "Ilyushin Il-2",
    "ju87": "Junkers Ju 87 Stuka",
    "kettenkrad": "Kettenkrad",
    "kubelwagen": "Kubelwagen",
    "lcvp": "LCVP Higgins Boat",
    "lynx": "Sd.Kfz. 222 Lynx",
    "m10": "M10 Wolverine",
    "m3a1": "M3A1 Half-track",
    "mustang": "P-51 Mustang",
    "panzeriv": "Panzer IV",
    "priest": "M7 Priest",
    "princeow": "HMS Prince of Wales",
    "sbd": "SBD Dauntless",
    "sbdt": "SBD Dauntless (Torpedo)",
    "sexton": "Sexton",
    "sherman": "M4 Sherman",
    "shokaku": "Shokaku Carrier",
    "spitfire": "Supermarine Spitfire",
    "stationarybrowning": "Browning M2",
    "stationarymg42": "MG42",
    "stuka": "Junkers Ju 87 Stuka",
    "sub7c": "U-boat Type VIIC",
    "t34": "T-34",
    "t3485": "T-34/85",
    "tiger": "Tiger I",
    "type38": "Type 38 Landing Craft",
    "wespe": "Wespe",
    "willy": "Willys Jeep",
    "yak9": "Yakovlev Yak-9",
    "yamato": "Yamato Battleship",
    "zero": "Mitsubishi A6M Zero",
    "enterprise": "USS Enterprise",
    "katyusha": "Katyusha",
    # EoD vehicles
    "t54": "T-54 Tank",
    "t62": "T-62 Tank",
    "btr60": "BTR-60 APC",
    "type63": "Type 63 Light Tank",
    "gaz69": "GAZ-69 Truck",
    "gaz69closed": "GAZ-69 (Canvas)",
    "zil": "ZIL-131 Transport",
    "zilcovered": "ZIL-131 (Covered)",
    "zilradio": "ZIL-131 (Radio)",
    "eodzpu2": "ZPU-2 Anti-Air",
    "vcmortar": "Type 53 Mortar",
    "usmortar": "M29 Mortar",
    "dshk": "DShK 12.7mm MG",
    "m46": "M-46 130mm Field Gun",
    "patton": "M48 Patton",
    "m113": "M113 APC",
    "m113acav": "M113 ACAV",
    "m132": "M132 Zippo",
    "m163": "M163 VADS",
    "m35open": "M35 2.5t Truck",
    "eodcobra": "AH-1G Cobra",
    "eodhuey": "UH-1 Huey",
    "hueyslick": "UH-1D Huey Slick",
    "hueydustoff": "UH-1 Dustoff Medevac",
    "eodloachsoar": "OH-6A Cayuse",
    "eodm2a1": "M2A1 105mm Howitzer",
    "eodquad50": "M45 Quadmount (.50 cal)",
    "bofors": "Bofors 40mm AA",
}


def vehicle_label(template: str) -> str:
    known = VEHICLE_LABELS.get(normalise_template(template))
    if known:
        return known
    cleaned = re.sub(r"^stationary[_\s-]*", "", template, flags=re.IGNORECASE)
    cleaned = re.sub(r"[_]+", " ", cleaned).strip()
    return cleaned.title() if cleaned.islower() else cleaned


def normalise_template(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def nation_of_skin(skin: str) -> str | None:
    lowered = skin.lower()
    for stem, code in NATION_STEMS:
        if lowered.startswith(stem):
            return code
    return None


def nation_of_kits(kits: list[str]) -> str | None:
    """Fallback when setTeamSkin is absent: the kit templates carry the nation too."""
    for kit in kits:
        head = kit.split("_", 1)[0]
        code = nation_of_skin(head)
        if code:
            return code
    return None


def kit_words(template: str) -> list[str]:
    """`1Auss_CloseQuartersOwenSmoke` -> ["close", "quarters", "owen", "smoke"].

    Kit templates lead with a faction prefix and then run the kit name together in
    camel case, so both have to come apart before anything can be read out of them.
    """
    parts = template.split("_")
    # Drop the faction prefix when there is something left to name the kit with.
    if len(parts) > 1:
        parts = parts[1:]
    words: list[str] = []
    for part in parts:
        words += [w.lower() for w in _CAMEL_SPLIT.split(part) if w]
    return words


def kit_label(template: str) -> str:
    words = [w for w in kit_words(template) if w not in KIT_THEATRES]
    if not words:
        words = kit_words(template) or [template.lower()]
    return " ".join(w.upper() if w in KIT_ACRONYMS else w.title() for w in words)


def kit_role(template: str) -> str | None:
    """Best-effort stock role, used only to pick fallback art."""
    for word in kit_words(template):
        role = KIT_ROLE_WORDS.get(word)
        if role:
            return role
    return None


def skin_label(skin: str | None) -> str | None:
    """`IraqSoldier` -> `Iraq`, for mod factions no nation table will ever cover.

    Better a mod's own word for its side than a bare "Team 1".
    """
    if not skin:
        return None
    trimmed = re.sub(r"soldier$", "", skin, flags=re.IGNORECASE).strip("_ -")
    return trimmed or skin


def display_name(level_folder: str) -> str:
    return re.sub(r"[_]+", " ", level_folder).strip().title()


# Flag names are level-editor object identifiers, so words run together with no
# separator ("southopenbase"). Greedy longest-match against the vocabulary the level
# designers actually used splits them back apart.
CP_VOCABULARY = [
    "controlpoint", "spawnpoint",
    "airfield", "village", "factory", "harbour", "harbor", "bunker", "bridge", "island",
    "station", "outpost", "chateau", "church", "castle", "barracks", "carrier", "allies",
    "allied", "beach", "north", "south", "river", "field", "point", "depot", "tower",
    "trench", "valley", "center", "centre", "convoy", "middle", "east", "west", "axis",
    "base", "camp", "town", "city", "hill", "port", "dock", "farm", "road", "fort",
    "wall", "open", "left", "right", "side", "main", "sand", "upper", "lower",
    "top", "mid", "big",
]

# Editor bookkeeping that adds nothing once the flag is drawn on a map.
CP_WORD_FIXUPS = {
    "allies": "allied",
    "cpoint": "",
    "cp": "",
    "spawnpoint": "",
    "controlpoint": "",
}


def _segment(token: str) -> list[str]:
    words: list[str] = []
    rest = token
    while rest:
        for candidate in CP_VOCABULARY:
            if rest.startswith(candidate) and len(rest) > len(candidate):
                words.append(candidate)
                rest = rest[len(candidate):]
                break
            if rest == candidate:
                words.append(candidate)
                rest = ""
                break
        else:
            # Nothing in the vocabulary matches, so the remainder is a proper noun
            # (a place name) and belongs in the label untouched.
            words.append(rest)
            rest = ""
    return words


def control_point_label(raw: str) -> str:
    """`ALLIES_north_village` -> `North Village`, `southopenbase` -> `South Open Base`.

    A separated side prefix is dropped because the team field already carries
    ownership, but a glued one ("alliesbase") is part of the name.
    """
    full = re.sub(r"[_\s-]+", " ", raw).strip().lower()
    stripped = re.sub(r"^(allies|axis|us|ger|jap|rus|brit)[_\s-]+", "", raw, flags=re.IGNORECASE)
    stripped = re.sub(r"[_\s-]+", " ", stripped).strip().lower()
    # Dropping the prefix off "US_base" would leave every side's spawn called "Base",
    # so only drop it when what remains still names somewhere.
    cleaned = stripped if len(stripped.split()) > 1 else full

    words: list[str] = []
    for token in cleaned.split():
        if token.isdigit():
            words.append(token)
            continue
        for word in _segment(token):
            word = CP_WORD_FIXUPS.get(word, word)
            if word:
                words.append(word)

    label = " ".join(words).strip()
    return label.title() if label else display_name(raw)


# --------------------------------------------------------------------------- #
# Level reading
# --------------------------------------------------------------------------- #

class LevelFiles:
    """The `.con` files of one level, merged across its base and patch archives."""

    def __init__(self) -> None:
        self._files: dict[str, str] = {}

    def add(self, archive: RfaArchive, entry_name: str) -> None:
        # `bf1942/levels/Wake/Conquest/ControlPoints.con` -> `conquest/controlpoints.con`
        parts = entry_name.lower().split("/")
        idx = parts.index("levels")
        key = "/".join(parts[idx + 2:])
        try:
            # A later (patch) archive legitimately replaces an earlier file.
            self._files[key] = strip_comments(archive.read(entry_name).decode("latin-1"))
        except Exception:
            pass

    def underlay(self, parent: "LevelFiles") -> None:
        """Take a parent mod's files for anything this level does not ship itself.

        A mod that reuses a base-game map usually overrides only the content it
        changes — Desert Combat's Gazala redefines the vehicles and kits but ships no
        ControlPoints.con or Terrain.con, because the engine falls through to the base
        game's for those. Without the same fall-through, such a map reports no flags
        and no world size.
        """
        for key, value in parent._files.items():
            self._files.setdefault(key, value)

    def get(self, *candidates: str) -> str:
        """First candidate that exists, so callers can express a preference order."""
        for candidate in candidates:
            text = self._files.get(candidate.lower())
            if text:
                return text
        return ""

    def __bool__(self) -> bool:
        return bool(self._files)


def read_levels(mod_dir: Path) -> dict[str, LevelFiles]:
    levels: dict[str, LevelFiles] = {}
    for archive_path in find_level_archives(mod_dir):
        try:
            archive = RfaArchive(archive_path)
        except Exception as exc:
            print(f"  [skip] {archive_path.name}: {exc}", file=sys.stderr)
            continue
        with archive:
            for entry_name in archive.entries:
                if not entry_name.lower().endswith(".con"):
                    continue
                parts = entry_name.lower().split("/")
                if "levels" not in parts:
                    continue
                idx = parts.index("levels")
                if idx + 2 >= len(parts):
                    continue
                levels.setdefault(parts[idx + 1], LevelFiles()).add(archive, entry_name)
    return levels


def find_archives_dir(mod_dir: Path) -> Path | None:
    if not mod_dir.is_dir():
        return None
    for child in mod_dir.iterdir():
        if child.is_dir() and child.name.lower() == "archives":
            return child
    return None


ROLE_MAP = {
    "at": "at",
    "assault": "assault",
    "engineer": "engineer",
    "engineerlandmine": "engineer",
    "medic": "medic",
    "scout": "scout",
    "rocketpack": "assault",
}


def kit_types_for_mod(mod_dir: Path) -> dict[str, str]:
    """Kit template -> stock role, extracted from ObjectTemplate.setType in Objects archive."""
    types: dict[str, str] = {}
    archives_dir = find_archives_dir(mod_dir)
    if not archives_dir:
        return types
    for archive_path in sorted(p for p in archives_dir.iterdir() if p.suffix.lower() == ".rfa"):
        if not archive_path.name.lower().startswith("objects"):
            continue
        try:
            archive = RfaArchive(archive_path)
        except Exception:
            continue
        with archive:
            for entry_name in archive.entries:
                if "kit" in entry_name.lower() and entry_name.lower().endswith(".con"):
                    try:
                        text = archive.read(entry_name).decode("latin-1")
                    except Exception:
                        continue
                    cur = None
                    for line in text.splitlines():
                        m = re.match(r"^\s*ObjectTemplate\.create\s+Kit\s+(\S+)", line, re.IGNORECASE)
                        if m:
                            cur = m.group(1)
                            continue
                        if not cur:
                            continue
                        m2 = re.match(r"^\s*ObjectTemplate\.setType\s+(\S+)", line, re.IGNORECASE)
                        if m2:
                            raw_type = m2.group(1).lower()
                            role = ROLE_MAP.get(raw_type)
                            if role:
                                types[normalise_template(cur)] = role
    return types


def vehicle_categories(mod_dir: Path) -> dict[str, str]:
    """Template name -> what kind of thing it is, read from the Objects archive layout.

    `Objects/Vehicles/Sea/Yamato/Objects.con` is the engine's own classification, which
    beats guessing from the name. The same tree separates emplacements from hand weapons
    and from the scenery and scripting objects that spawners also place — a level's
    spawner list is full of things like `killercage` and `activegatehouse` that are not
    materiel and have no business in an arsenal.
    """
    categories: dict[str, str] = {}
    archives_dir = find_archives_dir(mod_dir)
    if not archives_dir:
        return categories
    for archive_path in sorted(p for p in archives_dir.iterdir() if p.suffix.lower() == ".rfa"):
        if not archive_path.name.lower().startswith("objects"):
            continue
        try:
            archive = RfaArchive(archive_path)
        except Exception:
            continue
        with archive:
            for entry_name in archive.entries:
                parts = entry_name.lower().split("/")
                if len(parts) < 4:
                    continue
                group, name = parts[1], parts[3]
                if group == "vehicles" and parts[2] in ("land", "air", "sea"):
                    categories.setdefault(normalise_template(name), parts[2])
                elif group == "stationary_weapons":
                    categories.setdefault(normalise_template(parts[2]), "emplacement")
                elif group == "handweapons":
                    categories.setdefault(normalise_template(parts[2]), "handweapon")
    return categories


def lookup_category(categories: dict[str, str], normalised: str) -> str:
    if normalised in categories:
        return categories[normalised]
    for suffix in ("spwn", "spwnx", "bot", "spawn"):
        if normalised.endswith(suffix):
            stem = normalised[:-len(suffix)]
            if stem in categories:
                return categories[stem]
    for prefix in ("stationary", "eod", "tripod"):
        if normalised.startswith(prefix):
            stem = normalised[len(prefix):]
            if stem in categories:
                return categories[stem]
    if normalised.startswith("bofors"):
        return "emplacement"
    return "unknown"


# --------------------------------------------------------------------------- #
# Dossier assembly
# --------------------------------------------------------------------------- #

def parse_teams(files: LevelFiles, kit_types: dict[str, str] | None = None) -> list[dict]:
    init = files.get("init.con")
    conquest = files.get("gametypes/conquest.con", "conquest.con")

    skins = {int(t): s for t, s in con_values(init, "game.setTeamSkin", 2) if t in ("1", "2")}
    kits: dict[int, list[str]] = {1: [], 2: []}
    for team, _slot, kit in con_values(init, "game.setKit", 3):
        if team in ("1", "2"):
            kits[int(team)].append(kit)

    tickets = {int(t): int(float(n)) for t, n in con_values(conquest, "Game.setNumberOfTickets", 2)
               if t in ("1", "2") and _numeric(n)}
    bleed = {int(t): int(float(n)) for t, n in con_values(conquest, "Game.setTicketLostPerMin", 2)
             if t in ("1", "2") and _numeric(n)}

    assault_raw = con_first(init, "game.assaultTeam")
    assault = int(assault_raw) if assault_raw and assault_raw.isdigit() else None

    teams = []
    for index in (1, 2):
        skin = skins.get(index, "")
        nation = nation_of_skin(skin) if skin else None
        if not nation:
            nation = nation_of_kits(kits[index])
        seen: set[str] = set()
        loadout = []
        for kit in kits[index]:
            key = normalise_template(kit)
            if not key or key in seen:
                continue
            seen.add(key)
            role = (kit_types or {}).get(key) or kit_role(kit)
            loadout.append({
                "template": kit,
                "name": kit_label(kit),
                "role": role,
                "icon": key,
            })
        teams.append({
            "index": index,
            "nation": nation,
            "label": NATION_LABELS.get(nation or "", None) or skin_label(skin) or f"Team {index}",
            "skin": skin or None,
            "tickets": tickets.get(index),
            "ticketLossPerMin": bleed.get(index),
            "isAssault": assault == index,
            "kits": loadout,
        })
    return teams


def _numeric(value: str) -> bool:
    try:
        float(value)
        return True
    except ValueError:
        return False


def parse_control_points(files: LevelFiles, world_size: float | None) -> list[dict]:
    placements = files.get("conquest/controlpoints.con")
    templates = files.get("conquest/controlpointtemplates.con")

    # Starting owner comes from the template block, keyed by the template being built.
    owners: dict[str, int] = {}
    current: str | None = None
    for line in templates.splitlines():
        created = re.match(r"\s*ObjectTemplate\.create\s+ControlPoint\s+(\S+)", line, re.IGNORECASE)
        if created:
            current = created.group(1).lower()
            continue
        team = re.match(r"\s*ObjectTemplate\.team\s+(\d+)", line, re.IGNORECASE)
        if team and current:
            owners[current] = int(team.group(1))

    points: list[dict] = []
    current_name: str | None = None
    for line in placements.splitlines():
        created = re.match(r"\s*Object\.create\s+(\S+)", line, re.IGNORECASE)
        if created:
            current_name = created.group(1)
            continue
        position = re.match(r"\s*Object\.absolutePosition\s+(\S+)", line, re.IGNORECASE)
        if position and current_name:
            coords = position.group(1).split("/")
            if len(coords) == 3 and all(_numeric(c) for c in coords):
                x, _height, z = (float(c) for c in coords)
                point = {
                    "name": control_point_label(current_name),
                    "id": current_name.lower(),
                    "team": owners.get(current_name.lower(), 0),
                }
                if world_size:
                    # Refractor world space is x east, z north, origin at a map corner.
                    # Screen space runs top-down, so z inverts.
                    point["x"] = round(min(max(x / world_size, 0.0), 1.0), 4)
                    point["y"] = round(min(max(1.0 - z / world_size, 0.0), 1.0), 4)
                points.append(point)
            current_name = None
    return points


def parse_arsenal(files: LevelFiles, categories: dict[str, str],
                  kit_types: dict[str, str] | None = None) -> list[dict]:
    """What each side can field, and from how many spawn points.

    A spawner declares one template per team and the level then places that spawner
    some number of times, so the count is spawn points rather than simultaneous
    vehicles — a spawner refills after its TimeToLive elapses.
    """
    templates_text = files.get("conquest/objectspawntemplates.con")
    spawns_text = files.get("conquest/objectspawns.con")

    spawner_templates: dict[str, dict[int, str]] = {}
    # `ObjectTemplate.teamOnVehicle N` pins a spawner's output to one side no matter who
    # holds it — that is how a level gives one team a carrier while still declaring the
    # same hull under both team slots.
    spawner_owner: dict[str, int] = {}
    current: str | None = None
    for line in templates_text.splitlines():
        created = re.match(r"\s*ObjectTemplate\.create\s+ObjectSpawner\s+(\S+)", line, re.IGNORECASE)
        if created:
            current = created.group(1).lower()
            spawner_templates.setdefault(current, {})
            continue
        if not current:
            continue
        assigned = re.match(r"\s*ObjectTemplate\.setObjectTemplate\s+(\d+)\s+(\S+)", line, re.IGNORECASE)
        if assigned:
            team = int(assigned.group(1))
            name = assigned.group(2)
            if team in (1, 2) and name.lower() not in NON_VEHICLE_TEMPLATES:
                spawner_templates[current][team] = name
            continue
        pinned = re.match(r"\s*ObjectTemplate\.teamOnVehicle\s+(\d+)", line, re.IGNORECASE)
        if pinned and int(pinned.group(1)) in (1, 2):
            spawner_owner[current] = int(pinned.group(1))

    placements: dict[str, int] = {}
    for (name,) in con_values(spawns_text, "Object.create", 1):
        lowered = name.lower()
        if lowered in spawner_templates:
            placements[lowered] = placements.get(lowered, 0) + 1

    # A level that ships no ObjectSpawns.con (or one guarded behind a host block we do
    # not evaluate) still declares its spawners, so fall back to counting each once.
    if not placements:
        placements = {name: 1 for name in spawner_templates}

    tally: dict[tuple[int, str], dict] = {}
    for spawner, count in placements.items():
        pinned_to = spawner_owner.get(spawner)
        for team, template in spawner_templates.get(spawner, {}).items():
            if pinned_to is not None:
                if team != pinned_to:
                    continue
                team = pinned_to
            normalised = normalise_template(template)
            category = lookup_category(categories, normalised)
            # A rifle or soldier kit in a vehicle spawner is a kit drop, not something you drive.
            if category == "handweapon" or (kit_types and normalised in kit_types):
                continue
            key = (team, normalised)
            entry = tally.setdefault(key, {
                "team": team,
                "template": template,
                "name": vehicle_label(template),
                "key": normalised,
                "icon": ICON_ALIASES.get(template.lower(), normalised),
                "category": category,
                "spawnPoints": 0,
            })
            entry["spawnPoints"] += count

    order = {"land": 0, "air": 1, "sea": 2, "emplacement": 3, "unknown": 4}
    return sorted(
        tally.values(),
        key=lambda v: (v["team"], order.get(v["category"], 9), -v["spawnPoints"], v["key"]),
    )


# A minimap texture is hand-authored art, not an engine render, so nothing guarantees
# it frames the same square the terrain occupies. Almost all of them do — spot-checking
# the 21 stock maps, every flag lands on the road junction or beach it names — but
# Berlin's is drawn at a different framing, which would scatter its flags into a corner.
# The tell is that the flags end up crushed against a world edge, somewhere a combat
# area never actually sits, so treat that as the texture disagreeing with the terrain.
EDGE_BAND = 0.15


def control_points_are_plottable(points: list[dict]) -> bool:
    placed = [p for p in points if "x" in p and "y" in p]
    if not placed:
        return False
    xs = [p["x"] for p in placed]
    ys = [p["y"] for p in placed]
    for lo, hi in ((min(xs), max(xs)), (min(ys), max(ys))):
        if hi < EDGE_BAND or lo > 1.0 - EDGE_BAND:
            return False
    return True


def build_dossier(mod: str, level: str, files: LevelFiles, categories: dict[str, str],
                  kit_types: dict[str, str] | None = None) -> dict | None:
    terrain = files.get("init/terrain.con")
    world_raw = con_first(terrain, "GeometryTemplate.worldSize")
    world_size = float(world_raw) if world_raw and _numeric(world_raw) else None

    teams = parse_teams(files, kit_types)
    control_points = parse_control_points(files, world_size)
    arsenal = parse_arsenal(files, categories, kit_types)

    # A level that yields nothing on every axis is a stub (menu-only or broken archive)
    # and a dossier for it would be an empty panel on the site.
    has_nations = any(t["nation"] for t in teams)
    if not has_nations and not control_points and not arsenal:
        return None

    return {
        "mod": mod,
        "map": level,
        "displayName": display_name(level),
        "worldSize": world_size,
        "teams": teams,
        "controlPoints": control_points,
        "controlPointsPlottable": control_points_are_plottable(control_points),
        "arsenal": arsenal,
    }


# --------------------------------------------------------------------------- #
# Driving
# --------------------------------------------------------------------------- #

_CATEGORY_CACHE: dict[Path, dict[str, str]] = {}


def categories_cached(mod_dir: Path) -> dict[str, str]:
    if mod_dir not in _CATEGORY_CACHE:
        _CATEGORY_CACHE[mod_dir] = vehicle_categories(mod_dir)
    return _CATEGORY_CACHE[mod_dir]


def inherited_categories(mod_dir: Path, mod_dirs: dict[str, Path]) -> dict[str, str]:
    """Classify objects using the mod's own archives, then its parents'.

    An FHSW level spawns plenty of hulls that only FH or the base game defines, so
    indexing one mod in isolation leaves most of its arsenal unclassified.
    """
    categories: dict[str, str] = {}
    for name in mod_search_path(mod_dir):
        parent = mod_dirs.get(name)
        if parent is None:
            continue
        for key, value in categories_cached(parent).items():
            categories.setdefault(key, value)
    return categories


_KIT_TYPE_CACHE: dict[Path, dict[str, str]] = {}


def kit_types_cached(mod_dir: Path) -> dict[str, str]:
    if mod_dir not in _KIT_TYPE_CACHE:
        _KIT_TYPE_CACHE[mod_dir] = kit_types_for_mod(mod_dir)
    return _KIT_TYPE_CACHE[mod_dir]


def inherited_kit_types(mod_dir: Path, mod_dirs: dict[str, Path]) -> dict[str, str]:
    kit_types: dict[str, str] = {}
    for name in mod_search_path(mod_dir):
        parent = mod_dirs.get(name)
        if parent is None:
            continue
        for key, value in kit_types_cached(parent).items():
            kit_types.setdefault(key, value)
    return kit_types


_LEVEL_CACHE: dict[Path, dict[str, LevelFiles]] = {}


def read_levels_cached(mod_dir: Path) -> dict[str, LevelFiles]:
    """A parent mod's levels are re-read by every mod that inherits from it."""
    if mod_dir not in _LEVEL_CACHE:
        _LEVEL_CACHE[mod_dir] = read_levels(mod_dir)
    return _LEVEL_CACHE[mod_dir]


def extract_mod(mod_dir: Path, out_root: Path, force: bool, mod_dirs: dict[str, Path]) -> dict:
    mod = mod_dir.name.lower()
    out_dir = out_root / mod
    stats = {"written": 0, "skipped": 0, "empty": 0, "failed": [], "maps": []}

    categories = inherited_categories(mod_dir, mod_dirs)
    kit_types = inherited_kit_types(mod_dir, mod_dirs)
    levels = read_levels_cached(mod_dir)

    # Fill each level's gaps from the same level in the mods this one inherits from,
    # nearest parent first, the way the engine resolves content it does not ship.
    for parent_name in mod_search_path(mod_dir)[1:]:
        parent_dir = mod_dirs.get(parent_name)
        if parent_dir is None or parent_dir == mod_dir:
            continue
        parent_levels = read_levels_cached(parent_dir)
        for level, files in levels.items():
            parent = parent_levels.get(level)
            if parent is not None:
                files.underlay(parent)

    for level, files in sorted(levels.items()):
        target = out_dir / f"{level}.json"
        if target.exists() and not force:
            stats["skipped"] += 1
            stats["maps"].append(level)
            continue
        try:
            dossier = build_dossier(mod, level, files, categories, kit_types)
        except Exception as exc:
            stats["failed"].append(f"{level}: {exc}")
            continue
        if dossier is None:
            stats["empty"] += 1
            continue
        out_dir.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(dossier, separators=(",", ":")), encoding="utf-8")
        stats["written"] += 1
        stats["maps"].append(level)

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR,
                        help="Battlefield 1942 installation root")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT,
                        help="output directory for the dossier tree")
    parser.add_argument("--mods", nargs="*", help="restrict to these mod folders")
    parser.add_argument("--force", action="store_true", help="rewrite dossiers that already exist")
    args = parser.parse_args()

    game_dir = args.game_dir.expanduser()
    mods_dir = game_dir / "Mods"
    if not mods_dir.is_dir():
        print(f"No Mods folder under {game_dir}", file=sys.stderr)
        return 1

    wanted = {m.lower() for m in args.mods} if args.mods else None
    manifest_mods: dict[str, dict] = {}
    totals = {"written": 0, "skipped": 0, "empty": 0}
    # A mod's search path names its parents in lowercase; the folders are not.
    mod_dirs = {p.name.lower(): p for p in mods_dir.iterdir() if p.is_dir()}

    for mod_dir in sorted(p for p in mods_dir.iterdir() if p.is_dir()):
        mod = mod_dir.name.lower()
        if wanted and mod not in wanted:
            continue
        stats = extract_mod(mod_dir, args.out, args.force, mod_dirs)
        if not stats["maps"] and not stats["failed"]:
            continue
        for key in totals:
            totals[key] += stats[key]
        manifest_mods[mod] = {
            "searchPath": mod_search_path(mod_dir),
            "maps": sorted(stats["maps"]),
        }
        print(f"{mod:14s} written={stats['written']:4d} skipped={stats['skipped']:4d} "
              f"empty={stats['empty']:3d} failed={len(stats['failed'])}")
        for failure in stats["failed"][:5]:
            print(f"    {failure}", file=sys.stderr)

    if not manifest_mods:
        print("No levels found — is --game-dir right?", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": 1,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mods": manifest_mods,
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")

    print(f"\n{totals['written']} written, {totals['skipped']} already present, "
          f"{totals['empty']} levels with nothing to report -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
