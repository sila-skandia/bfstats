#!/usr/bin/env python3
"""Extract the shared HUD/menu sprite pack the map viewer draws with.

Five artifacts, all one-time and shared by every level of one mod:

  viewer/maps/_shared/hud/*.png + hud.json
      The map sprites and spawn-screen chrome out of
      `Mods/<mod>/Archives/menu.rfa` and its parents': the `conp_<nation>` /
      `baseflag_conp_<nation>` flag markers, the `map_circle` spawn ring,
      the `minimap_icon_*` vehicle-class silhouettes, the vehicle dots, the
      Objective capture-ring frames, the `icon_mapbar_small` bezel, the
      `Ingame/respawn/*` spawn-screen chrome and the kit photographs.
      Decoded to PNG with alpha preserved, at their original pixel sizes —
      they are point art and are never resampled here.

  viewer/maps/_shared/hud/minimap-icons.json
      Which icon each vehicle template carries on the map:
      `ObjectTemplate.setMinimapIcon` / `setMinimapIconSize` scanned out of
      `Objects.rfa` (139 statements over 110 templates in vanilla), keyed by
      the lowercased template name — the same name the level glb gives each
      `spawners` child node. Icon names are the sprite names in `hud.json`
      (directory prefix dropped, extension dropped, lowercased); the engine's
      own strings say `.tga` while the shipped files are `.dds`, so the name
      is normalised rather than trusted.

  viewer/maps/_shared/hud/minimap-level-icons.json
      The same, per level, for the templates a level's own `.con` files
      define or re-icon (Urban Siege's `Nimitz_Static_Heli_UrbS`), where the
      picture is in the menu chain (ledger HUD-13).

  viewer/maps/_shared/hud/soldier-icons.json
      Each soldier template's team art: its control-point, ticket, team-flag,
      minimap and three stance icons, and the nation code they name. The HUD
      draws a side's flags off the soldier the level dresses it in (ledger
      HUD-11, HUD-12, MMAP-4).

  viewer/maps/_shared/hud/scopes.json
      Each hand weapon's optic (`useScope`, `setScopeIcon`, `setSightIcon`,
      `setSniperSight`, SCOPE-2); the pictures they name join the sprites.

`--mod` picks the game. Every archive this reads is resolved along the mod's
`game.addModPath` chain, nearest child first (`bf42.modmenu.MenuSources`), so
Eve of Destruction's NVA control-point flags and Road to Rome's Italian ones
come out of their own `menu.rfa` and everything they do not override still
comes out of vanilla's. With `--mod bf1942` the chain is one archive long and
this reads exactly what it always read.

The sprite list itself comes from `features/authentic-spawn-map/README.md`
section 2, which was verified against the archives on this machine.

The soldier and vehicle in-game HUD pack (health, ammo, heat, reload, medic,
stamina and rocket-pack bars, the ammo panels, the turret-orientation icon,
the weapon bar and hit indicator, the Soldier/Ammo/Weapon/Vehicle icon sets,
and the supply-proximity icon area) is read the same way and lands in the
same `hud.json`, for `extract_hud_layout.py` (`hud-layout.json`) to draw with.
Every manifest entry also carries `ref`: the name the data and the engine
actually spell for it (Title Case, `.tga`) — confirmed against the live
`menu/InGame` graph for the bars and panels below, reconstructed by the same
convention for the bulk Soldier/Ammo/Weapon/Vehicle icon sets. The archive
file is still `.dds` (or, for two Vehicle/ entries, already `.tga`); `source`
keeps the real entry either way.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402
from bf42 import meme  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402
from bf42.level import find_level_archives  # noqa: E402
from bf42.rfa import ArchivePool, RfaArchive, find_archives_dir, find_levels_dir  # noqa: E402

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
from extract_map_images import decode_dds, encode_png  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from extract_hud_assets import decode_tga  # noqa: E402

VIEWER_MAPS_DIR = Path(__file__).resolve().parent / "viewer" / "maps"
VIEWER_HUD_DIR = VIEWER_MAPS_DIR / "_shared" / "hud"


def hud_dir_for(mod_id: str) -> Path:
    """Where a mod's pack lands: vanilla's is the shared one every page falls
    back to, a mod's sits inside its own level tree beside `maps.json`."""
    if mod_id == "bf1942":
        return VIEWER_HUD_DIR
    return VIEWER_MAPS_DIR / "mods" / mod_id / "_shared" / "hud"

