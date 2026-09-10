# Seq Exceptions: whitespace-only buddy player name

Webhook: `bfstats/Exceptions` at 2026-09-10 19:36:41Z.
Alert window 19:26:11Z–19:36:11Z.

## What fired

Not an application exception. OpenTelemetry's HttpClient instrumentation recorded
an ERROR span (`Exception: ""`) for:

`GET http://bf42-stats-service.bf42-stats:8080/stats/notification/users-with-buddy?buddyPlayerName=%20%20%20`
→ HTTP 400 in 2ms

Parent: `PlayerOnlineNotification` on notifications pod
`bf42-notifications-79b85dbdbb-pbslw`. Player name was three spaces, server
`FHSW 0.81+FHSWeu0.84 ! UPDATE !` (guid `56df22c-54ee3-1358a3-9f3f4db`), map
`chartres`. `BuddyApiService` already treated 400 as a Warning and returned
zero users. The API ASP.NET span stayed OK.

TraceId `a4a7cb0213bef83b57143d0f06378f6d`.

A sibling four minutes earlier did the same for a single-space name
(`buddyPlayerName=%20`, TraceId `442d5447a8b5abf81224445cbede7c7d`) but that
HttpClient ERROR span was not exported, so Seq only paged on the second join.

## Why 400

`NotificationController.GetUsersWithBuddy` returns 400 when
`string.IsNullOrWhiteSpace(buddyPlayerName)`. BF1942 allows space-only names,
so `player_online` events for `" "` / `"   "` are real. Nobody can have that
as a buddy in a useful way, and the lookup is best-effort anyway.

HttpClient instrumentation marks 400 as ERROR. Seq `bfstats/Exceptions` is
`@Exception is not null`, which matches the empty-Exception span — the same
paging hole as BFList 404 (PR #25) and Recreate 503 (PR #27).

## Fix

Skip the HTTP call in `BuddyApiService` when the player name or server guid is
whitespace. Return empty, Debug log, no Warning. Same for favourite-server
lookups so an empty guid cannot 400 the sibling endpoint.

Do not live-probe `/stats/notification/users-with-buddy`; it is internal and
would 400 again until this image is running.
