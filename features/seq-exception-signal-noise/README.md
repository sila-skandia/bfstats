# Seq `bfstats/Exceptions` signal noise

Webhook payload is always sparse (`Level=Error`, `Message=Alert condition
triggered by bfstats/Exceptions`, `Description=An exception has been logged`).
Seq API is 401 without a key, so `@Exception` is unknown on every page.

## 2026-09-04 08:00 UTC page

~3 hours 45 minutes after the 04:15 09-04 page. Live site at 08:00 UTC was
healthy:

- Homepage 200, liveservers `lastUpdated` 08:00:56, 86 servers, 86 named / unique
- 20 live players, all unique (no live-list duplicates)
- Default `/stats/players` 200 (50 unique)
- Frankie search 200; player-detail `isActive: false`, lastPlayed 03:04:56
- Search of nico / Cosmik_Debris / Paciencia all 200
- bflist 200, Seq UI 200 / API 401, wrapped for MoonGamers / SiMPLE 200,
  player atp 200
- `/stats/communities` still 17,954 rows, all `formationDate = 2026-08-20T02:00:05–08Z`

**Hourly writers at 08:00 overlapping the 5-min gamification tick (also :00)
and 30s stats collection** (`SQLITE_BUSY`), or Seq re-notify of a held :00
event. Not a 02:00 community-detection retry: after a failed 02:00 run the
catch waits 5 min then the loop sleeps until tomorrow 02:00, and communities
are still frozen since 2026-08-20. A :00 page at any hour other than 02:00 is
hourly ranking/aggregate writers colliding with the 5-min gamification job
that also fires at :00.

The 04:15 branch (`cursor/bc-c68f02c9-0dc1-4442-b423-5538ef451dc3-c0a4`)
never opened a PR, so production still has the noisy `LogWarning(ex)` /
`LogError(ex)` on handled `SQLITE_BUSY` and the `ToDictionary(PlayerName)`
list crash. This change re-lands that work.

## 2026-09-04 04:15 UTC page

~73 minutes after the 03:02 09-04 page. Live site at 04:15 UTC was healthy:

- Homepage 200, liveservers `lastUpdated` 04:15:49, 85 servers, 85 named / unique
- 25 live players, all unique (no live-list duplicates)
- Default `/stats/players` 200 (50 unique)
- Frankie search 200; player-detail `isActive: false`, lastPlayed 03:04:56
- Search of nico / Cosmik_Debris / Paciencia all 200
- `/stats/communities` still 17,954 rows, all `formationDate = 2026-08-20T02:00:05–08Z`

**5-min gamification tick at :15 overlapping 30s stats collection**
(`SQLITE_BUSY`), or Seq re-notify of the 03:02 hourly-writer page ~73 min
later. Not a 02:00 community-detection retry.

## 2026-09-04 03:02 UTC page

~60 minutes after the 02:02 09-04 page. Live site at 03:03 UTC was healthy
apart from the players list:

- Homepage 200, liveservers `lastUpdated` 03:03:30, 85 servers
- `/stats/communities` still 17,954 rows, all `formationDate = 2026-08-20T02:00:05–08Z`

**Hourly writers at 03:00 overlapping the 5-min gamification tick and 30s
stats collection** (`SQLITE_BUSY`), or Seq re-notify of the 02:00 community
detection failure ~60 min later. Not a 02:00 retry.

Separately, `GET /stats/players` and search `query=Frankie` returned 400
`Key: Frankie`. Cleared by 04:15.

## 2026-09-04 02:02 UTC page

**Nightly community detection at 02:00 UTC** (or hourly writers at the same
`:00` colliding with it). Communities still 17,954 rows, all
`formationDate = 2026-08-20T02:00:05–08Z`. Default `/stats/players` 200.

## 2026-08-28 19:04 UTC page

~4 hours after the 15:02 page. Live site at 19:06 UTC was healthy:

