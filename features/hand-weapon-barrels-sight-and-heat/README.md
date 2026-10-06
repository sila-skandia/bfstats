# Hand weapons: barrels, a scope with no picture, and heat

Status: built 2026-10-06 (Desert Combat fix round, package `hand-weapons`):
the shotgun barrels (section 1) and the Stinger's sight, read and confirmed
(section 2). Section 3 follows.

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
