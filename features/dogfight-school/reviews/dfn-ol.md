# Out of his lock: the Dip, the Flip and the Ninja (investigator: ol)

**Who is in trouble:** you. The hunter is on your tail, closing to 150 m
before he fires, and you want out, the upper hand, or both.

Every number below is from the nine nearby starts (your start x -30/0/+30 m,
speed -3/0/+3 m/s), scored by `tests/dogfight_dfn_measure.mjs`. Prototypes are
in `scratchpad/dfn-ol/` (`plans.mjs`, `s*.mjs`).

## The ace made honest: `olHunter`

The lesson's `hunter` runs after he flies past (`extend`): committed (no
reflex), 6 s, whatever you do, and the run can start again from his turn
(`lag` -> `extend` re-entry), so in the counter demo he flies 12 s straight
in front of your guns. That is too generous: he is the faster aeroplane and
the chopper is at 26 m/s. `olHunter` is the hunter with the run made what a
sensible ace flies:

- one run per fly-past (no re-entry until 200 m apart);
- the run lasts only while your nose is on him (inside 45 degrees); once it
  is off him he turns back to hunt, since he can catch you;
- the reflex is live in the run: your sight on him inside gun range and he
  breaks into you.

Everything else is the hunter's code unchanged (`levelHardTurn`, the
3 s height follow, fire held to 150 m). The three new demos fly against it.
The `counter` demo still flies the plain hunter; its note now says so.

## The school's give-up rule (added 2026-11-07, coordinator)

`olHunter` now gives up a chase he cannot win, like every ace: past his
guns' reach + 30 m and not closing for 6 s in a row he goes `let-go` (climbs
away on his reverse heading), and comes back only to face you (`meet`) if you
turn at him, or breaks (the reflex) if you get on his tail. Before/after:
Dip 0 -> 5 (demo now 62 s: he gives up at 46-54 s in 5 runs; in the other 4
he holds 230-275 m, inside reach, and never lets go), Flip 1 -> 1, Ninja
0 -> 0. Survival `no` -> `partly`. The table below is from before the rule.

## The moves (works/9 by the shared measure)

| Move | Technique (demo) | works/9 | Key numbers | Candidates tried |
|---|---|---|---|---|
| Dip | turn into him at 400 m, pass over him head-on, run on the pass heading, full throttle, nose 3 down (`olDip`) | 0 | he turns round and follows: 218-305 m behind at 40 s, his nose on you (landing solution 0.3-10 s of the run), hits you in 1/9 (6 hits); you 72-74 m/s | same, nose 8 down / directly away / 15 down: 0/9, he catches you once the dive ends (hits up to 70); chop then run away: 0/9 (he reverses; 140-470 m, the fly-past 11-15 m); against the plain hunter the chop-then-run gets 790-960 m (his 6 s run opens it) but 1/9 on the 15 m rule; run as soon as seen (480 m or 900 m back, dives 5/12/25): 0/9, he closes 4-8 m/s |
| Flip | turn hard; inside 90 m and closing chop the throttle in a level hard turn; inside 60 m pull up 30 degrees through the turn; then nose on him (`olFlip`) | 0 | he flies past 14-18 m under you 9/9, never hits you; you land 0-8 (21 in all); your landing shot 0-0.5 s; 2 s in his rear quarter in 6/9, but never with the 0.5 s shot | `lockChop` as is: 0/9 (fly-past 5-14 m: fails the 15 m rule; shot 0-1.8 s); 84 chop variants (chop range 70-200 m, climb 16-28, bank 45-65, pull-up 20-50 degrees, two-stage pull at 30-70 m, chase level/pure/lead/mixed, aim gains): best 1/9; a wide pass (> 15 m) and the 0.5 s shot never come together; defensive spiral (sink 6-12 m/s, out-turns his height-holding turn by 10-15 deg/s): 0/9, he never comes out in front |
| Ninja | seen 800 m back, turn into him at once, meet him nose on, level; start the hard turn 200 m before the pass the way he goes; meet him again whenever he comes round (`olNinja`) | 0 | his landing shot 0 in all nine, nobody hit, closest 16-29 m; your landing shot 0, in his rear quarter at most 0.43 s | `meetHim` from 480 m: 0/9 (nobody shoots, closest 11-14 m from 900 m); climbing meet (climb 6-10 m/s, nose 10-15 above him): 0/9, his head-on shot 0.9-1.4 s; shooting the head-on pass (pass at 130/90/60 m): 0/9, nobody gets a solution; lead turn at 250/300 m: 0/9 |

## Survival verdict

