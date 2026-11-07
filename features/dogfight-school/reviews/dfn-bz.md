# Boom and zoom: the Dip, the Flip and the Ninja (investigator `bz`, 2026-11-07)

Lesson `boom-and-zoom`. Shape test: `tools/bf1942-models/tests/test_dogfight_dfn_bz.py`
with `dogfight_dfn_bz.mjs` (5 tests, under 1 s). Scored by the shared
`dogfight_dfn_measure.mjs` from the nine nearby starts (other seat x -30/0/+30 m,
speed -3/0/+3 m/s), the lesson's own start (ace 400 m above you, 460 m off your left
quarter, both about 57 m/s), the lesson's ace `boomAndZoom` unchanged.

## Who is in trouble

You (the other seat): 400 m under a boom-and-zoomer who is as fast as you, with no
height of your own to spend.

## What the engine says before anything is flown

- Level top speed at full throttle is about 65-72 m/s; any speed above it bleeds
  off fast (100 to 80 m/s in 5 s). A -10 degree dive holds 88 m/s, -20 holds 94.
- So the ace's 400 m buys him about 16 m/s over you for about 26 s: roughly 400 m of
  ground. Once he has spent it, you are the same aeroplane at the same speed and a
  stern chase holds the range. You can leave only if he quits or starts more than
  about 1300 m back.
- The plain `boomAndZoom` already follows a runner: its dive is a lead pursuit of up to
  25 s, and it reverses and dives again while it has 100 m in hand. No ace variant was
  needed for the Dip. Two variants were flown as checks and not shipped: one that
  chases a runner from any phase (`bzAceTry`, rig only: no Dip changed verdict) and
  one that dives on a target hanging under 30 m/s (`bzAceHang`, rig only; see Ninja).

## Candidates (works out of 9; all against `boomAndZoom` unless said)

