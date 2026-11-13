# Up and over: the Dip, the Flip and the Ninja (investigator: uo)

Who is in trouble: you, the follower. You are chasing him, 280 m back and
28 m/s slower; he pulls up to 78 degrees, and a pilot who follows him up
hangs at 13 m/s under him.

Scored with `tests/dogfight_dfn_measure.mjs` from the nine starts (your
start x -30/0/+30, speed -3/0/+3), skill 0.7 in every demo (the lesson's
other demos fly 0.7 and `test_dogfight_shape_vertical` holds one skill per
lesson). Held by `tests/test_dogfight_dfn_uo.py` + `dogfight_dfn_uo.mjs`.

## The ace: `uoAce`

`upAndOver` with one addition: once he is down from the top (pounce, zoom)
and you are going away from him (his nose more than 100 degrees off yours,
past 320 m), he dives after you, height spent on speed, a hard turn first if
you are more than 55 degrees off his heading. The plain `upAndOver` zooms
back up and lets a runner go: against it, turning back the way you came
"works" 8 of 9, which is not a Dip. All three new demos fly `uoAce`; in the
Flip and the Ninja it never triggers (you stay close), so their runs are
the same against either.

## The Dip: past him, then run (`uoDip`) - 9/9, works

With the school's give-up rule in `uoAce` (past his guns' reach + 30 m and
not closing for 6 s in a row, he lets you go, climbs away and stays out
unless you turn at him or get on his tail): he lets go 21 to 29 s in, 730
to 1300 m behind, in all nine; at 35 s you are 1566 to 1765 m apart and
opening, never hit. Before the rule (him chasing for ever) it was 7/9, as
below.

Climb after him at 30 degrees on his bearing (never into his climb). When
he goes over the top (his nose under 30 degrees and not climbing, 3 s
after his pull), or his nose comes onto you inside 350 m descending, aim
80 m beside him and 30 m under him and fly past his dive; then full
throttle straight away from him, 6 degrees down, level between 240 and
180 m. His half loop points him back the way he came, so he has to turn
round from slow to chase.

Nine runs, 35 s: never hit (0 rounds of his land, from the start); 1105 to
1390 m apart and opening 15 to 33 m in the last 3 s in seven; the two
starts 30 m to the left (speed -3, 0) end 753 to 765 m apart, him closing
about 1 m/s. Past 40 s he closes at 1 to 3 m/s in all nine (a stern chase
between equal Spitfires, him with a little more energy): from 1100 m that
is minutes before he is back in reach, which is why the demo ends at 35 s.
The verdict changes with the length: 7 at 30, 35 and 40 s, 0 at 50 s.

Candidates (against `uoAce` unless said):

| technique | works/9 | why it fails |
|---|---|---|
| D1 straight on under him, shallow dive | 0 | he loops through behind you: 260-340 m on your tail at equal speed, never closer, never further; 6-20 hits from the starts on the left |
| D2 turn back the way you came | 0 (8 vs plain `upAndOver`) | his half loop comes out on your heading, behind and above: 320-360 m and closing |
| D3 90 degrees off and dive | 0 | 285-307 m and closing; 10-17 hits from the left |
| D4 straight on, jink off his nose inside 500 m, run | 0 | 410-480 m, closing; 1-2 hits |
| D5 steep dive at once | 0 | shot down in 5 |
| D6 shallow follow 25 deg, then dive under his pounce and run | 0 | 1-16 hits in the pounce; 400-750 m, stalls |
| D7 as D6, past him beside his dive (no shot), run straight away | 3 | 25 deg climb: 550-850 m from six starts; 15, 20 deg: 0; 33: 6; 28: 6 |
| D7 at 30 degrees (the demo) | 7 | see above |

Why 30 degrees: the steeper follow banks height that the run turns into
speed, and he comes over the top closer to you, so his chase starts later
and slower.

## The Flip: shoot him as he hangs (`uoFlip`) - 6/9, partly

