## Verification & Testing

After making any code changes, you **must** run the verification script. This script runs API unit tests and containerized Playwright E2E tests.

- **Full Verification**: `./scripts/verify.sh`
- **Fast Logic Check**: `./scripts/verify.sh --skip-e2e`
- **Targeted E2E**: `./scripts/verify.sh e2e/relevant-test.spec.ts --project=chromium`

### Feature to Test Mapping
- **Players/Search**: `e2e/player-search.spec.ts`, `e2e/players-extended.spec.ts`
- **Servers/Landing**: `e2e/landing.spec.ts`, `e2e/server-details.spec.ts`
- **Responsive/Mobile**: `e2e/responsive-mobile.spec.ts`
- **Data Explorer**: `e2e/data-explorer.spec.ts`
- **Tournament Management**: `e2e/tournament-management.spec.ts`, `e2e/tournament-management-deep.spec.ts`

If E2E tests fail, view the report on your host with: `npx playwright show-report ui/playwright-report`

---

## Folder Structure Convention

We use a **feature-first organization** pattern rather than type-based organization (no `/Services`, `/Controllers`, `/Models` at the root level).

### Pattern

**Feature folders** are organized by domain/feature with the following structure:
```
/FeatureName/
  ├── FeatureController.cs          (API endpoints, if applicable)
  ├── FeatureService.cs             (Business logic)
  ├── IFeatureService.cs            (Interface)
  ├── Models/
  │   ├── FeatureModel.cs
  │   └── ...
  └── [optional subfolders for cross-cutting concerns within the feature]
```

### Key Rules

1. **Feature folders are named by domain** (e.g., `Bflist`, `Gamification`, `PlayerStats`, `ServerStats`, `Caching`, `PlayerTracking`)
2. **Controllers go directly in the feature folder** - NOT in `/Controllers`
3. **Services and service implementations go directly in the feature folder** - NOT in `/Services`
4. **Models go in a `/Models` subfolder** within the feature
   - **Each DTO class should be in its own file** (e.g., `UserDto.cs`, `LoginRequest.cs`)
   - **Exception**: Small related value objects can be grouped if they form a cohesive domain concept
5. **Avoid root-level type-based folders** like `/Services`, `/Controllers`, `/Models`
6. **Shared/cross-cutting concerns** like `Telemetry` and `Caching` can be in their own feature folders
7. **Migrations and build artifacts** stay in their special folders (`/Migrations`, `/bin`, `/obj`, etc.)

### Example Structure

```
junie-des-1942stats/
├── Bflist/                         # BFList API integration feature
│   ├── BfListApiService.cs
│   ├── ServerFilteringConfig.cs
│   ├── LiveServersController.cs
│   ├── PlayerInfo.cs
│   └── Models/
│       ├── Bf1942ServerInfo.cs
│       ├── BfvietnamServerInfo.cs
│       └── ...
├── Gamification/                   # Tournaments and achievements feature
│   ├── GamificationService.cs
│   ├── GamificationController.cs
│   ├── AdminTournamentController.cs
│   ├── Services/
│   │   ├── TeamRankingCalculator.cs
│   │   ├── TournamentMatchResultService.cs
│   │   └── ...
│   └── Models/
│       ├── Achievement.cs
│       ├── KillStreak.cs
│       ├── BadgeDefinition.cs
│       └── ...
├── PlayerStats/                    # Player statistics feature
│   ├── PlayerStatsService.cs
│   ├── PlayersController.cs
│   └── Models/
│       ├── PlayerBasicInfo.cs
│       ├── PlayerFilters.cs
│       ├── ServerInfo.cs
│       └── ...
├── Auth/                           # Authentication feature
│   ├── TokenService.cs
│   ├── RefreshTokenService.cs
│   ├── DiscordAuthService.cs
│   ├── AuthController.cs
│   └── Models/
│       └── ...
├── Telemetry/                      # Cross-cutting concern
├── Caching/                        # Cross-cutting concern
├── Migrations/                     # Database migrations (special folder)
└── ...
```

### Benefits

- **Fast navigation**: Feature name matches folder name
- **Cohesion**: Related code lives together
- **Discoverability**: Easy to find all code related to a feature
- **Scalability**: Features can grow independently with their own services, controllers, models
- **DTO Organization**: Individual DTO files improve file discoverability and keep file sizes manageable