- Homepage 200, bflist `api.bflist.io/v2/bf1942/servers` 200
- Players `lastSeen` 19:06:03, 86 live BF1942 servers
- `/stats/communities` still 17,963 rows, all `formationDate = 2026-08-20`

The 15:02 branch (`cursor/site-error-analysis-7c47`) never opened a PR, so
production still has the noisy `LogWarning(ex)` / `LogError(ex)` on handled
`SQLITE_BUSY`. This change re-lands that work.

Separately, `GET /stats/players` (default page, sort `IsActive`) currently
returns 400 `An item with the same key has already been added. Key: BATTLER`.
Player names are not unique across servers, so two active `PlayerSessions` for
the same name is valid data. `GetAllPlayersWithPaging` / `SearchPlayersAsync`
used `ToDictionary(s => s.PlayerName)` and threw. The controller catches
`ArgumentException` and returns 400 without logging, so this is **not** the
Seq page — but the players list is broken for anyone hitting the default
endpoint while a colliding name is online. The lookup now keeps the most
recently seen session.

## 2026-08-28 15:02 UTC page

~2 hours after the 13:07 page. Live site at 15:03 UTC was healthy:

- Players `lastSeen` 15:03:33, liveservers `lastSeen` 15:03:47
- 88 BF1942 servers, bflist `api.bflist.io/v2/bf1942/servers` 200
- `/stats/communities` still 17,963 rows, all `formationDate = 2026-08-20`

Not a user-facing outage and not bflist. Best fit is the same contention as
13:07: hourly ranking/aggregate writers overlapping the 5-minute gamification
job, with `LogWarning(ex)` / `LogError(ex)` on handled `SQLITE_BUSY` still
tripping `@Exception is not null`.

The 13:07 branch (`cursor/site-error-analysis-1ffc`) never opened a PR, so
production still has the noisy logging. This change re-lands that work and
closes the remaining inner-layer holes:

- Gamification last-processed timestamp fallbacks used `LogWarning(ex)` and
  returned `DateTime.MinValue` on `SQLITE_BUSY`, which both pages Seq and
  would re-scan all history while the database is locked. Busy now rethrows
  so the cycle skips.
- Inner gamification (`GamificationService`, placements, team victories,
  kill streaks, milestones) logged `LogError(ex)` *before* the outer cycle
  `when (SqliteBusy)` handler, so 1ffc alone would still page.
- Redis player-event publish and average-ping fallbacks are handled and
  continue; they no longer attach `ex`.

## 2026-08-28 13:07 UTC page

Live site at 13:10 UTC was healthy (75 players, bflist 200). Ranking,
aggregate, and gamification all write SQLite around this time of day.

## Fixes in this change

1. Land the two previous investigation branches that never merged:
   - stats-collection `SQLITE_BUSY` retries no longer attach `ex`
   - nightly community detection takes the Neo4j relationship-sync lock,
     batches `communityId` assignment, and does not wipe communities on
     failure (still stale since 2026-08-20)
2. Stop attaching exceptions on other **handled** fallbacks that page the
   same signal: BFList last-known-good, Redis cache get/set/remove,
   process-health sampling, `PRAGMA optimize`, connection PRAGMAs,
   Redis player-event publish, average-ping fallback.
3. Ranking / aggregate / gamification treat `SQLITE_BUSY` as a warning
   without `ex` instead of `LogError(ex)` (and ranking no longer logs the
   same failure twice). Inner gamification layers rethrow busy instead of
   logging-and-swallowing it.

Real failures still `LogError(ex)` and will still page.

## Still needed

- Seq API key in the investigation environment
- Seq webhook body should include `@Exception`, `@Message`, `SourceContext`
- Consider changing the signal to `@Level in ['Error','Fatal']` so even a
  missed `LogWarning(ex)` cannot page
- Merge and deploy this PR; until then production will keep paging on the
  same handled lock contention