# Everything the viewer draws, as archive paths under `menu/`. Output name is
# the lowercased basename with the extension swapped for `.png`.
NATIONS = ("us", "ger", "brit", "can", "jp", "rus")
SPRITES: list[str] = [
    # Control point flags: capturable, the neutral state, and the red-ringed
    # uncapturable main bases.
    *[f"Texture/conp_{n}" for n in (*NATIONS, "neutral")],
    *[f"Texture/baseflag_conp_{n}" for n in NATIONS],
    # Map markers.
    "Texture/Minimap/map_circle",
    "Texture/Minimap/map_dot",
    "Texture/Minimap/minimap_icon_ring_32x32",
    # Vehicle-class silhouettes (`destoyer` misspelling is the shipped name).
    *[f"Texture/Minimap/minimap_icon_{k}_16x16"
      for k in ("soldier", "tank", "apc", "plane", "common", "stationary")],
    "Texture/Minimap/minimap_icon_PT_Boat",
    "Texture/Minimap/minimap_icon_destoyer_32x32",
    "Texture/Minimap/minimap_icon_submarine_32x32",
    "Texture/Minimap/minimap_icon_battleship_64x64",
    "Texture/Minimap/minimap_icon_aircraft_carrier_64x64",
    # Vehicle dots.
    *[f"Texture/icon_vehicledot_{k}" for k in ("friend", "enemy", "empty", "local")],
    # The nine-frame capture-progress ring.
    *[f"Texture/Minimap/Objectives/Objective{f}"
      for f in ("000", "012", "025", "037", "050", "062", "075", "087", "100")],
    # HUD minimap bezel and the flag-status bar segments.
    "Texture/Minimap/icon_mapbar_small",
    *[f"Texture/Ingame/cpbar/cpbar_{k}_cp_16x8" for k in ("blue", "red", "gray")],
    # Spawn-screen chrome.
    *[f"Texture/Ingame/respawn/ingame_respawn_kits_{k}_256x128"
      for k in ("top", "middle", "bottom")],
    *[f"Texture/Ingame/respawn/ingame_respawn_kits_tab{k}_256x32"
      for k in ("", "2", "3")],
    "Texture/Ingame/respawn/ingame_respawn_long_512x64",
    "Texture/Ingame/respawn/ingame_respawn_small_256x64",
    # Kit photographs, both sides plus the theatre variants that exist.
    *[f"Texture/Kits/icon_{role}_{side}_selected"
      for role in ("scout", "assault", "antitank", "medic", "engineer")
      for side in ("allies", "axis")],
    "Texture/Kits/Icon_assault_jap_selected",
    "Texture/Kits/Icon_assault_russian_selected",
    "Texture/Kits/icon_assault_canadian_selected",
    "Texture/Kits/icon_engineer_jap_selected",
    "Texture/Kits/icon_engineer_usmarines_selected",
    # Team-header flags for the kit column.
    *[f"Texture/icon_flag_{n}" for n in NATIONS],
    # The rest of what `menu/InGame` draws on the spawn screen (see
    # extract_spawn_layout.py): the footer button plates at rest and under
    # the pointer, the class glyph in each kit row's header, and the ticket
    # counter's bar and flags.
    *[f"Texture/Menu/knapp{k}" for k in ("ext_n", "ext_mo", "3_n", "3_mo")],
    *[f"Texture/Debriefing/classes/class_{k}_16x16"
      for k in ("scout", "assault", "at", "medic", "engineer")],
    # The end of a round (`round-end.js`, ledger ROUND-8/ROUND-9): the
    # multiplayer debriefing plate `menu/LoadMenu` draws and `giveMedal`'s
    # three medals per side, the 8x8 row marks and the 32x32 ones, with the
    # empty slot. (The `*_win_camp` / `*_lose_camp` pictures beside them are
    # the single-player campaign's.)
    "Texture/Debriefing/MP_debriefing_512x512",
    *[f"Texture/Debriefing/medals/{side}_{size}{metal}_{px}"
      for side in ("allied", "axis") for metal in ("gold", "silver", "bronze")
      for size, px in (("", "8x8"), ("xl_", "32x32"))],
    "Texture/Debriefing/medals/empty_8x8",
    "Texture/icon_ticketbar",
    *[f"Texture/flag_ticket_{n}" for n in NATIONS],
    # The text-message plates. The 3-line one is the combat-area warning's
    # own backdrop (menu/InGame's `Outside/OutsideTime` group); the 1- and
    # 2-line ones back the spawn-point and status messages that share the
    # same widget family, so the whole set comes across together.
    *[f"Texture/Ingame/text-mess/textmessBG_{k}"
      for k in ("1line_256x32", "2line_256x32", "3line_256x64")],
    # --- in-game HUD: soldier and vehicle health, ammo, heat, reload, medic,
    # stamina and rocket-pack bars; the two ammo-panel backdrops; the turret
    # orientation icon; the weapon bar (see extract_hud_layout.py). Casing
    # matches what `menu/InGame` itself spells (e.g.
    # `Ingame/Healthbar_empty_scout_64x64.tga`); the archive's own listing is
    # lower-case throughout, and lookup below is case-insensitive either way.
    *[f"Texture/Ingame/Healthbar_empty_{k}_64x64" for k in ("assault", "at", "engineer", "medic", "scout")],
    *[f"Texture/Ingame/Healthbar_full_{k}_64x64" for k in ("assault", "at", "engineer", "medic", "scout")],
    "Texture/Ingame/Healthbar_empty_32x64",
    "Texture/Ingame/Vehicle_healthbar_empty_32x64",
    "Texture/Ingame/Vehicle_healthbar_full_32x64",
    "Texture/Ingame/Ammobar_empty_32x64",
    "Texture/Ingame/Ammobar_full_32x64",
    "Texture/Ingame/Ammobar_soldier_panel_64x64",
    "Texture/Ingame/Ammobar_vehicle_panel_64x64",
    *[f"Texture/Ingame/Magbar_{k}_empty_32x64" for k in ("Bar", "Pistol", "Rifle", "SG44", "SMG")],
    *[f"Texture/Ingame/Magbar_{k}_full_32x64" for k in ("Bar", "Pistol", "Rifle", "SG44", "SMG")],
    "Texture/Ingame/Heatbar_empty_32x64",
    "Texture/Ingame/Heatbar_full_32x64",
    "Texture/Ingame/ReloadTimebar_empty_32x64",
    "Texture/Ingame/ReloadTimebar_full_32x64",
    "Texture/Ingame/Medicbar_empty_32x64",
    "Texture/Ingame/Medicbar_full_32x64",
    "Texture/Ingame/Staminabar_empty_64x32",
    "Texture/Ingame/Staminabar_full_64x32",
    "Texture/Ingame/Rocketpackbar_full_32x64",
    "Texture/Ingame/Icon_tank_turn_back_64x64",
    "Texture/Ingame/Icon_tank_turn_body_32x32",
    "Texture/Ingame/Icon_tank_turn_pipe_16x32",
    "Texture/Ingame/Icon_server_msg_16x16",
    # The root copies — `menu/InGame` names both with no directory at all
    # (`Picture='ingame_weaponbar_512x64.tga'`), which resolves to
    # `menu/Texture/`, not the near-identical `menu/Texture/Ingame/` copy of
    # the weapon bar (a genuine duplicate file; kept out to avoid a
    # basename collision with this one).
    "Texture/ingame_weaponbar_512x64",
    "Texture/ingame_hit_indicator_64x128",
    # The supply/proximity icon area of `menu/InGame` (`ShowFlagIcon`,
    # `ShowNonTakeableFlagIcon`, `ShowHealIcon`, `ShowRepairIcon`,
    # `ShowReloadIcon`, `ShowMineIcon`, `ShowParachute`, and the CTF
    # team-flag icon) — all live directly under `menu/Texture/`, no
    # subfolder. `icon_flag_us`/`icon_flag_ger` (the CTF flag defaults) are
    # the same files the team-header flags above already pull in.
    "Texture/Icon_flag",
    "Texture/Icon_non_takeable_flag",
    "Texture/Icon_heal",
    "Texture/Icon_repair",
    "Texture/Icon_reload",
    "Texture/Icon_mine",
    "Texture/parachute",
    "Texture/Icon_CTF",
    # The crosshair (`CrossHair/*`): hud-layout.json's crosshair group names
    # these defaults, so the pack needs them too or the references dangle.
    "Texture/hk",
    "Texture/sniper",
    "Texture/scout_ring_128x128",
    # The vehicle-seats panel's backdrop (`Vehicle/VehiclePlayers/*`).
    "Texture/ToolTip/vehicle_position_256x128",
]

