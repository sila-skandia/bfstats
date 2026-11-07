# Dogfights from the recordings

Status: built (2026-11-07). The detector, the extractor and the dogfight
school's FROM THE RECORDINGS list are in place and run over the 32 public
recordings; the extracted fights are local files, not yet published. Not yet
flown or watched by a person.

Real dogfights out of the round recordings players upload, played back in the
dogfight school's theatre (features/dogfight-school) in its simplified view:
two fighters over a grid, their paths, their shots, the kill, the words for
who was on whose tail. The owner's aim, over time, is to learn which
manoeuvres win, and from that to learn dogfighting skills to try in game.

## What it does

1. `tools/bf1942-models/extract_dogfights.mjs` reads recordings with the
   viewer's own reader (`viewer/replay-recording.js`), finds every fight with
   `viewer/dogfight-detect.js`, and writes each one to
   `viewer/dogfights/<slug>-<n>.json`, one row each in
   `viewer/dogfights/index.json`.
2. The theatre lists the index under FROM THE RECORDINGS, grouped by round,
   both-pilots-shooting first, then the kills, then the longest. A filter
   shows the dogfights only, or every attack.
3. Picking one fetches its file and turns it into the fight the theatre plays
   (`viewer/dogfight-recorded.js`), the same shape `runDuel` gives a flown
   lesson: every camera, the gunsight views, the shot freeze, the energy
   chart and the tracers work as they do for a lesson. The tags, captions,
   meters and cameras carry the pilots' names (decoded, `decodePlayerName`),
   and each pilot's own type is drawn: the battle's parked one, or the
   template's model loaded from its mod's tree (`planeVisualFor`).

```bash
# the newest public recordings, downloaded and searched
node tools/bf1942-models/extract_dogfights.mjs --download <dir> --recent 50
# recordings you have, with the feed's mod, level and date
node tools/bf1942-models/extract_dogfights.mjs <dir or files> --feed feed.json
# what it finds, written nowhere
node tools/bf1942-models/extract_dogfights.mjs <dir> --report
```

The 32 recordings (803 MB) take about 7 s. Then open the Range on a battle
with aircraft, open the school (V), pick the **Recordings** tab over its list
(beside Lessons and Ring courses) and pick a fight.

## How a dogfight is found

Each number is in `RULES` (`viewer/dogfight-detect.js`).

1. **A plane** is a life a player flies: someone controls the life itself
   (the pilot's seat, not a gunner's), the model catalogue calls its template
   an aircraft (`category: 'air'` in the assets site's `models.json`,
   vanilla's and each mod's: 859 aircraft of 4,986 templates), and it holds
   40 m/s or more for 3 s while the recording keeps it live. A client
   recording freezes what is out of its player's network range
   (`isReplicated`); frozen stretches are not used. A template the catalogue
   does not hold falls back to motion alone: fast for half the time it moves.
   Without the catalogue, El Alamein's modded KettenKrads (73 m/s on the
   ground), Willys and Kubelwagens, and the spectator's free camera, all came
   out as planes.
2. **A pair** is two planes in the air at once whose pilots are on opposite
   sides at the time.
3. **An aimed shot** is a round from the pilot's own plane (not a bomb or a
   torpedo, not a gunner's or the anti-aircraft's) that would pass within
   25 m of the other plane: flown at 400 m/s plus the shooter's own velocity
   for up to 1.5 s against where the other really went. A round sprayed at
   the sky, or at someone else, is not one.
4. **Evidence** is every aimed shot either way, every hit (a server
   recording's impact on the other plane, or the other plane's hit points
   falling within 1.5 s of an aimed shot), and the kill (the score's kill,
   killer and victim the two pilots).
5. **A fight** is a run of evidence with no gap over 15 s, opened 8 s before
   its first piece and closed 4 s after its last (3 s after a kill), trimmed
   to where both planes are live and flown by those two. It needs 3 aimed
   shots, and the two inside 600 m at some moment.
6. **A dogfight** is a fight where both pilots shot at each other, or which
   lasted 12 s with both turning through 180 degrees. Anything else is a
   **bounce**: one pilot attacking, the other not answering.

A pilot's control record is sent again every few seconds, now and then with a
blink to another object: spans of one pilot in one plane under 2 s apart are
one flight (without this, every fight came out 2 to 7 s long).

A plane far from the recording player is updated every second or three. The
replay holds a pose until the next sample is due (right for a parked hull);
the detector draws a straight line between samples instead, and a gap over
3 s is not live (`maxGap`). Held then moved, an Avenger on Battle of Makin
stood still and jumped 126 m in a tenth of a second; now 3 of the 578 tracks
pass 150 m/s at all (201, 186 and 181 m/s at their fastest; not yet looked
at).

### How a fight ends (rules 7 and 8, version 2, 2026-11-07)

