# Hand weapons: barrels, a scope with no picture, heat, the turn spread and the camera shake

Status: built 2026-10-06 (Desert Combat fix round, package `hand-weapons`):
the shotgun barrels (section 1), the Stinger's sight, read and confirmed
(section 2), and the hand MG's heat with the heat law every gun shares
(section 3). The page sees the hand MG's heat once the Desert Combat and DC
Final viewmodels are re-extracted (section 3, "Assets"). Built 2026-10-07
(package `hand-weapons-2`): the refused pull that restarts the lockout
(section 5), the weapon's camera shake (section 6), a hand weapon's pull
charged as `salvo()` says (section 7), a grenade's alt-fire charge
(section 8) and a kit's heat off the ground (section 9); the shake and the
charge need the viewmodels re-extracted. Read, with no change needed: where a
round's first sweep starts (section 10).

Three gaps the Desert Combat census found in the hand weapons
(`~/.cache/dc-sweep/reports/weapons.md`, items 3, 7 and 18). Each is engine
behaviour that vanilla's own weapons never exercise, so nothing had built it.

## 1. A shotgun's barrels fire along their own turns

**What was wrong.** Desert Combat's Remington and Saiga12k declare eight
barrels, `addFireArmsPosition 0/0/0 1.25/-0.8/0` and seven more, each at the
FireArms' origin and turned up to 1.5 degrees. The turns are the pellet
pattern. The hand weapon's `aimRay` ignored the barrel it was handed and sent
every round from the eye down the view axis, so the eight pellets left inside
the 0.25 degree `setMinDev` cone: a slug.

**What the engine does.** XHIT-12: a `fireInCameraDof` gun launches from the
player's camera. XHIT-16: `fireBarrel` turns that frame by the barrel's own
rotation and sends the round down the turned forward, from the eye plus the
barrel's offset. DEV-9: each barrel then draws its own deviation, so every
pellet wanders about its own barrel, not about the view axis.

**What was built.** `viewer/hand-aim.js` `handAimRay` is the hand weapon's
`aimRay`. It hands the player's eye and the barrel's FireArms node to
`gun-groups.js` `cameraLaunch`, the vehicle coax's law, now exported, and adds
the thrown weapon's release point as before. `hand-weapon.js` uses it for
every `fireInCameraDof` weapon.

**What else it moves.** A weapon whose one barrel sits off the FireArms' origin
now launches from the eye plus that offset in the eye's frame, which is
XHIT-12's `projectilePosition`. Survey of every viewmodel glb
(`~/.cache/dc-sweep/hand-weapons/muzzle_survey.py`):

- Vanilla: every armed hand weapon has one barrel at the origin with no turn,
  so nothing changes. The binoculars' barrel sits 2 m out, but they fire no
  round (`magType 2`, the scout camera), so `collect` builds no gun for them.
- XPack1 and XPack2 ship no viewmodels of their own.
- Desert Combat: the Remington and Saiga12k (eight barrels each); the RPG-7's
  rocket now leaves 0.73 m ahead of the eye, the Stinger's 0.1 m above it.
  DC Final's SA-7 is the RPG-7's, and its Remington has seven barrels.
- FHSW: bayonet and knife stabs fire five barrels at offsets up to 0.4 m;
  mortars turn their one barrel up 20 or 45 degrees. Both now behave as the
  data says.

**How it was checked.** `tests/test_hand_aim.py` drives
`tests/hand_aim_harness.mjs`: `gunfire.js` fires the barrels down
`handAimRay` with the eye and the hand posed apart, so the eye's frame is the
only one the rounds can follow.

- A synthetic Remington's eight pellets leave on the eight authored turns to
  within 0.001 degrees, from the eye.
- Over 40 pulls with the 0.25 degree cone, no pellet strays more than 0.25
  degrees from its own barrel.
- The baked DC Remington and Saiga12k fire the same pattern. The baked
  Thompson still fires down the view axis. The glb cases skip when the trees
  are not extracted.

In the page (`~/.cache/dc-sweep/hand-weapons/hand_page.cjs`, Desert Combat's
Lost Village with `?weapon=Remington`): one pull launched eight rounds, and in
the eye's frame at the launch each left within 0.22 degrees of its authored
turn.

Before and after on the baked Remington, one pull with the cone on
(`~/.cache/dc-sweep/hand-weapons/before/run_before.py`): the pellets spanned
0.42 by 0.24 degrees before and span 2.42 by 2.35 degrees now. With no cone the
pattern is 2.75 by 2.5 degrees, about 1.2 by 1.1 m at 25 m.

**Open.**

- Bots fire a shotgun as one ray per pull (`bot-referee.js` `resolveShot`):
  one pellet, an eighth of the damage, no pattern. The server runs the same
  barrel loop for every soldier (XHIT-12, `FireArms::Fire`), so a bot's
  Remington should spread like the player's. The turns live in the weapon
  glb's muzzle nodes, which `bot-rounds.js` already loads. This belongs to the
  `bots` package.
