# The break turn, and the first two "On his tail" demos (fixer: break)

Plans: `breakTurn`, `patientAttacker`, `arriveSlow` (rewritten), `chaser`,
`cruiser` (unchanged). Lesson `break-turn` (starts, story, counter story,
notes, coach) and the `move` / `counter` demo entries of `on-his-tail`.
Shape tests: `tools/bf1942-models/tests/test_dogfight_shape_break.py` with
`dogfight_shape_break.mjs` (run after the head of the school harness).

## The tactic

Real break (Shaw; RAF "Break!"): with an attacker closing fast on your six,
wait until he is committed just outside gun range, then turn as hard as the
aeroplane turns toward him. His angle-off grows, his sight cannot track, his
closure carries him past (an overshoot), you reverse into him as he crosses.
The attacker's counter is the high yo-yo: as the defender breaks, lift out of
his turn instead of following him into it, trade the excess speed for height
and stay behind/above instead of overshooting.

## What BF1942's flight law does to it

Measured on the Spitfire (a hard bank-and-pull, peak turn rate):

| speed m/s | turn deg/s | radius m |
|---|---|---|
| 45 | 47 | 55 |
| 55 | 52 | 61 |
| 70 | 62 | 65 |
| 85 | 72 | 68 |
| 100 | 79 | 72 |
| 130 | 98 | 76 |

The pull grows with the speed and there is no corner speed: a faster
Spitfire turns faster, not wider. The textbook payoff (the fast attacker
cannot hold the turn, flies out in front, you reverse onto his tail) does
not exist here. I tried to make it: reversing early (at the 3-9 line), a
green attacker who flies through or loses sight in the overshoot, more lead,
a capped pull, a chop after the overshoot. Every one either gave the attacker
the shot (up to 17 hits), rammed (2-10 m), or needed an invented blind spot.
So the words now say what is flown.

A hard-turning Spitfire's circle is 110-120 m across and goes round in about
9 s. Anyone 250 m behind him when he breaks cannot stay behind him in it: he
is round and facing you in about 5 s. That decides the counters too.

## What the reconstruction does now (9 starts each)

`break-turn` attacker starts on the right rear quarter ([240, 320, 0],
heading -25, 72 m/s; it was dead astern 30 m to one side).

- **move** (chaser 0.55): he breaks at 298 m, closure 23-25 m/s, the attacker's
  nose 0-3 deg off him and 42-59 m to his right; first bank 99 deg right (into
  him) 9/9. The attacker comes past his tail 33-36 m behind him at 13.7-15.4 s
  (minimum range 26-28 m); the bank reverses within 1.8-1.9 s 9/9. Then the
  attacker is back behind him, 49-50 m median, his nose behind (no lead)
  100% of the time, no landing shot, until the end. Hits on the defender:
  6 in 9 fights, every one from rounds fired in the first two seconds of the
  break. Before: break 299-301 m but dead astern (side a coin flip), the
  overshoot 34-40 m, then no reversal (one right turn for 33 s), "reverse"
  entered by the 9 s timer, labelled attack.
- **counter** (patientAttacker 0.85): the yo-yo starts 0.8 s after the break
  at 275-277 m (before: 5.6-5.9 s, at 34-37 m), climbs to 70-72 m above him
  and stays above him (>30 m) 100% of the time from 3 s on, never closer
  than 83-85 m (before: 3-11 m near-collisions), never under 40 m/s. The
  defender only ever breaks (no reversal, no shot); the attacker's 1-6 hits
  all land in the first second of the break. Before: sat beside/in front, the
  ace out-hit him in 3/9.
- **without** (cruiser vs chaser): unchanged outcome from the new start, shot
  down 9/9.

`on-his-tail` (lesson start unchanged, dead astern 500 m):

- **move** (rush in, chaser 0.9 vs breakTurn): he breaks at 298 m with you
  24-25 m/s faster; you come past his tail 34-36 m behind him (minimum
  27-28 m), he reverses 2.0 s later, then you sit 47 m behind him in his
  turn, nose behind him, for the rest of the minute: 1-5 hits a fight (2.7
  average), all as he breaks, none after; nobody shot down.
- **counter** (arrive slow, arriveSlow 0.9 vs breakTurn): you are 3.4 m/s
  faster than him at 298 m and he still breaks (before: breakTurn's
  `closure > 4` gate meant he never broke and was shot from 260-280 m dead
  astern while "watching"). You go up over his turn (climb capped at 25 deg,
  speed held), never closer than 56-57 m (you pass over his tail, well above him, and he
  reverses), never in front of his nose; nobody lands a hit.

