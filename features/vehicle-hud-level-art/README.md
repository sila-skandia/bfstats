# Vehicle HUD pictures that live in a level (2026-10-11)

Owner report, Secret Weapons + Road to Rome round on Raid on Agheila: "the
health indicator for the vehicle shows the flak gun, not the Flettner model
image".

## Cause

The vehicle panel (`Vehicle/VehicleIcon`, 128x128 at (200,462), VHUD-7) draws
the picture the seat's PlayerControlObject names with `setVehicleIcon`. The
sprite pack was read from the mod's `menu.rfa` chain alone. Raid on Agheila
files its own pictures under its level archive's `Menu/Texture/`
(`Vehicle/IconFlettner.dds`, `IconGreyhound`, `Iconkrupp`, `Icon_M4A1`,
`Icon_MunitionsPanzer`, `Icon_RocketStation`, `Icon_BritJeep`, `Ammo/Icon_*`,
`Minimap/minimap_icon_Flettner`), and no `menu.rfa` holds them. A name the pack
did not hold fell to the layout's literal default, `Vehicle/Icon_defgun.tga`:
the flak gun. Same for Battle of Britain's `Junker_Icon` and `Radar_icon` and
Kasserine Pass's 20 `*k` pictures (ledger VHUD-13).

A second, quieter half (VHUD-14): the same levels redefine whole vehicles
(`extract_models` only lets a level fill the mod chain's gaps), so Kasserine's
Sherman drew vanilla's grey `Icon_sherman` where the game draws the sand-coloured
`Icon_shermank`, and Raid's `Willy` drew `Icon_willy` for `Icon_BritJeep`.

## What changed

| What | Where |
|---|---|
| Level art joins the sprite pack (`collect_level_art`, `LevelArt`; `Load/` excluded) | `tools/bf1942-models/extract_hud_pack.py` |
| A level's changed vehicle-HUD words per template (icon, dot position, the two ammo pictures and bars, weapon-icon count, cross, turret dial; changes only): `vehicle-level-hud.json` | same, `extract_level_vehicle_hud` |
| The viewer lays the level's words over a seat's HUD block where it is read | `viewer/vehicle-occupancy.js` `setLevelHudOverlay`, `hudOf`, `seatDotsAt`; installed by `viewer/hud-feed.js` |
| Census: every picture each template names, resolved the way `hud.js` does | `tools/bf1942-models/census_vehicle_icons.py` |
| Tests | `tests/test_vehicle_icon_census.py`, `tests/test_seats.py` (overlay), `tests/test_extract_hud_pack.py` |

## Census (2026-10-11, vanilla + RtR + SW)

`python3 census_vehicle_icons.py --game-dir <install>`: 576 named pictures
(vehicle icon, primary and secondary ammo icon of every PCO node of every model,
level variant and baked scene), 13 distinct misses before, 0 after; 137 rows
are level overlays.

## Re-running it

    python3 extract_hud_pack.py --mod bf1942 --out <scratch>/bf1942
    python3 extract_hud_mods.py --mod XPack1 --out <scratch>/XPack1 --vanilla viewer/maps/_shared/hud --staging <scratch>/stage
    python3 extract_hud_mods.py --mod XPack2 ...

then copy only the new PNGs, `hud.json`, `minimap-level-icons.json` and
`vehicle-level-hud.json` and extend `pack.json`'s `files` (the live packs carry
files other steps wrote; a straight `--out` onto them prunes by `pack.json`).

## Publish set

`maps/_shared/hud/`: 28 new PNGs, `hud.json`, `minimap-level-icons.json`,
`vehicle-level-hud.json`. `maps/mods/xpack1/_shared/hud/`: `flag_fre.png`,
`flag_it.png`, `hud.json`, `minimap-level-icons.json`, `pack.json`.
`maps/mods/xpack2/_shared/hud/`: 14 new PNGs, `hud.json`,
`minimap-level-icons.json`, `vehicle-level-hud.json`, `pack.json`.
Plus the viewer code (`hud-feed.js`, `vehicle-occupancy.js`, `seats.js`,
`map.html`).

## Open

Everything else a level's redefinition changes (hit points, weapons, armour
tiers) still comes from the mod chain's template; `dc-engine-reads` records the
same gap. Whether the engine's loader searches the level folder first or last
for a name that exists in both is not decompiled (none exists today).
