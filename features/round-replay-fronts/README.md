# Round replay: browsing by front

The round replay (`map.html?replay=...`, features/round-replay-ux) is 3D, and
a viewer roams the level and swaps between players, so finding the fighting
matters as much as scrubbing. The 2026-10-31 request: review the design so it
is simple to browse the battle, find the battles, roam between them and swap
perspective.

## Status

Built (2026-10-31).

## What the review found

Captured in headless Chromium on the Bocage public round
(`replay_20260928-133433`, 43 players, 8:56) and Midway
(`replay_20260927-203459`). The review canvas with the screenshots and the
mockups is a claude.ai Design artifact, "Replayer Battle Browsing".

- **A round is two or three fronts.** On Bocage, 46 of the 84 battle tracks
  (replay-battles.js `battlesOf`) are at the Bridge and 29 at the Sawmill,
  and both burn for most of the round. On Midway, 53 of 88 are at the
  Airfield and 28 at the Coastal Defences. The tracks overlap and drift,
  and the battle map listed them as fragments ("Battle: Sawmill" twice on a
  phone, one of them 5 s old).
- **The timeline was 300 marks**: every kill, death, spawn, wreck and capture
  of all 43 players, about one every 1.8 s. The heat strip behind them summed
  the whole level and said when, never where.
- **Picking a battle lost it.** Clicking "Battle: Bridge" followed one man in
  the orbit, and the camera sank into the Sawmill's roof. An orbit on a man
  is hidden by any cover he is near.
- **Swapping was roster-wide**: ↑↓ and the card's arrows walked all 43
  players in scoreboard order.
- **Roaming was blind in fog.** Bocage's fog hides a fight from 150 to 200 m
  away, and its edge marker said "× 206 m" with no name.
- **The map framed the level, not the fight.** Midway's was ocean round one
  island.

## The design

Browse by front: the control point the fighting was nearest.

