# Dogfight doctrine: Boelcke's rules in the dogfight school

Status: **steps 1 to 7 of the build plan built** (2026-11-10, after the
owner's go: "The BF1918 arena", "The lessons on other airframes", "The
falling leaf", "More than two planes", "The two-seater"); steps 8 and 9 wait
on data the recordings do not yet hold (the build plan says why). Steps 1 to
3: the rules measured over any fight and reported over the 303
recorded fights, the school's Rules tab, the coach's rule lines and the end
card's verdicts, and the gunnery drill. Steps 4 to 9 are proposals still.
See "Built" and "What the recordings say" below; the research and the plan
follow them unchanged.

A community member, seeing BF1918 come into the viewer, suggested the Dicta
Boelcke, the first written rules of air fighting (1916), as a way to teach
period-correct dogfighting in the school, and perhaps the later doctrine for
WWII and Desert Combat. This page reads the rules and what followed them,
checks each against what the Refractor flight law and the mods' own data
actually reward, says what the school can already measure and what it
cannot, and ends with a ranked build plan.

## Built (2026-11-10)

- **`viewer/dogfight-doctrine.js`** (pure): over a fight in the theatre's
  shape, flown or recorded, each pilot's **attacks** (begun when the nose is
  within 30 degrees, inside 700 m and not opening; ended when the nose has
  been off for 2 s or the range opens past 900 m), each with the energy lead,
  whether the target saw the attacker, the aspect, the sun angle when given,
  the first burst, the hits, and whether it was carried through, spoiled (the
  target turned to face it), threatened or abandoned; each **burst**, every
  round counted at the range it left at against the plane's **useful range**
  (`usefulRange`: inside the guns' reach, and where the falloff still does
  half damage: vanilla 269 m, BF1918 136 m, FHSW 7.92 mm 284 m, FHSW 20 mm
  501 m); **sight** (the duel's `sees`, or `perceive` run over a recording's
  tracks); the **dives** on a pilot, met or run from (judged at the
  attacker's first burst or closest point: off the tail by 90 degrees is met,
  inside 45 is run); and a verdict per rule 1 to 6 (`RULES` holds the eight in
  plain words with what this engine does with each). `DOCTRINE` holds every
  number.
- **`dogfight_doctrine_report.mjs`**: the rules over every extracted fight,
  with `--suns features/dogfight-doctrine/suns.json` (the seven recorded
  vanilla levels' `sunDirection`, read from their `scene.json` on
  mesh.bfstats.io) and `--without <pilot>`. The fights are on play.bfstats.io
  under `/replays/dogfights/`; the local checkout holds only the index.
- **The Rules tab** (the school's rail, fourth beside Lessons, Rings and
  Fights): the eight rules, each with what the engine and the recordings say
  and the lesson that shows it (rule 6 opens *When they have the height* on
  *You climb between their dives*). Rules 7 and 8 say "Not in the school yet".
- **The end card**: each rule in play kept (green) or broken (red), with its
  numbers: yours in a lesson, both pilots' in a recording.
- **The coach** (`dogfight-coach.js`): five lines tagged with their rule.
  Hold fire past your plane's useful range, read from your own plane's
  FireArms (`gunFromNode`) (3); no advantage going in (1); committed to a
  dive (2); lost sight of them for 2 s (4); head on or from the side (5).
  When the lesson's own line is on top, the rule rides in its own row under
  it ("BOELCKE 3 · Hold fire: ..."), so the lesson's words keep their place.
  Without a useful range the coach is as it was.
- **The gunnery drill** (lesson *Gunnery: close, then closer*, `gunnery`):
  a target (`PLANS.target`) that flies straight, turns, jinks and climbs in a
  27 s loop at 50 m/s, never shoots, never breaks, never looks round. The
  rule's row keeps the score: hits, rounds, hits per 100, the average range
  of a hit, and the share fired past your useful range. The guide and the
  instructor fly a chaser.
- **Tests:** `tests/test_dogfight_doctrine.py` (15): the measures on the
  school's own lessons (the boom-and-zoom ace keeps rules 1, 2, 3 and 5; the
  pilot who meets the dive meets every one, the one who climbs straight runs;
  a dive met head on is broken off, not abandoned; the circle has no attack;
  the pilot who never looks back loses sight), a recorded fight with no eyes
  (a hunter dead astern is never seen), the useful ranges, the coach's
  lines, and the target. `test_dogfight_steps.py` lets the drill off its
  "every lesson names a best move", as it does *Against the ace*.

## The BF1918 arena (step 4, 2026-11-10)

The school pairs a battle's fighters by the model catalogue's `sides`
(`bf42/roster.py`), which names a template's nation and calls it Axis or
Allied the WWII way: Italy is an Axis nation, so BF1918's Italian-front
Nieuport 11 is "Axis", the SPAD VII comes out German and Italian, and the
Camel has no faction at all. Nothing paired, so the BF1918 school fell back
to vanilla's arenas. What a WWI level really fields is in its object
spawners, each naming its template for each team.

- **`extract_dogfight_arenas.py`** writes `<maps tree>/dogfight-arenas.json`,
  each level's aircraft by team from its `scene.json` `objectSpawns`, in the
  catalogue's spelling; seconds a tree. It is a mod-pipeline step
  (`dogfight_arenas`, after `levels`), so every later run and publish carries
  it. On BF1918: 38 levels with aircraft on both teams, 21 arenas once paired
  by fighter sets.
- **`dogfight-arena.js` `arenasFromTeams`** builds the arenas from it (team 1
  flies as the construct's team 1), and the school page prefers it where the
  tree has one (`dogfight-school-page.js` `arenasOf`).
- **`FIGHTERS`** knows the WWI scouts, ranked by the flight law
  (`spad`, `fokker`, `sopwith`, `albatross`, `neuport`, `aircodh2`,
  `halberstadt`, `eindekker`, `morane`, `d7a`, `se5`), and the two-seaters,
  bombers, airships and balloons are checked first (`NOT_FIGHTERS`), so the
  Albatros C.III is not taken for the Albatros scout.
- Among the 21: Montfaucon (the Camel against the red triplane), Battle of
  the Vosges and Nebelberg (SPAD against triplane), Château-Thierry (SE5
  against D.VII), Brusilov Offensive (Nieuport against Albatros), Basra (DH.2
  against Halberstadt), and the Fokker Scourge level.
- Checked in headless Chrome with BF1918's trees: the school opens on
  Montfaucon, "Sopwith v Fokker Red", the planes drawn from the mod's own
  models. Not yet live: the index is in the local tree and goes with the
  BF1918 import's next publish, and the live `mods.json` still counts no
  BF1918 levels, so the live school does not offer the mod yet. FLY IT into
  a BF1918 arena was not flown.
- Tests: `test_dogfight_arena.py` (a WWI index paired, the two-seaters no
  fighters, the index script on a small tree), `test_mod_pipeline.py` (the
  step table).

## The falling leaf (step 5, rule 4)

Lesson *The falling leaf* (`falling-leaf`): the ace (`PLANS.leafAce`), with
an enemy settled on their tail inside 300 m for 2.5 s, chops the throttle and
spirals away at 110 degrees of bank, as a hit plane falls; 170 m down they
pull out, under the follower's wings, and come back up. Two fights:

| | Nine starts |
|---|---|
| *You take it for a kill* (`leafFooled`: sure of the kill, flies on, never looks down) | gone every time: 1.2 to 1.4 km apart at the end, in sight 10 to 20% of the time after the fall, 0 to 4 rounds landed, nearly all in its first second |
| *You follow them down* (`leafFollow`: above and behind through the fall, throttle back, in as they pull out) | with them every time: 80 to 320 m at the end, in sight 80 to 100%, 1 to 10 rounds landed after the fall; in 3 of 9 their pull-out meets you nose to nose and they land 2 to 5 |

What the flying found: the ruse is an escape, not a trap. The fooled pilot
is never bounced afterwards: they fly on at full speed and the ace, 250 m
below, cannot catch them. Which is what the WWI record says of it, and why
Boelcke's second version tells the follower to go down after a damaged
enemy rather than to watch his back. Rule 4's Rules row now opens this
lesson on *You follow them down*. Held by
`test_dogfight_doctrine.py` `test_the_falling_leaf_gets_away_...` from the
nine starts; the steps and fly-moves tests let it off the Dip, Flip and
Ninja, since in it you are the attacker, not the pilot in trouble.

## More than two planes (step 6, rule 8)

`viewer/dogfight-fight.js` `runFight` flies any number of the school's
pilots in teams, on the duel's airframes, hands and rounds: each pilot
fights one enemy at a time (his plan's choice, else the nearest, kept until
another is a third nearer), sees each enemy through eyes of his own, and is
handed the whole fight (`c.team`) for the plans that work as a pair. Every
round is flown against every plane; a plane down leaves the fight. The
theatre flies a demo with `extra` planes through it and draws every plane
(the extra ones with a tag, trail and gun line, in their team's colour;
the meters and captions stay the two pilots').

Lesson *The pair: your wingman* (`the-pair`, watch only: the live fight puts
one plane up each side), a hunter 350 m behind you, from the nine starts:

| Fight | Nine starts |
|---|---|
| Alone, flying straight | shot down every time, 16 to 30 s in |
| Alone, turning hard | alive every time, nobody wins: 3 rounds on you in all, 8 of yours on them |
| Your wingman covers you (`PLANS.wingman`: off your beam, onto any enemy closing on your tail) | never hit, every time; the hunter turns on your wingman and lands 0 to 2 |
| Two abreast: the Thach weave, tried (`PLANS.weaver`) | from these starts the pair is never hit and the hunter takes 0 to 7 (11 in all); with the hunter's start moved instead of yours the pair took 3 to 4 a fight as well: it trades shots between equals |

The wingman is the strongest single result the school has: the same pilot,
flying straight, goes from shot down nine times in nine to never hit. The
weave was invented against a better turner (the Zero against the Wildcat);
between equal airframes, on this law, it is a coin the geometry tosses.
Rule 8's Rules row opens the wingman's fight. Held by
`test_dogfight_doctrine.py` `test_a_wingman_keeps_the_hunter_off_your_tail`.

## The two-seater (step 7, rule 5)

A two-seater's rear gunner is a turret in `runFight` (`side.gunner`,
`GUNNER`): BF1918's arc (70 degrees either side of astern, 5 below the tail
line to 40 above), 400 m, 0.8 s to react, a degree of wander. Lesson
*Two-seaters: from beneath the tail* (`two-seater`, watch only), a
two-seater flying straight at 50 m/s, from the nine starts:

