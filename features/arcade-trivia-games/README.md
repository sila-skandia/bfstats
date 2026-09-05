# BFStats Arcade: Operation Intel (Trivia & Guessing Minigames)

Interactive, replayable mini-games powered directly by real BF1942 player sessions, map records, and server statistics.

## Game Modes

### 1. Higher or Lower (Stat Showdown)
Two combatants face off. The prompt is a full-width bar so the question is never hidden in the VS gutter. Card 1 shows a verified stat; card 2 is masked: is their value **Higher** or **Lower**?
- **Shared-map matchups first**: when both players have enough time on the same map, the round compares that map (kills, score, hours, K/D, rounds, or kill rate) instead of repeating career totals.
- Career kills / score / hours / K/D are the fallback when no shared map qualifies.
- **Audio Feedback**: Authentic BF1942 radio cues (`roger.mp3` for correct, `negative.mp3` for incorrect).
- **Streak**: tracked in the HUD; best streak is stored locally.

### 2. Mystery Soldier (Classified Dossier)
A daily (or endless/practice) guessing challenge inspired by Wordle / Poeltl with continuous play and dynamic variable stats:
- A mystery veteran is selected from active players with substantial history.
- **Dynamic Variable Attributes**: Rather than static fixed clues, each round dynamically selects 5-6 diverse stats tailored to the target soldier's profile, including:
  - Career metrics: Total Kills bracket, Career K/D bracket, Playtime tier, Total Score bracket
  - Map highlights: Map with Best Score, Highest Kill Rate Map, Most Kills Map, Most Played Map
  - Social & Community: Top Squad Buddy (frequent co-player from Neo4j `PLAYED_WITH`), Primary Home Server
  - Combat Persona: Signature Badge / Medal
- **Multiple-choice suspect roster**: Each dossier includes 4-5 `CandidateOptions` (the secret target plus 3-4 distractors from the candidate pool). Players investigate suspects one at a time — no free-form search across the full player base.
- **Dynamic Comparison Table**: Each investigation reveals match attributes corresponding to this mission's chosen columns:
  - Numeric metrics (Kills, Time, K/D, Score): Match (within tolerance) / Higher / Lower directional indicators
  - Text & Categorical metrics (Maps, Servers, Neo4j Buddy, Badge): Match / Mismatch
- **Continuous Play & Streaks**:
  - Players can continue to the next soldier at any time—either after solving, by clicking **"Next Soldier"** (skip), or via **"Reveal Target"** if stuck, without having to guess the correct answer.
  - After solving or conceding (Daily or Random), players can immediately proceed via **"Next Soldier (Keep Going)"** / Enter shortcut.
  - Solving or skipping Daily transitions smoothly into endless practice mode without leaving the page.
  - Consecutive rounds automatically exclude the just-identified or skipped soldier (`?exclude=`) to avoid immediate repeats.
  - Active session HUD tracks continuous Streak, Best Streak, and Total Solved using tactical color-coded badges (strictly no emojis).

### 3. Field Lore (Battlefield Trivia)
A 5-question tactical quiz dynamically generated **only** from live and historical database statistics. There are no hardcoded lore, radio-key, or vehicle trivia questions.

**Blind theater**: when a question is about a map (or the answers *are* maps) and official spawn-screen art exists, the map name is concealed. The UI shows the extracted BF1942 `InGameMap` instead — a briefing plate behind map-scoped questions, or a 2x2 spawn-select grid for map answers. Names print after the guess. Custom maps without art keep the text buttons. Spawn-screen WebPs are not in git and are not bundled in the UI image. They live on the assets volume (FileBrowser) and are served only at `/stats/assets/arcade/maps/{slug}/ingame.webp`. Extract locally with `scripts/extract-bf1942-map-art.py`; upload with `scripts/upload-arcade-map-art.sh`. Missing volume files hide the image — there is no UI fallback path.
- **Combinatorial player-map templates** (`TriviaQuestionComposer` + `PlayerMapStats`): metric templates (kills, kill rate, K/D, score, playtime, rounds) are crossed with players and maps at quiz time. No canned question rows are stored.
  - Player → map: "On which map has ApexSoldier recorded the most kills?" / highest kill rate / highest K/D
  - Map → player: "On Wake Island, which combatant has the highest Kill/Death ratio?"
- **Period-scoped monthly records** (`PlayerStatsMonthly`): e.g. "In October 2024, which soldier topped the monthly leaderboard with the most kills?"
- **Map-scoped single-round records** (`PlayerBestScores`): e.g. "On Stalingrad, who holds the record for highest single-round score?"
- Map lethality (highest kill rate per minute from `MapGlobalAverages`)
- Most contested maps and longest average round durations (`ServerMapStats`)
- Server occupancy and regular-combatant counts (`GameServer` / `PlayerServerStats`)
- Faction victory balances on a server/map (`ServerMapStats.Team1Victories` vs `Team2Victories`)
- Generic all-time career crowns are avoided when scoped map/period data is available (keeps quizzes challenging and unique)
- Instant explanations with real database numbers

### 4. Optional identity (Who am I)
Players can optionally identify themselves at the top of Arcade. This does **not** change any stored stats. It only changes **who appears**:
- The candidate pool becomes that soldier plus their top 100 Neo4j `PLAYED_WITH` neighbors (already cached, one indexed graph read).
- If the orbit is too small, the usual top-score roster fills in so games still work.
- Field Lore can add relationship questions built from that same neighbor list: most overlapping sessions (wingman), longest co-play history, and most recent shared round.
- Opposite-team / "who opposed you" is **not** asked here. That answer is a heavy SQLite session scan (Wrapped yearly crunch), not a Neo4j property.