`no`: "You live through it, but you do not get out of it: turning hard he
lands nothing, and turning into him early he never gets a shot, but in nine
starts no way out, no reversal and no takeover worked against a hunter who
turns back."

Why, on this flight law: equal Spitfires at full throttle hold the same
speed, so a run only keeps the gap you start it with (the head-on pass gives
200-300 m, inside his reach); a faster Spitfire turns faster, not wider, so
nothing flat makes him overshoot; the chop's overshoot is real but leaves you
at 26 m/s, and an ace who turns back takes the fight back.

## Changes

- `dogfight-pilot.js`: new `PLANS.olHunter`, `olDip`, `olFlip`, `olNinja`
  and their INTENTS rows.
- `dogfight-lessons.js` (`out-of-the-lock`): `survival`; demos `dip`, `flip`,
  `ninja`; `move` (dive) and `meet` (early turn) retired (the Dip starts with
  the early turn, the Ninja is it from far out); `counter` kept (the
  school harness's show-me freezes fly its seat) with a note that its hunter
  runs; tagline and a closing counterStory paragraph with the numbers.
- Tests: new `tests/test_dogfight_dfn_ol.py` + `dogfight_dfn_ol.mjs`
  (verdicts equal the measure, survival follows, the shapes quoted);
  `test_dogfight_school.py` out-of-the-lock test no longer reads `move`;
  `dogfight_shape_tail.mjs` flies the retired `move` and `meet` from inline
  definitions so the story's dive and early-turn numbers stay held.

## Open

- **Measure rounding:** a landing shot of exactly 15 ticks sums to
  0.49999999999999994 s and fails `>= 0.5` (flip, start +30 m / 0: 15
  ticks, quarter 2.3 s, closest 17 m, his shot 0). With an epsilon the Flip
  is 1/9, still `no`.
- The 15 m rule is right here (a 12 m pass between 11 m wingspans is a
  collision in the real game), and it is what sinks the plain chop.
- The `counter` demo (plain hunter, 12 s run) and the Flip (honest hunter)
  now disagree about how good the chop is; once the show-me freeze in
  `dogfight_school_harness.mjs` reads `flip` instead of `counter`, `counter`
  can go.
- Screenshots: `scratchpad/dfn-ol/shots/{top,wide}-out-of-the-lock-{dip,flip,ninja}-*.png`.

## Ascendancy (2026-11-07)

Under the human eyes (reviews/eyes.md) and the stricter measure (attacks are
bursts, IDLE, the hang rule, measured to the kill). Every count is from the
nine nearby starts; prototypes in `scratchpad/asc-ol/` (`n*.mjs` Ninja,
`h*`/`u*` under-and-up, `c*`/`w*` the chop and the restage, `d1.mjs` the Dip).

**Who has the advantage, and how it is won:** nobody wins it for long. He
comes from behind with 50 m more energy, and a hunter who always points his
nose at you can only be hit when he cannot point it: from under him, up behind
him as he turns back after you, you come down on him once, and that is all.

### The eyes broke the staging

The hunter started dead astern, inside the 20 degree cone behind your
headrest: you lost him at 4 s and made a clearing turn, so every counter
started at the wrong range. Restaged: he starts in your right rear quarter
(`[180, 375, 240]`, heading -35), and the watching pilots (`olHardTurn`,
`olChop`, `olDiveOut`, `olMeetHim`, wrapping the old plans with `olLooking`)
hold a 20 degree banked turn toward him until he is committed, keeping him
over the shoulder. The tail shape test flies the retired early turn from
`[160, 380, 460]` for the same reason.

What the base demos fly now: flying straight, shot down 9/9 at 12-19 s;
diving, shot down 7/9 (20 and 4 hits in the others); turning hard, no hit
either way, never closer than 52 m; the early turn, a head-on pass at 14-19 m,
his lock gone within 3 s, no hits.

**The chop no longer works.** In 8/9 it comes 4 s into the turn at 53-56 m,
but he never flies past (0/9 overshoots, 0 runs, 1 hit on you in all, none on
him): he slides under your tail and stays in your rear half for the 20 s after.
You see him only 56-78% of the fight. Searched before saying so: 7 starts
(dead astern, rear quarter at 24-37 degrees, high astern at 23-27 degrees,
closer and faster), look-turn banks 0/8/12/16/20/25/30, rudder kicks to
clear the cone (4 timings), the chop gated on his nose (25/30 degrees), on
range (60/70/90 m), on time in the turn (1/2/4 s), the chop climb (-4/0/8/16)
and bank (55/65/70/80). Best: 1 fly-past in 9. Before the eyes the hunter
reached the chop at 62-69 m/s dead astern and slid through; any staging that
lets you see him brings him in slower and off your tail line.

### The Dip: under him, then away (works, 9/9)

Seen 900 m back, turn into him at once, fly at a point 50 m under him and
60 m to his side; past him (inside 150 m), run on that heading at full
throttle, nose 2 down (`olDip`). He turns all the way round after you: 130 to
370 m back, never a landing shot, no hits; he gives up (`let-go`) at 28-30 s;
at 40 s you are 1278-1471 m clear and opening. He sits on your tail (the
measure's six) 17-18 s while he follows, out of his guns' reach.

| Dip candidate | works/9 | why |
|---|---|---|
| **under him, 50 m, 60 m aside, run nose 2 down (shipped)** | **9** | |
| under him 30-50 m, run nose 4 down | 9 | same; 2 down is gentler |
| over him 30 m, run nose 2 down, 60 s | 7 | he closes in 2, 7 hits in one |
| the old early turn from 460 m, pass under/over, run | 0-5 | he is already close: 230-250 m on your tail, hits in 6/9 |
| run straight from 900 m, level / 3 / 6 down | 0 | he closes 1-2.5 m/s and never lets go |

### The Flip: under him, then up behind him (no, 0/9)

The Dip's way in with the line held 80 m under him from 250 m; once he is
past overhead, pull up toward him (half a loop) and, above him with his nose
away, hand to `PLANS.ascend` (`olUnderUp`; the guns stay on for the first
0.5 s of the zoom, while the burst still lands). After the move he never has
a shot, never hits you, never sits on your six; the pass from above lands
17-22 hits every time and shoots him down in 5 of 9. It fails on two counts:
the pass brushes him, inside 15 m in 7 of 9 (4-17 m), and you are never in his
rear quarter with your nose on him for 2 s (best 0.23 s): it is a diving pass,
not a seat on his tail. Hang 2.3-2.5 s (under 3).

| Flip candidate | works/9 | why |
|---|---|---|
| chop and pull up (old `olFlip`), 3 starts x look banks 0/15/20 | 0 | no fly-past at all under the eyes |
| climb across his path, down on him when he hangs (7 variants) | 0 | he hangs at 27-30 m/s 50-70 m under you, but turning down onto him meets his nose; 0-1 attacks, 4 hits on you in one |
| under him, own dive and break-off (`under2`, best: break at 90 m) | 3 | rejected: hangs at 17-29 m/s at the top, two head-on passes, the fight walks down to 100 m |
| under him, own attack with beam defence (`under4`, 6 variants) | 0-1 | 0-6 hits, he gets round onto your six 3-7 s |
| under him + `ascend`, separation wrappers (8 variants) | 0 | fewer hits, still inside 15 m |
| **under him + `ascend` (shipped)** | **0** | the brush and the quarter |

### The Ninja: under him, down on him once, then away (no, 0/9)

The Flip from the start, and once the burst is over (0.5 s quiet, range
opening, his nose more than 90 off) straight out as the Dip runs (`olNinja`,
50 s). One attack in all nine, 17-22 hits, he goes down in 5; never a hit on
you. It fails because he has his guns on you for 0.43-0.5 s as you meet head-on
(all nine), the pass is inside 15 m in 7, and in the 4 he survives there is
only one attack; he chases you out (on your six up to 7.8 s) and gives up at
31-36 s. Staying on instead of leaving (the Flip's `ascend` to 50 s) brought
no second burst: 23-30 s of circling with nobody shooting in 6 of 9 (before the
zoom fire; the kills then were 3).

| Ninja candidate | works/9 | why |
|---|---|---|
| `ascend` from the start | 0 | 0-1 attacks, six 5.4 s, idle 29 s |
| climb across his path, then `ascend` on a perch (6 offsets) | 0 | no perch with his nose away ever comes; circling |
| climb across his path, roll in when he hangs (9 variants) | 0 | the energy lead is real (+100 m at 17 s), the roll-in meets his nose: 0-1 attacks, collisions |
| climbing yo-yo over his circle (6 variants) | 0 | no shot; lockstep circling |
| head-on meet with offsets, then zoom and `ascend` (12) | 0 | his head-on shot 1-3 s |
| let him close, zoom at 150-350 m (12) | 0 | he shoots you up to 83 hits |
| pass under, run until he gives up, come back | 0 | on your six 17-23 s; let-go at 26-37 s, too late to come back in 50 s |
| under him + `ascend`, 50 s, no leave | 0 | his head-on shot, the brush, 23-30 s circling |
| under him, meet offsets 30-60 m aside, 100-150 m under, hold 150-400 m (8) | 0 | his head-on shot stays 0.2-0.9 s, or no pass at all |
| **under him, one pass, then away (shipped)** | **0** | his head-on shot, the brush, one attack |

### The ace

`olHunter` unchanged. Two gaps a sensible ace would close, left open because
no move profits from them: in `track` he pulls lead up after a climbing target
until he hangs at 27-30 m/s (the climb-across candidates win 100 m of energy
off it and still cannot convert), and in `lag` his nose never comes more than
10 degrees up. If a later move exploits either, give him an `ol` variant.

### Survival

`yes` (the Dip works): "Yes: seen far back, turn into him, go 50 m under him
and run on, and he follows out of his guns' reach and gives the chase up 28 to
30 s in, in all nine. Getting on top of him is another matter: ..."

### Open

- The chop, the lesson's old counter, is now a demo of a counter that fails;
  the lesson keeps it with words that say so. A chop that works under the eyes
  was not found.
- The 15 m rule fails a diving pass from `ascend`'s pull-off (4-6 m); a
  break-off that keeps 15 m loses most of the hits.
- His half second of head-on shot as you meet is what stops the Ninja: with
  it under 0.2 s, the 2 fights where the pass stays 15 m clear and kills him
  would pass. Nothing measured denies it and still makes the pass.
- Pictures: `scratchpad/asc-ol/final-{dip,flip,ninja}-{0-0,30-3}.png`
  (top-down and side-on, 2 s marks, landing shots thick); theatre:
  `scratchpad/asc-ol/shots/top-out-of-the-lock-{ninja,dip}.png`.

### The review, and the L9 starts (2026-11-07, later)

An independent reviewer flew the lesson (`scratchpad/rev-ol/`). What it found
and what changed, every number now from the nine L9 starts (`STARTS`:
sideways, along, height, speed; STARTS[0] is the theatre's):

- **The ace played to lose.** Every burst of the Flip and the Ninja landed on
  him at 16-17 m/s, his nose 50-76 degrees up: `olHunter` chased me up into a
  hang, the weakness this section said no move used. New ace `olAce`
  (`olHunter` plus the reviewer's rule: below 48 m/s with you more than 15
  degrees above, his nose stays within 5 degrees of level and he turns to
  face you). The Dip, Flip, Ninja and FLY IT fly against it; `olHunter` stays
  as it was for the ascendancy bench. Now he is at 35-44 m/s, nose level,
  when the burst lands.
- **Counts against `olAce` on L9:** Dip 9/9; Flip 1/9 (10-22 hits, down in
  3, the closest pass 20-25 m, never inside 15 m any more; the one that works
  is a kill with 2 s on his tail); Ninja 0/9.
- **Captions.** A pilot with him in the sight now says so whatever
  `ascend`'s phase ("Guns: he is in my sight"); `olAce` says "Too slow to
  pull up at him: nose level, turning to face him" when the rule acts. The
  words no longer say "from above and behind": the burst comes across his
  beam, 87-119 degrees off his tail (43-70 in one start).
- **The hang over the top** (28-30 m/s, 2.2-2.7 s, about 190 m from him) is
  still there; tipping over earlier (handing to `ascend`'s wingover at 50, 55
  or 60 m/s) keeps the speed and loses the pass: 0-25 hits, one kill in 9,
  and at 50-52 m/s the wingover itself hangs 3.5-7 s. Kept, and said in the
  note.
- **The Ninja ran from a man 2-5 hits from dead, handing him the six.** It
  now zooms away from his nose toward a perch out of his reach
  (`ninja-perch`, 450 m, 120 m over him) and holds it; 30 s. It never gets
  there: his nose follows you, at 30 s he is 290-330 m behind and 40-60 m
  under you, on your tail 4.9-6.3 s of the climb. The line says so. STARTS[0]
  is a start where he lives.
- **The head-on half second** is at 270-350 m, where he holds his fire (he
  fires only inside 150 m); said so.
- **The Dip's "never had his guns on you" was false:** in 5 of 9 he had a
  landing head-on shot at 7.3-8 s, 270-350 m out, and in 6 of 9 again 180-260
  m behind you at 18-22 s; he held his fire every time. The pass billed as
  50 m under him comes within 24-26 m. Both now in the words.
- **The chop's cause** reworded: it needs a fast closer from dead astern, who
  cannot slow and flies through; dead astern is where the headrest hides him,
  and the man kept in sight over your shoulder arrives 53-56 m back, about 45
  degrees off your tail and only about 7 m/s faster.

Tests: `dogfight_dfn_ol.mjs` runs the L9 starts; `test_dogfight_dfn_ol.py`
holds the numbers above; `test_dogfight_fly_moves.py` names `olAce` as this
lesson's FLY IT ace.