# Whole directories the soldier and vehicle HUD draw from, taken
# unconditionally rather than as a hand-picked subset that could drift from
# the archive: every stance icon and every ammo/weapon/vehicle HUD icon the
# base game ships (15/30/48/21 entries respectively, checked on this
# machine), and every kit photograph under `Kits/` -- vanilla's 15 sit at its
# root and are already named individually in `SPRITES` above (for their
# verified `ref`); a mod's own are typically nested one level deeper, one
# subdirectory per nation (`Kits/NVA/assault_selected.dds`), so this walks
# the whole subtree rather than the single level the other three need.
# `extract_sprites` skips any entry this glob would re-name identically to
# something `SPRITES` already wrote, so the two never fight over `ref`.
SPRITE_DIR_GLOBS: list[str] = ["Texture/Soldier", "Texture/Ammo", "Texture/Weapon",
                               "Texture/Vehicle", "Texture/Kits"]

# Nation art beyond the six `NATIONS` names. `SPRITES` lists the nations the
# base game ships, because they are the ones the base game's levels fly; a mod
# brings its own, and files them under the same four prefixes directly beneath
# `menu/Texture/`. Road to Rome adds France and Italy (8 files); Eve of
# Destruction adds those plus a separate Soviet set (12).
#
# Globbing the prefixes rather than extending a hardcoded nation list means a
# mod's nations arrive without this file ever learning their names. On vanilla
# the glob finds exactly the files `SPRITES` already named — checked: no
# `conp_*`, `baseflag_conp_*`, `icon_flag_*` or `flag_ticket_*` sits at the
# root of vanilla's `menu/Texture/` that is not in the list above — so it adds
# nothing and the vanilla manifest is unchanged, key for key and in order.
SPRITE_NATION_PREFIXES: tuple[str, ...] = (
    "conp_", "baseflag_conp_", "icon_flag_", "flag_ticket_")

# A mod's own vehicle silhouettes. `SPRITES` names the twelve the base game
# ships, and a mod files its own beside them, directly under
# `menu/Texture/Minimap/`, with the same prefix: Desert Combat adds 16
# (`minimap_icon_heli1_16x16`, `_plane3_`, `_nimitz_64x64`, `_none`, ...), DC
# Final about 60 per-vehicle ones (`minimap_icon_m1a1_16x16`, `_uh60_`, ...),
# Secret Weapons 7, Eve of Destruction 9. Each mod's `Objects.rfa` names them
# (`minimap-icons.json`) whether or not the pack holds them, so without this a
# template naming one drew the vehicle dot (`map-surfaces.js`). The root of
# the directory only, and the prefix only: vanilla's `Minimap/` also holds
# `map_engineer`, `map_medic` and the artillery camera view, which no minimap
# icon names, and on vanilla every `minimap_icon_*` file is already in
# `SPRITES`, so its manifest is unchanged.
MINIMAP_ICON_DIR = "menu/texture/minimap/"
MINIMAP_ICON_PREFIX = "minimap_icon_"

