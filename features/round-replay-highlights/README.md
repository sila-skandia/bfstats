# Round replay: the highlights

The round replay (`map.html?replay=...`, features/round-replay-ux) plays a
recorded round back through the map's own vehicles and soldiers. It showed
everything and pointed at nothing. The 2026-09-27 request:

- name tags only in the vicinity, not over everyone on the map;
- a way to find what is worth watching: where the battles are, who is on a
  streak (and to follow him), the vehicles, lone wolves and people far from
  the fighting; hot spots on a map you can click around.

None of this is parity: BF1942 has no replay. It takes modern replay and
spectator modes as its model.

## Status

Built (2026-09-27).

## Patterns adopted

| Pattern | Taken from | Here |
|---|---|---|
| Tactical map of the whole round, click to jump there | PUBG's replay map, CS2's 2D radar | The battle map (M): the level's map art with everyone on it, fights as heat, shots as tracers, kills where they fell, flags in their owners' colours, the camera's wedge. Click a man to follow him, a fight to watch it, the ground to fly the free camera there. Wheel zooms, drag pans. |
| Auto-director | Dota 2's directed camera, CS2's auto-director | The Auto camera (4): picks whom to follow. A replay knows the future, so it cuts to a man up to 7 s before his kill, not after it. |
| Medals and multi-kill callouts | Halo, Unreal Tournament, Call of Duty | The followed player's medals stamped at the top of the view as he earns them. |
| Kill leader | Apex Legends | A crown on the leader's tag, card, board row and map mark. |
| Spectator event ticker | Dota 2 and esports broadcasts | Everyone else's medals above the bar, each with Follow and Replay (an instant replay from the play's start). |
| Objective markers with off-screen arrows | Battlefield, Apex pings | The fights you are not watching, marked over the view or held at its edge (B). |
| Highlight reel | Overwatch's Play of the Game and highlights, Rocket League | The round's top plays, one click each, or all of them back to back. |
| "Most replayed" graph over the scrubber | YouTube | A heat strip of the round's fighting behind the timeline's marks, with a gold pip per top play. |
| Name tags by distance | Fortnite, Overwatch spectating | Tags only within 35 m of the camera (fading out by 60 m; vehicles 1.6 times that), and the followed player's while the orbit is on him. N turns them off. |

## Controls

| Action | Mouse | Keys |
|---|---|---|
| Battle map | Map button | M; Esc closes |
| Auto camera | Auto button (film camera) | 4; C cycles through it; any manual pick hands back |
| Battle markers on / off | | B |
| A play from the ticker | Follow, Replay | |
| The reel: next / previous play, stop | Next, Stop on its plate | `.` / `,`, Esc |
| On the map | click a man / fight / ground; wheel; drag; double-click resets | |

## How the round is read

Everything is a pure function of the recording (and the aligned server log
when there is one), built once when the replay opens: about 20 ms for Wake's
280 s round, 164 ms for a 45-minute public Bocage round. Who stands apart is
read after that, a few seconds of the round within 3 ms of each frame
(features/replay-performance).

### What the recording can see

The server sends a client nothing beyond the level's view distance from its
player (`drawDistance`: Wake 500 m, Kursk 400 m; the cut measured a few per
cent further, replay-chapters.js `outOfRange`). So a shot is recorded only if
its shooter was in range, and a player out of range has only his last pose.
The analysis uses live data only (`fresh`). The battle map dims the level
outside that ring ("recorded range") and draws players out of it hollow, at
their last sighting, for 20 s; the Auto camera never picks one. Kills are
heard from everywhere (the score stream) and placed by the server log when the
recording could not see them.

A man getting out of a vehicle comes back into the replicated set, and the
recording's first samples of him are not his: the first is the last place the
client had for his soldier, as a rule where he got in, and sometimes the next
few run on past him until the server's correction snaps him back. Across the
owner's three public rounds, 164 of 686 men getting out began 10.6 to 1368 m
from their next sample, and the recording had every one where he is within
0.64 s; no spawn, man walking into range or hull starts that way. Until the
first sample after the last jump of more than 10 m in the span's first
second, he is placed where that sample has him (replay-recording.js
`settledTime`), for the medals, the kills, the wounds, the battles, the
standouts, the director and the map, and drawn there: drawn from his first
sample, he streaked 500 m across the level in the tenth of a second after
he got out. Placed where he got in, RuppoPeaGame,
shot 0.07 s out of his Kubelwagen at 52.2 s of replay_20260928-133433, made
the 6 m Sg44 kill by `>>XenaWarrior<<` a 459 m long shot. Held back as out of
range instead, the Auto camera cut away from a man as he got out.

### Battles (replay-battles.js)

- Activity: each shooter's half-second of fire weighs 1 (so a machine gun
  and a bolt-action rifle count alike), heavy weapons 2; a kill 6, where the
  man died; a hull destroyed 7; a hull hit 1.5 and a wound 1, both credited to
  the other side. A hull losing the same few points every half-second (a
  beached landing craft, a tank in deep water) or draining below its
  critical damage is no fight.
- Every 0.5 s, the last 12 s of activity, each event weighed down by
  exp(-age / 5 s), is clustered: events within 65 m of a centre are one
  cluster, clusters within 65 m merge, and one below heat 2.2 is dropped.
- A cluster is followed from step to step by the nearest one within 97 m, so
  a fight can drift up a beach and stay the same battle. A track ends 4 s
  after its last cluster, and one shorter than 3 s that never passed heat 5
  is dropped.