The move starts at his pull (your `flip-follow`). A 25 degree climb on his
bearing, nose under him; the shot when he is under 38 m/s inside 320 m and
you are over 40; off the shot under 40 m/s, nose over 60, after 6 s or
inside 120 m; then past him 80 m beside and 30 m under his dive
(`flip-pass`), also whenever his nose comes onto you inside 350 m while he
descends at over 33 m/s; round onto him again, never more than 25 degrees
up (`flip-back`), and the shallow follow again when he zooms.

Nine runs, 24 s: in six (start x 0 and +30) you are in his rear quarter,
nose on him, for 2 s (about 3 s after his pull in five, 19 s after in one, timed at 35 m/s or more) and
have the shot as he hangs for 1.0 to 1.3 s, 7 to 19 hits. From the three
starts 30 m to the left he is 245 to 270 m away at his top, past the guns'
270 m with the lead off, and you get no shot (in his rear quarter at
35 m/s or more in only one of them, 20 s after the first pull). His landing shot is 0.13 s at
most, never a hit; closest 17 to 19 m.

| technique | works/9 | why it fails |
|---|---|---|
| `shallowFollow` as it is | 1 | after the shot you fly into his pounce: 11-13 m passes |
| shot, then a hard turn away from his pounce | 6 | 6/9 at 30 s, but 3 kills hang on the close pass (min 15-21 m) and the left starts get no shot |
| shot, then a diving turn away | 5 | slow (28-36 m/s) nose high, the diving turn moves you too little: 10-15 m passes |
| shot, early exit and a dive under him | 0-4 | runs straight under his pounce; he gets 0.3-1 s of shot |
| shot, then past him beside his dive (the demo) | 6 | the left starts: out of reach at his top |
| as the demo, climb 22, 28 or 30 degrees | 0, 4, 0 | 22: too far below him; 28/30: too slow at the top |

## The Ninja: shallow, never in his sights (`uoNinja`) - 9/9, works

The same chase as the Flip, flown on for 40 s: every pull up gets a 25
degree climb, the shot if he is in reach, and a pass beside his dive. All
nine: his guns on you 0.13 s at most, no hit on you; you land 7 to 19 in
six and 0 to 2 in the three starts on the left; closest 17 m. 9/9 at 16,
20, 24, 30, 35, 40 and 45 s.

Other Ninja candidates: chasing from 50, 100 or 150 m above him (3, 4 and
2 of 9: the follow lands under him in the wrong place), from 60 m closer
(3) or 100 m further back (0); `shallowFollow` (3: the close passes); the
diving-turn clear (5).

## Survival: yes

"Yes, if you never follow him up: climb after him at 25 degrees, shoot as
he hangs and fly past his dive, and he never hits you (9 of 9); or climb at
30, pass him over the top and run (clear in 9 of 9)."

## What changed

- `viewer/dogfight-pilot.js`: `uoAce`, `uoDip`, `uoFlip`, `uoNinja` (the
  last two from `uoShallow(move, title)`), `uoPassBeside`, `uoPounce`;
  INTENTS for the four.
- `viewer/dogfight-lessons.js` (up-and-over only): demos `dip`, `flip`,
  `ninja` with verdicts, `survival`, a coach line for `chase`.
- Kept: `move` (the trap) and `counter` (`shallowFollow`). `counter` is
  superseded by `flip` but `test_dogfight_shape_vertical.py` holds it; it
  can go once those tests point at `flip`.

## Open

- Fragile: the follow is tuned to the lesson's start. From 60 m closer or
  with height the same plans drop to 0-5 of 9.
- The Flip and the Ninja are one technique (in this lesson you start as the
  chaser, so keeping the chaser's role and never giving him a shot are the
  same answer); the demos differ in length and in what they show.
- The measure: the Ninja's "rear quarter 3 s" is met by the first 3 s of
  the chase in every run here (you start behind him), so a Ninja that never
  shoots would pass too; the Dip's "still opening" fails a stern chase that
  has stalled at 750 m+ with him closing 1 m/s (two runs).
- `upAndOver`'s captions over the top: its pounce ends early (on `pass` or
  him below you) and says "Back up again on the dive's speed" while he is
  still near the top at 38 m/s (dip demo at 9.9 s). Inherited by `uoAce`.