- The cone is a disc of `total` degrees in the viewer (`round-launch.js`
  `wander`) and a square of `total` hundredths of a radian in the engine
  (DEV-9): the viewer's reach is 1.75 times the engine's on each axis, for
  every gun. This belongs to the `rounds` package.
- `cameraLaunch` adds a barrel's offset in the eye's frame, the engine in the
  turned one (XHIT-16). No vanilla, XPack or DC 0.7 hand weapon has a barrel
  with both; DC Final's Remington (2 cm out, turned 0.5 degrees) is off by
  0.2 mm, and only FHSW's suicide bomb shows it.

## 2. A scope that names no picture: the Stinger and the SA-7

**The question.** Desert Combat's Stinger and SA-7 declare `useScope 1`,
`setSniperSight 0` and `setSightIcon "scout_ring_128x128.tga"`, and no
`setScopeIcon`. `soldier-hud.js` fell back to `sniper.tga` for the scope
picture, so the zoomed Stinger drew the sniper blackout round the ring. The
census asked whether that fallback was the engine's or a guess.

**What the engine does (SCOPE-6).** It is the engine's. The client's
FireArmsTemplate constructor (`0x0053c3f0`) builds `ScopeIcon` from
`"sniper.tga"` and `SightIcon` from `"scout_ring_128x128.tga"`, and SCOPE-2's
sync copies both into the HUD every frame whatever the `.con` declared. A
`useScope` weapon that names no picture therefore draws the sniper blackout,
and one that names no sight draws the ring. Desert Combat ships neither
texture and mounts `Mods/BF1942/` after its own path, so both are vanilla's
art.

**What changed.** Nothing the page draws. The two fallbacks are now named
constants citing the row (`SCOPE_ICON_DEFAULT`, `SIGHT_ICON_DEFAULT`), so the
next reader does not take them for a guess.

**How it was checked.** `tests/test_hud.py` `ScopeTableTests`, through
`hud_harness.mjs`'s soldier page:

- The Stinger zoomed, with Desert Combat's `scopes.json` row and its baked
  viewmodel block, writes `ScopeIndex 1`, `SniperSight false`,
  `ScopeIcon sniper.tga` and `SightIcon scout_ring_128x128.tga`.
- A weapon with no row and no words gets the same two defaults.
- The fixture row is the extracted pack's, for both the Stinger and the SA-7.
- Run against the extracted Desert Combat layout, those variables raise the
  blackout picture, the centre dot and the ring, and none of the sniper
  rifle's four sight-line fills.

**Open.** Whether the square blackout is letterboxed on a wide screen is still
SCOPE-4's open question, for every scope.

## 3. A hand machine gun heats, and the heat law every gun shares

**What was missing.** Desert Combat's M249 and PKM declare
`heatAddWhenFire 0.0265` / `0.03`, `coolDownPerSec 0.3` and
`timeDelayOnOverHeat 2`. The hand weapon had no heat at all.

**What the engine does.** Read in lnxded for this round, and recorded:

- GUN-14, a pull: `Fire` adds `heatAddWhenFire` once, after the barrels, with
  no clamp. A pull made at heat 1 or more fires nothing and starts the
  `timeDelayOnOverHeat` lockout. A `velocityDependentOnHeat` weapon (every
  grenade, which also declares `heatAddWhenFire 0.03`) uses the field as the
  throw's charge instead, and never overheats.
- GUN-15, the drain: once a 30 Hz tick, `coolDownPerSec / 30`, but only while
  both the fire timer and the lockout have run out. Nothing cools through the
  lockout, and a held burst drains only the one tick a round's timer runs out.
- GUN-16, the HUD and a holster: the soldier HUD writes the held weapon's raw
  heat into `Overheat/OverHeat`, which the `ATIconAndStrengthBar` leaf draws as
  the heat bar beside the rounds. A holstered item keeps its heat; that it is
  not updated while away is inferred.
- GUN-13 restored: a gun fires on whole ticks (`gun-cycle.js` already cited
  the row, which the 2026-09-30 salvage had lost). The M249's
  `roundOfFire 13.5` fires 10 a second.

**What was built.**

- `extract_viewmodel.py` `weapon_block` writes `weaponStats.heat`: the three
  words and `velocityDependentOnHeat`, which `bf42/con.py` now parses. This is
  the one exporter change.
- `kit-ammo.js` `itemHeat` builds a `fire-state.js` `FireState` over those
  words, one per kit item, so a hot gun swapped away comes back hot. A depot
  does not cool it; a new life is cold, and a kit off the ground brings the
  heat its owner left (section 9). A weapon
  with no words, or with `velocityDependentOnHeat`, gets none. A new life
  with the same weapon keeps the rig (`ensureHandWeapon`), so it re-points
  the heat with the rounds. Without that, a redeploy with a hot M249 spawned
  at 0.86 (review, `respawn_heat.cjs` in the page). Whether a kit off the
  ground brings its heat is read and built in section 9.
