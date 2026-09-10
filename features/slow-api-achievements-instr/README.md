# Slow `GET /stats/gamification/achievements` — PlayerName / AchievementId `instr()` scan

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`.

## Trace

`GET /stats/gamification/achievements?playerName=Dima&achievementId=kill_streak_20&page=1&pageSize=25&sortBy=AchievedAt&sortOrder=desc`

TraceId `3037af572506d67df82b4a147cdd91e6` at 2026-09-10 02:20:29–47Z. HTTP 200, **18.2s**. Chrome, not a bot. Pod `bf42-stats-7846d8b758-q9jlk`.

Caller is the player-page occurrence drill-in (`MmPlayerAchievementSummary.fetchOccurrencesPage`). It always sends the stored player name and the selected group's exact achievement id.

| span | cost | SQL |
|---|---|---|
| COUNT | **2,376ms** | `WHERE instr(PlayerName) AND instr(AchievementId)` |
| page | **11,107ms** | same `instr` + `ORDER BY AchievedAt DESC LIMIT 25` |
| distinct IDs | 2ms | `WHERE PlayerName = @playerName` |

Same endpoint earlier the same night for `Anna Trocken` (playerName only, pageSize=50) was **5.5s** — same `instr(PlayerName)` shape, under the 10s page.

## Cause

`SqliteGamificationService.GetAllAchievementsWithPagingAsync` compiled `PlayerName.Contains` / `AchievementId.Contains` to `instr()`. That cannot use:

- `IX_PlayerAchievements_PlayerName_AchievementId_AchievedAt`
- `IX_PlayerAchievements_PlayerName_AchievedAt`
- `IX_PlayerAchievements_AchievementId`

The DISTINCT lookup in the same request already used equality and finished in 2ms. On the Hetzner volume a full `PlayerAchievements` scan for COUNT + a sorted page is what crossed 10s.

`achievementType`, `tier`, and `serverGuid` on the same method were already equality.

## Change

Filter `PlayerName` and `AchievementId` with `==` so the existing unique / covering indexes serve COUNT and the sorted page.

No new index and no pragma change.

Substring search on this endpoint is no longer supported. The only UI caller sends exact stored values. Player search stays on `/stats/players`.

## Not this alert

Open **PR #36** (Rounds `MapName` `instr()`) is a different table. Do not re-implement it here.
