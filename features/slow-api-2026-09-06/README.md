# Slow API — 2026-09-06 09:01 UTC

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` paged on
`GET /stats/admin/data/servers/merge-candidates?game=bf1942`
finishing in **11.6s** (TraceId `f8d4fdef0ffd3e90afced3b4c35e8646`, 08:59:25–08:59:36Z).
A refresh of the same tab 4s later was 3.9s. Yesterday's hit of the same path was 9.3s.

Not lock-contention: neighbouring admin calls at 08:59:25 were 28–64ms, and the
hourly writers had not started yet.

## Cause

`FindDuplicateCandidatesAsync` LEFT JOINed **every** `Servers` row onto
`PlayerSessions` and grouped by GUID, then threw away groups with a single GUID
in memory. Session totals are only needed for the few duplicate identities.
On the Hetzner network volume that is a sequential full-table walk
(~1.4ms per page miss). EF logged the command as 2ms — time-to-first-row —
while the reader held the request open for the remaining 11s.

## Fix

1. Load `Servers` (hundreds of rows) and find `(Game, Ip, Port, Name)` groups
   with more than one GUID in memory.
2. Aggregate `PlayerSessions` only for those GUIDs (`ServerGuid` is indexed).
3. Return empty immediately when there are no duplicates.

## Also in this window

`GET /stats/relationships/players/{name}/network-graph?depth=2` is the habitual
10s+ endpoint (7 of the 10 most recent slow requests, 13–56s). The 2-hop Cypher
did `OPTIONAL MATCH` every `PLAYED_WITH` edge of the top 15 allies, then
`collect()[0..5]`. Replaced with a per-ally `CALL` subquery that `LIMIT 5`s
before collect. 15-minute cache still applies on a miss.

Arcade / banner 10s+ hits in the same 10-event window are older than the
trivia-pool and badge-index deploys.