## What changed

- `breakTurn`: breaks on range (gun reach + 30 m) and the rear cone (attacker
  more than 130 deg off his nose, nose within 45 deg of him), no closure gate.
  `break` -> `reverse` only when the attacker crosses to his other side inside
  150 m, behind his wingline, 6 m across (8 m until the 2026-11-12 retail-g retune); `reverse` -> `turn` when the attacker
  is back behind him nose-on; `chase` (attack) only when the attacker is out
  in front of his nose, inside 400 m and less than 40 m above. No timers.
  INTENTS: reverse and turn are `defend`.
- `patientAttacker`: `close` -> `yoyo` the moment the defender's wings go past
  45 deg (or inside 80 m closing); the yo-yo follows the defender's own path
  (`trackHisPath`, three seconds of it) 70 m above, at his speed
  (`overHisTurn`); `back` (dive on him) when he stops turning. INTENTS
  close/yoyo/back = attack/setup/attack.
- `arriveSlow`: `close` (lead pursuit, closure held to sit 250 m back) ->
  `above` (the same yo-yo, climb capped at 25 deg) when he breaks -> `shoot`
  when his wings come level with the nose on him. INTENTS close/above/shoot.
- `chaser`, `cruiser`: unchanged (the Immelmann lesson and out-of-the-lock
  use them).
- `break-turn` story, counter story, demo notes, coach (`reverse` reworded,
  new `turn`).
- `on-his-tail` move/counter notes. Two tests in `test_dogfight_school.py`
  that held the old kill claims are replaced:
  `test_against_a_hard_break_neither_rushing_in_nor_arriving_slow_has_a_shot`,
  `test_on_his_tail_a_hard_break_is_nobodys_kill_rushing_in_or_arriving_slow`.

## Thresholds relaxed, and why

- Reversal within 2.5 s of the overshoot, not 2: the plan waits until the
  attacker is 6 m across (a wobble must not flip the turn; 8 m until 2026-11-12, when on retail g one reversal took 2.8 s) and rolling from a
  full turn one way to 45 deg the other takes the Spitfire about 1.8 s.
- "Payoff: you offensive >= 2 s or a landing shot" dropped: no corner speed
  (table above). Replaced by: after the overshoot he is back behind you
  (>= 70%), median under 80 m, his nose behind you (>= 80%), no shot.
- Counter "behind you, < 300 m, within 100 m to the side >= 80%" replaced by
  "above you by > 30 m >= 80% from 3 s on, never inside 60 m, no reversal, no
  hit after the break": the defender's circle is 120 m across; anyone off it
  sits beside it half the time, and staying off it is the yo-yo's point.
- Hits: none from rounds fired more than 2 s after the break (the review said
  "no landing shot after the break"; the first two seconds, while the wings
  roll over, the attacker can still get a burst in).

## Open

- `on-his-tail` story and counter story (owned by `tail`) still say "the
  chase turns into a head-on pass, the 50/50" and "arriving slow brought him
  down eight times" / "lag his turn ... 250 m back". Measured now: rushing in,
  you come past his tail 35 m behind him and end up 47 m behind him in his
  turn with no lead, about 3 hits a fight, all as he breaks; arriving slow, he
  still breaks at 300 m, you go up over his turn, nobody hits anybody. From
  250-300 m back nobody can stay in a 120 m circle.
- The free-fight ace bench uses `patientAttacker`: the bench total moved
  (69 hits by the ace, test wants > 80); not chased.
- The top camera frames the whole fight, so the overshoot (a 35 m crossing
  inside a 1.5 km picture) is small from above; the wide camera shows it.

## Retail g and box area (2026-11-12)

On the law's retail gravity and box-drag area
(features/retail-parity-cross-check-2026-11-12) one rusher (dx -30, dv +3)
sat near the defender's tail line for 1.5 s past the crossing before he was
8 m across: the reversal took 2.8 s and he landed a round 3.2 s after the
overshoot. `breakTurn` now reverses at 6 m across: every reversal is 1.6 to
2.0 s after the overshoot (bound 2.5), no hit lands after the break's first
two seconds, and On his tail's rush-in is unchanged (about 5 hits a fight,
all inside the first 3 s of the break).
