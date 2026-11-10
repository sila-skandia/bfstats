# Dogfight doctrine, 1991: the jet age's rules in the dogfight school

Status: **built** (2026-11-10). On Desert Combat the dogfight school has
arenas of its own, jets against jets, and its Rules tab holds **the jet
age's rules**: twelve rules from Blesse (1955), Boyd (1964) and the USAF's
F-16 manual (1999), each in our words with a few of its own, its source,
and what Desert Combat's own data says of it on the two jets on stage. The
card opens with the one turning fight of the Gulf War, Rodriguez's F-15C
against a MiG-29 on 19 January 1991, and a button that stages it.

The owner's brief (2026-11-10), on `dogfight.html?lesson=scissors&demo=move`
with Desert Combat picked: "it is presenting vanilla options for the planes.
I'd expect it to show me the modern fights. I'd also like to do what we've
been doing with the other mods like BF1918, where we research tank and
dogfights relevant to that theatre, e.g. modern theatre." The tanks' half is
[tank-doctrine-1991](../tank-doctrine-1991/README.md). Boelcke's rules, the
card every other tree shows, are [dogfight-doctrine](../dogfight-doctrine/README.md).
The research behind this page, with its 34 sources, is
[research.md](research.md).

## Where it is

- `dogfight.html?mod=desertcombat` opens on **Desert Shield**, F-16 against
  MiG-29. The arenas are in
  [dogfight-school](../dogfight-school/README.md), "Desert Combat's arenas".
- The **Rules** tab of the school's rail: the card's head, the fight, then
  the twelve rules. A rule's row opens the lesson that shows it; "Fly it:
  F-15C against MiG-29" picks the No Fly Zone, puts you in the F-15C against
  the MiG-29 and opens *Breaking the circle*.
- `viewer/dogfight-doctrine-1991.js` (pure): `RULES`, each with its source
  and a `check(ctx)` verdict (`holds`, `differs`, `partly`, `not here`),
  `rulesOn(ctx)`, `jetOf` (a jet's hit points, cannon and missile off its
  model's extras), `LAB_FLIGHT`, `flown` and `speedAt` (the missiles'
  flights), `FIGHT`, `CARD`.
- `viewer/dogfight-airframe.js` (pure): `measureAirframe(makePlane)`, what
  the flight law does with an airframe, below.
- `viewer/dogfight-school-page.js` `rulesCard`: on a Desert Combat tree,
  reads the two jets on stage and measures each type once; the theatre
  takes the card as its `rules` option and redraws it when the planes
  change (`dogfight-theatre.js` `rulesHtml`, `drawRules`). The end card and
  the live coach still score Boelcke's rules: they are what the school can
  measure over a fight.
- Tests: `tests/test_dogfight_doctrine_1991.py` (through
  `dogfight_doctrine_1991_harness.mjs`).

## The rules, and what Desert Combat says

Verdicts as the page reads them on Desert Shield, your F-16 against their
MiG-29 (headless Chrome over the published tree, 2026-11-10). "Boelcke" is
the rule of 1916 each carries on.

