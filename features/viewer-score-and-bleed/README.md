# The round's score and the ticket bleed

Status: implemented 2026-09-25. Score on the score board's own `score` column,
and a live ticket counter, both driven by the engine's own numbers.

The viewer's score board drew every column the layout declares except one: a
row's `score` was a literal 0 (`scoreboard.js` `boardRows`), because nothing
tracked what a player had done. The ticket counter was worse off. It drew the
round-start counts and never moved, which `features/bf1942-3d-models/tickets-hud.md`
recorded as deliberate: a counting number with nothing counting it would be a
fiction.

Both numbers are now real. What follows is what the engine does with them, read
out of the shipped settings files and the Linux server binary, then what the
viewer does with that.

## The score table

`Bf1942/Game/ScoreManagerSettings*.con` in the mod's `Game.rfa` is the table,
one file per gameplay mode:

| file | kill | death | capture | attack | defence | TK |
|---|---|---|---|---|---|---|
| `ScoreManagerSettings.con` | 1 | 0 | 10 | 2 | 5 | -2 |
| `ScoreManagerSettingsCTF.con` | 1 | 0 | 10 | 0 | 3 | -2 |
| `ScoreManagerSettingsTDM.con` | 1 | 0 | 0 | 0 | 0 | -2 |

Vanilla ships all three. The `ScoreManager` constructor sets the rest, which no
shipped file touches (`ScoreManager::ScoreManager` `0x08161440`, `0x08161520`):
`death` -1, `kill` 3, `capture` 20, `attack` 5, `defence` 5, `TK` -3,
`objective` 5, `objectiveTK` -15. A mod that ships no settings file gets those.

Which event pays which key is `ScoreManager::scoreEvent` (`0x081617c0`), a jump
table at `0x86c1118` indexed by the `ScoreMsg` the server sends:

| ScoreMsg | name | key | field |
|---|---|---|---|
| 0 | captured a flag | `capture` | +0x48 |
| 1 | scored an attack | `attack` | +0x4c |
| 2 | scored a defence | `defence` | +0x50 |
| 3 | killed | `kill` | +0x40 |
| 4 | is no more | `death` | +0x3c |
| 5 | killed (the victim's own message) | `death` | +0x3c |
| 6 | team-killed | `TK` | +0x44 |
| 7 | (nothing) | none | returns |
| 8 | completed an objective | `objective` | +0x54 |
| 9 | team-killed on an objective | `objectiveTK` | +0x58 |

The field offsets are the setters' (`setKill` `0x08163850`, `setDeath`
`0x08163830`, `setCapture` `0x08163870`, `setTK` `0x08163890`, `setAttack`
`0x081638b0`, `setDefence` `0x081638d0`), each a plain store. The event names are
the bf42plus round recording's own list (`replay-recording.js` `SCORE_TEXT`), and
`ledger.md` row AI-76 shows the kill path calling in with 3 and the team kill
with 6.

Two early outs sit at the top of `scoreEvent`: a player whose team is not 1 or 2
scores nothing, and neither does anyone while the game status is 2 (round over)
or 5 (map over).

## The tickets

Three mechanisms, all in the Linux server.

Starting counts are `Game.setNumberOfTickets <team> <n>`, already parsed into
`scene.json.tickets` (`bf42/level.py` `parse_tickets`). The engine stores them in
an array at `GameServer+0xc0` indexed by team (`setNumberOfTickets` `0x081538b0`).

A death costs the dead player's team tickets. `GameServer::killPlayer`
(`0x0814d920`) reads `GameServer+0x1fc`, the `setTicketLosePerDeath` field
(`0x0813d700`), and calls `TeamScore::subTicket` (`0x081610c0`). The constructor
sets that field to 1 (`0x0812f030`, `0x0812f570`) and no shipped level declares
the command, so every death costs one ticket.

The bleed is in `GameServer::gameStatusPlaying` (`0x08150df0`). Each team owns a
float countdown in seconds, team 1 at `GameServer+0x1d4` and team 2 at `+0x1e0`.
`setTicketLostPerMin` (`0x08153820`) builds it as `60 / (16 x 0.0625 x rate)`,
and `GameServer::init` (`0x08131d2d`) writes 16 to `GameServer+0x1c`, so the
interval is exactly `60 / rate` seconds per ticket. While a team's drain runs,
each frame subtracts `dt` from its countdown, and every time the countdown
crosses zero the team loses a ticket and the interval is added back.

