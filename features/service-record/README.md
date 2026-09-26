# Service record

The main site had the stats and mesh.bfstats.io had the 3D assets, and nothing
connected them. bflist only ever reports a team as `Axis` or `Allied`, and we
record no weapon or kit use, so at first glance there was nothing to pick a
model with.

There is. **A team label plus the map is a nationality.** Wake's Axis are the
Imperial Japanese Army, Stalingrad's Allies are the Red Army, El Alamein's Axis
wear Afrika Korps desert kit. The map dossiers (`features/map-dossier`) already
read each level's `setTeamSkin` out of the game files for 864 maps across 11
mods, so every recorded session can be attributed to a specific army, and
every army that has an extracted soldier can be drawn wearing that uniform.

## What it shows

| Surface | What |
|---|---|
| Player profile, Overview tab | **Service record** panel: the soldier of the army the player has served in longest, in 3D, holding that army's kit. Every army they fought for, with hours, K/D and wins. Clicking an army re-dresses the soldier. The army's in-game kit icons switch the loadout. The **arsenal**: what that army fielded on the maps the player fought on, weighted by their time there. Clicking a vehicle puts it on the stage. |
| Round report header | The ticket score is labelled with the map's armies ("Imperial Japanese Army 512 vs US Marine Corps 364") instead of Axis/Allied, and a band below it stands the two armies' soldiers face to face, the loser in shadow. |
| Player comparison | The two players face each other, each in the uniform their own service record opens on, the higher K/D lit. |

The stage opens on the longest-served army the armoury can dress, unless that
army holds under a tenth of the player's time: a Desert Combat regular's six
minutes as a Commando must not headline their record, so they open on Iraq and
an honest empty stage instead.

Nothing claims a weapon or vehicle the player used. The figure is "the uniform
you wore", the kits are "what that army carried", and the arsenal is "what
your side put in the field where you fought".

## Attribution

```
PlayerSessions (map, CurrentTeamLabel)  --join-->  Servers.GameId (the mod)
        |
        v
dossier(gameId, map).teams[Axis -> 1, Allied -> 2]  ->  { nation, label, skin, kits }
```

- A record covers the player's **whole career**, read from `PlayerTeamMapStats`;
  see "Whole career". Until that table's first backfill completes it covers
  their most recent 1,000 sessions.
- Only `Servers.Game = 'bf1942'` sessions count; FH2 and BFV are other games.
- `Axis` is team 1 and `Allied`/`Allies` team 2 — Refractor's convention, and
  what every dossier assumes. Numeric or empty labels are unattributed.
- A session whose map has no dossier still counts toward its side, and toward
  `unattributed`, never toward an army.
- Wins come from the session's own round: finished (`IsActive = 0`), both
  ticket counts present and unequal, and the winning label equal to the
  session's label. Ties and unfinished rounds count as neither.

### Army identity

| Family | Key | Name |
|---|---|---|
| `bf1942`, `xpack1`, `xpack2` (one WWII roster) | `bf1942:{nation}:{skin}` | curated per skin (table below) |
| `eod` | `eod:{nation}:{skin}` | curated per skin, else the label humanised |
| every other mod | `{mod}:{nation or label}` | the dossier's nation label |

The mod is the **server's**, when the server's mod inherits the dossier's: a Desert
Combat Final server plays maps it inherits from Desert Combat, whose dossiers are
filed under `desertcombat`, and the player was still playing DC Final. Keyed by the
dossier's mod, one DC Final player's United States read as two armies (44 minutes
and 43 hours). A server whose mod does not inherit the dossier's (a mis-reported
gameId the resolver found by its fallback scan) keeps the dossier's mod.

Other mods group by nation rather than skin: FHSW alone fields `GermanSoldier`,
`FMGermanSoldier` and `VolkssturmSoldier`, which would read as three armies
called "Germany".

