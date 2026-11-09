# Tank school: what the engine does in a tank fight

Research for a planning exercise, 2026-11-09. Nothing is built. This page is
the engine side of a tank school modelled on the dogfight school
([`features/dogfight-school`](../dogfight-school/README.md)). The doctrine
side is [`tanks-tactics.md`](tanks-tactics.md). The question here is which
tank lessons are real in BF1942 and which are only real-world doctrine.

Status words used below:

- **Confirmed**: a ledger row with a binary address
  (`features/bf1942-engine-reference/ledger.md`).
- **Data**: read from the vanilla `.con` files, `Game.rfa`'s material tables,
  or the exported glbs' collision meshes.
- **Measured**: run through the viewer's own code in node for this note. That
  code is the page's port of the server's law, held to the lab server.
- **Inferred**: follows from the above but was not read or measured directly.
- **Unknown**: not settled anywhere in the repo.

Vanilla only (`bf1942`). Secret Weapons and Road to Rome tanks were not
surveyed.

## The short answer

The owner's intuition, that a dogfight is about manoeuvring and a tank fight
is about pre-positioning and then shooting well, fits the engine better than
it fits real tanks.

1. **Armour direction is real.** Each collision face carries a defence
   material, and the price of a hit depends on it.
   - A Sherman round does 4x on a Panzer IV's front and 10x on its rear.
   - A square hit on the rear plate with the Sherman's, Panzer IV's or
     T-34-85's gun, or with a bazooka, is a one-shot kill on a 100 HP tank.
   - The Tiger, T-34 (76) and M10 have no rear material. Their rear is side
     armour.