What starts and stops the drain is a weight, not a flag count. The function sums
`ControlPoint::getAreaValueTeam1` / `getAreaValueTeam2` (`0x08284350`,
`0x08284380`, each reading `ObjectTemplate.areaValue` off the point's template)
over the control points each side holds, then compares each sum with 99
(`cmp [ebp-0x1dc],0x63` gates team 2's drain at `0x8151cf8`, `cmp
[ebp-0x1e0],0x63` gates team 1's at `0x8151e22`). A team bleeds while the
enemy's summed weight is greater than 99, at its own `setTicketLostPerMin` rate.

On the shipped levels that reads as "you bleed once the enemy holds nearly all
of the map's weight". The assault maps are the ones that start there, because
one side begins holding everything:

| level | team 1 weight | team 2 weight | bleed 1 | bleed 2 | who bleeds at round start |
|---|---|---|---|---|---|
| Berlin | 110 | 0 | 30 | 5 | team 2 at 5/min |
| Iwo Jima | 100 | 0 | 30 | 5 | team 2 at 5/min |
| Omaha Beach | 100 | 0 | 30 | 5 | team 2 at 5/min |
| Battle of Britain | 50 | 150 | 4 | 1000 | team 1 at 4/min |
| Tobruk | 0 | 108 | 5 | 30 | team 1 at 5/min |
| Invasion of the Philippines | 0 | 102 | 10 | 35 | team 1 at 10/min |
| Battle of the Bulge | 0 | 100 | 15 | 30 | team 1 at 15/min |
| Liberation of Caen | 100 | 0 | 5 | 5 | team 2 at 5/min |

Every other vanilla level starts under the threshold on both sides and bleeds
only once one side takes most of the map. Berlin is the example the brief gave,
and it reads the same way in the data: the Germans start holding three of the
four points, weight 110, so the Russians bleed 5 a minute from the first frame.

## What the viewer does

`tools/bf1942-models/viewer/round-state.js` is the whole model, free of `three`
and of the DOM so `tests/round_state_harness.mjs` drives the real thing under
node:

- `scoreTable(settings, mode)` resolves the table for a mode. The mode's own
  file wins (`ScoreManagerSettingsCtf.con` for `Ctf`), the base file otherwise,
  and the constructor defaults fill anything a mod leaves out.
- `holdWeight(points)` sums `{ team, areaValue }` by holder, which is the
  engine's `getAreaValueTeam1/2` pair; a neutral point counts for nobody.
- `createRoundState({ settings, mode, tickets, rates, ticketLosePerDeath })`
  holds the two ticket counts, one tally per player
  (`{ score, kills, deaths, suicides, captures, teamKills }`), and the two
  bleed countdowns. `settings` and `mode` may be functions, because the pack
  that carries the table is fetched in parallel with the level.
- `kill`, `suicide` and `capture` apply the table to a player; a death also
  takes `ticketLosePerDeath` tickets off the dead player's team.
- `tick(dt, points)` runs the two countdowns against the weights and returns the
  tickets each side lost this frame.

`extract_score_settings.py` reads the settings files through the mod chain and
writes `score-settings.json` into the HUD pack (`maps/_shared/hud/` for vanilla,
`maps/mods/<mod>/_shared/hud/` for a mod that overrides it). The pack is already
the mod-scoped data directory, and `extract_hud_mods.py` runs the extractor with
the rest of the pack so a mod that changes nothing writes nothing. Vanilla's
three files are written; XPack1, XPack2 and Eve of Destruction all ship the same
table, so none of them carries one and their pages fall back to vanilla's.

`map.html` feeds it from the events the page already handles:

| event | where | award |
|---|---|---|
| a bot died | the referee's `onDeath` | the killer gets `kill` (or `TK` when the two are on one side, or when he shot himself), the dead player gets `death`, and his team loses a ticket |
| the local player died | `commsWatchLocalDeath` | the same, with the killer from `comms.lastAttack` inside its five-second window; nobody there means the engine's own `is no more`, a suicide, which pays the death and no kill to anyone |
| a point changed hands | the referee's `onCapture` | `capture` to every player of the taking team inside the flag's radius |

The capture recipients are the viewer's reading, INFERRED rather than read out
of the binary: the engine's own `handleScore` call for a capture is made through
a vtable, so its argument set was not traced. Everyone on the flag at the moment
it turns is the natural set, and the referee already has that list (it passes
`takers` beside its `bot`, a fourth argument `sim/match.mjs` ignores).

The counters the HUD reads are `extras.tickets`, because the layout's own
`ShowTicket` group reads them and `net-room.js` already writes a room's to that
object. `syncTickets` in `map.html` writes the round's live pair there whenever
it moves, as a fresh object: that replacement is the change signal the memo in
`ticket-feed.js` keys on (its key now includes the counts object, not just the
`extras` object, which is what makes a room's own row-by-row updates land too).
The score board's rows read the tally in single player and the room's own
`killed` rows in a room.

In a room the server owns the round: the bleed is off, and no local award is
made, the same gate the capture law uses (`captureEnabled: () => !room.roomJoined`).
A room's score column stays 0 because the netcode protocol carries no score.

## Not implemented

- **Attack, defence, objective and objectiveTK.** The values are parsed and
  carried, but what triggers them was not read out of the binary, so nothing
  awards them. A score line can only be as good as the trigger behind it.
- **The round ending.** Tickets reach zero and stop there: no winner screen, no
  round reset. `Scoreboard/AxisRoundWon` and `AlliedRoundWon` stay 0.
- **The ticket blink.** `Ticket/AxisTicketBlink` and `Ticket/ShowAxisTicketBlink`
  are still fed false; what threshold sets them is still unread.
- **Per-spawner score penalties** (`parity-audit/vehicle-physics.md` G10).

## Divergence from the brief

The brief asked for 1 point a kill, -1 a suicide and 2 a flag capture. The
shipped table agrees on the kill, pays 10 for a capture and 0 for a death, so
the viewer follows the game. The one place to change it is the `capture` and
`death` keys of `maps/_shared/hud/score-settings.json`.

## Verification

`python3 -m unittest tests.test_extract_score_settings` covers the parser and the
chain walk: the three shipped files against a scratch install, a mod that
replaces `Game.rfa` outright, a mod with no archive of its own, `rem` lines, a
non-integer value, and the case of the keys.

`python3 -m unittest tests.test_round_state` runs `tests/round_state_harness.mjs`
against the real module: the table for three modes and for a mod that ships
nothing, the weight by holder, a kill and a team kill, a suicide, a capture, the
per-death ticket, the gate from both sides, the interval at two rates, a frame
long enough to cost several tickets, the floor at zero, and a level that
declares no rate at all. The score board's side of it is `test_scoreboard.py`,
extended with the tally path.

The live page, served from `viewer/` on `?map=<level>&mode=Conquest&botCount=16&dev=1&shots=1`:

- **Berlin**, the level in the brief: the HUD read 80 and 100 at the round's
  start (the level's own pair), `held` read 110 for the Axis and the round's
  `bleeding` read true for the Allies only, and the Allied counter fell one
  ticket every 12 seconds while both counters fell on deaths. When the Allies
  neutralised an open point the weight dropped to 80 and the bleed stopped,
  which is the gate closing under 99.
- **Wake**, the other assault case: Japan holds all five points, the round
  reports the Axis side bleeding at its own rate.
- **Aberdeen** on foot with no bots: standing on a neutral point took it in the
  ten seconds `timeToGetControl` gives, and the round's tally read
  `local: 1 capture, score 10`: the shipped table's capture value, in the live
  page. The score board, opened and painted, drew that 10 in the Axis column and
  in the team total.
- The page raised no error in any run, and the server log shows the page
  fetching `maps/_shared/hud/score-settings.json` on every load.

## Tasklist

1. [x] Read the score table and the event mapping out of the game and the binary.
2. [x] Read the ticket law out of the server binary.
3. [x] `extract_score_settings.py` plus the mod pack step.
4. [x] `round-state.js`.
5. [x] Wire the referee's deaths and captures, the local death, and the frame tick.
6. [x] Feed the ticket counters and the score board rows.
7. [x] Tests and the live page pass.
