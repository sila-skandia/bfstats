# Battle schools: infantry against infantry

Research for a planning exercise (2026-11-09). Nothing here is built. The
question is whether the dogfight school's approach can teach fights on foot:
bots that fight named moves on the game's own measured law, lessons that pair
a move with its counter and are flown from nine nudged starts, a theatre that
replays a fight, a live drill with a coach, and real fights mined from player
recordings and scored against their outcomes.

The dogfight school is `features/dogfight-school/README.md` ("How a move is
scored", "Every pilot sees only what a pilot could", "How it is built") and
`features/dogfight-recordings/README.md` ("How a dogfight is found", "Naming
the manoeuvres", "What the manoeuvres did").

Marking used throughout:

- **Confirmed** means a ledger row (`features/bf1942-engine-reference/ledger.md`)
  says so, cited by ID.
- **Read today** means this pass read it from the shipped `.con` files or the
  lab's `bf1942_lnxded` and no ledger row holds it yet. Each such item says what
  was read.
- **Derived** means arithmetic on confirmed laws. The numbers are as good as the
  laws, but nobody has measured them on the lab.
- **Inferred** means a reasonable reading that nothing has checked.
- **Player claim** means a sourced community statement (link given). It is
  not evidence about the engine.

## Verdict, in short

Infantry fits the school format, and in one respect better than air: the
laws that decide a fight on foot are short, read and measured. The cone law
(DEV-1 to DEV-15) is held to the lab server to 0.002. The move law (PHY-34)
is held to 1 mm, and the stance law (PHY-36, PHY-37) to 0.6 mm. Damage per
capsule (DMG-3, DIE-10) and grenade exposure (HP-10) are measured on the page.
The round's random draw is seeded from the input serial (DEV-9, DEV-14), so a
node duel can be exactly reproducible. A headless match runner already
exists (`tools/bf1942-models/sim/`).

Three things differ from air and shape everything else:

1. **Fights are short.** Best case, a BAR kills in 0.25 s and a Thompson in
   0.3 s. So the lesson is in the two seconds before the first round, not in
   a 40-second turn fight. The theatre has to be slow motion and about who saw
   whom first.
2. **The level's geometry is the fight.** Cover, corners and eye heights
   decide more than any manoeuvre. Lessons need small built sets (a corner, a
   sandbag line, a hedge), not open sky.
3. **Netcode matters.** The server rewinds a soldier by up to 0.3 s to judge
   a hit (read today, below). That gives the peeker an advantage, which the
   dogfight school never had to teach.

The blocker for a node duel: the eight hit capsules ride an animated
skeleton. The sim today scores every round on a 0.6 m stand-in sphere priced
as chest, which has no head and no stance. See "Could a headless duel exist".

---

## Part A. What the engine does

### A1. Hit points, the capsules and what each weapon does to them

A soldier has **30 HP** in vanilla (HP-11). A round's direct hit costs
`materialDamage x falloff x damageMod(weapon, capsule material)` (DMG-3). The
angle factor is 1 for a soldier, and friend or foe is not tested (FF-1).

**The capsules (DIE-10, confirmed; values read today from
`Objects/Soldiers/Common/CommonSoldierData.inc`):** eight
`setSkeletonCollisionBone` capsules, tested in declaration order. The
**first** capsule hit wins, not the nearest.

| Order | Bone | distSq | Radius | Material (price) |
|---|---|---|---|---|
| 1 | Head | 0.02 | 0.14 m | 40 head |
| 2 | Spine2 | 0.08 | 0.28 m | 41 chest |
| 3, 4 | L/R forearm | 0.02 | 0.14 m | 42 limb |
| 5, 6 | L/R calf | 0.03 | 0.17 m | 42 limb |
| 7, 8 | L/R foot | 0.035 | 0.19 m | 42 limb |

Two consequences:

- **Inferred:** there are no thigh, pelvis or upper-arm capsules, so a round
  through those parts of the drawn body meets nothing.
- **Inferred:** because the head is tested first, a round whose line passes
  through both the head and chest capsules is priced as a head hit, whichever
  it would have reached first. From the front, a prone soldier facing the
  shooter has the head and forearms in front of the chest. For a rifle, a
  prone target facing you is mostly a head shot.

**Damage per hit, from DMG-3** (the installed vanilla game's
`materialManagerSettings.con`, confirmed). Rate of fire, magazine and
velocity were read today from `Objects.rfa`. Projectiles have
`gravityModifier 0` and a 1 s life, so the rounds fly straight and go out to
their velocity in metres.

| Weapon (kit) | Head / chest / limb | Falloff | Rounds/s | Mag | Hits to kill head / chest / limb | Best-case kill, chest |
|---|---|---|---|---|---|---|
| K98, No4 (engineer) | 50 / 20 / 10 | none | 0.37 (bolt, 2.7 s) | 5 | 1 / 2 / 3 | 2.7 s |
| K98Sniper, No4Sniper (scout) | 50 / 20 / 10 | none | 0.30 (3.3 s) | 5 | 1 / 2 / 3 | 3.3 s |
| M1 Garand, Type5 (Marine and Japanese engineer) | 37.5 / 15 / 7.5 | none | 3.2 (semi) | 8, 10 | 1 / 2 / 4 | 0.31 s |
| BAR, Type99, Johnson (assault) | 22.5 / 14.4 / 9 | none | 8 (7.5 Johnson) | 20, 30 | 2 / 3 / 4 | 0.25 s |
| DP (Soviet assault) | 16.7 / 9.9 / 6.2 | none | 9 | 47 | 2 / 4 / 5 | 0.33 s |
| StG44 (German assault) | 15 / 9 / 5 | none | 9 | 30 | 2 / 4 / 6 | 0.33 s |
| Thompson (medic) | 15 / 9 / 5 | half, 40 to 80 m | 10 | 30 | 2 / 4 / 6 (4 / 7 / 12 past 80 m) | 0.30 s |
| MP40, MP18 (medic) | 15 / 9 / 5 | half, 40 to 80 m | 9 | 32 | 2 / 4 / 6 | 0.33 s |
| Colt, Walther P38 (pistol) | 17.5 / 10 / 5 | half, 20 to 40 m | 6 (semi) | 8 | 2 / 3 / 6 (4 / 6 / 12 past 40 m) | 0.33 s |
| Knife (all) | 32 / 16 / 8 | reach 3.3 m | 2 | - | 1 / 2 / 4 | 0.5 s |

Notes on the table:

- **Knife reach (read today):** `KnifeProjectile` lives 0.0665 s at 50 m/s,
  which is 3.3 m.
- **DP:** three chest hits come to 29.76 HP, 0.24 short of a kill. That is
  why it needs four (derived).
- **StG44:** its round is the Thompson's material (216) with no falloff words.
- **Patch 1.45:** Eric Haines' damage page
  ([weapons.html](https://www.realtimerendering.com/erich/bf1942/weapons.html),
  last changed 9 Sep 2003) agrees with every row except the StG44. Haines gives
  63/37/23% (2/3/5 hits), so the StG44 changed after 1.45.
- **Best-case kill** is the hits times the fire interval, with every round
  landing. The cone table below says how often they do.

What the table says for teaching (derived):

- **The bolt rifle is a one-shot head weapon and a slow chest weapon.** Two
  chest hits 2.7 s apart is a lifetime against anything automatic.
- **The Garand is the strongest rifle in the game.** It is two chest hits in a
  third of a second at a rifle's accuracy, but only Marines and Japanese
  engineers carry it, on six Pacific levels (`features/bf1942-3d-models/kit-loadouts.md`).
- **Inside 40 m, the SMG, StG44 and BAR are within 0.1 s of each other.** The
  difference between them is the cone, not the damage.

### A2. The cone: how stance, movement, firing and zoom change spread

The law, confirmed in both binaries and lab-measured (DEV-1, DEV-2, DEV-4,
DEV-6, DEV-12, DEV-15, `subsystems/handweapon-view-and-deviation.md` section 2):

```
total = minDev + fire + speed + turn + misc        (plain sum; minDev is NOT scaled by stance)
M     = setDevMod[stand | crouch | prone]
speed, turn, misc: raise M^2 x b per tick while the input is held, cap a x M, decay d / M per tick
fire:  + fireDev.b per round, cap fireDev.a, decay fireDev.c / M per tick
```

- **Clock:** one step per 1/30 s tick (DEV-5).
- **What a round reads:** the total stored at the last tick. A pull's own
  bloom reaches only the next round (DEV-12).
- **Units:** a hundredth of a radian, drawn **uniformly on each of two axes**,
  so the cone is a square, not a disc (DEV-9). At range R the round lands
  within `R x total / 100` metres of the aim point on each axis.
- **Movement is a key, not a speed (DEV-6).** The speed channel is gated on
  the forward and strafe inputs being non-zero (`|in| > 0.01`). Holding a key
  against a wall costs accuracy. Releasing the keys starts the recovery at
  once, though the body takes another 0.35 s to stop (PHY-6).
- **Turning is free with vanilla weapons.** Every vanilla weapon authors
  `setTurnDev 0 0 0 0` except the Garand and Type5 (DEV-10; read today). A
  flick costs no accuracy.
- **Zoom does not change the cone (DEV-3, refuted claim).** Zoom changes the
  field of view and the mouse scale only. Aiming down the sights helps you
  see and place the shot; it does not tighten the spread.
- **A jump raises the misc channel once, at take-off (DEV-15, lab-measured).**
  Then it decays at 0.1 a tick. A BAR tapped 150 ms after a jump drew at 2.85
  against its 0.75 floor. One anonymous tip says "when you jump your assault
  gun's accuracy will briefly increase"
  ([Haines' tips](https://realtimerendering.com/erich/bf1942/tips.html)).
  The measurement refutes it.

**Per-weapon words (read today from `Objects.rfa`).** The BAR row matches the
lab fixture `tests/fixtures/stance_dev_bar.json`. The HandFireArmsTemplate
constructor sets devMod to 1/1/1 (`0x082945e7`..`0x082945fb`), and minDev
defaults to 0 (DEV-8).

| Weapon | minDev | fireDev (cap, per round, decay) | devMod stand / crouch / prone | speedDev (cap, fwd, strafe, decay) | miscDev (jump) |
|---|---|---|---|---|---|
| Thompson, MP40, MP18 | 0.4 | 2.0, 0.35, 0.06 | 1.2 / 1.05 / 0.9 | 0.8, 0.2, 0.2, 0.1 | 2.5, 2.5, 0.1 |
| BAR, DP | 0.75 | 3.5, 0.25, 0.03 | 1.0 / 0.85 / 0.5 | 2.25, 0.2, 0.2, 0.1 | 2.5, 2.5, 0.1 |
| StG44 | 0.75 | 3.5, 0.25, 0.03 | 1.0 / 0.85 / **0.6** | 2.25, 0.2, 0.2, 0.1 | 2.5, 2.5, 0.1 |
| Type99 | 0.5 | 3.0, 0.25, 0.03 | 1.0 / 0.85 / 0.5 | 1.8, 0.2, 0.2, 0.1 | 2.5, 2.5, 0.1 |
| Johnson | 0.75 | 3.8, 0.25, 0.03 | 1.1 / 0.85 / 0.5 | 2.55, 0.2, 0.2, 0.1 | 2.5, 2.5, 0.1 |
| K98, No4 | 0.25 | none | 1 / 0.7 / 0.5 | 1.5, 0.4, 0.4, 0.1 | 2.5, 2.5, 0.1 |
| M1 Garand, Type5 | 0.25 | 1.8, 0.3, 0.08 | 1 / 0.7 / 0.5 | 1.3, 0.4, 0.4, 0.2 (turnDev 0.3 0.2 0.2 0.1) | 1.8, 1.8, 0.1 |
| K98Sniper, No4Sniper | **none (0)** | none | none (1/1/1) | 0.8, 0.2, 0.2, 0.1 | 2.5, 2.5, 0.1 |
| Colt, P38 | 0.2 | 2.5, **1.5**, 0.07 | none (1/1/1) | 1.5, 0.2, 0.2, 0.1 | 2.5, 2.5, 0.1 |

**What the law does with those numbers (derived;** the script was a scratch
file, the law is the subsystem note's**):**

| Weapon | Moving, standing (total, ticks to cap) | Crouched, moving | Prone, crawling | Recovery after stopping, standing | Burst, standing: rounds 1 / 4 / 8 / 20 | Burst, prone |
|---|---|---|---|---|---|---|
| Thompson | 1.36 (5) | 1.24 | 1.12 | 0.38 s | 0.40 / 1.00 / 1.80 / 2.25 | 0.40 / 0.85 / 1.45 / 2.20 |
| BAR | 3.00 (23; 8 with two keys) | 2.66 | **0.75 (no penalty)** | 0.75 s | 0.75 / 1.16 / 1.71 / 3.36 | **0.75 / 0.83 / 0.93 / 1.23** |
| StG44 | 3.00 | 2.66 | 0.75 | 0.75 s | 0.75 / 1.20 / 1.80 / 3.60 | 0.75 / 1.00 / 1.33 / 2.33 |
| K98 | 1.75 (5) | 1.30 | 0.25 | 0.50 s | - | - |
| Sniper | 0.80 (8) | 0.80 | 0.80 | 0.27 s | - | - |
| Colt | 1.70 | 1.70 | 1.70 | 0.50 s | taps fanned: 0.20 then 2.35 from the 2nd round | same |

Five teaching facts fall out of that table:

1. **Prone does not lower the first round.** minDev is unscaled, so a prone
   BAR's first round is exactly as wide as a standing one's. Prone is about
   **sustained** fire and fire on the move:
   - The BAR's 20th round is 1.23 prone against 3.36 standing (M squared on
     the raise, divided by M on the decay).
   - Crawling with a rifle, BAR, StG44 or Type99 adds nothing: the raise,
     0.25 x 0.2 = 0.05 a tick, is below the prone decay of 0.2 a tick.
2. **The SMG is the gun to shoot on the move.** Its moving cone (1.36) is
   under half the BAR's (3.00), and its stance multiplier barely changes it
   (1.2 / 1.05 / 0.9). A player made the same point in 2004: medic for close
   maps for the "smaller bullet spread when strafing"
   ([AnandTech](https://forums.anandtech.com/threads/bf1942-what-type-of-soldier-do-you-usually-pick.1246385/);
   player claim, consistent with the law).
3. **The scoped rifles have no floor at all (read today; not lab-measured).**
   The sniper templates author no `setMinDev`, `setFireDev` or `setDevMod`,
   so a still sniper puts every round on the aim point in any stance. Prone
   buys a sniper nothing in accuracy, only concealment and a lower eye.
4. **Pistols punish fanning.** A Colt round adds 1.5, so the second shot of a
   quick pair draws at 1.7 to 2.35. A pistol wants about 0.7 s between
   aimed taps (1.5 / 0.07 a tick).
5. **Garand crouch-walking forward costs nothing.** 0.49 x 0.4 = 0.196 against
   a decay of 0.286 a tick. Two keys do cost.

**How often the round lands (derived, with one inferred input).** The hit
chance on a chest-sized target of about 0.56 x 0.68 m is approximated as a
rectangle from the Spine2 capsule. The aim is assumed perfect, so the only
error is the cone.

| State | Total | 15 m | 30 m | 60 m | 100 m |
|---|---|---|---|---|---|
| Rifle or Garand, still | 0.25 | 100% | 100% | 100% | 100% |
| SMG, first round | 0.40 | 100% | 100% | 100% | 60% |
| BAR or StG44, first round | 0.75 | 100% | 100% | 47% | 17% |
| SMG, 4th round of a burst, standing | 1.00 | 100% | 93% | 26% | 10% |
| SMG running | 1.36 | 100% | 57% | 14% | 5% |
| BAR, 8th round, standing | 1.71 | 100% | 36% | 9% | 3% |
| Rifle running | 1.75 | 100% | 35% | 9% | 3% |
| BAR running | 3.00 | 47% | 12% | 3% | 1% |
| BAR at a jump's take-off | 3.15 | 43% | 11% | 3% | 1% |

At 15 m nearly everything hits. At 30 m stopping matters by a factor of
three to eight. At 60 m and beyond, only a still rifle, or the first round of
anything, is a weapon.

**The cone is the infantry's energy.** In the air, speed and height are the
bank you spend to turn and climb. On foot the bank is the cone:

- Moving, firing and jumping spend it.
- Stopping, crouching, going prone and pausing a burst bring it back, at
  rates the table gives.
- The retail crosshair draws the stored total (`getMenuCrossHairRadius`,
  DEV-12), so the HUD already shows the meter.

### A3. Movement, stance and the dive

Confirmed rows; the laws are held to the lab server:

- **Speeds (PHY-6, PHY-34; `viewer/soldier-locomotion.js`).**
  - Standing: 6 m/s forward, 4 back, 4 strafe. A diagonal is capped at the
    forward table, so run plus strafe is 6, not 7.2.
  - Crouched: 2 m/s in every direction. Prone: 1 m/s.
  - The walk toggle is 1/3, standing only.
  - Ramps: 0.21 s to full speed and 0.35 s to a stop. The ramp is squared
    (PHY-9), so the first ticks are slow.
- **Jump (PHY-1, PHY-35, DEV-15).**
  - Standing only, as a 6.0 m/s upward impulse.
  - A held key re-jumps every 28 ticks (0.93 s), but retail's input maps
    jump as non-repeating.
  - The jump tick zeroes the command.
  - Each take-off costs the misc channel (A2).
- **The running dive (PHY-8, PHY-36, measured).**
  - Pressing lie while running forward enters `Lb_RunStandToLie`. Its
    `setSpeed 6.0` keeps the run's 6 m/s for **0.714 s**, about 4 m, then the
    soldier crawls at 1 m/s.
  - This is BF1942's prone slide. The state carries `c_AsmIsLying`, so the
    prone multiplier and prone's grenade table apply from the press
    (inferred from PHY-8's `getPose`).
  - BF2's "dolphin diving" is a different game. The patch note that banned
    "Prone Spamming" and "Dolphin Diving" is BF2's
    ([icculus mailing list, Dec 2005](https://icculus.org/pipermail/bf1942/2005-December/012323.html)).
    No source found names a BF1942 dive exploit, but the engine has the dive.
- **Stance keys (PHY-37, measured).**
  - Crouch is tested before lie.
  - A lie press with crouch held lies the soldier down for a tick and then
    crouches them again.
- **Stance timing: open.** `soldier.js` `STANCE_TRANSITION` still carries the
  old `frames / 26 fps / speed` reading: 48 ms to crouch or drop, 115 ms to
  stand from prone. ANIM-2 refuted that reading: a clip's pass is
  `1 / |speed|` seconds. The two transitions measured since agree with ANIM-2:
  - The dive is 0.714 s (PHY-36).
  - Lying-to-stand holds prone for 1/3 s (`LIE_TO_STAND_DURATION`, measured),
    then `Lb_CrouchToStand` follows.

  By ANIM-2 the others would be 0.25 s stand to crouch and back, 0.625 s crouch
  to prone, and 0.5 s prone to crouch. Nobody has measured those. This decides
  how fast a peek-and-drop is, and it should be measured on the lab before
  any stance lesson.
- **Eye heights (read today from `setPoseCameraPos`, plus the 1.0 m origin of
  PHY-10):** 1.65 m standing, 1.12 m crouched, 0.30 m prone. These are the
  heights the retail bot tests when it picks a firing pose (BODY-5, below).
- **Prone on a slope:** the live soldier leans a tenth of the way to the
  ground normal each tick (PHY-38).

### A4. Grenades and the splash law

Read today from `Objects/HandWeapons/GrenadeAllies/Objects.con`; the law is
confirmed:

- **The throw:**
  - `fireDelay 1.0` s of wind-up from click to release
    (`features/grenade-viewmodel-and-throw`).
  - Then a **3.0 s** fuse (`timeToLive`), so about **4 s from click to
    blast**.
  - It leaves at 25 m/s. `velocityDependentOnHeat 1` with `heatAddWhenFire
    0.03` says the speed depends on the heat channel; how is unread.
  - **Inferred:** 25 m/s under the soldier gravity of 14.7 reaches at most
    about 40 m flat, before the roll.
  - The retail bot's grenade `maxRange` is 20 m.
- **Damage:**
  - `radius 15` (the console reads it as an int), `material2 205`.
  - `materialDamage(205)` 10 x `damageMod(205, 40)` 12 = **120 HP at the
    centre** (`features/viewer-soldier-stance-and-blast`).
  - The falloff is linear, `1 - d/radius` (HP-9), times the exposure.
- **Exposure (HP-10, confirmed, measured on the page).**
  - Line-of-sight rays from the blast to fixed points on the soldier: 9
    standing, 9 crouched, 3 prone.
  - The standing and crouched tables are byte-identical, at 0.9, 0.7 and
    0.3 m off the ground. Standing divides by 18, so a soldier standing in the
    open scores at most 0.5; crouched and prone score up to 1.0.
  - The prone row is a single row at 0.3 m.
  - The offsets are never rotated, so the spread is along world X.
- **Lethal radius in the open (derived; radius 15, 30 HP).** Standing dies
  inside **7.5 m**; crouched or prone inside **11.25 m**.
  - **Near a grenade you can see, stand up and move.** Crouching in the
    open doubles what you take.
  - **Cover beats stance.** A wall higher than 0.9 m between you and the
    blast clears all nine standing points. A 0.3 m lip clears prone's three.
  - The engine's samples sit at the same heights whether you stand or
    crouch, so crouching behind a low wall is no safer from a grenade than
    standing behind it (derived from HP-10). It is safer from rounds,
    because the capsules move down with the skeleton.
- **Player claims.**
  - Spamming from an ammo box was a known complaint ("throw grenades all day
    by sitting next to an ammo supply box", Haines'
    [tips page](https://realtimerendering.com/erich/bf1942/tips.html)).
  - Alt-fire drops a grenade at your feet for the corner surprise (same page).
- **Kits.** Every US kit except the engineer carries grenades, and so does
  the German assault kit (read today from `Objects/Items/USKit/*/Objects.con`
  and `GerKit/Assault`; the other nations were not opened). The engineer has
  TNT (`ExpPack`, radius 12, a 240 s timer) and mines that need a vehicle.

### A5. Kits, and what each fights well (derived from A1 to A4)

| Kit | Primary | Its fight |
|---|---|---|
| Scout | K98Sniper / No4Sniper, pistol, binoculars, grenades | Long range, still, any stance. A head kill at any range; never in a corner fight (3.3 s cycle). The pistol is its close answer |
| Assault | BAR, StG44, DP or Type99, pistol, grenades | Base of fire at 30 to 100 m: prone, sustained, nearly no bloom. Worst on the move. Fastest best-case kill (BAR 0.25 s) |
| Anti-tank | Bazooka / Panzerschreck, pistol, grenades | Against infantry: the pistol, and a rocket's splash. A player guide: hide after firing because they know where you are ([survival guide](https://pcgameswalkthrough.blogspot.com/2009/02/battlefield-1942-survival-guide.html), player claim) |
| Medic | Thompson / MP40 / MP18, pistol, medpack, grenades | Inside 40 m and on the move. Falls off to half by 80 m. Heals after the fight |
| Engineer | K98 / No4 (Garand or Type5 on the Pacific), pistol, wrench, mines, TNT | A rifleman with a one-shot head. The Garand is the best rifle on the six levels that have it |

**Healing (SUP-15, SUP-21; `features/viewer-healing-packs`).**

- The medpack heals 0.25 HP a use to every wounded soldier within 10 m
  (`healDistance`), and 0.15 to the holder when no one else is in reach.
- At the pack's `roundOfFire 10` that is about 2.5 HP/s, about 12 s from
  near death to full.
- The rate per second is not settled. SUP-21's event log shows heals 0.05 to
  0.07 s apart, which would be faster.
- A player says it heals through walls
  ([Haines' tips](https://realtimerendering.com/erich/bf1942/tips.html));
  the code's sweep is a radius with no line-of-sight test (SUP-15, inferred).

### A6. Netcode: what the shooter sees and what the server judges

- **What a client draws (P-5, P-6, confirmed and measured).** A client draws
  every remote object 100 ms behind the server tick its own action will run
  on; on a LAN that is 0.12 s behind. Its own soldier is predicted and drawn
  on time.
- **What the server judges (read today, not in the ledger).**
  - FF-1 records that a round meets a soldier at `BFSoldier::getLatencyPosition`.
    This pass read that function in the lab's `bf1942_lnxded` (`0x08271c00`,
    objdump) beside the third-party decompile (`recorpus.py
    getLatencyPosition`).
  - It is a **lag compensation rewind.** The soldier keeps a 16-entry ring
    of past positions (`+0x138`, 12 bytes each, head at `+0x134`).
  - For a hit, the server takes the position `min(shooter's ping / 1000,
    0.2) + latency` seconds back, interpolated between ticks and capped at 14
    ticks. `BFSoldierTemplate::latency` is **0.1** (`0x0872ede4`); its console
    word is `collisionLatency`, and no vanilla `.con` sets it.
  - The rewind applies only on the server, only to a soldier on foot (no
    parent at `+0x50`), and only when the shooter passes a test (IPlayer
    vt+0x54, unread).
  - `BFPlayer+0x94` is taken to be the ping in ms (inferred).
  - The 0.1 s matches the client's 100 ms draw delay.
  - One reader. What the capsule test does with the rewound position is
    unread.
- **What follows (inferred):**
  - BF1942 compensates infantry hits the way Valve's design does
    ([Bernier, 2001](https://developer.valvesoftware.com/wiki/Latency_Compensating_Methods_in_Client/Server_In-game_Protocol_Design_and_Optimization)).
    A shooter with under 200 ms ping should aim where they see the target,
    not lead by ping.
  - Past 200 ms the cap leaves `(ping - 0.2) x speed` uncompensated, which
    fits the old player advice to "lead yer target" by ping
    ([Tom's Hardware mirror of alt.games.battlefield1942](https://forums.tomshardware.com/threads/interesting-observations.157379/),
    player claim).
  - The holder sees a peeker late by the peeker's uplink, the 0.1 s and the
    holder's own downlink. The server then judges hits as the shooter saw
    them, so being "shot behind cover" is real, by up to 0.3 s of travel:
    1.8 m at a run.
  - Patch 1.2's note that "low close combat hit accuracy due to network lag is
    much improved" may be when this arrived
    ([overclockers.at, patch 1.2](https://www.overclockers.at/spiele/battlefield_patch_1_2_released_56858/page_1);
    inferred link).
- **Worth a ledger row and a lab check:** a relay soldier strafing at 4 m/s
  past a still shooter at known pings, with each round's impact against the
  server's live and rewound positions.

### A7. Bots on foot today

The viewer's foot soldier is a close, documented copy of the retail bot
(`viewer/bot-*.js`, `features/bf1942-ai-research-2026-09-21`,
`features/bf1942-ai-spec/KNOBS.md`). The retail bot is basic.

**Sight (AI-33, AI-67, AI-107).**

- Three nested square cones: 100, 60 and 30 degrees wide over 0-50%, 50-75%
  and 75-100% of the view distance (600 m by default, 300 on El Alamein and
  Gazala).
- A bot that turns past 25, 15 or 7.5 degrees falls back to the near band.
- One clear ray of up to ten random rays on the body is a sighting.
- A target is remembered for 60 s, tracked at its live position.
- Hearing is 15 m, and nothing if the enemy is crouched or prone.
- There is **no noticing delay** and nothing for stillness or camouflage
  (research README: no reaction time as such).

**Aim (AI-16, AI-68, AI-145).**

- The error is `(1 - 0.75A) x C + 5.0 x (0.1 x max(0, 10(1 - A) - t) +
  0.25(1 - A))`.
- At the default skill 0.75 that is 1.56 hundredths at acquisition, settling
  to 0.31 after 2.5 s. This settling is the only reaction-like behaviour.
- A bot turns at most about 12 degrees a tick (AI-108) and fires within 5
  degrees.
- A foot bot aims at the live position plus 1.0 m, with no lead
  (`bot-plans.js` `execMouseTurretAimAt`). The referee resolves its bullets
  instantly (`bot-referee.js`, a labelled departure).

**Stance (BODY-5, BODY-10).**

- When firing, a bot takes the first of prone, crouch and stand whose eye
  (0.30, 1.12, 1.65 m) sees the target. It lies down in the open.
- Any change other than going prone waits 10 s after the last.

**Tactics.**

- **No strafing or dodging.** That is faithful: a bot walks only toward a
  goal inside 31.5 degrees of its facing (AI-31).
- **No peeking or flanking.**
- **TakeCover** (AI-37, AI-41) scores placed objects with a `coverValue` and
  stands 0.75R to 2R behind one. With no cover it heads for low ground and
  lies down.
- **Grenades.** The engine's thrown-weapon branch (AI-158) is not ported
  (`bot-plans.js:177`), so a bot throws only when the ordinary weapon choice
  happens to pick a grenade.

**Assessment.** A retail-faithful bot is an honest target and a poor
teacher. An "ace" infantry pilot would be a labelled invention, as
`dogfight-pilot.js` is. It would need:

- **Perception:** the dogfight school's `perceive()` (a noticing delay,
  glances, last-known position) ported to a soldier's eye.
- **Aim:** lead and a flick-then-settle.
- **Movement:** strafing.
- **Cover:** peeking from cover and re-acquiring.
- **Grenades:** a deliberate decision to throw.

### A8. Could a headless node duel exist?

Most of it already runs in node:

- **Movement:** `walking-body.js`, `soldier.js`, `soldier-locomotion.js` and
  `soldier-resolve.js` import no three.js. `tests/move_law_harness.mjs` and
  `stance_law_harness.mjs` replay lab words on terrain windows at 30 Hz.
- **The cone:** `deviation.js` runs in node and is checked against the
  server's cone per stance (`tests/stance_dev_law_harness.mjs`).
- **The round's draw:** seeded by input serial (DEV-9, DEV-14), so a duel is
  exactly reproducible.
- **Rounds, line of sight and grenades:** `skeleton-hit.js` (the first-match
  capsule rule), `world-collider.js` (the heightfield, statics and casts) and
  `soldier-exposure.js` (the grenade rays) all run headless.
- **A whole level:** `tools/bf1942-models/sim/` loads a real level's
  `scene.json` and `scene.glb` headless, or a synthetic one with sandbag cover
  lines. It runs seeded, deterministic matches through `bot-referee.js`.

The one blocker is **the capsules need a posed skeleton.**

- `rig-capsules.js` reads bone world positions off a drawn three.js rig.
- The sim passes `capsulesOf: () => null` (`sim/stage.mjs:172`), so every
  round meets a 0.6 m sphere at 1.0 m priced as chest (`bot-referee.js:77`).
  That gives no head shots, and crouch and prone change nothing.

Two ways round it:

- Pose the soldier glb and its stance clips under a real `AnimationMixer` in
  node. `tests/pose_compose_harness.mjs` already runs a mixer headless on a
  stub rig.
- Precompute a capsule table per stance and clip phase.

The second is cheaper and is all a duel needs: stand, crouch and prone,
still and moving, each facing.

The duel itself would be a `runInfantryDuel` twin of `dogfight-duel.js`: two
`Soldier`s on a `WorldCollider` with statics, a pilot per side emitting input
words, fire through `DeviationModel` and the referee, and the capsule table.
It would score with the measures in Part C.

### A9. Do the recordings carry an infantry fight?

Mostly yes. The server recordings are the ones worth mining
(`features/round-replay-capture` sections 9, 14, 15, 19 and 20;
`features/server-replay-recorder`; parser `viewer/replay-recording.js`):

| Needed | In the files |
|---|---|
| Position, velocity | `s` samples: about 10 Hz in client files, 30 Hz in server files |
| Aim | `st` aim pitch and torso twist; the view yaw is rebuilt from the twist (sections 15, 16) |
| Stance, jump, zoom | `st` lower and upper animation state (flags 0x20 crouch, 0x40 prone, 0x80 jump); state bit 0x20 zoomed |
| Weapon | `st` held item; server files add magazine counts `am` |
| Shots | `f` per round with muzzle and direction; server files one per barrel. Client files can miss quick taps |
| Hits | Server: `hg` credited hits and `i` impacts with point and object. Client: only the recording player's own. **No body part or damage per hit** |
| HP | `a` on change, so the damage of each hit is the drop; server files carry `lastHitPlayer` |
| Kills | `e:score` with victim and weapon. Server files carry `bodypart` (`server-replay-recorder/src/core.c:3064`), which the parser does not read yet (`replay-recording.js:896`) |
| Grenades | Flights as pooled projectile poses (server `pn`/`pj`/`pd`); the blast inferred from the end and HP drops |
| Range freezing | Client files hold the enemy only within view distance plus 20 m (`isReplicated`); server files hold everyone |

**What a detector can measure:**

- Who could see whom first: eye heights from the stance against the level's
  collision.
- First shot and first hit.
- Stance and movement at each shot, and so the cone each round drew from:
  the law is deterministic given the keys, which the samples approximate.
- Burst length, the outcome, and the head share on kills.

**What it cannot measure:**

- Hits by body part except on the kill.
- Exact input words, so the cone is reconstructed, not read.

The feed is public (`https://bfstats.io/stats/recordings`): 36 recordings on
2026-11-08 (`extract_dogfights.mjs --download`), and a daily CronJob already
walks them for dogfights (`dogfights/refresh.mjs`).

---

## Part B. Tactics

The research pass that gathered these links fetched most of them. Only Haines'
weapons page was re-read for this note. Where a source's claim meets an
engine row, the row is named.

### B1. Real-world and competitive fundamentals, mapped to BF1942

| Fundamental | What it says | What it is in BF1942 |
|---|---|---|
| Cover against concealment | Cover stops rounds; concealment only hides. "Does not protect you from enemy fire" ([FM 3-21.75, ch. 5](https://irp.fas.org/doddir/army/fm3-21-75.pdf)) | Literal. Statics stop rounds and grenade rays (HP-10). Foliage is concealment; whether it stops a ray is the collider's material (`isSolidMaterial`, FF-1). Prone's 0.30 m eye is the strongest concealment the game has |
| Slicing the pie | Take a corner in thin wedges around its apex, the muzzle back ([SOFREP](https://sofrep.com/news/how-to-slice-the-pie-for-beginners); [Police1](https://www.police1.com/swat/slicing-the-pie-vs-button-hook-for-room-entry)) | Strafe is 4 m/s standing and 2 crouched, and any held key costs cone (DEV-6). So a slice is "strafe a step, release, look". The ramp's 0.35 s stop and the 0.38 to 0.75 s recovery set the rhythm |
| Peeker's advantage | Client prediction plus server buffering means the peeker sees the holder first ([Riot, Peeking Valorant's netcode](https://technology.riotgames.com/node/111); [Bernier](https://developer.valvesoftware.com/wiki/Latency_Compensating_Methods_in_Client/Server_In-game_Protocol_Design_and_Optimization)) | Present, by A6: remotes drawn 100 ms behind, hits rewound up to 0.3 s. The holder's counter is distance from the corner and an off-angle |
| Holding an angle | Stand back from the corner you hold, or off the expected line; peek tight, hold wide ([Dignitas, angles and peeking](https://dignitas.gg/articles/blogs/csgo/7941/angles-peeking-101-tips-tricks-and-advice-for-peeking-in-csgo); [GGRecon](https://www.ggrecon.com/guides/cs2-peekers-advantage/)) | The holder's cone is at its floor (still) and the peeker's is not (moving). A held BAR's first round at 30 m lands 100% against the peeker's 12% |
| Crosshair placement and pre-aim | Keep the cross at head height where the enemy will appear ([csdb.gg](https://csdb.gg/guide-to-crosshair-placement/); [Dignitas](https://dignitas.gg/articles/crosshair-placement-in-csgo)) | Turning costs no cone (`setTurnDev 0`, DEV-10), so a flick is free. Pre-aim at 1.65 m (standing head) or 1.12 m (crouched); the head is first in the capsule order |
| Counter-strafing | In CS, stop before you shoot ([csdb.gg](https://csdb.gg/how-to-aim-in-cs2/)) | BF1942 gates the cone on the key, not the speed (DEV-6), so releasing the keys starts recovery at once. There is no counter-strafe; "stop, shoot, move" is the analogue |
| Fire and manoeuvre | One element fires while the other moves, then they swap ([FM 3-21.8](https://www.marines.mil/Portals/1/Publications/FM%203-21.8%20%20The%20Infantry%20Rifle%20Platoon%20and%20Squad_1.pdf); [Wikipedia](https://en.wikipedia.org/wiki/Fire_and_movement)) | The prone BAR is the base of fire (20 rounds at 1.23). The SMG is the manoeuvre element (best cone on the move). Needs two friendly soldiers |
| Suppression | Near misses, heard and seen, push soldiers to ground ([DTIC ADA071116](https://apps.dtic.mil/sti/pdfs/ADA071116.pdf); [Dupuy Institute](https://dupuyinstitute.org/2017/08/24/human-factors-in-warfare-suppression/)) | No mechanic for humans. A retail bot does react: its TakeCover danger counts fire passing (AI-41), and incoming fire can drop a moving bot prone (BODY-5) |
| Flanking | A base of fire fixes, a manoeuvre element goes round ([Wikipedia](https://en.wikipedia.org/wiki/Fire_and_movement)) | The infantry "six". A soldier's yaw turn is fast (90 deg/s at a mouse rate of 1.0, DEV-10), so the flank's gift is time to be seen, not an angle that can never be covered |
| Trading | Kill the enemy right after they kill your teammate; spacing makes it possible ([scope.gg](https://blog.scope.gg/trade-kills-en/); [Dignitas, buddy system](https://dignitas.gg/articles/blogs/CSGO/14294/csgo-concepts-the-buddy-system)) | A BAR's three hits take 0.25 s, so a trade window is a few tenths of a second. Spacing against grenades: more than 7.5 m standing, 11.25 m crouched |

### B2. BF1942 lore

| Claim | Source | Status |
|---|---|---|
| "If you prone you can be accurate" | GEN^Orange's survival guide, reposted 2009 ([blogspot](https://pcgameswalkthrough.blogspot.com/2009/02/battlefield-1942-survival-guide.html)) | Player claim. **Half right** by the law: prone tightens bursts and fire on the move, not the first round (A2) |
| "If you must stop, lie down"; zig-zag or "snipers will pick you off" | [Haines' tips](https://realtimerendering.com/erich/bf1942/tips.html) | Player claim. Consistent with a sniper's zero floor (A2) |
| Toggling in and out of prone to crawl faster | eggman, same page | Player claim, unchecked. The dive gives 6 m/s only from a run (PHY-8). Whether a stand-and-lie toggle beats 1 m/s depends on the unmeasured transition times (A3) |
| Dolphin diving, prone spam | [icculus, Dec 2005](https://icculus.org/pipermail/bf1942/2005-December/012323.html) | **BF2**, not BF1942. BF1942's dive exists in the engine (PHY-8, PHY-36); no source names it as an exploit |
| Medic for close maps, for the smaller spread when strafing; assault against clans | Smithy18, [AnandTech 2004](https://forums.anandtech.com/threads/bf1942-what-type-of-soldier-do-you-usually-pick.1246385/) | Player claim, **confirmed by the law**: SMG moving 1.36 against BAR 3.00 |
| Assault is the primary anti-infantry kit | [Wikipedia](https://en.wikipedia.org/wiki/Battlefield_1942) | Consistent: fastest best-case kill, best sustained prone fire |
| Jumping briefly increases assault accuracy | Anonymous, [Haines' tips](https://realtimerendering.com/erich/bf1942/tips.html) | **Refuted** by DEV-15 (the take-off adds 2.4) |
| Jumpers are hard to hit unless they move along your sights; strafe diagonally round corners | bonobo and Malcolm, [Tom's Hardware mirror](https://forums.tomshardware.com/threads/interesting-observations.157379/) | Player claim. The first is about human tracking, not the engine; the shooter is not penalised for the target's jump |
| Lead your target by ping | Same thread | Player claim. Only past 200 ms ping, if the rewind in A6 holds |
| Grenades all day from an ammo box; alt-fire drops one at your feet | [Haines' tips](https://realtimerendering.com/erich/bf1942/tips.html) | Player claim |
| A single knife poke to the head is an instant kill | Wayne Miller, same page | **Confirmed**: knife head 32 on 30 HP (DMG-3) |
| Medpack heals in a radius, several at once, through walls | HollowPoint, same page | **Consistent** with SUP-15's radius sweep (10 m) |
| Engineers fire once, then switch to the pistol | GEN^Orange guide | Player claim; sound, with a 2.7 s bolt cycle |
| Spawn and base camping was banned or allowed server by server | ViRGE and others, [AnandTech 2003](https://forums.anandtech.com/threads/bf1942-players-what-up-with-no-main-base-invasions.1077355/post-7903438) | A social norm, not a mechanic |
| Patch 1.4: delays on turning, jumping and draws; "deviation returns to normal after running faster"; Type99 and DP added | [overclockers.at, 1.4](https://overclockers.at/spiele/bf1942_patch_1_4_81924) | The patch history behind the 1.61 numbers in A2 |
| Patch 1.6 changed no accuracy; PunkBuster's target was a no-spread hack | [overclockers.at, 1.6](https://overclockers.at/printable/spiele/bf_1942_1_6_ist_da_105834/page_1); [AnandTech](https://forums.anandtech.com/threads/bf1942-implementing-punkbuster.1206251/post-9733561) | Player and patch notes |

No BF1942 source found names a bunny hop or a strafe-jump as a technique.
The engine makes a jump expensive (DEV-15) and only standing (PHY-1), so
neither would pay against a still shooter.

---

## Part C. What translates, what is new, and how to score it

### C1. The dogfight concepts, carried over

| Dogfight school | Infantry school | Notes |
|---|---|---|
| The six (the rear quarter) | The flank and the back: outside the 100-degree near cone of AI-33, or a human's field of view | Turning is fast, so the flank buys **time to be noticed**, not a geometry the enemy cannot answer. Scored as "they see you after your first round" |
| Energy (speed plus height) | **The cone** (A2), with HP as the second bank | Moving, firing and jumping spend it; stopping, stance and pauses bring it back. The retail crosshair already draws it |
| Perception, `perceive()`: cone, glances, 0.8 s noticing, 4 s last-known | **The same, literally**, at eye heights 1.65 / 1.12 / 0.30 m against the level's collision | The retail bot has no noticing delay (A7). The school's soldiers would get the pilots' rules, labelled inventions as `EYES` is |
| Nine nudged starts (L9 over four nudges) | Nine starts over lateral offset at the corner (plus or minus 1 m), range (plus or minus 5 m), first facing (plus or minus 20 degrees), and the reaction delay (0.2 / 0.25 / 0.3 s) | The draw is seeded (DEV-14), so each start is exact |
| Dip (leave the fight) | **Break contact**: from contact, put the level between you and every enemy eye within 2 s, take no lethal damage, be alive 5 s later | The dive (PHY-36) and the step back round the corner |
| Flip (chased becomes chaser) | **Reverse the first shot**: they saw you or hit you first, and you kill them or get onto their flank unseen | Usually a trade of stance and cone: drop and fire against a moving shooter |
| Ninja (get the shot, keep it) | **First sight, first hit, finish**: you see them first, your first round lands, they die within the weapon's kill budget, and they land at most one non-lethal hit | And no re-peek into a second enemy for 3 s afterwards: "keep it" means not dying to the next enemy |

### C2. What is new

- **Cover is everything.** A lesson's set is part of the lesson: a corner, a
  sandbag line, a hedge, a window. The sim's synthetic level already has
  sandbag lines.
- **Fights last 1 to 3 seconds.** The interesting time is the 2 s before the
  first round: who moved, who stopped, who was where the other was looking.
  The theatre needs bullet time, and its timeline should centre on first sight.
- **Netcode.** The peeker's advantage and being shot behind cover exist
  (A6). A lesson can show both clocks: what the holder's screen showed, and
  what the server judged.
- **Stance is a third axis.** Air has speed and height; the soldier has stand,
  crouch and prone, each with its own cone, eye and grenade exposure. Their
  costs are A3's transition times, which still need measuring.
- **The grenade is a timed area denial weapon,** 4 s from click to blast. Its
  counter is stance and position, not aim.

### C3. A proposed scoring scheme

Measured per soldier from a fight's start (first sight either way) to its end
(a death, or 5 s with no line of sight):

| Measure | Definition | Engine basis |
|---|---|---|
| Saw first | Who had a clear eye-to-capsule ray first, and by how much (s) | `world-collider` casts; AI-33's ray rule as the minimum |
| Exposure | Seconds any capsule was visible to an enemy eye that was looking (inside the cone) | DIE-10 capsules |
| First round, first hit | Who fired first; whose round landed first | DEV-12, DMG-3 |
| Cone at fire | The total each round drew from, mean and at the first | DEV-1 law over the keys and stance |
| Kill budget | Time from first hit to kill against the weapon's best case (A1) | A1 table |
| Damage taken | HP lost, and what took it | HP rows |

The **move verdicts** follow the dogfight school's: a move **works** from 7 or
more of the nine starts, **partly** from 3 to 6, and fails from fewer, against
the Dip, Flip and Ninja tests in C1. One clause comes over directly: a kill
counts as success, not as "the fight ended". One is adapted: two-tick snaps
do not count as an attack, which here means a burst under 0.1 s that lands
nothing is not a shot.

For mined fights (C5), the same measures name each soldier's move before
contact (still, moving, dropped, dived, jumped, peeked, held) and score it
against the outcome, as "What the manoeuvres did" scores dogfight manoeuvres.

### C4. Lessons, ranked by value to a beginner

Each is a situation, a move and its counter, set on a small built set, from
nine starts.

1. **Stop to shoot (the cone is your energy).**
   - Situation: two soldiers meet at 30 m in the open, both with BARs, one
     running.
   - Move: the runner keeps running and fires.
   - Counter: plant (release the keys), or crouch, then burst.
   - Engine: a running BAR lands 12% at 30 m, a planted one 100% on the first
     round (A2). The coach's line: "Let go of the keys. Your cross shrinks in
     three quarters of a second."
2. **Pick the range for your gun.**
   - Situation: Thompson against K98, at 15 m and at 60 m.
   - Move: the SMG closes; the rifle backs off and holds.
   - Counter: at 60 m the rifle wins (still floor 0.25, a head kill in one).
     At 15 m the SMG wins (0.3 s against a 2.7 s second shot).
   - Engine: A1, A2. The rifleman's out is the head shot or the pistol.
3. **The corner: hold back, or peek tight.**
   - Situation: a corner on a set, one soldier holding, one taking it.
   - Moves: the wide swing (strafe out at 4 m/s into the open) and slicing the
     pie (step, release, look).
   - Counter: hold back from the corner, off the line, cross at head height,
     still.
   - Engine: the peeker's moving cone against the holder's floor, and the
     peeker's advantage by A6. Two versions: netcode off, then the rewind on.
4. **Who saw whom first (concealment and eye height).**
   - Situation: a hedge or tall grass line, one soldier prone at 0.30 m, one
     walking.
   - Move: the walker crosses.
   - Counter: the prone soldier waits for the walker to be inside 30 m and
     still or looking away, then fires.
   - Engine: eye heights, the bots' cone bands (AI-33). Taught through the
     "who saw who first" replay (C6).
5. **Base of fire: lie down and keep firing.**
   - Situation: a BAR at 60 m against an advancing SMG.
   - Move: the BAR goes prone and holds the trigger in bursts.
   - Counter: the SMG does not cross the open. It flanks out of the BAR's view
     band, or throws a grenade.
   - Engine: a prone BAR's 20th round is at 1.23 against 3.36 standing. A
     prone target facing a rifle is mostly head (A1, inferred).
6. **The grenade: stand up and get out.**
   - Situation: a grenade lands 8 m away in the open; or you are crouched
     behind a low wall.
   - Move: the thrower throws (4 s from click).
   - Counter: in the open, stand and move: standing halves exposure, and the
     lethal radius goes from 11.25 m to 7.5 m. Behind cover, get a wall over
     0.9 m between you and the blast.
   - Engine: HP-10, A4. The counterintuitive one, so it earns a lesson.
7. **Short bursts, and taps for the pistol.**
   - Situation: an SMG at 30 m.
   - Move: one long burst.
   - Counter: bursts of three or four with 0.3 s between them.
   - Engine: a Thompson's 4th round is at 1.00 (93% at 30 m), its 12th at 2.25.
     A Colt fanned is at 2.35 from the second round; tapped, 0.20.
8. **The dive, and the step back (the Dip).**
   - Situation: caught running in the open at 40 m by a rifle or BAR.
   - Moves: the running dive to prone (6 m/s for 0.71 s, then a prone cone),
     or the step back behind the last cover.
   - Counter (for the shooter): the head shot on the prone soldier, or waiting
     out the dive.
   - Engine: PHY-36, PHY-8, A2.
9. **Do not jump in a fight.**
   - Situation: a 1v1 at 15 m.
   - Move: the jumper jumps and shoots.
   - Counter: the still shooter.
   - Engine: DEV-15 (the take-off adds 2.4; 40% at 15 m against 100%). Short,
     because the lore asks it.
10. **Trading, and spacing (later, needs two a side).**
    - Situation: two friendly soldiers through a doorway.
    - Move: stack tight.
    - Counter: space past 7.5 m (one grenade) and inside a trade window
      (0.25 to 0.5 s).
    - Like the Thach weave in the dogfight school, it needs a second friendly
      seat.

### C5. Mining real infantry fights

This is a twin of `dogfight-detect.js`, on server recordings first (30 Hz,
everyone, impacts, `lastHitPlayer`, the kill's `bodypart`):

- **A fight** is two soldiers on foot on opposite sides with an aimed round
  either way. An aimed round passes within 1 m of the other's body, flown at
  its muzzle velocity against where they really were. The fight lasts until
  a kill or 5 s without either firing.
- **First sight** comes from eye heights by stance against the level's
  collision, as in C3.
- **Moves named per soldier** in the 3 s before the first round: still,
  moving, strafing, dropped, dived, jumped, peeked (line of sight opening by
  their own move), held (by the other's).
- **The report** is "What the manoeuvres did" for feet: did the soldier who
  stopped win more than the one who ran? Prone against standing by weapon?
  Did first sight decide it?
- **Client files** serve only fights involving the recording player's own
  side within network range, and hits are inferred from HP drops.
- **The parser** needs to read `bodypart` (`replay-recording.js:896`) to give
  a head share.

### C6. The theatre and the live drills

**The theatre.**

- A plan view and a low chase view of the set.
- Each soldier's view cone and eye height are drawn, the capsules lit when an
  enemy eye sees them, and the cone drawn as a growing and shrinking ring
  round the crosshair (the energy meter).
- Rounds are drawn as tracers with hit marks by capsule.
- The timeline centres on first sight, plays the 3 s around it at quarter
  speed, and marks **SEES THEM**, **LOST SIGHT**, **FIRST HIT**, **KILL**.
- **"Who saw who first"** is two first-person views side by side, each
  showing what that soldier could see at each tick, with the other's
  exposure outlined.
- **A netcode view** for the corner lesson: the holder's screen (the peeker
  100 ms late, plus pings) against the server's rewound judgement.

**The live drills,** on the proving ground with sets built from statics:

- **A corner-peek drill.** A bot holds a corner. The coach calls the slice
  ("step, let go, look") and draws the bot's sight line on the ground. The
  score is exposure seconds before your first round.
- **A 1v1 at 30 m with the coach.** The bot ace fights the lesson's move and
  the coach calls the counter: "Stop. Crouch. Three rounds. Again." The input
  guide shows which keys are down, since the keys cost cone. The cone ring is
  on the HUD.
- **A grenade drill.** Grenades land around you at known distances. The
  coach says stand and move or get behind the wall. The score is HP kept.
- **A range drill for the cone.** Targets at 15, 30, 60 and 100 m, with the
  hit rate shown live against the A2 table for your stance and keys.

---

## Open, and what to measure first

- **Stance transition times** (A3): `soldier.js` against ANIM-2. Measure the
  four unmeasured ones on the lab before any stance or peek lesson.
- **The lag compensation rewind** (A6): one reader, not in the ledger, and
  the shooter predicate (vt+0x54) and `BFPlayer+0x94` are unread. Needs a
  ledger row and a lab probe.
- **When the pose multiplier switches:** whether the deviation and grenade
  pose follow the state's flags at entry (the dive) or at the end of the
  transition. Inferred at entry.
- **The sniper's zero floor** (A2): read from the `.con` and the
  constructor; a lab tap would confirm it.
- **Grenade throw speed and heat:** what `velocityDependentOnHeat` does to a
  throw.
- **The healing rate:** SUP-15 per use; the rate per second is open (SUP-21's
  log cadence).
- **Capsules for a node duel:** a per-stance capsule table (A8).
- **Foliage:** whether bushes and grass stop rounds and grenade rays, through
  the collider's materials.
- **Mods:** everything above is vanilla 1.61. Desert Combat authors
  `setTurnDev` (DEV-10) and FH has its own words, so a mod's school would need
  its own tables.
