# Functional Feature Specification: Public Tournaments Experience

## 1. Executive Overview

The **Public Tournaments Experience** on `bfstats.io` provides the public-facing view for players, team captains, and tournament spectators. It presents competition schedules, team rosters, real-time activity feeds, map score breakdowns, cumulative leaderboards, downloadable resources, player performance statistics, and self-service team registration.

This document describes **every feature and data capability** currently implemented in the public tournament subsystem, serving as a functional blueprint for front-end redesign. It details *what the application does*, the data entities involved, user interactions, and real-time feeds without prescribing visual presentation.

---

## 2. Global Tournament Shell & Navigation

- **Tournament Identifier**: Tournaments are accessible via numeric ID (`/t/12`) or custom URL slug (`/t/summer-cup-2026`).
- **Custom Branding Data**:
  - `Hero Banner Image`: Optional header background image.
  - `Community Logo`: Optional organizer/community logo image.
  - `Theme Configuration`: Theme background color (`backgroundColour`), text color (`textColour`), and accent color (`accentColour`).
- **Primary Section Navigation**:
  - `Overview` (`/t/:id`): Hero header, registration CTA banner, promo video embed, and live activity feed.
  - `Rankings` (`/t/:id/rankings`): Cumulative team leaderboard and weekly standings.
  - `Matches` (`/t/:id/matches`): Schedule and match history broken down by map & tickets.
  - `Rules` (`/t/:id/rules`): Tournament guidelines and registration rules in Markdown.
  - `Teams` (`/t/:id/teams`): Team directory, player rosters, and team registration.
  - `Files` (`/t/:id/files`): Downloadable map packs, server configs, and replay demos.
  - `Stats` (`/t/:id/stats`): Individual player tournament performance leaderboard.
- **Social & Media Links**:
  - Links to external platforms: Discord server, YouTube channel, Twitch stream, Forum thread.

---

## 3. Section Feature Specifications

### 3.1 Overview Tab (`/t/:id`)

1. **Hero Header**:
   - Displays tournament title, organizer name, creation date, game mode (e.g., `Conquest 8v8`), game title (`BF1942`), and status badge (`Registration Open`, `Active / Open`, `Closed`).
   - Shows match progress indicator (`Matches played / Anticipated round count`).

2. **Registration Open Banner**:
   - Rendered prominently when tournament status is `registration`.
   - Displays registration callout message ("Team Registrations Are Open!").
   - Includes CTA button routing users directly to the Teams tab (`/t/:id/teams`) to register a new team or join a squad.

3. **Tournament Promo Video Embed**:
   - Renders embedded YouTube / video player when `promoVideoUrl` is configured.
   - Displays above news feed during registration status, and below news feed when tournament is open/closed.

4. **Progressive Real-Time Activity Feed (`TournamentNewsFeed`)**:
   - Infinite scroll / cursor-paginated timeline (`/stats/tournaments/:id/feed?cursor=...&limit=10`).
   - Dynamically aggregates and displays 4 distinct event types:
     - **`post` (News Announcement)**: Official news articles and announcements written by tournament staff with full Markdown rendering (bold, headings, lists, links).
     - **`match_result` (Match Result Card)**: Published match results showing Team 1 vs Team 2, map name, tickets won by each team, winning team highlight, and timestamp.
     - **`team_created` (Team Registration Notice)**: Event notification when a new team registers for the tournament.
     - **`match_scheduled` (Match Scheduled Notice)**: Event notification when a new match is added to the tournament schedule (Scheduled Date/Time, maps list, week assignment).

---

### 3.2 Rankings & Leaderboards Tab (`/t/:id/rankings`)

1. **Cumulative Season Leaderboard**:
   - Ranks teams based on total points accumulated across completed matches.
   - **Podium Highlighting**: Special visual badges for 1st, 2nd, and 3rd place teams.
   - **Metrics Tracked**:
     - `Rank`: Current leaderboard position (`1`, `2`, `3`...).
     - `Team Name & Tag`: e.g., `sKANDIA [sK]`.
     - `Matches Played (MP)`: Total completed matches.
     - `Victories (V)`: Total matches won.
     - `Ties (T)`: Total matches tied.
     - `Losses (L)`: Total matches lost.
     - `Rounds Won (RW)`: Total map rounds won.
     - `Rounds Tied (RT)`: Total map rounds tied.
     - `Rounds Lost (RL)`: Total map rounds lost.
     - `Tickets For (TF)`: Total ticket score accumulated across all rounds.
     - `Tickets Against (TA)`: Total tickets conceded.
     - `Ticket Differential (+/-)`: `Tickets For - Tickets Against`.
     - `Points`: Total primary ranking points.

2. **Weekly Standings Filter**:
   - Filter dropdown allowing users to view standings for specific weeks (e.g. `Overall Cumulative`, `Week 1`, `Week 2`, `Playoffs`).

---

### 3.3 Matches & Bracket History Tab (`/t/:id/matches`)

1. **Schedule Grouping**:
   - Groups all tournament matches into week accordions (e.g., `Week 1: Omaha Beach`, `Week 2: El Alamein`, `Playoffs`).

