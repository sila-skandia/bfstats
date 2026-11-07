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
