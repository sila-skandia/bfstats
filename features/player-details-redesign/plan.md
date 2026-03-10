# Player Details Page Redesign

## Context

User feedback identified that the player details page suffers from:
1. **No visual hierarchy** - every panel uses the same background and border treatment, so important panels (Best Scores, Servers/Rankings) blend in with contextual panels
2. **Competitive Rankings feels stale** - shows a static paginated list of all maps; rarely changes
3. **Map/Server Slicing is bland** - shows a static table; interesting data but no sense of trend or change
4. **Performance data is hidden** - K/D and kill rate trends are hover-only micro charts, not discoverable
5. **Missing features** - no map preference rolling window, no online activity heatmap

User has explicitly authorized a bold redesign: theme, color, layout changes are all in scope.

---

## Visual Direction: Three-Tier Panel Hierarchy

Core change: introduce **semantic tier CSS classes** so panels communicate their importance visually.

```
TIER 2 (standard/analytical): BREAKDOWN, COMPETITIVE RANKINGS, MAP RACE
  background: #0d1117 (--bg-panel) | border: 1px solid #30363d

TIER 3 (trophy/highlight): BEST SCORES, MAP PREFERENCE, SERVERS
  background: #111827 | border-left: 3px solid amber
  Signals "your achievements" - stands out in the right column

TIER 4 (achievement): ACHIEVEMENTS
  background: linear-gradient(purple-tinted) | border: purple accent
```

Add to `/ui/src/views/PlayerDetails.vue.css`:
```css
.explorer-card--trophy {
  background: #111827;
  border-color: rgba(245, 158, 11, 0.25);
  border-left: 3px solid rgba(245, 158, 11, 0.5);
}
.explorer-card--trophy .explorer-card-title { color: var(--neon-gold); }

.explorer-card--achievement {
  background: linear-gradient(135deg, var(--bg-panel) 0%, rgba(168,85,247,0.06) 100%);
  border-color: rgba(168, 85, 247, 0.2);
}
.explorer-card--achievement .explorer-card-title { color: #a855f7; }
```

---

## New Page Layout

```
┌────────────────────────────────────────────────────────────────┐
│  PLAYER HEADER (full width)                                    │
├────────────────────────────────────────────────────────────────┤
│  PERFORMANCE TRENDS (full width, always visible)               │
│  [ K/D Ratio 90-day line ]   [ Kill Rate 90-day line ]         │
├─────────────────────────────┬──────────────────────────────────┤
│  LEFT (xl:col-span-7)       │  RIGHT (xl:col-span-5)          │
│  ─ BREAKDOWN (tier-2)       │  ─ ACHIEVEMENTS (tier-4)        │
│  ─ COMPETITIVE RANKINGS     │  ─ BEST SCORES (tier-3 amber)   │
│    (chart-first, metric tog)│  ─ MAP PREFERENCE (tier-3 amber)│
│  ─ MAP PERF OVER TIME       │  ─ SERVERS (tier-3 amber)       │
│    (race chart, new panel)  │  ─ ACTIVITY HEATMAP (tier-2)    │
└─────────────────────────────┴──────────────────────────────────┘
```

The right column's amber-tinted panels create an immediate "trophy shelf" contrast vs the left column's cyan-tinted analytical panels.

---

## Milestone 1: Backend API Additions

### 1A: Expose existing map stats (PlayersController)
Already implemented as a service method. Just wire to HTTP.

**`/api/Players/PlayersController.cs`** — add:
```csharp
[HttpGet("{playerName}/map-stats")]
public async Task<ActionResult<List<ServerStatistics>>> GetPlayerMapStats(
    string playerName,
    [FromQuery] string game = "bf1942",
    [FromQuery] int days = 30)
{
    playerName = Uri.UnescapeDataString(playerName);
    var period = days <= 30 ? TimePeriod.Last30Days : TimePeriod.AllTime;
    var result = await sqlitePlayerStatsService.GetPlayerMapStatsAsync(playerName, period);
    return Ok(result);
}
```

### 1B: Activity heatmap endpoint (new)

