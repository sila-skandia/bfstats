# Map dossier

Every BF1942 level ships the configuration the engine reads at load time inside its
`.rfa` archive, and it is plain text once the LZO segments are unpacked. It knows a
great deal the stats site did not: which two armies fight on a map, the tickets each
side starts with and how fast those bleed, which side the level designates the
attacker, where every flag sits, and what each side can put in the field.

None of that is in the live server feed. bflist reports team labels as `Axis` and
`Allied` and nothing more. So the dossier turns a map name into an actual briefing,
illustrated with the icons the game itself draws — national ensigns, kit bags, and a
vehicle icon per hull.

## Where things live

| | |
|---|---|
| Dossier extraction | [scripts/extract_map_dossiers.py](../../scripts/extract_map_dossiers.py) |
| Icon extraction | [scripts/extract_hud_assets.py](../../scripts/extract_hud_assets.py) |
| Dossiers on disk | `/mnt/data/assets/dossiers/<mod>/<map>.json` on the Hetzner PVC |
| Icons on disk | `/mnt/data/assets/hud/{vehicles,weapons}/<mod>/<key>.png` |
| In git | none, deliberately — `tournament-images/` is gitignored |
| Endpoint | `GET /stats/maps/{gameId}/{mapName}/dossier` |
| Resolver / service | [MapDossierResolver.cs](../../api/MapDossiers/MapDossierResolver.cs), [MapDossierService.cs](../../api/MapDossiers/MapDossierService.cs) |
| UI | [MmMapDossier.vue](../../ui/src/components/v4/MmMapDossier.vue), [MmMapDossierModal.vue](../../ui/src/components/v4/MmMapDossierModal.vue) |
| Tests | [tests/api/MapDossiers/](../../tests/api/MapDossiers/) |

Addressing matches the map images exactly — mod folder plus level folder, lowercased,
spaces folded to underscores — so the same `(gameId, mapName)` pair a server reports
addresses its picture and its dossier. See [bf1942-map-thumbnails](../bf1942-map-thumbnails/README.md).

## Where it surfaces

| Surface | How |
|---|---|
| Map drill-in (server details -> Maps -> a map) | inline, above the traffic stats |
| Landing page server table | click the map name in a row |
| Server details, "Now playing" | click the current map |

The two click targets open the same panel in a modal. `MmMapDossier` renders nothing at
all when a map has no briefing, which is what you want inline; the modal passes
`show-placeholders` so a reader who opened it deliberately gets a skeleton and then a
plain "no briefing for this map" rather than an empty dialog. It also passes
`hide-heading`, because the modal chrome already names what it is.

The landing page's map button stops click propagation — the row itself navigates to the
server, and the briefing must not trigger that too.

### Icon magnification

The game draws vehicle icons at 128x128 and the arsenal row shows them at about
fourteen pixels tall, so hovering a row promotes the *same file* out of flow at 112px —
no second request, no reflow, on an opaque plate anchored above the row so it never
covers the name it belongs to. Kit icons are 64px shown at 26 and scale on hover too.
Both are suppressed under `@media (hover: none)`, where an icon growing in place on tap
reads as broken layout rather than a preview. Nothing is available only on hover.

## What the level files give up

| Source file | What it yields |
|---|---|
| `Init.con` | `setTeamSkin` (the nationality), `setKit` (kit roles), `assaultTeam` |
| `Init/Terrain.con` | `worldSize`, which turns flag positions into map coordinates |
| `GameTypes/Conquest.con` | starting tickets and the per-minute bleed, per team |
| `Conquest/ControlPoints.con` | each flag's name and world position |
| `Conquest/ControlPointTemplates.con` | who holds each flag at round start |
| `Conquest/ObjectSpawnTemplates.con` | what each spawner yields, per team |
| `Conquest/ObjectSpawns.con` | how many of each spawner the level places |
| `Objects*.rfa` layout | whether a template is land, air, sea, an emplacement, or not materiel at all |

Patch archives (`Wake_003.rfa`) override the base archive, so the extractor merges
them in filename order and lets the later file win — several maps had their tickets
retuned by a patch.

## Two things that are not as simple as they look

**A minimap is hand-drawn art, not a render of the terrain.** The transform from world
position to map coordinate is `x / worldSize` and `1 - z / worldSize`, and it is exact
on 20 of the 21 stock maps — flags land on the runway, the beach, the road junction
they are named after. Berlin is the exception: its `ingamemap.dds` is framed
differently from its terrain, and plotting against it scatters the flags into a corner
of unrelated ground. Nothing in the level config distinguishes it, so the extractor
falls back to a property of the result — if the whole flag cluster ends up crushed
against a world edge, where a combat area never sits, the framing is not to be
trusted. `controlPointsPlottable: false` then tells the UI to list the flags instead of
plotting them. Across all 864 maps this flags 6, Berlin among them; the other five are
tiny arena maps whose flags genuinely do occupy one corner of a large world.