Michael Knytnæve (Bf 109) v Paciencia (Spitfire), El Alamein: a good
turning fight that stopped at 22.6 s with the two converging. Version 1
closed a fight 4 s after its last aimed shot; Michael's last burst was at
1276.2 s, so it ended at 1280.2. Both planes stayed in the recorder's range
until the Bf 109 was destroyed at 1293.0, and Paciencia fired nothing after
1276. What ended it: Schneemann on a Stationary Browning (the anti-aircraft
gun) took the Bf 109 from 90 hit points to 0 between 1279.9 and 1283.0 s,
and Michael went to the free camera at 1283.0.

- **Rule 7.** A fight without a kill runs on past its tail while both are
  live, flown by the same pilots and inside `engaged` (600) metres, for up
  to `engagedMore` (20) seconds, and never into the next run's lead-in.
- **Rule 8.** Every fight carries `end`: `shot down` (by the other),
  `downed by another` (who, and with what; the fight runs `killTail` past
  it so the clip shows it), `died` (no one credited), `left his plane`,
  `out of range` (a client recording sees only what is near its player),
  `apart` (beyond 600 m), or `quiet` (still close, nobody firing).
- The fight now runs 28.5 s and ends "Michael Knytnæve shot down at 25.6 s,
  by Schneemann", with the hull meter falling 90 to 0 in the last seconds.

Over the 32 recordings: 302 fights (289 under version 1), 172 dogfights
(140), 104 kills (unchanged). The El Alamein round alone: 49 fights got
longer, 287 s in all. Its endings: 39 shot down, 15 downed by someone
else, 5 died, 21 left the plane, 5 out of range, 4 apart, 24 quiet.

The school says it: the list line ("poop out of the recorder's range"), the
title card ("It ends: ..."), a dashed mark on the timeline when the end is a
moment, and the end card's title and first line (`endingWords` in
`dogfight-recorded.js`). Where the recording lost a plane mid-fight, the
timeline is hatched in his colour over the span (`lost`, per side, from
`sampleFight`) and his meter reads OUT OF RANGE · PATH GUESSED while it lasts.

## What the theatre reads into it

The file holds only what the recording says: both planes every 0.1 s in the
recording's frame, the propellers' revs, every gun round, the evidence. The
rest is worked out at load (`viewer/dogfight-recorded.js`), by the school's
own rules, so it improves without extracting again:

- the recording's frame to the viewer's (z negated, `replay-actors.js`);
- the situation (`geometry`, `situation` in `dogfight-pilot.js`): on his
  tail, on mine, head on, turning for position, held 1 s before the caption
  says it;
- a shot that would land: the nose on the lead inside 400 m (`gunSolution`);
- each round flown against the other's path, a hit where it passes within
  7 m (the sparks); the hits the recording proves are counted apart;
- THE FIGHT and THE NUMBERS under the picture: who, in what, where and when;
  each pilot's time on the other's tail, time chased, aimed rounds, time with
  a shot that would land, proven hits, degrees turned, speed and height in
  and out.

## The first catch (2026-11-07)

The 32 public recordings: 14 rounds hold air fights. 289 fights, 140 of them
dogfights, 22 with both pilots shooting, 104 ending in a kill. A fight's
median is 13.5 s, a dogfight's 17.6 s, the longest 58 s. 7.6 MB of files.

| Level | Fights | Dogfights | Both shooting | Kills |
|---|---|---|---|---|
| el_alamein | 109 | 50 | 16 | 39 |
| battle_of_britain | 60 | 24 | 0 | 17 |
| coral_sea | 34 | 12 | 4 | 11 |
| bocage | 33 | 21 | 0 | 14 |
| battleaxe | 17 | 14 | 0 | 6 |
| market_garden | 14 | 11 | 1 | 7 |
| kharkov | 9 | 2 | 0 | 6 |
| baytown | 6 | 2 | 0 | 3 |
| battle_of_makin | 4 | 2 | 0 | 0 |
| supercharge-1942, rush_to_baghdad, midway | 3 | 2 | 1 | 1 |

Two things already show:

- **Whoever shoots first wins.** Of the 104 kills, 97 went to the pilot who
  fired the first aimed round. Most attacks are bounces: the attacked pilot
  never shoots back.
- **When both shoot, it turns.** In the 22 fights where both pilots fired,
  6 ended in a kill, and the first to fire won only 2 of them.

Checked by eye: El Alamein's BennyBlanco (Bf 109) against Chief-H.E.M.P
(Yak9), a 26 s turning fight passing 12 m apart, Chief-H.E.M.P on his tail at
130 m with BennyBlanco down to 26 m/s, then the kill; Battle of Britain's
Option_X (Spitfire) shooting down A de(CHN) (Bf 109) in 15 s. Both read as
the fight from above and from behind each plane.

## Naming the manoeuvres (2026-11-07)