- `hand-fire.js` steps it while the item is enabled, gates the trigger on its
  `canFire`, and bills it once a pull. `soldier-hud.js` hands its heat to
  `writeSoldierAmmo`, which writes `Overheat/OverHeat`.
- `fire-state.js`'s heat now follows GUN-14 and GUN-15: no clamp, no drain
  through the lockout, and a 30 Hz drain gated on the round's fire timer. The
  old rule drained continuously. At the guns' real 10 rounds a second that
  took a round's heat off between rounds, so with the old rule neither hand
  MG, nor vanilla's pintle Browning, ever overheated. This changes every
  vehicle MG, which is the engine's own code path for them too.

**How it was checked.** `tests/test_hand_heat.py` drives
`hand_heat_harness.mjs`: the item rule, the HUD feed, and a held trigger in the
page's order (heat stepped per frame, rounds on 30 Hz ticks) for the hand MGs,
and per world tick for the seat guns. Held-trigger numbers, before the law
change and after it (`~/.cache/dc-sweep/hand-weapons/before/run_heat_before.py`):

| Gun | Rounds before the first refused pull, before | After |
|---|---|---|
| DC M249 (10 a second) | never in 30 s | 60, at 5.9 s |
| DC PKM (10 a second) | never | 50, at 4.9 s |
| Vanilla stationary MG42 (15 a second) | 73, at 4.8 s | 38, at 2.5 s |
| Vanilla pintle Browning (10 a second) | never | 38, at 3.7 s |
| Vanilla coaxial Browning (10 a second) | 49, at 4.8 s | 25, at 2.4 s |

After the lockout a held trigger fired one round per lockout here, about one
every 2 s, and the engine is slower. Section 5 builds the engine's refused
pull, which moves the M249 to 61 and the PKM to 51.

**Checked against the real game (review, 2026-10-07).** The lab's vanilla
server recordings (35 files under `~/bf1942-lab/runs/2026100[3-6]-*`, every
round in them an `f` record, fake rounds included) hold 50,577 rounds from 483
stationary, pintle and coaxial MGs. Bots stop a burst at heat 0.8 and resume at
0.5 (AI-130's `BAPConWeaponHeat(0.8, 0.5)`, lnxded `evaluate` `0x08555510`,
reading FireArms+0x238). The longest uninterrupted bursts are 30 rounds for the
MG42 and the Browning, and 20 for the coaxial Browning. That is where GUN-14 and
GUN-15 first reach 0.8: 0.04 − 0.4/30 a round is 0.813 at round 30, and
0.05 − 0.3/30 is 0.81 at round 20. The old continuous drain would reach 0.8 at
the MG42's 60th round and the coax's 40th, and never on the Browning. Replayed
through GUN-14/15, no recorded burst ends above heat 0.827, 575 of 1,046 MG42
bursts end at 0.8 or more, and none of the old rule's ends at 0.8 (its maximum
is 0.43). `FireState`, fed the same 46,714 recorded pulls at the seat's tick
order, matches a float32 emulation of the binary to 8e-6 and refuses none of
them. The scripts are `bursts.py`, `lawcheck.py`, `aicheck.py` and `fsnode/cmp.mjs`
in `~/.cache/dc-sweep/review-hand-weapons/`. The bots never reach the lockout,
so the 38 rounds to the first refused pull rest on GUN-14 alone.

In the page, with the scratch-extracted M249 served in place of the live one
(`hand_page.cjs`): a held trigger fired 61 to 62 rounds before the lockout
(sampled every ten frames, with the page's own animation frames running
between them), then one round per lockout, and `Overheat/OverHeat` followed
the heat from 0.09 at the first sample to 1.01 at the lockout, under
`Ammo/AmmoType 3`. `test_seats.py` and `test_replay_hud.py` carry the law's own numbers:
heat 1.2 after three 0.4 pulls, still locked when the 2 s delay ends; a
replayed coax at 0.46, not 0.3.

A scratch extraction (`extract_viewmodel.py --mod DesertCombat --out
~/.cache/dc-sweep/hand-weapons/extract-dc USSoldier M249 IraqSoldier PKM
USSoldier GrenadeAllies USSoldier Remington`) changes only `weaponStats` in
each glb: the M249 and PKM gain `heat`, the grenade
`{heatAddWhenFire 0.03, velocityDependentOnHeat true}`, and the Remington
nothing. The nodes are unchanged.

**Assets.** The hand path reads `weaponStats.heat`, so the hand MGs heat only
once their viewmodels are re-extracted. Only the trees whose hand weapons
declare heat are affected: Desert Combat (M249, PKM), DC Final (M249, PKM,
`Mortar_weap`), and the grenades everywhere, which only gain the flag that
keeps them out. Vanilla and the expansions ship no hand weapon with an
overheat. The lead's commands are in the package report.

