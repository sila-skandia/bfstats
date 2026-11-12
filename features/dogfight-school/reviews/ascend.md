# The ascendancy pilot (`PLANS.ascend`)

The owner, watching the On his tail Ninja turn in lockstep with a breaking
enemy: "I'm looking to watch dogfighting and see how to get ascendancy
(meaning coming up with a shot) and how to stay there." One shared pilot that
holds the upper hand from an advantage, for the per-lesson rollout to hand
over to. Scored as a Ninja by `tests/dogfight_dfn_measure.mjs`; held by
`tests/test_dogfight_ascend.py` (`tests/dogfight_ascend.mjs`).

## The bench

`ascend` in seat 1, `skill` 0.85; the ace in seat 0 at 320 m, 55 m/s, straight
and level, `skill` 1, with its lesson's memory (less any phase). Two starts
with the advantage: **astern** (300 m behind, 150 m over him, 65 m/s) and
**abeam** (300 m out on his beam, 200 m over him, 65 m/s). Nine nearby starts
each (x -30/0/+30, speed -3/0/+3), 50 s. 20 rows, 180 fights.

Round two (2026-11-07, the measure as it stands): a kill satisfies the two
attacks, and **IDLE**: after the first shot, never more than 20 s inside 600 m
of him without a landing shot, unless he is down. Round one's `ascend` (51
under the old measure) flies 23 under it; 126 of its fights failed IDLE, the
"one pass, then circling over or under his circle" end.

## The doctrine as flown

- **Find**: above him (35 m or more), his nose not on me, my nose within 60
  degrees of him and he 13 degrees or more below my horizon: dive.
- **Dive**: lead pursuit with the lead's own swing led (`ascAim`: the nose on
  where the lead point will be 0.7 s on), guns inside 262 m.
- **Off him before the pass**: 1 s before the paths cross, inside 28 m, when
  the pull-out would bottom out 20 m under his height, when his nose comes
  onto me inside 400 m, or when the lead is lost (50 degrees, 1.5 s in).
- **Zoom**: up at 80 degrees on the dive's speed, pulled at 0.7 of the stick
  until 62 m/s are left; a **wingover** toward his side of the sky until the
  nose is 18 degrees up, and back to find.
- **Leave** (new): once there has been a shot, and only while his nose is 130
  degrees or more off me and I am 300 m or more out: straight away at full
  throttle, 5 degrees up to 310 m, then the best climb, out to 1000 m or 16 s.
  **Back**: round toward him with my nose 45 degrees off him (his meet needs
  it within 40) and down on him again from inside 450 m.
- **Beam**: his nose within 20 degrees of me inside 600 m: across his line,
  80 degrees off it, bank no more than 60, holding the height.
- **Climb**: not above him: climb toward him at the best angle. This is the
  step that ends in circling; every replacement measured hands him the six
  or gets me shot down (below).
- Never closer than 50 m closing: off him and up.

## What it flies (exact, from `test_dogfight_ascend.py`)

