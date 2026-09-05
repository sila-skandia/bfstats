# Seq `bfstats/Exceptions` signal noise

Webhook payload is always sparse (`Level=Error`, `Message=Alert condition
triggered by bfstats/Exceptions`, `Description=An exception has been logged`).
Seq API is 401 without a key, so `@Exception` is unknown on every page.

## 2026-09-05 23:47 UTC page

68 minutes after the 22:39 page (`cursor/site-error-analysis-52b1`). That
branch never opened a PR, so production still attaches `ex` on request-path
handled fallbacks. Live site at 23:47 UTC was otherwise healthy:

- Homepage 200, Seq UI 200 / API 401, bflist `api.bflist.io/v2/bf1942/servers` 200
- Liveservers `lastUpdated` 23:47:39, 91 servers named/unique, 65 live players
  (65 unique; no duplicate names)
- Default `/stats/players` 200. Search for Ho-Chi Minh / jonas / BFSoldier /
  Player / Nosferatu all 200. Prior Ho-Chi Minh and jonas collisions remain
  cleared (`isActive: false`; lastSeen 12:55:08 / 19:18:38).
- Arcade `/servers` 200. Trivia 200 in 14.8s; higher-lower 200 in 0.2s
  (likely cached). The slower trivia wait is consistent with SQLite lock
  contention around the :45 gamification window.
- Wrapped 200 for MoonGamers.
- `/stats/communities` still 17,954 rows, all `formationDate = 2026-08-20`

A :47 page is 2 minutes after the :45 gamification tick (same offset as the
:07-after-:05 and :48-after-:45 pages). Background-job `SQLITE_BUSY` should
not page after PR #17. Best fit is the same leftover request-path
`LogWarning(ex)` (player pages, arcade roster/trivia, banners, geo) during
that lock window, or Seq re-notify of the 22:39 event. Not a 02:00 retry.

This change re-lands `cursor/site-error-analysis-52b1` / `ff15` / `060b` so
the leftover handled fallbacks stop paging.

## 2026-09-05 22:39 UTC page

32 minutes after the 22:07 page (`cursor/site-error-analysis-ff15`). That
branch never opened a PR, so production still attaches `ex` on request-path
handled fallbacks. Live site at 22:40 UTC was otherwise healthy:

- Homepage 200, Seq UI 200 / API 401, bflist `api.bflist.io/v2/bf1942/servers` 200
- Liveservers `lastUpdated` 22:40:00, 92 servers named/unique, 88 live players
  (88 unique; no duplicate names)
- Default `/stats/players` 200. Search for Ho-Chi Minh / jonas / BFSoldier /
  Player / Nosferatu all 200. Prior Ho-Chi Minh and jonas collisions remain
  cleared (`isActive: false`; lastSeen 12:55:08 / 19:18:38).
- Arcade `/servers` 200 (3.6s). Trivia 200 but 29s; higher-lower 200 in 0.2s
  (likely cached). That 29s trivia wait is consistent with SQLite lock
  contention around the :35/:40 gamification window.
- Wrapped 200 for MoonGamers.
- `/stats/communities` still 17,954 rows, all `formationDate = 2026-08-20`

A :39 page is 4 minutes after the :35 gamification tick (same offset as the
:34-after-:30 pages). Background-job `SQLITE_BUSY` should not page after
PR #17. Best fit is the same leftover request-path `LogWarning(ex)` (player
pages, arcade roster/trivia, banners, geo) during that lock window, or Seq
re-notify of the 22:07 event. Not a 02:00 retry.

This change re-lands `cursor/site-error-analysis-ff15` / `060b` so the
leftover handled fallbacks stop paging.

## 2026-09-05 22:07 UTC page

33 minutes after the 21:34 page (`cursor/site-error-analysis-060b`). That
branch never opened a PR, so production still attaches `ex` on request-path
handled fallbacks. Live site at 22:07 UTC was otherwise healthy:

- Homepage 200, Seq UI 200 / API 401, bflist `api.bflist.io/v2/bf1942/servers` 200
- Liveservers `lastUpdated` 22:07:45, 92 servers named/unique, 119 live players
  (117 unique; generic `BFSoldier` and `Player` on two servers each)
- Default `/stats/players` 200. Search for Ho-Chi Minh / jonas / BFSoldier /
  Player / Nosferatu all 200. Prior Ho-Chi Minh and jonas collisions remain
  cleared (`isActive: false`; lastPlayed 12:55:08 / 19:18:38).
- Arcade `/servers`, `/higher-lower/next`, `/mystery/today`, `/trivia/quiz` 200.
  Spawn maps `wake` / `bocage` 200. Trivia 8.5s, higher-lower 8.8s.