**Open.**

- ~~The lockout starts on the round that crosses 1 and is never restarted.~~
  Built in section 5.
- ~~Whether a tick runs the soldier's fire message or the weapon's
  `handleUpdate` first~~: the trigger first (IMP-8's `simulateFrame` order),
  as the round counts assume.
- ~~A grenade's charge is read and not built.~~ Built in section 8.
- The page's bots do not stop at heat 0.8 (`bot-fire.js` names the break
  but nothing implements it). Retail bots never reach a lockout. Under this law
  a page bot that holds a vehicle MG's trigger reaches it after 38 rounds, then
  fires about one round every 2 s. Under the old law it reached it after 73
  rounds, or never on a Browning. Porting `BAPConWeaponHeat(0.8, 0.5)` is the `bots` package's
  work.

## 4. The turn spread: Desert Combat's rifles widen when the view swings

**What was wrong.** Every Desert Combat rifle, LMG, sniper and AT weapon
declares `setTurnDev` (the M16 `2 0.1 0.2 0.1`, the PKM `3 0.15 0.3 0.1`);
vanilla's are all zero. `deviation.js` took the look as a view slew in rad/s
and divided it by 30 per tick, so the per-tick raise never beat the 0.1 decay
and the M16's turn channel stayed at 0 up to 15 rad/s (the adversarial sweep's
CW3, `~/.cache/dc-sweep/reports/adv-conwords.md`).

**What the engine does (DEV-10).** `updateDeviation` reads the soldier's
stored PlayerInput (`getPlayerInput`, `this + 0x40c`): a verbatim copy of the
tick's input, taken before `handlePlayerInput` applies the zoom factor and the
recoil to its own copy. So the look terms are in the input's own unit, GUN-2b's
device rate `0.001 x counts/s x (5 x sensitivity + 0.1)`: 1.35 at the infantry
default, the same law the air-input package read for the Air profile's 3.85
(MLK-7). The soldier turns 3 times that value in degrees a tick, so 1.0 is a
90 deg/s swing. Each term sits behind the same 0.01 deadzone as the speed gates.

**What was built.** `deviation.js` takes `lookX`/`lookY` as that input, with the
deadzone. `hand-fire.js` hands it `local-look.js`'s held mouse axis (`map.html`
passes `mouseInput` into the hand weapon's bag); the old per-tick accumulator of
applied view radians, which carried the zoom and the recoil, is gone. The bots
already passed their own `lookX`/`lookY`, which are this unit, so their DC
weapons now open on a swing too.

**How it was checked.** `tests/test_deviation.py` (`deviation_harness.mjs`):

- The M16 at 90 deg/s nets +0.1 a tick and stands at its 2 deg cap after 20
  ticks. At 45 deg/s the raise only matches the decay.
- Crouched (devMod 0.75) it needs 180 deg/s: the raise is M squared against a
  decay of d / M.
- The PKM climbs at 45 deg/s to its 4.5 deg cap.
- A look under 0.01 raises nothing.
- A vanilla Thompson swung at 90 deg/s in both axes adds nothing.

In the page (`~/.cache/dc-sweep/hand-weapons/turn_page.cjs`), DC's Lost Village
with `?weapon=M16` and `__lookDelta(25, 0)` a frame at 30 fps (750 counts a
second, input 1.01): the cone went from 0.4 to 2.37 degrees in a second.

**Open.** At the shipped infantry sensitivity, 1.0 of input is 740 counts a
second. How a browser `movementX` pixel maps to a DirectInput count is
`mouse-input.js`'s one unproven unit, so how hard a viewer player must swing to
open the M16 depends on it.

## 5. A held trigger's refused pull restarts the lockout

Built 2026-10-07 (package `hand-weapons-2`).

**What was wrong.** `FireState` started the `timeDelayOnOverHeat` lockout on
the round that crossed heat 1 and never restarted it. The engine starts it on
the pull after that round, the one the heat refuses, and starts it again on
every refused pull after it, so a held trigger cooled through every second
lockout here and fired about twice the engine's rate after the first one. The
M249 and PKM also locked one round early, and a trigger let go on the crossing
round locked here when it does not in the engine.