2. **Match Summary Card**:
   - `Scheduled Date`: Localized date and UTC time string.
   - `Competitors`: Team 1 Name vs Team 2 Name.
   - `Server`: Linked server name and GUID.
   - `Match Score Summary`: Formatted as `[Tickets] ([Round Wins])`, e.g. `Team A 240-110 (2-0) Team B`.
   - `Match Winner`: Highlight badge for winning team or `Tie` indicator.

3. **Per-Map Score Accordion**:
   - Expandable map details for each match:
     - `Map Name` & `Map Order` (`Map #1`, `Map #2`).
     - `Picked-by Team`: Indicates which team selected the map.
     - `Map Thumbnail`: Preview image of the map background.
     - `Round Scores`: Ticket score breakdown per round (e.g., `Round 1: 120-50`, `Round 2: 120-60`).

4. **Match Details & Demos Trigger**:
   - Clicking a match opens the `MatchDetailsModal`, presenting downloadable replay demo files, referee comments, and side-by-side player comparisons.

---

### 3.4 Teams & Rosters Tab (`/t/:id/teams`)

1. **Registered Teams Grid**:
   - Displays all teams registered for the tournament.
   - **Team Information**: Team Name, Tag (e.g., `[sK]`), Team Leader Name, Date Registered.
   - **Recruitment Status Badges**:
     - `[Recruiting]`: Team is actively seeking full-time or backup players.
     - `[Roster Full]`: Team roster is complete and closed to new applicants.
     - `[Looking for B-Team]`: Team leader is looking to start a second squad (provides contact guidance).

2. **Player Roster Table**:
   - Accordion expanding each team's roster:
     - `Player Name`: Decoded player alias (with CP1252 character handling).
     - `Role Badge`: Leader badge (`👑`) for team captains.
     - `Rules Acknowledgment`: Checkmark (`✓`) indicating player has acknowledged tournament rules.
     - `Membership Status`: `Approved` or `Pending` status.

3. **Team Registration Workflow (For Signed-in Users)**:
   - **`Create Team` Action**:
     - Allows a signed-in user to create a new team.
     - Form: Team Name, Team Tag, Select linked player alias to assign as captain, Acknowledge tournament rules checkbox.
   - **`Join Team` Action**:
     - Allows a signed-in user to join an existing team seeking players.
     - Form: Select team, Select linked player alias, Acknowledge rules checkbox.
   - **`Manage My Team` Action (For Team Captains)**:
     - Allows team leader to update team name and tag.
     - Change recruitment status (`Open`, `Closed`, `Looking for B-Team`).
     - Manually add player by alias name.
     - Remove player from roster.
     - Delete team (only permitted if team has no completed matches).

---

### 3.5 Rules & Guidelines Tab (`/t/:id/rules`)

1. **Markdown Rendered Content**:
   - **General Rules**: Full Markdown document detailing match format, vehicle/equipment bans, server tickrates, map rotation rules, dispute procedures, and referee contact info.
   - **Registration Rules**: Roster minimums/maximums, substitute player limits, roster lock deadlines, and alias-binding requirements.

---

### 3.6 Files & Resources Tab (`/t/:id/files`)

1. **Categorized File Downloads**:
   - Organized into category sections: `Map Packs`, `Rulebooks`, `Server Configs`, `Replays`, `Demos`, `Programs`.
   - **File Details**: File Name, Category Pill, Uploaded Date timestamp, `Download ↗` direct button.

---

### 3.7 Player Statistics Directory Tab (`/t/:id/stats`)

1. **Player Performance Leaderboard**:
   - Aggregates individual player statistics across all completed tournament rounds.
   - **Metrics Tracked**:
     - `Rank`: Player stat position.
     - `Player Name`: Clickable link navigating to player profile (`/v4/players/:playerName`).
     - `Team Label`: Team alignment for the tournament.
     - `Total Score`: Cumulative score earned in tournament rounds.
     - `Kills (K)`: Total kills in tournament rounds.
     - `Deaths (D)`: Total deaths in tournament rounds.
     - `K/D Ratio`: Calculated `Kills / Deaths` metric.
     - `Rounds Played`: Total tournament rounds completed.

---

### 3.8 Match Details & Media Modal (`MatchDetailsModal`)

1. **Match Header**: Match date, team competitors, and server info.
2. **Replays & Demos Tab**:
   - List of uploaded match recording files (`.bf1942demo`, `.zip`, `.png`).
   - Download link and file tags.
3. **Referee Comments Tab**:
   - Chronological comment log from tournament staff and referees.
   - Displays author email, timestamp, and comment text.
4. **Compare Players Trigger**:
   - Action launching side-by-side player comparison view (`PlayerComparisonV4`) for selected competitors in the match.

---

## 4. Real-Time Telemetry & Notification Integration

- **SignalR Telemetry Integration**: Subscribes to live WebSocket telemetry for real-time score updates and live round notifications.
- **Title Notification Alerts**: Flashes document title when live events occur or match updates finish while tab is in background.