Screenshots (the theatre, the lesson's start): `<SCRATCH>/dfn-uo/`
`uo-dip-wide-9.png`, `uo-dip-top-34.png`, `uo-flip-wide-8.png` (kill shot
231 m, 1.3 s), `uo-flip-top-23.png`, `uo-ninja-top-39.png`,
`uo-ninja-wide-11.png`.

## Ascendancy (2026-11-07)

The owner, watching another lesson's Ninja turn in lockstep with a breaking
enemy: the Ninja is the ascendancy, "coming up with a shot, and how to stay
there". The measure (`tests/dogfight_dfn_measure.mjs`) now wants two attacks
a second apart (or the kill), never his six for a second, and never 20 s
inside 600 m without another shot. Every pilot also has human eyes
(`reviews/eyes.md`). Under it the old Ninja flew 0 of 9: one shot at his
first top, then a level turn back onto him that cost 65 m of energy height,
and 24 to 42 s circling slow under his loops with no second shot.

Who has the advantage: he has 120 m more energy at the start and keeps going
up; you win it because every loop he flies ends with him slow over the top,
in front of a man below him who never followed him up. The upper hand is
yours from his first top on, as long as you never meet his dive and never
spend your speed turning level.

### The doctrine as flown (`uoAscend`: `uoNinja`, `uoFlip`)

- Chase straight and level until he pulls up (turning onto him at 50 m/s
  cost the starts on the left 9 m/s, and with it their first shot).
- Follow at 25 degrees on his bearing, steered gently (`fine: 30`).
- The shot as he slows over the top (under 42 m/s, inside 340 m); off it at
  40 m/s, or at 37 while he hangs under 28 m/s with his nose off you.
- Past him beside his dive, 60 m off, the nose never above 5 degrees down.
- **The slice**: round onto his zoom nose low, decisively to the side his
  own heading lies (with him dead astern the turn otherwise dithered for 5
  s), lift 0.4 under the horizon, pulled at 0.85, out once he is within 75
  degrees of the nose or after 7 s, never diving below 150 m. It turns 100
  m of height into the speed for the next climb, and he loses you under his
  tail for a third to a half of it.
- The follow again, and the shot as he slows over the top of his next loop.

### What it flies (exact, `test_dogfight_dfn_uo.py`)

| move | technique | works/9 | attacks | my shot s | hits on him | six max s | idle max s | killed |
|---|---|---|---|---|---|---|---|---|
| Dip | past him over the top, then run (`uoDip`, unchanged) | 9 | 0-1 | 0-0.37 | 0-2 | 0 | 12 | 0 |
| Flip | from his first pounce: past his dive, slice behind his zoom (`uoFlip`) | 7 | 2-4 | 0.7-3.5 | 8-24 | 0 | 27.5 | 8 |
| Ninja | shoot him at the top of every loop (`uoNinja`, 50 s) | 8 | 2-4 | 1.8-4.5 | 18-34 | 0 | 27.5 | 8 |

- **Ninja**: first attack 6.8-6.9 s in all nine, second 17.4-18.9 s in all
  nine; he is shot down at 18.9-20.2 s in six, 25.2 and 43.3 s in two. His
  guns never have a landing shot (0 s), no hit on you, never on your six,
  closest 17 m. The failure is the start 30 m to the left at even speed: 18
  hits in two attacks, then 27.5 s with no shot (the third cycle comes round
  too low and far: `final-ninja_-30_0.png`).
- **Flip**: the move now starts at his first pounce (8.9 s), when he comes
  back down at you and you are the one hunted. In his rear quarter with the
  shot 9.6-11.0 s later in seven, never his six after. Fails: (-30, 0) as
  the Ninja; (-30, +3) shoots him down at 43 s but never sits 2 s in his
  rear quarter.
- **Dip** under the eyes: still 9/9, never hit; he lets go at 20.7-29.0 s,
  696-1306 m behind; at 35 s 1536-1792 m apart and opening. Two of the
  three left starts now see him clear-turn after letting go.

### Candidates (works/9 under the measure and the eyes, 50 s unless said)

Ninja:

| candidate | works | why it fails |
|---|---|---|
| old `uoNinja` (pass, then a level turn back) | 0 | one attack; the turn costs 65 m of energy, 24-42 s circling under him |
| hold the first shot longer (off at 30 or 25 m/s) | 0 | flies into his pounce: hit 1-11 times, passes at 3-10 m |
| after the pass, extend 3-5 s diving, then turn back | 0 | idle 40 s, his six 1-2 s |
| `ascend` from the lesson's start | 0 | no shot in 8; he hits you in 2 |
| first pass, then hand to `ascend` | 0 | one attack, then its climb step circles: idle 42 s |
| pass, then aim onto his zoom's line behind and under him | 0-3 | the turn onto a moving point overshoots; kills in at most 3 |
| pass, then the nose-low slice toward him | 5-6 | left starts: no first shot (chase turn cost the speed) and the slice dithers with him dead astern |
| + straight chase, gentle follow, decisive slice side | 6 | left starts: two attacks, 10-18 hits, then hanging at 20-28 m/s under him |
| + pass never climbing, longer shot on a hanging man (shipped) | 8 | (-30, 0): see above |

A random search over the shot, pass and slice knobs (2000 configs, the old
chase) never put a left start through: the best was 6. Around the shipped
point (hang 25-36 m/s, off speed 35-39, pass -5 to +5 degrees, the hang's
nose-off 35-55), 29 of 108 configs fly 7 or 8, the rest 4-6.

Flip:

| candidate | works | why it fails |
|---|---|---|
| old `uoFlip` (shot as he hangs, from his pull), 24 s | 6 | passes only because the demo stops before IDLE can bite |
| the same at 50 s | 0 | the stalemate: idle 42 s, his six 3.6 s |
| from his pounce, level turn back onto him | 0 | as above |
| from his pounce, past his dive, then hand to `ascend` | 0 | in his rear quarter at 18 s in eight, but no shot: its climb step circles, idle 32 s |
| from his pounce, past his dive, slice behind his zoom (shipped) | 7 | the two left starts |

### The ace

`uoAce` is unchanged (`dogfight_ascend` holds it too). It goes back up after
every pounce, which is the lesson's move; with you coming round under his
tail he has lost you for part of the slice, but at the second attack he sees
you in all nine. **Open, for the coordinator**: a sensible ace who has been
hit at the top of his first loop might not loop again. A probe variant that,
starting his zoom, turns to meet you instead whenever he sees your nose
within 45 degrees inside 400 m drops the Ninja to **1 of 9**: the fight
becomes a descending scramble at 50-140 m, neither side landing much (him 0
hits, you 10 in the middle start), which is no one's ascendancy. Not
shipped: it is a different lesson (no up and over after the first), it would
move the Dip and every number here, and `uoAce` is the ace the bench and FLY
IT use. The probe is in `<SCRATCH>/asc-uo/wary.mjs`.

### Words

The Ninja's label "The Ninja: shoot him at the top of every loop", the
Flip's "The Flip: under his dive, round behind his zoom", their notes,
verdict lines and the survival line quote the numbers above. The counter
demo's words moved with the eyes: following shallow lands 12 a fight to his
0.6 (0.2 before), first hits in all nine (7), held by
`test_dogfight_shape_vertical.py` and `test_dogfight_school.py`. The coach's
zoom tip teaches the slice.

### Pictures

`<SCRATCH>/asc-uo/` (`plot.mjs`: top-down and side-on, 2 s marks, landing
shots thick, grey where the other does not see that plane):

- `final-ninja_0_0.png`: the demo's start: follow, shot at 7 s, past his
  dive, the slice at 11-16 s (grey: he has lost you), behind his zoom, shot
  at 17.7 s, down at 18.9 s.
- `final-ninja_-30_0.png`: the failure: two attacks, then the third cycle
  comes round low and far, 27.5 s without a shot.
- `final-ninja_-30_3.png`: works, but untidy: a scrappy 26-34 s before the
  kill at 43 s.
- `final-flip_30_0.png`: the Flip from his pounce at 8.9 s, behind his zoom
  and shooting at 18.7 s.
- `cur.png`: the old Ninja at 50 s: one shot, then circling under his loops.
- Theatre: `top-up-and-over-ninja.png`, `look-up-and-over-ninja-wide-13.png`
  (the slice), `look-up-and-over-ninja-wide-18.png` (the second shot, 261 m).

### Open

- The left starts: one in nine fails for want of a third shot, and the
  late kill from (-30, +3) is not a clean fight.
- The wary ace above.
- Most fights end in a kill by 20 s, so the 50 s demo shows the ascendancy
  won twice and then the kill, not 50 s of holding it.

## Ascendancy, round two (2026-11-07, after the independent review)

The review said "fix first": the ace played to lose (hit 9-14 times at his
first top, he looped again and hung at 6-18 m/s while you shot), the Flip was
the Ninja relabelled, the pass did not do what its caption said, and the
Dip's words were wrong once his chase also works over the top. The measure
moved the same day: attacks are bursts of 0.3 s, 3 s apart; the IDLE clock
also starts at a 50 m energy lead; no hanging (3 s under 35 m/s inside 300
m); a fight ends at the kill; and the nine starts are the L9 array
(`STARTS`: sideways, along, height and speed). Everything above this
section is history; these are the numbers that fly.

### The ace: `uoAceSharp` (Dip, Flip, Ninja)

The reviewer's `uoAceB` with `uoAceR`: after his first loop he does not go
up again with a man he can see behind his beam or pointing at him (he breaks
into him, then breaks it off, climbing away the way he came); he breaks from
a man he sees on his tail in any phase; his chase after a runner also starts
over the top. Two things added: a shot that would land is taken even while
he breaks it off (the school's "a shot that lands reads as going for it"),
and his let-go caption says "breaking it off" (it is no longer only after an
out-of-reach chase). `uoAce` keeps the trap and counter demos, FLY IT on
those tabs and the ascend bench.

### What flies (exact, `test_dogfight_dfn_uo.py`, L9 starts)

| move | technique | works/9 | attacks | my shot s | hits on him | six max s | idle max s | hang max s |
|---|---|---|---|---|---|---|---|---|
| Dip | past him over the top, then run (`uoDip`) | 7 | 0-1 | 0-0.37 | 0-2 | 7.7 | - | 5.2 |
| Flip | from following him up: push over off his line, round behind him (`uoFlip`) | 0 | 0 | 0-0.17 | 0 | 3 | - | 5.3 |
| Ninja | his top, then in behind him unseen; leave when he turns in (`uoNinja`) | 6 | 0-2 | 0.3-3.3 | 1-26 | 0 | 16.5 | 3.03 |

- **Ninja** (start 0, the one the theatre plays, works): first burst at his
  top 6.7-7.3 s; he breaks after his loop and climbs away without seeing
  you; you close behind him under his tail and shoot at 16.6-17.3 s from
  ~210 m; he goes down at 19.7 s in one, in five he sees you at 136-185 m
  and turns in, and you leave (1256-1597 m apart at 50 s, both flying away:
  the shared pilot's return is too slow for a third attack). Fails: (0,
  -30, -10, -3) short first burst, he turns to meet you, no second; (0, 30,
  10, 3) the pass goes within 7 m; (30, -30, 0, 3) one real burst, the edge
  held 38%. His guns never land, never on your six, no hit, in all nine.
- **Flip**: the hunted pilot is the one who followed him up (the reviewer's
  suggestion). Off the climb at 42 m/s, nose down off his line, then the
  Ninja's machinery. 0 of 9: from 330-380 m below and behind at 42 m/s with
  the nose 40-65 degrees up, the nose comes down slowly and you hang 2-5 s;
  never 2 s in his rear quarter; 1-2 hits on you in three; in seven he
  turns to meet you and the fight ends circling low (`r2-flip-s0.png`,
  26-36 s): a no, shown as one.
- **Dip**: in seven he breaks it off at 12.1-12.6 s, 35-100 m away, and
  climbs home; 2298-2555 m apart and opening at 35 s, never hit. Fails: (-30,
  30, 0, -3) 5 hits in his pounce; (30, -30, 0, 3) he chases over the top,
  sits on your tail 7.7 s and lets go at 33 s, 461 m back.
- **The pass** now pushes (full forward stick, 15 degrees down, 80 m off):
  flown 31-41 m/s, the nose 40 degrees up at the start coming through the
  horizon; closest in the fight 21-47 m. Caption: "Off the shot at 41 m/s: pushing the
  nose down, past him beside his dive"; coach: "Off the shot now: push the
  nose down and let him go past beside you."

Survival: **yes** (the Dip, 7 of 9). The line leads with the Dip and says
staying on top works partly, and that once you have followed him up nothing
found gets you out on top.

### Candidates (works/9; old grid unless "L9")

Ninja against `uoAceSharp`:

| candidate | works | why it fails |
|---|---|---|
| round one's Ninja (slice, then the next top) | 1 | he does not loop again; you sit unseen astern at 58-60 m/s, 195-253 m back, no hits, then a flat circle 25-50 s |
| first pass, then hand to `ascend` (after the pass / after the slice / with height) | 0 | its climb step circles with a turner: idle 30-42 s |
| + stalk him astern, guns inside 170-200 m, then a 70 degree zoom | 0 | the second burst comes; the zoom hangs at 14 m/s; no third |
| + stalk, then `ascend`'s zoom when he turns in | 0 | idle 31 s: round with him |
| + stalk, then leave (old shot exit) | 0 | the hang rule: 3.1-3.8 s under 35 m/s after the first top |
| + shot exit at 41.5 m/s, pass pushed over, climb 24 (random search, 440 configs) | 9 (old grid) | |
| the same, L9 | **6** | the three above; 280 configs around it under L9 never pass 6 |
| leave turned 30-90 degrees off his line instead of straight away | 6 (old) | he follows; six 1.2-1.6 s |
| leave only to 500-800 m, then straight back at him | 6-8 (old) | back inside 600 m without a third burst: idle 21-23 s |

Against plain `uoAce` the shipped Ninja flies 2 of 9 under L9 (the stalk
waits for a let-go that ace never flies).

Flip from following him up (`uoAceSharp`, old grid):

| candidate | works | why it fails |
|---|---|---|
| at the hang (24 m/s), nose down, then slice or pass | 0 | the hang rule from the move on; 3-13 s slow |
| off the climb at 30-48 m/s, dive 0.7-3 down, 0-1.5 sideways, to 40-50 m/s | 0 | the nose will not come down quickly; no rear quarter with a shot |
| off the climb, a lateral break instead of the dive | 0 | 2 s in his rear quarter in five (34 m/s variant) but no shot, and 7-8 s hanging |

### Open

- The Ninja's end: in five starts the fight ends with both flying apart
  after you leave. A return that brings a third burst inside 50 s was not
  found (too slow, or idle when it comes back inside 600 m).
- `uoAceSharp` breaks it off and flies home after a break, which is what
  lets the Ninja in behind him unseen; an ace who turns to fight after his
  break (the round-one probe, `wary.mjs`) leaves the Ninja one pass.
- The Flip demo shows the "no": the hunted pilot ends circling low with him.

### Pictures (`<SCRATCH>/asc-uo/`)

`r2-ninja-s0.png` (start 0: top, stalk, leave), `r2-ninja-s1.png` (a
failure), `r2-ninja-s5.png` (the kill at 19.7 s), `r2-flip-s0.png`,
`r2-dip-s0.png`, `r2-dip-s7.png` (he chases over the top); theatre
`top-up-and-over-ninja.png`, `look-up-and-over-ninja-wide-17.5.png` (the
second burst from behind him, "lost sight of him"),
`look-up-and-over-flip-wide-14.png`.


## On retail g and box area (2026-11-12)

Re-flown on the final law (gravity `Math.fround(-14.73)`, box-drag area
`3.14 * 0.25`; `features/retail-parity-cross-check-2026-11-12`). 

- **Ninja 6/9** as before, the same three fails; but now three of the six
  shoot him down (18.8-20.1 s; one at 19.7 s before) and three leave as he
  turns in at 152-193 m, 1308-1594 m apart at 50 s.
- **Flip 0/9**: he hits you once or twice in four (three before).
- **Following shallow** (`counter`): 10.3 hits a fight to his 0.6 (12 to
  0.6 before).
