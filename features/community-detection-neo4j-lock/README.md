# Community detection vs Neo4j relationship sync

## Symptom

Seq `bfstats/Exceptions` fired at **02:02 UTC on 2026-08-28**. Site was healthy
(stats collection `lastSeen` within seconds, live rounds 200, `/health` 200).

Live `/stats/communities` still served **17,963 communities**, all stamped
`formationDate = 2026-08-20T02:00:05–08Z`. Nightly detection last succeeded
the morning after the co-rounds backfill started (heap/CPU bump, fire-and-forget
sync) and has failed every 2 AM run since.

## Cause

`CommunityDetectionService` runs at 02:00 UTC. It is a heavy Neo4j **writer**
(delete-all Community nodes + full-graph PLAYED_WITH clustering in one
transaction) but was never added to
`IAggregateConcurrencyService.ExecuteWithNeo4jRelationshipSyncLockAsync`.

That lock exists because concurrent Neo4j writers Forseti-deadlock. The
Aug 19 co-rounds backfill holds it for as long as the drain runs; community
detection ran alongside it anyway.

A second failure mode: even after the lock is free, assigning `communityId`
for every player in one write that `COLLECT`s all `PLAYED_WITH` neighbours
does not fit in the 1.25G heap once the graph has been backfilled.

Seq's webhook still does not include `@Exception` / `@Message`, so this is
inferred from wall-clock (only 2 AM job) + stale `formationDate` rather than
a stack trace.

A **11:34 UTC 2026-09-02** page is not this job: communities were still
17,955 rows stamped 2026-08-20, and 11:34 is a 5-minute gamification
boundary, not 02:00. See `features/seq-exception-signal-noise/README.md`.

## Fix

1. Take the Neo4j relationship-sync lock around detection (same lock as ETL /
   admin backfill) so the two writers never overlap.
2. Assign `communityId` with `CALL { } IN TRANSACTIONS OF 200 ROWS` instead of
   one giant write.
3. Create new Community nodes tagged with `detectedRunId`, then delete the
   previous run. A failed pass leaves yesterday's communities in place
   instead of wiping them first.
4. Log the exception once (inner service). The background job / admin
   endpoint log the message without attaching `ex`, so Seq does not double-page.
