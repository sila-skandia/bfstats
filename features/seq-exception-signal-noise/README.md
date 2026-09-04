# Seq `bfstats/Exceptions` signal noise

Webhook payload is always sparse (`Level=Error`, `Message=Alert condition
triggered by bfstats/Exceptions`, `Description=An exception has been logged`).
Seq API is 401 without a key, so `@Exception` is unknown on every page.

## 2026-09-04 23:18 UTC page

~9 hours 45 minutes after the 13:33 09-04 page. Live site at 23:19 UTC was
healthy aside from the players list:

- Homepage 200, liveservers `lastUpdated` 23:19:03, 91 servers named / unique
- 61 live players / 61 unique; `lop|Zagros` live only on
  `MoonGamers.com | Est. 2004`
- Default `/stats/players` **400** `Key: lop|Zagros` at 23:19, then **400**
  `Key: tom` by 23:21. Search `query=lop|Zagros` 400 then 200 (result page
  no longer collided). **lop|Zagros** hopped `*NEW* SiMPLE | BF1942` →
  MoonGamers: two `IsActive` (3034721 started 23:15:26 on MoonGamers,
  stale 3034671 lastSeen 23:14:56 on SiMPLE BF1942). **tom** hopped
  `*NEW* SiMPLE | Tanks a lot!` → `*NEW* SiMPLE | BF1942`: two `IsActive`
  (3034737 started 23:19:56 on BF1942, 3034406 lastSeen 23:19:26 on Tanks).
  Rick / Frankie / nico / Paciencia search 200
- bflist 200, Seq UI 200 / API 401, wrapped for MoonGamers / SiMPLE 200,
  player atp 200
- `/stats/communities` still 17,954 rows, all
  `formationDate = 2026-08-20T02:00:05–08Z`

**5-min gamification tick at :15 overlapping 30s stats collection**
(`SQLITE_BUSY`), or Seq re-notify of a held earlier event. A :18 page is
3 min after that gamification boundary / 18 min after hourly writers.
Not a 02:00 community-detection retry: after a failed 02:00 run the catch
waits 5 min then the loop sleeps until tomorrow 02:00, and communities are
still frozen since 2026-08-20.

The 13:33 branch (`cursor/site-error-analysis-15fa`) never opened a PR, so
production still has the noisy `LogWarning(ex)` / `LogError(ex)` on handled
`SQLITE_BUSY` and the `ToDictionary(PlayerName)` list crash. This
change re-lands that work.

## 2026-09-04 13:33 UTC page

~48 minutes after the 12:45 09-04 page. Live site at 13:34 UTC was healthy:

- Homepage 200, liveservers `lastUpdated` 13:33:56, 87 servers named / unique
- 53 live players / 52 unique; live-list duplicate `Player` is an AI bot on
  `*NEW* SiMPLE | RtR+SW` (mimoyecques) and `MoonGamers.com | Est. 2004`
  (iwo jima) — not tracked as a player (`/stats/players/Player` empty)
- Default `/stats/players` **200** (50 unique). Search `query=Rick` 200.
  Rick back on `*NEW* SiMPLE | BF1942` with a single `IsActive` session
  (3032039 started 13:27:56); the 12:45 stale RtR+SW row is closed
- bflist 200, Seq UI 200 / API 401, wrapped for MoonGamers / SiMPLE 200,
  player atp 200
- `/stats/communities` still 17,954 rows, all
  `formationDate = 2026-08-20T02:00:05–08Z`

**5-min gamification tick at :30 overlapping 30s stats collection**
(`SQLITE_BUSY`), or Seq re-notify of a held earlier event. A :33 page is
3 min after that gamification boundary / 33 min after hourly writers.

## 2026-09-04 12:45 UTC page

~4 hours 45 minutes after the 08:00 09-04 page. Live site at 12:46 UTC was
healthy aside from the players list:

- Homepage 200, liveservers `lastUpdated` 12:46:12 then 12:46:56, 87 servers,
  87 named / unique
- 57–59 live players, 56–58 unique; live-list duplicate `BFSoldier` on
  `*NEW* SiMPLE | BF1942` (ctf) and `MoonGamers.com | Est. 2004` (conquest)
- bflist 200, Seq UI 200 / API 401, wrapped for MoonGamers / SiMPLE 200,
  player atp 200
- `/stats/communities` still 17,954 rows, all
  `formationDate = 2026-08-20T02:00:05–08Z`

**5-min gamification tick at :45 overlapping 30s stats collection**
(`SQLITE_BUSY`), or Seq re-notify of a held earlier event. A :45 page is
that gamification boundary / 45 min after hourly writers.

Separately, `GET /stats/players` (default page, sort `IsActive`) returned 400
`Key: Aaa` then `Key: Rick`. Search `query=Rick` also 400. **Rick** hopped
`*NEW* SiMPLE | BF1942` → `*NEW* SiMPLE | RtR+SW` (husky): player-detail
showed two `IsActive` sessions (3031848 lastSeen 12:41:56 on BF1942, 3031899
started 12:43:26 on RtR+SW). Cleared by 13:34 (single IsActive, search 200).

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
