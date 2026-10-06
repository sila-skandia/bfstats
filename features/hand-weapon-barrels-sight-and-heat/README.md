# Hand weapons: barrels, a scope with no picture, heat and the turn spread

Status: built 2026-10-06 (Desert Combat fix round, package `hand-weapons`):
the shotgun barrels (section 1), the Stinger's sight, read and confirmed
(section 2), and the hand MG's heat with the heat law every gun shares
(section 3). The page sees the hand MG's heat once the Desert Combat and DC
Final viewmodels are re-extracted (section 3, "Assets").

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
  does not cool it; a new life and a kit off the ground are cold. A weapon
  with no words, or with `velocityDependentOnHeat`, gets none.
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

After the lockout a held trigger fires one round per lockout, about one every
2 s.

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

- The lockout starts on the round that crosses 1, not on the refused pull
  after it (GUN-14). A held trigger reaches that pull one round period later;
  a trigger let go on exactly the crossing round is locked here and not in the
  engine.
- Whether a tick runs the soldier's fire message or the weapon's
  `handleUpdate` first decides whether the drain lands before or after the
  round. The round counts assume the trigger first, as `gun-cycle.js` does
  (GUN-15).
- A grenade's charge (hold to charge, release to throw at `velocity × heat`)
  is read in the decompile (GUN-14) and not built: the page throws at the full
  `velocity`, and the bar beside a grenade stays empty.
- A server-lab recording of a held stationary MG42 would confirm the 38 rounds
  against the real game.

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
