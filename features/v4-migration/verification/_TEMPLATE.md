# Verification — `<Page name>`

| | |
| --- | --- |
| **Legacy URL** | `/<legacy/path/example>` |
| **V4 URL** | `/v4/<v4/path/example>` |
| **Test fixture** | `<player or server used for the comparison, e.g. "player: Dylan, server: «Sample»">` |
| **Verified by** | `<name>` on `<YYYY-MM-DD>` |
| **Status** | 🟢 ship-ready · 🟡 ships with caveats · 🔴 blocked |

## 1. Routes & entry points

Every link in the app that should reach this page:

| Source | V4 link exists? | Reaches the right URL? |
| --- | --- | --- |
| `<e.g. PlayerDetailsV4 hero button "Sessions →">` | ✅ / ❌ | ✅ / ❌ |
| `<e.g. /v4/players/:name "View all" link in overview>` | | |

## 2. Network parity

Devtools network requests on initial load, with the test fixture above:

| Request | Legacy | V4 | Status |
| --- | --- | --- | --- |
| `GET /stats/players/foo/sessions?page=1&pageSize=25&playerName=foo` | ✅ | `GET /stats/sessions?page=1&pageSize=25` | ❌ — missing `playerName` filter |
| `GET …/insights?days=30` | ✅ | ✅ | ✅ |

Notes on intentional divergences:

- (e.g. "V4 doesn't poll busy-indicator every 30s — handled by the
  forecast modal instead. Documented.")

### 2a. Type-vs-payload parity

For every field the V4 template reads from an API response, verify the
backend actually populates it. The TS interface may declare fields that
no C# property sets, or may alias unrelated DTOs as the same type.

| Endpoint | Field referenced in V4 template | Present in payload? | C# property | Status |
| --- | --- | --- | --- | --- |
| `GET /stats/servers/:name` | `popularMaps` | ❌ no — `ServerStatistics` model has no `PopularMaps` | none | ❌ Dead field; need separate endpoint |
| `GET /stats/.../leaderboards` `topKDRatios[]` | `s.mapName`, `s.timestamp`, `s.score` | ❌ — `TopKDRatio` DTO only has PlayerName/Kills/Deaths/KDRatio/TotalRounds | n/a | ❌ Drop these refs |
| `GET /stats/.../leaderboards` `topKDRatios[].kdRatio` | `s.kdRatio` | ⚠️ — JSON serialises as `kDRatio` (camelCase only flips first letter); the TS field name doesn't match | `KDRatio` | ⚠️ Use fallback math or fix casing |

## 3. Feature parity

Walk through every visible feature on the legacy page:

| Feature | Legacy | V4 | Status |
| --- | --- | --- | --- |
| `<Page header with player name>` | ✅ | ✅ | ✅ Match |
| `<Filter: map name>` | ✅ | ✅ | ✅ Match |
| `<Filter: min participants>` | ✅ | ❌ | ❌ Missing |
| `<Pagination: 25 per page>` | ✅ | ✅ (default 100) | ⚠️ Divergence — V4 uses 25 default for readability |
| `<Player K/D overlay column>` | ✅ | ✅ | ✅ Match |
| `<Loading state>` | ✅ | ✅ | ✅ Match |
| `<Empty state copy>` | "No sessions" | "No sessions match the current filters." | ⚠️ Divergence — V4 copy is more useful |

## 4. Data parity

For the test fixture, eyeball the rendered data:

| Metric | Legacy | V4 | Match? |
| --- | --- | --- | --- |
| First round on page 1 | `<roundId / date>` | `<roundId / date>` | ✅ / ❌ |
| Total rounds in summary line | `1,234` | `1,234` | ✅ |
| Per-row K/D for the player | matches | matches | ✅ |

## 5. Navigation parity

| Outbound link | Goes to | V4 path? | Status |
| --- | --- | --- | --- |
| Click round row | round report | `/v4/rounds/:id/report` ✅ / `/rounds/...` ❌ | |
| Click server in row | server detail | | |
| "Back to player" link | player profile | | |

## 6. Interaction consistency

For each data type that appears in more than one place on the page,
verify it accepts the same interactions everywhere.

| Data type | Preview location(s) | Full-list location | Interaction wired everywhere? |
| --- | --- | --- | --- |
| `<e.g. Maps>` | `<Overview "Most played maps">` | `<Maps tab>` | ✅ / ❌ |
| `<e.g. Players>` | `<Overview "Most active">` | `<Ranks tab>` | ✅ / ❌ |

If any row in this table is ❌ — the user can click section A and it
drills, but section B with the same-looking row does nothing — list it
under Outstanding work.

## Outstanding work

- [ ] `<list any ❌ items that need fixing before this can ship>`

## Sign-off

When every ❌ above is resolved (either fixed or reclassified as ⚠️ with a
written reason), update the status at the top to 🟢 and tick this page off
on [`MATRIX.md`](./MATRIX.md).
