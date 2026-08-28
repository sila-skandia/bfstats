# Seq `bfstats/Exceptions` signal noise

## 2026-08-28 13:07 UTC page

Webhook was the usual sparse payload (`Level=Error`, `Message=Alert condition
triggered by bfstats/Exceptions`, `Description=An exception has been logged`).
Seq API is still 401 without a key, so the exact `@Exception` is unknown.

Live site at 13:10 UTC was healthy:

- Stats collection `lastSeen` on players and live servers within seconds
- `api.bflist.io/v2/bf1942/servers` 200
- 75 players on 8 occupied servers
- `/stats/communities` still serving 17,963 communities, all
  `formationDate = 2026-08-20T02:00:05–08Z`

This is **not** the 02:00 community-detection job. Ranking, aggregate, and
gamification all write SQLite around this time of day (hourly / every 5 min),
and `LogWarning(ex)` / `LogError(ex)` on handled `SQLITE_BUSY` still trips
Seq's `@Exception is not null` signal.

## Fixes in this change

1. Land the two previous investigation branches that never merged:
   - stats-collection `SQLITE_BUSY` retries no longer attach `ex`
   - nightly community detection takes the Neo4j relationship-sync lock,
     batches `communityId` assignment, and does not wipe communities on
     failure (still stale since 2026-08-20)
2. Stop attaching exceptions on other **handled** fallbacks that page the
   same signal: BFList last-known-good, Redis cache get/set/remove,
   process-health sampling, `PRAGMA optimize`, connection PRAGMAs.
3. Ranking / aggregate / gamification treat `SQLITE_BUSY` as a warning
   without `ex` instead of `LogError(ex)` (and ranking no longer logs the
   same failure twice).

Real failures still `LogError(ex)` and will still page.

## Still needed

- Seq API key in the investigation environment
- Seq webhook body should include `@Exception`, `@Message`, `SourceContext`
- Consider changing the signal to `@Level in ['Error','Fatal']` so even a
  missed `LogWarning(ex)` cannot page