**A mod's level inherits files, not just levels.** Desert Combat ships its own Gazala
that redefines the vehicles and kits but contains no `ControlPoints.con` and no
`Terrain.con` — the engine falls through to the base game's for those. Reading a mod's
level in isolation therefore reports no flags and no world size for a large share of
mod maps. The extractor underlays each level with the same level from the mods it
inherits from, nearest parent first, which took maps-with-flags from roughly half the
mod catalogue to 834 of 864.

**Kits are not the stock five.** The base game has scout/assault/at/medic/engineer;
FHSW declares 571 distinct kits and Desert Combat fields snipers, heavy assault and
spec ops. Flattening a mod's kit list onto the stock five drops most of it — DC showed
two kits where it has six, and FH/FHSW came out empty on most maps. So the kit template
is kept whole, with a stock role derived only as a fallback for art.

**Spawners place scenery and scripting objects, not just vehicles.** FHSW alone
places thousands of invisible `killercage` boundary markers through the same mechanism
that spawns a Tiger. The engine's own classification settles it: anything under
`Objects/Vehicles/{Land,Air,Sea}` or `Objects/Stationary_Weapons` is materiel, anything
under `Objects/HandWeapons` is a kit drop, and the rest is dropped by the API when it
is both unclassified *and* has no icon. That takes an FHSW map from ~13,000 raw
spawner entries to ~5,300 real ones.

The counts shown are **spawn points, not vehicles alive at once** — a spawner refills
once its previous machine is lost.

## Coverage

864 dossiers across 11 mods, extracted in about 15 seconds (~6MB). Broader than the
map images, which need art the dossier does not.

Vehicle icon coverage, after the non-materiel filter:

| Mod | Entries kept | Illustrated |
|---|---|---|
| bf1942, xpack1 | 400 | 100% |
| dc_final, desertcombat | 1,581 | ~85% |
| eod | 1,420 | ~85% |
| fhsw | 5,594 | 78% |
| fh, bf1918, gcmod, xpack2 | 4,210 | 58–74% |
| interstate | 95 | ~65% |

Mods name their icon files differently from their object templates, so the shortfall is
name matching rather than missing art. Note that on Linux, mods like `eod` and `interstate`
use lowercase `archives/` directories — case-insensitive directory resolution is required
so their `objects.rfa` and `menu.rfa` archives are properly discovered.

Kit art resolves two ways, in order. The primary pass parses `ObjectTemplate.setKitIcon`
and `ObjectTemplate.setType` from `objects.rfa` across each mod's inheritance chain,
extracting textures directly from `menu.rfa` into `hud/kits/<mod>/<template_name>.png`
(which powers GCMOD's `empiretrooper`, EoD's faction kits like `vcgrenadelauncher`, etc.).
The fallback pass files them by role and side (`assaultaxis`). Walking the search
path means DC Final, which ships no kit art at all, picks up Desert Combat's modern
kits rather than the base game's 1942 ones:

| Mod | Kits | Illustrated |
|---|---|---|
| bf1942, xpack1 | 275 | 100% |
| eod | 2,372 | >99% |
| xpack2 | 104 | 96% |
| gcmod | 272 | >95% |
| bf1918 | 1,300 | 82% |
| dc_final, desertcombat | 1,003 | 67% |
| interstate | 110 | 64% |
| fhsw, fh | 3,515 | ~53% |

A kit with no art and no stock role renders as its name — Desert Combat's "Spec Ops",
FHSW's "Kneemortar" — rather than borrowing an unrelated icon. Every consumer degrades to a name with no
picture, which is also what happens for the stock hulls the game never drew an icon for
(the Bf 110, the Mosquito).

## Regenerating

```bash
python3 scripts/extract_map_dossiers.py --force
```

```bash
python3 scripts/extract_hud_assets.py
```

Both write into `tournament-images/`, which is where `dotnet run` and
`scripts/verify.sh` point `ASSETS_STORAGE_PATH`. Uploading to Hetzner follows the same
`kubectl cp` / tar-pipe route as the map images — ask Claude for the
`bf1942-map-images` skill, which documents it.

## Notes for whoever picks this up next

- `BfFactionBadge`'s canonical flag alias (`flags/us.png` and friends) resolves to
  `baseflag_conp_*`, which is the game's *control-point marker* — six near-identical
  red discs whatever the nation. `flag-type="ensign"` was added for this feature and
  points at `icon_flag_*`, the 64px waving national flags, which is what you almost
  certainly want. The canonical alias was left alone because nothing else consumes it
  yet; it would be reasonable to repoint it.
- Kit icons are filed by *side* (`assault_axis.png`), not by nation, so pass
  `faction="axis"` / `"allies"` to `BfClassBadge` rather than a nation code.
- The drill-in gets its `gameId` threaded down from `ServerDetailsV4`, which already
  resolves the mod for the map preview. Callers that only know the game family fall
  back to it, which is the right mod for the roughly half of live servers running
  stock BF1942.