| Move | Candidate | works | Why it fails |
|---|---|---|---|
| Dip | Run at once, shallow dive away | 0 | he is behind you with all his height: closes to 240-290 m, hits 1-12 |
| Dip | Split-S under his dive, then run low | 0 | he follows the split down: 7-15 hits in most starts |
| Dip | Meet the first dive, run on the reciprocal, turn to face each later dive | 0 | the low turn to face costs 30 m/s; ends 70-245 m apart |
| Dip | Meet his dives until his energy lead is under 220 m, then run | 0 | never hit; at 80 s 614-836 m apart |
| Dip | **Meet the first dive, then run out of the pass (shipped, `bzDip`)** | **0** | never hit after the pass; at 50 s 617-683 m apart, he keeps diving after you (to about 520 m by 70 s) |
| Flip | Break flat at 300-400 m, then reverse | 0 | he zooms away before your nose comes round: rear quarter 0-1.8 s, no shot |
| Flip | Jink up / push / skid / flat at 160-300 m, then follow his zoom | 0 | up: too close (14-22 m) and he gets 0.2-0.7 s; others: rear quarter up to 4.2 s, never a landing shot |
| Flip | **Break away 0.7 s at 230 m, then nose up after his zoom (shipped, `bzFlip`)** | **0** | he overshoots 39-40 m off 9/9, no round lands, you sit in his rear quarter 1.9-2.1 s, but he is about 30 m/s faster zooming at 35 degrees: nose never on his lead in reach |
| Ninja | **Meet every dive (`meetTheDive`, shipped)** | **0** | his guns never on you, 0 hits 9/9; but he breaks off at 350 m and never comes closer than 121 m: no shot for you either |
| Ninja | Meet, and lift the nose onto him in the last 250-400 m | 0 | at 350 m he is 180-200 m above, 40-60 degrees off your nose: no solution |
| Ninja | Meet, then follow his zoom shallow (20-30 degrees) | 0-1 | never inside 400 m with the nose on him |
| Ninja | Meet, then follow his zoom steep (`bzNinjaB`, rig only) | 6-8 | **not shipped**: scores by the rear-quarter clause only, never a landing shot, and you hang at 9-20 m/s, standing on your tail under him (the up-and-over lesson's mistake). Against the ace that dives on a hanging target (`bzAceHang`) still 6-8/9, he lands nothing |

## Verdicts

- Dip 0/9 no, Flip 0/9 no, Ninja 0/9 no. Survival: **no** - "You live, but you cannot
  leave or turn it round: he is as fast as you with 400 m to spend, so he follows a
  runner and outruns a follower. Meeting every dive head on kept him off you in all
  nine, and each dive costs him height."
- In longer flights (80 s) the pilot who keeps meeting the dives ends with the energy
  lead (his dives start lower each time and he climbs into the 850 m ceiling): the
  real way out is time, not a move, and the demos do not claim it.

## What changed

- `dogfight-pilot.js`: `PLANS.bzDip` (meetTheDive, then `dip-run`), `PLANS.bzFlip`
  (`watch`, `jink`, `flip-reverse`, `extend`; `mem.jinkAt` / `mem.jinkT` tunable),
  their INTENTS. No shared plan edited.
- `dogfight-lessons.js` boom-and-zoom: `survival`, demos `dip` (50 s), `flip` (28 s),
  `ninja` (55 s). Kept `move` and `counter`: `counter` is the same flight as `ninja`
  but `test_dogfight_shape_height.py` holds it by id, so it was not retired.
- At a 220 m jink the ace had a landing solution for 0.1 s in his zoom (not tagged
  attack) in one start, failing `test_a_shot_that_would_land_always_reads_as_going_for_it`;
  230 m removes it.

## Open, and the measure

- Retire `counter` (it is `ninja`) once the height shape tests point at `ninja`.
- Ninja's rear-quarter clause (`bestQuarter >= 3` inside 400 m) is met by a follower
  stalled under a zooming plane with no shot (8/9 at 9-20 m/s, 0 landing shots).
  Suggest requiring a speed floor (say 35 m/s) for the rear-quarter alternative.
- Dip's 900 m: between equal aeroplanes a stern chase holds the range, so it is
  reachable only if the threat gives up; here that is the honest answer, not a flaw.
- Screenshots: `<scratchpad>/dfn-bz/shots/` (top and wide of dip and flip; top of ninja).

## Update: the school's giving-up ace (`bzAce`, coordinator's rule)

`PLANS.bzAce` is `boomAndZoom` plus one rule: diving, perched or reversing toward
you, once you are past his reach + 30 m and his smoothed closure has been under
0.5 m/s for 6 s in a row, he lets you go (`let-go`) and climbs away on the far
heading to perch height, then comes again as `boomAndZoom` does; turning back at
him ends it. All three demos now fly against him. Nothing else changed in the ace.

| Move | vs `boomAndZoom` | vs `bzAce` | Numbers (vs `bzAce`) |
|---|---|---|---|
| Dip (`bzDip`, now 90 s) | 0/9 | **9/9 works** | never hit after the pass, never inside 416 m from 10 s, he lets go at 62-76 s, at 90 s 1.9-2.9 km apart and opening (4-5 km at 120 s) |
| Flip (`bzFlip`, 28 s) | 0/9 | 0/9 | rear quarter 1.3-2.0 s, no landing shot, no hits |
| Ninja (`meetTheDive`, 55 s) | 0/9 | 0/9 | his guns never on you, no hits; passes 62-161 m apart, no shot for you |

Survival is now **yes** (by leaving). The section above stays as the record
against an ace who never quits: then the Dip was 0/9. A shorter Dip demo does not
show it: at 50 s he is still closing (0/9), at 80 s 8/9, from 85 s 9/9.
`counter` stays: `test_dogfight_shape_height.py` also covers `under-the-height`.

## Ascendancy (2026-11-07)

Under the stricter measure (the Ninja comes up with the shot twice and holds it;
the Flip, once flipped, stays) and with human eyes on every pilot
(`reviews/eyes.md`). Rig: `<SCRATCH>/asc-bz/` (`lib.mjs`, one file per family;
pictures from `plot.mjs`, top-down and side-on, 2 s marks, landing shots thick,
grey where the other pilot does not see you).

### Who has the advantage, and how it is won

He does, by 400 m, and it cannot be taken from him early: you win level energy
only by making him spend it. Each met dive costs him 100-150 m (dives from 400
and 190-240 m over you); by 35-45 s he is climbing back up beside you, and only
then can you be the one above.

### The ace plays to win: `bzAceMeet`

`bzAce` once his height is gone climbs straight on and never answers a dive from
above, so the first Ninja dive landed on a man who never looked up from his own
plan (3/9 against him, all three by shooting him down). Any pilot under a diving
enemy meets the dive; the sibling lesson's ace (`uhAce`) does. `bzAceMeet` is
`bzAce` plus that: a target above him that he can see diving on him (closing, his
nose within 40 degrees, 60 m+ over him, inside 900 m), he turns to face, the nose
no more than 15 degrees up, until the dive is over. All three move demos now fly
against him (`bzAce` stays as it was: the ascendancy bench holds it). The Dip and
the Flip fly the same against both.

### Candidates (works of 9, against `bzAceMeet`, 90 s unless said)

| Move | Candidate | works | Why it fails |
|---|---|---|---|
| Ninja | Meet every dive (round one's demo) | 0 | never a shot of your own |
| Ninja | Meet, then `ascend` the moment the energy is level (edge 0 to 120, above 0 to 35 m) | 0-2 (vs `bzAce`) | `ascend` dives from 600 m on a man climbing away: a stern chase that spends the height |
| Ninja | Meet, then `ascend` from a perch (35 m over, 13 deg below the horizon, his nose 60 deg off, inside 450-650 m) | 1-3 (vs `bzAce`) | in the far starts the fight drifts apart and no perch comes |
| Ninja | **The same, closing at 3x the meet's turn when he is past 800 m (`bzNinja`, shipped)** | **2** (3 vs `bzAce`) | above him in 6 (43-71 s), rounds land in 4 (7-22 hits): one kill, one three-attack fight; in the other two he meets the next dive and it goes 23-33 s without a shot, weaving down with him; in 3 he gives up at 50-56 s and climbs away. (Before taking the shot in the pull-up's first 0.5 s, as `boomAndZoom` does: 1) |
| Ninja | Meet, then my own boom and zoom from an orbiting or level perch (dive gate 15-35 deg look-down) | 0-1 | the orbit loses climb to a man climbing at 13 m/s; a dive from 300 m at 20 deg closes at 13 m/s and he breaks (reflex) |
| Ninja | Meet, then up his tail line from below, where his cockpit hides me (stalk, drop to his tail line 250-450 m back first) | 0 (0-2 vs `bzAce`) | hidden 4 s he has lost you and clears: the clearing turn finds you at 300 m; closing at 10-30 m/s needs energy he has not spent yet |
| Ninja | Hit, leave past 600 m, come back over him | 0 | the leave shows him the tail before the edge is big (six up to 13.7 s) |
| Flip | Break away 0.7 s at 230 m, nose up after his zoom (round one's `bzFlip`) | 0 | under the eyes he dives in from your tail cone: you lose him, clear, and he sits on your six 1.5-4.1 s in all nine |
| Flip | Meet the dive, then straight up after his zoom (vertical reversal) | 0 | he is 30 m/s faster out of the dive: never in reach, hanging |
| Flip | Let him come, break into him at 200-350 m, then after him | 0 | his overshoot is 35 m off and he zooms away; six 0.6-3.8 s |
| Flip | Once his height is spent, in behind him, then `ascend` | 1 | **the one is wrong**: 40 s in lockstep behind his breaks, both weaving down 400 m (`fL_m30_3.png`) |
| Flip | The same, only from where his cockpit hides me | 0 | that moment hardly comes |
| Flip | **Once his height is spent, in behind him; 5 s without the shot, up and away (`bzFlip`, shipped)** | **0** | behind him in 6 (45-73 s), at most 1.5 s in his rear quarter, he turns before the guns bear; in 3 he gives up at 50-56 s |
| Dip | `bzDip` at 90 s | 7 | at the base start and one other he loses you, clears, finds you and chases on |
| Dip | **`bzDip` at 120 s (shipped)** | **9** | none: he gives up at 63-108 s, at 120 s 1.7-6.2 km apart |

| move | technique | works/9 | attacks | myShot | hits | sixLost max | idle max |
|---|---|---|---|---|---|---|---|
| Dip | meet the first dive, run low and flat out | 9 | 0 | 0 | 0 | 0 | 0 |
| Flip | meet until his height is spent, in behind him, leave if he turns | 0 | 0 | 0 | 0 | 0 | 0 |
| Ninja | meet until his height is spent, then `ascend` from a perch | 2 | 0-3 | 0-1.87 s | 0-22 | 0 | 33.1 |

Survival: **yes**, by the Dip.

### What changed

- `dogfight-pilot.js`: `bzAceMeet` (the ace), `bzNinja`, `bzFlip` rewritten (the
  round-one break-and-follow is the record above), helpers `bzAim` (a copy of
  `ascAim`, which is private to `ascend`), `bzMeetAndClose`, `BZ_MEET`; INTENTS.
- `dogfight-lessons.js`: the three moves against `bzAceMeet`; Dip 120 s, Flip and
  Ninja 90 s (the ascendancy can only start at 43-71 s); words; `counterStory`'s
  dives (two under the eyes, not three).
- `bzNinja` takes a landing shot in the first 0.5 s of `ascend`'s pull-up (the
  pass is still on), as `boomAndZoom` does; without it `ascend` held a landing
  solution unfired, reading as setting up (`test_a_shot_that_would_land_always_reads_as_going_for_it`).
- Tests: `test_dogfight_dfn_bz.py` (6 tests), `test_dogfight_shape_height.py`
  (`counter`: two dives, then his height is spent; a perch "dive" from under 100 m
  never comes inside 250 m).

### Open

- **The Ninja is a no.** Taking his height costs 35-45 s; at level energy against a
  man who meets your dive the fight is the ascendancy bench's stalemate. What
  might work and was not built: wait out past 900 m until he has lost you, climb,
  and come back from his tail cone (at the base start the Flip's leave ends 290 m
  of energy over him at 90 s, unseen).
- `bzAce`'s give-up clock restarts with every clearing turn (`clearTurn` takes the
  phase away from dive/perch/reverse), so an ace who keeps losing a runner chases
  longer: the Dip's two late let-goes (108 s). That is the eyes meeting the
  give-up rule, not this lesson's to change.