`viewer/dogfight-manoeuvres.js` names what each pilot flew in the school's own
words: a rule each over the path (turn rate, climb, pitch, bank, rolled over,
heading turned, height won or lost, the engine's revs) and where the other
plane was. The numbers are in `M_RULES`.

| Manoeuvre | The rule, in short |
|---|---|
| Break turn | A hard turn (18 deg/s, about level, 2 s) begun with him in my rear quarter inside 700 m, toward him |
| Hard turn | The same with nobody on my tail |
| Immelmann / Split-S / Loop | Rolled past inverted, wings level before and after within 8 s: reversed (135 deg) and 40 m higher, reversed and 40 m lower, or the same way round |
| Boom and zoom | A dive, an attack out of it (firing, or nose on him in range), and a zoom within 15 s |
| High / Low yo-yo | Closing on him in a turning fight, the nose up (or down) off the horizon while turning, and back within 6 s |
| Scissors | Three or more crossings, each under 8 s apart, under 250 m on average, both reversing at each |
| Head-on pass | Nose to nose inside 300 m, closing |
| Overshoot / Forced overshoot | On his tail and closing, then he is behind me within 3 s |
| Reversal (the Flip) | Chased for 1 s, then on his tail within 12 s |
| Extension (the Dip) | Straight, fast (50 m/s), the range opening, 4 s |
| Throttle chop | The revs down 0.3 within 2 s, to 0.6 or less, the speed falling |
| Jink | Bank thrown side to side under his guns |
| Tail chase, Dive, Spiral dive, Climb, Zoom climb | The plain flying between |

Nothing after a kill is named: the wreck falls (a spiral dive), its engine
dies (a chop) and the killer goes past it (an overshoot). Before that cut,
"Throttle chop" lost 73% of its fights and "Overshoot" won 47%.

**Checked against the school's flown lessons**, whose manoeuvres are known
(`tests/test_dogfight_manoeuvres.py`): the breaking ace reads as a break turn
at 11 s; the Immelmann and the split-S as themselves; the scissors lesson as
one scissors of 40 s for both and the chop as none; the boom-and-zoom ace as
two booms; the chop as an overshoot for the hunter and a forced overshoot and
a reversal for the defender; the on-his-tail Flip as a high yo-yo; every Dip
as an extension; a pilot flying straight as nothing at all. Three rules came
out of that check: a reversal counted against the last clear turn, not the
last tick (no scissors was ever found before); a boom allowed to chase and
shoot before it zooms; a yo-yo allowed against a man breaking back into you.

**In the theatre** each pilot's meter says what he is flying now
("Yak9 · Reversal"), and under the picture each pilot's manoeuvres stand in
order, the plain flying muted; a click jumps the replay to one. The lessons
get the same list.

## What the manoeuvres did

`tools/bf1942-models/dogfight_manoeuvres_report.mjs` names and scores every
manoeuvre in every extracted fight: where the pilot stood in the 2 s before
it (on his tail, chased, neither) and the 3 s after, whose guns had a shot
that would land from its start to 5 s after, the energy he gained on the
other, and how the fight ended. The 289 fights, 1,585 manoeuvres:

| Manoeuvre | Flown | Fights | Before: on his tail / chased / neither | Better after | Worse after | Own shot | His shot | Won | Lost | Energy gained |
|---|---|---|---|---|---|---|---|---|---|---|
| Reversal | 47 | 43 | 0 / 47 / 0 | 100% | 0% | 64% | 6% | 26% | 9% | -2 m |
| Overshoot | 20 | 20 | 20 / 0 / 0 | 0% | 100% | 0% | 40% | 15% | 10% | -42 m |
| Forced overshoot | 20 | 20 | 0 / 20 / 0 | 100% | 0% | 40% | 0% | 10% | 15% | 42 m |
| Head-on pass | 182 | 88 | 2 / 2 / 178 | 4% | 4% | 25% | 25% | 12% | 12% | 0 m |
| Immelmann | 27 | 25 | 1 / 12 / 14 | 63% | 0% | 37% | 30% | 33% | 11% | 13 m |
| Split-S | 15 | 14 | 3 / 6 / 6 | 47% | 27% | 40% | 40% | 27% | 13% | -98 m |
| Loop | 11 | 10 | 2 / 1 / 8 | 36% | 18% | 36% | 18% | 27% | 9% | -46 m |
| Boom and zoom | 40 | 37 | 6 / 4 / 30 | 20% | 18% | 53% | 20% | 25% | 13% | -70 m |
| Scissors | 40 | 20 | 9 / 9 / 22 | 28% | 28% | 45% | 45% | 23% | 23% | 0 m |
| High yo-yo | 42 | 40 | 14 / 3 / 25 | 29% | 19% | 60% | 24% | 26% | 10% | 33 m |
| Low yo-yo | 89 | 75 | 25 / 3 / 61 | 20% | 27% | 64% | 9% | 37% | 9% | -39 m |
| Break turn | 58 | 53 | 0 / 53 / 5 | 62% | 2% | 14% | 47% | 9% | 41% | 6 m |
| Throttle chop | 34 | 31 | 6 / 14 / 14 | 6% | 29% | 3% | 35% | 3% | 21% | -10 m |
| Jink | 7 | 6 | 0 / 6 / 1 | 14% | 14% | 0% | 29% | 29% | 14% | 17 m |
| Spiral dive | 224 | 148 | 28 / 53 / 143 | 35% | 20% | 38% | 21% | 25% | 16% | -65 m |
| Zoom climb | 119 | 94 | 17 / 30 / 72 | 29% | 26% | 22% | 36% | 16% | 16% | 14 m |
| Hard turn | 166 | 114 | 34 / 7 / 125 | 30% | 20% | 35% | 24% | 22% | 17% | 12 m |
| Tail chase | 264 | 203 | 125 / 1 / 138 | 34% | 22% | 74% | 3% | 39% | 5% | 5 m |
| Dive | 28 | 26 | 5 / 6 / 17 | 14% | 25% | 14% | 29% | 7% | 21% | -59 m |
| Climb | 152 | 116 | 29 / 52 / 71 | 31% | 20% | 24% | 30% | 18% | 19% | 27 m |

What it says, with the caution that these are 289 fights from 14 rounds, many
of them bounces, and that a manoeuvre flown is not the cause of what follows:

- **The break turn saves the moment, not the fight.** Flown when chased in 53
  of 58, it took the pilot out of his chaser's sights in 62% and almost never
  made it worse (2%), but his chaser still had a shot in 47% and the breaker
  went on to lose 41%. The school's break-turn lesson finds the same on the
  flight law: the break survives, it does not turn the fight.
- **The Immelmann looked like the best answer to being chased; it is one
  pilot's.** Across all situations it won 33% and lost 11%, but flown when
  chased it won 33% and lost 25%, and without Chief-H.E.M.P (the recording
  player, in 50 of the 289 fights) it won 13% and lost 38% of 8. See the
  split below.
- **The throttle chop is the worst.** Better after in 6%, worse in 29%, his
  guns on you in 35%, won 3%, lost 21%. The school found the reason on the
  flight law: a faster Spitfire turns tighter, not wider, so a chop does not
  make him fly past.
- **The shooting happens in a tail chase and the yo-yos.** A shot that would
  land in 74% of tail chases, 64% of low and 60% of high yo-yos, against his
  in 3%, 9% and 24%. The low yo-yo shoots but costs height (39 m of energy)
  and leaves the pilot worse placed in 27%; the high yo-yo gains 33 m.
- **The split-S runs, at a price**: 98 m of energy on the other, worse after
  in 27%.
- **Scissors and head-on passes are coin tosses**: 23% won and 23% lost in the
  scissors, 12% and 12% head on.
- **The Flip happens**: a reversal in 43 of the 289 fights; after it the pilot
  had a shot in 64% and won 26%, lost 9%.

"Better after" is the situation ranked chased, neither, on his tail; a
reversal and an overshoot are better or worse by their definition. A shot
that would land is the nose on the lead inside 400 m while firing
(`gunSolution`), not a recorded hit.

## Split by situation, energy and plane (2026-11-07)

`dogfight_manoeuvres_report.mjs` splits every manoeuvre three ways: by where
the pilot stood before it, by who had the energy going in (his height plus
speed against the other's, even within 50 m), and by plane. A cell under 5
manoeuvres prints its counts only. `--without <pilot>` leaves out every
fight a pilot is in.

**Whose fights these are.** A client recording sees the fights near the
player who recorded it. Chief-H.E.M.P, who uploaded several, is in 50 of the
289 fights and won 21 of them, lost 4; he flew 34 of the 50 Yak9 fights and
won 17 of them, lost 1. A plane's record here is its pilots' record, so the
plane table says who flew what, not what a plane can do, and every finding
below was checked again without him (239 fights). Where his fights change a
finding, it says so.

**Chased** (won / lost of the fights each was flown in, all fights, then
without Chief-H.E.M.P):

| Answer | Flown | His guns on you after | Won / lost | Without him |
|---|---|---|---|---|
| Break turn | 53 | 47% | 9% / 42% | 3% / 37% of 38 |
| Spiral dive | 53 | 43% | 2% / 28% | 0% / 30% of 50 |
| Climb | 52 | 54% | 21% / 29% | |
| Zoom climb | 30 | 70% | 3% / 37% | 0% / 38% of 29 |
| Throttle chop | 14 | 50% | 0% / 14% | 0% / 8% of 12 |
| Immelmann | 12 | 42% | 33% / 25% | 13% / 38% of 8 |
| Scissors | 9 | 78% | 22% / 33% | 14% / 43% of 7 |
| Split-S | 6 | 83% | 0% / 33% | 0% / 33% of 6 |

Nothing a chased pilot flew in these rounds wins more often than it loses.
Each answer gets him out of his chaser's sights in the next 3 s more often
than not (the break turn in 66%), and he still loses. Climbing away is the
worst: the chaser's guns are on him in 70% of zoom climbs. The reversal (47
times when chased, won 26% and lost 9%; 9% and 9% without him) is the only
way out that pays, and it is an outcome, not a manoeuvre: what the pilot flew
to get it is the row above it.

**On his tail:**

| Manoeuvre | Flown | Own shot after | Won / lost | Without him |
|---|---|---|---|---|
| Tail chase | 125 | 70% | 38% / 6% | 40% / 1% of 98 |
| Hard turn | 34 | 53% | 38% / 6% | |
| Spiral dive | 28 | 61% | 57% / 0% | 57% / 0% of 28 |
| Low yo-yo | 25 | 84% | 52% / 4% | 62% / 0% of 21 |
| Zoom climb | 17 | 65% | 35% / 0% | 31% / 0% of 16 |
| High yo-yo | 14 | 86% | 29% / 0% | 33% / 0% of 12 |
| Scissors | 9 | 78% | 33% / 22% | 43% / 14% of 7 |
| Boom and zoom | 6 | 67% | 83% / 0% | 83% / 0% of 6 |
| Overshoot | 20 | 0% | 15% / 10% | |

On his tail, the pilot who stays in the fight finishes it: the low yo-yo (a
shot after it in 84%, won 62% and lost none without Chief-H.E.M.P), the dive
on him, the boom and zoom. An overshoot throws it away: no shot after it, and
the man in front gets one in 40%.

**Energy going in:**

| | More energy | Even | Less energy |
|---|---|---|---|
| Low yo-yo | 53: won 49%, lost 6% | 23: 22%, 4% | 13: 15%, 31% |
| Tail chase | 89: 48%, 3% | 104: 42%, 4% | 71: 21%, 7% |
| Boom and zoom | 26: 31%, 4% | 3 | 11: 18%, 27% |
| High yo-yo | 5: 20%, 40% | 22: 23%, 5% | 15: 33%, 7% |
| Immelmann | 12: 42%, 8% | 8: 50%, 0% | 7: 0%, 29% |
| Break turn | 8: 0%, 25% | 29: 10%, 41% | 21: 10%, 48% |
| Zoom climb | 55: 22%, 7% | 39: 15%, 10% | 25: 4%, 44% |
| Spiral dive | 137: 31%, 12% | 54: 19%, 15% | 33: 9%, 36% |

Energy is most of it. The same manoeuvre wins with energy and loses without
it: the low yo-yo, the boom and zoom, the Immelmann (never a win with less
energy, 7 times) and the zoom climb. The high yo-yo is the exception, the one
manoeuvre that did better from below (won 33% and lost 7% of 15 with less
energy; 42% and 8% of 12 without Chief-H.E.M.P): it climbs out of the turn
and trades the speed it has for height it does not.

**By plane.** 187 fights were fighter against fighter (72 kills), 91 fighter
against a bomber or attack plane (28), 11 between two bombers (the Stuka,
Aichi Val, SBD and Ilyushin count as attack planes, not fighters:
`fighterRank`). Each type's record is mostly its pilots':

| Plane | Fights | Won | Lost | Pilots | Note |
|---|---|---|---|---|---|
| Bf 109 | 134 | 18 | 31 | 48 | the most flown, by the most pilots |
| Mustang | 93 | 21 | 14 | 31 | |
| Zero | 83 | 11 | 19 | 23 | |
| Spitfire | 80 | 18 | 8 | 19 | Option_X 21 fights, Paciencia 17 |
| Yak9 | 50 | 22 | 2 | 6 | Chief-H.E.M.P 34 fights, 17 won |

The plane table needs many more recordings, from many recording players,
before it says anything about the planes.

"Better after" ranks chased, neither, on his tail; a pilot on his tail cannot
be better after, nor a chased one worse. Won and lost are the fight's end,
which can come long after the manoeuvre.

## A fight in 3D, from its clip (2026-11-07)

Every dogfight has its own clip: the round's recording cut to the fight and
5 s before it, 3 s after (`viewer/recording-slice.js`, written by the
extractor as `viewer/dogfights/<id>.ndjson`; `--clips all` for every attack,
`--clips none` for none). The replay page plays it as it plays a whole round,
in 3D on the fight's own map: the school's **IN 3D** row opens it in a new
tab riding with either pilot (`?replay=dogfights/<id>.ndjson&follow=<pid>&clip`).

The recorder writes state on change, so a clip starts with what held when the
fight began, all at time 0: the header (with `clip: { id, slug, from, to }`),
the roster, animation table, control points and moving parts' names; the
state events in order (level, rules, who joined, teams), each player's last
control, seat change and kit, the last round clock; every object live at the
start (its creation, first-seen row, last pose, hit points, moving parts,
engines, stances, ammo), each player's last seat, and the tickets. An object
destroyed before the start, or out of the recording player's range at it (a
client file's `d`), is left out; what happened before (scores, chat, shots,
projectiles) is not carried. Then every row of the fight, its time moved back
by the clip's start.