---

## Deployment constraints

**Production is a single Hetzner node: 4000m CPU, 7741Mi memory.** Everything runs on it — API,
UI, Seq, Neo4j, Redis, notifications, ingress. There is nowhere for a workload to spill over to.

Manifests live in `deploy/app/`. Every container has `requests` and `limits`; keep it that way.
An unbounded container here is a node outage waiting to happen, and one carrying
`priorityClassName: 1942-services` doubly so — top scheduling priority means the kubelet evicts
*everything else* first while the offender keeps growing.

The invariant to preserve: **the sum of all memory limits must leave ~1.5Gi for the OS, kubelet
and k3s system pods.** CPU limits may oversubscribe — CPU is compressible, so the scheduler
throttles rather than kills.

To check the budget before changing a limit:

```bash
grep -A6 -r "resources:" deploy/app/ --include="*.yaml" --include="*.yml"
```

### Before raising any memory-sized setting

Ask what multiplies it, then do the arithmetic against 7741Mi. Two multipliers bite here:

- **SQLite pragmas are per connection, and connections are pooled.** `PRAGMA cache_size` is not a
  process-wide budget — it is a per-connection reservation, so the real cost is the value times
  however many connections the pool holds (10–30 is normal between request concurrency and the
  background jobs). `mmap_size` likewise maps per connection, and mapped pages count toward the
  container's RSS and so against its cgroup limit.
- **.NET sizes its GC heap from the cgroup limit** (~75% by default). A container's memory limit
  is therefore also its GC back-pressure; removing the limit removes the back-pressure.

This is not hypothetical. `cache_size = -262144` (256 MiB) plus `mmap_size = 1GiB` were added to
`SqliteConnectionInterceptor` in Aug 2026 to speed up whole-table aggregate scans. Per connection,
across an unbounded pool, on an unbounded container, that took the node into memory-pressure
thrash and required a hard power-cycle. Reverted in `a1c5cfb`; limits added in `48c552d`.

Note that `SqliteConnectionInterceptor` applies to **every** connection in the process, so a
tuning change made for one feature lands on all of them, including the hourly
`AggregateCalculationService` and `RankingCalculationService` loops that sweep most of an 18GB
database.

---

## Conventions

- When we document our decisions or iterate on a design, we store the outcomes / tasklist / progress in a markdown file in `features/<feature-name>` where feature name is a brief descriptive name of the feature separated by hyphens
- Use the latest C# language features, e.g. primary constructors, collection expressions Tiers = ["bronze"] instead of Tiers = new[] { "bronze" }, and other features like range expressions and pattern matching.
- Use record types for DTOs and data structures that are primarily data carriers.
- All timestamp properties use NodaTime Instant type—must configure HasConversion() in OnModelCreating() with InstantPattern.ExtendedIso for EF Core mapping.
- Confirm every time you run a kubectl command, even if I've approved a kubectl command in the same chat, unless I explicitly say otherwise.

### Server and player name rendering

Server and player names are stored as raw mojibake (some clients/servers send cp1251 bytes that BFlist decodes as cp1252). We do **not** migrate the DB — `Player.Name` is the PK and `Server.Name` is used for queries. Names are decoded for display only.

- **Vue templates**: use `$pn(name)` (registered globally in `ui/src/main.js`). Example: `{{ $pn(server.name) }}`, `{{ $pn(player.playerName) }}`, `:title="$pn(server.name)"`, `:aria-label="$pn(player.playerName)"`.
- **`<script setup>` / TS**: `import { decodePlayerName, decodeServerName } from '@/utils/playerName'` and call directly (e.g. for chart `label`, computed display strings, `charAt(0)` initials).
- **C# server-rendered output** (banner images, Discord embeds, any other path that paints a name for human eyes): `api.Utils.PlayerNameDecoder.Decode(name)`.
- **Do NOT decode** for: `router.push` / `:to=` URLs, search query strings, dictionary/Set keys, FK joins, `v-for :key`, or anything compared against a stored name. Those paths must keep using the raw name.
- When adding a new component or template that surfaces a server or player name, default to `$pn(...)` unless the value is being used as an identifier.