2. **Sloped armour is real, but angling the hull barely helps.**
   - The angle term is `sin(|cos|·π/2)` (DMG-4). It is flat near square: 30
     degrees off square still does 0.98, 45 degrees does 0.90.
   - A sloped plate in the mesh itself (the Sherman's glacis, 60 degrees)
     does take 0.71.
   - Angling the hull a little shows more of the weaker side armour and almost
     doubles the silhouette. On these numbers it is a losing trade.
3. **Hull-down is real.**
   - Rounds collide with the terrain heightfield, statics and tree trunks.
   - The hull and turret are separate collision parts.
   - The gun and eye sit 0.1 to 0.4 m above the hull roof.
   - A crest can therefore hide the whole hull while the gun still clears it.
   - A hull-down tank shows a band of turret about 0.5 to 0.8 m tall, roughly
     a fifth of its frontal area. Bushes stop nothing.
4. **Shells are slow and fall hard.**
   - The main guns fire at 100 m/s (the Chi-ha at 80) under 14.73 m/s² of
     gravity. The Panzer IV and Chi-ha shells take half of that.
   - A Sherman shell is in the air 1 s at 100 m, 2 s at 200 m and 4 s at
     400 m. It falls 6 m, 27 m and 112 m below the bore line over those
     ranges.
   - The gun cannot reach much past 450 m on flat ground.
   - The firing hull's velocity is added to the shell.
   - A human's main gun has no deviation at all.
   - So "being a good shot" means estimating range, holding over, leading,
     and not shooting on the move.
5. **A headless duel rig is mostly there.**
   - `tracked-vehicle.js` already runs in node: the ground-drive census and
     the tank-law harness both use it.
   - The match runner (`sim/`) already flies vehicle rounds against real
     terrain and real hull meshes headless.
   - What is missing is a scripted tank crew (the counterpart of
     `dogfight-pilot.js`), duel staging on a terrain fixture, and scoring.

## 1. Where a tank is hit

### The law

A direct hit costs `angleFactor × damageMod(attGroup(round), defGroup(struck
face)) × materialDamage(round)`.

- The law itself is confirmed: DMG-3, `handleCollisionForProjectile`
  `0x08153ba0`.
- The angle factor is `angleMod + (1 − angleMod)·sin(|cos|·π/2)`. Ground
  vehicles author no `angleMod`, so it is 0 and the factor is the bare sine
  (DMG-4, confirmed).
- A pair with no table cell does no damage at all (DMG-1).
- The damage goes to the nearest ancestor with an Armor, which is the hull
  root (HP-7). A turret hit therefore spends the hull's hit points.
- Tank shells declare no distance falloff, so range does not reduce damage
  (data: no `distToStartLoseDamage` in any vanilla tank `Weapons.con`).

**Which face counts.** The struck face is a face of the part's collision
mesh, and each face carries a material byte.

- A round meets the hull's col1 faces (COL-6, COL-19). A part with only one
  layer falls back to col0.
- The exporter keeps that detailed layer with `extras.defenseMaterial` per
  primitive (`features/bf1942-3d-models/README.md`, "Collision and armour
  inspection").
- The turret's mesh is a child of the turret, so it turns with the traverse.
  That is inferred for the engine, where the part is in the root's collision
  chain (COL-17), and built in the viewer.
- Vanilla's tank face materials are 50 (rear), 51 (side), 52 (front), 53 and
  54 (heavier). The names come from the Damage System tutorial
  (`viewer/proving-ground-page.js` `materialName`). The numbers that matter
  are the table cells below.

### Which material is where (data)

These rows come from the collision triangles of the published glbs in
`~/.cache/bfstats-mesh-remote/glbs/`. The first five columns are shares of
the silhouette seen from that side; the last column is the turret.

| Tank | Front | Side | Rear | Roof | Belly | Turret |
|---|---|---|---|---|---|---|
| Sherman | 52 (glacis sloped 60°, lower plate near vertical) | 51 | 50 | rear deck 50, front deck 51 | 50 | 52 front and sides, 50 roof and rear |
| Panzer IV | 52 | 51 | 50 | 50 and 51 | 50 | 52 front and sides, 50 rear |
| T-34-85 | 52 | 51 | 50 | 51 and 50 | 50 | 52, roof 50 |
| Chi-ha | 52 | 51, with 50 low on the side | 50 | 50 | 50 | 52, roof and rear 50 |
| Tiger | 54 | 51 upper, 53 lower | **51** | 53 and 51 | 51 and 53 | **54 all round** |
| T-34 (76) | 54 | 51 and 53 | **51** | 53 and 51 | 51 | 54 front, 51 sides and rear |
| M10 | 54 | 51 and 53 | **51** | 51 and 54 | 51 | 54 front, 51 sides |

- The road wheels carry material 178 or 37, and neither has a cell against a
  shell. Their col0 probe is a point, not a face, so tracks and wheels are
  not a target (data).
- Small weak spots:
  - The Sherman's hull Browning and the pintle MG42s on the Panzer IV and
    T-34-85 are material 50. A shell that meets one does rear-armour damage.
  - The barrel is 51 on most tanks.
  - Each of these is about 1% of the silhouette.

### What a hit costs (data)

`materialDamage × damageMod` for a square hit. The angle factor then
multiplies it. The table is `_shared/damage.json`, `Game.rfa`'s scripts
replayed in the engine's order.

| Round (material) | base | on 50 | 51 | 52 | 53 | 54 | 46 / 47 light |
|---|---|---|---|---|---|---|---|
| Sherman, T-34-85 shell (236) | 10 | **100** | 50 | 40 | 25 | 10 | 35 / 30 |
| Panzer IV, Chi-ha shell (237) | 10 | **100** | 50 | 40 | 25 | 10 | 35 / 30 |
| T-34, M10 shell (238) | 13 | **156** | 91 | 52 | 39 | 26 | 104 / 78 |
| Tiger shell (239) | 11 | **132** | 77 | 44 | 33 | 22 | 88 / 66 |
| Bazooka, Panzerschreck (226) | 10 | **100** | 35 | 26 | 19 | 13 | 50 / 25 |
| Priest howitzer (240), direct | 7 | 70 | 56 | 42 | 28 | 21 | 42 / 28 |
| Wespe howitzer (241), direct | 10 | 100 | 80 | 60 | 40 | 30 | 80 / 60 |
| Fighter and dive bomb (242), direct | 10 | 200 | 200 | 200 | 150 | 100 | 200 |
| Defgun (252) | 10 | 120 | 100 | 80 | 60 | 30 | 100 / 80 |
| Machine guns, rifles (215 to 219) | 5 | 0 | 0 | 0 | 0 | 0 | 0 |

Splash goes against the hull's root material, which is 50 on every vanilla
tank and 45 on the half-tracks and SPGs. It falls off linearly to the
victim's origin and is not blocked by anything for a non-soldier (HP-9,
confirmed).

| Splash (material2), radius | Peak on a tank (root 50) |
|---|---|
| Tank HE (206, 207) | **none**: no cell for any ground vehicle (DMG-2, confirmed) |
| Bazooka (200), 4 m | 1 |
| Artillery (201), 15 m | 50 |
| Fighter and dive bomb (202, 203), 20 m | 60 |
| Explosives pack and heavy bomb (204), 12 m and 30 m | 70 |
| Grenade (205) | 20 |
| AT mine (232), 4 m | **3,000**, a kill from anywhere it can burst |

**The mine's fuse.** A mine bursts only for an object that:

- is within 3 m;
- outweighs the mine's 130 kg mass;
- weighs at most 100,000; and
- **moves at 2.5 m/s or more**.

A soldier never sets it off (PROX-2, PROX-3, PROX-8, confirmed). A tank
creeping under 2.5 m/s (9 km/h) does not trigger a mine. That is a real
engine lesson for the school.

### Hit points, critical, shots to kill

**Hit points (data).** Every vanilla tank has 100 HP except the Tiger,
which has 125. The Priest and Wespe have 50; the Hanomag and M3A1 have 100.

**The critical state (confirmed).**

- Every tank has `criticalDamage 12`. At or under 12 HP the hull is
  critical (the test is `hitPoints <= criticalDamage`; HP-17,
  `hitpoints-and-damage.md`).
- A critical hull bleeds 1.5 HP a second, billed once a second (HP-5,
  HP-17). It burns out about 8 s after crossing unless it is repaired.
- A critical hull's turret takes 0.2x of the player's input on all three
  axes (HP-15). That is 7 deg/s instead of 35 on a Sherman.
- Whether the drive is slowed too is **unknown**. HP-15 names
  `RotationalBundle::handlePlayerInput`, and whether the Engine goes through
  it was not read.
- A destroyed hull takes no input (HP-15).

**Two ways one shot "kills".**

- A square Sherman hit on a Panzer IV's rear plate does exactly 100 damage.
  Death is `hp <= 0.001` (HP-2), so the tank dies outright.
- The same hit 20 degrees off square does 99.6. The tank is left at 0.4 HP,
  critical, and burns out within a second or two.
- So "one rear shot" is a kill either way. The kill credit and the crew's
  time to bail differ.

**Expected shots to kill.** These come from a raycast for this note
(scratchpad `rays.py`).

- Rays on a 12 cm grid were cast at each hull, horizontally from each
  bearing.
- The first collision face each ray meets was priced with its material and
  the sine factor, and the hits were averaged.
- `ceil(HP / mean)` was taken. A real gunner who picks a spot does better
  than this.

| Target | Shooter | From the front | Side (90°) | Rear (180°) |
|---|---|---|---|---|
| Sherman | Panzer IV | 37 a hit, 3 shots | 49, 3 | 74, 2 (a square rear-plate hit: 1) |
| Sherman | Tiger | 44, 3 | 73, 2 | 99, 2 (square: 1) |
| Panzer IV | Sherman | 34, 3 | 48, 3 | 71, 2 (square: 1) |
| Panzer IV | T-34 | 48, 3 | 85, 2 | 111, 1 |
| Tiger | Sherman | **14, 9** (square on 54: 13) | 34, 4 | 38, 4 |
| Tiger | T-34 / M10 | 31, 4 | 61, 3 | 70, 2 |
| T-34 | Panzer IV | 17, 7 | 34, 3 | 46, 3 |
| T-34-85 | Tiger | 47, 3 | 71, 2 | 104, 1 |
| M10 | Panzer IV | 17, 6 | 34, 3 | 36, 3 |
| Chi-ha | Sherman | 33, 4 | 57, 2 | 82, 2 |
| Any 100 HP tank with 50 rear | Bazooka | 23 to 27, 4 to 5 | 34, 3 | 66 to 80, 2 (square: 1) |
| Tiger | Bazooka | 14, 9 | 25, 5 | 28, 5 |

**What follows.**

- **Flanking is worth a factor of 2 to 3** against the 50-rear tanks
  (Sherman, Panzer IV, T-34-85, Chi-ha).
- **Against a Tiger, T-34 or M10, getting behind buys almost nothing over
  the side.** Their rear is 51.
- **Against a Tiger, the front costs a Sherman 9 shots.** At a 2.87 s reload
  that is about 26 s of firing, while the Tiger needs 3 shots at 4 s each.
- The light tanks' guns (236, 237) hurt the heavy group (53, 54) very little.
  The heavy guns (238, 239) do 2 to 2.6x more there. The tank pairs are
  asymmetric by design.
- From 20 degrees above (a hill, a ridge), the Sherman's and Panzer IV's
  roofs (50) start to show. A Panzer IV seen from the front at 20 degrees
  above shows 27% material 50, against 3% level.

### Hull angling (data and arithmetic)

The angle factor `sin(|cos θ|·π/2)` at angle θ off square:

| θ | 0 | 10 | 20 | 30 | 40 | 45 | 50 | 60 | 70 | 75 | 80 | 85 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| factor | 1.00 | 1.00 | 1.00 | 0.98 | 0.93 | 0.90 | 0.85 | 0.71 | 0.51 | 0.40 | 0.27 | 0.14 |

Turn a box hull α off the line of fire. The front plate is then met at α
and the side at 90 − α:

| Pair | Hull angled | Front hit | Side hit |
|---|---|---|---|
| Tiger shell on a Sherman (front 52, side 51) | 0° | 44 | (not visible) |
| | 15° | 44 | 30 |
| | 30° | 43 | 54 |
| | 45° | 39 | 69 |
| | 60° | 31 | 75 |
| Sherman shell on a Panzer IV | 30° | 39 | 35 |
| | 45° | 36 | 45 |
| Sherman shell on a Tiger (front 54, upper side 51) | 30° | 9.8 | 35 |
| | 45° | 9.0 | 45 |

The raycast says the same over the whole silhouette:

| | Front-on | 30° | 45° | Broadside |
|---|---|---|---|---|
| Sherman area, m² | 5.4 | 9.9 | 11.4 | 11.0 |
| Panzer IV round's mean damage on it | 37.1 | 33.8 | 39.4 | 49.3 |

**Verdict.**

- A 30° angle cuts the mean hit by 9% and nearly doubles the target.
- The Tiger's flanks (51 and 53) are 3.5x to 5x softer than its 54 front,
  so angling a Tiger is the worst trade of all.
- What the engine does reward is the slope already in the mesh. The
  Sherman's 60-degree glacis takes 0.71 of a flat shot, so its mean front
  factor is 0.86.
- The real-world rule "angle 30 to 45 degrees" is **doctrine, not engine**,
  here.
- One engine-true variant is a near-broadside angle of 70 degrees or more on
  the side plate. In practice that shows the rear arc.

### The gun facing away

The turret's mesh turns with the turret. On the Sherman, Panzer IV,
T-34-85 and Chi-ha the turret's rear and roof are material 50.

- A turret traversed 90° shows its 50 rear quarter to whatever it turned
  away from.
- "Keep the gun on the threat" is therefore an engine lesson as well as
  doctrine.
- This is inferred: it combines the mesh data with the turret part turning
  its collision.

## 2. The gun

| | Sherman | Panzer IV | Tiger | T-34 | T-34-85 | M10 | Chi-ha |
|---|---|---|---|---|---|---|---|
| Muzzle speed, m/s | 100 | 100 | 100 | 100 | 100 | 100 | 80 |
| `gravityModifier` | 1.0 | **0.5** | 1.0 | 1.0 | 1.0 | 1.0 | **0.5** |
| `roundOfFire`; time between shots (GUN-13, whole ticks) | 0.35; 2.87 s | 0.35; 2.87 s | 0.25; **4.0 s** | 0.35; 2.87 s | 0.35; 2.87 s | 0.25; 4.0 s | 0.35; 2.87 s |
| Turret traverse, deg/s (critical: 0.2x) | 35 | 35 | **20** | **20** | 35 | **20** | 35 |
| Gun elevation and depression; rate | +20 / −5°; 20 deg/s | +20 / −5°; 20 | +20 / −5°; **15** | +20 / −5°; 15 | +20 / −5°; 20 | +20 / −5°; 15 | +20 / −5°; 20 |
| Coax on alt-fire | Browning | MG42 | MG42 | MG42 | MG42 | Browning | MG42 |
| Second seat | hull and pintle Browning, outside | MG42, outside | none | none | MG42, outside | none | MG42, outside |

**Where the numbers come from.**

- Speeds, rates and gravity are data, from each tank's `Weapons.con`.
- Traverse and elevation are data, from the glbs' rig extras. The −20..+5
  bundle limits are 20 degrees up and 5 down (`seats-and-manned-guns.md`).
- The servo law is GUN-2, confirmed: a velocity servo at
  `acceleration 1000` deg/s², so effectively instant.
- `magSize 30`.
- Kasserine Pass carries its own Sherman, Panzer IV and Tiger guns at 300,
  375 and 500 m/s (data, the level's own `Weapons.con`). That level plays
  very differently.

**Flight (confirmed and computed).**

- Gravity is −14.73 m/s² times the round's `gravityModifier`, which defaults
  to 1 (IMP-7).
- There is no drag on any vanilla round (GUN-9).
- The round leaves with the firing hull's velocity added, plus 0.98 m/s of
  lift. It moves its first tick without gravity and steps four sub-steps a
  tick after that (FA-23, IMP-8).
- Integrated with that law, level fire:

| Range | Time of flight | Fall below the bore: g 1.0 / g 0.5 | Elevation to hit at the same height: g 1.0 / g 0.5 |
|---|---|---|---|
| 50 m | 0.5 s | 1.1 m / 0.3 m | 1.5° / 0.5° |
| 100 m | 1.0 s | 6.0 m / 2.5 m | 3.6° / 1.5° |
| 150 m | 1.5 s | 14.5 m / 6.5 m | |
| 200 m | 2.0 s | 26.6 m / 12.3 m | 7.8° / 3.6° |
| 300 m | 3.0 s | 62 m / 30 m | 12.4° / 5.7° |
| 400 m | 4.0 s | 112 m / 54 m | 17.2° / 7.9° |

- On flat ground, 20° of elevation reaches about **454 m** for a g 1.0 gun
  (4.8 s of flight) and 903 m for the Panzer IV (9.6 s). (First written as
  457 and 905 from a tick-sampled flight; the closed form in
  `viewer/tank-ballistics.js` lands between ticks, 2026-11-09.)
- The shells live 10 s.
- The Panzer IV's and Chi-ha's half gravity is a real asymmetry. Their
  shells fall less than half as far, so range errors cost them much less.

**Deviation (confirmed).**

- A seat gun's cone is `minDev + fire + AI` (DEV-11).
- No vanilla tank main gun authors any deviation words, so **a human's
  shell flies exactly down the bore** (`features/vehicle-gun-deviation`,
  "Tight guns").
- The hull's motion and the turret's traverse feed nothing into deviation
  (DEV-11).
- A bot's shell carries its AI term on top. The lab's bot tank-gun rounds
  land at a median of 1.2 to 1.3 hundredths of a radian off line, which is
  about 2.5 m at 200 m (`vehicle-gun-deviation`, "No-word guns").

**No zoom (confirmed).** No vanilla vehicle sets `vehicleFov`, `zoomFov` or
`useScope` (GUN-6). The gunner aims at the world's field of view.

- The eye is the seat camera on the gun base, so it elevates and traverses
  with the gun.
- Whether the HUD draws any range marks was not checked. The repo records
  none.

**What "being a good shot" means here.**

- **Range, hold-over and lead.**
  - At 100 m a Sherman shell lands 6 m below where the cross points. That is
    more than a hull's height, so any shot past about 50 m needs hold-over.
  - A target crossing at 13 m/s (a Tiger's top speed) at 200 m needs 26 m,
    about 7.5 degrees, of lead.
- **Stop to shoot.**
  - FA-23 adds the hull's own velocity to the shell. A Sherman at 14.6 m/s
    firing broadside throws its shell 14.6 m off line for every second of
    flight.
  - The shove of firing (`fireingForce 110`, FA-19,
    [`features/gun-hull-recoil`](../gun-hull-recoil/README.md)) moves the
    hull too.
  - Turning the hull swings the turret with it, since the tower is a child
    of the hull (inferred from the rig).
- **The first shot.** With no deviation, a stationary human gunner who has
  the range lands every shot. The skill is the estimate, not steadiness.
- **Where to aim on the target**, from section 1: rear plate, then side;
  never a Tiger's front.

## 3. Pre-positioning in the engine

### Hull-down is real (confirmed, data, inferred)

**Rounds collide with the terrain.** A round is swept against:

- the terrain heightfield, which is the collider: there is no terrain mesh
  (`features/bf1942-3d-models/projectile-collision.md`, HP-6c);
- the sea plane;
- every object that has `hasCollisionPhysics 1`. Every mobile body uses the
  broadphase, rounds included (COL-16, COL-17).

The heightfield is the bilinear patch of its four samples on a 4 m grid for
every vanilla 2048 m level (TERR-16). Crests are therefore as coarse as 4 m
in plan.

**The parts sit at these heights.** In the hull frame, from the glbs'
collision meshes:

| Tank | Belly | Hull roof | Eye (seat camera) | Muzzle | Turret top |
|---|---|---|---|---|---|
| Sherman | −0.84 | 0.95 | 1.15 | 1.15 | 1.71 |
| Panzer IV | −0.77 | 1.20 | 1.60 | 1.55 | 2.16 |
| Tiger | −0.99 | 0.87 | 0.97 | 0.97 | 1.50 |
| T-34 | −0.66 | 1.03 | 1.30 | 1.30 | 1.96 |
| M10 | −0.82 | 1.15 | 1.49 | 1.40 | 1.85 |
| Chi-ha | −0.83 | 0.61 | 0.96 | 0.91 | 1.42 |

**The eye and the muzzle sit 0.1 to 0.4 m above the hull roof.** So a crest
that reaches the muzzle line hides the whole hull.

- If the crew can see the target, the gun clears the crest. The seat camera
  is the gun's own.
- What shows is the turret band above the muzzle: about 0.55 m on a
  Sherman, 0.6 m on a Panzer IV, 0.5 m on a Tiger.
- That is about 1.1 to 1.3 m² of the Sherman's 5.4 m² frontal area.
- Every shell that would have struck the hull meets the crest instead.
- This is inferred from the geometry and the confirmed collision law. No
  run was made against a real crest.

**What hull-down does to the price of a hit** (data):

- On a Tiger the turret is 54 all round, so a hull-down Tiger is at its
  hardest.
- On a Sherman the turret front is 52, the same material as the glacis, but
  square-on. A turret hit costs 40 against the glacis's 28. Hull-down cuts
  the target to a fifth and makes each hit a little dearer.

**Depression limits the positions.** The gun depresses only 5 degrees. A
tank nosed up on a crest, or one firing down a slope at a target below it,
runs out of depression.

### Bushes hide; they do not protect (confirmed, inferred)

- A tree trunk with `setHasCollisionPhysics 1` and a collider stops rounds
  (TM-5, and `mesh-viewer-fidelity-defects/reports/R1-tree-collision.md`).
- Bushes, ferns and plants are fly-through: 31 of vanilla's 108 TreeMesh
  objects have neither the flag nor a collider.
- Some have a collider but no flag, and COL-17 drops those too. A round
  passes through them.
- A bush still hides a tank from a human, who sees the drawn foliage.
- Whether a bush blocks a bot's sense rays (`collideLineWithWorld`
  `0x085e3320`) is **inferred: no**, since the same collision flag governs
  the world ray.
- No vanilla tree carries Armor (ARM-3), so a shot does not clear foliage.

### Driving numbers (measured)

**How they were measured.**

- The scratchpad script `tanklaw.mjs` was derived from
  `tools/bf1942-models/surveys/census_ground_drive.mjs`.
- It drives each published glb through the page's `TrackedVehicle` on flat
  ground.
- That drive is the server's per-tick law (TANK-18..TANK-24). The lab
  Sherman holds it to 0.3 to 0.5 mm per ack
  ([`features/tank-ground-law`](../tank-ground-law/README.md)).
- The census flags no vanilla hull.

| | Sherman | Panzer IV | Tiger | T-34 | T-34-85 | M10 | Chi-ha |
|---|---|---|---|---|---|---|---|
| Top speed, m/s | 14.7 | 14.7 | 13.0 | 13.0 | 14.7 | 13.0 | 14.7 |
| From rest: 3 m / 5 m / 10 m, s | 1.27 / 1.57 / 2.13 | same | 1.33 / 1.63 / 2.20 | 1.33 / 1.63 / 2.20 | 1.27 / 1.57 / 2.13 | 1.33 / 1.63 / 2.17 | 1.27 / 1.57 / 2.13 |
| Reverse top speed, m/s | 4.0 | 4.0 | 3.5 | 3.5 | 4.0 | 3.5 | 4.0 |
| Reverse from rest: 3 m / 5 m / 10 m, s | 1.30 / 1.80 / 3.07 | same | 1.43 / 1.97 / 3.43 | 1.40 / 1.97 / 3.40 | 1.30 / 1.80 / 3.07 | 1.40 / 1.97 / 3.40 | 1.33 / 1.80 / 3.07 |
| Stop from top speed on reverse throttle, s | 1.0 | 1.0 | 0.9 | 0.9 | 1.0 | 0.9 | 1.0 |
| 90° from rest on throttle and full lock (moves about 1.6 to 2.4 m), s | 2.6 | 2.7 | 2.2 | 3.4 | 3.2 | 2.8 | 2.2 |
| 90° on the move at about 13 m/s, s | 2.0 | 2.0 | 1.8 | 2.3 | 2.2 | 2.2 | 1.7 |
| Turret 90° (180°), s | 2.6 (5.1) | 2.6 (5.1) | 4.5 (9.0) | 4.5 (9.0) | 2.6 (5.1) | 4.5 (9.0) | 2.6 (5.1) |

**No pivot on yaw alone.** At zero throttle a tank does not turn at all.
`getCurrentDifferentialRPM` multiplies by the throttle
(`subsystems/tank-driving.md`, from TANK-2, and measured: 0 degrees in 8 s).
A turn in place is throttle plus lock, which on these hulls turns 90 degrees
while moving only 1.6 to 2.4 m.

**The pop-up shot.** From turret-down, the steps are:

1. Drive up 3 to 5 m: 1.3 to 1.6 s.
2. Fire. The shell is 1 to 2 s in the air.
3. Reverse 3 to 5 m: 1.3 to 1.8 s.

- About 4 s of exposure, against a reload of 2.87 s (4 s on the Tiger, T-34
  and M10). A light tank can be back in cover before its gun is ready again.
- The opponent's reply needs a turret on line. At 35 deg/s a 45-degree
  correction takes 1.3 s; at 20 deg/s it takes 2.3 s.
- Then the reply flies 1 to 2 s of its own.
- Surprise and first shot are worth more here than in the real world,
  because flight times are long. These are inferred timings, assembled from
  the measured parts above.

**Two caveats.** The page's drive has no object contacts in this
measurement. The terrain's 4 m grid also limits how sharp a "crest" can be.

## 4. Crew and support

**Seats (data, glbs).**

- One player drives **and** fires the main gun and coax. The cannon is
  `c_PIFire`, the coax `c_PIAltFire` (`seats-and-manned-guns.md`).
- The Sherman, Panzer IV, T-34-85 and Chi-ha add an outside MG seat
  (`c_SeatIsOutside`, `c_SeatShowHalfBodySoldier`).
- The Tiger, T-34 and M10 are one-player tanks.
- Machine guns do no damage to any tank material (table above).

**Repair pad (data, SUP-19 and SUP-22, confirmed).**

- The vanilla `landrep1_supply` "repairpoint" is a `SupplyDepot` with radius
  5 m. It heals each listed tank 4 HP per cycle, unlimited, whether the tank
  is crewed or not.
- The cycle is 0.5 s (SUP-11 and SUP-12, `supply-and-health.md`), which
  gives 8 HP/s: a critical Sherman is back to full in about 11 s.
- Its list spells the T-34-85 as `T34-84`. Since the depot resolves rows by
  name, that pad would not repair a T-34-85. No vanilla Eastern Front level
  places the pad in its `.con` files, so this is moot in vanilla (inferred,
  grep of the level archives).
- Levels that place repair pads: Aberdeen, Gazala, Tobruk, Battle of the
  Bulge, Bocage, El Alamein, Liberation of Caen, Guadalcanal, Iwo Jima, Truk,
  Battle of Britain.

**The engineer's wrench (confirmed for the target and the amount).**

- `useRepairPack` heals the nearest wounded, undestroyed hull within its
  radius plus 2 m by `repairFactor` 0.15 HP per use
  (`features/viewer-healing-packs`, SUP-15).
- The use rate is `roundOfFire 10`, about 1.5 HP/s. The lab's begin-repair
  events come every 0.05 to 0.07 s (SUP-21), so the real rate may be closer
  to 2 HP/s. That is open.
- **A wrench roughly cancels a critical tank's 1.5 HP/s bleed.** It keeps a
  burning tank alive but cannot bring it back mid-fight. Restoring a
  Sherman from 12 to 100 takes about 1 minute.
- The engineer must be on foot beside the hull.

**The engineer as anti-tank (data).**

- An explosives pack (splash 204, radius 12 m) does up to 70 HP to a tank,
  measured to the hull's origin with linear falloff (HP-9). Two at the hull
  kill.
- AT mines kill outright (above), subject to the 2.5 m/s fuse rule.

## 5. Bots in tanks today

This section comes from a subagent's read of the `bot-*` code and the AI rows.

**Retail AI (confirmed rows).**

- **Lead.** The tank gunner leads with the Aimer, gravity included: AI-89,
  `Aimer::getFiringDirection` `0x08538ad0`, an elevation search on
  `g × gravityModifier`. AI-143 covers `exitVelocity`, which vanilla tanks do
  not set.
- **Aim point.** The Aimer aims at the target object's predicted position,
  which is its origin (AI-89).
- **Senses.**
  - It senses from the seat camera with the vehicle frustums: 75, 45 and
    15 degrees over the near, middle and far thirds of the view distance
    (AI-33, AI-67).
  - Its rays go to random points on the target's collision faces (AI-123).
    So it can see a turret above a crest.
- **Driving.**
  - The driver follows the tank law on the `Tank0` map (AI-45, AI-47,
    AI-53, AI-85, AI-86).
  - It fires from wherever it stands: it stops while it has a shot, and
    closes when it does not (AI-125, AI-126, AI-129).
- **TakeCover** urgency is halved in a vehicle (AI-41).
- **Nothing in the retail AI** angles a hull, seeks hull-down, flanks or
  picks a weak face.
- **Inferred:** a retail bot aiming at a hull-down tank's origin, which sits
  below the crest, puts its shell into the crest.

**AI data (data, `vehicle-ai.json`).**

- Every main gun is `minRange 2`, `maxRange 250`. A bot does not engage past
  about 250 m and closes to 0.9 x that.
- The strength tables prefer infantry. The Sherman, Panzer IV, T-34-85 and
  Chi-ha guns rate Infantry 10, LightArmour 7, HeavyArmour 2. The Tiger,
  T-34 and M10 guns rate 12, 10 and 6.
- Every tank is `HeavyArmour`, `coverValue 4`.

**The viewer (built).**

- `bot-vehicle.js` `tankControl`:
  - wants 20 m/s, capped at the hull's top speed;
  - steers inside 30 degrees;
  - turns on full lock at 2 m/s or less outside that;
  - reverses only to turn in a box.
- `bot-plans.js` `execFireApproach` stops to fire while in range, aimed and
  seen.
  - It drives at the target beyond 52 m.
  - Past 2 s without a shot it adds its own back-off (marked INVENTION).
- **Aim.**
  - `bot-aim.js` `turretAimAt` and `firingDirection` port the Aimer, with
    gravity, the AI-105 0.8 miss correction and the AI-145 fixed deviation
    point.
  - The aim point is the target's position + 1 m (`bot-plans.js:1054`,
    unsourced).
  - The sense rays aim at soldier heights, 0.3 to 1.55 m (an invention). A
    crest can therefore hide a hull from a viewer bot that a retail bot
    would see.
- **TakeCover** for a tank runs the infantry plan, and the 0.5x vehicle
  factor is missing (`bot-decision.js:363`).
- **Implication for the school.** Bots are a fair opponent for "be a good
  shot" lessons: they lead and allow for drop. They are a weak opponent for
  positioning lessons: they never take a hull-down or flank, and they do not
  value a tank as a target. A tank-school "ace" needs a scripted crew, as
  the dogfight school needed its pilots.

## 6. A headless tank duel rig

Could a `runDuel`-style node duel exist (`viewer/dogfight-duel.js`)?

**What exists and runs in node today.**

| Piece | Where | In node? |
|---|---|---|
| The drive | `viewer/tracked-vehicle.js`, `TrackedVehicle` | **Yes.** `surveys/census_ground_drive.mjs` drives every land hull from the glb (`server/glb-scene.mjs` `buildSceneTree`, `seats.js` `VehicleOccupancy.ensureDrive`). `tests/tank_law_harness.mjs` replays it on a real terrain window (`heightfieldFromSamples`, `WorldCollider`) |
| Terrain | `viewer/heightfield.js` `engineSurface` (TERR-16), `world-collider.js` | Yes. Terrain fixtures exist (`tests/fixtures/tank_law_wake_terrain.json.gz`). A synthetic crest is a samples array |
| Rounds and hits | `gunfire.js` `GunFire`, `projectile-flight.js` (the FA-23 tick law), `round-impact.js` (face material, DMG-4 sine), `vehicle-hits.js` | Yes. `sim/` imports them unmodified and fires vehicle guns headless on El Alamein and Wake (`sim/README.md`, `tests/test_sim_vehicles.py`) |
| Turret and gun rig | `seats.js` rigs, GUN-2 servo | Yes, with the drive |
| Bot gunner aim | `bot-aim.js` `firingDirection` | Yes, inside `sim/` |

**What is missing.**

1. **A tank crew policy**, the counterpart of `dogfight-pilot.js`: named
   moves (hull-down wait, pop-up, reverse, flank, shoot-and-scoot), with a
   gunner that estimates range and leads. Its perception should be
   `perceive()`-style: the seat camera's view, line of sight over the
   heightfield, foliage that hides without stopping.
2. **Duel staging.**
   - Place two hulls at poses on a terrain fixture, settle them, start.
   - This is cheaper than `sim/match.mjs`, which loads a whole level.
   - The terrain is the difference from the sky. A lesson is a terrain
     window plus starts, and "nine nudged starts" become nudges of position,
     heading and crest height.
3. **Scoring.** The dogfight's Dip, Flip and Ninja do not transfer directly.
   Candidates:
   - first hit;
   - hits by face material;
   - exposure seconds (time the enemy had line of sight to your hull);
   - time to kill;
   - shots fired against the reload clock.
4. **Gaps to check before trusting outcomes.**
   - The page drive's object contacts (open in `tank-ground-law`).
   - Whether the drive slows when critical (unknown).
   - The viewer's sense heights (invention).
   - Whether a round's sweep against the heightfield matches the server's
     on sharp crests (inferred, not lab-checked).

The deterministic 30 Hz tick law and seeded randomness are already the
runner's (`sim/README.md`: same seed, same match byte for byte). A
two-tank, 60 s duel on a terrain window should run in well under a second.
That is inferred from the census's ~30 ms a template and the runner's speed.

## 7. Tank fights in the round recordings

This section comes from a subagent's read of `features/round-replay-capture`
(RC), `features/server-replay-recorder` (SRR) and
`tools/bf1942-models/viewer/replay-recording.js`.

| Needed | Client recording | Server (lab) recording |
|---|---|---|
| Hull pose | `s` samples about 10 Hz, enemies only within view distance + 20 m (Kursk and Bocage 420 m, Berlin 120 m) | 30 Hz |
| Turret yaw, gun pitch | `jn`/`j` RotationalBundle angles. v5 keys each part; v4 files untangled by `replay-aim.js` to 0.08 to 0.27° | yes |
| Seats | `p` records, entry and exit events 0x0A and 0x0B | yes |
| Shots, with muzzle position and direction | `f`. A remote player's single tank-gun tap may be undercounted (RC 1011-1015) | yes |
| Shell tracks | **absent** | `pn`/`pj`/`pd`. All 23 El Alamein tank shells linked fire to impact |
| Impact point and struck object | **absent** | `i`, with a `dmg` flag, and `hg` |
| Face or material struck | absent | absent. It can be derived by casting the `i` point against the hull mesh |
| Hit points | `a` records on change; `crit` threshold in `o`; the disabled flag | yes, with the last hitter |
| Killer of a vehicle | **absent** (`lastHitPlayer` −1); only the end-of-round "destroyed" tally | yes |
| Repairs | absent; can be inferred from hp rising | `heal` events, kind `repair` or `depot` |

**So a `tank-duel-detect` on uploaded client files can find:**

- two opposing hulls in mutual range;
- turret-on-target time;
- shots and their aim;
- hp drops and the order of kills.

It cannot see:

- misses' fall points;
- the face hit;
- which round did the damage;
- who killed a hull.

Two clients' files of one round merge by net id (`round-replay-merge`).
Server recordings have everything except the face.

**Where tanks play (data).** Tank spawners per vanilla map, from the cached
`scene.json` `objectSpawns` (Conquest). Each spawner is a spawn point holding
one tank per side's template, not tanks alive at once.

| Map | Tank spawners | SPGs |
|---|---|---|
| Aberdeen | 22 | 4 |
| Gazala | 12 | 4 |
| El Alamein | 11 | 3 |
| Battle of the Bulge | 9 | 2 |
| Kursk | 7 | 2 |
| Market Garden | 7 | 1 |
| Battleaxe | 6 | 2 |
| Bocage | 4 | 1 |
| Stalingrad | 4 | 0 |
| Berlin, Iwo Jima, Wake | 3 | 0 |

- Not in the cache: Tobruk, Kharkov, Kasserine Pass, Omaha Beach, Liberation
  of Caen.
- The repo keeps **no** per-map vehicle-use or kills-by-vehicle statistics
  (`features/service-record/README.md`: "we record no weapon or kit use").
- Start a detector on the desert maps. El Alamein already has a server
  recording with shells linked end to end.

## 8. Real in the engine, or doctrine only

| Lesson | In BF1942? | Why |
|---|---|---|
| Shoot the rear and flanks | **Real**, large: 2 to 3x on the 50-rear tanks, 1 shot square | Section 1 |
| The rear is the weak spot on every tank | **False** for the Tiger, T-34 (76) and M10: rear is side armour | Section 1 |
| Angle the hull 30 to 45° | **Doctrine only**; a net loss | Section 1, angling |
| Sloped plates deflect | **Real**, in the mesh: the Sherman glacis takes 0.71 | DMG-4 and the glacis normals |
| Hull-down | **Real**: the terrain stops rounds, the gun sits above the roof, and a fifth of the silhouette shows | Section 3 |
| Hide in the bushes | Hides from humans; **does not stop rounds**; probably does not hide from bots | COL-17, TM-5 |
| Shoot from the halt | **Real**: the hull's velocity is added to the shell | FA-23 |
| Range estimation and hold-over | **Real and dominant**: 6 m of drop at 100 m | IMP-7, FA-23 |
| Lead a moving tank | **Real**: 1 to 4 s of flight | Section 2 |
| Track or immobilise shots | **Not in the engine**: wheels and tracks take no damage, there is no mobility kill | Wheel materials have no cells |
| Critical-damage "crippled" state | **Real**: the turret slows to a fifth and the hull burns out in about 8 s; the drive is unknown | HP-15, HP-17 |
| Creep through a minefield | **Real**: under 2.5 m/s a mine does not fuse | PROX-3 |
| HE against armour | **Useless** on tanks (DMG-2); good on infantry and aircraft | DMG-2 |
| Shoot and scoot | **Real** and rewarded: reload 2.9 to 4 s, reverse 5 m in 1.8 s | Section 3 |
| Engineer repairs mid-fight | Holds a burning tank level; a pad restores it in about 11 s | Section 4 |
| Gun depression limits a crest | **Real**: 5° | Section 2 |

## Open questions worth settling before lessons claim them

- Whether critical damage slows the drive as well as the turret (HP-15
  covers `RotationalBundle`; the Engine path is unread).
- The wrench's real use rate (SUP-15 marks the 10/s figure unverified;
  SUP-21's lab events suggest about 15/s).
- A crest test on the lab server: a hull-down Sherman shot at its hull.
  Does the round stop on the heightfield exactly where the page says?
- Whether bot sense rays pass through no-collision bushes (inferred yes).
- Whether the HUD's tank cross carries any range ladder.
- The retail aim point against a hull-down tank: is it the origin (inferred
  from AI-89), and does the Aimer's elevation search fail on the crest?

## How the numbers were made

The scratch scripts live in the session scratchpad, not in the repo. To
redo them:

- **Materials and areas.** Parse each tank's published glb (by `sha` from
  `~/.cache/bfstats-mesh-remote/models/models.json`, in `glbs/`). Take every
  node with `extras.collision`, apply the node transforms, and read each
  primitive's `extras.defenseMaterial`. The triangle winding is inward, so
  flip the normals.
- **Prices.** `materialDamage` and `modifiers` from
  `~/.cache/bfstats-mesh-remote/maps/_shared/damage.json`, through
  `attGroup` and `defGroup`.
- **Shots to kill.** Rays on a 12 cm grid, horizontal and at 20 degrees
  above, with first-hit pricing.
- **Driving.** A copy of `surveys/census_ground_drive.mjs` with its phases
  replaced, pointed at a temporary tree of symlinks to the cached glbs and
  `maps/_shared`.
- **Ballistics.** FA-23's point-body law in closed form per tick:
  `y = (v sinθ + 2g/30) t − g dt² (n − 1)(n − 0.75)/2`.
- **Weapon and hull words.** `Objects.rfa` read with `bf42/rfa.py` from the
  installed game:
  - `Vehicles/Land/<tank>/Weapons.con` and `Objects.con`;
  - `Buildings/Common/landrep1_supply/Objects.con`;
  - `HandWeapons/RepairPack/Objects.con`;
  - `Soldiers/Common/CommonSoldierData.inc`.