Checked against its full recording: Option_X against A de(CHN) on Battle of
Britain, 31 MB of round cut to 616 KB, both planes within 0.000 m of where the
full recording has them at every half second, names and teams the same, the
round clock and tickets carried (797 v 493 at 15:56), the detector finding
the same fight and its kill in the clip; in the replay, Option_X's Spitfire
and A de(CHN)'s Bf 109 on the map, the tracers, the minimap, the kill on the
timeline. The 140 dogfights' clips are 87 MB (153 KB of the 616 gzipped);
`tests/test_dogfight_recordings.py` holds the cut on a written recording.

`?clip` makes the replay wait at the clip's start until the map is on screen
(a 22 s clip had played to 20.6 s behind the loading screen); `?follow=<pid>`
rides with that player from the start. Both are `map.html`'s replay `opened`.

## On its map, in the school (2026-11-07)

The school's own window over the fight's real map: its scrubber, speeds,
slow-on-shots and shot freezes, its cameras (Wide side-on, From above, behind
either pilot, either gunsight), meters, captions and manoeuvres, with the
map, the replayed planes and their tracers under its paths, rings and gun
lines. **On its map, in the school** in the IN 3D row opens it
(`map.html?mod&map&replay=dogfights/<id>.ndjson&clip&school=<id>`).

