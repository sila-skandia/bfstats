#!/usr/bin/env python3
"""Extract BF1942 and mod theater loading artwork into WebP/PNG and generate mapTheaters.json.

Scans menu.rfa in BF1942, Desert Combat, The Road to Rome, Secret Weapons, and FH,
extracts authentic 800x600 24-bit loading screens, converts them into web-optimized
WebP and PNG images in tournament-images/theaters/, scans level archives for
`game.setLoadPicture`, and builds ui/src/data/mapTheaters.json.

Requires: liblzo2 (system), Pillow.
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import io
import json
import re
import struct
import sys
from pathlib import Path
from PIL import Image

DEFAULT_GAME = Path("/home/dylan/.wine/drive_c/EA Games/Battlefield 1942")
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "tournament-images/theaters"
DEFAULT_JSON = REPO_ROOT / "ui/src/data/mapTheaters.json"

# --------------------------------------------------------------------------- #
# LZO1X Decompression
# --------------------------------------------------------------------------- #

def _load_lzo():
    for name in ("liblzo2.so.2", "liblzo2.so", ctypes.util.find_library("lzo2")):
        if not name:
            continue
        try:
            return ctypes.CDLL(name)
        except OSError:
            continue
    sys.exit("liblzo2 not found — install it (e.g. pacman -S lzo or apt install liblzo2-2)")


_LZO = _load_lzo()
_LZO.lzo1x_decompress_safe.argtypes = [
    ctypes.c_char_p,
    ctypes.c_size_t,
    ctypes.c_char_p,
    ctypes.POINTER(ctypes.c_size_t),
    ctypes.c_void_p,
]
_LZO.lzo1x_decompress_safe.restype = ctypes.c_int


# --------------------------------------------------------------------------- #
# RFA Archive Reader
# --------------------------------------------------------------------------- #

class RfaArchive:
    """Refractor Flat Archive (RFA) parser with LZO1X segment decompression."""

    def __init__(self, path: Path):
        self.path = path
        self.data = path.read_bytes()
        self.entries: dict[str, tuple[int, int, int]] = {}
        self.compressed = False
        self._base = 0
        self._parse()

    def _parse(self) -> None:
        data = self.data
        if data[:28] == b"Refractor2 FlatArchive 1.1  " or data[:28] == b"Refractor2 FlatArchive 1.1 ":
            self._base = 28
            offset = struct.unpack_from("<I", data, 28)[0]
            self.compressed = struct.unpack_from("<I", data, 32)[0] == 1
        else:
            self._base = 0
            offset, flag = struct.unpack_from("<II", data, 0)
            self.compressed = flag == 1

        count = struct.unpack_from("<I", data, self._base + offset)[0]
        pos = self._base + offset + 4
        for _ in range(count):
            name_len = struct.unpack_from("<I", data, pos)[0]
            pos += 4
            name = data[pos : pos + name_len].decode("latin1")
            pos += name_len
            compressed_size, uncompressed_size, file_offset = struct.unpack_from("<III", data, pos)
            pos += 24
            self.entries[name.replace("\\", "/")] = (compressed_size, uncompressed_size, file_offset)

    def find_all(self, pattern: str) -> list[str]:
        pat = pattern.lower()
        return [k for k in self.entries if pat in k.lower()]

    def extract(self, name: str) -> bytes:
        if name not in self.entries:
            # Case-insensitive fallback
            lowered = name.lower()
            matched = next((k for k in self.entries if k.lower() == lowered), None)
            if not matched:
                raise KeyError(f"Entry {name} not found in {self.path.name}")
            name = matched

        c_size, uc_size, file_offset = self.entries[name]
        abs_offset = self._base + file_offset
        if not self.compressed:
            return self.data[abs_offset : abs_offset + uc_size]

        segs = struct.unpack_from("<I", self.data, abs_offset)[0]
        pieces: list[bytes] = []
        header = abs_offset + 4
        for i in range(segs):
            seg_cs, seg_us, seg_off = struct.unpack_from("<III", self.data, header + 12 * i)
            start = header + 12 * segs + seg_off
            payload = self.data[start : start + seg_cs]
            if seg_cs == seg_us:
                pieces.append(payload)
            else:
                out = ctypes.create_string_buffer(seg_us)
                out_len = ctypes.c_size_t(seg_us)
                rc = _LZO.lzo1x_decompress_safe(payload, seg_cs, out, ctypes.byref(out_len), None)
                if rc != 0:
                    raise RuntimeError(f"LZO decompress failed ({rc}) for {name} in {self.path.name}")
                pieces.append(out.raw[: out_len.value])
        return b"".join(pieces)


# --------------------------------------------------------------------------- #
# Theater Metadata & Historical Lore
# --------------------------------------------------------------------------- #

THEATER_METADATA: dict[str, dict] = {
    "pacific": {
        "title": "Pacific Theater — Carrier Battles",
        "category": "Pacific",
        "image": "pacific.webp",
        "description": "Carrier strikes and amphibious naval landings across the vast expanse of the Pacific Ocean, where naval aviation and task forces decided the strategic course of the war.",
    },
    "pacific2": {
        "title": "Pacific Theater — Island Assault",
        "category": "Pacific",
        "image": "pacific2.webp",
        "description": "Fierce amphibious invasions and garrison defense of fortified coral atolls and volcanic islands across the central and western Pacific.",
    },
    "desert": {
        "title": "North African Campaign",
        "category": "North Africa",
        "image": "desert.webp",
        "description": "Sweeping mechanized armor maneuvers and defensive lines contested across the scorched sands, minefields, and rocky ridges of Libya and Egypt.",
    },
    "eastern": {
        "title": "Eastern Front — Siege & Winter",
        "category": "Eastern Front",
        "image": "eastern.webp",
        "description": "The catastrophic struggle for major industrial cities and frozen expanses along the Eastern Front, marked by bitter winter warfare and close-quarters city fighting.",
    },
    "eastern2": {
        "title": "Eastern Front — Armor Clash",
        "category": "Eastern Front",
        "image": "eastern2.webp",
        "description": "Colossal summer armored clashes and deep defense networks across the Russian steppes, pitting massed Soviet armor against German panzer spearheads.",
    },
    "western": {
        "title": "Western Europe — Atlantic Wall",
        "category": "Western Europe",
        "image": "western.webp",
        "description": "The monumental Allied amphibious assault against coastal gun batteries, beach obstacles, and reinforced concrete bunkers along the Atlantic Wall.",
    },
    "western2": {
        "title": "Western Europe — Liberation",
        "category": "Western Europe",
        "image": "western2.webp",
        "description": "Claustrophobic fighting through ancient French hedgerows and daring airborne drops across Dutch waterways pushing toward the heart of Germany.",
    },
    "britain_load": {
        "title": "Battle of Britain — Channel Air Defense",
        "category": "Western Europe",
        "image": "britain_load.webp",
        "description": "The pivotal aerial defense waged above southern England and the English Channel, where RAF Fighter Command intercepted and turned back the Luftwaffe daylight raids.",
    },
    "caen_load": {
        "title": "Western Europe — Battle for Caen",
        "category": "Western Europe",
        "image": "caen_load.webp",
        "description": "The grueling post-D-Day struggle between Anglo-Canadian forces and German Panzer divisions for control of the vital Norman crossroads city of Caen.",
    },
    "philippines_load": {
        "title": "Pacific Theater — Philippines Campaign",
        "category": "Pacific",
        "image": "philippines_load.webp",
        "description": "The major Allied archipelago campaign to liberate the Philippine islands from Imperial Japanese forces across rivers, valleys, and fortified coastal defenses.",
    },
    "italytower": {
        "title": "Italian Campaign — Mountain & Coastal Assault",
        "category": "Mediterranean",
        "image": "italytower.webp",
        "description": "The arduous drive up the Italian peninsula across rugged Apennine mountains, ancient stone towns, and defended coastal approaches.",
    },
    "scout_antitank": {
        "title": "Italian Campaign — Gustav Line Defense",
        "category": "Mediterranean",
        "image": "scout_antitank.webp",
        "description": "Mountain infantry, scouts, and anti-tank crews battling across steep rocky ridgelines and the formidable fortifications of the Gustav Line.",
    },
    "sturm_guy": {
        "title": "Italian Campaign — Beachhead Counterattack",
        "category": "Mediterranean",
        "image": "sturm_guy.webp",
        "description": "High-stakes amphibious beachheads and fierce armored counter-offensives across coastal plains and fortified positions at Salerno and Anzio.",
    },
    "calliope": {
        "title": "Secret Weapons — Rocket Artillery & Strongholds",
        "category": "Secret Weapons",
        "image": "calliope.webp",
        "description": "Experimental T34 Calliope rocket launcher tanks and Allied armor breaching fortified Alpine strongholds and defensive lines.",
    },
    "goblin": {
        "title": "Secret Weapons — Experimental Flight & Superguns",
        "category": "Secret Weapons",
        "image": "goblin.webp",
        "description": "Top-secret research bases housing experimental rocket fighters, super-heavy long-range artillery, and ballistic missile installations.",
    },
    "xpack2_sturm": {
        "title": "Secret Weapons — Industrial Heartland",
        "category": "Secret Weapons",
        "image": "xpack2_sturm.webp",
        "description": "Combat around vital industrial complexes, weapons testing ranges, and prototype production facilities in the final months of the war.",
    },
    "xpack2_winter": {
        "title": "Secret Weapons — Northern Sabotage",
        "category": "Secret Weapons",
        "image": "xpack2_winter.webp",
        "description": "Clandestine commando raids and sabotage operations targeting heavy water production and concealed missile sites in frozen Scandinavian terrain.",
    },
    "agheila_load": {
        "title": "North Africa — Desert Commando Strike",
        "category": "North Africa",
        "image": "agheila_load.webp",
        "description": "Long Range Desert Group special operations and raids against fortified Axis desert airfields and remote desert depots.",
    },
    "dc_apache": {
        "title": "Desert Combat — Rotary Close Air Support",
        "category": "Desert Combat",
        "image": "dc_apache.webp",
        "description": "AH-64 Apache attack helicopters operating in contested desert airspace, delivering guided anti-tank missiles and rocket barrages.",
    },
    "dc_scud": {
        "title": "Desert Combat — Tactical Ballistic Missiles",
        "category": "Desert Combat",
        "image": "dc_scud.webp",
        "description": "Mobile Scud TEL launchers and long-range ballistic missile emplacements hidden in desert wadis and arid valleys.",
    },
    "dc_tanks": {
        "title": "Desert Combat — Modern Armored Warfare",
        "category": "Desert Combat",
        "image": "dc_tanks.webp",
        "description": "Modern main battle tank spearheads clashing across open desert terrain with thermal sights, reactive armor, and heavy firepower.",
    },
    "dc_f15": {
        "title": "Desert Combat — Air Superiority",
        "category": "Desert Combat",
        "image": "dc_f15.webp",
        "description": "Modern supersonic fighter aircraft maintaining no-fly zones and engaging hostile bogeys with beyond-visual-range radar-guided missiles.",
    },
    "dc_blackhawk": {
        "title": "Desert Combat — Airborne Insertion",
        "category": "Desert Combat",
        "image": "dc_blackhawk.webp",
        "description": "UH-60 Blackhawk tactical transport helicopters inserting special operations squads deep into hostile territory under fire.",
    },
    "dc_harrier": {
        "title": "Desert Combat — Naval Aviation & VTOL Strike",
        "category": "Desert Combat",
        "image": "dc_harrier.webp",
        "description": "AV-8B Harrier vertical takeoff and landing strike aircraft launching from amphibious assault carriers for rapid coastal interdiction.",
    },
    "dc_gazelle": {
        "title": "Desert Combat — Rotary Reconnaissance",
        "category": "Desert Combat",
        "image": "dc_gazelle.webp",
        "description": "Fast scout and light attack helicopters flying nap-of-the-earth reconnaissance and anti-armor hunting missions.",
    },
    "dc_night": {
        "title": "Desert Combat — Night Operations",
        "category": "Desert Combat",
        "image": "dc_night.webp",
        "description": "Infiltration, stealth strikes, and urban bridgehead assaults executed under the cover of darkness with night-vision systems.",
    },
    "closequarters": {
        "title": "Desert Combat — Urban & Industrial CQB",
        "category": "Desert Combat",
        "image": "closequarters.webp",
        "description": "High-intensity close-quarters battle through urban boulevards, fortified airport hangars, dockyards, and hardened aircraft shelters.",
    },
}

# Map specific lore descriptions
MAP_LORE: dict[str, dict] = {
    "wake": {
        "displayName": "Wake Island",
        "theaterKey": "pacific2",
        "dcTheaterKey": "dc_harrier",
        "description": "A tiny coral atoll in the central Pacific, Wake Island was garrisoned by US Marines who repelled the initial Japanese amphibious assault before being overwhelmed in fierce close-quarters combat.",
    },
    "midway": {
        "displayName": "Battle of Midway",
        "theaterKey": "pacific",
        "dcTheaterKey": "dc_harrier",
        "description": "The turning point of the Pacific War. Deep in the open sea around Midway Atoll, American naval aviators intercepted and destroyed four Japanese fleet carriers in a decisive clash of carrier aviation.",
    },
    "guadalcanal": {
        "displayName": "Guadalcanal",
        "theaterKey": "pacific",
        "dcTheaterKey": "dc_harrier",
        "description": "The bitter first major Allied land offensive against the Japanese Empire in the Solomon Islands, centered on the desperate fight for control of Henderson Field amid dense jungle and naval clashes in Ironbottom Sound.",
    },
    "iwo_jima": {
        "displayName": "Iwo Jima",
        "theaterKey": "pacific2",
        "dcTheaterKey": "dc_harrier",
        "description": "A heavily fortified black sand volcanic island defended by an intricate network of subterranean tunnels, caves, and pillboxes beneath the shadow of Mount Suribachi.",
    },
    "coral_sea": {
        "displayName": "Coral Sea",
        "theaterKey": "pacific2",
        "dcTheaterKey": "dc_harrier",
        "description": "The first naval battle in history in which opposing ships never caught sight of or fired directly upon each other, waged entirely by carrier-based aircraft over the Coral Sea.",
    },
    "invasion_of_the_philippines": {
        "displayName": "Invasion of the Philippines",
        "theaterKey": "philippines_load",
        "fallbackTheaterKey": "pacific",
        "dcTheaterKey": "dc_gazelle",
        "description": "The Allied campaign to liberate the Philippine archipelago from Imperial Japanese forces, marked by ferocious river crossings, dense coconut groves, and fortified bunker positions.",
    },
    "el_alamein": {
        "displayName": "El Alamein",
        "theaterKey": "desert",
        "dcTheaterKey": "dc_tanks",
        "description": "The climactic clash between Montgomery's Eighth Army and Rommel's Panzer Army Africa across the vast sandy expanses and rocky ridges west of Alexandria, halting the Axis drive to the Suez Canal.",
    },
    "tobruk": {
        "displayName": "Tobruk",
        "theaterKey": "desert",
        "dcTheaterKey": "dc_tanks",
        "description": "The fortified Mediterranean deep-water port of Tobruk, where Allied forces endured a brutal eight-month siege against repeated German and Italian assaults across minefields and anti-tank ditches.",
    },
    "gazala": {
        "displayName": "Gazala",
        "theaterKey": "desert",
        "dcTheaterKey": "dc_scud",
        "description": "The sweeping armored battle across the Gazala Line in Cyrenaica, where Rommel executed a daring flanking maneuver south around the Free French fortress at Bir Hakeim.",
    },
    "battleaxe": {
        "displayName": "Battleaxe",
        "theaterKey": "desert",
        "dcTheaterKey": "dc_tanks",
        "description": "The British offensive launched to relieve the besieged garrison at Tobruk, characterized by grinding tank battles around the strategic Halfaya Pass and Fort Capuzzo.",
    },
    "aberdeen": {
        "displayName": "Aberdeen",
        "theaterKey": "desert",
        "dcTheaterKey": "dc_tanks",
        "description": "A sprawling expanse of desert terrain featuring wide maneuvering corridors and long-range tank engagements across arid ridges and fortified outposts.",
    },
    "stalingrad": {
        "displayName": "Stalingrad",
        "theaterKey": "eastern",
        "dcTheaterKey": "dc_night",
        "description": "The catastrophic battle for the city on the Volga, characterized by brutal house-to-house and room-to-room combat through pulverized factories, rail yards, and shattered urban ruins.",
    },
    "kursk": {
        "displayName": "Kursk",
        "theaterKey": "eastern2",
        "dcTheaterKey": "dc_apache",
        "description": "Operation Citadel: the largest clash of armored vehicles in military history, pitting massive Soviet defense in depth against German Tiger and Panther armored spearheads across the steppe.",
    },
    "kharkov": {
        "displayName": "Kharkov",
        "theaterKey": "eastern2",
        "dcTheaterKey": "dc_apache",
        "description": "The war-torn Ukrainian industrial center that changed hands four times during the war, serving as the crucible for intense mobile armored counterstrokes and bitter winter combat.",
    },
    "berlin": {
        "displayName": "Berlin",
        "theaterKey": "eastern",
        "dcTheaterKey": "closequarters",
        "description": "The ultimate Soviet assault into the heart of Berlin, where Red Army shock troops fought street-by-street against desperate German defenders to raise the victory banner over the Reichstag.",
    },
    "omaha_beach": {
        "displayName": "Omaha Beach",
        "theaterKey": "western",
        "dcTheaterKey": "closequarters",
        "description": "The bloody June 6, 1944 amphibious landing on the Normandy coast, where American troops stormed ashore under withering crossfire from German cliffside bunkers and the Atlantic Wall.",
    },
    "bocage": {
        "displayName": "Bocage",
        "theaterKey": "western2",
        "dcTheaterKey": "dc_gazelle",
        "description": "The suffocating battle for the Normandy hedgerows, where ancient stone-earthen berms and dense foliage turned French farmlands into deadly killing zones for advancing Allied armor.",
    },
    "market_garden": {
        "displayName": "Market Garden",
        "theaterKey": "western2",
        "dcTheaterKey": "dc_gazelle",
        "description": "The audacious airborne operation to seize a corridor of bridges across the Netherlands into Germany, culminating in the heroic British 1st Airborne stand at Arnhem bridge.",
    },
    "battle_of_the_bulge": {
        "displayName": "Battle of the Bulge",
        "theaterKey": "eastern",
        "dcTheaterKey": "dc_apache",
        "description": "Hitler's final winter counter-offensive in the frozen, snow-choked forests of the Ardennes, pitting entrenched American infantry against heavy German panzer formations.",
    },
    "battle_of_britain": {
        "displayName": "Battle of Britain",
        "theaterKey": "britain_load",
        "fallbackTheaterKey": "western",
        "dcTheaterKey": "dc_harrier",
        "description": "The desperate 1940 summer air campaign waged over the skies of southern England and the English Channel, pitting RAF Fighter Command against the German Luftwaffe.",
    },
    "liberation_of_caen": {
        "displayName": "Liberation of Caen",
        "theaterKey": "caen_load",
        "fallbackTheaterKey": "western2",
        "dcTheaterKey": "closequarters",
        "description": "The fierce Anglo-Canadian campaign to capture the vital road junction and ancient city of Caen following D-Day, contested by elite German Panzer divisions.",
    },
    "baytown": {
        "displayName": "Operation Baytown",
        "theaterKey": "italytower",
        "description": "The Allied landing across the Strait of Messina onto the toe of the Italian mainland, marking the opening offensive of the Italian Campaign.",
    },
    "salerno": {
        "displayName": "Battle of Salerno",
        "theaterKey": "sturm_guy",
        "description": "Operation Avalanche: the dramatic Allied amphibious assault into the Gulf of Salerno, enduring blistering German armored counterattacks on the beachhead.",
    },
    "anzio": {
        "displayName": "Anzio",
        "theaterKey": "sturm_guy",
        "description": "Operation Shingle: the surprise amphibious landing behind the German Winter Line intended to break the stalemate at Monte Cassino, turning into months of brutal beachhead containment.",
    },
    "cassino": {
        "displayName": "Monte Cassino",
        "theaterKey": "scout_antitank",
        "description": "Four brutal Allied assaults against the mountainous Gustav Line anchored by the historic Benedictine monastery overlooking the Liri Valley.",
    },
    "santo_croce": {
        "displayName": "Santo Croce",
        "theaterKey": "scout_antitank",
        "description": "High-altitude mountain warfare along rugged Italian ridges, with entrenched positions contested through narrow winding passes.",
    },
    "husky": {
        "displayName": "Operation Husky",
        "theaterKey": "italytower",
        "description": "The massive combined airborne and amphibious assault on Sicily that opened Mediterranean sea lanes and launched the campaign against Axis southern Europe.",
    },
    "eagles_nest": {
        "displayName": "Eagle's Nest",
        "theaterKey": "calliope",
        "description": "The Kehlsteinhaus mountain outpost perched high in the Bavarian Alps, contested in a clash of experimental rocket-launching armor and elite paratroopers.",
    },
    "essen": {
        "displayName": "Essen",
        "theaterKey": "xpack2_sturm",
        "description": "The bombed-out factory complexes of the Krupp industrial empire in the Ruhr Valley, scene of urban mechanized combat featuring experimental weapons.",
    },
    "gothic_line": {
        "displayName": "Gothic Line",
        "theaterKey": "calliope",
        "description": "Field Marshal Kesselring's heavily fortified defensive belt in the northern Apennines, barring the Allied advance into the Po Valley.",
    },
    "hellendoorn": {
        "displayName": "Hellendoorn",
        "theaterKey": "xpack2_winter",
        "description": "Concealed ballistic missile launch pads in the dense forests of the Netherlands, targeting Allied logistics hubs.",
    },
    "kbely_airfield": {
        "displayName": "Kbely Airfield",
        "theaterKey": "xpack2_sturm",
        "description": "The strategic airfield near Prague housing advanced Luftwaffe jet and rocket prototypes, attacked in the final weeks of the war.",
    },
    "mimoyecques": {
        "displayName": "Mimoyecques",
        "theaterKey": "goblin",
        "description": "A subterranean concrete fortress in northern France housing the V-3 multi-chamber supergun aimed across the English Channel at London.",
    },
    "peenemunde": {
        "displayName": "Peenemünde",
        "theaterKey": "goblin",
        "description": "The top-secret German military test grounds on the Baltic coast where the V-1 flying bomb and V-2 rocket were developed.",
    },
    "raid_on_agheila": {
        "displayName": "Raid on Agheila",
        "theaterKey": "agheila_load",
        "fallbackTheaterKey": "desert",
        "description": "A daring Long Range Desert Group commando raid against an Axis airfield and supply depot deep in the Libyan desert.",
    },
    "telemark": {
        "displayName": "Telemark",
        "theaterKey": "xpack2_winter",
        "description": "The remote, snowbound Vemork hydroelectric facility in Telemark, Norway, where Allied commandos sought to cripple the German atomic program.",
    },
    "dc_battle_of_73_easting": {
        "displayName": "Battle of 73 Easting",
        "theaterKey": "dc_tanks",
        "description": "The definitive modern armored clash of Operation Desert Storm, where M1A1 Abrams and Bradley fighting vehicles dismantled entrenched Republican Guard armor in a blinding sandstorm.",
    },
    "dc_medina_ridge": {
        "displayName": "Medina Ridge",
        "theaterKey": "dc_blackhawk",
        "description": "The largest tank engagement of the Gulf War, with US armored brigades engaging the Iraqi Medina Luminous Division across open desert ridges.",
    },
    "dc_al_nas": {
        "displayName": "Al Nas",
        "theaterKey": "closequarters",
        "description": "Tight street combat and rooftop sniper perches in an Iraqi city center, with modern infantry supported by armor and attack helicopters.",
    },
    "dc_al_nas_day2": {
        "displayName": "Al Nas (Day 2)",
        "theaterKey": "closequarters",
        "description": "Follow-on urban offensive through the dust-choked boulevards and alleys of Al Nas.",
    },
    "dc_basrahs_edge": {
        "displayName": "Basrah's Edge",
        "theaterKey": "dc_blackhawk",
        "description": "Operations along the strategic desert perimeter and waterways outside the port city of Basrah.",
    },
    "dc_bridge": {
        "displayName": "DC Bridge",
        "theaterKey": "dc_night",
        "description": "A crucial Euphrates river crossing defended by anti-air emplacements and contested under the cover of night by rotary wing and motorized units.",
    },
    "dc_coastal_hammer": {
        "displayName": "Coastal Hammer",
        "theaterKey": "dc_harrier",
        "description": "Carrier air strikes and amphibious landings against fortified coastline radar installations and missile batteries.",
    },
    "dc_cornered": {
        "displayName": "DC Cornered",
        "theaterKey": "dc_scud",
        "description": "Mobile special forces and attack helicopters hunting mobile Scud launcher convoys hidden across hostile desert wadis.",
    },
    "dc_dustbowl": {
        "displayName": "DC Dustbowl",
        "theaterKey": "dc_tanks",
        "description": "High-speed mechanized sweep across oil-soaked desert sands under scorching midday heat.",
    },
    "dc_first_light": {
        "displayName": "DC First Light",
        "theaterKey": "dc_tanks",
        "description": "First light mechanized offensive breaking through border defenses with heavy tank support and close air support.",
    },
    "dc_lostvillage": {
        "displayName": "DC Lost Village",
        "theaterKey": "dc_blackhawk",
        "description": "Blackhawk and transport helicopter insertions into a secluded desert river village contested by hostile militia.",
    },
    "dc_lostvillage_nopara": {
        "displayName": "DC Lost Village (No Para)",
        "theaterKey": "dc_blackhawk",
        "description": "Direct ground offensive against the fortified river village without airborne drops.",
    },
    "dc_no_fly_zone_day2": {
        "displayName": "DC No Fly Zone (Day 2)",
        "theaterKey": "dc_f15",
        "description": "F-15 Eagles and fighter jets dueling over Iraqi airspace in enforcement of Operation Northern Watch.",
    },
    "dc_sea_rigs": {
        "displayName": "DC Sea Rigs",
        "theaterKey": "dc_harrier",
        "description": "Naval aviation and special forces raiding offshore oil production platforms in the Persian Gulf.",
    },
    "dc_twin_rivers": {
        "displayName": "DC Twin Rivers",
        "theaterKey": "dc_tanks",
        "description": "Armored columns clashing across the historic Tigris and Euphrates river plains.",
    },
    "dc_urban_siege": {
        "displayName": "DC Urban Siege",
        "theaterKey": "dc_gazelle",
        "description": "High-intensity close-quarters battle in a dense metropolis with attack helicopters weaving between skyscrapers.",
    },
    "dc_weapon_bunkers": {
        "displayName": "DC Weapon Bunkers",
        "theaterKey": "closequarters",
        "description": "Breaching hardened subterranean bunkers and weapon storage facilities under intense anti-aircraft fire.",
    },
}

DISPLAY_NAMES = {k: v["displayName"] for k, v in MAP_LORE.items()}


# --------------------------------------------------------------------------- #
# Image Extraction & Conversion
# --------------------------------------------------------------------------- #

def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def convert_tga_bytes(tga_bytes: bytes, dest_webp: Path, dest_png: Path) -> tuple[int, int]:
    """Convert TGA bytes to WebP and PNG using Pillow."""
    img = Image.open(io.BytesIO(tga_bytes))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")

    dest_webp.parent.mkdir(parents=True, exist_ok=True)
    dest_png.parent.mkdir(parents=True, exist_ok=True)

    # WebP: Quality 88, high compression effort
    img.save(dest_webp, format="WEBP", quality=88, method=6)
    # PNG: 24-bit optimized
    img.save(dest_png, format="PNG", optimize=True)

    return dest_webp.stat().st_size, dest_png.stat().st_size


def extract_theaters_from_archives(game_root: Path, out_dir: Path) -> dict[str, dict]:
    """Extract all relevant Load/*.tga files from menu.rfa and level RFAs."""
    extracted: dict[str, dict] = {}

    # 1. Base BF1942 menu.rfa
    bf_menu_path = game_root / "Mods/bf1942/Archives/menu.rfa"
    if bf_menu_path.is_file():
        print(f"Reading {bf_menu_path.relative_to(game_root)}...")
        arch = RfaArchive(bf_menu_path)
        for key in ["Desert", "Eastern", "Eastern2", "Pacific", "Pacific2", "Western", "Western2"]:
            found = arch.find_all(f"/load/{key}.tga")
            if found:
                entry = found[0]
                tga_bytes = arch.extract(entry)
                slug = key.lower()
                webp_dest = out_dir / f"{slug}.webp"
                png_dest = out_dir / f"{slug}.png"
                if webp_dest.is_file() and png_dest.is_file():
                    extracted[slug] = {
                        "source": str(bf_menu_path.name),
                        "entry": entry,
                        "webpSize": webp_dest.stat().st_size,
                        "pngSize": png_dest.stat().st_size,
                    }
                    continue
                tga_bytes = arch.extract(entry)
                ws, ps = convert_tga_bytes(tga_bytes, webp_dest, png_dest)
                extracted[slug] = {
                    "source": str(bf_menu_path.name),
                    "entry": entry,
                    "webpSize": ws,
                    "pngSize": ps,
                }
                print(f"  Extracted {slug}.webp ({ws} B) & {slug}.png ({ps} B)")

    # 2. Desert Combat MENU.rfa
    dc_menu_paths = [
        game_root / "Mods/DesertCombat/Archives/MENU.rfa",
        game_root / "Mods/DesertCombat/Archives/menu.rfa",
        game_root / "Mods/DC_Final/Archives/Menu.rfa",
    ]
    for p in dc_menu_paths:
        if p.is_file():
            print(f"Reading {p.relative_to(game_root)}...")
            arch = RfaArchive(p)
            for entry in arch.find_all("/load/"):
                if not entry.lower().endswith(".tga"):
                    continue
                filename = Path(entry).stem
                slug = slugify(filename)
                if slug in extracted:
                    continue
                webp_dest = out_dir / f"{slug}.webp"
                png_dest = out_dir / f"{slug}.png"
                if webp_dest.is_file() and png_dest.is_file():
                    extracted[slug] = {
                        "source": str(p.name),
                        "entry": entry,
                        "webpSize": webp_dest.stat().st_size,
                        "pngSize": png_dest.stat().st_size,
                    }
                    continue
                try:
                    tga_bytes = arch.extract(entry)
                    ws, ps = convert_tga_bytes(tga_bytes, webp_dest, png_dest)
                    extracted[slug] = {
                        "source": str(p.name),
                        "entry": entry,
                        "webpSize": ws,
                        "pngSize": ps,
                    }
                    print(f"  Extracted DC {slug}.webp ({ws} B) & {slug}.png ({ps} B)")
                except Exception as exc:
                    print(f"  Failed {entry}: {exc}", file=sys.stderr)

    # 3. Expansion Packs: The Road to Rome (XPack1) & Secret Weapons (XPack2)
    for xpack, mod_name in [(1, "XPack1"), (2, "XPack2")]:
        xp_menu = game_root / f"Mods/{mod_name}/Archives/Menu.rfa"
        if xp_menu.is_file():
            print(f"Reading {xp_menu.relative_to(game_root)}...")
            arch = RfaArchive(xp_menu)
            for entry in arch.find_all("/load/"):
                if not entry.lower().endswith(".tga"):
                    continue
                filename = Path(entry).stem
                # Clean up known placeholder prefixes
                clean_name = filename.replace("PlaceHolder_", "xpack2_") if xpack == 2 else filename
                if clean_name.lower() == "xpack2_calliope":
                    clean_name = "calliope"
                elif clean_name.lower() == "xpack2_goblin":
                    clean_name = "goblin"
                slug = slugify(clean_name)
                if slug in extracted:
                    continue
                webp_dest = out_dir / f"{slug}.webp"
                png_dest = out_dir / f"{slug}.png"
                if webp_dest.is_file() and png_dest.is_file():
                    extracted[slug] = {
                        "source": str(xp_menu.name),
                        "entry": entry,
                        "webpSize": webp_dest.stat().st_size,
                        "pngSize": png_dest.stat().st_size,
                    }
                    continue
                try:
                    tga_bytes = arch.extract(entry)
                    ws, ps = convert_tga_bytes(tga_bytes, webp_dest, png_dest)
                    extracted[slug] = {
                        "source": str(xp_menu.name),
                        "entry": entry,
                        "webpSize": ws,
                        "pngSize": ps,
                    }
                    print(f"  Extracted {mod_name} {slug}.webp ({ws} B) & {slug}.png ({ps} B)")
                except Exception as exc:
                    print(f"  Failed {entry}: {exc}", file=sys.stderr)

    # 4. Custom loading art inside standalone level RFAs (e.g. Battle of Britain, Caen, Philippines, Agheila)
    custom_levels = [
        ("bf1942/Archives/bf1942/levels/Battle_of_Britain.rfa", "britain_load", "britain_load.tga"),
        ("bf1942/Archives/bf1942/levels/Liberation_of_Caen.rfa", "caen_load", "caen_load.tga"),
        ("bf1942/Archives/bf1942/levels/Invasion_of_the_Philippines.rfa", "philippines_load", "loading_screen.tga"),
        ("XPack2/Archives/bf1942/Levels/Raid_on_Agheila.rfa", "agheila_load", "loading_screen.tga"),
    ]
    for rel_path, slug, target_name in custom_levels:
        lvl_path = game_root / "Mods" / rel_path
        if lvl_path.is_file() and slug not in extracted:
            webp_dest = out_dir / f"{slug}.webp"
            png_dest = out_dir / f"{slug}.png"
            if webp_dest.is_file() and png_dest.is_file():
                extracted[slug] = {
                    "source": str(lvl_path.name),
                    "entry": target_name,
                    "webpSize": webp_dest.stat().st_size,
                    "pngSize": png_dest.stat().st_size,
                }
                continue
            try:
                arch = RfaArchive(lvl_path)
                found = arch.find_all(target_name)
                if found:
                    entry = found[0]
                    tga_bytes = arch.extract(entry)
                    ws, ps = convert_tga_bytes(tga_bytes, webp_dest, png_dest)
                    extracted[slug] = {
                        "source": str(lvl_path.name),
                        "entry": entry,
                        "webpSize": ws,
                        "pngSize": ps,
                    }
                    print(f"  Extracted Level Art {slug}.webp ({ws} B) & {slug}.png ({ps} B)")
            except Exception as exc:
                print(f"  Failed custom level {lvl_path.name}: {exc}", file=sys.stderr)

    # 5. Forgotten Hope (FH) loading art if present
    fh_menu = game_root / "Mods/FH/Archives/menu.rfa"
    if fh_menu.is_file():
        print(f"Reading {fh_menu.relative_to(game_root)}...")
        try:
            arch = RfaArchive(fh_menu)
            for entry in arch.find_all("/load/"):
                if not entry.lower().endswith(".tga"):
                    continue
                filename = Path(entry).stem
                slug = f"fh_{slugify(filename)}"
                if slug in extracted:
                    continue
                webp_dest = out_dir / f"{slug}.webp"
                png_dest = out_dir / f"{slug}.png"
                if webp_dest.is_file() and png_dest.is_file():
                    extracted[slug] = {
                        "source": "FH/menu.rfa",
                        "entry": entry,
                        "webpSize": webp_dest.stat().st_size,
                        "pngSize": png_dest.stat().st_size,
                    }
                    continue
                try:
                    tga_bytes = arch.extract(entry)
                    ws, ps = convert_tga_bytes(tga_bytes, webp_dest, png_dest)
                    extracted[slug] = {
                        "source": "FH/menu.rfa",
                        "entry": entry,
                        "webpSize": ws,
                        "pngSize": ps,
                    }
                except Exception:
                    pass
            print(f"  Processed Forgotten Hope loading screens.")
        except Exception as exc:
            print(f"  FH menu scan skipped: {exc}", file=sys.stderr)

    return extracted


# --------------------------------------------------------------------------- #
# Level Scanning & JSON Mapping Generation
# --------------------------------------------------------------------------- #

SET_LOAD_RE = re.compile(r"game\.setLoadPicture\s+([^\r\n]+)", re.IGNORECASE)


def scan_level_archives(game_root: Path) -> dict[str, str]:
    """Scan all level archives for game.setLoadPicture declaration in init.con."""
    map_loads: dict[str, str] = {}

    level_dirs = [
        game_root / "Mods/bf1942/Archives/bf1942/levels",
        game_root / "Mods/XPack1/Archives/Bf1942/Levels",
        game_root / "Mods/XPack2/Archives/bf1942/Levels",
        game_root / "Mods/DC_Final/Archives/BF1942/levels",
        game_root / "Mods/DesertCombat/Archives/bf1942/levels",
    ]

    for ldir in level_dirs:
        if not ldir.is_dir():
            continue
        for rfa in sorted(ldir.glob("*.rfa")):
            stem = rfa.stem
            # Skip incremental patches (e.g. Wake_003.rfa) for load picture detection
            if "_" in stem and stem.split("_")[-1].isdigit():
                continue
            slug = slugify(stem)
            try:
                arch = RfaArchive(rfa)
                for entry_name in arch.entries:
                    if entry_name.lower().endswith("init.con"):
                        content = arch.extract(entry_name).decode("latin1", errors="replace")
                        match = SET_LOAD_RE.search(content)
                        if match:
                            raw_load = match.group(1).strip()
                            map_loads[slug] = raw_load
                            break
            except Exception as exc:
                print(f"Skip {rfa.name}: {exc}", file=sys.stderr)

    return map_loads


def build_aliases(slug: str, display_name: str) -> list[str]:
    raw_name = display_name.lower()
    items = {
        slug,
        slug.replace("_", " "),
        raw_name,
        re.sub(r"[^a-z0-9]+", "", raw_name),
        re.sub(r"[^a-z0-9]+", "", slug),
    }
    if slug.startswith("dc_"):
        short = slug[3:].replace("_", " ")
        items.add(short)
        items.add(re.sub(r"[^a-z0-9]+", "", short))
    return sorted({a for a in items if a})


def generate_theaters_json(extracted: dict[str, dict], map_loads: dict[str, str], dest_json: Path) -> dict:
    """Generate comprehensive mapTheaters.json static data."""
    theaters_out: dict[str, dict] = {}

    for tkey, tinfo in THEATER_METADATA.items():
        theaters_out[tkey] = {
            "key": tkey,
            "title": tinfo["title"],
            "category": tinfo["category"],
            "image": tinfo["image"],
            "imageUrl": f"/stats/assets/theaters/{tinfo['image']}",
            "pngUrl": f"/stats/assets/theaters/{Path(tinfo['image']).stem}.png",
            "description": tinfo["description"],
        }

    maps_out: dict[str, dict] = {}

    # All registered maps in MAP_LORE
    for slug, lore in MAP_LORE.items():
        tkey = lore["theaterKey"]
        # If the specific art isn't extracted, fall back if specified
        if tkey not in extracted and "fallbackTheaterKey" in lore:
            tkey = lore["fallbackTheaterKey"]

        theater_obj = theaters_out.get(tkey, theaters_out.get("western", {}))
        display_name = lore.get("displayName", slug.replace("_", " ").title())

        entry = {
            "slug": slug,
            "mapName": display_name,
            "theaterKey": tkey,
            "theaterCategory": theater_obj.get("category", "General"),
            "theaterTitle": theater_obj.get("title", display_name),
            "image": theater_obj.get("image", "western.webp"),
            "imageUrl": theater_obj.get("imageUrl", f"/stats/assets/theaters/{theater_obj.get('image', 'western.webp')}"),
            "pngUrl": theater_obj.get("pngUrl", f"/stats/assets/theaters/{Path(theater_obj.get('image', 'western.webp')).stem}.png"),
            "description": lore.get("description", theater_obj.get("description", "")),
            "aliases": build_aliases(slug, display_name),
        }

        if "dcTheaterKey" in lore and lore["dcTheaterKey"] in theaters_out:
            dc_tkey = lore["dcTheaterKey"]
            dc_obj = theaters_out[dc_tkey]
            entry["dcTheaterKey"] = dc_tkey
            entry["dcImageUrl"] = dc_obj["imageUrl"]
            entry["dcTheaterTitle"] = dc_obj["title"]

        if slug in map_loads:
            entry["loadPicture"] = map_loads[slug]

        maps_out[slug] = entry

    data = {
        "version": 1,
        "theaters": theaters_out,
        "maps": maps_out,
    }

    dest_json.parent.mkdir(parents=True, exist_ok=True)
    dest_json.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {dest_json.relative_to(REPO_ROOT)} ({len(theaters_out)} theaters, {len(maps_out)} maps)")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", type=Path, default=DEFAULT_GAME, help="Battlefield 1942 install dir")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="Output directory for WebP/PNG images")
    parser.add_argument("--json", type=Path, default=DEFAULT_JSON, help="Output JSON path for mapTheaters.json")
    args = parser.parse_args()

    if not args.game.is_dir():
        print(f"Error: Game directory not found at {args.game}", file=sys.stderr)
        return 1

    print(f"Extracting theater images to {args.out}...")
    extracted = extract_theaters_from_archives(args.game, args.out)
    print(f"\nScanning level archives in {args.game}...")
    map_loads = scan_level_archives(args.game)
    print(f"Found {len(map_loads)} map load picture configurations.")

    print(f"\nGenerating {args.json}...")
    generate_theaters_json(extracted, map_loads, args.json)

    print("\nExtraction and generation complete!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