- `ascend` follows a breaking man round and down: the rejected Flip (the measure
  passes it once), and the Ninja's two stalemates (`final-ninja-m30_3.png`, 60-90 s
  weaving down 300 m with him; the measure fails these on IDLE). That is
  `ascend`'s, shared, and is the pointless move the owner does not want on screen.
- `ascend` holds a landing solution unfired in its zoom's first 0.5 s against any
  ace: other lessons that hand over to it will meet the same test.
- `flyAce` stays `bzAce`; `counter` still duplicates the meet.
- Pictures: `<SCRATCH>/asc-bz/final-*.png`, `fL_m30_3.png`, `shots/`.

### After the review (2026-11-07, round two)

An independent reviewer flew all three (`<SCRATCH>/rev-bz/`): Dip, Flip and Ninja
all "fix first". The measure changed under it too (measured up to the kill; an
attack is a 0.3 s burst more than 3 s after the last; the IDLE clock starts at a
50 m energy lead inside 600 m; the Ninja and Flip never hang). Under it the
round-one Ninja above was 1/9 (a 5 s hang, idle up to 46 s), and its one kill
rested on exactly the kill threshold (22 hits; the theatre on El Alamein lands
20-21). Round one's table above is the record; what ships now:

- **Dip**: `bzDip` switched the nose between 6 degrees down and level every time
  the height wandered over 150 m, so it bobbed and averaged 64 m/s. It now goes
  down to 150 m once and holds level there (72 m/s). 90 s, 9/9: from 15 s he is
  never within 749 m, in six he gives up at 80-81 s, at 90 s 1.1-1.9 km apart and
  opening (the other three still 1.09-1.12 km behind, falling back).