- The replay page loads the fight's clip as above; once the map is up it
  builds the theatre in world mode (`createDogfightTheatre({ world })`).
- The theatre draws the page's scene with its own renderer and cameras, then
  its overlay (no floor, no grid, no planes of its own: the replay's are the
  real ones) without clearing depth, so a path behind a hill is behind it.
  The map's fog, set for a pilot's eye, is pushed out four times for its
  draw: the wide camera stands hundreds of metres back.
- The theatre's clock is the only one (2026-11-07, second pass). Each
  frame it sets the replay's instant and the replay steps there and then
  (`ReplayPlayer.drive`, then the controller's update), so the replayed
  planes stand where that frame's rings and paths do. A step forward of up
  to half a second plays out as a frame does, its rounds fired; anything
  else (a drag along the timeline, a restart, a jump to a manoeuvre) is a
  light seek, the timeline drag's own: men moved, not rebuilt, no rounds
  fired again. The first pass ran two clocks and put the replay back with a
  full seek whenever they parted by 0.15 s, which rebuilt the soldiers and
  stuttered. Measured headless on 558jj8m4nb-40, dragging the scrubber end
  to end over 60 frames: median 16.5 ms a frame, worst 21 ms.
- The page's camera stands where the school's does (`look`), so the level's
  sky, its ear and its culling follow the school's view, and the page draws
  no frame of its own under the school. The whole level is drawn ("render
  entire map" on): the draw distance is measured from the replay's camera,
  and the school's stands hundreds of metres from it, which left most of El
  Alamein unbuilt. Esc puts the option back as it was.
- Only the two planes (`ReplayPlayer.setFocus`, by their net ids and
  pilots): every other hull is put away and silent, every other soldier is
  not drawn, no kit or round of anyone else, and no shot of anyone else is
  fired, so no Thompson across the airfield. The level's own sounds (the
  wind bed, the placed ambience) are off too (`pageAudio.quietWorld`). Esc
  clears the focus and the round plays as it stands.
- The camera on the map: Wide stands about a fifth as far back as over the
  schematic's floor (`max(55, span * 1.15 + 35)` metres, span the distance
  between the two), so the planes are the picture. The trail is a contrail
  off the tail (0.9 m wide, from 4.5 m behind the plane's middle, the last 8
  s of it) rather than a ribbon the width of the wings; the floor shadow and
  the schematic's muzzle flash are not drawn (the replayed plane fires its
  own).