| start | ace | works/9 | attacks | myShot s | hits on him | six max s | held min | shot him down | stalemate |
|---|---|---|---|---|---|---|---|---|---|
| astern | otBreaker | 0 | 1-3 | 0.53-1.33 | 4-14 | 0 | 0.12 | 0 | 9 |
| astern | btHunter | 1 | 1-2 | 0.67-1.13 | 9-22 | 0 | 1 | 1 | 8 |
| astern | scAce | 0 | 1-2 | 0.3-1.6 | 0-18 | 36.3 | 0.83 | 0 | 9 |
| astern | taAce | 3 | 0-3 | 0-3.57 | 0-33 | 1.27 | 0 | 3 | 1 |
| astern | uoAce | 0 | 0-1 | 0-0.53 | 0-9 | 1.8 | 0 | 0 | 2 |
| astern | bzAce | 3 | 1-5 | 0.83-2.03 | 14-27 | 0 | 1 | 1 | 6 |
| astern | uhAce | 2 | 1-4 | 0.97-2.1 | 12-22 | 0 | 1 | 1 | 7 |
| astern | olHunter | 1 | 1-2 | 0.67-1.13 | 11-22 | 0 | 1 | 1 | 8 |
| astern | breakTurn | 0 | 1-2 | 0.23-1.7 | 1-16 | 0.5 | 0.95 | 0 | 9 |
| astern | breaker | 0 | 1-3 | 0.53-1.33 | 4-11 | 0 | 0.12 | 0 | 9 |
| abeam | otBreaker | 3 | 1-2 | 1.57-1.93 | 8-23 | 0 | 0.59 | 3 | 6 |
| abeam | btHunter | 0 | 0-2 | 0-0.43 | 0-2 | 0.4 | 0 | 0 | 2 |
| abeam | scAce | 0 | 1-4 | 0.53-1.57 | 0-13 | 25.57 | 0.83 | 0 | 7 |
| abeam | taAce | 8 | 2-5 | 0.7-3.13 | 4-41 | 9.73 | 0.43 | 5 | 1 |
| abeam | uoAce | 0 | 1-4 | 0.4-2.77 | 2-18 | 3.63 | 0.67 | 0 | 8 |
| abeam | bzAce | 2 | 1-3 | 0.5-2.67 | 2-27 | 0 | 0.87 | 2 | 7 |
| abeam | uhAce | 9 | 1 | 1.7-2.27 | 26-35 | 0 | 1 | 9 | 0 |
| abeam | olHunter | 0 | 0-2 | 0-0.43 | 0-2 | 0.4 | 0 | 0 | 2 |
| abeam | breakTurn | 2 | 0-2 | 0-2.13 | 1-29 | 0 | 0 | 2 | 4 |
| abeam | breaker | 0 | 1 | 1.63-1.83 | 10-19 | 0 | 0.41 | 0 | 9 |