# `Ammo/Icon_demokit.dds` (the HUD ammo-panel icon a weapon's `setAmmoIcon`
# can point at) and `Weapon/Icon_demokit.dds` (the weapon-select bar icon a
# kit's `addWeaponIcon` can point at) are two different images (2176 vs 4224
# bytes, different sha1) that happen to share a basename — the one collision
# among the ~260 sprites this script extracts from vanilla, found by hashing
# every file under the four directories above. Every other entry is keyed by
# lowercased basename alone, matching the sprites above; these two are the
# sole vanilla exception, qualified by their source directory so neither is
# lost.
#
# It is the *rule* that is applied, not this pair, because a mod brings its
# own: Eve of Destruction files a `Molotov.dds` under both `Ammo/` and
# `Weapon/` (also `Vietcong_Juicegrenade.dds` and `Vietcong_Satchel.dds`, the
# same way), and its 87 kit photographs collide by the dozen across nine-odd
# nation subdirectories of `Kits/` (`assault_selected.dds` alone under `NVA/`,
# `ARVN/`, `Vietcong/`, ...). `dir_glob_renames` recomputes the set per chain,
# qualifying by each colliding file's own immediate parent directory rather
# than a directory named in `SPRITE_DIR_GLOBS` — for the flat `Ammo`/`Weapon`
# case those are the same name, which is why this reproduces exactly the two
# rows below on vanilla — asserted in `tests/test_extract_hud_pack.py`.
#
# Known limitation, unchanged by this: `hud.js`'s `spriteKeyFromRef` resolves
# a live texture path by basename, so a qualified sprite is reachable only by
# its qualified name. `viewer/kit-icon.js` is where the kit photographs' own
# resolver tries the qualified name first; nothing else that reads a live
# path does yet, so whoever wires the ammo panel's icon still has to key on
# the source directory too.
SPRITE_DIR_RENAME: dict[str, str] = {
    "menu/texture/ammo/icon_demokit.dds": "ammo_icon_demokit",
    "menu/texture/weapon/icon_demokit.dds": "weapon_icon_demokit",
}


def dir_glob_renames(entries) -> dict[str, str]:
    """Lowered entry name -> qualified sprite name, for every basename that
    `SPRITE_DIR_GLOBS` would otherwise file twice.

    One archive's `Ammo/X` and another's `Weapon/X` are two different images
    under one key, which would silently clobber one of them; qualifying both
    with their own immediate parent directory keeps both. The same rule
    reaches a level deeper for `Kits/<Nation>/X`, where the collision is
    between nation subdirectories rather than between two of
    `SPRITE_DIR_GLOBS`'s own top-level names — `Ammo` and `Weapon` have no
    subdirectories of their own in any installed archive, so using the
    immediate parent rather than the glob's top-level name changes nothing
    for them. A basename that occurs under only one directory, at any depth,
    is untouched.
    """
    low_prefixes = tuple(f"menu/{prefix}/".lower() for prefix in SPRITE_DIR_GLOBS)
    seen: dict[str, list[tuple[str, str]]] = {}
    for entry in entries:
        low = entry.lower()
        if not low.startswith(low_prefixes):
            continue
        leaf = Path(entry).parent.name.lower()
        seen.setdefault(Path(entry).stem.lower(), []).append((leaf, entry))
    out: dict[str, str] = {}
    for name, hits in seen.items():
        if len({leaf for leaf, _ in hits}) < 2:
            continue
        for leaf, entry in hits:
            out[entry.lower()] = f"{leaf}_{name}"
    return out

# `flag(us|ge|uk|Jp|so|can)_m1` in a control point's `flagMesh` names the flag
# cloth the level hoists there; the map sprite set uses different codes.
# Recorded in the manifest so the viewer and this script cannot drift apart.
FLAG_MESH_NATION = {
    "us": "us", "ge": "ger", "uk": "brit", "jp": "jp", "so": "rus", "can": "can",
}

# Flag-mesh codes the mod levels fly that the table above does not hold, each
# matched to the nation art the mod's own `menu.rfa` ships. Counted over every
# `controlPoints[].flagMesh` in the extracted level trees:
#
#   flagfr_m1   Road to Rome 2, Eve of Destruction 13   -> conp_fre
#   flagit_m1   Road to Rome 10                         -> conp_it
#   flagpl_m1   Eve of Destruction 11                   -> no `conp_pl` in any
#               installed menu.rfa, so it stays unmapped and the viewer falls
#               back the way it already does for a code it does not know.
#
# A row is only merged in when the art it names is actually in this mod's
# layered archives, so vanilla's table comes out exactly as it is above.
MOD_FLAG_MESH_NATION = {"fr": "fre", "it": "it"}


def flag_mesh_nations(sprites: dict) -> dict[str, str]:
    """`FLAG_MESH_NATION`, corrected and extended for this pack's own art.

    Two passes, in this order:

    1. A code whose *own* art the pack ships stops going through an alias.
       Vanilla maps `so` to `rus` because it has no `conp_so`; Eve of
       Destruction ships the whole `so` set, so `flagso_m1` resolves to it
       there. (EoD's `conp_so` and `conp_rus` are the same file -- both the
       Australian flag, which is what `AustralianForces` flies on its 16
       `flagso_m1` control points -- so the control-point marker is unchanged
       either way and only the base flag and the ticket flag, which do
       differ, get the faithful one.)
    2. A code not in the table at all takes its `MOD_FLAG_MESH_NATION` row,
       if the art that row names is in the pack.

    Vanilla ships neither `conp_so`, `conp_fre` nor `conp_it`, so neither
    pass fires and its table comes out exactly as written above.
    """
    table = dict(FLAG_MESH_NATION)
    for code, nation in list(table.items()):
        if nation != code and f"conp_{code}" in sprites:
            table[code] = code
    for code, nation in MOD_FLAG_MESH_NATION.items():
        if code not in table and f"conp_{nation}" in sprites:
            table[code] = nation
    return table


