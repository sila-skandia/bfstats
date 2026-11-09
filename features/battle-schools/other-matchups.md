# Battle schools: the other match-ups

A planning survey, 2026-11-09. Nothing is built. The dogfight school
(`features/dogfight-school/README.md`) teaches fighter against fighter. Other
studies cover tank against tank and infantry against infantry. This one is a
lighter look at the rest of BF1942's match-ups, and at how well each fits the
school's format.

The format, as the dogfight school has it:

- Bots fly named moves on the game's measured physics, in deterministic node
  duels (`viewer/dogfight-duel.js`).
- A lesson is a situation with a move and its counter. Each is flown from nine
  nudged starts (an L9 array over sideways, along, height and speed), and the
  tests hold every count.
- A theatre replays the fights, and a live fight puts you against a bot ace,
  with a coach, an input guide and predicted path lines.
- Each move is scored Dip (escape), Flip (the chased becomes the chaser) or
  Ninja (get the shot and keep it).
- Real fights are mined from player recordings (`viewer/dogfight-detect.js`).

Engine facts below cite ledger rows in
`features/bf1942-engine-reference/ledger.md`. Paths are relative to the repo
root unless they start with `viewer/`, which means `tools/bf1942-models/viewer/`.

## The ranking

| Rank | Match-up | Fit (1-5) | Why, in one line |
|---|---|---|---|
| 1 | Infantry anti-tank against a tank | **5** | A short, decisive duel with measured physics on both sides, damage the tables price exactly, bots for both seats, and a kill kind already classed in recordings |
| 2 | Fighter against bomber or attack plane | **4** | It is the dogfight school with a second airframe and gunner seats. 91 such fights are already in the mined recordings |
| 3 | Ground AA against aircraft | **4** | The fuse, the burst and the AA bot are built and pure. The pilot's counters are clear moves. The gun cannot move, which makes it half a duel |
| 4 | Bomber against a ground target (dive bombing, level bombing, torpedo runs) | **3** | The ballistics are built and exact, but it is a range or a course more than a duel, unless the target fights back (item 3) |
| 5 | Combined arms and team fights | **3** | It has the most value, because the best BF1942 play is teamwork, and the most cost: N-seat duels, a friendly bot and team scoring |
| 6 | Naval (destroyer, submarine, torpedoes, carriers, landing craft) | **3** for destroyer against submarine and torpedo leads, **2** for the rest | Ship physics is measured, but the submarine's dive is not on a control, fights last minutes, and few rounds are played on the naval maps |
| 7 | Light vehicles: the jeep against infantry and tanks, the APC role | **2** | Fights are decided by a ram or a mine in one second. The tricks are tips, not moves with counters |
| 8 | Artillery and spotting | **2** | Indirect, slow and one-sided. It suits an explainer or a range better than a duel |

## 1. Infantry anti-tank against a tank

### What decides it in BF1942

The struck face decides it. A tank's collision mesh carries a material per
face, and the rocket's price depends on that face. On the Sherman, faces 50,
51 and 52 are rear, side and front (`features/bf1942-3d-models/README.md`,
"The face material"; the proving ground labels them in
`viewer/proving-ground-page.js` `materialName`). Against a Sherman's 100 hit
points (HP-12):

| Weapon | Rear (50) | Side (51) | Front (52) | Wheels (46) |
|---|---|---|---|---|
| Bazooka | **100** (one shot) | 35 (three) | 26 (four) | 50 |
| Sherman gun | **100** | 50 | 40 | 35 |
| Tiger gun | **132** | 77 | 44 | 88 |

- **The angle.** A tank authors no `angleMod`, so its angle factor is
  `sin(abs(cos) x pi/2)` (DMG-4). At 60 degrees off square a hit does 0.71 of
  full damage. Lore says to angle the tank about 30 degrees to the shooter,
  and the engine explains why that works.
- **The rocket.** The bazooka fires a 50 m/s round with no motor, which falls
  at 0.2 g, or -2.95 m/s²
  (`features/bf1942-engine-reference/subsystems/projectiles-and-impacts.md`).
  Range is the real limit, not the deviation cone, because there is none
  (DEV-8 refuted). At 100 m the flight takes 2 s and the drop is about 6 m,
  so a moving tank needs a lead.
- **The reload.** A bot measured 6.6 s between rockets: the 1.0 s fire cycle
  plus the 5.6 s reload (`features/bot-weapons/README.md`). That gap is the
  window in every race below.
- **Landmines.** A `LandmineProjectile` has a 3 m fuse and a mass of 130
  (PROX-8). It goes off only for an object heavier than itself that moves at
  **2.5 m/s or more** (PROX-3), and never for a soldier (PROX-2). The lore
  that "driving over one slowly won't trigger it" is this speed test.
- **The explosives pack.** Its splash takes the fuse path, not the impact path
  (HP-9d). A splash on a soldier is priced by exposure: 3 sample points prone,
  9 crouching or standing, and standing is capped at 0.5 (HP-10).
- **Splash on armour.** A tank's HE splash does nothing to armour (DMG-2), so
  a tank kills another tank by direct hit only. Against soldiers it does
  splash.
