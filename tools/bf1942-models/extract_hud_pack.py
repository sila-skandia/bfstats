#!/usr/bin/env python3
"""Extract the shared HUD/menu sprite pack the map viewer draws with.

Two artifacts, both one-time and shared by every level of one mod:

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
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402
from bf42.rfa import ArchivePool, find_archives_dir  # noqa: E402

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


def extract_sprites(menu, out_dir: Path, force: bool) -> dict:
    """Decode the sprite list to PNGs, returning the manifest dict.

    `menu` is the mod's layered `menu.rfa` view (`MenuSources.open_menu`).
    With a one-mod chain that is the single archive, entry for entry and in
    its own order, which is what keeps the vanilla manifest unchanged.
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

    # The mod's own nations, if it has any beyond the ones `SPRITES` names.
    # The root of `menu/Texture/` only -- these four prefixes are the whole of
    # the per-nation art, and nothing under a subdirectory shares them.
    root = "menu/texture/"
    for entry in menu.entries:
        low = entry.lower()
        if not low.startswith(root) or "/" in entry[len(root):]:
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


def extract_icon_map(chain: list[Path]) -> dict[str, dict]:
    """template (lowercased) -> {icon, size} from every Objects archive.

    `size` is the engine's `setMinimapIconSize` draw size in pixels where one
    is declared (the 32/64 px ship icons), and absent otherwise — the default
    is the sprite's own 16 px.

    `chain` is the mod path, nearest first, so a mod's own `Objects.rfa` both
    adds its templates and overrides the vanilla ones it redefines — the same
    first-hit rule `ArchivePool` applies everywhere else.
    """
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
    templates: dict[str, dict] = {}
    for entry in pool.names():
        if not entry.lower().endswith(".con"):
            continue
        text = pool.try_read(entry)
        if text is None:
            continue
        current: str | None = None
        for line in text.decode("latin-1", "replace").splitlines():
            line = line.strip()
            if m := _CREATE.match(line):
                current = m.group(1).lower()
            elif (m := _ICON.match(line)) and current:
                templates.setdefault(current, {})["icon"] = icon_key(m.group(1))
            elif (m := _SIZE.match(line)) and current:
                templates.setdefault(current, {})["size"] = int(m.group(1))
    # A size with no icon declares nothing drawable; drop the strays.
    return {k: v for k, v in sorted(templates.items()) if "icon" in v}


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

    with sources.open_menu() as menu:
        sprites = extract_sprites(menu, out, args.force)
    (out / "hud.json").write_text(json.dumps({
        "sprites": sprites,
        "flagMeshNation": flag_mesh_nations(sprites),
    }, indent=1) + "\n")
    icons = extract_icon_map(sources.chain)
    (out / "minimap-icons.json").write_text(
        json.dumps(icons, indent=1) + "\n")
    print(f"{sources.mod_id}: {len(sprites)} sprites and {len(icons)} "
          f"template icons -> {out}")


if __name__ == "__main__":
    main()