# The one regex `viewer/nation.js`'s `flagMeshNation` also runs, so a
# control point's flag mesh resolves to the same nation code whether it is
# read here (`extract_menu_layout.py`, writing `menu-levels.json`) or in the
# browser (`map.html`, live off the level's own scene). Both read the same
# `nations` table too -- this pack's own `hud.json['flagMeshNation']`, from
# `flag_mesh_nations` above -- so there is exactly one place a code can be
# added and both sides pick it up without being told twice.
_FLAG_MESH_RE = re.compile(r"^flag([a-z]+)_", re.IGNORECASE)


def flag_mesh_nation(flag_mesh: str | None, nations: dict[str, str]) -> str | None:
    """`flagus_m1` -> `us` through `nations`. `None` for a mesh the table has
    never heard of -- Pathet Lao's `flagpl_m1`, which no installed `menu.rfa`
    ships a `conp_pl` for -- rather than a guess: the caller decides what an
    unmapped mesh means (`extract_menu_layout.py` falls back to the team's
    soldier skin; `viewer/nation.js`'s `cpNation` answers `'unknown'`)."""
    if not flag_mesh:
        return None
    m = _FLAG_MESH_RE.match(flag_mesh)
    return nations.get(m.group(1).lower()) if m else None


def sprite_ref(stem: str) -> str:
    """The name `menu/InGame` and the `.con` data actually spell for a sprite
    named by stem in `SPRITES` — `Texture/` dropped (both name textures
    relative to `menu/Texture/`) and `.tga` restored."""
    return stem.removeprefix("Texture/") + ".tga"


def sprite_ref_from_entry(entry: str) -> str:
    """The same, for a sprite pulled in wholesale from one of
    `SPRITE_DIR_GLOBS` — real archive casing kept, since these were not
    individually cross-checked against the graph or the `.con` data the way
    the sprites named in `SPRITES` were."""
    prefix = "menu/texture/"
    rel = entry[len(prefix):] if entry.lower().startswith(prefix) else entry
    return rel.rsplit(".", 1)[0] + ".tga"


def select_button_plates(menu) -> list[str]:
    """The plates the mod's `menu/InGame` hands its `BfSelectButtonNode`s,
    as `SPRITES`-style stems (`Texture/Ingame/respawn/respawn_middle_256x128`).

    Desert Combat draws its six kit rows with that class instead of
    vanilla's fill-and-glyph rows, and each names three plates of its own
    (at rest, under the pointer, selected) that no vanilla screen uses.
    Read from the graph rather than listed, so a chain whose `menu/InGame`
    has no such node -- every one but Desert Combat's and DC Final's, which
    inherits it -- takes nothing here: Pirates ships the same three files
    and never draws them.
    """
    entry = next((e for e in menu.entries if e.lower() == "menu/ingame"), None)
    if entry is None:
        return []
    root, _ = meme.load(menu.read(entry))
    stems: list[str] = []
    for node in meme.walk_all(root):
        if node.cls != "BfSelectButtonNode":
            continue
        for label in ("Picture", "Mouse over picture", "Clicked picture"):
            picture = (node.get(label) or "").replace("\\", "/")
            stem = "Texture/" + picture.rsplit(".", 1)[0]
            if picture and stem not in stems:
                stems.append(stem)
    return stems