| Fight | Nine starts |
|---|---|
| From behind, level (`chaser`) | you are shot down in 7, the two-seater in 6: a trade |
| From beneath the tail (`PLANS.underTail`: close on a point 90 m under the tail and 160 m behind, pull up into them, fire, drop back) | never shot down, hit in 3 of 9 (once 6 rounds, when the climb carried you into the arc), 2 to 6 rounds landed every time, shots on the way in taken |

Mannock's rule holds on BF1918's own gunner arcs. Not modelled: a gunner
who can be killed before the pilot (Richthofen's rule), since a plane here
has one pool of hit points; and the two-seater does not manoeuvre.
Held by `test_a_two_seater_is_attacked_from_beneath_its_tail`.

## The lessons on other airframes

The school's lessons were tuned and measured on one airframe, El Alamein's
Spitfire built in the test harness, and every count on the tabs ("EXTENSION
9/9") is that Spitfire's. The theatre flies a lesson's fights on the arena's
best fighter, so on Kursk (the Bf 109) or a BF1918 arena the fight on stage
was one airframe and the count beside it another's. Every lesson's moves,
flown from the nine starts on other airframes (`movesOn`; the guns stay the
school's, so only the flight law differs):

| Move | school Spitfire | Spitfire | Bf 109 | Yak 9 | Mustang | Corsair | Zero | FHSW Bf 109-F | `Sopwith` | `Albatross` | `Spad7` | `Fokker` | `neuport11` | `AircoDH2` | `eindekker` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| boom-and-zoom / dip | 9 | 9 | 5 | 9 | 9 | 7 | 9 | 0 | 9 | 6 | 9 | 9 | 0 | 6 | 1 |
| under-the-height / dip | 9 | 9 | 7 | 7 | 9 | 9 | 9 | 8 | 0 | 8 | 5 | 7 | 9 | 1 | 6 |
| under-the-height / flip | 6 | 7 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| under-the-height / ninja | 1 | 2 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| up-and-over / dip | 7 | 7 | 9 | 6 | 5 | 7 | 7 | 8 | 3 | 6 | 6 | 6 | 7 | 8 | 2 |
| up-and-over / ninja | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 |
| out-of-the-lock / dip | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 1 | 0 | 9 | 0 | 0 | 3 | 0 | 0 |
| out-of-the-lock / flip | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| on-his-tail / dip | 6 | 6 | 2 | 5 | 1 | 1 | 0 | 9 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |
| on-his-tail / ninja | 3 | 3 | 3 | 1 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 1 | 0 | 0 |
| break-turn / dip | 9 | 9 | 9 | 7 | 9 | 8 | 9 | 6 | 9 | 3 | 5 | 8 | 7 | 9 | 5 |
| scissors / dip | 6 | 6 | 1 | 5 | 6 | 6 | 6 | 6 | 6 | 5 | 4 | 5 | 6 | 7 | 7 |
| turnarounds / dip | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| turnarounds / ninja | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| the-circle / dip | 7 | 7 | 9 | 2 | 9 | 9 | 9 | 9 | 8 | 9 | 9 | 5 | 5 | 0 | 0 |
| **Lessons survivable (a move 7+) / partly (3+)** | 7 / 9 | 7 / 9 | 6 / 8 | 5 / 8 | 6 / 8 | 7 / 8 | 7 / 8 | 5 / 7 | 4 / 7 | 4 / 9 | 3 / 7 | 4 / 7 | 4 / 7 | 4 / 5 | 2 / 4 |

The moves that score 0 everywhere (every Reversal but two, most Bounces, the
circle's tries) are left out.

- **The Extension carries; the Reversal and the Bounce do not.** Leaving a
  fight works on almost every airframe. Turning the tables and taking the
  upper hand were tuned on the Spitfire: *When they have the height*'s
  Reversal is 6 or 7 of 9 on the Spitfire and 0 to 2 anywhere else; *Up and
  over*'s and the turnarounds' Bounce, 6 of 9 on the Spitfire, are 0 on
  every other WWII airframe. The upper hand in the school is a Spitfire
  result, not a lesson about the game.
- **The WWI scouts fare worst**, 2 to 4 lessons of 9 fully survivable: the
  plans' speeds and thresholds (starts at 60 to 92 m/s, `IN_CONTROL` 35 m/s,
  the 900 m of an extension) are a WWII fighter's, and the `Albatross` pays
  for the hand's see-saw on top (above).
- **Fixed:** the theatre now flies each lesson's moves on the airframe on
  stage when the lesson opens (`dogfight-measure.js` `movesOn`, moved from
  `tests/dogfight_dfn_measure.mjs`, which re-exports it; about half a second
  a lesson, yielding between flights) and shows that count on the tabs, the
  move card, the end card and the best-move badge, saying the Spitfire's
  count beside it where they differ. Checked in headless Chrome on Kursk:
  boom and zoom's Extension tab went from 9/9 to 5/9 once flown on the Bf 109.
  The words of each move (what goes wrong) are still the Spitfire's.
  `test_dogfight_doctrine.py` holds `movesOn` on the school's Spitfire to
  every declared count.
- **What it means for doctrine:** the school's evidence for rules 1 and 6
  (height first, meet the dive) holds across airframes in the recordings,
  where every player flies their own plane. Its evidence for holding the
  upper hand (the Bounce) does not: per-airframe plans, or lessons re-tuned
  per era, are the work that would make a WWI or a Yak 9 Bounce honest.

## What the recordings say

`node tools/bf1942-models/dogfight_doctrine_report.mjs <fights> --suns
features/dogfight-doctrine/suns.json`, the 303 fights published on
2026-11-08 (290 vanilla). Every finding held with Chief-H.E.M.P's 53 fights
left out (the pilot in the most fights, see `dogfight-recordings`).

| Rule | Measure | Kept | Broken |
|---|---|---|---|
| 1 Advantage | attacks begun with 50 m of energy or unseen, against the rest | won 33%, lost 5% (245) | won 17%, lost 9% (251); from 100 m below: 9% and 18% (45) |
| 1 The sun | the attacker within 20 degrees of the sun as the target sees him | landed a shot 70%, won 35% (20) | elsewhere: landed 52%, won 23% (387) |
| 2 Carry it through | attacks that landed a shot, against those turned away from unspoiled | won 39%, lost 3% (261) | won 7%, lost 9% (69) |
| 3 Close range | hits per 100 rounds by range as they left | 25.5 inside 100 m, 23.3 to 200, 19.8 to 300 | 13.3 to 400, 1.0 to 700, 0 beyond |
| 4 Sight | the share of the fight each had the other in sight | winners 95% | losers 82% (105 fights with a kill) |
| 5 From behind | the first burst within 45 degrees of their tail / 45 to 90 / their front half | won 36%, lost 3% (107) / 41%, 2% (120) | 18%, 7% (154) |
| 6 Meet the dive | dived on from 100 m above: met / ran | lost 28% of those fights, 5.4 hits taken (29) | lost 62%, 11.2 hits taken (21) |

**Rule 8, the company** (the detector's rule 9, `dogfight-detect.js`
`companyOf`, version 3): the other aircraft within 1.5 km of a fight, by
side, and third pilots whose aimed rounds went at either of the two.
Measured on the 32 recordings cached here, re-extracted with it (200
fights, 400 pilots; `extract_dogfights.mjs <recordings> --out <dir>`, then
the report); the published fights carry it once the refresh job runs the
new detector.

| A pilot's company | Pilots | Won | Lost | Shot down by a third |
|---|---|---|---|---|
| Alone | 32 | 28% | 28% | 3% |
| More friends than enemies near | 161 | 26% | 7% | 1% |
| Even, someone near | 46 | 11% | 11% | 7% |
| More enemies than friends near | 161 | 7% | 26% | 11% |
| A third pilot shot at you (two on one) | 67 | 1% | 15% | 27% |
| A friend shot at your opponent too | 67 | 15% | 1% | 3% |

The group pays, by the widest margin of any rule: outnumbered, a pilot
lost almost four times as often as they won; with friends near, the
reverse. Two on one is the worst place in BF1942's skies: 42% of the pilots
it happened to went down, 27% to the third pilot. Boelcke's "avoid two on
one" was about the waste (two on one target while another goes free); from
the ganging side it shows as a win (15% won, 1% lost), so the waste is not
visible in this data.

What it adds to the proposal:

- **Rules 1, 3, 4, 5 and 6 pay in real players' fights**, by margins the
  sample carries. Rule 5 is really "not from their front half": the beam
  does as well as dead astern.
- **The sun looks like it pays, on 20 attacks.** The school's eyes do not
  model it, so whatever the sun did, it did to the humans. Twenty is too few
  to build the glare cone on (step 8): it waits for more recordings.
- **Rule 8 is the largest effect in the data**, and the school still flies
  one plane a side: the multi-plane duel (step 6) is the most valuable
  thing left to build.
- **Rule 2's abandoned attacks are not the losing ones**: 7% won, 9% lost,
  about the base rate. The spoiled ones are (lost 20%), which is rule 6 seen
  from the other side.

## The answer, short

- **Six of the eight rules are rewarded by the engine, and the school already
  proves four of them** without naming Boelcke: height before the attack
  (boom and zoom, the recordings' energy table), turning to meet a diving
  attacker (*You meet the dive*, never hit), attacking from behind and unseen
  (the eyes model, *Arrive slow*), and leaving rather than circling (the
  extension). A Boelcke layer is mostly words, measures and one drill over
  work that exists.
- **"Fire only at close range" is the mods' damage law, not advice.** BF1918's
  machine-gun round does full damage to 100 m and 30% from 150 m (IMP-6 over
  its `AirMGProjectile`); FHSW's rifle-calibre guns fall linearly from the
  muzzle to 10% at 510 m. Vanilla has no falloff, but its wing guns' streams
  part past the target's wingtips beyond 268 m (the school's own finding).
- **Sight is purely visual in this engine.** An enemy-crewed plane is never on
  the minimap (MMAP-3), an enemy's name tag shows only while you aim at them
  inside 300 m (HUD-17), and fog closes at the view distance (FOG-4). "Never
  lose sight" is as true here as in 1916.
- **Two rules the engine does not reward as written.** The sun (rule 1's
  second half) is a lens-flare sprite here; nothing in the engine or in the
  school's eyes hides a plane in it. Rule 7 (the line of retreat) needs a
  real level with airfields and AA; the school's construct has neither.
- **Rule 8 (fight in fours or sixes, never two on one) is the big gap.** The
  school flies one seat a side. Twelve per cent of the recorded fights (35 of
  303) ended with a third party taking the kill, 27 of them another aircraft:
  the team is real in BF1942, and the school cannot show it yet.
- **The WWI airframes fly the same law as the Spitfire.** Measured on the
  extracted BF1918 tree (templates by BF1918's names): the `Sopwith` and the
  `AircoDH2` out-turn everything (45 and 52 deg/s sustained), the `neuport11`
  out-runs and out-zooms everything, the two-seaters are slow and roll at a third of a fighter's rate. Speed still
  buys turn rate; there is still no corner speed.
- **Found on the way:** 8 of BF1918's 61 aircraft, Boelcke's own Eindecker
  among them, fly a fallback table in the viewer, because their cons write
  `engine` and `wing` in lowercase and `aircraft.js` matches the class word
  exactly (the engine reads it case-blind, LOAD-19). Left for the BF1918
  import ("Found on the way", below).

## The rules, and what the engine does with each

The eight dicta, in plain words. Oswald Boelcke wrote them in 1916 for
Colonel Hermann von der Lieth-Thomsen, chief of the German field aviation,
and they went out through the air service, about two years before the
French and British issued guides of their own. The English wording that
circulates (Wikipedia's, below) is cited to Johannes Werner's 1932
biography of Boelcke, translated as *Knight of Germany*. Wikipedia dates the
writing two ways: June 1916 in its lead, and in its body during his staff
work after he was withdrawn from combat on 27 June 1916, for the
reorganisation of early October 1916 [1], [4].

The versions differ ([1], [2], [3]):

- A second version (Head 2016, pp. 97-98) is still eight rules but drops
  "carry through an attack" and "the line of retreat", merges climbing, the
  sun and the attack from behind into one, and adds: attack while the enemy
  is busy (observing, photographing, bombing); foolish bravery is fatal; the
  Jasta fights as a unit on its leader's signals; follow a damaged enemy down
  to be sure they are not faking.
- Historic Wings' German-and-English text gives rule 4 as attacking from
  where the opponent cannot see you, and rule 8 as groups of four *to* six.
- No version has a ninth rule. The surviving texts mention squadrons, which
  did not exist when Boelcke first wrote, so the text was edited after him.

Rule by rule, Wikipedia's first version (the short quotes are its wording):

| # | The rule | In plain words |
|---|---|---|
| 1 | "Try to secure advantages before attacking" | Height, speed, numbers or surprise first; attack out of the sun |
| 2 | "Always carry through an attack when you have started it" | Do not break off halfway |
| 3 | "Fire only at close range" | Hold fire until close, with the target properly in the sights |
| 4 | "Always keep your eye on your opponent" | Never lose sight of them; do not fall for feints or faked hits |
| 5 | Assail the enemy "from behind" | Every attack comes in from the rear |
| 6 | If your opponent dives on you, "do not try to evade" | Turn into a diving attacker and meet them |
| 7 | "Never forget your own line of retreat" | Over the other side's ground, always know the way home |
| 8 | "Attack on principle in groups of four or six" | Fight as a group; once it breaks into single fights, never two on one target |

Each rule below has four parts:

- **Then:** what Boelcke meant, in his war.
- **Here:** whether the flight law and the mods' data reward it, with the
  evidence.
- **Measure:** what the school's detectors already see in a flight (a
  school duel, the live fight, or a player's recording), and what is missing.
- **Teach:** a briefing card, a coach cue, a course drill and a scored duel
  condition, where each fits.

The detectors meant are: `dogfight-detect.js` (fights in a recording: planes,
pairs, aimed rounds with their miss distance and range, hits, the kill, why
the fight ended), `dogfight-manoeuvres.js` (the manoeuvre names and what each
did), `dogfight-deadlock.js` (the turning fight nobody wins), `dogfight-pilot.js`
`geometry` / `situation` (range, angle off the nose, aspect, closure, energy,
who is behind whom) and `perceive` (what a pilot can see), and the duel's
per-tick `o` (a landing shot) and `z` (the kill zone).

### 1. Get the advantage before you attack; keep the sun behind you

- **Then:** height, speed and surprise before committing; the sun to hide
  the approach.
- **Here, height and surprise: yes.** The school measured it before anyone
  named Boelcke. The boom-and-zoom ace has 5.7 to 6.7 s of kill shot on a
  pilot who does not meet the dive (`features/dogfight-school`, "Where the
  kill shots are"). In the players' own fights, the same manoeuvre wins with
  energy and loses without it: the low yo-yo won 49% and lost 6% from more
  energy, won 15% and lost 31% from less (`features/dogfight-recordings`,
  "Energy going in"). The advantage is bounded: the wings make no lift at
  1000 m (`airDensityZeroAtHeight`, flight-model §2d), and a vertical zoom
  from top speed buys 150 to 240 m before 20 m/s on every prop fighter
  measured (table below).
- **Here, the sun: no.** The level's sun is a direction and a lens flare
  (LOAD-28..LOAD-31, `level-flare.js`); nothing in the engine makes a plane
  harder to see against it, and the school's eyes (`reviews/eyes.md`) do not
  model it ("no Hun in the sun"). Against a human the flare and a bright sky
  may still hide a small plane; nobody has measured it.
- **Measure:** `geometry` gives the energy lead (`energy`, energy height) and
  `above`; `perceive` gives whether the target sees you (`sees`). The sun
  angle is computable (the level's `sunDirection` against the line from the
  target to the attacker) but nothing computes it. Missing: an "attack
  start" event to judge it at (see rule 2).
- **Teach:** a card *Advantage first* (height, speed, unseen; the bound at
  1000 m). Coach cue before a pass: "No advantage: do not go in. Climb on the
  side away from them" when the energy lead is under 50 m and they see you.
  Scored condition: **the attack began with an advantage** (50 m of energy, or
  unseen). The sun stays in the words as history, and becomes a measure only
  if the recordings show sun attacks pay (build plan, step 8).

### 2. Once you start an attack, carry it through

- **Then:** a half-made attack gives away your height and your position for
  nothing; commit or do not start.
- **Here: yes, read as "commit or do not start".** The school's own finding
  is that the upper hand is the first pass and is spent by the pass: about
  120 m of energy height, about 8 s to win back, and an ace who sees you climb
  turns onto you inside 5 ("What the nine lessons show"). A pass broken off
  halfway pays that cost and lands nothing.
- **Measure:** the pieces exist: the `INTENTS` table says when a school pilot
  is going for the shot; the recordings' manoeuvres name a boom and zoom and a
  dive; the aimed-round evidence says who fired. Missing: an **attack** as an
  event with a start (the nose comes on and the range closes inside 700 m,
  or the dive begins) and an end (a burst, a hit, or turning away), and so
  the share of attacks a pilot abandons before firing range without being
  threatened.
- **Teach:** coach cue in a dive: "You are committed: hold it to 150 m, fire,
  then zoom". Scored condition: **every attack begun is finished** (a burst
  within 6 s of starting, or none started). Teach the pairing with Malan's
  "Go in quickly, punch hard, get out" so it does not read as "keep turning
  with them".

### 3. Fire only at close range, and only with the target in your sights

- **Then:** the guns of 1916 were few, synchronised and slow; a long burst
  wasted the drum and warned the target.
- **Here: yes, and in two mods it is the damage law.** Every projectile's
  damage falls from `distToStartLoseDamage` to `minDamage x full` at
  `distToMinDamage` (IMP-6, verified):

  | Gun | Full to | Floor | So at 150 m / 300 m |
  |---|---|---|---|
  | BF1918 `AirMGProjectile` (every fighter and gunner) | 100 m | 30% from 150 m | 30% / 30% |
  | FHSW 7.92 mm (Bf 109-F, G-2) | 1 m | 10% at 510 m | 74% / 47% |
  | FHSW 13 mm (Bf 109-G) | 1 m | 10% at 900 m | 85% / 70% |
  | FHSW 20 / 30 mm cannon | 1 m | 0.1% at 1000 / 1500 m | 85% / 70% (20 mm) |
  | Vanilla Spitfire, Bf 109 | no falloff | | but the two wing guns' streams part past the wingtips beyond 268 m |

  Ammunition is finite in the air (`numOfMag 1`): BF1918's `eindekker` and
  `Spad7` carry 500 rounds (62 s and 50 s of fire), the `Sopwith` and the
  `Fokker` 1000 (125 s); vanilla's Spitfire 900 at 12 a second (75 s); FHSW's
  Bf 109-G10's 30 mm 67 rounds (under 7 s).
- **Measure: mostly there.** Every aimed round in a recording already carries
  its `range` and `miss` (`roundMiss`); the duel records `o` (the shot that
  lands) and the gunsight cameras show the dot in the ring. Missing: the
  numbers a pilot would want: rounds fired per hit, the share fired beyond
  the gun's useful range (per mod, from the projectile's falloff), and the
  range of each hit.
- **Teach:** card *Close, then closer* with the table's row for the plane you
  fly. Coach cue: "Hold fire: 240 m. Full damage inside 100 m" (BF1918) in
  place of today's fixed `gunRange`. A **gunnery drill**: a target flying a
  course of turns and jinks, scored on hits per round and on rounds fired
  outside the useful range. Scored condition: **under a fifth of rounds fired
  outside the useful range**.

### 4. Keep your eye on the enemy; do not be fooled by tricks

- **Then:** a lost enemy comes back on your tail; a "victim" falling away
  may be faking. The second version adds "follow a damaged enemy down to be
  sure" [1]; Mannock's rules add checking above for decoys before attacking
  [1].
- **Here: yes.** The engine gives a pilot only their eyes: no enemy plane on
  the minimap (MMAP-3: an enemy-crewed hull clears the draw), an enemy name
  tag only while aimed at inside 300 m (HUD-16, HUD-17), fog by the view
  distance (FOG-4). The school's eyes already make losing sight decide
  fights: once a pilot has seen you, you are an equal again ("What the eyes
  give you is a bounce he never saw").
- **Measure:** for the school's pilots, `perceive` gives `sees`, `lost` and
  `unseen` every tick, and the theatre says LOST SIGHT OF HIM. For the
  player in the live fight, the mark already decides on screen or off it
  (`renderInset`, the edge arrow): the share of time the opponent is on the
  screen is a measure nobody keeps. For a recording, only where each plane
  points is known, not where the player looked. The trick (a feigned spin or
  a dive away that is not a death) is detectable afterwards: a spiral dive
  with the throttle chopped, the attacker breaking off, and the "victim"
  alive and turning 10 s later.
- **Teach:** coach cue when the opponent has been off the screen for 2 s:
  "Find them: look back into your last turn". A lesson **The falling leaf**:
  the ace, hit, drops into a spiral with the throttle shut; the pilot who
  follows his own tail home, or looks away, is bounced from below as the ace
  recovers. Scored condition: **the opponent kept on screen (or on the sphere
  with the free look) 80% of the fight**.

### 5. Attack from behind

- **Then:** the one place a single-seater's pilot cannot see and cannot
  shoot.
- **Here: yes, for single-seaters.** The cockpit hides a 20 degree cone
  astern and the sky under the wings; rear glances last 1 s every 2.5 s and
  stop above 4 g (`EYES`). The school's attack that works is the one from
  behind and slow: *Arrive slow* lands 110 hits and five kills against the
  usual break, where the eager chaser lands 11 ("On their tail"). The
  two-seaters change it: BF1918's `AlbatrossC3`, `AircoDH4_Brit` and
  `Breguet14` carry a rear gun on the mouse (`c_PIMouseLook`): the
  `AlbatrossC3`'s 70 degrees either side with 45 degrees of elevation travel
  (-40 to +5), the other two turning all the way round (-40 to +5 and -30 to
  +15). From behind is where that gun points; which way its asymmetric
  elevation runs (can it fire down past its own tail?) is not checked.
- **Measure:** `geometry` gives the `aspect` (0 is dead astern) at every tick,
  so the aspect at the first burst of every attack is a number the
  recordings can give today. Missing: the attack event (rule 2), and for a
  two-seater the gunner's arc as a cone the school can test a position
  against.
- **Teach:** card *From behind*. Coach cue on the approach: "Swing round to
  their tail before you close: you are coming in from the side" when the
  aspect is over 60 degrees inside 700 m. Scored condition: **the first burst
  of each attack from within 45 degrees of their tail**. For a two-seater
  (BF1918), Mannock's form of the rule: from beneath the tail, out of the
  gunner's arc, once the arc's sign is read [1]. Richthofen's: kill the
  gunner first [5], [6].

### 6. If they dive on you, do not run: turn and meet them

- **Then:** turning into a diving attacker spoils their shot and passes them;
  running gives them the easy shot from astern.
- **Here: yes, the school's strongest result.** *You meet the dive*: three
  dives, each broken off head on at 350 m, no hits. *When they have the
  height*: climbing straight is shot down 9 of 9; climbing between their
  dives and breaking only when they commit inside 380 m is never hit and
  ends 300 m of energy ahead. In the recordings, a split-S when chased (the
  run) has the chaser's guns on the runner in 83% (6 fights).
- **Measure: all there.** The boom and zoom, the head-on pass and the break
  turn are named manoeuvres; the dive and its target are known.
- **Teach:** it is already taught, as boom and zoom's counter. A Boelcke card
  names it *Turn into the dive* and points at those two lessons.

### 7. Over the enemy's ground, always know your way home

- **Then:** a pilot who chased too far over the other side's ground came
  down behind their lines. Richthofen's 1918 manual says the same in its own
  words: do not stay stubbornly with an opponent you cannot shoot down, since
  a long fight deep over enemy lines leaves you alone and outnumbered [5].
- **Here: partly, and not in the school's arena.** BF1942 has no wind and no
  fuel, but it has homes: your airfield's supply depot repairs and rearms
  (SUP rows, `subsystems/supply-depots.md`), your side's AA covers it, and
  the combat area burns a plane outside it after 10 s at 5 HP a second
  (CA-2, CA-7). Five of the 35 fights ended by a third party were ended by guns on the ground or a ship (a Browning, AA, a Type 88, an
  Elco). The school's construct over the Range floor has no airfields, no
  AA and a 10 km box.
- **Measure:** nothing today. The recording has every control point, airfield
  and AA position; the distance home and whether a fight drifted over enemy
  AA are computable.
- **Teach:** only on a real level: a card, and a coach cue when a damaged or
  empty-gunned plane is farther from home than from the enemy's AA. Low in
  the plan.

### 8. Fight in groups of four or six; never two on the same enemy

- **Then:** Boelcke's own Jasta 2 flew as a team: one picks a target, the
  others cover them, nobody crowds onto one enemy while another goes free.
- **Here: yes, and the school cannot show it.** One seat a side. In the
  recordings 35 of 303 fights (12%) ended with someone else taking the kill:
  27 of them another aircraft (a Mustang 8 times, a Bf 109 and a Yak 9 5
  each). That is the third man the pair never saw.
- **Measure:** the detector pairs planes; it does not see a group. Every
  plane is in the recording, so a fight's **company** (friendly and enemy
  fighters within 1.5 km) and a **two on one** (two shooters' aimed rounds at
  the same target inside 5 s) are computable from what `findDogfights`
  already reads.
- **Teach:** needs a duel of more than two planes (`runDuel` is two). Then a
  lesson **The pair** (the leader attacks, the wingman covers the leader's
  tail against a second enemy) and the Thach weave, which the school researched
  and left out for exactly this reason (`dogfight-school` "Open").

## What else WWI added

- **Richthofen**, Boelcke's pupil in Jasta 2, wrote an *Air Combat
  Operations Manual* (*Meine Erfahrungen im Luftkampf*) while recovering from
  his head wound; a copy reached Supreme Headquarters on 19 April 1918, and
  it was distributed days after his death [5], [30]. What it adds to
  Boelcke, as Daso summarises it: shoot before you are seen; keep speed and
  power up in a hard fight; against a two-seater kill the gunner first; never
  overshoot; never stay with an opponent you cannot shoot down, deep over
  their lines [5]. His basic rule elsewhere is to aim for the man, not the
  machine, and he usually dived from above with the sun behind him while his
  Jasta covered his rear [6]. His 1917 book (censored, later disowned) puts
  the fight on getting to the enemy's rear, since his guns fired forward only,
  and says the aggressive spirit decides, not trick flying [7].
- **Mannock** (RFC/RAF, flight commander from June 1917) gave his pilots
  fifteen rules [1]: hold fire until within 100 yards; come out of the sun and
  the cloud; attack scouts from above and two-seaters from beneath their
  tails; keep turning in a dogfight; never dive away, which hands the enemy a
  shot with no deflection; check above for decoys first. The often quoted
  "always above; seldom on the same level; never underneath" is attributed to
  him, but not found in a primary source [27].
- **The British General Staff's *Fighting in the Air*** (April 1918): the
  offensive spirit, surprise and manoeuvre, formation flying and the guns
  [28].

For the school, three of these are new measures: **no overshoot** (the
recordings already name an overshoot: 0% own shot after it, the man in
front gets one in 40%), **leave a fight you cannot win** (the school's
extension, already its best answer between equals), and **the gunner first**
against a two-seater (step 7 of the plan). Mannock's "never dive away" is
rule 6 again, and the school holds it.

## The airframes, measured

Each flown under node on the viewer's flight law (`viewer/aircraft.js`), from
its extracted glb, with the school's own hands (`pointNose`, `hardTurn`):
top level speed after 120 s at full throttle; the best sustained climb over
10 to 25 s; the hardest sustained turn from 85% of top speed, over 10 to
25 s; straight up from top speed, the height gained before 20 m/s; a 45
degree dive at full throttle for 10 s; the best roll rate in 0.7 s. The
scratch harness is the school's (`tests/dogfight_school_harness.mjs`) pointed
at a glb instead of its built Spitfire.

| Aircraft | Mod | Top, m/s | Climb, m/s (at m/s) | Turn, deg/s (s a circle, radius m) | Zoom to 20 m/s | Dive 45, m/s | Roll, deg/s |
|---|---|---|---|---|---|---|---|
| Spitfire | vanilla | 76.4 | 13.8 (45) | 33.1 (10.9, 83) | 166 m | 115 | 123 |
| Bf 109 | vanilla | 75.7 | 14.1 (47) | 39.1 (9.2, 88) | 179 m | 113 | 118 |
| `eindekker` (and `MoraneG`, identical) | BF1918 | 76.2 | 18.8 (43) | 31.9 (11.3, 69) | 239 m | 119 | 195 |
| `neuport11` | BF1918 | 84.3 | 16.0 (36) | 37.1 (9.7, 101) | 243 m | 124 | 136 |
| `AircoDH2` | BF1918 | 72.4 | 14.2 (47) | 51.8 (6.9, 66) | 184 m | 118 | 149 |
| `Sopwith` | BF1918 | 66.1 | 10.2 (33) | 44.8 (8.0, 74) | 146 m | 118 | 129 |
| `Spad7` | BF1918 | 76.4 | 13.0 (43) | 38.9 (9.3, 72) | 183 m | 123 | 109 |
| `Fokker` | BF1918 | 68.3 | 12.8 (43) | 36.2 (10.0, 79) | 163 m | 118 | 91 |
| `Albatross` | BF1918 | 93.8 | 24.8 (57) | 17.5 (20.5, 181) *; 40 at a held 70 degrees of bank | 316 m | 114 | 177 |
| `Halberstadt` | BF1918 | 71.3 | 12.3 (41) | 31.0 (11.6, 97) | 170 m | 121 | 91 |
| `se5` ** | BF1918 | 41.5 | 7.3 (29) | 36.0 (10.0, 63) | 42 m | 35 | 29 |
| `d7A` ** | BF1918 | 42.3 | 7.9 (29) | 24.5 (14.7, 90) | 41 m | 41 | 42 |
| `AlbatrossC3` (two-seater) | BF1918 | 57.0 | 10.9 (37) | 30.5 (11.8, 85) | 109 m | 83 | 34 |
| `AircoDH4_Brit` (two-seater) | BF1918 | 59.5 | 11.6 (39) | 28.9 (12.4, 98) | 122 m | 98 | 34 |
| `Gotha` (bomber) | BF1918 | 48.6 | 9.6 (41) | 24.6 (14.6, 129) | 84 m | 102 | 24 |
| F-16 | DC | 111.1 | 33.4 (115) | 56.2 (6.4, 86) | never: holds 57 m/s straight up | 122 | 172 |
| MiG-29 | DC | 129.8 | 35.0 (134) | 50.1 (7.2, 113) | never: holds 64 m/s straight up | 137 | 182 |
| F-15C | DC | 112.2 | 32.2 (109) | 46.6 (7.7, 113) | never | 124 | 128 |
| Mirage | DC | 129.1 | 70.4 at 45 deg (146) | 54.8 (6.6, 121) | never | 137 | 175 |

**The jets' rows disagree with the page** (noted 2026-11-10, later the same
day). The page's own measures of Desert Combat's jets are in
[dogfight-doctrine-1991](../dogfight-doctrine-1991/README.md), "Measured on
the pair on stage": level at 300 m the F-16 makes 94 m/s, the MiG-29 102,
the F-15C 93 and the Mirage 117, against 111, 130, 112 and 129 here. Two
things can move a number flown under node. The law's box drag needs the
airframe's geometry box, and a tree built from a glb's JSON alone
(`server/glb-scene.mjs`) has none unless the collision meshes are passed:
the same published F-14B then levels at 201 m/s, and at 99 in the page. And
level speed rises with height on this law, so a top speed means little
without the height it was flown at, which this table does not give. Read
the jets' rows here as leads; the propeller rows were not re-flown.

Re-measured on the BF1918 tree as re-extracted at 10:41 on 2026-11-10, after
the class-word fix ("Found on the way"); the first pass had the Eindecker and
the SE5 on the fallback table and an older Albatros.

\* The `Albatross`'s sustained turn is the hand's, not the airframe's. Held
at a bank by `bankAndPull` it turns as the others do (40 deg/s at 70 degrees,
holding its height; 53 at 80, sinking 15 m/s), but `hardTurn` eases the bank
in proportion to the sink, and the Albatros climbs hard at 60 degrees and
sinks fast at 82, so the hand see-saws between them and averages 18. The
Spitfire's lift settles where the hand's gain expects. Every lesson flown on
the Albatros pays for it (below).

\** The SE5 and the D.VII come from another hand than the rest of BF1918's
scouts (other part names, `se5Topleft`; regulator flaps with 2 degrees of
travel against the others' 20 to 30) and carry a body drag of 0.8 and 0.5
against 0.10 to 0.14. On the law, whose body drag was checked against the
real game's Spitfire and Bf 109 within 12% (flight-model §10), that holds
them to 42 m/s level and 35 to 41 m/s in a full-throttle dive. Whether retail
BF1918 flies them that slowly is not checked: one lab flight in the real game
would say. Until it does, the school ranks them last among the scouts.

These rows compare types on one footing; they
are not the school's numbers: its Spitfire is El Alamein's own table, built
in the harness, which settles at 39 deg/s and 46 m/s in the hardest turn
where the vanilla glb's, from a faster start, holds 33. A lesson quotes the
airframe it flies, measured the school's way. The jets climb past the 1000 m lift ceiling inside
the climb's 25 s, so their climb is a floor, not a rate.

What the table says for doctrine:

- **Speed buys turn rate in every era.** A full pull's pitch rate rises with
  speed on every airframe (the `Sopwith` 23 deg/s at 40 m/s, 46 at 70; the F-16
  23 at 40, 76 at 120); there is no corner speed and no g limit. The real
  world's angles fighter against energy fighter is muted here: the turner
  is simply the plane with the better rate (the `AircoDH2`, the `Sopwith`).
- **The WWI cast has real differences to teach.** The `Albatross` and the
  `neuport11` out-run and out-zoom everything (94 and 84 m/s; 316 and 243 m
  of zoom); the `AircoDH2` out-turns everything (52 deg/s), the `neuport11` by
  15 deg/s. The `Sopwith`'s
  pilot should turn; the `neuport11`'s or the `Spad7`'s should go up and
  come down, which is Boelcke's rule 1 with numbers.
- **The jets break the energy fight.** Thrust exceeds weight at low speed
  (the thrust law peaks at zero airspeed), so a jet does not run out of speed
  going up: it settles at about 60 m/s straight up until the 1000 m ceiling.
  Height costs a jet nothing to buy and is capped at a kilometre, so rule 1's
  height turns into position and surprise, and rule 6 (meet the dive) is
  most of what is left of the vertical.

## Into WWII, and into the jets

### What replaced what

| Rule | WWII | The jets |
|---|---|---|
| 1 Advantage, the sun | Kept and sharpened: Malan's "height gives you the initiative" [8]; Galland's "see the opponent first" [27]; the AVG's dive and zoom from above, never a turning fight, with a warning net to give the P-40s time to climb [15], [16] | Kept, recast as energy: Boyd's energy-manoeuvrability (specific excess power, `Ps = V(T - D)/W`, 1966) [21]; surprise from radar and stealth. A modern F-22 pilot keeps the sun, which can blind infrared too [25] |
| 2 Carry it through | Hartmann's "see, decide, attack, break" (given as "reverse" too): attack, then disengage and reassess, never hang about [14]; Malan's "go in quickly, punch hard, get out" [8] | Qualified: breaking off can be right at missile range [25]; against surface threats "always finish the attack" may not hold [26] |
| 3 Close range | Kept: Hartmann fired from very close at a target that was not evading [14] | Weapon-dependent: take only valid shots inside the missile's envelope [25]. In Vietnam 612 AIM-7s were fired for 56 kills, 2 of them beyond visual range [24] |
| 4 Keep sight | Kept: "see first" is Galland's first rule [27] | Kept for a visual fight [25] |
| 5 From behind | Kept for guns | Outdated by all-aspect missiles [25] |
| 6 Meet the dive | Kept: Malan's "always turn and face the attack" [8] | Kept in a visual fight [25] |
| 7 Line of retreat | Kept | Kept: always have an exit [25] |
| 8 Fours or sixes | **Replaced by the pair.** Mölders and the Legion Condor in Spain made the *Rotte* (leader and wingman) the unit and two Rotten a *Schwarm*, the finger-four, flown wide (about 1,800 ft apart) with the cross-over turn [9], [10], [11]; the RAF moved from vics and line astern ("rows of idiots") to line abreast in 1941 and Johnson's wing to the finger-four in 1943 [12], [13]; Thach's beam defence (1941, first used at Midway in June 1942) turned two worse fighters into a trap for one better turner [17] | The pair stays: the USAF's fluid four (1951), the Navy's loose deuce (an engaged and a free fighter, the wingman 3/4 to 1 nm abeam) [18], [23]; Topgun (3 March 1969, after the Ault report) for teaching it [22]. Recast as committing forces in proportion to the threat [25] |

The Dicta are still in the lineage: Wikipedia, after Head (2016), says
manuals descended from them train NATO pilots at Sheppard AFB [1], and
Historic Wings calls them mostly valid [2]. The fullest modern reading found
is an F-22 demonstration pilot's, rule by rule (2010): rules 1, 4, 6 and 7
still hold, 3 and 5 are partly outdated by missiles, 2 is qualified, 8
recast [25].

### In the mods

- **Vanilla BF1942 (WWII):** every rule as above. No damage falloff, but the
  wing guns' convergence makes 270 m the practical reach. The recordings are
  vanilla's (290 of the 303 fights), so step 1's report is a WWII report.
- **FH and FHSW:** the same, with the falloff of the gun table under rule 3
  (rifle calibre to 10% at 510 m, cannon slower) and finite cannon rounds
  (a Bf 109-G10's 30 mm, under 7 s of fire). FHSW is already a school mod
  (12 arenas, El Alamein's Spitfire Ib against the Bf 109-F first), so rule
  3's drill with FHSW's falloff is one data read away.
- **BF1918 (WWI):** the period the Dicta were written for, and the mod
  where rule 3 is harshest (full damage only inside 100 m). Its two-seaters
  carry the rear gun that Mannock's and Richthofen's rules are about.
- **Desert Combat (jets):** the school had no DC arena when this was written
  (`FIGHTERS` held no jets); it has seven since 2026-11-10
  ([dogfight-school](../dogfight-school/README.md), "Desert Combat's
  arenas"), and the jets' own rules are in
  [dogfight-doctrine-1991](../dogfight-doctrine-1991/README.md). On the law the jets do not run out of speed going up (the table),
  so the energy fight becomes a fight for position under a 1000 m ceiling.
  The F-16's gun is a 30 mm round with a 3 m blast and 5 s of flight; its
  AIM-9, read from DC's own cons, flies straight and bursts within 7 m of a
  plane ("Research notes"). So the jets' rules are the gun fight's: 1
  (position, surprise), 3 (the missile is a deflection shot with a 7 m
  bubble), 4, 5, 6 and 7 carry; 8 is the pair. Teaching DC means a DC arena
  first (`FIGHTERS` and the arena builder know no jets), which is outside
  this plan.

## Build plan, ranked

Ranked by what it teaches for what it costs, and by what the steps after it
need. Every step keeps the school's method: a claim on screen is one the
flown fights or the recordings hold, from the nine starts or across the
recorded fights, with a test that fails if the words and the numbers part.
Sizes are rough: S a day or less, M a few days, L a week or more.

| # | Step | Rules | Size | Needs |
|---|---|---|---|---|
| 1 | **Doctrine measures over any fight** (built, rule 8's company with the detector's rule 9) | 1, 2, 3, 4, 5, 8 | M | nothing |
| 2 | **The Boelcke cards and the coach's cues** (built) | 1 to 6 | S | 1 |
| 3 | **The gunnery drill** (built) | 3 | M | 1 |
| 4 | **A BF1918 arena** (built; the lessons not re-tuned for WWI) | all, period-correct | M | the lowercase-class fix (done upstream) |
| 5 | **The falling leaf** (the ruse) (built) | 4 | S | 1, and 4 for the period |
| 6 | **More than two planes in a duel**, then *The pair* and the Thach weave (built: `runFight`, the lesson) | 8 | L | 1 |
| 7 | **The two-seater** (Mannock: from beneath the tail) (built) | 5 | M | 4, 6 (a gunner seat) |
| 8 | **The sun**, only if the recordings say it pays (not built: 20 attacks from the sun, too few; waits on more recordings) | 1 | S to M | 1 |
| 9 | **The way home**, on a real level (not built: the school has no level arena; in the recordings 5 of 303 fights ended by a ground gun, too few to say where) | 7 | M | a level arena |

**1. Doctrine measures over any fight** (`viewer/dogfight-doctrine.js`, pure;
a report script beside `dogfight_manoeuvres_report.mjs`). Over a fight in the
theatre's shape, flown or recorded:

- *Attacks*: start (the nose within 30 degrees of the other and closing
  inside 700 m, or a dive toward them), end (a burst, a hit, or the nose off
  for 2 s), and, at the start, the energy lead, whether the target saw the
  attacker (`perceive` run over both tracks, which the recorded fights can
  take as they take `trackState`), the aspect, and the sun angle.
- *Bursts*: rounds, range, hits, the share fired past the mod's useful range
  (read from each projectile's falloff, IMP-6; for vanilla, the convergence's
  268 m).
- *Sight*: for the school's pilots, `sees` per tick; for the live fight, the
  share of time the opponent is on the screen.
- *Company*: friendly and enemy fighters within 1.5 km, and two on one
  (two shooters' aimed rounds at one target inside 5 s), from the recording's
  other planes. Built as the detector's rule 9 (`companyOf`); an extracted
  fight carries it as `company`.

Then the report: what each rule's measure says about the 303 recorded fights
(does an attack begun with the advantage win more; does a pilot who fires
inside 150 m kill more per round; did a third man decide the fight). This is
the step that tells the owner which dicta pay in real players' fights before
anything is put on screen, and it is the data every later step quotes.
Tests: the school's own lessons, whose shapes are known (the boom-and-zoom
ace's attacks start with height and unseen; *You rush in* abandons nothing;
*Arrive slow* fires from astern).

**2. The cards and the cues.** A *Boelcke's rules* panel in the school (the
eight in plain words, each linked to the lesson that shows it: rule 6 to
*You meet the dive*, rule 5 to *Arrive slow*, and so on), per-era wording,
and five coach cues from step 1's measures (no advantage, committed, hold
fire with the mod's range, find them, swing round to the tail). The coach's
fixed `gunRange` (350) becomes the plane's own useful range. The end card
gains a line per rule kept or broken in that fight. Tests: the coach
harness's existing pattern, a cue per measure.

**3. The gunnery drill.** A ring-course cousin (`dogfight-rings.js` already
lays a path an airframe can fly): a target flying a course of turns and
jinks, nobody shooting back, the score hits per round, rounds fired past the
useful range, and the range of each hit; kept per plane like the courses'
bests. It is the one drill that teaches a rule the engine enforces in two
mods.

**4. A BF1918 arena.** `FIGHTERS` picks fighters by name and holds no WWI
names; the arena list needs them, and a BF1918 level with fighters on both
sides (the import's first run baked an air level, `toska_airbattle`; which
levels qualify is `arenasFrom`'s to say once the names are in). First the
exporter fix for the eight lowercase-class planes ("Found on the way"), so the Eindecker
flies its own data. Then the lessons flown again on a WWI pair (the table
suggests the `Sopwith` against the `Albatross` or the `Spad7`), their words
re-held from the nine starts, since the numbers will move.

**5. The falling leaf.** A lesson: the ace, hit, drops into a spiral with the
throttle shut and recovers low; the follower who looks away is bounced. One
new plan for the ace and the shape test; the eyes do the rest.

**6. More than two planes.** `runDuel` flies two pilots; a duel of four
(`runFight`) with each pilot perceiving every other through `perceive`, the
rounds tested against every airframe, and the theatre drawing N tracks. Then
*The pair* (leader and wingman against two; the wingman's job is the
leader's tail) and the Thach weave (two friendlies against one better
turner). Large, because the theatre, the duel, the measure and the live
fight (a friendly bot in the air) all assume two.

**7. The two-seater.** A BF1918 lesson against the `AlbatrossC3` or the
`AircoDH4_Brit` with its rear gun manned by a bot gunner: from astern you
are in its arc, from beneath the tail (Mannock's rule) you should not be
(once the arc's sign is read from the page). Needs a gunner who aims within the bundle's limits and the
duel's rounds from a turret, so it waits on 6's N-seat duel.

**8. The sun.** Only if step 1's report shows attacks from within 20 degrees
of the sun pay against human players. Then a glare cone in `EYES` (a pilot
does not notice a plane within some degrees of the sun) for the school's
pilots, with its source.

**9. The way home.** On a real level arena (the school's open item "a
dedicated arena map"): distances to the airfield's repair and to the
enemy's AA in the coach, and a lesson where the fight drifts over their
guns.

Not proposed: teaching the sun or the line of retreat in the Range's
construct, where neither exists; a separate "Boelcke mode" with its own
lessons, since six of the eight are already the school's lessons under other
names, and the cards point at them instead.

## Found on the way

**Fixed on main by the BF1918 import (01d932ec8, "a class word is read case
blind, as the engine reads it (LOAD-19)"), and the BF1918 tree re-extracted
at 10:41, 2026-11-10; the airframe table above is re-measured on it.** The
note as it was found:

**Eight BF1918 aircraft fly a fallback table in the viewer.** Their cons
write the class word in lowercase (`ObjectTemplate.create engine ...`,
`ObjectTemplate.create wing ...`) and the exporter keeps it as written in
`extras.templateKind`. The engine resolves a class word as a case-blind
prefix (LOAD-19, `getClassIDFromTemplateClassName` 0x081d63e0), so in the
game these are an Engine and Wings; `viewer/aircraft.js` compares
`templateKind === 'Engine'` and `=== 'Wing'`, so here they are not, and
`aircraftSpec` finding no Engine returns null and the plane flies the
built-in `CORSAIR` table (`aircraft.js` `aircraftSpec`, the constructor's
`|| CORSAIR`). The
eight: BleriotXI, BleriotXIBomb, HansaW29, MoraneG, TaubeBomb, eindekker,
se5, taube (the Eindecker and the Morane have no Wing the viewer reads at
all). The Eindecker and the SE5 measure identically, which is the
fallback's number, not theirs. Not fixed here: the fix is the exporter's (one
place, and other kinds are lowercase too: `simpleobject`, `lodobject`,
`seatobject`, `playercontrolobject` in the Eindecker), and it belongs to the
BF1918 import (`features/bf1918-extraction`). A hand-over note is in the
session group's shared notes.

## Research notes (2026-11-10)

- **The two-seaters' rear guns cannot fire below the tail.** BF1918's
  `AlbatrossC3`, `AircoDH4_Brit` and `Breguet14` rest their rear gun facing
  aft, 3, 5 and 15 degrees above the tail line (each FireArms' barrel, the
  glb's node rotations composed), and their pitch rigs travel 40, 40 and 30
  degrees up but 5, 5 and 15 down (`-min` is up, as the tank school reads a
  pitch rig). So none fires below the horizontal astern: Mannock's "attack
  two-seaters from beneath their tails" is exactly the gap in the arc.
  The Albatros C.III's gun also turns only 70 degrees either side of
  astern; the other two turn all the way round.
- **Desert Combat's missiles fly straight and burst near a plane.** Read
  from the mod's own cons (`~/.wine/.../Mods/DesertCombat` and `DC_Final`,
  `OBJECTS.rfa`): the AIM-9, AA-10, Stinger, SA-3 and Hellfire are each a
  `c_ETRocket` engine bound to `c_PIThrottle` alone and a fin, no steering
  axis; what makes them anti-air is the proximity fuse
  (`explodeNearEnemyDistance` 7 m for the AIM-9 and AA-10, 10 m for the
  Stinger, 15 m for the SA-3; `ProximityFusePrimer` 0.1 to 0.25 s) and the
  blast (`radius` 8 to 25 m). The engine's fuse (PROX-1 to PROX-6, verified)
  goes off on any aircraft heavier than the round moving over 2.5 m/s, and
  tests no team (PROX-5): a friendly plane crossing the stream sets it off.
  So in DC the air-to-air missile is a deflection shot with a 7 m bubble:
  rule 3 (close, in the sight) holds, and rule 5 is not outdated by it,
  unlike the all-aspect missiles the modern sources mean. This replaces the
  open question above.
- **The Eindecker and the Morane G fly one table**: identical to the last
  decimal. The Fokker E was built after the Morane-Saulnier; BF1918 shares
  the physics.
- **The school's `hardTurn` see-saws on a plane that climbs hard in a bank**
  (the Albatros, above). Tried on scratch copies: capping the bank's
  correction (at most 15 degrees off for the sink, 8 on for the climb) holds
  the Albatros's sustained turn at 31.8 deg/s instead of 17.5, and moves 9 of
  the Spitfire's declared counts: *When they have the height*'s Reversal
  from 6 to 1, *Up and over*'s Bounce from 6 to 0, the scissors' Extension
  from 6 to 3, the circle's from 7 to 9. Not adopted. It is the strongest
  evidence that the school's upper-hand results are tuned to one hand on one
  airframe: a change in a turning gain that a pilot would never notice
  unmakes them. Per-era lessons, re-tuned and re-held from the nine starts
  on their own airframe, are the honest fix.

## Sources

Read for this page unless marked: **[excerpt]** only a search result's text
was seen (the page refused the fetch); **[unverified]** the claim was not
found in a primary source.

1. *Dicta Boelcke*, Wikipedia (read as raw wikitext, footnotes exact):
   https://en.wikipedia.org/wiki/Dicta_Boelcke. Its sources: Johannes
   Werner, *Boelcke der Mensch, der Flieger, der Fuehrer der deutschen
   Jagdfliegerei*, K.F. Koehler, 1932 (English: *Knight of Germany*, tr.
   Claud W. Sykes; Casemate 2009, ISBN 978-1-935149-11-8), p. 209 for the
   first version; R. G. Head, *Oswald Boelcke: Germany's First Fighter Ace
   and Father of Air Combat*, Grub Street, 2016, ISBN 978-1-910690-23-9,
   pp. 59, 96-98, 101, 161, 172-174; Norman Franks, Frank W. Bailey, Russell
   Guest, *Above the Lines*, Grub Street, 1993, ISBN 0-948817-73-9; Norman
   Franks, *Sharks Among Minnows*, Grub Street, 2001, ISBN
   978-1-902304-92-2; Greg Van Wyngarden, *Early German Aces of World War I*,
   Osprey, 2006, ISBN 978-1-84176-997-4; Ira Jones, *King of Air Fighters*
   (1934; Casemate 2009, ISBN 9781932033991), pp. 191-92 for Mannock's rules.
2. *Dicta Boelcke*, Historic Wings, August 2012 (German and English):
   http://fly.historicwings.com/2012/08/dicta-boelcke/
3. *Richthofen and tactics*, History of Flight course notes, after
   Williamson Murray, *War in the Air 1914-1945* (1999):
   https://sites.google.com/view/history-of-flight-24/course-home/unit-1/richthofen-and-tactics
4. R. G. Head, *Oswald Boelcke: Germany's First Fighter Ace and Father of
   Air Combat*, Grub Street, 2016, ISBN 978-1-910690-23-9 (read through [1],
   not directly).
5. Dik A. Daso, *The Red Baron*, Air & Space Forces Magazine, 1 March 2012:
   https://www.airandspaceforces.com/article/0312baron/
6. *Manfred von Richthofen*, Wikipedia (McAllister 1982, p. 61):
   https://en.wikipedia.org/wiki/Manfred_von_Richthofen
7. Manfred von Richthofen, *Der rote Kampfflieger* (1917), tr. J. Ellis
   Barker, *The Red Battle Flyer* (1918), Project Gutenberg:
   https://www.gutenberg.org/cache/epub/41159/pg41159.txt; on its
   censorship, https://en.wikipedia.org/wiki/The_Red_Fighter_Pilot
8. *Ten Rules for Air Fighting* (Malan), Wikipedia:
   https://en.wikipedia.org/wiki/Ten_Rules_for_Air_Fighting
9. *Werner Moelders*, Wikipedia (Spick 1996, p. 15):
   https://en.wikipedia.org/wiki/Werner_M%C3%B6lders
10. *Finger-four*, Wikipedia: https://en.wikipedia.org/wiki/Finger-four
11. *Guenther Luetzow*, Wikipedia (Braatz 2005):
    https://en.wikipedia.org/wiki/G%C3%BCnther_L%C3%BCtzow
12. *Vic formation*, Wikipedia: https://en.wikipedia.org/wiki/Vic_formation
13. *Johnnie Johnson*, Wikipedia (Sarkar 2011):
    https://en.wikipedia.org/wiki/Johnnie_Johnson_(RAF_officer,_born_1915)
14. *Erich Hartmann*, Wikipedia (Spick 1988, 1996; Patton 1991):
    https://en.wikipedia.org/wiki/Erich_Hartmann
15. *Flying Tigers*, Wikipedia (Scott 1973):
    https://en.wikipedia.org/wiki/Flying_Tigers. The AVG fought mostly the
    Army's Ki-27s and Ki-43s, not Navy Zeros; "never turn with a Zero" is
    widely repeated and **[unverified]**.
16. Ronald V. Regan, *American Volunteer Group*, Aviation History, November
    2000: https://www.historynet.com/american-volunteer-group-claire-l-chennault-and-the-flying-tigers/
17. *Thach Weave*, Wikipedia: https://en.wikipedia.org/wiki/Thach_Weave;
    Thach's oral history, Naval History, March 1992 **[excerpt]**:
    https://www.usni.org/magazines/naval-history-magazine/1992/march/oral-history-butch-ohare-and-thach-weave
18. *MiG Alley*, Wikipedia: https://en.wikipedia.org/wiki/MiG_Alley; Barry
    Watts's 1977 briefing on fluid four (1951) and loose deuce (late 1950s),
    Boyd papers **[excerpt]**:
    https://www.usmcu.edu/Portals/218/HD/Digitized%20Collections/COLL_2062%20John%20Boyd/COLL%202062_John%20Boyd_Box%2013/110327-Briefing.PDF
19. *John Boyd*, Wikipedia (the Aerial Attack Study written 1960, the OODA
    loop early 1970s):
    https://en.wikipedia.org/wiki/John_Boyd_(military_strategist)
20. John Boyd, *Aerial Attack Study*, Report 50-10-6C, 11 August 1964 (the
    declassified revision):
    https://everyspec.com/USAF/USAF-General/Aerial_Attack_Study_50-10-6C_1964_Boyd_56437/
21. *Energy-maneuverability theory*, Wikipedia (Boyd, Christie, Gibson,
    APGC-TR-66-4, 1966):
    https://en.wikipedia.org/wiki/Energy%E2%80%93maneuverability_theory
22. Barrett Tillman, *Topgun turns 50*, Aviation History, March 2019:
    https://historynet.com/topgun-turns-50/
23. CNATRA P-1218, loose deuce:
    https://navyflightmanuals.tpub.com/P-1218/Background-P-12180014-14.htm
24. *AIM-7 Sparrow*, Wikipedia (Watts 2006):
    https://en.wikipedia.org/wiki/AIM-7_Sparrow
25. Maj. David Skalicky (F-22 demonstration pilot), interviewed by Michael
    Hanlon, 2010, posted 19 July 2017:
    https://roadstothegreatwar-ww1.blogspot.com/2017/07/a-raptor-pilot-on-21st-century.html
26. *The Fighter Pilot's Survival Guide*, Air & Space (Smithsonian), 21 May
    2014 **[excerpt]**:
    https://www.smithsonianmag.com/air-space-magazine/fighter-pilots-survival-guide-180951411/
27. Combat flying quotations (Galland's "see first", from *The First and the
    Last*, 1954; Mannock's "always above") **[secondary, unverified in a
    primary source]**: https://www.aviationquotations.com/combatflyingquotes.php
28. *Fighting in the Air*, General Staff, April 1918 (Naval & Military Press
    reprint, 2009, ISBN 9781847348517):
    https://www.abebooks.com/9781847348517/Fighting-Air-April-1918-General-1847348513/plp
29. Peter Kilduff, *Richthofen: Beyond the Legend of the Red Baron*, Wiley,
    1993, ISBN 978-0-471-12033-9, which prints the 1918 manual in English
    (not read).
30. Robin Schaefer, Iron Cross magazine, 31 March 2021, on the manual's
    distribution on 26 April 1918 **[excerpt]**:
    https://www.pressreader.com/uk/iron-cross/20210331/281621013123068

In the repo: `features/dogfight-school` (README, `research.md`,
`reviews/eyes.md`), `features/dogfight-recordings`,
`features/flyable-vehicles/flight-model.md` §2d and §10,
`features/bf1918-extraction`, and the ledger rows IMP-6, MMAP-3, HUD-16,
HUD-17, FOG-4, LOAD-19, LOAD-28..LOAD-31, CA-2, CA-7, SUP-1, FA-11.

Not found: a tactical rule set by Sholto Douglas; an Air & Space Power
Journal article mapping the Dicta; any 1917 edition of *Fighting in the
Air*.
