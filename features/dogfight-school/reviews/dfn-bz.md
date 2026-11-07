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