def extract_sprites(menu, out_dir: Path, force: bool,
                    referenced: list[str] | tuple[str, ...] = ()) -> dict:
    """Decode the sprite list to PNGs, returning the manifest dict.

    `menu` is the mod's layered `menu.rfa` view (`MenuSources.open_menu`).
    With a one-mod chain that is the single archive, entry for entry and in
    its own order, which is what keeps the vanilla manifest unchanged.

    `referenced` is texture names the `.con` data hands the HUD by name, as
    it spells them (`"m25_scope.tga"`, `"scope_blank"`): the weapons'
    `setScopeIcon`/`setSightIcon` (`extract_scope_map`). The engine resolves
    each under `menu/Texture/` (the loader at 0x00664aa0 prefixes
    `Menu/Texture/`, string 0x00914864), so that is the only place looked;
    one no archive in the chain holds is skipped. They come last, so every
    sprite already named keeps its place and its `ref`.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}
    # Casing varies and the declared extension cannot be trusted, so resolve
    # both against the real entry table.
    index = {e.lower(): e for e in menu.entries}

    def decode_and_write(name: str, entry: str, ref: str) -> None:
        existing = manifest.get(name)
        if existing is not None and existing["source"] != entry:
            # A silent basename collision would clobber one sprite with
            # another under the same key; SPRITE_DIR_RENAME is the only
            # place that is expected to happen, and it never reuses a
            # name -- so reaching this for any name means a new,
            # unhandled collision has shown up (a mod, or a future
            # archive update) and needs a rename of its own.
            sys.exit(f"sprite name collision: {name!r} is both "
                     f"{existing['source']!r} and {entry!r}")
        dest = out_dir / f"{name}.png"
        raw = menu.read(entry)
        if entry.lower().endswith(".dds"):
            width, height, rgba = decode_dds(raw)
        else:
            width, height, rgba = decode_tga(raw)
        if force or not dest.exists():
            # `drop_alpha` defaults True in the shared encoder (map art is
            # opaque); these are cut-out sprites, so the alpha is the point.
            dest.write_bytes(encode_png(width, height, rgba, drop_alpha=False))
        manifest[name] = {
            "file": f"{name}.png",
            "size": [width, height],
            "source": entry,
            "ref": ref,
        }

    missing: list[str] = []
    for stem in SPRITES:
        entry = None
        for ext in (".dds", ".tga"):
            entry = index.get(f"menu/{stem}{ext}".lower())
            if entry:
                break
        if not entry:
            missing.append(stem)
            continue
        decode_and_write(Path(stem).name.lower(), entry, sprite_ref(stem))

    for stem in select_button_plates(menu):
        if Path(stem).name.lower() in manifest:
            continue
        entry = next((index[k] for k in (f"menu/{stem}.dds".lower(),
                                          f"menu/{stem}.tga".lower()) if k in index), None)
        if not entry:
            missing.append(stem)
            continue
        decode_and_write(Path(stem).name.lower(), entry, sprite_ref(stem))

    # The mod's own nations, if it has any beyond the ones `SPRITES` names.
    # The root of `menu/Texture/` only -- these four prefixes are the whole of
    # the per-nation art, and nothing under a subdirectory shares them.
    root = "menu/texture/"
    for entry in menu.entries:
        low = entry.lower()
        if not low.startswith(root) or "/" in entry[len(root):]:
            continue
        if not low.endswith((".dds", ".tga")):
            # Mods ship editor droppings in these directories (Pirates and
            # interstate carry `Thumbs.db`, FinnWars an `.xcf` and a stray
            # `.png`); nothing references them and no decoder reads them.
            continue
        name = Path(entry).stem.lower()
        if name in manifest or not name.startswith(SPRITE_NATION_PREFIXES):
            continue
        decode_and_write(name, entry, sprite_ref_from_entry(entry))

    renames = dir_glob_renames(menu.entries)
    for prefix in SPRITE_DIR_GLOBS:
        low_prefix = f"menu/{prefix}/".lower()
        for entry in menu.entries:
            if not entry.lower().startswith(low_prefix):
                continue
            if not entry.lower().endswith((".dds", ".tga")):
                # Same editor droppings as the nation loop above: `Thumbs.db`
                # in four of these directories in Pirates/interstate/FinnWars.
                continue
            name = renames.get(entry.lower(), Path(entry).stem.lower())
            if name in manifest:
                # Vanilla's 15 root `Kits/` photographs are both named
                # individually in `SPRITES` (for their verified `ref`) and
                # swept up again here (`Texture/Kits` is one of
                # `SPRITE_DIR_GLOBS`, walked whole); the `SPRITES` pass above
                # always runs first, so this is that one entry reached a
                # second time under the same, unqualified name, and must not
                # clobber the `ref` already recorded for it.
                continue
            decode_and_write(name, entry, sprite_ref_from_entry(entry))

    for entry in menu.entries:
        low = entry.lower()
        if not low.startswith(MINIMAP_ICON_DIR) or "/" in entry[len(MINIMAP_ICON_DIR):]:
            continue
        if not low.endswith((".dds", ".tga")):
            continue
        name = Path(entry).stem.lower()
        if name in manifest or not name.startswith(MINIMAP_ICON_PREFIX):
            continue
        decode_and_write(name, entry, sprite_ref_from_entry(entry))

    for ref in referenced:
        stem = ref.replace("\\", "/").strip("/")
        if stem.lower().endswith((".dds", ".tga")):
            stem = stem.rsplit(".", 1)[0]
        name = Path(stem).name.lower()
        if not stem or name in manifest:
            continue
        entry = next((index[k] for k in (f"menu/texture/{stem}.dds".lower(),
                                          f"menu/texture/{stem}.tga".lower())
                      if k in index), None)
        if entry:
            decode_and_write(name, entry, sprite_ref_from_entry(entry))

    if missing:
        print(f"warning: {len(missing)} sprites not in the "
              f"{'/'.join(menu.labels)} menu chain: {', '.join(missing)}",
              file=sys.stderr)
    return manifest


_CREATE = re.compile(r"(?i)^ObjectTemplate\.(?:create\s+\S+|active)\s+(\S+)")
_ICON = re.compile(r'(?i)^ObjectTemplate\.setMinimapIcon\s+"?([^"\s]+)"?')
_SIZE = re.compile(r"(?i)^ObjectTemplate\.setMinimapIconSize\s+(\d+)")


def icon_key(path: str) -> str:
    """`"Minimap/minimap_icon_tank_16x16.tga"` -> `minimap_icon_tank_16x16`,
    the name the sprite pack files it under."""
    leaf = path.replace("\\", "/").rsplit("/", 1)[-1]
    return leaf.rsplit(".", 1)[0].lower()


def objects_con_texts(chain: list[Path]):
    """Every `.con` file of the chain's `Objects.rfa`, decoded, nearest mod's
    copy of a path first-hit (`ArchivePool`)."""
    pool = ArchivePool()
    found = False
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        if archives is None:
            continue
        pool.add_dir(archives, ("objects",))
        found = True
    if not found:
        sys.exit(f"no Archives directory anywhere in "
                 f"{[d.name for d in chain]}")
    for entry in pool.names():
        if not entry.lower().endswith(".con"):
            continue
        text = pool.try_read(entry)
        if text is not None:
            yield text.decode("latin-1", "replace")


def minimap_icons_in(texts) -> dict[str, dict]:
    """template (lowercased) -> {icon, size} over `.con` texts, in order."""
    templates: dict[str, dict] = {}
    for text in texts:
        current: str | None = None
        for line in text.splitlines():
            line = line.strip()
            if m := _CREATE.match(line):
                current = m.group(1).lower()
            elif (m := _ICON.match(line)) and current:
                templates.setdefault(current, {})["icon"] = icon_key(m.group(1))
            elif (m := _SIZE.match(line)) and current:
                templates.setdefault(current, {})["size"] = int(m.group(1))
    # A size with no icon declares nothing drawable; drop the strays.
    return {k: v for k, v in sorted(templates.items()) if "icon" in v}


def extract_icon_map(chain: list[Path]) -> dict[str, dict]:
    """template (lowercased) -> {icon, size} from every Objects archive.

    `size` is the engine's `setMinimapIconSize` draw size in pixels where one
    is declared (the 32/64 px ship icons), and absent otherwise — the default
    is the sprite's own 16 px.

    `chain` is the mod path, nearest first, so a mod's own `Objects.rfa` both
    adds its templates and overrides the vanilla ones it redefines — the same
    first-hit rule `ArchivePool` applies everywhere else.
    """
    return minimap_icons_in(objects_con_texts(chain))


def template_words(texts, words: dict[str, str]) -> dict[str, dict[str, str]]:
    """template (lowercased) -> {key: value} for each `ObjectTemplate.<word>`
    in `words` (lowercased word -> output key), the value as the data spells
    it with its quotes dropped. Last declaration wins, the way a `.con` run
    overwrites a property."""
    pattern = re.compile(
        r'(?i)^ObjectTemplate\.(' + "|".join(map(re.escape, words)) +
        r')\s+"?([^"\s]+)"?')
    templates: dict[str, dict[str, str]] = {}
    for text in texts:
        current: str | None = None
        for line in text.splitlines():
            line = line.strip()
            if m := _CREATE.match(line):
                current = m.group(1).lower()
            elif (m := pattern.match(line)) and current:
                templates.setdefault(current, {})[words[m.group(1).lower()]] = m.group(2)
    return dict(sorted(templates.items()))


# The soldier template's own team art, as `BFSoldierTemplate` stores it
# (property ctors 0x004cb877.., getters on its vtable: standing +0xa0, crouch
# +0xa8, prone +0xb0, controlPoint +0xb8, minimap +0xc0, ticket +0xc8,
# teamFlag +0xd0 in the client; lnxded's `BFSoldierTemplate::get*Icon` in the
# same order). The client reads them back per team off the template
# `Game::getTeamSkin(team)` names (0x006ac800, ledger HUD rows), and the
# stance icon off the local soldier's own template (0x006ad639).
SOLDIER_ICON_WORDS = {
    "setsoldierstandingicon": "standing",
    "setsoldiercrouchicon": "crouch",
    "setsoldierproneicon": "prone",
    "setcontrolpointicon": "controlPoint",
    "setminimapicon": "minimap",
    "setticketicon": "ticket",
    "setteamflagicon": "teamFlag",
}
_NATION_ICON = re.compile(r"(?i)^(?:conp_|flag_ticket_|icon_flag_)([a-z]+)$")


def icon_nation(icon: str | None) -> str | None:
    """`conp_ger.tga` / `flag_ticket_ger.tga` / `Icon_flag_ger.tga` -> `ger`,
    the nation code every per-nation sprite name in the pack is built on."""
    if not icon:
        return None
    m = _NATION_ICON.match(icon_key(icon))
    return m.group(1).lower() if m else None


def soldier_icons_in(texts) -> dict[str, dict]:
    """soldier template (lowercased) -> its team art, for every template
    that declares any of the three team icons. `nation` is the code the
    control-point icon names (else the ticket's, else the team flag's), the
    one the page builds `conp_`/`baseflag_conp_`/`flag_ticket_`/`icon_flag_`
    sprite names from; every soldier in vanilla, Road to Rome, Secret
    Weapons, Desert Combat and DC Final names one code across all three."""
    out: dict[str, dict] = {}
    for name, found in template_words(texts, SOLDIER_ICON_WORDS).items():
        if not {"controlPoint", "ticket", "teamFlag"} & set(found):
            continue
        entry = dict(found)
        nation = (icon_nation(found.get("controlPoint"))
                  or icon_nation(found.get("ticket"))
                  or icon_nation(found.get("teamFlag")))
        if nation:
            entry["nation"] = nation
        out[name] = entry
    return out


def extract_soldier_icons(chain: list[Path]) -> dict[str, dict]:
    return soldier_icons_in(objects_con_texts(chain))


# A hand weapon's optic, SCOPE-2: the four words the HUD sync (0x006e9dd0)
# copies into the `CrossHair` group.
SCOPE_WORDS = {
    "usescope": "useScope",
    "setscopeicon": "scopeIcon",
    "setsighticon": "sightIcon",
    "setsnipersight": "sniperSight",
}


def scope_map_in(texts) -> dict[str, dict]:
    """weapon template (lowercased) -> {useScope, scopeIcon, sightIcon,
    sniperSight}, for every template that names a scope or sight picture.
    The flags are booleans, the pictures as the data spells them."""
    out: dict[str, dict] = {}
    for name, found in template_words(texts, SCOPE_WORDS).items():
        if "scopeIcon" not in found and "sightIcon" not in found:
            continue
        entry: dict = {}
        for key in ("useScope", "sniperSight"):
            if key in found:
                entry[key] = found[key].strip() not in ("0", "")
        for key in ("scopeIcon", "sightIcon"):
            if key in found:
                entry[key] = found[key].replace("\\", "/")
        out[name] = entry
    return out


def extract_scope_map(chain: list[Path]) -> dict[str, dict]:
    return scope_map_in(objects_con_texts(chain))


def scope_textures(scopes: dict[str, dict]) -> list[str]:
    """The pictures `scopes` names, once each, in template order."""
    seen: dict[str, None] = {}
    for entry in scopes.values():
        for key in ("scopeIcon", "sightIcon"):
            if entry.get(key):
                seen.setdefault(entry[key], None)
    return list(seen)


def chain_level_names(chain: list[Path]) -> list[str]:
    """Every level the chain's `Archives/bf1942/levels/` hold, by the name
    its base archive spells, patches (`_000`, `_003`) folded in."""
    names: dict[str, str] = {}
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        levels = find_levels_dir(archives) if archives is not None else None
        if levels is None:
            continue
        for child in sorted(levels.iterdir(), key=lambda p: p.name.lower()):
            if not child.is_file() or child.suffix.lower() != ".rfa":
                continue
            stem = re.sub(r"_\d+$", "", child.stem)
            names.setdefault(stem.lower(), stem)
    return sorted(names.values(), key=str.lower)


def level_con_texts(paths: list[Path]):
    """The `.con` files of one level's archives, a later archive's copy of a
    path replacing an earlier one's (`find_level_archives` overlay order)."""
    files: dict[str, tuple[Path, str]] = {}
    for path in paths:
        with RfaArchive(path) as arch:
            for entry in arch.entries:
                if entry.lower().endswith(".con"):
                    files[entry.replace("\\", "/").lower()] = (path, entry)
    by_archive: dict[Path, list[str]] = {}
    for path, entry in files.values():
        by_archive.setdefault(path, []).append(entry)
    for path, entries in by_archive.items():
        with RfaArchive(path) as arch:
            for entry in sorted(entries):
                yield arch.read(entry).decode("latin-1", "replace")


