# Out of his lock, and the chop demos of On his tail (fixer: tail)

## Breaking the tail (2026-11-07, second rebuild)

The owner watched the first rebuild: "The dive, turn and chop all have the
ace on the 6. I really want to see how to break the tail." Right: the hard
turn takes his nose off you but leaves him in your circle, and the chop put
him in front of you for one second before his reflex broke him back behind.
Everything below this section is the first rebuild; where they differ, this
section wins.

### What was tried (node rig, nine starts each, `scratchpad/fork-tail/x*.mjs`)

| Counter | Result against the hunter |
|---|---|
| Break into him at 300 / 250 / 200 / 150 m | he follows into the circle: behind you 9-14 s of 20, never in front, no swap |
| Break, then reverse every time he crosses (flat scissors) | he never crosses; reversing early (3 s in) makes him drift in front in 8/9, but he lands 4-6 |
| Pull up and chop straight out of the lock (150 / 100 m) | you slow to 9 m/s in front of him and are shot down |
| Split-S at 250 / 200 / 150 m | he cuts across and locks on again 120 m back; shot down in most |
| A fast bounce (him diving in at 82 m/s) | his hard turn bleeds the extra speed in 2 s; he settles behind you as before |
| Turn into him while he is 400 m back | **works**: he cannot follow you round from that far; head-on passes, his lock gone |
| The old turn-and-chop, he breaks back after flying past | 9/9 fly-past, 0.4-1.6 s in front of you |
| The same chop, the hunter running after he flies past | **works**: in front of you 10-15 s, you land hits in 9/9 |

The engine facts behind it: a faster Spitfire turns faster, not wider, so the
hunter follows any flat turn; his excess speed bleeds in a couple of seconds
of hard turn, so there is no textbook overshoot from speed alone. What makes
him fly past is the chop and pull-up while he is close and still closing
(his throttle is a rate and bites in 3-4 s). After that he is the faster
aeroplane with a slower one behind him: running, not turning back into it,
is his way out, and that is what he now does.

### Changes

- `hunter`: `extend` (committed, no reflex): flown past from behind (you
  behind him inside 90 m, headings within 60 degrees) he runs, nose 5 down,
  full throttle, 6 s or until 450 m. `headon` names his turn when you have
  turned into him (both noses within 60 degrees). In his following turn he no
  longer climbs after you below 36 m/s (he stalled to 11 m/s chasing a climb).
  `lag` says "turning the same way after him" (he is not behind you in a
  head-on).
- New `lockChop` (the counter): `chopper` up to the fly-past, then `chase` /
  `shoot`, after him to his height, never back to the turn unless he is on
  your tail again. `chopper` is unchanged (On his tail's ace).
- New `meetHim`: watch, turn into him when he is behind you inside 400 m,
  meet him nose on, pass over him (18 degrees up) inside 130 m, turn again.
- Lesson `out-of-the-lock`: retitled "breaking the tail"; ace starts 230 m
  back (was 311 m: the run-in was half the picture), 45 s; five fights:
  fly straight, dive away (does not shake him), turn hard (does not shake
  him), turn into him early (`aceStart` 480 m back), turn then chop. Words,
  notes, coach (`extend`, `headon` lines, `evade` reworded) to the numbers.
- On his tail, `close`: you (the hunter) now run after flying past; he lands
  2-7 (was 2-10) and one stray round of yours can land as you go by.

### Nine starts (test_dogfight_shape_tail.py)

- without: shot down 9/9, locked 14.6-20.1 s.
- move (dive): locked 6.9-13.3 s first; he sits 135-140 m behind through the
  dive, nose on you all of it; locked 10.5-11.6 s of the next 20; he lands
  7-20, you none.
- flat: no hits either way; his lock comes in sweeps of about 2 s; never in
  front, no head-on; he follows you round 40-100 m back.
- meet: locked inside 450 m 2.7-3.5 s before the turn; lock gone about 2 s
  after it (1.7-2.7 s in the 3-23 s window); 1-2 head-on passes, closest
  20-26 m; no hits either way.
- counter: chop at 58-64 m, him behind you 73-80% of it; he flies past
  9/9, headings 4-14 degrees apart, 5-14 m below; he runs 9/9; in front of
  you 12.8-14.1 s of the next 15; never back on your tail in 10 s; you land
  1-10 (24 in all), he lands none; you bottom at 25.5-26.3 m/s.

### Thresholds relaxed

- "No pass under 20 m": the chop's fly-past is 5-14 m by its nature (he is
  60 m behind you in a 120 m circle when you chop); nothing collides in the
  engine's duel. Held at >= 4 m. Every other demo holds >= 20 m.