- Every path is in the map's own coordinates (origin 0). The list shows the
  fights with a clip, and one picked opens its own page (its clip, maybe its
  map). Esc closes the school onto the replay itself. No lessons and no WHAT
  IF there: those are flown, not recorded.

### The map layer

The LAYERS card, bottom left of the school's stage on a recorded fight with
a clip, switches between the schematic and the fight's own map, the way a
map site switches to satellite. Over the schematic it shows the level as the
game's own in-game map draws it (`minimap.image` in the level's scene.json)
with **3D map** and the level's name; over the map, a drawing of the two
paths with **Schematic**. It calls attention twice when it first appears.

- **3D map** loads the map page above (`&embed&at=<t>`) in a frame over the
  school's window, unseen. The schematic plays on and the card runs a scan
  line ("Loading El Alamein..."). The page skips the briefing click and says
  `ready` (a `postMessage` to the same origin) once the map is up; the frame
  fades in, the way in plays, and the camera glides down to the moment the
  schematic was at. The school under it stops drawing.
- **Schematic**, or Esc on the map, hands back the fight's time and whether
  it was playing; the frame is removed (its page, its WebGL context and its
  level go with it). A fight picked from the map's list comes back to the
  school, which shows it and loads its map again.
- A page that cannot open the recording or its level says `failed`, and the
  card says why; one that says nothing in 180 s is given up on.
- The map page opened directly (the IN 3D link) has no card: there is no
  schematic to go back to.

Checked headless on the Range (`layer.cjs` probe): the card showed El
Alamein's map, the map layer was up 1.1 s after the click on the local
server, the frame's school showed **Schematic**, and clicking it left no
frame and the school at the map's time.

### The way in

The first fight opened on its map arrives in four beats
(`INTRO` in `dogfight-theatre.js`, 7.3 s, wall-clock timed so a slow frame
does not stretch it; a click or a key skips it):