- A battle is contested (drawn amber, called "Battle") when each side has at
  least 20% of its heat, or both fired and someone died; otherwise it is
  "Gunfire" in the firing side's colour.
- A place is named by the nearest control point: its name within 120 m,
  "NE of Village" within 380 m, else open ground.

### Streaks and medals (replay-medals.js)

| Medal | Rule |
|---|---|
| Double / Triple / Quad / Multi kill | Kills by one man at most 6 s apart. |
| Killing spree, Rampage, Dominating, Unstoppable, Legendary | 3, 5, 7, 10, 15 kills in one life. |
| First blood | The round's first kill, only when the recording saw the round start. |
| Shutdown | Killing a man on a streak of 3 or more. |
| Revenge | Killing the man who killed you last. |
| Long shot | 100 m or more, on foot, with a gun, both men where the recording saw them. |
| Cold steel | A knife kill. |
| Destroyed | A vehicle, credited by the server's log, not one of your own side's. |
| Kill leader | The most kills, at least 3; the first to a count keeps a tie. |

A team kill counts for nothing; any death ends a life. A player's medals that
overlap are one play, named by its rarest medal. Top plays: at most 8 scoring
2.5 or more, plus the two hottest contested battles at their peak unless a
play already covers that moment. The reel skips a play the recording could
not see.

### Standing apart (replay-battles.js `standoutsOf`)

Once a condition has held for 5 s, while the recording has him live:

| Standout | Rule |
|---|---|
| Behind enemy lines | Within 110 m of a flag the enemy holds, no teammate within 70 m. |
| Sniper nest | A scout who has moved less than 8 m in 15 s and fired in the last 20 s. |
| Lone wolf | No teammate within 150 m, an enemy within 160 m. |
| Far from the fight | No battle within 320 m, no enemy within 220 m, 20 s past his spawn. |

A pilot is none of these.

### The Auto camera (replay-director.js)

Every 0.25 s of the recording each watchable player is scored: a kill of his
coming in the next 7 s (up to 12, less the further off), his death in the
next 5 s (6), kills in the last 4 s (5 each), his fire (1 per half-second,
up to 8), the battle he is in (its heat x 0.35, up to 12, plus 2 when
both sides fire in it), his streak (2.5 a kill), the kill lead (3), flying (1).

- A pick is kept at least 6 s. Before 24 s a rival needs 1.35 times the
  score plus 4; after, anyone better.
- Nothing above 1: the recording player.
- A pick who dies is held 2.8 s on his body, then the director follows his
  killer if it can.
- The camera zooms to take in the fight and turns, over 1.6 s, to look past
  him at his next victim or the fight's centre. A drag keeps its hands off
  for 6 s.
- The caption over the card says why, never what is coming: "in the fight
  at Landing Beach", "on a streak of 3".

## Files

| File | What it is |
|---|---|
| `viewer/replay-battles.js` | Pure: who is where (`whereIs`), the activity, battles, places, standouts, vehicles, the timeline's intensity. |
| `viewer/replay-medals.js` | Pure: streaks, the leader, medals and their words, top plays. |
| `viewer/replay-director.js` | Pure: the Auto camera's picks. |
| `viewer/replay-highlights.js` | Builds the model, wires the pieces to the replay, the Auto camera's framing, the reel, the keys, the shared look. |
| `viewer/replay-battlemap.js` | The battle map and its lists. |
| `viewer/replay-markers.js` | Battle markers over the 3D view. |
| `viewer/replay-callouts.js` | The callouts, the ticker, the medal art. |
| `viewer/replay-heat.js` | The timeline's heat strip. |
| `viewer/replay-ui.js` | Vicinity name tags, the Auto button, streak and leader marks on tags, the card and the board, the key hand-off. |
| `viewer/replay.js`, `viewer/map.html` | The wiring; the page hands in `mapArt`, `mapProjection` and `viewDistance`. |

## Verification

- `tests/test_replay_highlights.py` (`replay_highlights_harness.mjs`): 37
  cases on recordings written line by line (medals and streaks, battles,
  hull drains, vehicles, standouts, headings, a man just out of a vehicle,
  the director's picks, its death hold and seek), and the owner's Wake,
  Kursk and Bocage rounds when `viewer/replays` is on disk.
- Headless Chromium on the Wake co-op round (`replay_20260927-075756`,
  with its server log): Yukiji Adachi's callouts at
  72.4 s (Destroyed, with Double kill) and 74.7 s (Triple kill, with
  Killing spree and Kill leader); the ticker's Replay back to 65.1 s; the
  Auto camera from 40 s at 2x (Tomoyuki Usami, his death held, then skandia
  who killed him, then Yukiji Adachi 4 s before his kills), handing back on
  a manual pick; the map's hover, a click on a fight (a man in it followed),
  on the ground (the free camera there), zoom and pan; the reel stepping and
  framing each play 8 m behind its man; markers never under the minimap or
  the bar over 16 camera headings; with the free camera 25 m from a soldier
  his tag shows, from 160 m it does not. The highlights cost 0.1 ms a frame,
  0.6 ms with the map open.
- The same on the Kursk round (`replay_20260927-140921`, no server log): its
  map, lists, zoom, H hiding every piece, the shortcuts overlay; 390 px wide
  with no overflow. `map.html?map=wake` without a replay has none of it.

## Open

- A battle out of the recording's range is invisible unless a kill in it was
  logged by the server. The map says so with its ring.
- The thresholds are tuned on three bot-heavy rounds (Wake co-op) and one
  public Kursk round; a busy 64-player round may want the ticker thinned.
- Medal words are the arcade's, not the game's; there is no sound for them.