def extract_level_icon_map(game_dir: Path, chain: list[Path],
                           global_icons: dict[str, dict],
                           sprites: dict) -> dict[str, dict]:
    """level (lowercased) -> {template: {icon, size}} for the minimap icons a
    level's own `.con` files declare that `Objects.rfa` does not already
    give the same template: Urban Siege's `Nimitz_Static_Heli_UrbS`, Al
    Nas's `nx_m-923`. Per level, because two levels give one template name
    different icons (`mil_wpbunker_des`: No Fly Zone's building, Weapon
    Bunkers' bunker).

    Only icons whose picture is in this pack's own sprites are kept. The
    engine opens an icon under `Menu/Texture/` (0x00664aa0), and the ones
    that are not there -- DC's `bf1942/levels/DC_No_Fly_Zone/menu/Tower.dds`,
    vanilla Battle of Britain's `minimap_icon_Factory_32x32` that its level
    archive files under its own `Menu/Texture/` -- need either a path the
    loader does not build or a per-level search root nobody has read out of
    the binary; they stay the vehicle dot until that is settled."""
    out: dict[str, dict] = {}
    mod = chain[0].name if chain else "bf1942"
    for level in chain_level_names(chain):
        paths = find_level_archives(game_dir, mod, level, chain=chain)
        if not paths:
            continue
        try:
            found = minimap_icons_in(level_con_texts(paths))
        except (OSError, ValueError, struct.error) as exc:
            # Six FHSW/FHSW Europe level archives on this PC are truncated
            # (skill `bf1942-mod-extraction` section 12); a level the reader
            # cannot open loses its own icons, not the whole pack.
            print(f"warning: {level}: level archives unreadable ({exc}); "
                  f"its own minimap icons are left out", file=sys.stderr)
            continue
        own = {template: entry for template, entry in found.items()
               if entry["icon"] in sprites and global_icons.get(template) != entry}
        if own:
            out[level.lower()] = own
    return dict(sorted(out.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR,
                        help=f"BF1942 install (default: {DEFAULT_GAME_DIR})")
    parser.add_argument("--mod", default="bf1942",
                        help="mod whose menu chain to read (default: bf1942)")
    parser.add_argument("--out", type=Path, default=None,
                        help="output directory (default: the mod's own pack "
                             f"dir, {VIEWER_HUD_DIR} for vanilla)")
    parser.add_argument("--force", action="store_true",
                        help="re-encode PNGs that already exist")
    args = parser.parse_args()

    game_dir = args.game_dir.expanduser()
    sources = MenuSources(mod_chain(game_dir, args.mod))
    out = args.out or hud_dir_for(sources.mod_id)

    scopes = extract_scope_map(sources.chain)
    with sources.open_menu() as menu:
        sprites = extract_sprites(menu, out, args.force,
                                  referenced=scope_textures(scopes))
    (out / "hud.json").write_text(json.dumps({
        "sprites": sprites,
        "flagMeshNation": flag_mesh_nations(sprites),
    }, indent=1) + "\n")
    icons = extract_icon_map(sources.chain)
    (out / "minimap-icons.json").write_text(
        json.dumps(icons, indent=1) + "\n")
    # The icons a level's own `.con` files give templates, per level.
    level_icons = extract_level_icon_map(game_dir, sources.chain, icons, sprites)
    (out / "minimap-level-icons.json").write_text(
        json.dumps(level_icons, indent=1) + "\n")
    # Each soldier template's team art: what the HUD draws for the team whose
    # `game.setTeamSkin` names it (ledger HUD rows on 0x006ac800).
    soldiers = extract_soldier_icons(sources.chain)
    (out / "soldier-icons.json").write_text(
        json.dumps(soldiers, indent=1) + "\n")
    # Each hand weapon's optic (SCOPE-2), for the scope overlay.
    (out / "scopes.json").write_text(json.dumps(scopes, indent=1) + "\n")
    print(f"{sources.mod_id}: {len(sprites)} sprites, {len(icons)} template "
          f"icons, {sum(map(len, level_icons.values()))} level-local icons over "
          f"{len(level_icons)} levels, {len(soldiers)} soldiers, "
          f"{len(scopes)} scoped weapons -> {out}")


if __name__ == "__main__":
    main()