- **Repair.** An engineer repairs a hull directly. Depots repair by the SUP-19
  rule, and a seated soldier is served only by their own hull's depot
  (SUP-20). A wrecked hull is gone after `timeToLiveAfterDeath` (HP-19).
- **Critical damage.** Below its `criticalDamage` (12 on the Sherman) a hull
  loses hit points on its own, and its turret traverses at 0.2x input (HP-15).
  The last few hit points are therefore a race too.

### Doctrine and lore

German Panzerschreck teams worked in pairs no more than about 115 m apart, so
they could hit a tank from two directions. They hid in buildings, hedgerows
and folds in the ground. They aimed for side and rear plates, and they moved
after every shot, because the smoke and back-blast gave the position away
([Wikipedia, Panzerschreck](https://en.wikipedia.org/wiki/Panzerschreck);
[The Armory Life](https://www.thearmorylife.com/german-panzerschreck/)). The
Allied answer was infantry kept close to the tanks to clear AT teams before
they fired, and US bazooka teams that drew a tank's attention with a Sherman
and then struck its flank
([warhistory.org, US Army tactics](https://warhistory.org/2015/10/22/us-army-tactics-wwii/)).

BF1942's players say the same things in the game's terms:

- Aim for the rear, the sides or the low hull. Show yourself only for the
  instant you fire, and wait in cover for the tank to turn its back
  ([Battlefield 1942 Tips and Tactics](https://realtimerendering.com/erich/bf1942/tips.html)).
- A tank crew dodges a bot's rocket by moving about 5 m when they hear it
  fire.
- An engineer in the tank hops out between the enemy's reloads to repair, and
  is back before the next round
  ([Panzaman's tank tutorial](https://www.realtimerendering.com/erich/bf1942/tankvstank.html)).
- Mines funnel tanks into ambushes, and three explosives packs on the engine
  deck finish a tank (same tutorial).

### Candidate lessons

| Lesson | Situation | Move | Counter |
|---|---|---|---|
| The rear shot | An AT soldier in a building on a street, and a tank coming down it | Let it pass, then fire into face 50 for a one-shot kill | The tank checks its corners: it stops short of the building, swings the turret to the window and uses the co-ax, or reverses away so its front stays to the threat |
| Three rockets or four | An AT soldier and a tank in the open at 60-100 m | Get to the side (three hits at 35) and lead the moving hull | Turn the front to the shooter (four hits at 26), angle it 30 degrees to cut the factor, then kill the soldier with HE splash or the co-ax inside the 6.6 s reload. Dodge 5 m on the sound of the shot |
| The repair race | A damaged tank with an engineer, and an AT soldier reloading | Out, repair, back in, inside the 6.6 s window | Hold the rocket until the engineer is out, then hit the soldier or the rear. Or shoot at the tank's critical threshold so it burns down on its own (HP-15) |
| The mine funnel | An engineer with mines at a choke point, and a tank pushing through | Mine the way the tank must take, and cover it with an AT soldier | Creep under 2.5 m/s (PROX-3), send infantry ahead, or go another way |

### How hard to build

| Need | State |
|---|---|
| Tank physics | Measured: the server's per-tick law to 0.3-0.5 mm (`features/tank-ground-law`, TANK-18..TANK-24) |
| Soldier physics | Measured: PHY-34 to 1 mm (`tests/test_move_law.py`) |
| Damage | Exact: the face, the angle and the material tables are already in the proving ground's card |
| Rockets | Built, with gravity and reload. Bots fire bazookas and Panzerschrecks (`features/bot-weapons`) |
| Mines | The fuse rule is built in `viewer/proximity-fuse.js` |
| Bots with intent | Missing. The engine's tank law (AI-45, AI-47) drives toward a point and has no plans. The tank school will need tank "pilots" anyway, so the AT side is mostly an on-foot plan set: wait, peek, fire, relocate |
| Line of sight from a building | Statics and windows are in the level bake. A duel needs a small street set, which is new |
| Recordings | A recording carries the firing moment of every weapon (`features/round-replay-capture` section 14) and each hull's hit points. Kill lines name the weapon (KILLSTAMP-1). Shorts already class a man on foot killing armour as `tank-buster` (`features/replay-shorts/README.md`, 2026-11-09): Arnhem alone has 30 PIAT kills |

This is the best fit. Each lesson takes seconds, ends in a kill or an escape,
and its counter is a real move. The scoring translates: Dip is the tank
getting out of the AT soldier's arc, Flip is the tank finding and killing the
shooter, and Ninja is the shooter killing and relocating unseen. It also
shares most of its parts with the tank school.

## 2. Fighter against bomber, dive bomber and attack plane

### What decides it in BF1942

- **The gunner's arcs.** The B17's pilot drops bombs and carries no gun
  (BOMB-7). Its guns are in other seats: a top turret (`B17_PCO1`) and a ball
  turret (`B17_PCO2`) (`features/plane-bombs-and-torpedoes/README.md` 2.1).
  The Ju88A carries a nose gun, a belly gun and rear guns
  (`features/vehicle-sound-coverage/README.md`). The Stuka, the Aichi Val,
  the SBD and the Il-2 each have a rear gunner.
- **The gunner's turn rate.** Each gun's traverse is a first-order velocity
  servo (GUN-2), and several axes can turn at once (GUN-20). A fighter that
  crosses a gunner's arc faster than the servo slews is safe.
- **Hit points.** The B17 spawns at 128 (`features/bot-gunner-aim/README.md`;
  the 128 ceiling is HP-17). Lore puts Battle of Britain bombers at 300
  against 100 for a single-seat fighter
  ([Tips and Tactics](https://realtimerendering.com/erich/bf1942/tips.html)).
- **The angle.** Aircraft author `angleMod 1` (DMG-4), so a hit on a plane
  costs the same at any angle. On a bomber, the aspect matters only through
  the gunners' arcs and the size of the target.
- **Who wins in the recordings.** Of 302 fights mined from 32 recordings, 91
  were a fighter against a bomber or attack plane (28 kills). The Stuka, the
  Val, the SBD and the Il-2 count as attack planes (`fighterRank`;
  `features/dogfight-recordings/README.md`, "By plane").

### Doctrine and lore

The Luftwaffe found that a head-on pass at a B-17 formation drew the least
return fire. Their standard attack was from 12 o'clock high, often out of the
sun. The B-17G's chin turret was the answer, and the tail gunner was the most
successful position on the aircraft
([Why German fighters attacked B-17s head-on](https://worldwarwings.com/b17s-weakest/);
[warhistory.org](https://warhistory.org/2020/12/23/attacking-a-b-17-formation-from-the-german-side/);
[The Armory Life](https://www.thearmorylife.com/b-17-gunners-vs-luftwaffe/)).
Against a two-seater, the classic line is low and behind, under the rear
gunner's arc. The dogfight school's research already records Swede Vejtasa
turning an SBD into each Zero's attack (`features/dogfight-school/research.md`).

BF1942 lore says a plane's side is easiest to rake when it turns toward you,
and that a straight attack from behind works only from close
([Tips and Tactics](https://realtimerendering.com/erich/bf1942/tips.html)).
The bomber's own escape is to fly to its friendly flak.

### Candidate lessons

| Lesson | Situation | Move | Counter |
|---|---|---|---|
| The high front pass | A fighter with height on a B17 on its bomb run | Dive in from ahead and above, through the top turret's arc too fast for its servo, then zoom away | The bomber turns so the top turret bears longer. The gunner leads by the fighter's crossing rate |
| Under the tail | A fighter behind a Stuka or a Val | Close from low behind, under the rear gunner's arc, and fire from close | The pilot pulls up or slews to give the gunner the arc, or turns into the attack (the Vejtasa) |
| Turn into them | An attack plane bounced by a fighter | Turn hard into the fighter for a head-on pass with the nose guns, so it overshoots | The fighter takes a lag line: it gives up the first pass and comes back from the gunner's blind side |
| Drag to the flak | A bomber chased by a fighter, near its own AA | Fly low over a friendly flak gun | The fighter breaks off before the guns' range, or comes in high and steep where the guns are not looking |

### How hard to build

- **Flight.** The law is generic (AI-60, `viewer/aircraft.js`). `runDuel`
  already takes a `makePlane` per side, so a bomber is another spec.
- **What is fitted to the Spitfire.** `AIRFRAME`'s hit boxes,
  `KILL_HITS = 22` and the flight hands' gains are all the Spitfire's. A
  bomber needs its own hit boxes, kill count and gains, and "One airframe both
  sides" is already in the school's Open list.
- **Gunners.** A bot gunner exists (`features/bot-gunner-aim`, the count law
  `mouseControlLookAtDirection`). The duel runner has one pilot per side. A
  gunner is a second brain on the same hull: aim the servo, fire within an
  arc. That is far cheaper than a second airframe.
- **Recordings.** Rule 3 of the detector excludes a gunner's rounds. Counting
  a gunner seat's aimed shots against the fighter, credited to the bomber's
  side, is a small change, and the 91 fights are already found.

## 3. Ground AA against aircraft

### What decides it in BF1942

- **The fuse.** A flak shell bursts on the first object within
  `explodeNearEnemyDistance` that is heavier than the shell, weighs at most
  100,000 and moves at 2.5 m/s or more (PROX-1..PROX-3). The vanilla AA gun
  and the carrier's AA use 10 m with a 0.1 s primer, and the Flak 38 uses
  10 m with no primer (PROX-8).
- **The burst.** It is the end-of-life burst: `e_FlakBig`, with a material-199
  splash out to 20 m (PROX-6).
- **The lifetime.** `CRD_UNIFORM/0.8/1.4` puts the AA gun's burst anywhere from
  240 to 420 m out (PROX-7, `features/flak-proximity-fuse`). The gun cannot set
  a range. Inside 240 m a shell must pass within 10 m of the plane, and past
  420 m it has burst.
- **No team test.** A friendly plane crossing the stream sets the shell off
  too (PROX-5). What the burst then costs it is the server's friendly-fire
  scale (HP-9c).
- **Contact.** A shell that touches a hull dies silently and does its direct
  hit of material 228 only (HP-9e).
- **The bot.** A bot AA gunner is anti-aircraft through its Armament plug-in
  (AI-78). Aircraft targeting is AI-55, and AI-18 is the penalty on a shooter
  that is not anti-aircraft. Before `features/flak-proximity-fuse`, a bot
  gunner never saw a seated human's plane.

### Doctrine and lore

Real fighter-bomber pilots came in low, popped up to attack and left low.
Some circled so that one aircraft drew the flak while the other attacked. All
of them jinked, varying height, heading and speed
([Warbird Information Exchange](https://www.warbirdinformationexchange.org/phpBB3/viewtopic.php?p=474267);
[the AAF flak film](https://theaviationist.com/2014/05/18/flak-in-wwii-video);
[P-38s evade AA by continuous turn](https://www.lonesentry.com/blog/p-38s-evade-japanese-aa-by-continuous-turn.html)).

BF1942 lore:

- **For the pilot.** Fly low over terrain, or dive steeply from high up,
  because gunners rarely look up. Fly erratically up and down.
- **For the gunner.** Listen for the plane, watch the minimap, and stay out of
  the gun until the plane is in range so you are not killed first
  ([Tips and Tactics](https://realtimerendering.com/erich/bf1942/tips.html)).
- **On aim.** Lead by how far the bursts land from the plane, and engage it as
  it comes toward the gun, not as it leaves
  ([ludo.guide, medium bomber](https://www.ludo.guide/guide/battlefield-1942/medium-bomber)).

### Candidate lessons

| Lesson | Situation | Move | Counter |
|---|---|---|---|
| The pop-up | A plane attacking a target with a flak gun beside it | Run in behind a ridge, pop up, attack, and leave low with the ridge between you and the gun | The gunner lays the gun on the gap where the plane must appear and fires early, so the first shells reach the 240-420 m band as the plane does |
| Out of the sun | The same, with height | Come down steeply over the gun, inside its elevation limit and above where the gunner is looking | The gunner pre-aims high at the sound, and fires on the climb-out, when the plane is slow and its path is predictable |
| The jink | A plane that must cross the burst band | Change height and heading every second or two, so the lead the gunner set is wrong when the shell arrives | The gunner fires a spread through the plane's likely paths, since the 20 m burst forgives the lead |
| Flak as a wingman | A fighter chased by a fighter, near friendly flak | Drag the chaser across the gun | The chaser breaks off, or crosses the gun high where it is not looking. PROX-5 means the bursts do not care whose plane they meet |

### How hard to build

- **The shell.** The fuse is pure (`viewer/proximity-fuse.js`, no imports),
  and the burst, its lifetime and its splash are all built and checked.
- **The gun.** The servo is GUN-2. The gun's elevation and traverse limits are
  in its `.con`. An AA "duel" therefore needs a gun seat, a shell and a plane,
  all available in node.
- **The format.** The gun cannot move, so the gunner's moves are only where to
  aim and when to fire. The pilot's half is the real lesson. Dip is passing
  the gun with no burst within 20 m. Ninja is an attack run on the gun or its
  neighbour that leaves unhurt.
- **Recordings.** The detector already names the AA as something it excludes
  (rule 3). An AA engagement is a gun seat and a plane, with an aimed shot
  defined as "the shell's flight passes within the 10 m fuse or the 20 m burst
  of where the plane really went". Shorts already class `ground to air`
  kills.

## 4. Bomber against a ground target

### What decides it in BF1942

- **The release.** A bomb leaves at the plane's own velocity (`velocity 0`,
  BOMB-8) with mass 250 and drag 0.08 (BOMB-10). Hitting is purely a release
  point problem.
- **Dive bombers.** A pull drops a pair from two muzzles 3.3 m either side of
  the centre line. The Stuka, the Val and the SBD carry 30 bombs, or 15 pairs
  (BOMB-1, BOMB-5, BOMB-6).
- **The B17.** It drops a stick of 8 at 4 a second from alternating racks
  (BOMB-3), with ten magazines and a 15 s reload.
- **Against a tank.** A direct hit costs 200 and kills. The splash (material
  202) is 60 at the burst, falling linearly to 0 at 20 m (HP-9). A single
  near miss never kills a 100 HP Sherman. A pair kills only if both land
  within about 3 m. The arithmetic is 2 x 60 x (1 - d/20) >= 100, assuming
  the material-50 splash price holds and vehicles take no exposure factor,
  which HP-10 states for soldiers only.
- **Against a ship.** Bomb splash has no cell against ships, so a bomb must hit
  the hull: 50 a hit, 56 for the heavy bomb (DMG-1;
  `features/plane-bombs-and-torpedoes/README.md` 2.4).
- **Torpedoes.** A torpedo hit costs 140. The torpedo runs straight on the
  heading it entered the water at, with no homing (BOMB-11, BOMB-12;
  `viewer/torpedo-run.js`, measured running 1,377 m).

### Doctrine and lore

- **The Stuka.** It dived near-vertically. Dive bombing a single tank was
  rarely accurate enough to pay, which is why the Ju 87G carried two 37 mm
  cannon for the job
  ([ww2-weapons, dive bombing tactics](https://ww2-weapons.com/dive-bombing-tactics);
  [acepilots, Ju 87](https://acepilots.com/german/ju87.html)). The
  repo's numbers say the same thing about BF1942.
- **Bombing ships** (BF1942 lore). Run along a destroyer's or a battleship's
  length to stay out of its flak. Bombs on a carrier's deck do more than bombs
  on its side. Do not dive right after release, or you may fly into your own
  bomb
  ([Tips and Tactics](https://realtimerendering.com/erich/bf1942/tips.html)).
- **Torpedoes** (the same page). Hits in the water do 2-4 times what a drop
  onto the ship does. Four sink a destroyer and seven or eight sink a carrier.

### Candidate lessons

| Lesson | Situation | Move | Counter |
|---|---|---|---|
| The pair on a tank | A Stuka over a moving tank | A steep dive, release low on the tank's line, and pull out above the 20 m splash | The tank drives perpendicular to the dive and changes speed, so the pair's 3 m tolerance is lost |
| The stick on a ship | A B17 on a destroyer | Run along its length, so the stick of 8 walks the deck and the run stays out of the beam guns' arcs | The ship turns across the run and brings its AA to bear |
| The torpedo lead | A torpedo plane on a ship under way | Drop on a 90 degree track ahead of the ship, at the lead its speed needs | The ship turns toward or away from the track to comb it, which shrinks the target to its beam |

### How hard to build

The ballistics are all built and checked: `viewer/bomb-release.js` is pure,
`tests/bomb_release_harness.mjs` runs in node, and `viewer/torpedo-run.js`
measured the run. The target's half reuses the tank law and the ship law. What
is missing is a bot that bombs on purpose. The engine's own aircraft fire plan
(AI-56, AI-61) is a gun attack.

As a format, it fits a ring course better than a duel: a release window drawn
in the air, scored by where the bombs landed. It becomes a duel once a flak gun
or a fighter is added (sections 2 and 3).

## 5. Naval

### What decides it in BF1942

- **Ships under way.** The page drives a ship by the server's per-tick law
  (SHIPLAW-1..SHIPLAW-4). The lab Daihatsu replays to 0.27-0.38 mm. The
  Hatsuzuki and the hull against the sea bed are open
  (`features/ship-ground-law`).
- **Submarines.** A submarine's trim angle is a dive-depth setpoint, and it
  does not sink without limit (the SHIP-7 reversal,
  `features/bf1942-ships-research-2026-09-22/VERDICT.md` 2.1). The dive law is
  in `viewer/body-float.js`, but it is not on a control: a Gato drives and
  floats, and does not dive (`features/viewer-ships/README.md` section 7,
  item 2).
- **Depth charges.** Under water the fuse is different: it goes off near an
  object of 50,000 or more whose height is within the distance, which is 50 m
  for a depth charge (PROX-4, PROX-8). A charge that sinks past a submarine at
  the same height bursts.
- **Damage.** A torpedo hit costs 140 against a ship's material 55, and bomb
  splash costs ships nothing (section 4). The ship's big guns are large-bore
  units, and the bot rules for them are AI-54. Boat steering is AI-49, and
  the water maps are AI-58 and AI-66.
- **Sonar.** The destroyer's sonar scope is built (`features/vehicle-radar`,
  SONAR-1..SONAR-8).

### Doctrine and lore

- **Submarines.** WWII doctrine aimed for a torpedo track angle near 90
  degrees, broadside to the target, with the lead set by the ratio of target
  to torpedo speed
  ([US Navy submarine doctrine, ch. IV](https://www.ibiblio.org/hyperwar/USN/ref/SS-Doct/SS-Doct-4.html);
  [SimHQ, straight-running torpedo attacks](https://www.simhq.com/_naval/naval_009c.html)).
- **Escorts.** A depth-charge attack meant running over the contact, and a
  submarine escaped by going deep, turning and hiding in the disturbed water.
  Several escorts closed that escape
  ([Wikipedia, anti-submarine weapon](https://en.wikipedia.org/wiki/Anti-submarine_weapon);
  [the U-575 action report](https://www.uboatarchive.net/U-575A/U-575HaverfieldReport.htm)).
- **BF1942 lore.** A destroyer turns to bring both big guns to bear. To hunt a
  submarine it crosses directly over it, stern first, and drops its ten
  charges. A submarine stays on the surface until it hears a plane or sees a
  ship, then dives. Allied boats dive deeper than Axis ones. Two torpedoes at
  a good angle sink a submarine. A carrier kept parallel to the map edge is
  hard to attack, because attackers get the "leaving the battlefield" warning
  ([Tips and Tactics](https://realtimerendering.com/erich/bf1942/tips.html)).

### Candidate lessons

| Lesson | Situation | Move | Counter |
|---|---|---|---|
| The broadside | Two destroyers closing | Turn to unmask both turrets, and hold a range where your fall of shot walks on | The other turns bow-on to shrink the target, and closes or opens the range to break the walk |
| The 90 degree shot | A submarine or a torpedo plane on a ship under way | Lead to a 90 degree track | The ship combs the track: it turns toward or away and puts its narrow end along the torpedo's line |
| Over the top | A destroyer on a submarine at periscope depth | Cross the boat's position stern first and lay the charges across its course | The submarine dives on hearing the screws and turns off its course, so the pattern lands where it would have been |
| The run in | A landing craft to a defended beach | Weave, and land away from the gun's arc | The beach gun fires where the craft must ground, not where it is now |

### How hard to build

| Part | State |
|---|---|
| Surface ships and their guns | Physics measured. Bots have boat steering and large-bore fire, but no plans |
| Submarine | Needs the dive put on a control before any submarine lesson |
| Pace | A fight lasts minutes, not seconds. The theatre would have to play at high speed and the nine-start grid cost more node time |
| Recordings | The detector would need ships as parties and a much larger miss distance for slow, long-flight shells. The naval maps (Midway, Coral Sea, Iwo Jima's fleet) are played less, so expect few fights |
| Carriers and landing craft | These are logistics and nerve, not duels. A carrier lesson is a landing and take-off course (`features/aircraft-ground-law` has the deck), not a fight |

## 6. Light vehicles and the APC role

### What decides it in BF1942

- **The ram.** A collision costs hit points for every armoured object (HP-6,
  refuted twice). Between objects the price is the attacker's `damageMod`
  times the same angle factor as a round (COL-3, DMG-4).
- **Speed.** Cars run on the server's law (`features/car-ground-law`). A Willy
  goes critical at 6 hit points and a Hanomag at 16 (ARM-2).
- **Mines.** A jeep is heavier than a mine and fast, so it always sets one off
  (PROX-3).
- **The APC.** The half-track's own locker serves only its passengers (SUP-20).

### Doctrine and lore

The real APC carried a squad to the fight and gave it a gun. US doctrine
paired armoured infantry with tanks so that each covered the other
([wfgamers, infantry-armour co-operation](https://www.wfgamers.org.uk/club-members-pages/the-british-and-canadian-infantry-in-normandy/infantry-and-armour-cooperation-1)).

BF1942's jeep lore is all tricks:

- Ram a tank at full speed and jump out just before the hit, so the jeep
  slows and you may live.
- Load explosives packs in the back, the "jeep bomb".
- Reverse before an oncoming jeep hits you, to cut the damage.
- The "bullfight": wait for a jeep to charge, then throw a mine in its path or
  fire a rocket at it
  ([Tips and Tactics](https://realtimerendering.com/erich/bf1942/tips.html)).

### Candidate lessons

| Lesson | Situation | Move | Counter |
|---|---|---|---|
| The bullfight | A jeep charging a soldier with mines or a bazooka | Stand, throw the mine on its line at the last moment, then step aside | The driver swerves late, or brings a gunner to shoot the soldier first |
| The drive-by | A jeep with a gunner against infantry in the open | Circle at speed, so the gunner's target never stops | Go prone and shoot the driver: one man kills two seats |
| The jeep bomb | A jeep with packs against a tank | Hit the tank side-on and set the packs off | The tank shoots the driver on approach, or turns its front |

### How hard to build

The physics are there: the car law, collisions, mines and the packs. The
format fits poorly. Most of these fights end in a single collision or
explosion. The counters are reflexes, not manoeuvres, and multi-seat jeeps
need section 8's work. An APC lesson is really a combined-arms lesson. This
is best as a page of tips in another school.

## 7. Artillery and spotting

### What decides it in BF1942

- **The marker.** A `magType 2` weapon (the binoculars) places a marker by a
  ray from the eye, one per weapon (SPOT-1..SPOT-3). The game keeps a list of
  live markers, both teams' (SPOT-4).
- **The gun seat.** Only a seat whose template has `artPos 1` can look through
  a marker, with view mode 17 (SPOT-6, SPOT-7). The view eases toward the
  seat's latest shell (SPOT-11).
- **Bots.** They take no part in spotting (SPOT-14). A self-propelled gun's
  driver works the hull for its gun seat and never fires (SPOT-16).
- **What is built.** The whole local flow is built and the replay draws
  markers (`features/artillery-spotting`, 2026-10-10 and 2026-11-01).
- **The key fact for a lesson.** The marker is fixed where it was placed.
  Moving away from it is a defence.

### Doctrine and lore

US forward observers brought fire in by bracketing: they watched the fall of
shot and corrected
([Bracketing the Enemy, review](https://www.libraryjournal.com/review/bracketing-the-enemy-forward-observers-in-world-war-ii)).
Counter-battery work plotted guns by sound and flash, and German batteries
fired a few rounds and moved before the reply
([British Artillery in WW2, target acquisition](https://britishartillery.co.uk/tgtacqcb.htm)).

BF1942 lore:

- Spot once and stay quiet for about two minutes. A scout needs about two
  seconds on the binoculars.
- The Wespe reaches about 3.1 grid squares on Market Garden, with about 10 s
  of flight.
- Artillery is vulnerable except on the lower half of its front and sides.
  Park beside an ammo box to resupply
  ([Tips and Tactics](https://realtimerendering.com/erich/bf1942/tips.html)).
- Tankers walk artillery through an area of bazooka men before they push in,
  and kill enemy artillery with the main gun plus a full co-ax belt in the
  reload
  ([Panzaman](https://www.realtimerendering.com/erich/bf1942/tankvstank.html)).

### Candidate lessons

| Lesson | Situation | Move | Counter |
|---|---|---|---|
| Walk the shells | A spotter and a gun on a parked tank | Mark, watch the fall through the scout view, correct by elevation | The tank leaves the marked spot: the marker is fixed and the shells are 10 s in flight |
| Find the gun | The receiving side of a barrage | Read the shell's arc back to the battery, and send a plane or a tank | The battery moves after a few rounds, the German practice |
| Spotter against sniper | A scout on binoculars on a hill, and a sniper hunting them | Stay still for the two seconds, then drop behind the crest | The sniper watches the crest line where the scout must reappear |

### How hard to build

The parts are built, but the format fits badly. Fights are indirect and slow,
there is no bot that spots, and the score is a hit on a marker, not a duel.
"Walk the shells" makes a good interactive explainer or range. Detection is
possible: a recording carries markers and each shell's firing moment, so a
detector can link a marker, the gun seat that fired near it and the hulls that
died there.

## 8. Combined arms and team fights

The best BF1942 play is teamwork: the tank with its engineer, the AT team with
infantry cover, the bomber with an escort, the Thach weave.

The Thach weave is two fighters abreast, about one turn radius apart. When an
enemy attacks one of them, both turn toward each other, so the attacker who
follows is dragged across the wingman's guns head-on
([Wikipedia, Thach Weave](https://en.wikipedia.org/wiki/Thach_Weave);
[Vintage Aviation News, Midway](https://vintageaviationnews.com/aviation-history/the-battle-of-midway-and-the-debut-of-the-thach-weave.html)).

### Candidate lessons

| Lesson | Seats | Move | Counter |
|---|---|---|---|
| The Thach weave | Two fighters against one | Weave toward each other when one is attacked | The attacker breaks off the dragged one and goes for the wingman before the weave completes, or attacks from high so the weave's geometry fails |
| Tank and engineer | A tank and an engineer against an AT soldier | The engineer stays behind the hull, repairs in the AT soldier's reload, and calls the window | The AT soldier shoots the engineer first |
| Escort | A bomber and a fighter against a fighter | The escort stays high and pounces on the interceptor's attack | The interceptor makes a high front pass on the bomber that the escort cannot catch |
| Infantry escort | A tank and two riflemen against an AT team in a building | The riflemen clear the window before the tank enters the street | The AT team takes the rear shot from a second building, the doctrine's pair 100 m apart |

### What multi-seat lessons would need

1. **An N-seat duel.** `runDuel` takes `sides` and keeps arrays of two
   (`tracks`, `hits`, `onTarget`). Generalised, it takes seats with a team,
   and each brain reads the geometry to every enemy, not to "the other".
   Multi-crew hulls (a bomber's gunners, a tank's co-ax, a jeep's gunner) are
   the same change: several brains on one body.
2. **A friendly bot with a plan.** The wingman flies its own move, keyed to
   the leader's state. The live fight would then put a bot wingman beside the
   human, and the coach would call the moment: "drag them across".
3. **Team scoring.** Dip, Flip and Ninja become per team. A weave works when
   the attacked plane takes no round and the attacker meets the wingman's guns
   inside N seconds.
4. **The nine starts.** An L9 array has room for four factors. With more seats
   there are more nudges, so it needs an L18 or a choice of which seats move.
5. **Communication.** Real play uses the radio (`RADIO`) and the request keys,
   so a lesson can show the call as part of the move.
6. **Two humans.** The browser game has multiplayer (`netcode-play-multiplayer`),
   so a two-person lesson, with two people flying the weave against a bot ace,
   is possible later. It is not needed first.

Fit 3: the value is high and so is the cost. Do it after the single-seat
schools have their brains, because every team lesson reuses them.

## Where the dogfight detector generalises cheaply

`viewer/dogfight-detect.js` finds a pair of opposed parties, counts aimed
shots (a round whose flight passes within a miss distance of where the target
really went), joins evidence into runs with a gap limit, and names an ending.
Only three things in it belong to aircraft:

- who counts as a party (the catalogue's `category: 'air'`, a speed gate)
- the aimed-shot test (400 m/s, 1.5 s, a 25 m miss)
- the gunner and AA exclusions in rule 3

| Match-up | Party test | Aimed shot | Cost |
|---|---|---|---|
| Fighter against bomber, with gunners | As now, plus the bomber's gunner seats credited to its side | As now | **Smallest**. Drop the gunner exclusion and attribute seats |
| AA against aircraft | An AA gun seat (`setIsAntiAircraft`, AI-78) and a plane | The shell's flight, with its 0.8-1.4 s lifetime, passes within 20 m (the burst) of the plane | **Small**. The plane track is the same, and the shell is a parameter set |
| Infantry AT against a tank | A soldier holding an AT kit, and a land hull of category armour | The rocket at 50 m/s under 0.2 g, a miss within a few metres of the hull's box. Evidence also includes the hull's hit points falling | **Small to medium**. The ballistic projection is new, but kills are already classed (`tank-buster`) and the fire moments are recorded |
| Tank against tank | Two armour hulls (the tank study's) | Each gun's muzzle speed, with a few metres' miss | Medium. The same as above, with turret aim |
| Naval | Two ships, or a ship and a submarine | Large-bore shells over seconds of flight, with a large miss | Medium. Long runs, and few fights |
| Mines, packs, artillery | No aimed shot. The evidence is a placement (Landmine and ExpPack are networked objects, so they are recorded: `features/round-replay-capture` section 14) and a detonation or marker near a hull | Not an aimed-shot detector. It is an "event near a party" detector | Medium, and a different design |

The recording side is in good shape. Every weapon's firing moment is recorded,
each hull's hit points are recorded, and the kill line names the weapon's stat
id (KILLSTAMP-1). So "fights, not just kills" can be mined for the top three
match-ups with the same machinery.

## Sources

Repo:

- `features/dogfight-school/README.md`, `features/dogfight-recordings/README.md`
- `features/bf1942-3d-models/README.md` ("The face material")
- `features/flak-proximity-fuse/README.md`
- `features/plane-bombs-and-torpedoes/README.md`, `BUILD.md`
- `features/bot-weapons/README.md`, `features/bot-gunner-aim/README.md`
- `features/tank-ground-law`, `features/ship-ground-law`, `features/viewer-ships`
- `features/bf1942-ships-research-2026-09-22/VERDICT.md`
- `features/artillery-spotting`, `features/replay-shorts/README.md`,
  `features/round-replay-capture/README.md`
- Ledger rows: DMG-1..DMG-4, HP-6, HP-9, HP-9c..HP-9f, HP-10, HP-12, HP-15,
  HP-17, HP-19, ARM-2, PROX-1..PROX-8, BOMB-1..BOMB-13, GUN-2, GUN-20, SUP-19,
  SUP-20, AI-18, AI-45, AI-47, AI-49, AI-54..AI-61, AI-78, SHIPLAW-1..4,
  SHIP-7, SPOT-1..SPOT-16, COL-3, KILLSTAMP-1

Web:

- [Battlefield 1942 Tips and Tactics (Eric Haines' collection)](https://realtimerendering.com/erich/bf1942/tips.html)
- [Panzaman's Battlefield 1942 tank tutorial](https://www.realtimerendering.com/erich/bf1942/tankvstank.html)
- [ludo.guide, BF1942 medium bomber](https://www.ludo.guide/guide/battlefield-1942/medium-bomber)
- [Wikipedia, Panzerschreck](https://en.wikipedia.org/wiki/Panzerschreck);
  [The Armory Life, Panzerschreck](https://www.thearmorylife.com/german-panzerschreck/)
- [warhistory.org, US Army tactics WWII](https://warhistory.org/2015/10/22/us-army-tactics-wwii/);
  [wfgamers, infantry and armour co-operation](https://www.wfgamers.org.uk/club-members-pages/the-british-and-canadian-infantry-in-normandy/infantry-and-armour-cooperation-1)
- [World War Wings, why German fighters attacked B-17s head-on](https://worldwarwings.com/b17s-weakest/);
  [warhistory.org, attacking a B-17 formation](https://warhistory.org/2020/12/23/attacking-a-b-17-formation-from-the-german-side/);
  [The Armory Life, B-17 gunners](https://www.thearmorylife.com/b-17-gunners-vs-luftwaffe/)
- [ww2-weapons, dive bombing tactics](https://ww2-weapons.com/dive-bombing-tactics);
  [acepilots, Ju 87](https://acepilots.com/german/ju87.html)
- [The Aviationist, AAF flak film](https://theaviationist.com/2014/05/18/flak-in-wwii-video);
  [Lone Sentry, P-38s evade AA](https://www.lonesentry.com/blog/p-38s-evade-japanese-aa-by-continuous-turn.html);
  [Warbird Information Exchange, ground attack](https://www.warbirdinformationexchange.org/phpBB3/viewtopic.php?p=474267)
- [US Navy submarine doctrine, ch. IV](https://www.ibiblio.org/hyperwar/USN/ref/SS-Doct/SS-Doct-4.html);
  [SimHQ, straight-running torpedo attacks](https://www.simhq.com/_naval/naval_009c.html);
  [Wikipedia, anti-submarine weapon](https://en.wikipedia.org/wiki/Anti-submarine_weapon);
  [U-575 action report](https://www.uboatarchive.net/U-575A/U-575HaverfieldReport.htm)
- [Library Journal, Bracketing the Enemy](https://www.libraryjournal.com/review/bracketing-the-enemy-forward-observers-in-world-war-ii);
  [British Artillery in WW2, target acquisition and counter-battery](https://britishartillery.co.uk/tgtacqcb.htm)
- [Wikipedia, Thach Weave](https://en.wikipedia.org/wiki/Thach_Weave);
  [Vintage Aviation News, the Thach weave at Midway](https://vintageaviationnews.com/aviation-history/the-battle-of-midway-and-the-debut-of-the-thach-weave.html)