| Where | What it does |
|---|---|
| Lanes over the scrubber | One per front, how hard it was fought at every moment of the round, all on one scale. The round's top plays are gold pips on the lane of the front they happened at. A click on a lane goes to that front at that moment, on the fight cam. |
| Timeline marks | The followed player's own events, the flags and the round's start and end. Everyone's kills are what the lanes show. |
| Front tabs, top centre | One per front: lit while it burns, how many are in its fight and for how long; the front the replay is at is filled. A click watches it. Hidden while the map or the creator view is up. |
| Fight cam | The orbit over the front's fight from about 35 degrees down, 26 to 60 m off by the fight's size, following the fight as it moves. The card is on whoever is doing most in it (the Auto camera's measure), and moves to another man in the fight if he dies or leaves it. Picking a man, another camera or Auto ends it. |
| ↑↓, the card's arrows | The men in the fight the replay is at: within 90 m of its centre, seen by the recording, Axis first. With no fight, the whole roster as before. |
| `,` `.`, the bar's marker buttons | The previous or next surge of the front the replay is at (else of any front), on the fight cam, two seconds before it starts. Shift keeps the followed player's own events. In the reel, its plays as before. |
| Battle markers | One per burning front, "Sawmill · 7 fighting" over its fight, its name kept at the screen's edge. A battle at no front keeps its own marker. |
| Enter, free camera | Into the fight of the front nearest the middle of the view. |
| Battle map (M) | Fronts in place of "Battles now": each front's heat, how many are fighting and since when, kills so far, and the men in its fight. The map opens framed on the fronts, 220 m round each; a double-click shows the whole level. |

## How the fronts are read (replay-fronts.js)

Pure functions of the round's activity (replay-battles.js `activityOf`: each
shooter's half-second of fire, kills, hull hits, wounds) and its control
points, so the highlights harness runs them under node.

- Each activity event belongs to the control point nearest it within 380 m
  (`placeName`'s reach), else to no front. Each event counts once, never a
  track's overlapping copies.
- The fronts are the points holding at least 6% of the round's activity, at
  most three, busiest first; the rest are quiet. Two points of one name are
  told apart by where each lies from the other: Bocage's "Bridge NW" and
  "Bridge SE".
- A front's lane is its activity per bucket, about 300 buckets a round (1.8 s
  on Bocage).
- Its heat at a moment is a battle's: the last 12 s of its events, each
  weighed down by exp(-age / 5 s). It burns at heat 4 or more, and has burned
  since the start of its activity before the last lull of 6 s.
- A surge is a run of its lane, smoothed over 10 s, at 45% of its peak or
  more; runs 15 s apart or less are one, none shorter than 8 s.
- Its fight's centre is the hottest battle burning then whose nearest point
  is the front's, else the weighted centre of its last 12 s, else the point.

On Bocage the fronts come out as Bridge NW 56%, Sawmill 27% and Bridge SE
13%, the two HQs quiet. On Midway: the Airfield 73% and the Coastal Defences
24%. On the 45-minute Bocage round (`replay_20260928-161948`): the Sawmill
35%, Bridge NW 31%, Bridge SE 28%. Built in 6 to 8 ms.

## Files

| File | What it is |
|---|---|
| `viewer/replay-fronts.js` | New, pure: `frontsOf`, `heatAt`, `burningSince`, `fightAt`, `peopleAt`, `frontAround`, `stepSurge`, `nearestPoint`. |
| `viewer/replay-lanes.js` | New: the lanes, replacing `replay-heat.js` (removed). |
| `viewer/replay-highlights.js` | `model.fronts`; the fight cam (`watchFront`, `runFight`, `busiest`); `currentFront`, `fightPeople`, `stepSurge`; the tabs; `,` `.` and Enter; the styles. `watchBattle` goes to the battle's front. |
| `viewer/replay-camera.js` | `fightAt`: while it answers, the orbit circles the fight. |
| `viewer/replay-markers.js` | A marker per burning front; `facing`; clear of the tabs. |
| `viewer/replay-battlemap.js` | The Fronts list; `frameFronts`. |
| `viewer/replay-timeline.js` | `lanesShown`: the followed player's own marks only. |
| `viewer/replay-ui.js` | ↑↓ in the fight; the marker buttons step surges; the shortcuts' words. |
| `viewer/replay.js` | The killer hand-off leaves the fight cam alone. |

## Verification

- `tests/test_replay_highlights.py` `ReplayFrontsTests`: fronts and quiet
  points, two points of one name, each event once and open ground none, heat,
  burning since, surges, the fight's centre, the people in it, stepping
  surges. `ReplayOwnersRoundsTests`: Bocage's first two fronts are Bridge NW
  and the Sawmill with over 75% of the round. All 437 replay tests pass.
- Headless Chromium (Vulkan), Bocage at 1440x900: the tabs and lanes at 2:23;
  a tab click puts the fight cam on Bridge NW with ">>XenaWarrior<<" on the
  card; ↓ follows another man of that fight; `.` goes to the 3:05 to 4:33
  surge ("28 down"); the map opens framed on the fronts with their men
  listed; the free camera shows "Bridge NW · 12 fighting" 196 m off through
  fog and Enter goes into it; a click on the Sawmill lane at 70% goes to
  6:15 on the Sawmill's fight cam. Timeline marks fell from about 300 to
  about 20. Midway: the map opens on the island; `.` goes to the Coastal
  Defences' 13:05 surge. A phone on its side (844x390, touch): the bar is
  110 px with thin lanes, and markers keep below the tabs. No replay stage
  threw (`replay.guard.report()` empty).

## Open

- Not driven on a device; the phone layout was emulated.
- The thresholds (6% share, heat 4, the surge rules) are tuned on Bocage, the
  45-minute Bocage round and Midway. A level whose fighting sits between two
  points (a long beach) may want a smaller reach.
- The fight cam's height suits Bocage's hedges and houses; a city level's
  multi-storey buildings have not been tried.