**New `/api/DataExplorer/Models/PlayerActivityHeatmapDto.cs`:**
```csharp
namespace api.DataExplorer.Models;
public record PlayerActivityHeatmapResponse(string PlayerName, List<HeatmapCellDto> Cells, int TotalDays);
public record HeatmapCellDto(int DayOfWeek, int Hour, int MinutesActive, string? MostPlayedMap);
```

**`/api/DataExplorer/IDataExplorerService.cs`** — add signature:
```csharp
Task<PlayerActivityHeatmapResponse?> GetPlayerActivityHeatmapAsync(string playerName, int days);
```

**`/api/DataExplorer/DataExplorerServiceOptimized.cs`** — implement by pulling sessions in-memory and grouping by `session.StartTime.DayOfWeek` + `session.StartTime.Hour` (avoids SQLite dialect issues with `strftime`):
```csharp
var sessions = await dbContext.PlayerSessions
    .Where(ps => ps.PlayerName == playerName && ps.StartTime >= cutoff && !ps.IsDeleted)
    .Select(ps => new { ps.StartTime, ps.LastSeenTime, ps.MapName })
    .ToListAsync();
// Group in-memory, compute minutes from StartTime/LastSeenTime diff, find MostPlayedMap per cell
```

**`/api/DataExplorer/DataExplorerController.cs`** — add:
```csharp
[HttpGet("players/{playerName}/activity-heatmap")]
public async Task<ActionResult<PlayerActivityHeatmapResponse>> GetPlayerActivityHeatmap(
    string playerName, [FromQuery] string game = "bf1942", [FromQuery] int days = 90)
```

### 1C: Map performance timeline endpoint (new)

**New `/api/DataExplorer/Models/MapPerformanceTimelineDto.cs`:**
```csharp
public record MapPerformanceTimelineResponse(string PlayerName, string Game, List<MapTimelineMonthDto> Months);
public record MapTimelineMonthDto(int Year, int Month, string MonthLabel, List<MapTimelineEntryDto> Maps);
public record MapTimelineEntryDto(string MapName, int Kills, int Deaths, double KdRatio, int Score, int Sessions, double PlayTimeMinutes);
```

**`/api/DataExplorer/IDataExplorerService.cs`** — add:
```csharp
Task<MapPerformanceTimelineResponse?> GetMapPerformanceTimelineAsync(string playerName, string game, int months);
```

**`/api/DataExplorer/DataExplorerServiceOptimized.cs`** — implement by querying `dbContext.PlayerMapStats` filtered by `ServerGuid == ""` (global sentinel) + date range, grouped by `(Year, Month)`:
```csharp
var cutoff = DateTime.UtcNow.AddMonths(-months);
var stats = await dbContext.PlayerMapStats
    .Where(m => m.PlayerName == playerName && m.ServerGuid == "" && ...)
    .ToListAsync();
// Group by (Year, Month), then by MapName within each month
```

**`/api/DataExplorer/DataExplorerController.cs`** — add:
```csharp
[HttpGet("players/{playerName}/map-performance-timeline")]
public async Task<ActionResult<MapPerformanceTimelineResponse>> GetMapPerformanceTimeline(
    string playerName, [FromQuery] string game = "bf1942", [FromQuery] int months = 12)
```

---

## Milestone 2: Frontend Types and Services

**`/ui/src/types/playerStatsTypes.ts`** — append interfaces:
```typescript
export interface HeatmapCell { dayOfWeek: number; hour: number; minutesActive: number; mostPlayedMap?: string; }
export interface ActivityHeatmapResponse { playerName: string; cells: HeatmapCell[]; totalDays: number; }
export interface MapTimelineEntry { mapName: string; kills: number; deaths: number; kdRatio: number; score: number; sessions: number; playTimeMinutes: number; }
export interface MapTimelineMonth { year: number; month: number; monthLabel: string; maps: MapTimelineEntry[]; }
export interface MapPerformanceTimelineResponse { playerName: string; game: string; months: MapTimelineMonth[]; }
export interface PlayerMapStatEntry { mapName: string; totalScore: number; totalKills: number; totalDeaths: number; sessionsPlayed: number; totalPlayTimeMinutes: number; kdRatio: number; }
```