1. **Mesh** (1.8 s): the map as scan lines over a dark sky, swept in from
   the west. Not three.js's wireframe, which draws a level's terrain from two
   kilometres out as a solid fill (more edges than pixels): a grid laid in
   world space every 40 m, contour lines every 12 m of height, each face lit
   faintly by its slope, and a glow on the sweep's leading edge. The sky and
   the sea are left out, so the land stands in the dark.
2. **Paint** (1.8 s): the level's own materials swept over the mesh behind
   a moving line (two draws, clipped either side of it), the sky's colour
   coming up from the dark with it.
3. **Spawn** (0.9 s): the theatre's overlay appears and the two pilots'
   rings burst in where they are.
4. **Glide** (2.8 s): the camera comes down from 2300 m out and 1500 m up,
   circling slowly, into the Wide view; the school's panels fade in as it
   lands, and the fight plays.

Checked headless (`intro.cjs` probe: frames at 1.0, 2.4, 3.2, 4.0, 5.6 and
9.0 s): each beat is on screen at its time, and at 9 s the intro is over and
the replay is playing from the fight's start.

### One system: what the school and the replay share

The dogfight code reads the round recordings with the replay's own code,
not copies of it:

| Need | Shared from `replay-recording.js` |
|---|---|
| Recording frame to the viewer's (x, y, -z; quaternion -x, -y, z, w) | `viewPosition`, `viewRotation` (also used by `replay-actors.js`) |
| A flown object's position and rotation at t, read linearly over its samples | `flownPositionAt`, `flownRotationAt` |
| How long since a sample at t (the 3 s gap past which a far plane's path is not trusted) | `flownGapAt` |
| In replication range, team, name at t | `isReplicated`, `teamAt`, `nameAt` |

The planes drawn are the replay's models, found by the same lookup
(`pose-bases.js` `modelUrls` and `loadFirst`, as `replay-assets.js` uses). The 3D view is the replay page itself
running the clip, with the school as its clock and camera. Re-extracting all
32 recordings after the move gave the same 289 fights, sample for sample.

### Damage, sound, zoom and words (2026-11-07, the owner's notes)

- **Smoke, fire and the death explosion.** Under the school the replay's
  own clock stands still, and the page's effects ran at its rate: 0. The
  school now hands its rate to the replay with the time (`drive(t, rate)`,
  `feedRate`), so damage smoke, fires, explosions and rounds in the air run
  at the picture's speed (0.3 on a shot, 0 in a freeze). The game's own
  thresholds stand: a Bf 109 smokes under 40 of its 100 hit points, a
  Spitfire under 65 (`em_Bf109Damage@40`, `em_StukaDamage@65` in the
  hulls' effect tables).
- **Hits that land.** On the map each meter carries the plane's hull, read
  from the replayed hull (`health(nid)`), and flashes red on every drop: a
  burst that lands shows before any smoke does. Checked on Option_X v A
  de(CHN): 100, 93, 69, 53, each with the flash, then 0 and the explosion.
  A plane can start a clip damaged (the Spitfire there reads 85%: 15 lost
  earlier in the round).
- **Silence when it stops.** A replayed hull's engine (and guns) now go
  quiet whenever the replay is not running, paused, held on a shot or run
  out (`replay-hulls.js`): a clip that ended with the gunsight camera on
  the ace droned on. This holds for any replay, not only the school's.
- **Zoom.** The wheel zooms Wide in as far as 6 m from the point between
  the two (`WIDE_NEAREST`), on the map and over the floor (it stopped at
  0.35 of the distance before).
- **The bfstats.io sigil** heads the school's sidebar, linked to the site.
- **Selectable rows.** The list's rows were buttons, whose text no drag
  selects (and the drag picked the fight). They are rows now (`.dfs-row`,
  `role="button"`, Enter or Space): a drag selects a pilot's name or a
  fight's line, and a drag that selected text picks nothing.
- **Third person.** The pilots' captions are written as the pilot speaks
  ("He is on my tail: breaking into him"), and under a pilot's name, or in
  the shot card's "How he got it", "my" read as the viewer's. Every caption
  and the shot card now name both (`inThirdPerson`): "Paciencia is on
  Minnie's tail: breaking into Paciencia" in a recording, "The other pilot
  is on the ace's tail" in a lesson; a recording's own captions are written
  with the names ("On Paciencia's six, 120 m").

- **A quiet title.** The card that names a fight or lesson as it comes up
  sat in the middle of the stage, over the planes. It is a small line along
  the top now, no box, a soft shadow under the type: centred between the
  meters and the shot card on a wide stage, right-aligned beside the meters
  on a narrower one, under them (title only) on a phone.

## Grouped by day, by round, by pilot (2026-11-07)

FROM THE RECORDINGS groups the fights three ways: **By day** (newest first,
each day's rounds under it), **By round**, and **By pilot**, a leaderboard of
who dominates: each pilot's fights, wins (he shot the other down) and losses,
the fights where both shot and how many of those he won, his rounds and his
planes, ranked by wins, then fewest losses (`pilotTable` in
`viewer/dogfight-recorded.js`). A pilot's row lists his fights. The Dogfights
/ Every attack filter applies to all three.

In the dogfights, Chief-H.E.M.P leads at 11-3 (23 fights, 3 rounds), then
Paciencia 4-0, skandia 4-1, serg 4-1 and SonTinWong 4-3; over every attack,
Chief-H.E.M.P 21-4, Option_X 10-1, Paciencia 8-1. A client recording sees
the fights round the player who recorded it, so its recorder leads its own
board; and a name is not a person (two players can share one, and one can
change his).

## What if: his other ways out (2026-11-07)

From any moment a pilot is in the other's sights (the other's nose within
30 degrees of him inside 600 m), WHAT IF under the picture flies his other
ways out (`viewer/dogfight-whatif.js`): both planes put exactly where the
recording has them (place, speed, attitude) and flown 8 s on the flight law.

- **The ways out:** break turn into him, hard turn away, turn in then run
  (`olDip`), turn, chop and pull up (`olFlip`), pull straight up, Immelmann,
  split-S, dive away at 45 degrees, run flat out. The plain ones are small
  plans in the module (`wiInto` ... `wiImmelmann`) that commit at the moment
  they start, as a pilot does.
- **The chaser** is `wiChaser`: after him at full throttle, the nose on the
  lead his rounds need, firing whenever that shot would land inside 400 m.
  The school's hunter was the first chaser tried, and was wrong for this:
  built for the lessons, he eases off as he closes and holds his fire to
  150 m, so against a runner he fell back to 300 m at 38 m/s and never
  fired, and every way out scored the same.
- **The planes** are the recording's own types where the page can build
  them (`makePlaneFor`: the battle's parked one, else the airframe built from
  the loaded model), else the battle's fighter.
- **The score**, the same for the recording and every way out: the seconds
  in his line of fire (his nose within 10 degrees of the lead inside 400 m),
  the seconds he had a shot that would land, the hits, your own shot, and
  being shot down or flying into the ground. Ranked best first; "What he did"
  heads the list.
- **Any way out plays on from the recording** (`spliceFight`): the recording
  up to that moment, the flight after it, one fight, with every camera,
  manoeuvre name and shot explanation. Back to the recording returns.

On Battle of Britain at 6 s of Option_X (Spitfire) against A de(CHN)
(Bf 109): what A de(CHN) did left Option_X 1.9 s of a landing shot and the
kill. Turning in then running, or breaking into him, left him no shot and no
hit; pulling up, the Immelmann and turning away the same; running flat out,
diving, the split-S and the chop gave him 1 to 2.6 s and 5 to 12 hits. On the
school's own "out of the lock" lesson (flying straight with the hunter
behind, shot down), the best way out at 10 s leaves the hunter a fraction of
a second (`tests/test_dogfight_whatif.py`).

What it is not: the chaser is the school's gunner, not the player who was
there, and 8 s is a short horizon; a way out that buys 8 s may still lose
the fight.

## Tests

`tools/bf1942-models/tests/test_dogfight_recordings.py` writes a 30 s round
in the recorder's own format (a Spitfire chasing a Bf 109 round a circle with
aimed bursts and a kill, a teammate shooting at his own side, a burst at the
sky, a jeep, a 50 m/s KettenKrad), reads it with the viewer's reader and holds
every rule above: the planes, the one fight, its window, its sides, the
aimed count, the kill, and the theatre's frame and reading of it.

