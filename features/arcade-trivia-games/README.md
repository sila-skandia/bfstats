# BFStats Arcade: Operation Intel (Trivia & Guessing Minigames)

Interactive, replayable mini-games powered directly by real BF1942 player sessions, map records, and server statistics.

## Game Modes

### 1. Higher or Lower (Stat Showdown)
Two active combatants face off. Card 1 shows a soldier's verified stat (e.g. 14,200 kills or 350 hours played). Card 2 shows another soldier: is their stat **Higher** or **Lower**?
- **Audio Feedback**: Authentic BF1942 radio cues (`roger.mp3` for correct, `negative.mp3` for incorrect).
- **Streak & Promotion Ladder**: Private -> Corporal -> Sergeant -> Lieutenant -> Captain -> Major -> Colonel -> General of the Army.

### 2. Mystery Soldier (Classified Dossier)
A daily (or endless/practice) guessing challenge inspired by Wordle / Poeltl:
- A mystery veteran is selected from active players with substantial history.
- Clues revealed in their classified dossier:
  - Country of origin (ISO badge & name)
  - Favorite / most played map
  - Primary home server
  - Playtime tier (hours)
  - Career K/D bracket
  - Signature achievement / badge
- **Multiple-choice suspect roster**: each dossier includes 4-5 `CandidateOptions` (the secret target plus 3-4 distractors from the candidate pool). Players investigate suspects one at a time — no free-form search across the full player base.
- Each incorrect investigation reveals match attributes and marks that suspect as eliminated:
  - Country: Match / Mismatch
  - Playtime: Match (within 20%) / Higher / Lower
  - K/D Ratio: Match (within 0.15) / Higher / Lower
  - Top Map: Match / Mismatch
  - Top Server: Match / Mismatch
- Use the comparison clues to narrow the remaining roster until the subject is confirmed.

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

### 4. Community Server Filtering
Minigames can be scoped to any community server (e.g. MoonGamers, SiMPLE, etc.):
- **Server Selector**: Quick pills for top community servers + searchable popover for all tracked servers.
- **Server-Specific Matchups**: Higher or Lower compares regulars using stats earned specifically on that server (`PlayerServerStats`).
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
| `/stats/arcade/higher-lower/next` | GET | Returns a pair of combatants for a randomly chosen metric (kills, score, hours, kd), optionally scoped to `?serverGuid=`. Target value is hidden. |
| `/stats/arcade/higher-lower/reveal` | POST | Validates user guess ('higher' or 'lower') against round token, returning revealed value, result, and next card candidate. |
| `/stats/arcade/mystery/today` | GET | Returns the daily classified dossier with `candidateOptions` suspect roster (redacted name, seed based on UTC date), optionally scoped to `?serverGuid=`. |
| `/stats/arcade/mystery/random` | GET | Returns a random classified dossier with `candidateOptions` for practice/endless mode, optionally scoped to `?serverGuid=`. |
| `/stats/arcade/mystery/guess` | POST | Submits a player name guess against a dossier token; returns comparative clue indicators. |
| `/stats/arcade/trivia/quiz` | GET | Generates a 5-question trivia quiz from current stats (map/period scoped when data allows), customized to `?serverGuid=` when provided. |
| `/stats/arcade/trivia/verify` | POST | Validates trivia answers and returns explanations with real stats. |
| `/stats/arcade/players/search` | GET | Fast autocomplete search across arcade candidate pool, optionally scoped to `?serverGuid=` (used by admin tooling; Mystery Soldier uses `candidateOptions` instead). |

## UI & Design

- Hosted at `/v4/arcade`.
- Designed with `.mm` Neutral Depth tokens (`--mm-*`).
- Audio toggle (Mute / Sound On) utilizing authentic BF1942 radio comms in `/radio-sounds`.
- Fully responsive on mobile (≤640px) and desktop (≥881px).
- No emojis — status and feedback use PrimeIcons, CSS indicators, and country micro-badges.
