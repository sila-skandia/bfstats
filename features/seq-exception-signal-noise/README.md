# Seq `bfstats/Exceptions` signal noise

Webhook payload is always sparse (`Level=Error`, `Message=Alert condition
triggered by bfstats/Exceptions`, `Description=An exception has been logged`).
Seq API is 401 without a key, so `@Exception` is unknown on every page.

## 2026-08-30 08:43 UTC page

~1 hour after the 07:43 page (and ~6.5h after the 02:00 community-detection
slot). Live site at 08:44 UTC was healthy:

- Homepage 200, leaderboard 200, bflist `api.bflist.io/v2/bf1942/servers` 200
- Liveservers `lastUpdated` 08:43:38, 88 live BF1942 servers
- `/stats/communities` still 17,963 rows, all `formationDate = 2026-08-20`

Not a user-facing outage and not bflist. Best fit is the hourly
ranking/aggregate writers overlapping the 5-minute gamification / 30s stats
collection cycle, with `LogWarning(ex)` / `LogError(ex)` on handled
`SQLITE_BUSY` still tripping `@Exception is not null`. A :43 page is not the
02:00 community-detection job.

The 07:43 branch (`cursor/site-error-analysis-cb02`) and earlier 3c0a / 720b
never opened a PR, so production still has the noisy logging. This change
re-lands that work.

Separately, `GET /stats/players` (default page, sort `IsActive`) currently
returns 400 `An item with the same key has already been added. Key: Blezzed`.
Player detail is 200 (`isActive: true` on `Battlefield COOP Server`); only one
live server shows that name. Same stale second `IsActive` row as earlier hops
(LUMIA, Banzaq, CGT-GAUCHO). The controller catches `ArgumentException` and
returns 400 without logging, so this is **not** the Seq page — but the players
list is broken while a colliding name is on page 1. The lookup now keeps the
most recently seen session.

Known colliding names at 08:44: CGT-GAUCHO / Hattori Hanzo / Xberg / BATTLER /
bacon_ita019 / CrossMax / Banzaq / chris search 200 and `isActive` false.
LUMIA 1520 WP 8.1 SE search 200, `isActive` true on `*NEW* SiMPLE | RtR+SW`.
`?pageSize=5` 200 (Blezzed is not on that page).

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