| # | Rule (source) | Boelcke | Verdict | Desert Combat's numbers |
|---|---|---|---|---|
| 1 | Go in to win (Blesse, offense 22) | 2 | holds | 500 rounds, 25 s of fire at 20 a second, and 16 AIM-9s: enough to finish every pass |
| 2 | Speed is life (Boyd, part II) | 1 | **the game differs** | Height is nearly free: standing on its tail from level speed the F-16 still makes 80 m/s after 10 s, 705 m higher. A propeller fighter on the same law is out of speed in about ten. The wings stop lifting at 1,000 m |
| 3 | Lose sight, lose the fight (AFTTP 3-3 vol. 5, 4.3.10.5.7.4) | 4 | holds | No enemy on the minimap, a name only under the crosshair, no radar. Head on the two close at 196 m/s: 1,000 m in 5.1 s |
| 4 | Know your best turning speed (AFTTP 3-3 vol. 5, 4.3.4) | new | **the game differs** | No g limit, no blackout, so no corner speed: a full pull turns the F-16 50 deg/s at 60 m/s, 80 at 100, 105 at 140. Faster is faster. The circle stays 68 to 76 m in radius |
| 5 | One circle or two (Shaw, chapter 2) | new | holds | At 100 m/s the F-16 pulls 80 deg/s on a 72 m circle, the MiG-29 60 on 96 m: turn across them (one circle) |
| 6 | Lead to shoot, lag to stay (Boyd, part II) | 5 | holds | In full: nothing fires over the shoulder. At 300 m a round takes 0.3 s, in which a jet crossing at 102 m/s moves 30 m |
| 7 | Do not overshoot: go up (Boyd, the high-speed yo-yo) | new | not in the school yet | The pilots fly no yo-yo. Going up is cheap here (rule 2), so the high one is always open |
| 8 | Shoot only a shot that counts (AFTTP 3-3 vol. 5, 4.3.1.2.1) | 3 | **the game differs** | The AIM-9 has no seeker: it flies straight and bursts within 7 m of an aircraft. 499 m/s off the rail, 154 a second later, 110 after two: 275 m in the first second, 406 in two. After 2.6 s it is slower than a MiG-29 flying level |
| 9 | Attacked: turn into it (Boyd, the defensive turn) | 6 | holds | Every weapon needs lead; the F-16 comes round 80 deg/s at 100 m/s. Their AA-10 has no seeker to break, only a 7 m burst to stay out of |
| 10 | Fight as a pair: one engaged, one free (AFTTP 3-3 vol. 5, 4.4.5) | 8 | holds | The pair's lesson flies on any airframe. The missile's fuse tests no side (PROX-5): a friend crossing its path sets it off |
| 11 | Fly your jet's fight, not theirs (Blesse, offense 14; Shaw) | 1 | holds | Level at 300 m: F-16 94 m/s, MiG-29 102. At 100 m/s: 80 deg/s against 60. The F-16 out-turns and cannot outrun: fight for angles |
| 12 | Leave on your own terms (Boyd, flight tactics) | 7 | in part | No fuel here. What runs out is the cannon, 25 s. They are 7 m/s the faster: go only when they point the other way |

Three part from the books, and they are the three the real jet age was
built on: energy (height is nearly free, and capped), the turn (no g limit,
so no corner speed) and the missile (no seeker). What that leaves is a gun
fight flown fast: the plane that turns its nose quicker at the speed both
are flying wins the turn, and every shot is a deflection shot from behind.
Boyd's 1964 study, written for a cannon and a missile that had to be fired
from astern, is the nearest real manual to what Desert Combat's jets carry.

From the MiG-29's cockpit the same numbers give the other advice (the tests
hold both): "You are the faster jet and the worse turner: pass, extend,
come back", two circles, and the freedom to leave.

Every quote on the card was checked against its source's text: Boyd and
the F-16 manual against the scans' OCR, Blesse against an OCR of his own
pages, made for this (research.md, "Addendum"). Shaw is in copyright and is
paraphrased; the one rule that is his alone (5) quotes nothing.

## The fight: Rodriguez and the MiG-29

19 January 1991. Two F-15Cs of the 58th Tactical Fighter Squadron met two
MiG-29s head on; a radar missile took the first. The second could not be
told friend from foe, so Captain Cesar Rodriguez closed to see it. They
merged, both turned left into a descending spiral from about 8,000 ft, his
Sidewinder would not lock against the hot ground, and at 1,500 ft he still
had no shot. Near the ground the MiG rolled on its back, pulled through and
flew into the desert. One list calls it the war's only turning fight
(research.md 2.1 A, with the three heights the sources give).

On this engine, as the card says it with the F-15C and the MiG-29 on stage:
the F-15C makes 93 m/s level and pulls 53 deg/s at 100 m/s, the MiG-29 102
and 60, so on this flight law the MiG is the better jet in both, which is
not how the day went; the MiG's last move needs about 192 m of height at
100 m/s; and the whole fight is flown under 1,000 m, where his ended.

## Measured on the pair on stage

`measureAirframe(makePlane)` flies an airframe on the page's flight law at
300 m: its level speed (a slow nose hold for 60 s), the pitch rate a full
pull reaches at 60, 100 and 140 m/s with the circle that rate would fly,
and what standing on its tail from level speed does in 10 s. The pull and
the climb use no pilot. The school's hands were tuned on a Spitfire and fly
some airframes badly: `pointNose` rolls the F-16 for four seconds before it
pulls up, and `hardTurn` holds the AV-8 to 9 deg/s. A number that is the
hand's is not the airframe's. About a tenth of a second a type, once.

Desert Combat's fixed-wing aircraft, as the page measures the published
models (2026-11-10):