**34 of 180.** A landing shot comes up in 153, he is shot down in 28 (all
nine off the height ace's beam, in one pass), `ascend` itself is never shot
down, he sits on its six for a second or more in 11. **114 end in the
stalemate.** It works against the height ace off his beam (9) and the
Immelmann ace off his beam (8); nowhere else.

## Staying there: round two, every family under the new measure

Counts over the 180 (Ninja works; shot him down; I was shot down; fights with
a six of 1 s or more; stalemates):

| Family | works | killed | shot down | six | stalemate |
|---|---|---|---|---|---|
| round one's `ascend` (pendulum, climb toward him) | 23 | 19 | 0 | 28 | 126 |
| **pendulum + leave only when safe (shipped)** | **34** | 28 | **0** | **11** | 114 |
| the same, safe = his nose 150-170 deg off, or 200 m out | 32-35 | 26-28 | 0-4 | 12-40 | 108-113 |
| the same, also leaving from above his reach (look-down 40-50 deg) | 33-35 | 27-29 | 0-4 | 32-46 | 107-113 |
| pendulum + leave **forced** 6.6-7 s after the last shot (a search, 12 seeds x 35) | 39-40 | 25-26 | **15-25** | 59-67 | 77-81 |
| the below-him step replaced: on along the zoom / a climbing orbit / across his line | 34 / 34 / 29 | 19-21 | 0 | 85-117 | 88-107 |
| rebuild over him: pull off, climbing orbit with my nose 80-90 deg off him (p24) | 0 | 2 | 0 | 94-122 | 41-70 |
| rebuild round him: fork A's loiter, slant ~450 m | 16 | 2 | 0 | 92 | 114 |
| extend and come back (fork B's best) | 3 | - | - | 82 | 94 |
| slash over him at the dive's speed and extend (p20-p21) | 7-19 | - | - | 63-90 | 51-64 |
| a gentler pull-off: upright before the zoom (p30) | 30-44 | 27-40 | 0 | 15-37 | 100-115 |
| snapshots from under him at even energy (p23) | 21-31 | - | - | 28-32 | 109-129 |
| **hit and run**: one pass, out past 900 m, no return | 13 | 9 | 0 | 68 | 9 |

Hit and run gets clean away (past 900 m, opening, never hit) or kills him in
80 of 180, but hands him the six in 68 on the way out.

## Why it cannot stay there: what round two adds

- **The safe moment to leave does not come once the fight is close.** The
  leave waits for his nose 130 degrees or more off and 300 m out; after a pass
  the fight closes to 100-250 m and the circles co-rotate, so in 114 fights it
  never comes. Leaving anyway (forced 7 s after the last shot) takes the
  stalemates from 114 to 77-81 and gets `ascend` shot down in 15-25 of 180,
  its six held in 59-67: he is round onto the tail in 4-5 s, before 400 m.
- **Rebuilding over him is not available.** Over his circle steep enough that
  his level nose cannot reach (elevation over 60 degrees) means a horizontal
  offset under 0.58 of the height: an orbit of 60-90 m round a 65 m circle, a
  hard turn that holds his rate and climbs nothing. Out at 400 m slant, a
  climbing orbit cannot keep my nose within 90 degrees of a man who reverses
  and chases at 39 deg/s with bank 60-75 (six in 94-122).
- **Below him** the only six-free move measured is to keep climbing toward
  him, which is the circling; on along the zoom, an orbit, or across his line
  hand him the six in 85-117.
- So against the turners (`otBreaker`, `breaker`, `breakTurn`), the hunters
  and the scissors ace the choice is: stay near at even energy (no six, a
  stalemate), or leave and be shot at. Staying the ascendancy holds only where
  the first pass kills or where the ace climbs or loops away and comes back
  (the height ace, the Immelmann ace off the beam, partly the boom-and-zoom
  ace).

## The physics (round one)

Measured on the flight law (`<SCRATCH>/asc/dragtest.mjs`, `turnperf.mjs`,
`ecost.mjs`):

- **Straight flight is energy; hard pulls spend it.** Full throttle, a 20
  degree climb from 50 m/s gains 99 m of energy height in 6 s (16.6 m/s),
  level from 75 m/s 6.3 m/s, a 30 degree dive breaks even. A level turn at 60
  degrees of bank holds 71-73 m/s (18 degrees a second); at 80 degrees (61
  deg/s) it falls from 75 to 57 m/s in 5 s.
- **A pass costs about 120 m of energy height.** First passes, 60 of them:
  the edge over him 216 m at the dive, 151 at the break, 91 three seconds
  later (the dive's aiming pulls cost me 81 m, the pull-up and wingover 65;
  he loses 21 breaking). It does not depend on the aim's pull (0.5 to 1: 91
  to 95) or the dive's floor.
- **Winning it back means straight flight, and straight flight near a turner
  shows him the tail.** `otBreaker` reverses onto anyone in his front 60
  degrees inside 400 m whose nose points more than 90 degrees from him, and
  keeps breaking while my nose is within 45 degrees of him inside 600 m; every
  ace chases a man leaving and gives up only after 6 s past 298 m. After a
  pass his nose comes back within 30 degrees of me 4.0-5.4 s later (even when
  it was 150-162 degrees off), at 266-331 m; clearing 400 m in that time needs
  about 80 m/s of opening, a pass leaves 47. A turner's hard turn is his
  sustained turn; matching it over his circle spends what a climb would win.
- So the start's edge buys **one, sometimes two passes**, then even energy,
  and at even energy the safe place is over or under his circle, out of his
  reach: what the pictures show after 15-20 s.
- **Once he has the six, nothing gets it back** inside the measure: from 150
  or 250 m behind, a zoom at 60 or 80 degrees leaves him on the six 4 to 10 s
  and hit in most (`vlab.mjs`); a hard turn into him, 117-136 of 180 fights
  with a six.

## Round one: every variant tried (works of 180 under the first measure)

The aim:

| Aim | landing shot, 12 lab starts against a hard turner, a straight flyer and a circler (9 s) |
|---|---|
| `leadPursuit` (the school's) | 7.1 s, 32 hits; never on the hard turner (the nose lags the lead 10-16 deg) |
| `pointNose` gains raised (kPitch 4-6, kBank 4-5) | 5.8-10.0 s |
| **lead the lead, 0.6-0.8 s** (`ascAim`) | **13-15 s, 84-127 hits**; 0.7-1.1 s per pass on the hard turner |

The attack geometry and the perch:

| Variant | works | why it fails |
|---|---|---|
| perch behind and above, gentle pursuit (p1-p2) | 0-1 | old aim; after the pass he reverses onto the tail |
| orbit his position 250 m out (p3) | 0-1 | perch speed 45-50 m/s, no dive gate opens |
| perch behind, zoom or extend, loop over him (p4, three zooms x two defences) | 0 | perch climbs eat the speed |
| dive gates from the data, zoom over him (p6-p8) | 2-18 | 63% of the time in the perch, too low and slow |
| **vertical pendulum: dive, zoom 80, wingover, beam, climb toward him (p9-p11, `ascend`)** | **15-60** | the best family; 51 as rounded; second pass and the six against chasers |
| bounce box (perch at 220-500 m in his rear quarter, p12) | 0 | getting there shows him the tail: six 40 s |
| boom, extend, come back (p13; a second search, 6 seeds x 35 configs) | 8; best 20 (9 at 70 s) | every extension starts too close and too slow: sixes |
| vulture orbit round the centre of his turn (p14) | 4 | he reverses into the orbit: six 36 s |
| repeated high yo-yo over his path, new aim (p16) | 28 | six in 2 runs only, but the hard follow sinks below him |
| offset orbit, nose 70 deg off him (p17) | 3 of 54 vs the breakers | cannot keep the nose in at bank 75 |
| loiter 300-450 m out, roll in by his bearing (p18; a search, 12 seeds x 40) | 0-4 of 54; best 52 | bzAce 9+9, but six in 91 fights: he reverses in 2-4 s |

The defence against his nose coming round:

| Defence | result |
|---|---|
| **beam, 75-90 deg off his line, holding height** | sixes 3-28 of 180 in the pendulum |
| turn hard into him (bank 85) | six in 117-136 |
| zoom out of his plane (60-80 deg) | six 4-10 s, hit (lab) |
| extend in a shallow dive | six in 81-109 |

When below him: climbing toward him 31-60; across his line (60-120 deg off it)
2-6, sixes 72-137; on along the zoom 9; a climbing orbit 5.

Perch height and offset: 100, 150, 200, 250, 300 m over him (no height clearly
better, the bench moves 2-4 works between them; in the dive lab 0.22-0.28 s
average); 0-450 m out (the dive lab, a landing shot of 0.3 s or more: from
directly over a hard turner 0 of 64 dives, from 300 m out 38 of 64; nose on
him at the start 53 of 128, tangential 13 of 128).

The tuning: random searches over 15-21 knobs (11 seeds x 40-60 configs on the
pendulum) land between 41 and 60 for neighbouring settings: single rows flip
with a degree here or a metre there. The shipped numbers are rounded; 51 is
what they fly.

## For the rollout

- `ascend` takes over from a perch: above him by 35 m or more, he 13 degrees
  or more below the horizon, my nose within 60 degrees of him and his not on
  me. From there it dives at once; the first landing shot comes 3.3 to 8.6 s
  after a 300 m perch.
- A pass spends about 120 m of energy height. Hand over with 150 m or more.
- Expect the first pass to land; a second only against aces who climb or loop
  away. If the lesson wants a clean ending against a turner, hit and run (one
  pass, out past 900 m) is the honest alternative, with the six risk above.
- Do not hand over with a hunter turning onto me off my beam (a shot in 2 of
  9) or with the scissors ace inside his 230 m (six 25-36 s).

## Pictures

In `<SCRATCH>/asc/` (`plot.mjs`: top-down and side-on, 2 s marks, landing
shots thick):

- `final2-otBreaker-astern.png`: the first pass lands (1.33 s, 8 hits), the
  pull-out takes it 150 m under him, and it circles under his circle for 40 s:
  the stalemate. No safe moment to leave comes (he is 160-180 m off).
- `final2-scAce-astern.png`: one pass (1.33 s, 18 hits), a second dive at 12
  s with no shot, then circling with him down to 150 m: the stalemate.
- `final2-bzAce-astern.png`: works, four attacks (1.73 s, 16 hits): dives at
  the start and about 12, 17, 32 and 46 s, a zoom after each, no circling; the fight walks
  down from 470 to 100 m as he breaks into each dive.
- `final2-taAce-abeam.png`: two attacks in the first dive (0.83 s, 4 hits),
  then a leave at about 12 s, out 1000 m, back from about 28 s; on the way
  in he turns onto me and sits on the six 9.7 s, so it fails.

The circling the coordinator asked not to see is still in two of the four,
and in 114 of the 180: every way out of it measured costs the six or the
aeroplane.

## Open

- Whether an ace that reverses on a tail by a different rule would let the
  doctrine fly; the lessons' aces all reverse inside 400 m.
- The measure: inside 15 m fails even a pass that misses by 14 m.

## Human eyes (2026-11-07)

Every pilot now sees only what a pilot could see from his seat (`EYES`,
reviews/eyes.md): the cone 20 degrees round his tail and the sky under his
wings are hidden, the rear is checked in 1 s glances, a plane coming into view
is noticed 0.8 s later, and after 4 s unseen he knows he has lost it and
turns to clear his tail. The bench is the same 180 fights.

### The doctrine as flown

The pendulum above, with one change: **it leaves only once he has lost it**
(4.2 s where his cockpit hides it, judged off his attitude, `ASC.lostFor`),
instead of when his nose is 130 degrees off and it is 300 m out. A man who
can see you follows you out, wherever his nose is pointing at the moment you
go; a man who has lost you does not. Its landing shots count only when it
sees him.

### The bench, before and after the eyes

| ace | start | works/9 before | works/9 eyes | attacks | killed | six max s before | six max s eyes | stalemate before | stalemate eyes |
|---|---|---|---|---|---|---|---|---|---|
| otBreaker | astern | 0 | 0 | 1-3 | 0 | 0 | 0.13 | 9 | 9 |
| btHunter | astern | 1 | 1 | 1-2 | 1 | 0 | 0 | 8 | 8 |
| scAce | astern | 0 | 0 | 1-2 | 0 | 36.3 | 6.13 | 9 | 9 |
| taAce | astern | 3 | 3 | 0-4 | 3 | 1.27 | 1 | 1 | 1 |
| uoAce | astern | 0 | 0 | 0-1 | 0 | 1.8 | 1.43 | 2 | 3 |
| bzAce | astern | 3 | 3 | 1-5 | 0 | 0 | 0 | 6 | 6 |
| uhAce | astern | 2 | 1 | 1-4 | 1 | 0 | 3 | 7 | 8 |
| olHunter | astern | 1 | 1 | 1-1 | 1 | 0 | 0 | 8 | 8 |
| breakTurn | astern | 0 | 0 | 1-4 | 0 | 0.5 | 0 | 9 | 8 |
| breaker | astern | 0 | 0 | 1-3 | 0 | 0 | 3.73 | 9 | 9 |
| otBreaker | abeam | 3 | 2 | 1-1 | 2 | 0 | 0 | 6 | 7 |
| btHunter | abeam | 0 | 0 | 0-1 | 0 | 0.4 | 0 | 2 | 2 |
| scAce | abeam | 0 | 1 | 1-5 | 0 | 25.57 | 2.87 | 7 | 6 |
| taAce | abeam | 8 | 3 | 2-7 | 1 | 9.73 | 3.6 | 1 | 6 |
| uoAce | abeam | 0 | 0 | 1-3 | 0 | 3.63 | 10.57 | 8 | 9 |
| bzAce | abeam | 2 | 4 | 1-4 | 4 | 0 | 0 | 7 | 5 |
| uhAce | abeam | 9 | 9 | 1-1 | 9 | 0 | 0 | 0 | 0 |
| olHunter | abeam | 0 | 0 | 0-1 | 0 | 0.4 | 0 | 2 | 2 |
| breakTurn | abeam | 2 | 2 | 0-2 | 2 | 0 | 0 | 4 | 4 |
| breaker | abeam | 0 | 0 | 1-1 | 0 | 0 | 0 | 9 | 9 |

**30 of 180 under the eyes (34 before them)**: a landing shot comes up in 154,
he is shot down in 24 (28 before), `ascend` is never shot down, he sits on
its six for a second or more in 11 (11), and **119 end in the stalemate**
(114). The round-one rule (leave on his nose 130 off and 300 m out) flies 27
under the eyes; leaving only once he has lost you is worth 3.

### Staying unseen after a pass: what was tried (works of 180 under the eyes)

All from the pendulum, `<SCRATCH>/eyes/try.mjs` (a knobbed copy), the same
bench:

| After the pass | works | six 1 s+ | stalemate | why |
|---|---|---|---|---|
| leave on his nose 130 off, 300 m out (round one) | 27 | 10 | 122 | he sees you go and follows |
| **leave once he has lost you (shipped)** | **30** | 11 | 119 | rarely comes: a turner who saw the dive keeps you padlocked |
| leave whenever you are in his blind sky at that moment | 22 | 39 | 115 | a moment hidden is not lost: he finds you again in 0.25 s as you turn away |
| slip under his wings after the pass, extend until he has lost you, then leave | 25 | 30 | 120 | the slip ends inside 50 m (the collision rule) or he turns and sees you first |
| stalk him from his six low (200 m behind, 15 deg under his wings) and rise into him | 20 | 28 | 133 | against a turner the stalk point rotates with him: lockstep circling, seen the whole time |
| drop back onto his tail line, 300-600 m, inside his cone | 20-21 | 79 | 126 | behind a turner is where he reverses onto: the six |
| zoom along his tail line instead of the dive's heading | 27 | 17 | 119 | no better hidden: high astern is outside the 20 deg cone |
| below him after a shot, hide 80 m under his belly | 19 | 47 | 124 | formation under a turning man is lockstep, and he sees you when he rolls |
| below him, climb toward his tail line instead of at him | 20 | 73 | 119 | the old finding again: any climb not at him hands him the six |
| random search, 120 configs over the leave, slip, roll-in and return knobs | 29-33 | 10-22 | 109-122 | nothing clears the stalemate; the best gains 2-3 on noise |

### What the eyes say about the ascendancy

- **The eyes change little against an ace who has seen you.** Once he has
  noticed the dive he keeps his eyes on you anywhere his cockpit lets him;
  the only places he cannot see are a 20 degree cone round his tail and the
  sky under his wings, and both turn with him. Staying in either while he
  turns is following his turn: the circling the owner does not want to see.
- **It works where the ace flies away from you.** The leave-when-lost
  doctrine flies clean against the aces that climb, loop or extend on their
  plan (`bzAce` off the beam 2 to 4, the scissors ace off the beam 0 to 1),
  and the pictures show it: out unseen, the height rebuilt, back down.
- **What the bench does not test** is the bounce on a man who has not seen
  you. Both bench starts are inside his view (150-200 m over him), and every
  fight starts with both pilots aware. Under the eyes the classic kill, the
  one the 80 per cent quote is about, is the first pass on a man who is
  looking the other way: a rollout lesson that starts its attacker unseen
  (inside his tail cone, or low behind him) will show it.

### Pictures

In `<SCRATCH>/eyes/` (`plot.mjs`: top-down and side-on, 2 s marks, landing
shots thick, a thick grey line where the other pilot does not see that
plane):

- `final-otBreaker-astern.png`: one pass at 5 s (1.33 s, 8 hits); he breaks
  and never stops; it circles with him to the end. The stalemate.
- `final-scAce-astern.png`: two passes (1.53 s, 21 hits), then circling with
  him, both descending, from 16 s. The stalemate.
- `final-bzAce-astern.png`: works, three attacks; at 34 s it has been hidden
  4 s and leaves, climbing, unseen (grey), and comes back; no circling.
- `final-taAce-abeam.png`: works, two attacks; out unseen after the first,
  he clears and loops, they part 600-800 m.

### For the rollout

- Hand over to `ascend` as before; the first pass still lands (154 of 180),
  a second only against aces that fly away from you.
- Under the eyes a lesson's attacker can start unseen: in his tail cone, or
  under his wings behind him. That is where the eyes pay; the bench does not
  measure it.
- A pilot reads `c.g.sees`, `c.g.lost` and `hiddenFrom(him, me.position)`;
  the track records `sees` for the theatre's "he has lost you".

## The bench after the rollout (2026-11-07, evening)

The measure gained burst-sized attacks (0.3 s, 3 s apart), the idle clock from
a 50 m lead, the hang limit and measuring up to the kill; the lessons' aces
gained sensible answers (`taAce` fights on after his split-S run); and
`ascend` now takes a shot that comes up in its zoom and wingover (it held
fire there, which broke the school's "a shot that would land reads as going
for it" in every lesson that hands over to it). On the same bench: **39 of
180 work, and every one of the 39 is a kill**; a landing shot comes up in
154, it is never shot down, and 137 end in the stalemate. What `ascend`
holds is the first pass. A banked turn onto the leave heading in place of
the pull-up was tried and dropped: Up and over's Ninja, which leaves through
`ascend`, fell from 6 to 1 of the nine.

## Retail g and box area (2026-11-12)

Re-pinned on the law's retail gravity and box-drag area
(features/retail-parity-cross-check-2026-11-12), with `breakTurn` now
reversing at 6 m across (reviews/break.md): 16 of the 20 rows moved. The
bench: **40 of 180 work and 39 of them are kills** (one of abeam/taAce's
three, now partly, works without a kill); a landing shot in 156, never shot
down, 137 stalemates. abeam/taAce 3 of 9 (was 2), abeam/bzAce 5 (was 4),
astern/uhAce 0 (was 1); from astern the Immelmann and up-and-over aces give
a first shot in 7 and 4 of nine (were 6 and 3). The conclusion stands: what
`ascend` holds is the first pass.