**What the engine does (GUN-18).** `handleMessage`'s fire message reaches
`Fire` only past the reload timer, the lockout and the round's fire timer, in
that order. `Fire` refuses the pull at heat 1 or more and starts the lockout
(GUN-14's restart at `0x0828ab30`). The crossing round starts nothing. With the
trigger held, each lockout is followed by exactly one drain tick (GUN-15) and
one more pull. In float32 the M249's 60th round leaves the heat a few ulps
under 1, and the PKM's 50th crosses at 1.0099996 and drains back under it, so
the first refusals come after 61 and 51 rounds.

**What was built.**

- `fire-state.js` `FireState.trigger(held)`: the caller reports the trigger
  before `step`. The heat's tick loop closes each tick with the held pull,
  which starts the lockout when the reload, the lockout and the fire timer are
  out and the heat is 1 or more. `canFire` is still a pure getter, because the
  HUD and the hooks read it every frame.
- The heat's add and drain are float32, as the engine stores them. In doubles
  the PKM's 50th round stays over 1 after its drain.
- `hand-fire.js` reports `triggerHeld` (armed, not reloading) before stepping
  the item's heat. `world-vehicle-tick.js` reports each seat gun's trigger
  before its step, a two-hunk change.
- A caller that never reports the trigger keeps the old rule, the lockout at
  the crossing round. The only such caller is `replay-hud.js` `gunStateAt`,
  which has only the recorded rounds. For it a crossing round stands in for a
  trigger still held.

**How it was checked.** `tests/test_hand_heat.py` now runs the binary's law in
float32 (`engineHold` in `hand_heat_harness.mjs`: the pull through the three
gates, then `handleUpdate`) beside the page's order:

| Gun, held 30 s | First refusal, engine | Page, before | Page, now | Rounds in 30 s, engine / now |
|---|---|---|---|---|
| DC M249 (hand, 60 fps) | 61 | 60 | 61 | 68 / 68 |
| DC PKM (hand, 60 fps) | 51 | 50 | 51 | 56 / 56 |
| Vanilla stationary MG42 (seat) | 38 | 38 | 38 | 44 / 44 |
| Vanilla pintle Browning (seat) | 38 | 38 | 38 | 44 / 44 |
| Vanilla coaxial Browning (seat) | 25 | 25 | 25 | 29 / 29 |

The seat guns fire every round on the engine's own tick for the whole 30 s.
After the first lockout a held trigger fires 0.2 to 0.3 rounds a second, as the
engine does; before, it fired 0.4 to 0.5. An M249 let go on its crossing round
gets no lockout and is cold again within 10 s.

**Checked against the real game (review, 2026-10-07).** One lab recording
holds a lockout: a bot's coaxial Browning on El Alamein
(`20261007-012156-elalamein-coop-lod0-rec`, pid 233, object 1081) fired 25
rounds from cold, to heat 1.0100003 and 1.0000004 after its drain, and its
next round came 2.133 s (64 ticks) later. `FireState` held from cold gives 64
ticks with the trigger reported, and 62 under the old lockout-at-the-crossing
rule: the refused pull starts the lockout three ticks after the round, and in
float32 the 2 s lockout takes 61 ticks. Over every lab recording, vanilla and
Desert Combat (65,431 rounds from ten MGs, the M249 and the PKM among them),
`FireState` matches the float32 law to the bit and refuses no recorded round,
and the bursts end where the law reaches the bots' 0.8: within a round on the
vanilla guns; 68 rounds on Desert Combat's Iraqi coaxial MG, where the law
reaches 0.8 at its 69th and the old continuous drain at its 119th; and one
51-round bot M249 burst from cold, which the law takes to 0.802 at its 48th,
then a 44-tick pause, the drain from 0.85 to the bots' resume at 0.5 plus the
same lag. Scripts: `bursts.py`, `dump_ticks.py`, `fsnode/cmp.mjs` and
`fsnode/coax.mjs` in `~/.cache/dc-sweep/review-hand-weapons-2/lab/`.

**Open.**

- `replay-hud.js` (not this package's file) could report the trigger as held
  between a crossing round and the next recorded round. It would then show
  the engine's lockout, restarts included. Today it keeps the single lockout.
- ~~GUN-15's tick-order question stands.~~ Settled by IMP-8's reading:
  `GameServer::simulateFrame` runs the players' update, where the trigger's
  message fires, before the objects' `handleUpdate`. The trigger first, as
  `gun-cycle.js` and the round counts assume.

## 6. The weapon's camera shake: the fire kick and the sniper's sway

Built 2026-10-07 (package `hand-weapons-2`; the adversarial sweep's CW15).

**What was missing.** Desert Combat declares 303 `setCameraShake*` lines on its
`Ub_*` states and vanilla 286 of its own. The Bazooka, Stinger and RPG-7 jolt
the eye 1 m up and down at 500 rad/s, the M16A2 buzzes at 0.25 degrees, and the
snipers kick and then sway while aimed. The page played none of them. Only the
walking bob was built (`soldier.js` `BOB`), and that one is multiplied by a
shipped zero (CS-6).

**What the engine does.** Read in lnxded and the client for this round:

- CS-8, one shake's life. A state holds two blocks, each with six channels, a
  fade in, a fade out, a floor and a time limit. The factor snaps or fades in
  to 1, then fades out at once. Under 0.001 the next slot starts, and a slot
  with no block ends the shake. A floored shake (the sniper's sway, 0.075)
  never ends. Each channel is `amplitude × factor × sin(rate × t)`.
- CS-9, what starts it. Only entering a state unlike the current one restarts
  its shake. A state's own `c_PIFire` self-transition does not: a looping
  automatic shakes once a burst, and a one-shot fire state shakes each time it
  is entered anew from aim.
- CS-10: a clone takes the shake its source has at the time of the copy
  (corrected by the review: `copyStateData` copies both blocks). The weapons'
  shakes are set after the clones, so no shipped upper-body clone inherits one.
- CS-11, where it goes. `Camera::getTransformation`, the render path, puts the
  shake on the left of the camera's transform, in the camera's own frame.
  Rounds launch from the camera's absolute transform, which carries none of
  it, so a kick moves the picture and the cross while the round flies down the
  steady axis.

**What was built.**

- `bf42/animstates.py` parses the shake lines onto the state that
  `createState` or `setActiveState` names. A clone copies what its source
  has at the copy, and a `setActiveState` naming no state takes nothing. `State.camera_shake_extras`
  gives the slots in order.
- `extract_viewmodel.py` writes each clip family's shake into the viewmodel's
  extras (`clips.<family>.cameraShake`). The families are the upper states:
  `fire` is `Ub_Fire<W>`, `proneFire` is `Ub_LieFire<W>`, and `idle`,
  `crouch` and `prone` are the aim states that carry the sniper sway.
- `viewer/fire-shake.js`: `CameraShake` is `getCameraShakeTransform` for one
  instance. `applyViewShake` turns and moves a camera in its own frame, with
  the engine's signs and channel order.
- `hand-fire.js` `stepViewShake` enters the state the arms are in
  (`hw.active`) when it changes, and runs one frame of its shake.
  `beginHandFire` lets a one-shot fire state restart only when the last pass
  has run out.
- `hand-weapon.js` `shakeView` puts that frame on `page.camera` for the draw
  alone. `map.html` `draw` calls it around the world render and the near pass,
  then puts the camera back. The rig copies the shaken camera, as the engine's
  rig rides it, and the rounds, the hitscan and the HUD read the steady one.
- `hand-fire.js` `startReload` waits for the last round's fire cycle
  (`hw.cool`, the round's `1 / roundOfFire`). The engine refuses the reload
  message while `timeToFireFinished` runs (`handleMessage` `0x082899c8`), and
  its automatic change waits for it (BODY-7). Before this, a dry magazine
  started the reload on the next frame. That cut the Bazooka's one-second
  fire state, and its shake, after one frame. The bots got the same fix in
  AI-133.

**How it was checked.**

- `tests/test_fire_shake.py` (`fire_shake_harness.mjs`): the Bazooka at full
  strength on its first frame, down to 0.15 at 0.3 s and ended by 0.5 s; the
  Thompson held at 1 through a 5 s burst; the K98 sniper's kick chaining into
  its slow drift at 0.27 s; the sniper sway held at 0.075 after 10 s; a fade-in
  as a rate; a time limit; the restart rule; and the camera's turn and move
  signs, each undone.
- The archive case parses the installed packs: vanilla has 42 upper states
  with a shake, and Desert Combat 101 (vanilla's 42 among them).
- `tests/test_animstates.py` `CameraShakeTests` covers the parser: clones,
  missing states, slots, and the clamp.

In the page (`~/.cache/dc-sweep/hand-weapons-2/shake_page.cjs`, El Alamein with
`?weapon=Bazooka` and then `No4Sniper`, the scratch viewmodels routed in, the
page's own animation loop stopped, 1/60 s frames), each frame compares the
camera the world was drawn with to the camera the frame leaves behind:

- Idle Bazooka: no difference.
- Bazooka shot: the drawn view is off for 20 frames, a third of a second, by
  up to 1.19 m and 0.63 degrees. It is back on the steady camera from frame
  22.
- Bazooka reload: it starts at frame 62, once the 1 s fire cycle has run out.
  Before the reload fix it started on the frame after the shot, and no shake
  showed.
- No4 sniper, aiming: the view sways up to 0.20 degrees.

A scratch extraction (`extract_viewmodel.py --no-optimise --out
~/.cache/dc-sweep/hand-weapons-2/extract-bf BritishSoldier Bazooka
BritishSoldier No4Sniper BritishSoldier Thompson`) changes only
`clips.<family>.cameraShake`. Nodes, meshes, skins and animations are equal to
the live glbs (`glbdiff.py`).

**Assets.** The page shakes only once the viewmodels are re-extracted, in every
tree: every vanilla, XPack, Desert Combat and DC Final weapon with a shaking
state. The lead's commands are in the package report.

**Open.**

- The viewer's arms clip (`hw.active`) stands in for the upper machine's
  state. The two agree for the fire, aim, reload and deploy families. A clip
  the viewer cuts short, or holds clamped past the engine's return, moves the
  shake's end with it.
- The explosion, hit and death shakes (`BigExplosion`, `HitShake`,
  `DieShake`, the trigger machine) and the stationary guns'
  `FireMachineGunShake` are not built.
- Bots shake nothing. It is a view, and only the human's is drawn.

## 7. A hand weapon's pull costs what `salvo()` says

Built 2026-10-07 (package `hand-weapons-2`, asked for by the lead from the
engine-reads package's BOMB-13).

**What was wrong.** `gunfire.js` hands every `onShot` what a pull cost, from
`salvo()` (BOMB-1..BOMB-5). The hand weapon ignored it and charged one round
a pull. It also left `guns.roundsLeft` unanswered for its own group, so
`salvo()` read it as unlimited. That had two effects:

- A two-barrel hand weapon with no `setAsynchronyFire` fired both barrels and
  paid one round.
- At its last round it still fired both barrels (BOMB-5's partial salvo needs
  the magazine).

Vanilla's and Desert Combat's hand weapons all have one barrel, except the
shotguns, which declare `blastAmmoCount` and so pay one shell for eight
pellets. The weapons this fixes are FH's 36, FHSW's 73, bf1918's 20 and
FinnWars' 2.

**What was built.** `hand-fire.js`:

- `onShot` charges `salvo()`'s answer, through `handCharge`.
- `handCharge` caps a `blastAmmoCount` weapon at one round (the FireArms
  extras' `blastAmmoCount`; absent means not set). That holds even before
  `salvo()` itself is told of the flag, which is the engine-reads branch's
  change.
- `roundsLeft` answers `hw.rounds` for the hand weapon's own group.

**How it was checked.** `tests/test_hand_fire.py` (`hand_fire_harness.mjs`,
`createHandFire` over a stub page, each pull through `salvo()` and then
`onShot`):

| Weapon | Barrels fired | Rounds charged |
|---|---|---|
| A rifle | 1 | 1 |
| Two barrels | 2 | 2 (1 before) |
| Two barrels on its last round | 1 | 1 (2 fired before) |
| Two barrels with asynchrony | 1 | 1 |
| A `blastAmmoCount` shotgun | 8 | 1 |
| Unlimited | 2 | 0 |

A gun not in the hand still answers from its `FireState`. The same file pins
the reload's wait for the fire cycle (section 6).

**Assets.** The shotguns' `blastAmmoCount` reaches the hand weapon only
through the FireArms extras, which the engine-reads branch adds to
`bf42/assemble.py`. Until the Desert Combat and DC Final Remington and
Saiga12k viewmodels are re-extracted with that exporter, the field is absent:
`salvo()` charges eight rounds a pull, so one pull empties the Remington. Run
that re-extract in the same pass as section 6's.

## 8. A grenade's alt-fire throw: hold to charge, let go to throw

Built 2026-10-07 (package `hand-weapons-2`).

**What was missing.** Every grenade declares `velocityDependentOnHeat 1`, which
turns its `heatAddWhenFire 0.03` into the strength of the throw (GUN-14). The
page threw every grenade at full strength, and the bar beside it stayed empty.

**What the engine does (GUN-19).**

- The fire button: its message sets the heat to 1.0 and pulls. The throw
  leaves at the full `velocity`.
- The alt-fire button: its message only raises the weapon's trigger flag.
  Each tick with no throw pending and no fire or reload timer running,
  `handleUpdate` adds 0.03 while the flag is up, capped at 1, so the charge is
  full after 34 ticks (1.13 s). On the first tick the button is up, with the
  heat above 0.01, it pulls, and the round leaves at `velocity × heat`.
- Either pull winds up `fireDelay` (the grenade feature's reading, now read in
  `Fire`), and the charge holds through it. Only a FireArms' very first throw
  leaves at once; the page winds up that one too.

**What was built.**

- `viewer/throw-charge.js` `ThrowCharge` is the branch's ticks.
- `hand-weapon.js` builds one for a `velocityDependentOnHeat` weapon when it
  is raised, so a raise starts it at 0, as `HandFireArms::enable` does.
- `hand-fire.js`: the alt-fire button (`aimHeld`, which a grenade uses for
  nothing else) charges it, and its release starts the throw as a click does.
  The fire button fills it to 1. `pullHandTrigger` launches the round at
  `velocity × heat`: the group's stats are seen through a copy with the
  scaled velocity until the pulse that asked for the round ends. `onShot`
  sets the heat back to 0. It does not put the stats back: `gunfire.js`
  `fireShot` calls `onShot` before `fireBarrel` launches the round, and a
  restore there (the first build) sent every charged throw at full speed.
- `soldier-hud.js` hands the charge to the heat bar (one line, outside this
  package's list, because that is where the bar is fed).

**How it was checked.** `tests/test_grenade_charge.py`
(`grenade_charge_harness.mjs`, `footFire` with a stub page at 60 fps, a round
fired on the tick after its pulse, a 25 m/s grenade):

| Input | Charge | Throw |
|---|---|---|
| Alt-fire held 0.5 s | 0.45 | at 11.25 m/s, 1.0 s after the release |
| Alt-fire held 2 s | 1 (full at 1.12 s) | at 25 m/s |
| Alt-fire for one tick | 0.03 | at 0.75 m/s, at the feet |
| Fire button | 1 through the wind-up | at 25 m/s |

After each throw the heat is 0 and the group's stats are its own again.
`tests/test_hud.py` `GrenadeChargeBarTests` puts a 0.45 charge on
`Overheat/OverHeat` under `Ammo/AmmoType 3`.

The harness first read the velocity before calling `onShot`, the reverse of
`fireShot`'s order, and passed while the page threw every charge at 25 m/s.
The review found it in the page (vanilla El Alamein, a scratch-extracted
`GrenadeAllies`, the rounds tracked in the scene,
`~/.cache/dc-sweep/review-hand-weapons-2/shake_review.cjs grenade`): the fire
button's throw and a full charge leave at 25.1 m/s, half a second of charge
now at 11.5 (25.1 before the fix). The harness now calls `onShot` first, and
fails on the first build.

**Assets.** The hand weapon reads `weaponStats.heat`, which the grenades' viewmodels
carry only once re-extracted (section 3). The re-extract of every tree for
section 6 covers it.

**Open.**

- ~~A FireArms' first throw leaves at once in the engine.~~ It does not for a
  hand weapon: `HandFireArms::enable` sets the `fireDelay` timer as the
  weapon is raised (GUN-19), so every throw winds up, as the page does.
- Bots throw at full strength, which is the fire button's throw.

## 9. A kit picked up off the ground brings its weapons' heat

Built 2026-10-07 (package `hand-weapons-2`).

**The question.** Section 3 left a kit off the ground cold, and said it was not
read. KITDROP-7 has the kit's own weapons arriving with their rounds, and
GUN-16 inferred that a disabled item keeps its heat.

**What the engine does (KITDROP-9).**

- `dropKit` takes the gun in hand out with `removeItem`, which disables it. The
  heat and a running lockout are kept; the fire and reload timers are zeroed.
- A disabled item carries object flag bit 0, and
  `ObjectManager::updateObjects` skips any object that has it. Nothing drains
  while the kit lies there, which turns GUN-16's inference into a reading.
- `pickupKit` enables the raised item. That clears the bit, and the heat is
  zeroed only for a grenade.

So a hot M249 is picked up as hot as its owner left it, lockout included, and
cools from there.

**What was built.**

- `kit-ammo.js` `snapshot` writes a gun's heat and lockout into its row.
  `adopt` keeps them on the new entry (`carriedHeat`), and `itemHeat` puts
  them on the `FireState` it builds when the gun is first raised. A gun
  dropped again before it is raised still carries them.
- `kit-drops.js` copies a row's heat with the row.
- `kit-ammo.js` is outside this package's list. It is where the rows the drop
  carries are made and read.

**How it was checked.** `tests/test_hand_heat.py`:

- An M249 dropped at heat 1.0165, 1.25 s into its lockout, comes back with
  both. It is cold 4.6 s after the pickup: the 1.25 s lockout, then 102 ticks
  of drain.
- A rifle's row carries no heat.
- A new life is still cold.

**Open.** Bots model no hand-weapon heat, so a bot's dropped M249 comes up
cold. That is the `bots` package's work.

## 10. Where a round's first sweep starts: the spawn point, as the page has it

Read 2026-10-07 (package `hand-weapons-2`). Nothing to change.

**The question.** Section 1 moved the RPG-7's rocket to its `projectilePosition`,
0.73 m ahead of the eye (XHIT-12). The review asked whether retail sweeps the
stretch from the eye to that point. If it does not, two things follow. A wall
nearer than 0.73 m is passed. And a prone shot, level, up a slope steeper than
about 22 degrees spawns the rocket underground.

**What the engine does (IMP-8).**

- `fireBarrel` puts the round at the launch frame.
- In the same tick, the physics nodes move it before the world's collision
  runs.
- The collision sweeps `pos - v·dt -> pos`. So the first segment starts at the
  spawn point, and the eye-to-spawn stretch is never tested.
- The terrain counts only a segment that crosses its surface from above. A
  rocket spawned underground is not caught and runs on beneath the slope.

**What the viewer does.** The same:

- `projectile-flight.js` `sweep` tests the segment the round just flew, which
  on its first step starts where `round-launch.js` launched it.
- `world-collider.js`'s terrain march returns no hit for a segment that starts
  at or below the ground. `test_collision.py`
  `test_nothing_is_hit_going_up_or_starting_underground` already pins this.

`round-launch.js` is untouched.

**Open.** Whether the objects' sweep (`checkObjectVsObjects`) catches a round
that starts inside a static's hull is not read. It uses the same segment.