| Skin | Name | | Skin | Name |
|---|---|---|---|---|
| `GermanSoldier` | Wehrmacht | | `BritishSoldier` | British Army (Canadian Army when the level's flag is `can`) |
| `GermanDesertSoldier` | Afrika Korps | | `BritishCommandoSoldier` | British Commandos |
| `GermanEliteSoldier` | German Elite | | `USSoldier` | US Army |
| `JapaneseSoldier` | Imperial Japanese Army | | `USMarineSoldier` | US Marine Corps |
| `ItalianSoldier` | Italian Army | | `RussianSoldier` | Red Army |
| `FrenchSoldier` | Free French | | `CanadianSoldier` | Canadian Army |

"British Commandos" and "German Elite" are the Secret Weapons kit manifest's own
nation names.

## The figure

The API resolves every asset path, so the page never probes for a file that is
not there:

1. **Trees.** The dossier's mod search path (`xpack2` -> `xpack2`, `bf1942`)
   maps to model trees (`models/mods/xpack2`, `models`). Only the WWII family
   falls back to vanilla's tree: Desert Combat's search path ends in `bf1942`
   too, and its `USSoldier` skin would otherwise resolve to vanilla's 1944 GI.
   Every other mod ships its own soldiers, vehicles and kit parts, so it gets
   its own trees or nothing (`dc_final` -> `dc_final`, `desertcombat`; `eod` ->
   `eod`).
2. **Kit -> weapon.** `kits.json` (first tree that declares the kit) names its
   items in order; the weapon is the first item with a `{skin}__{item}.pose.glb`
   in any tree of the path, looked up per weapon, not per figure: the xpack2
   tree has `GermanSoldier` poses for its own weapons only, so a Mimoyecques
   Wehrmacht resolved inside it alone lost all five vanilla kits. Matching is
   case-insensitive: the manifests spell `MP18`, the files `Mp18`.
3. **Worn parts.** Each `worn[].glb` from the first tree in the search path
   that has it — a mod kit borrows vanilla's radio and packs.

A soldier whose kits all fail to pose has no figure (`null`), the same as one the
armoury never extracted: Eve of Destruction has 135 teams that issue only
parachute kits, which no `kits.json` lists.

The page grafts the worn parts onto the pose's `A` / `backpack` / `HipPack`
bones with the viewer's own slot rotations (`tools/bf1942-models/viewer/
kit-graft.js`), which were set by eye and must not be re-derived.

**Monolithic poses only.** The page reads `<Skin>__<Weapon>.pose.glb`. The
pose de-duplication (`features/pose-asset-dedup`) plans to delete those after
its cutover; this page must learn the split rig + recipe path first. That
dependency is recorded in that feature's phase 3 checklist.

## Arsenal

Each dossier arsenal entry on a (map, team) the player played gets that row's
minutes. Summed per army, land/air/sea only, top eight. The count is exposure,
not use: the tile says "hours fielded".

It was called the motor pool until the data said otherwise: the game files the
M45 Quadmount, the coastal defence gun and the Flak 38 under `Vehicles/Land`
(each is a `PlayerControlObject` with `vehicleType AAGun`), so they are land
materiel in the dossier and lead some armies' lists. "Arsenal" is the dossier's
own word and is true of them; filtering them needs the dossier extractor to read
`vehicleType`, which is its fix to make, not this page's.

Thumbnails are the mesh site's own browse renders (`thumbs/{slug}.png`, slug as
`shoot.mjs` writes it); the model is `{Template}.glb`; both are looked up
across the search path's trees. A vehicle with neither keeps the in-game HUD
icon.

## Whole career

A session costs a random read for its row and another for its round, and the
production volume answers about 700 of those a second (`deploy/NODE_TUNING.md`).
Measured on a 25 GB copy of the database (2.68M sessions, 61k players):

| sessions per player | players |
|---|---|
| 100+ | 4,401 |
| 1,000+ | 504 |
| 2,000+ | 123 |
| 4,000+ | 16 (the busiest: 9,408) |

The busiest player's whole career took 1.26 s cold on local NVMe, which is tens
of seconds on the production volume, so the record is summed from a monthly
aggregate instead:

```
PlayerTeamMapStats (PlayerName, Year, Month, ServerGuid, MapName, TeamLabel)
  -> Sessions, TotalKills, TotalDeaths, TotalScore, TotalPlayTimeMinutes,
     Wins, Losses, FirstSessionStart
```

A record reads the player's own range of the primary key and groups it by
(gameId, map, label) — the rows the live query returns, from a few dozen pages
however long they have played. The sums are the same SQL (`ServiceRecordSql`),
so the two cannot count differently.

**Bucketed by the month a session was last seen,** not the month it started
(`PlayerMapStats` uses the start). A month is then one range of
`IX_PlayerSessions_LastSeenTime_WhereNotDeleted`, about a second on the copy,
where a start-time month cannot use an index. A session still being played moves
forward with its `LastSeenTime`, into the next month at midnight on the 1st; the
refresh rewrites both months then.

**The hourly refresh** runs at the end of `AggregateCalculationService`'s cycle,
under its lock, and rewrites the rows of:

- everyone seen since the last refresh (less 30 minutes: the tracker stamps a
  session before it commits it), in every month from then to now;
- everyone in a round that has finished since, in the month of that session.
  A round only closes when its server is next seen on another map, which
  settles the win or loss of players who left before the end. In August 2026,
  499 of 133,769 decided sessions (0.37%) closed more than 2 hours after the
  player's last observation, and 221 a day or more later: servers that went dark
  mid-round. They are found from the servers seen since, down
  `IX_Rounds_ServerGuid_EndTime`.

**History is backfilled three months a cycle,** newest first, after the first run
builds the current month. Progress is the `app_data` row
`aggregate:player-team-map-stats` (`RefreshedThrough`, `OldestMonth`,
`Complete`), so a restart resumes. The record keeps to the 1,000-session window,
with its "last 1,000 rounds" label, until `Complete`: a partial career would be
worse than a labelled one. The copy's sessions start in June 2025: sixteen
months, five cycles counting the first run, so complete about four hours after
the first cycle following a deploy.

**Rebuilt per player** wherever the other aggregates are:
`AggregateBackfillBackgroundService.RunForPlayersAsync` (round delete and
undelete, server merge) calls `RecomputePlayersAsync`, and a server merge deletes
the merged servers' rows first.

**Writes** follow the WriteLockNote in `AggregateCalculationService.cs`: every
scan runs outside a transaction. A month the record does not read yet (the first
run, the backfill) is committed 2,000 rows at a time; a live month swaps each
player's rows in one transaction.

On the copy, on local NVMe:

| | |
|---|---|
| Migration | 1.1 s |
| Full build, 16 months | 5 cycles of 9–12 s, 1,511,124 rows |
| An hour of the tracker | 130 players seen and 178 player-months in finished rounds (July and August among them): 3,912 rows over three month scans, 2.2 s |
| Size | 215 MB table, 131 MB primary key, 21.5 MB `(Year, Month)` index; `PlayerMapStats` is 230 MB |
| Agreement | 561 players (the 25 busiest, 300 at random, everyone that hour rewrote, their rows corrupted first): identical to the uncapped live query |
| Reads, those 561 | 209 ms in all, against 2,939 ms live |

The production cost of a month scan is not measured; the refresh's span in Seq
is `AggregateCalculation.PlayerTeamMapStats`, and the cycle's log line carries
`team=` rows. A scan holds its month in memory while it writes, about 95k rows
(~40 MB) at most, against the API's 3 Gi limit.

**Query plans.** Production has `sqlite_stat1` (`deploy/NODE_TUNING.md`) and it
changes plans: with it, "players seen since" skip-scans
`IX_PlayerSessions_PlayerName_LastSeenTime` for its `DISTINCT` (1.3 s against
1 ms for the range, on the copy), so that query is pinned with `INDEXED BY`, and
the rounds query fixes its join order with `CROSS JOIN`. The tests explain every
scan under production's statistics (`UseProductionStatisticsAsync`), since an
empty database plans from heuristics.

## Contract

`GET /stats/players/{playerName}/service-record`

```jsonc
{
  "playerName": "BetMan",
  "totalMinutes": 111480.5,
  "attributedMinutes": 100000.2,
  "sides": [
    { "side": "axis",   "minutes": 0, "rounds": 0, "kills": 0, "deaths": 0, "wins": 0, "losses": 0 },
    { "side": "allied", "minutes": 0, "rounds": 0, "kills": 0, "deaths": 0, "wins": 0, "losses": 0 }
  ],
  "armies": [
    {
      "key": "bf1942:rus:RussianSoldier",
      "name": "Red Army",
      "nation": "rus",
      "nationLabel": "Soviet Union",
      "side": "allied",
      "mod": "bf1942",
      "minutes": 3000.0, "rounds": 250, "kills": 1000, "deaths": 900, "score": 5000,
      "wins": 120, "losses": 100,
      "maps": [ { "gameId": "bf1942", "mapName": "stalingrad", "displayName": "Stalingrad",
                  "minutes": 900.0, "rounds": 70 } ],
      "kits": [ { "template": "Rus_Assault", "name": "Assault", "role": "assault",
                  "iconPath": "kits/bf1942/rusassault.png" } ],
      "figure": {
        "skin": "RussianSoldier",
        "thumb": "models/thumbs/russiansoldier.png",
        "kits": [ { "template": "Rus_Assault", "weapon": "DP",
                    "pose": "models/poses/RussianSoldier__DP.pose.glb",
                    "worn": [ { "path": "models/Russ_Helmet.kit.glb", "bone": "A", "slot": "head",
                                "position": [0, 0, 0], "rotation": [0, 0, 0] } ] } ]
      },
      "vehicles": [ { "template": "t34", "name": "T-34", "category": "land",
                      "iconPath": "vehicles/bf1942/t34.png",
                      "thumb": "models/thumbs/t34.png", "model": "models/T34.glb",
                      "minutes": 2100.0, "maps": 3 } ]
    }
  ],
  "unattributed": { "minutes": 0, "rounds": 0 },
  "window": { "sessions": 11874, "capped": false, "since": "2025-06-03T19:41:07.123Z" }
}
```

`window` is what the record counted: every session and the first one's start
once the aggregate is complete; during its backfill, up to 1,000 sessions with
`capped` set when older ones were left out.

`GET /stats/armoury/maps/{gameId}/{mapName}` — the two armies of one map, for
the round report: `{ "mod", "map", "displayName", "teams": [ { "index", "side",
"key", "name", "nation", "nationLabel", "kits", "figure" } ] }`, 404 when the
map has no dossier.

Paths under `figure` and `vehicles` are relative to the mesh root
(`/stats/assets/mesh/`); `iconPath` to the HUD root (`/stats/assets/hud/`).

## Caching

| | |
|---|---|
| Service record | Redis 1 h per player; edge `s-maxage=600` |
| Map armies | `public, max-age=86400`, as the dossier |
| `/stats/assets/mesh/*` | `public, max-age=300, s-maxage=86400` — the mesh site's own policy. Without a `Cache-Control` the zone rule bypasses Cloudflare, so every profile view pulled a 1–2 MB glb from the node. |
| Mesh directory index | in memory, 10 min, like the dossier icon index |

A republished asset reaches the main site within a day at the edge, the same as
mesh.bfstats.io.

## Where things live

| | |
|---|---|
| Army catalogue, mesh index, map armies endpoint | `api/Armoury/` |
| Aggregation + endpoint | `api/ServiceRecord/` |
| Whole-career aggregate | `PlayerTeamMapStats` (`api/Data/Entities/`), built by `TeamMapStatsAggregator` |
| 3D stage (lazy three.js chunk) | `ui/src/components/v4/armoury/stage.ts`, wrapped by `MmArmouryStage.vue` |
| Panels | `MmServiceRecord.vue` (profile), `MmFaceoffBand.vue` with `MmRoundArmies.vue` and `MmPlayerFaceoff.vue` |
| Tests | `tests/api/Armoury/`, `tests/api/ServiceRecord/`, `ui/e2e/service-record.spec.ts` |