**`/ui/src/services/playerStatsApi.ts`** — add three fetch functions:
- `fetchPlayerActivityHeatmap(playerName, game, days)`
- `fetchMapPerformanceTimeline(playerName, game, months)`
- `fetchPlayerMapStats(playerName, game, days)`

---

## Milestone 3: New Vue Components

### `PlayerActivityHeatmap.vue`
**Path: `/ui/src/components/PlayerActivityHeatmap.vue`**
- Props: `playerName: string`, `game?: string`
- Fetches `/data-explorer/players/{name}/activity-heatmap`
- 7-row × 24-column CSS Grid (no chart library)
- Cell color: 5-step opacity scale from `var(--bg-panel)` → `var(--neon-cyan)`
- Hover tooltip: day name, hour range, minutes active, most played map
- Toggle: `[ HEATMAP ] [ TABLE ]` — table shows sorted (dayName, hourRange, minutesActive) list

### `PlayerMapPreference.vue`
**Path: `/ui/src/components/PlayerMapPreference.vue`**
- Props: `playerName: string`, `game?: string`
- Fetches `/players/{name}/map-stats?days=30`
- Hero card: top map by `totalPlayTimeMinutes` in last 30 days, with K/D + sessions
- Below: mini CSS horizontal bars for top 5 maps (width = % of max playtime)
- Compact enough for right column

### `PlayerCompetitiveRankingsChart.vue`
**Path: `/ui/src/components/data-explorer/PlayerCompetitiveRankingsChart.vue`**
- Props: `rankings: MapRanking[]`, `sortBy?: 'kdRatio' | 'kills' | 'timePlayed' | 'score'`
- Chart.js horizontal bar chart (`indexAxis: 'y'`)
- Metric toggle: `[ K/D ] [ KILLS ] [ TIME ] [ SCORE ]` — default K/D
- Bar colors: gradient cyan opacity by rank; #1 rank bars in neon-gold
- Top 15 maps max to avoid overflow
- Tooltips show full stats (score, kills, deaths, rank, percentile)

**Modify `/ui/src/components/data-explorer/PlayerCompetitiveRankings.vue`:**
- Add view toggle inside "CURRENT RANKINGS" tab: `[ CHART ] [ LIST ]`
- Chart is default; existing list becomes fallback
- Import `PlayerCompetitiveRankingsChart` and show when chart mode active

### `MapPerformanceRace.vue` (integrated into BREAKDOWN as new tab)
**Path: `/ui/src/components/data-explorer/MapPerformanceRace.vue`**
- Props: `playerName: string`, `game?: string`
- Fetches `/data-explorer/players/{name}/map-performance-timeline`
- Animated horizontal bar chart race (Chart.js)
- State: `currentMonthIndex ref`, `isPlaying ref`, `playbackSpeed ref`
- Controls: `[▶ PLAY] [||PAUSE]`, month scrubber `<input type="range">`, metric toggle `[K/D] [SCORE] [KILLS]`
- Animation: `setInterval` @ 800ms, each tick: update chart data sorted desc by selected metric (top 10 maps), call `chart.update('active')`
- Color stability: each map gets deterministic color from string hash so bars maintain color across frames
- Month label rendered prominently above chart

**No changes to `PlayerDetailPanel.vue`** - race chart lives in its own dedicated panel below COMPETITIVE RANKINGS, not inside BREAKDOWN.

---

## Milestone 4: Layout and Wiring in `PlayerDetails.vue`

**`/ui/src/views/PlayerDetails.vue`:**
1. Import `PlayerActivityHeatmap`, `PlayerMapPreference`, `MapPerformanceRace` (new components)
2. Add `explorer-card--trophy` class to Best Scores, Servers, Map Preference cards
3. Add `explorer-card--achievement` class to Achievements card
4. Trend charts: move out of hover-popover into a dedicated **always-visible full-width section** between the header and the two-column layout; renders two side-by-side `<Line>` charts (K/D Ratio + Kill Rate) at a proper size (250-300px height)
5. Add `<MapPerformanceRace>` as a separate panel in the left column, below COMPETITIVE RANKINGS
6. Add `<PlayerMapPreference>` to right column (between Best Scores and Servers)
7. Add `<PlayerActivityHeatmap>` to bottom of right column