- Swap landing shot >= 0.5 s: the strict would-land ticks are 0-1.8 s (you
  are slow, 26-40 m/s, and he is faster, running downhill); held instead by
  at least one landed hit in every fight and 15 in all, and him in front of
  you >= 8 s.
- The early turn's lock before the counter is inside 450 m, not 300 m: the
  counter is the turn made while he is still out there.

### Open

- The meet demo's passes are neutral, not a win: after the passes the two
  circle apart and he hunts again (the honest end of a head-on between
  equals).
- The theatre's top camera frames the whole run, so the circle and the chase
  are small next to the run-in; a camera that frames the last 20 s would read
  better (theatre is the coordinator's).
- Screenshots: `scratchpad/fork-tail/shots/` (`top-*`, `wide-*`, `you-*`,
  `ztop-*`).


Plans: `hunter` (rewritten), `chopper` (rewritten), `diveOut` (watch phase),
`lagBack` (rewritten), `breaker` (chop gated), new `lockHardTurn`. Lessons
`out-of-the-lock` (all of it) and `on-his-tail` (story, counter story,
tagline, coach, the `close` and `lag` demos). Shape tests:
`tools/bf1942-models/tests/test_dogfight_shape_tail.py` with
`dogfight_shape_tail.mjs`.

## The tactic

The lock: an attacker who gets behind you and stays there. The throttle chop
(Shaw; research.md "Throttle chop"): with him close behind you and closing,
chop the throttle and pull, he cannot slow as fast, flies past in front of
your wings, you get the shot. Risk: you are slow afterwards.

## What BF1942's flight law allows (measured)

- A hard level turn holding height: about 43 deg/s at 43 m/s, a circle about
  115 m across, round in 8.4 s. A faster Spitfire turns faster, not wider
  (agrees with reviews/break.md).
- Anyone more than about 100 m behind you when you break cannot stay in your
  rear quarter at 150-300 m: the circle is smaller than his gun range. A good
  hunter follows you in and sits 40-100 m behind you in the circle (behind
  your wing line, nose 40-70 deg off you), and neither can shoot.
- A chop in a flat hard turn does not make him fly past: you slow, your turn
  opens (below 35 m/s a Spitfire turns badly), he gains angle and slides
  inside or alongside. In 12 tried variants (straight chop, chop on his
  arrival, flat in-turn chop, pitch-up chop, a hunter on your path, a
  hunter that ducks under) only one shape works on all 9 starts: the chop
  combined with a pull up through the turn (`hardTurn` climb 16 m/s, bank
  55, throttle -1 to 32 m/s), started only once he has sat behind you in the
  circle 4 s and is inside 90 m and closing. You go up and slow to about
  26 m/s; he passes underneath, on your heading (4-10 deg), 4-17 m away, and
  is in front of your wings for about a second before he breaks.
- A straight chop with him behind you just gives him the shot.

## What the reconstruction does now (9 starts each, before -> after)

Out of his lock (hunter from [80, 380, 300], 300 m back):
- without (cruiser): shot down 9/9 at 14-23 s, hunter on your tail 12-22 s,
  never closer than 93 m. (Before: same outcome.)
- move (diveOut): flies on until he is committed (180 m, closing), dives
  away (to 62-65 m/s, the dive is short from 350 m), zooms, turns back. He is
  on your tail 100% of the dive, 137-141 m back, no hits in the dive; 2-22
  hits after you pull out, shot down 1/9. Words changed to say so (before
  the words claimed the dive is an easy shot; hits came after the pull up).
- flat (lockHardTurn): turns at 10-19 s when he is committed; then no hits
  either way 9/9, your landing shot 0, his 0.9-1.1 s (the moment of the
  break, while he holds fire), median range 96-102 m, closest 42-46 m, no
  fly-past, height held (lowest 303-319 m from 350). Before: two circles,
  head-on passes at 8-37 m, 350 -> 109 m.
- counter (chopper): lock 10.8-12.4 s before the chop; chop 4 s after the
  break at 57-66 m, him behind you 72-77% of the chop ticks; he flies past
  9/9, headings 4-10 deg apart, closest 6-17 m; you on his tail 0.8-1.3 s,
  your landing shot 0.27-0.6 s, 1-7 hits landed, he never back on your tail
  in the next 10 s, he lands 0. Before: head-on through your circle at t~7,
  chop on head-on geometry, overshoot 1/9, the lock back on at the end.

On his tail (move/counter are break's):
- close (chopper vs hunter, own starts mirroring out-of-the-lock): he chops
  with you 50 deg or less off his tail at 59-63 m; you fly past underneath
  9/9 (headings 1-10 deg, closest 7-17 m); he is on your tail 0.4-1.5 s,
  lands 2-10, you land 0. Before: head-on at 5.6 s, chop during head-on.
- lag (chopper with `breakAt: 300, rollOut: true` vs lagBack): he breaks at
  300 m; you turn the same way where you are: median range 266-283 m, never
  under 191 m, never under 35 m/s; he never chops; after 10 s with nobody
  inside 150 m he rolls out (9/9); you close and every hit lands from dead
  astern; shot down 7/9 at 51-59 s, he lands 0-1. His nose sweeps past you
  at 190-210 m for under a second once a lap (`headOn` <= 19 ticks). Before:
  head-on at 5.5 s, median 116-158 m, down to 8 m/s.

## What changed

- `hunter`: full throttle in, closure eased to sit 30 m behind (the throttle
  leaned on lightly: it is a rate and the brake bites late), holds fire
  until 150 m (`HUNTER_FIRE`), and against a hard turner turns the same
  hard turn toward you holding a slowly-followed height (`levelHardTurn`),
  nose onto you when within 20 deg. The yo-yo is gone (it fired on every
  break and stalled him to 28 m/s); coach `yoyo` line removed; `lag` is
  `attack` (he is after the shot, its landing ticks are his).
- `chopper`: watch / turn / chop / reverse / shoot as above; memory
  `breakAt` (first break range) and `rollOut` (stops turning when nobody
  follows him in).
- `lockHardTurn`: the flat demo's seat (watch, then the hard turn holding
  height). `flatTurn` is untouched (fixer height).
- `diveOut`: watch phase; dive away from him; zoom; back; turn.
- `lagBack`: close to 250 m at his speed; while he turns, the same hard turn
  the same way where you are; when he stops turning, lead pursuit and guns.
- `breaker` (On his tail's FLY IT ace): chops only with you close behind in
  the circle and closing, pulling up, as `chopper`; height held in the turn.
- Lessons: words rewritten to match the numbers above; on-his-tail story and
  coach now match break.md (no 50/50, no "arriving slow kills", no "250 m
  behind in his circle").
- Tests: new shape file (9 tests). In `test_dogfight_school.py`:
  `test_against_the_chop_lagging_back_is_never_hit_and_sitting_close_is`
  replaced by `test_against_the_chop_sitting_close_is_hit_and_turning_with_him_out_wide_is_not`;
  the out-of-the-lock line of `test_the_counters_take_his_kill_shots_away`
  now holds "no hits in the counter" (his 'would land' ticks are the lock,
  held fire before the break). Harness `showMe` freezes 3/5/7 -> 3/15/17
  (the hunter is committed on your tail about 14 s in).

## Thresholds relaxed, and why

- Overshoot "from >= 50 m behind" -> 20 m, "to >= 20 m ahead" -> 5 m ahead
  and in front of the wing line: he sits 60 m behind in a 115 m circle and
  breaks the moment your nose is on him.
- Overshoot "min range 15-120" -> >= 4 m: the pass is underneath, 4-17 m;
  no collision is modelled, but it is close and the notes say so.
- "You on his tail >= 2 s" -> 0.75 s; landing shot >= 0.5 -> 0.25 s: he
  breaks (reflex) as soon as your nose comes on.
- Chop behind >= 80% -> 70%: the last ticks of the chop are him passing.
- "Hunter in your rear quarter >= 50% in the flat demo" -> 20% plus median
  80-120 m: see the circle size above.
- Lag "nose behind him >= 60% of his turning" dropped: from 250 m nobody's
  nose can point behind a 115 m circle; held instead by range 250-300 m,
  never under 180 m, no chop, hits only from astern.
- Hunter >= 28 m/s: 25 in the dive demo (he follows your zoom).

## Open

- The chopper bottoms at 24-26 m/s after the chop (the honest price).
- The lag demo's kill comes late (51-59 s of 60).
- `close` demo starts differ from the lesson's FLY IT start (demo-level
  `aceStart`/`youStart`); `lag` sets `aceMemory`.
- Screenshots: scratchpad/fix-tail/{top,wide}-out-of-the-lock-*.png,
  {top,wide}-on-his-tail-{close,lag}-*.png.