### 5. Community Server Filtering
A server is **required** before any minigame loads. The all-servers / global pool is not offered — that roster is too large and makes Higher or Lower, Mystery Soldier, and Field Lore too slow.
- **Server Selector**: Required picker plus quick pills for top community servers and a searchable popover for all tracked servers. The last choice is remembered in localStorage and the `?server=` query.
- **Server-Specific Matchups**: Higher or Lower compares regulars using that server's `PlayerMapStats` when they share a map, otherwise `PlayerServerStats` career totals.
- **Server Dossiers**: Mystery Soldier selects notable veterans and regulars of that server, with a multiple-choice suspect roster drawn from that server's candidate pool.
- **Server-Specific Lore**: Trivia asks about the server's most contested maps, single-round score record holders (`PlayerBestScores`), map-scoped top killers on the server, longest average round maps, and faction win balances (`ServerMapStats.Team1Victories` vs `Team2Victories`).

## Performance & Caching Strategy

In accordance with single-node Hetzner constraints:
- Candidate pool is **query-built only**: top regulars from `ServerPlayerRankings` / latest-week `PlayerServerStats` (server) or `PlayerStatsMonthly` (global). There is no synthetic fallback roster. An empty query returns an empty pool and the minigame fails with "Not enough tracked regulars" rather than inventing soldiers. Case-variant spellings of the same soldier (SQLite `GROUP BY` is case-sensitive) are collapsed before matchups so roster dictionaries cannot throw on duplicate keys. Unexpected failures return a short retry message; stack traces stay in logs.
- That pool is compiled into an in-memory cache (`IMemoryCache`) with a 30-minute sliding expiration per server scope (`Arcade:Roster:{serverGuid}:{orbit}`). Empty pools are not cached.
- The server picker (`/servers`) ranks from `ServerMapStats` playtime and latest-week `PlayerServerStats` row counts. It does not `COUNT(DISTINCT)` the full weekly table.
- Minigame requests do **not** perform expensive full-table scans for Higher/Lower and Mystery. Trivia never walks `PlayerMapStats` or `PlayerSessions` just to discover maps: top maps come from `ServerMapStats` (then `MapGlobalAverages`).
- Combinatorial facts reuse the arcade roster already loaded for Higher/Lower and Mystery (top 40 by career kills, plus those soldiers' map snapshots). They do **not** `GROUP BY PlayerName` across `PlayerMapStats` for a server's top maps — that scan was 33s on a busy server and the quiz request was cancelled (HTTP 499) before the 20-minute pool cache could warm.
- Round records (`PlayerBestScores`), yearly leaders (`PlayerServerStats`), and achievement tallies are restricted to roster player names so SQLite can seek the player-leading primary keys instead of sorting or aggregating the whole server.
- Server roster load prefers `ServerPlayerRankings` (covering index) or the latest weekly bucket to seed names, then aggregates `PlayerServerStats` only for those names.
- Memory footprint is strictly bounded (< 2 MB for candidate records).

## API Endpoints

Base path: `/stats/arcade`

| Endpoint | Method | Description |
|---|---|---|
| `/stats/arcade/servers` | GET | Returns active servers with player counts and candidate counts. |
| `/stats/arcade/higher-lower/next` | GET | Returns a pair of combatants. Prefers a shared-map metric (kills, score, hours, kd, rounds, kill rate) and falls back to career totals. Optional `?orbitPlayer=` biases the pool toward that soldier's Neo4j co-play orbit. |
| `/stats/arcade/higher-lower/reveal` | POST | Validates user guess ('higher' or 'lower') against round token, returning revealed value, result, and next card candidate. |
| `/stats/arcade/mystery/today` | GET | Returns the daily classified dossier with `candidateOptions` suspect roster (redacted name, seed based on UTC date), optionally scoped to `?serverGuid=` and `?orbitPlayer=`. |
| `/stats/arcade/mystery/random` | GET | Returns a random classified dossier with `candidateOptions` for practice/endless mode, optionally scoped to `?serverGuid=`, `?orbitPlayer=`, and `?exclude=`. |
| `/stats/arcade/mystery/guess` | POST | Submits a player name guess against a dossier token; returns comparative clue indicators. |
| `/stats/arcade/trivia/quiz` | GET | Generates a 5-question trivia quiz from current stats (map/period scoped when data allows), customized to `?serverGuid=` and `?orbitPlayer=` when provided. |
| `/stats/arcade/trivia/verify` | POST | Validates trivia answers and returns explanations with real stats. |
| `/stats/assets/arcade/{path}` | GET | Spawn-screen WebP from the assets volume (`arcade/maps/{slug}/ingame.webp`). |
| `/stats/arcade/players/search` | GET | Fast autocomplete search across arcade candidate pool, optionally scoped to `?serverGuid=` (used by admin tooling; Mystery Soldier uses `candidateOptions` instead). |

## UI & Design

- Hosted at `/v4/arcade`.
- Designed with `.mm` Neutral Depth tokens (`--mm-*`).
- Field Lore and Higher/Lower prompts emphasize interpolated entities (player names, maps, servers, month/year) as mono callsign marks so sentence-like names do not blend into the question.
- Field Lore theater recon loads spawn-screen maps only from `/stats/assets/arcade/maps/{slug}/ingame.webp` (assets volume / FileBrowser). There is no bundled `/arcade/maps` copy. Missing art falls back to the text option grid.
- Audio toggle (Mute / Sound On) utilizing authentic BF1942 radio comms in `/radio-sounds`.
- Fully responsive on mobile (≤640px) and desktop (≥881px).
- No emojis — status and feedback use PrimeIcons, CSS indicators, and country micro-badges.
