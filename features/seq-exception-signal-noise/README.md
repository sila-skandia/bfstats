# Seq `bfstats/Exceptions` signal noise

Webhook payload is always sparse (`Level=Error`, `Message=Alert condition
triggered by bfstats/Exceptions`, `Description=An exception has been logged`).
Seq API is 401 without a key, so `@Exception` is unknown on every page.

## 2026-09-06 06:57 UTC page

~2 hours 15 minutes after the 04:42 page (`cursor/site-error-investigation-c087`).
That leftover never opened a PR, and main moved to `5a7fe73` at 05:47 UTC
(Armoury parked on `feat/3d-armoury`). Live site at 06:58 UTC was otherwise
healthy:

- Homepage 200, Seq UI 200 / API 401, bflist `api.bflist.io/v2/bf1942/servers` 200
- Liveservers `lastUpdated` 06:57:49, 91 servers named/unique, 13 live players /
  13 unique (no dups)
- Default `/stats/players` 200. Search for Ho-Chi Minh / jonas / BFSoldier /
  Player / Nosferatu / Brisdahl all 200. Prior collisions remain cleared
  (`isActive: false`; lastSeen 12:55:08 / 19:18:38 on 09-05).
- Arcade servers 200. Trivia 200 in 0.19s. Higher-lower 200 in 0.19s. Mystery
  200 in 1.3s.
- Map thumbs kursk/bocage 200; kursk_custom 404 expected.
- Wrapped MoonGamers 200. `/armoury` is SPA HTML (feature parked).
- `/stats/communities` still 27 rows, all `formationDate = 2026-09-06T02:17:49Z`.

A :57 page is 2 minutes after the :55 gamification tick. Best fit is the same
handled `LogWarning(ex)` leftover (request-path fallbacks plus trivia
warmup/refresh overlapping the lock). Not a 02:00 retry — detection already
succeeded at 02:17. Seq re-notify of a held earlier event is the other
possibility.

This change cherry-picks the c087 logging silence onto `5a7fe73`. There is
no `LogWarning(ex)` left in the API.

## 2026-09-06 03:57 UTC page

~2 hours 48 minutes after the 01:09 page (`cursor/site-error-analysis-08fb`).
That leftover request-path fix never opened a PR. `9bae956` (arcade trivia
pool off the request path, plus three covering indexes) landed on main at
03:35 UTC and is live — trivia is now 0.22s. Live site at 03:57 UTC was
otherwise healthy:

- Homepage 200, Seq UI 200 / API 401, bflist `api.bflist.io/v2/bf1942/servers` 200
- Liveservers `lastUpdated` 03:57:47, 91 servers named/unique, 63 live players /
  63 unique (no dups)
- Default `/stats/players` 200. Search for Ho-Chi Minh / jonas / BFSoldier /
  Player / Nosferatu all 200. Prior collisions remain cleared.
- Arcade servers 200. Trivia 200 in 0.22s (was 14.7s at 01:10). Higher-lower
  200 in 0.20s. Mystery 200 in 2.4s.
- Wrapped MoonGamers 200.
- `/stats/communities` is now **27 rows**, all `formationDate = 2026-09-06T02:17:49Z`.
  The 02:00 community-detection job **succeeded** tonight (was stuck on
  2026-08-20 / 17,954 rows). A later :57 page is not a 02:00 retry.

A :57 page is 2 minutes after the :55 gamification tick. Best fit is handled
`LogWarning(ex)` during that lock window: leftover request-path fallbacks
(08fb never merged) and/or the new trivia warmup/refresh `LogWarning(ex)`
overlapping the same tick after the 03:35 deploy (migration builds three
full-table indexes, warmup starts 45s after the pod is up). Seq re-notify of
a held earlier event is the other possibility.

This change rebases 08fb onto current main and also strips `ex` from the new
trivia warmup / background-refresh fallbacks.

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

1. Re-land `cursor/site-error-investigation-c087` (and the
   060b/ff15/52b1/b5a1/08fb/ad3c leftover) onto current main (`5a7fe73`):
   request-path handled fallbacks no longer attach `ex` (player stats,
   arcade roster/orbit, banners, geo, AI plugins, auth 401, community 404,
   Redis/tournament-image startup).
2. Trivia warmup and background-refresh paths (from `9bae956`) also no
   longer attach `ex` on a handled failure. A failed warm still retries
   next interval; the request path can still build the pool.

Real failures still `LogError(ex)` and will still page.

## Still needed

- Seq API key in the investigation environment
- Seq webhook body should include `@Exception`, `@Message`, `SourceContext`
- Consider changing the signal to `@Level in ['Error','Fatal']` so a future
  `LogWarning(ex)` cannot page
- Merge and deploy this follow-up; until then production will keep paging
  on handled request-path / trivia-warmup lock contention
