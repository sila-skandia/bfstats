# Arcade trivia performance

Work driven by a production trace of `GET /stats/arcade/trivia/quiz` that took **29.2s**
(2026-09-05 22:40:16Z). The endpoint caches its question pool for 20 minutes, so this was not
a rare pathological request — it was what one visitor every 20 minutes experienced.

## Where the 29.2s went

| segment | cost | cause |
|---|---|---|
| roster load #1 | 19.4s | cache-bypassing call, see below |
| ├ `PlayerStatsMonthly` GROUP BY | 2.50s | whole-table aggregate, not indexable |
| ├ `PlayerMapStats` GROUP BY | 2.58s | whole-table aggregate, not indexable |
| ├ `PlayerServerStats` read | 2.13s | non-covering index → row fetch per row |
| └ badge `DISTINCT` read | **12.04s** | non-covering; fetched every badge to keep one per player |
| roster load #2 (duplicate) | 1.33s | cache miss caused by load #1 never seeding the cache |
| period-scoped questions | 1.32s | one `PlayerStatsMonthly` query per month, 16 of them |
| achievement leader tallies | 6.80s | 4 queries the planner could not seek `PlayerName` on |
| everything else | 0.42s | fine |

The signature of the two big reads is `Execute << Read` — the command returns in milliseconds
and the *reader* takes seconds. That is row fanout with a per-row table fetch, not a
scan-before-first-row. On the network-attached volume each of those fetches is a ~1.38ms round
trip (see `deploy/NODE_TUNING.md`), so ~8,700 of them is 12 seconds.

## Changes

### 1. Duplicate roster load — `ArcadeService.cs`

`GetGlobalTriviaPoolAsync` called `LoadGlobalRosterFromDbAsync` directly. That bypasses the
`GetArcadeRosterAsync` memory cache *and* never seeds it, so the first question builder that
asked for the roster missed and rebuilt all six queries. Now goes through
`GetArcadeCandidatesAsync`.

### 2. Signature badge picked in SQL — `LoadSignatureBadgesAsync`

Was: select every distinct `(PlayerName, AchievementName)` pair for 150 players, then keep an
arbitrary one each. Now: `GROUP BY PlayerName` with `MIN(AchievementName)`, covered by a new
index. The chosen badge was already arbitrary and is now merely deterministic — it feeds the
Mystery Soldier "Signature Badge" clue, not trivia.

### 3. Per-month N+1 — `AddPeriodScopedTriviaQuestionsAsync`

One query per month became one query for all of them. The filter is a **range** over
`(Year, Month)`, not an `IN` list of packed `Year*100+Month` keys: the arithmetic expression is
opaque to the planner and would scan the table, while the range seeks
`IX_PlayerStatsMonthly_Year_Month`.

### 4. Covering indexes — `20260906030330_AddArcadeTriviaCoveringIndexes`

- `PlayerAchievements(PlayerName, AchievementName)`
- `PlayerAchievements(AchievementType, PlayerName, AchievementId)`
- `PlayerServerStats(PlayerName, ServerGuid, TotalRounds)`

The second is the interesting one. `IX_PlayerAchievements_AchievementType_ServerGuid_PlayerName_AchievedAt`
looks like it should serve `AchievementType = ? AND PlayerName IN (…)`, but `ServerGuid` sits at
position 2 unconstrained, which puts `PlayerName` out of reach for seeking. Verified on a
synthetic 600k-row copy at production cardinality with `ANALYZE` run:

```
before: SEARCH USING COVERING INDEX …_AchievementType_ServerGuid_PlayerName_AchievedAt (AchievementType=?)
        + USE TEMP B-TREE FOR GROUP BY
after:  SEARCH USING COVERING INDEX …_AchievementType_PlayerName_AchievementId (AchievementType=? AND PlayerName=?)
```

It was seeking on the type alone and walking every row of it. Warm local timings on that copy
were 9–34x faster; the production gain should be larger, because what the indexes remove is
precisely the random row fetches that cost a network round trip each.

**Rollout note:** three index builds over full tables, run by `Database.MigrateAsync()` before
the API serves traffic. The rollout that picks this up starts slowly.

### 5. Keeping the build off the request path

`ArcadeTriviaPoolCache` (singleton) + `ArcadeTriviaWarmupBackgroundService`.

The two whole-table `GROUP BY`s are ~5s and **no index removes them** — the only fix is that no
user waits on them. The cache:

- **single-flights** builds per key, so N concurrent cold requests cause one build, not N
  (the old behaviour was N, which is the worst possible thing to do to a 691-IOPS volume);
- **serves stale and refreshes behind** — fresh for 30 min, servable for 12 h;
- is warmed for the global pool at startup and every 30 min, so the only synchronous build is
  a pod with a completely empty cache.

Server-scoped pools are not warmed — one per tracked server, much cheaper, and warming them all
would be a burst of full-table work. They use the serve-stale path.

**On cache duration and repetition:** question *selection* is a fresh
`RandomNumberGenerator` shuffle over the entire pool on every request
(`SelectDiverseTriviaQuestions`), so a long-lived pool cannot cause repetitive quizzes. Only a
small pool can, and the global pool holds ~695 questions. The roster TTL went 30 min → 6 h for
the same reason. The only cost of a stale pool is stat drift, and these are monthly and career
aggregates.

## UI — `MmArcadeSkeleton.vue`

All three arcade games replaced their spinner with a skeleton that traces the real layout, so
the page paints instantly and the swap is a fill rather than a jump.

- `quiz` — progress bar, meta row, two question lines, four option rows (or a 2×2 tile grid for
  theater-identification questions)
- `pips` — the step tracker, which lives in the top bar rather than the quiz box and so has to be
  placed separately; without this the pips would appear late and shift the bar
- `headToHead` — two combatant cards flanking the VS badge, stacking on mobile like the real arena
- `dossier` — the Mystery Soldier clue grid

`MmFieldTriviaGame` remembers the shape of the last quiz (question count, option count, tiles vs
list) so a reload skeletons into the layout the user is about to get. The seed values are what
the endpoint always returns — five questions, four options — so even the first load is right.

Accessibility: the placeholders are `aria-hidden` with one `role="status"` live region; the
shimmer is disabled under `prefers-reduced-motion`.

## Expected result

~29.2s → ~5.5s to build, and ~0ms perceived, since the build no longer happens on a request.

## Verification

`./scripts/verify.sh` — 245 API unit tests pass, 136 E2E pass. Three E2E failures
(`leaderboard.spec.ts:792`, `leaderboard.spec.ts:843`, `server-details.spec.ts:498`) are
pre-existing and were confirmed failing on a clean tree with these changes stashed.

Two new E2E tests in `e2e/arcade.spec.ts` hold the quiz and matchup responses open and assert
the skeleton is up, has the right shape, and is gone once content lands.