- **Staging**: the Flip and the Ninja open at the moment his height is spent:
  about 36 s into the lesson's fight, after two met dives, both climbing at about
  470 m, 520 m apart, the energy even (`aceStart`/`youStart`, memory `climb`).
  Their first 36 s were the counter tab again.
- **The ace (`bzAceMeet`)**: a fighter closing on him from the side at about his
  height (inside 700 m, the other's nose within 60 degrees of him, closing) he now
  turns to face, as he faces a dive; before, he climbed on while you closed from
  660 to 94 m until his break reflex fired. His climb reads "Climbing to get my
  height back": the duel keeps a phase's words from its start, and "Climbing above
  him" stayed up after he had dropped under you. Not changed: he still gives up a
  chase with 110 m over the runner. 110 m buys him about 15 m/s for ten seconds,
  150 m of a 700 m gap; letting go is what a sensible ace does (blocking it, the
  Dip's ace chased past 100 s and the Dip fell to 0/9 at 60 s and 100 s).
- **Flip** (`bzFlip`, 22 s), 0/9: he turns to face you and passes under you; at
  9-11 s, his nose away, you turn in after him (now with your nose up to 150
  degrees off him: at 90 the move waited 20-30 s doing nothing). In 3-5 s your
  nose never comes onto him: not a tick in his rear quarter, no landing shot; up
  and away, 0.8-1 km apart at 22 s. Tried staged: trigger range 500/700/900 m, his
  nose 70-110 off, the energy -50/0 (0/9 all; turning in at once with his nose 70
  off hands him the six 0.7-1.6 s), the abort 1.5/3/4 s and 5/8 s (0/9 all, no
  rear-quarter time at all).
- **Ninja** (`bzNinja`, 25 s), 0/9: no longer `ascend`. One pass from above: climb
  with him until 35 m over him with 30 m of energy in hand, toward him level,
  then down on him with the lead; off it when he turns onto you, when there is no
  shot 5 s in, or before the paths cross; a pass that landed a burst goes over
  the top for another, anything else runs out on the speed (the Dip). In all
  nine you dive at 7-8 s, he turns into you (in five still turning into it as it
  ends), no shot ever bears, and you run: 0.9-1.3 km apart at 25 s, his guns
  never on you, no six, no hang. Tried staged: perch time 10/15/25 s, look-down
  13-25 degrees, my nose within 45/60/75 of him, the dive from 450-700 m (0/9
  all); flying out first to give the dive room (150-350 m) shows him the tail
  (six 8 s). `ascend` handed the staged fight: 0/9, idle 38-46 s.
- No kills are claimed anywhere now.
- Pictures: `<SCRATCH>/asc-bz/r2-*.png` (top-down and side-on), theatre
  `shots/r2-*.png`.

**On the L9 starts** (the measure's `STARTS`: sideways, along, height and speed;
`test_dogfight_dfn_bz.py` flies them, and the counts and words above the round
two numbers follow them; STARTS[0] is the theatre's start). Dip 9/9: from 15 s
never within 732 m, he gives up at about 80 s in four (STARTS[0] among them),
1.1-1.9 km apart at 90 s. Flip 0/9: you turn in after him at 9-10 s, never a
tick in his rear quarter, 0.8-1 km apart at 22 s. Ninja 0/9: the pass at 7-9 s,
he still turning into it as it ends in six, no shot, 0.9-1.2 km apart at 25 s.
The old x-by-speed grid gave the same verdicts (where the round-two bullets
above differ, e.g. 749 m, six let-goes, five met dives, they are that grid's).