| Aircraft | Level at 300 m, m/s | Full pull, deg/s at 60 / 100 / 140 m/s | Circle at 100 m/s, m | Straight up after 10 s | Cannon | Missile |
|---|---|---|---|---|---|---|
| F-16 | 94 | 50 / 80 / 105 | 72 | 80 m/s, +705 m | 500 rounds, 25 s | 16 AIM-9 |
| MiG-29 | 102 | 32 / 60 / 84 | 96 | 75 m/s, +703 m | 500 rounds, 25 s | 12 AA-10 |
| F-15C | 93 | 28 / 53 / 77 | 108 | 62 m/s, +613 m | 940 rounds, 47 s | 16 AIM-9 |
| Mirage | 117 | 39 / 60 / 78 | 95 | 112 m/s, +942 m | 750 rounds, 38 s | 8 Magic |
| F-14B | 99 | 24 / 41 / 55 | 140 | 59 m/s, +676 m | 800 rounds, 40 s | 8 AIM-9 |
| AV-8 | 85 | 27 / 43 / 59 | 133 | 51 m/s, +575 m | 500 rounds, 33 s | rockets |
| A-10 | 87 | 33 / 53 / 73 | 108 | 72 m/s, +622 m | 1,350 rounds, 68 s | none |
| Su-25 | 89 | 36 / 50 / 67 | 115 | 63 m/s, +575 m | 1,000 rounds, 50 s | none |

These sit near what the lab server measured in the real game with bots at
the stick (desert-combat-parity, lab-ground-truth.md: level, 95th
percentile, MiG-29 96, F-15C 86, F-14B 116, A-10 78, Su-25 76 m/s). The
F-16 is the turner of the cast and the Mirage the runner; the F-14B turns
worst. None runs out of speed going up.

**The missiles are the real game's.** The page's own rocket law is not what
the card quotes. `LAB_FLIGHT` is the lab server's recording of the mod
itself: 60 AIM-9 flights and 23 AA-10 flights, speed at 0, 0.5, 1, 2, 3 and
5 s, none turning more than 0.13 degrees. The 7 m fuse is the mod's own
script (`explodeNearEnemyDistance`; dogfight-doctrine, "Research notes").

## Found on the way

- **An aircraft flown under node from its glb alone flies wrong.** The
  flight law's drag is the box law (PHY-4): it needs the airframe's
  geometry box, which the page takes from the meshes and the simulator from
  `collision-meshes.json`. `server/glb-scene.mjs` builds a vehicle's tree
  with no geometry, so `new Aircraft(root)` on it, with no collision meshes
  passed, has no such box. The same published F-14B then levels at 201 m/s
  under node and 99 in the page; the MiG-29 at 125 and 102. The page's
  figures are the ones near the lab's. The jets' rows of dogfight-doctrine's
  "The airframes, measured" (F-16 111, MiG-29 130, Mirage 129, flown under
  node, height not given) disagree with the page's too, and are marked
  there as leads. Nothing the site runs is affected: the school's own tests
  build their Spitfire with a box, and the page has the meshes.
- **Level speed rises with height on this law.** The air thins to nothing
  at the 1,000 m ceiling and the drag with it. A jet's "top speed" means
  nothing without its height, so the card names it: 300 m.
- **Desert Combat's catalogue called every vehicle Allied**, and its jets
  sit on pads the arena index did not read: both in dogfight-school,
  "Desert Combat's arenas", and tank-doctrine-1991, "Desert Combat's tank
  arenas".

## Open

- **The lessons are WWII's.** They are flown on the jet on stage and each
  move's count is the jet's own, but the plans' speeds and thresholds are a
  propeller fighter's (starts at 60 to 92 m/s). On the F-16 the Extension
  works from seven starts of nine or more in five lessons of nine, and no
  Reversal or Bounce works in any. Lessons re-tuned for jets, flown and held
  from the nine starts on their own airframe, are the honest next step; the
  same is still owed to BF1918.
- **The duel's guns are the school's.** A lesson's fight is flown with the
  Spitfire's guns, not the jet's cannon or its missiles. A missile in the
  duel, on the lab's curve with its 7 m fuse, would let rule 8 be flown, not
  only read.
- **The yo-yos** (rule 7) are not flown by any pilot here.
- **No helicopters.** The arenas leave them on the ground. The research has
  the doctrine (section 3: J-CATCH, the Army's guidance, Swain's A-10 gun
  kill), and the mod has the cast.
- **The end card and the coach** still say "Boelcke" on a jet. Their
  measures are his rules'; the numbers map onto this card (the Boelcke
  column), but the words do not yet.
- **A sustained turn is not measured.** A full pull's rate is the airframe's
  for a moment; whether it holds its speed through the turn needs a hand
  that flies jets, which the school does not have.
- **DC Final** takes the same card, but its tree is not published.
- **Not flown by a person.** Checked headless (Chrome, 1440 px): the card on
  three arenas, the fight's button, FLY IT into Desert Shield (the F-16
  airborne against the ace), the list's screenshot looked at, no page
  errors.