- Wrapped 200 for MoonGamers and `*NEW* SiMPLE | BF1942`. RtR+SW wrapped 404
  (no cached wrap).
- `/stats/communities` still 17,954 rows, all `formationDate = 2026-08-20`

A :07 page is 2 minutes after the :05 gamification tick and 7 minutes after
hourly ranking/aggregate writers. Background-job `SQLITE_BUSY` should not page
after PR #17. Best fit is the same leftover request-path `LogWarning(ex)`
(player pages, arcade ~9s queries, banners, geo) during that lock window, or
Seq re-notify of the 21:34 event. Not a 02:00 retry.

This change re-lands `cursor/site-error-analysis-060b` so the leftover
handled fallbacks stop paging.

## 2026-09-05 21:34 UTC page

~4 hours after the 17:34 page (`cursor/site-error-analysis-625f`). PR #17 from
that branch merged at 20:21 UTC and is live (Field Lore arcade assets 200,
`BFSoldier` search 200 with two live sessions). Live site at 21:35 UTC was
otherwise healthy:

- Homepage 200, Seq UI 200 / API 401, bflist `api.bflist.io/v2/bf1942/servers` 200
- Liveservers `lastUpdated` 21:35:26, 91 servers named/unique, 120 live players
  (119 unique; only generic `BFSoldier` on two servers)
- Default `/stats/players` 200. Search for Ho-Chi Minh / jonas / lop|Zagros /
  tom / Rick / Frankie / nico / Paciencia / Aaa / Cosmik_Debris / HannibalKills /
  BFSoldier / Player / Nosferatu all 200. Prior Ho-Chi Minh and jonas collisions
  remain cleared (`isActive: false`; lastPlayed 12:55:08 / 19:18:38).
- Arcade `/servers`, `/higher-lower/next`, `/mystery/today`, `/trivia/quiz` 200.
  Spawn maps `wake` / `bocage` 200. Trivia and higher-lower took ~10–11s.
- Wrapped 200 for MoonGamers and `*NEW* SiMPLE | BF1942`. RtR+SW wrapped 404
  (no cached wrap).
- `/stats/communities` still 17,954 rows, all `formationDate = 2026-08-20`

A :34 page is 4 minutes after the :30 gamification tick. Background-job
`SQLITE_BUSY` no longer attaches `ex` after PR #17, so this is not that path.
Best fit is a **request-path handled fallback** that still used `LogWarning(ex)`
during the same lock window: player-detail SQLite lookups, arcade roster loads
(10s queries on a Saturday evening), banner timeline, or geo/ipinfo. Seq
re-notify of a held earlier event is the other possibility. Not a 02:00 retry.

This change strips `ex` from the remaining handled `LogWarning(ex)` sites so
`@Exception is not null` no longer pages on those fallbacks. Real failures
still `LogError(ex)`.

## 2026-09-05 17:34 UTC page

~3 hours 50 minutes after the 13:44 page (`cursor/site-error-analysis-59cd`).
Live site at 17:34 UTC was otherwise healthy:

- Homepage 200, Seq UI 200 / API 401, bflist `api.bflist.io/v2/bf1942/servers` 200
- Liveservers `lastUpdated` 17:34:50, 93 servers named/unique, 120 live players
  (118 unique; only generic `BFSoldier` appears on three servers)
- Default `/stats/players` 200. Search for Ho-Chi Minh / jonas / lop|Zagros /
  tom / Rick / Frankie / nico / Paciencia / Aaa / Cosmik_Debris / HannibalKills
  / BFSoldier / Player / Nosferatu all 200. Prior Ho-Chi Minh and jonas
  collisions remain cleared (`isActive: false`; lastPlayed 12:55:08 / 14:44:08).
- Wrapped 200 for MoonGamers and `*NEW* SiMPLE | BF1942`. RtR+SW wrapped 404
  (no cached wrap).
- `/stats/communities` still 17,954 rows, all `formationDate = 2026-08-20`

A :34 page is 4 minutes after the :30 gamification tick. Best fit is handled
`SQLITE_BUSY` from that tick overlapping 30s collection, or Seq re-notify of
a held earlier event. Not a 02:00 retry (catch waits 5 min then sleeps until
tomorrow). The 13:44 / 09:21 / 08:51 / 08:18 branches never merged, so this
change re-lands that work.

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
- Consider changing the signal to `@Level in ['Error','Fatal']` so a future
  `LogWarning(ex)` cannot page
- Merge and deploy this follow-up; PR #17 is already live and stopped the
  background-job `SQLITE_BUSY` pages, but request-path fallbacks still attach
  `ex` until this lands
