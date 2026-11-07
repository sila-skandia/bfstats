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
