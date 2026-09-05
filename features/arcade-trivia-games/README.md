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
  - After solving or finishing (Daily or Random), players can immediately proceed to the next soldier via **"Next Soldier (Keep Going)"** / Enter shortcut.
  - Solving Daily transitions smoothly into endless practice mode without leaving the page.
  - Consecutive rounds automatically exclude the just-identified soldier (`?exclude=`) to avoid immediate repeats.
  - Active session HUD tracks continuous Streak, Best Streak, and Total Solved using tactical color-coded badges (strictly no emojis).

### 3. Field Lore (Battlefield Trivia)
A 5-question tactical quiz dynamically generated **only** from live and historical database statistics. There are no hardcoded lore, radio-key, or vehicle trivia questions.
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
Minigames can be scoped to any community server (e.g. MoonGamers, SiMPLE, etc.):
- **Server Selector**: Quick pills for top community servers + searchable popover for all tracked servers.
- **Server-Specific Matchups**: Higher or Lower compares regulars using that server's `PlayerMapStats` when they share a map, otherwise `PlayerServerStats` career totals.
- **Server Dossiers**: Mystery Soldier selects notable veterans and regulars of that server, with a multiple-choice suspect roster drawn from that server's candidate pool.
- **Server-Specific Lore**: Trivia asks about the server's most contested maps, single-round score record holders (`PlayerBestScores`), map-scoped top killers on the server, longest average round maps, and faction win balances (`ServerMapStats.Team1Victories` vs `Team2Victories`).

## Performance & Caching Strategy

In accordance with single-node Hetzner constraints:
- Candidate pool (top active players from `PlayerStatsMonthly` or `PlayerServerStats`, maps from `ServerMapStats` / `MapGlobalAverages`, servers from `GameServer`) is compiled into an in-memory cache (`IMemoryCache`) with a 30-minute sliding expiration per server scope (`Arcade:Candidates:{serverGuid ?? "global"}`).
- Minigame requests do **not** perform expensive full-table scans for Higher/Lower and Mystery. Trivia map/period sampling queries only maps and months that already have enough distinct players (bounded top-N lists). Combinatorial trivia loads a bounded player-map fact set (top maps + top players) and instantiates templates in memory.
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
| `/stats/arcade/players/search` | GET | Fast autocomplete search across arcade candidate pool, optionally scoped to `?serverGuid=` (used by admin tooling; Mystery Soldier uses `candidateOptions` instead). |

## UI & Design

- Hosted at `/v4/arcade`.
- Designed with `.mm` Neutral Depth tokens (`--mm-*`).
- Audio toggle (Mute / Sound On) utilizing authentic BF1942 radio comms in `/radio-sounds`.
- Fully responsive on mobile (≤640px) and desktop (≥881px).
- No emojis — status and feedback use PrimeIcons, CSS indicators, and country micro-badges.
