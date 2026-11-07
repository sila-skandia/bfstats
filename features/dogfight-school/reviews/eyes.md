# Human eyes (2026-11-07)

The owner chose (2026-11-07): every pilot in the school sees only what a pilot
could see from his seat, the aces and the "you" pilots alike. Real pilots held
the upper hand through the other man's mistakes, above all losing sight of the
attacker. Until now every plan read the other plane's true position, velocity
and attitude every tick, through a hemisphere of glass all round.

## The model

One seam: `stepPilot` (`viewer/dogfight-pilot.js`) passes the other plane
through `perceive(mem, me, him, dt)` before any plan runs. Every plan reads
`c.him` and `c.g` (`geometry(me, him)`), so every plan sees through the same
eyes. `c.g` also carries `sees` (he has him now), `lost` (unseen for
`EYES.lose`) and `unseen` (seconds). The duel records `sees` (1/0) on every
track sample (`viewer/dogfight-duel.js`), so the theatre can say "he has lost
you". The live fight needs nothing new: the ace's step perceives the player's
plane the same way.

### What the cockpit hides (`blind(az, el)`)

`az` is the angle off his own nose (0 ahead, 180 astern), `el` the angle above
his wings' plane, both in his body frame, so a bank moves the blind sky with
the wings.

| | | where it comes from |
|---|---|---|
| `front` 15 deg | the windscreen and the gunsight: always in view, and a plane in it is seen at once | the brief: "he will always see what is in front of his guns" |
| `tail` 20 deg | the cone astern, round the tail's line: hidden | The armoured headrest and the raised rear decking. Framed and "razorback" canopies "left a blind spot behind the pilot", and the rear-view mirrors of the day had a narrow field ([Wikipedia, Bubble canopy](https://en.wikipedia.org/wiki/Bubble_canopy)); Spitfire head armour sat on the seat frame and carried the headrest in every mark (modellers' and veterans' forums, [ww2aircraft.net](https://ww2aircraft.net/forum/threads/why-were-most-early-ww2-fighters-designed-with-limited-rear-visibility.61400/page-3)). No measured angle was found: 20 deg is the head turned to either side of the headrest, seeing past it to about 160 deg off the nose |
| `below` 10 deg | under the wings' plane, ahead of the beam and abeam: hidden | Geometry: the Spitfire's half-span is 5.6 m (the duel's `AIRFRAME` wing box) and the pilot's eye sits about 1 m above the wing root, so the wing's edge is atan(1 / 5.6) = 10 deg under the eye's horizon |
| `belowTail` 5 deg | rising to 5 deg under the wings astern | Geometry: the rear decking falls about 0.5 m over the 5 m behind the eye |

Over his shoulder and above is visible, and so is anything high astern (outside
the 20 deg cone). The sun is not modelled (no "Hun in the sun"), nor cloud, nor
a range at which a fighter becomes too small to see, nor the mirror.

### Lookout (`perceive`)

| | | where it comes from |
|---|---|---|
| `watch` 90 deg | the front hemisphere is watched all the time | the brief |
| `glance` 1 s | a look over one shoulder at the sky behind lasts this long | The FAA's scan (AIM 8-1-6): each block of sky fixated "at least one second" to detect a target ([NASA Ames, visual scanning](https://humanfactors.arc.nasa.gov/flightcognition/research/vs.html); [SKYbrary](https://skybrary.aero/articles/visual-scanning-technique)) |
| `glanceEvery` 2.5 s | one glance every 2.5 s, left and right in turn: each rear quarter for 1 s in every 5 | Chosen: the "constant head swivel" of every fighter memoir; no measured figure was found. Deterministic: the phase comes from the pilot's seed (`mem.rng`), never `Math.random` |
| `glanceG` 4 g | above 4 g no glances: the eyes stay forward and up into the turn | Relaxed g tolerance 4.47 +/- 0.69 g in an aircrew study (Indian Air Force aircrew, quoted in the aviation-medicine literature); greyout, which narrows the outer field first, comes before it ([Wikipedia, Greyout](https://en.wikipedia.org/wiki/Greyout)). Load is the wings' push in Earth g (the engine's gravity is 1.5 of it) |
| `roof` 30 deg | pulling hard he looks up through the canopy, the inside of his turn; and a glance over either shoulder takes in the sky high behind | In a break the attacker following him round sits there |

A glance covers its shoulder's rear quarter and the high sky behind both.
Pulling hard, the inside of the turn (30 deg or more above his wings) is
watched instead. Once he has noticed the other plane he keeps his eyes on him
anywhere the cockpit lets him (over the shoulder in a break), and one he is
watching that goes under his nose or wing ahead of the beam he keeps by
dipping a wing; under the tail he loses him.

### Noticing and losing

| | | where it comes from |
|---|---|---|
| `notice` 0.8 s | a plane he has not been watching that comes into view is noticed this long after | The FAA's reaction-time chart (AC 90-48): 0.1 s to see an object, 1.0 s to recognise it as an aircraft ([AOPA, "the 12.5-second gap"](https://www.aopa.org/news-and-media/all-news/2016/may/13/training-tip-the-12-5-second-gap)). A fighter pilot in a fight is looking for exactly one aircraft: a little under the 1.1 s, inside the brief's 0.5-1 s |
| `reacquire` 0.25 s | one he had a moment ago (unseen less than `lose`), where he expected it | Saccadic reaction 150-200 ms (saccade-latency studies, e.g. [Exp Brain Res](https://link.springer.com/doi/10.1007/BF00231145)) plus a fixation |
| `lose` 4 s | unseen, he flies on the last position and velocity he saw, carried forward; after this he knows he has lost him (`g.lost`) | Chosen: a fighter turning at 30-40 deg/s is 100 m or more off a straight-line guess within 3-4 s |

While he sees him, tracking is live: the aim is never delayed.

### What he does about it

- **The guns** fire only at a plane he sees (`shoot`). In the windscreen he
  sees him at once, so a shot that would land is never held back by the eyes.
  Every lesson demo's 110 000 track ticks: no round fired unseen.
- **The break reflex** (`reflex`) starts only on a man he has seen there; one
  who slips out of sight a moment later he still breaks from, where he last
  saw him.
- **The clearing turn** (`clearTurn`): a pilot who has lost the other plane
  turns to find him, level, toward where he last had him, bank 60 deg or more
  (rolled past it when that is well below, so the wing does not hide it),
  looking back into the turn, until he sees him or for 6 s; then his plan goes
  on, its phase clocks running as if it had never left; no sooner than 4 s
  later he clears again. Not while his plan is defending (a man running from
  him does not turn back to look). Two plans by design never look round: the
  man flying straight under attack (`cruiser`, "not looking back") and the
  one who never looks up (`unaware`); `NEVER_CLEARS` names them.
- **The start**: a fight starts with both pilots aware of each other; he has
  the other plane if the cockpit lets him see it at all (ahead, dipping a wing
  if he must), and knows where it was if not.

Held by `tests/test_dogfight_eyes.py` (`tests/dogfight_eyes.mjs`): behind the
tail and below the wing unseen, above, abeam and in the gunsight seen;
noticed after the delay; found again after a moment behind the headrest;
lost after the carry-forward; the glances; no glances above 4 g; the man
closing from dead astern never seen in a duel; the guns; the clearing turn.

## Fixed on the way (the demos the first version made nonsense)

- A pilot under 4 g in a break never saw the attacker sitting high over his
  canopy: glances covered one side only, and the attacker crosses the
  centreline. A glance now takes in the high sky behind; pulling hard, the
  inside of the turn is watched. (Break turn's Dip went 7 to 4 and back to 8.)
- A boom-and-zoom attacker lost a target under his nose on the perch and in
  the zoom and never found it again, so the pilot who never looks up stopped
  being shot down (9 to 0): a watched plane under the nose or wing ahead of the
  beam is kept by dipping a wing, and the clearing turn rolls far enough to
  look down (now 9).
- The man flying straight under attack started clearing turns, which is not
  the lesson's straw man: `NEVER_CLEARS`.
- The clearing turn restarted the plan's phase clock, so an ace's "give up
  after 6 s" never ran out: the clocks now run on through it.

## What it changes

The Dip, the Flip and the Ninja of every lesson, from the tests' nine starts
(`<SCRATCH>/dfn/all.mjs`), before the eyes and after (the demos are unchanged;
"claimed" is the count the lesson states):

| Lesson | Dip before / after | Flip before / after | Ninja before / after (claimed) |
|---|---|---|---|
| Boom and zoom | 9 / 7 | 0 / 0 | 0 / 0 (0) |
| When he has the height | 9 / 7 | 0 / 0 | 0 / 0 (6) |
| Up and over | 9 / 9 | 6 / 6 | 0 / 0 (9) |
| Out of his lock | 5 / 0 | 1 / 0 | 0 / 0 (0) |
| On his tail | 9 / 9 | 0 / 0 | 0 / 0 (0) |
| The break turn | 7 / 8 | 1 / 1 | 0 / 0 (5) |
| The flat scissors | 9 / 9 | 0 / 0 | 0 / 0 (7) |
| Immelmann and split-S | 9 / 9 | 3 / 2 | 0 / 0 (9) |

Before the eyes, 7 dogfight tests already failed (the stricter Ninja
measure). After, 64 of 163 fail. By file: the shape tests of the break turn
(19), out of his lock (10), the boom and zoom and the height (3), up and over
(1); `test_dogfight_school` (5); every `test_dogfight_dfn_*` (26). Why, in
the main:

- **Out of his lock**: the hunter starts dead astern, inside the defender's 20
  deg tail cone. The lesson's "watch him come in behind me" cannot be flown:
  the defender loses him at 4 s and clears, turning early, so the turn-in, the
  chop and the Dip all start at the wrong range (Dip 5 to 0, the chop lands no
  hits).
- **The break turn and On his tail (the move)**: the attacker closes from
  nearly astern; the defender loses him, clears at 4 s, finds him and breaks
  at 269-298 m with the clear's bank still on (first bank 41 deg, once away
  from him). The break is still at about 300 m and into him in most starts;
  the shape tests' windows (270-330 m, bank over 45) catch the rest.
- **Boom and zoom, the height**: the ace loses the runner in the Dip and finds
  him again 1 km off and chases on (Dips 9 to 7); the counters' shapes move
  (`every dive he wastes starts lower`).
- **Claimed counts**: every Ninja the lessons still claim (6, 9, 5, 7, 9) was
  already failing; the Flips of Out of his lock and the Immelmann moved by
  one.

None of these is an ace who never notices a bounce from ahead or a pilot
blind to what is in front of his guns; they are men who cannot see dead
astern and act on it. The lessons' agents fix their own lessons' tests and
words.

## Open

- The sun, cloud and detection range are not modelled; a high attack is
  hidden only by the scan, never by the sun.
- The glance rate (every 2.5 s) and the 4 s carry-forward are chosen, not
  measured.
- Hartmann's "80 per cent of my victims never knew I was there" is repeated
  everywhere and sourced nowhere (a 1989 Usenet thread already asked where it
  came from); his motto "See - Decide - Attack - Break/Reverse" is on record
  ([Wikipedia, Erich Hartmann](https://en.wikipedia.org/wiki/Erich_Hartmann)).
  The school's aces, who never stop looking, are the hard case: under the
  eyes the bounce works on the man who does not look (`unaware`, `cruiser`)
  and on the ace who flies his plan away from you, not on one who has you
  padlocked (reviews/ascend.md, "Human eyes").