## Open

- **Two pages at once.** While the map layer is up the Range page under the
  school keeps its own frame going (its level, its bots), as it does under
  the schematic. The school stops drawing, but the Range does not; on a weak
  GPU that is two levels' worth of work. Pausing the Range page's frame
  while the frame is up would halve it.

- **Publishing.** The files and clips are local (`viewer/dogfights` is
  ignored, as the other generated trees are). For play.bfstats.io they need a home on the
  assets volume and a run after each upload, or the replay page could find a
  recording's fights itself (the detector is a browser module and runs in a
  fraction of a second on a parsed recording).
- **The heights** are the recording's own, metres above the map's zero, not
  above the ground under the plane.
- **The planes drawn** are each pilot's own type: the Range battle's parked
  one when it has it, else the template's model from its mod's tree, then
  vanilla's (`proving-ground-page.js` `recordedPlane`), with its effects,
  tracer and round templates hidden. The battle's fighter stands in until it
  loads. The chase cameras sit back by the plane's span (twice as far behind
  a Ju 88 as a Spitfire).
- **Server recordings** carry impacts (`i`) and so prove hits outright;
  client recordings prove them by hit points, which only the client's
  replicated objects carry.

## Next: what wins

Done: the manoeuvres are named (checked against the lessons) and scored
against the situation before and the outcome after (above). Next:

1. **More fights.** 289 from 14 rounds is enough to see a pattern, not to
   trust one. Each new upload is a `--download` run away.
2. **Done: situation by situation** (above). It showed the first findings
   leaning on one recording player's fights; recordings from many players
   are what the plane table needs.
3. **Learn from it**: with a few hundred more fights, a model that predicts
   the outcome from the opening geometry and the manoeuvres flown, and the
   school's pilots flying the moves the data says win (the Dip, the Flip and
   the Ninja checked against what real players did).