**`/ui/src/views/PlayerDetails.vue.css`:**
- Add `.explorer-card--trophy` styles (amber border-left, different bg)
- Add `.explorer-card--achievement` styles (purple gradient bg)

---

## Milestone 5: Feature Documentation

**`/features/player-details-redesign/plan.md`** — store design decisions:
- Three-tier card hierarchy rationale
- New endpoint routes and data shapes
- Component APIs
- Why chart-first for competitive rankings

---

## Full Implementation Checklist

### Phase 1: Backend
- [x] `api/Players/PlayersController.cs` — add `GET {name}/map-stats` action
- [x] `api/DataExplorer/Models/PlayerActivityHeatmapDto.cs` — new file with records
- [x] `api/DataExplorer/Models/MapPerformanceTimelineDto.cs` — new file with records
- [x] `api/DataExplorer/IDataExplorerService.cs` — add 2 method signatures
- [x] `api/DataExplorer/DataExplorerServiceOptimized.cs` — implement both methods
- [x] `api/DataExplorer/DataExplorerController.cs` — add 2 new endpoints

### Phase 2: Frontend Types + Services
- [x] `ui/src/types/playerStatsTypes.ts` — append 6 new interfaces
- [x] `ui/src/services/playerStatsApi.ts` — add 3 new fetch functions

### Phase 3: New Components
- [x] Create `ui/src/components/PlayerActivityHeatmap.vue`
- [x] Create `ui/src/components/PlayerMapPreference.vue`
- [x] Create `ui/src/components/data-explorer/PlayerCompetitiveRankingsChart.vue`
- [x] Create `ui/src/components/data-explorer/MapPerformanceRace.vue`
- [x] Modify `ui/src/components/data-explorer/PlayerCompetitiveRankings.vue` — add chart-first toggle
- [x] `ui/src/views/PlayerDetails.vue` — add `<MapPerformanceRace>` as dedicated panel in left column below COMPETITIVE RANKINGS

### Phase 4: Layout + Theme
- [x] `ui/src/views/PlayerDetails.vue.css` — add `--trophy` and `--achievement` card tier classes
- [x] `ui/src/views/PlayerDetails.vue` — import new components, apply tier classes, wire MapPreference + ActivityHeatmap, promote trend charts to always-visible collapsible

### Phase 5: Docs
- [x] Create `features/player-details-redesign/plan.md` (already exists)

---

## Critical Files

| File | Change |
|------|--------|
| `api/Players/PlayersController.cs` | Wire map-stats to existing service |
| `api/DataExplorer/DataExplorerController.cs` | Add 2 new endpoints |
| `api/DataExplorer/DataExplorerServiceOptimized.cs` | Implement heatmap + timeline queries |
| `api/DataExplorer/IDataExplorerService.cs` | 2 new method signatures |
| `ui/src/views/PlayerDetails.vue` | Main layout orchestration |
| `ui/src/views/PlayerDetails.vue.css` | Tier card hierarchy CSS |
| `ui/src/components/data-explorer/PlayerCompetitiveRankings.vue` | Chart-first redesign |
| `ui/src/components/data-explorer/PlayerDetailPanel.vue` | TIMELINE tab addition |

## Verification

1. Start API: `cd api && dotnet run`
2. Test new endpoints via browser or curl:
   - `GET /stats/players/SomePlayer/map-stats?days=30`
   - `GET /stats/data-explorer/players/SomePlayer/activity-heatmap?days=90`
   - `GET /stats/data-explorer/players/SomePlayer/map-performance-timeline?months=12`
3. Start UI: `cd ui && npm run dev`
4. Navigate to `/players/SomePlayer`
5. Verify: amber border on Best Scores + Servers panels
6. Verify: Competitive Rankings defaults to horizontal bar chart
7. Verify: BREAKDOWN panel shows TIMELINE tab → animated race chart
8. Verify: activity heatmap renders in right column with day/hour grid
9. Verify: map preference card shows top map from last 30 days
