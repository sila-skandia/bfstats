# Round replay: the player's own HUD in first person

Asked 2026-09-29 while watching `replay_20260928-133433` (Bocage):

- "Can we render a cross hair on the FPV that would be honest to the
  game-play? I don't mind if we calculate the cross hair size, but placing it
  exactly where the game does would be handy."
- "With the HUD, how faithful can we be to the in-game? E.g. the player's
  health bar, the vehicle's health bar? What about ammo?"

In first person (camera 2) the followed player's HUD is now the game's own
HUD: `hud.js` painting `menu/InGame`'s layout, with the page's DOM cross at
its centre. `replay-hud.js` feeds it from the recording in place of the page's
soldier. It shows nothing in the orbit, in the free camera, on the spawn
screen or in the death cam, and H hides it with the rest.

## Where the cross is

The game draws its cross at the centre of the screen, so the replay's view has
to be the player's own. Two changes to `replay-camera.js` make it so:

- **The torso twist.** A soldier's recorded rotation is his heading. The body
  record's twist (`st`, BFSoldier `+0x2B4`) is a third of the view's turn
  off it, and the aim pitch (`+0x2B0`) is 0.4 of the view's pitch. The view
  used to ignore the twist. Measured on the hand-weapon rounds of three
  recordings, each round against its soldier's sample and body record within
  50 ms: a round's pitch is 2.50 times the recorded pitch at the median (1,165
  rounds), and its yaw off the sample's is -2.93 times the twist (135 rounds
  with a twist over a degree). With a scale of 3 the view is 0.16 degrees from
  a round at the median and 3.1 at the 90th percentile; without the twist it
  was 0.27 and 6.0. `replay-recording.js` `AIM_PITCH_SCALE`, `AIM_TWIST_SCALE`,
  `aimAt` (eased between records like a pose).
- **The rounds' own axes.** Every vanilla hand weapon fires along the camera
  (`fireInCameraDof`), so each `f` record's direction is where he looked at
  that instant. The view is laid on each round's axis, blended across a burst,
  and gone a quarter of a second after the last round (`viewOf`, `shotFix`).
  What he throws or lays leaves above his view and is left out. On the Bocage
  round's 1,443 rounds the recorded aim alone is 0.55 degrees off at the
  median and 6.3 at the 90th percentile (samples fall between records); the
  view is 0 at every round. Nothing is eased: an eased view trailed a turn and
  left the cross behind the rounds.

When the viewer drags the first-person view off his aim, the cross goes away,
because the centre is no longer where he looked.

### Lying down, the view is on his body

Reported the same day: "when players go prone and you're watching fpv, the
cross hair is way off where they were actually shooting. At 35:20 'Instant
Replay' is shooting at env()->Amsterdam while prone. Their FPV is shooting at
the sky." (`replay_20260928-161948`.)

A prone soldier's recorded rotation lies along the ground under him. From
35:24 Instant Replay lay on 27 degrees of downhill, rolled 15 across it, with
8.7 recorded degrees of aim pitch. The view took only the rotation's heading
and put the aim pitch on the level, 21.8 degrees up, while his rounds left 6
below it. That is 28 degrees too high, past the 20 degree limit for laying
the view on a round, so nothing corrected it.

The twist and the pitch are turns in the body's own frame, and the eye is the
template's camera offset along the body's up (`eyeAim`, `viewQuaternion`,
replay-recording.js `eyeLiftAt`). Standing and crouched, the body is upright
and nothing changes. Over 1,804 rounds fired prone in seven recordings, the
view from the records alone is 0.22 degrees from them at the median and 1.2
at the 90th percentile; read off the level it was 3.7 and 12.5. The eye is
7 mm from where his rounds left (1,098 rounds lying on more than 5 degrees),
against 12 cm for 0.7 m straight down.

Lying across a slope, the view rolls with him, as the game's does: the
camera is a child of the soldier (`M` in
`handweapon-view-and-deviation.md` §3), and the rounds say so. On 480 prone
rounds with more than 8 degrees of roll, more than half are exactly the
rolled body's composition (the client works a remote soldier's shot out of
the same replicated values), and with the roll taken out they are 3.3
degrees off at the median. The eye moves between stances as the page's own
soldier's does: the running dive to the ground takes 0.28 s, standing up
from lying 0.115 s (soldier.js `STANCE_TRANSITION`).

At the kill, 35:26, the view was 30 degrees above his round and is now 0.04
degrees from it, with env()->Amsterdam under the cross, 102 m off.

## The weapon in his hands

"We just added FPV HUD to the replay ... But their weapon is not being
wielded in the game (it's just a crosshair)."

The followed player's arms and weapon are the page's own first-person rig,
`<Soldier>__<Weapon>.fp.glb` in his side's sleeves (arms-rig.js), mounted on
the camera as the engine mounts it and drawn in its own pass over the frame
through the weapon's `set1pFov`. `replay-viewmodel.js` poses it from the
recording:

- **What the arms play is recorded.** The body record's upper state is the
  engine's own animation state, and every upper state a weapon declares names
  its first-person clip: aim, walk, run, crouched and lying, the raise, the
  reload, the idle fidgets, the knife's five swings. The rig bakes those
  clips (extract_viewmodel.py `FAMILIES`), so the arms play the recorded
  state's clip (`ARMS_FAMILY`). A turn on the spot plays the run clip at 0.7,
  so it takes the walk (0.5); a strafe or a backward run takes the run. A
  state with no first-person clip (a stance change, a hit) leaves the arms
  where they were. A lower state that puts the weapon away (swimming, a
  ladder, a chute, a seat: `c_AsmHideWeapon`) hides them.
- **Each state blends in at its own rate** (`setMorphFactor`: the aim 0.7 a
  second, fire 4, a raise or a reload a cut) over the pose the arms held when
  it came, blends included, as the engine blends into a state from whatever
  the skeleton holds.
- **The fire is his rounds.** At 10 samples a second the records catch a
  burst's fire state only now and then. Rounds of his weapon no further apart
  than 1.6 of its intervals are one hold of the trigger: a looping fire clip
  (the Thompson's, the Mp40's) runs on through them and lets go an interval
  after the last. A clip played once (a bolt, a swing, a throw) plays a round
  from the click. A throw's round leaves `fireDelay` after the click, and the
  grenade is out of his hand for `hideDuringFireTime` after it. A recorded
  fire state no round explains is a shot of its own.
- **His rounds leave his eye.** While his first person is watched and the rig
  is up, his round is fired through the rig's FireArms from the recorded
  origin, which is his eye, down the recorded axis, and flashes at the rig's
  muzzle. Before, it flashed at his hidden body's gun below the camera.
  Anything thrown or laid is the recording's own object, as before.
- **His zoom:** the rig leans into its zoom pose and the arms' lens narrows to
  the weapon's `soldierFov`, eased a frame at a time as the page's own
  soldier's are. A scoped rifle zoomed shows the scope and no rifle.

All of it is a function of the recording's clock: a seek, a pause or a speed
change needs nothing. The last six rigs used stay loaded (about 2.5 MB each).

## What each part of the HUD comes from

| part | source | |
|---|---|---|
| the cross's type | his weapon's `setCrossHairType` (glb `weapon.crossHair`), or in a seat the seat's (`hud.crossHairType`) | exact. A K98 sniper's is `CHTNone`, a grenade's the `hk` icon, and the Bofors draws none: its ring sight is on the gun |
| the centre dot | the server's `serverCrossHairCenterPoint`, `gameRules`' last byte | exact |
| the cross's spread | his weapon's deviation (`deviation.js`) run tick by tick over his recorded stance, his legs' state (walk, run and strafe mean the key was down; a jump) and his rounds, from as far back as the weapon takes to settle (`settleTime`: a BAR's bloom 3.9 s, a Thompson's 1.3). The cross opens 5 HUD units a degree of the whole cone, whatever the lens ("The cross's size") | computed |
| his zoom | the body record's state bit `0x20` (`ZOOM_BIT`), which the server sends for every soldier, not only the recording client's own | recorded. The view takes the weapon's `zoomFov` (a BAR's 28.6 degrees, a sniper rifle's 5.7), eased 0.3 a frame as the page eases its own; a scoped rifle draws the layout's scope and no cross, as in play |
| his health bar, stance icon, kit art | `a` records (hit points), `st` (stance), his kit | exact. A soldier with no recorded hit points (18 of 214 in the Bocage round) shows his spawn's full bar |
| a vehicle's icon, health, seat dots, turret dial | the seat's `hud` block, the hull's `a` records, the recorded crew, `IconLookRotation` from the camera against the hull | exact |
| ammunition on foot | counted from a full kit at his spawn: one round per `f`, a magazine change `reloadTime` after his torso's reload state or a dry magazine (the old magazine's rounds are lost, as in `hand-fire.js`), refills (`special` 0) | exact for a recording player. For anyone else it is an estimate: a client can miss a remote player's single taps, and nobody else's refills reach it |
| a seat gun's ammunition, heat, readiness, spread | the page's `FireState` run over the gun's recorded rounds since the hull's spawn; the cross takes the seat's second gun when it has one ("A seat gun's cross") | the same estimate for anyone but a recording player |
| the hit marks | his rounds against his victims' hit points (`replay-hitmarks.js`) | worked out. The server sends them, but as one bool the recorder does not read: see "The hit marks" |

## Files

- `viewer/replay-hud.js`: the state (`heldWeapon`, `weaponEvents`, `handAmmoAt`,
  `settleTime`, `spreadAt`, `gunStateAt`), the feed into `gameHud.vars`, and
  `crosshairAim`.
- `viewer/replay-camera.js`: `eyeAim`, `viewQuaternion`, `viewOf`, `shotFix`,
  `roundAxes`, and `sight` (what the first person looks out of).
- `viewer/replay-recording.js`: `eyeLiftAt`, the eye along the body's up.
- `viewer/replay-viewmodel.js`: the weapon in his hands (`armsStateOf`,
  `armsTrack`, `armsPose`, `ReplayViewmodel`); `replay-bodies.js` hands it his
  rounds, and map.html draws it after the frame (`renderViewmodel`).
- `viewer/soldier-hud.js`: `writeSoldierAmmo`, the ammo panel shared with the
  page's own soldier.
- `viewer/vehicle-hud.js`: `crosshairAim` asks the replay first (`replayAim`),
  and takes the server's centre dot from it.
- `viewer/map.html`: `feedHud` after `updateSoldierHud`, `replayAim`,
  `hudVars`.
- `viewer/replay-ui.js`, `viewer/replay-highlights.js`: the cross only in the
  first person (`replay-sight`), gone with H. The idle highlight ticker stays
  above the HUD's bottom band.

## Verified

- `tests/test_replay_hud.py` (`replay_hud_harness.mjs`): the aim's scales and
  easing, the view on a round's axis (3.1 degrees off from the records alone,
  0 with the round), a thrown grenade moving nothing, the held item, the ammo
  count through a burst, a reload, a refill and a bazooka's auto-reload, the
  spread (still, a burst, running at the speed channel's cap, the settling
  times), a seat gun's magazine, heat and reload, the variables fed on foot
  and in a seat and taken back after, his zoom (the bit, the lens eased in
  and out, a sniper's scope, a BAR's cross kept), and the page's cross asking
  the replay first.
- Headless on the Bocage round (Vulkan Chromium, the page's own renderer):
  skandia on foot with the BAR at 205.8 s: the cross at the stage's centre
  (640, 360), spread 2.25 degrees running (34.5 x 25.9 px, the projection
  "The cross's size" replaced), his recorded
  10/30 on the assault kit's bar, the BAR at 0 rounds and 4 spares mid-change.
  Prone at 217.6 s: the cross closed (now 3.75 units open, the BAR's floor). The grenade at 73 s: the `hk` icon, 2
  left. The KettenKrad's MG seat at 248 s: the KettenKrad's icon at 23/50,
  462 rounds, the cross. The Bofors at 101 s: no HUD cross. The orbit: nothing.

The prone view and the weapon (`tests/test_replay_hud.py`,
`tests/test_replay_viewmodel.py`): a soldier lying on 27 degrees rolled 15,
whose view from the records alone is on his round with the eye where it
left, the old level reading 28 degrees off, and the eye across a dive and a
get-up; the recorded states as families (the number after a weapon whose
name ends in digits, a stance change with no clip), the fallbacks, the arms
through a raise, a burst, a tap, a reload, a run, a dive, lying fire, a swim
and a grenade's wind-up, and the rig on a stub glb: loaded in his sleeves,
shown only in his first person, the mixer's weights, his round from his eye.

Headless on `replay_20260928-161948`: at the kill (35:26) the view is 0.04
degrees from his round and env()->Amsterdam is under the cross; the Mp40
lying down with its flash; the Walther after his switch; a stick grenade's
wind-up; a knife swing; a K98 sniper's scope with no rifle; another player's
Thompson zoomed; the Hanomag driver's seat with no weapon.

## Zoom is in every recording already

Asked next (2026-09-29): zoom is surely local to each client, so could the
first person show it for the recording player alone? It turned out to be
recorded for everyone. Bit `0x20` of the body record's state bits (`st`,
BFSoldier `+0x416`) is the zoom:

- it flipped on all 52 of the recording player's zoom presses (his `fire`
  input edges of kind 2) in `replay_20260928-133433`, alternating on and off,
  about 0.4 s after each press (49.59 to 49.99 s, 54.19 to 54.61 s); `0x80` is
  up while it changes;
- over four recordings every other soldier has it only with a weapon that
  zooms: a sniper rifle 23 to 25% of the time, rifles, submachine guns and
  pistols less, never a grenade, knife, wrench, medic pack, mine or detonator;
- 119 of 227 sniper rounds left zoomed and 3 were still zoomed 1.5 s later,
  the bolt's `unZoomBetweenFire`.

Headless on the Bocage round: Skipjack's K98 sniper at 153 s draws the scope
through a 5.73 degree lens with no cross; skandia's BAR at 55.6 s a 28.65
degree lens with the cross, its gap the same 2.25 degrees through the
narrower lens (twice as wide on screen; retail keeps the cross as it was,
"The cross's size").

## The hit marks (2026-10-04)

Asked: "do you think it would be possible to show cross hair hit indicators?
Right now we render the cross hair, but not the hit indicator. Not sure if
that's something we capture, or can recreate from the data."

**Not captured.** The table above used to say the server raises the marks
with SpecialGameEvent 1 and that this client was never sent one. That is the
listen-server path. On a dedicated server the shooter's mark rides one bool
of his control object's state (XHIT-6: `writeControlObjectState` sends it,
the client sets its player's `+0x1cc` to 1.0), and the recorder does not read
that bool. So every client was sent its marks, and none of the recordings
kept them.

**Worked out instead** (`replay-hitmarks.js`), from what every recording has:
each round (`f`, its origin and axis) and each object's hit points (`a`).

- A hit is a victim's hit points dropping just after one of the shooter's
  rounds reached him. The round flies at its weapon's muzzle velocity, the
  `weapons[].velocity` of the models tree's `damage.json`. That is the speed
  the page's own drawn round flies at: a Bar1918 1000 m/s, an aircraft's guns
  400, the Bofors and tank guns 300, a bazooka 85. The victim's place is
  taken when the round gets to him, a sample either side. The round must
  pass within 1 m of a soldier's body (his origin -0.9 to +0.7 m) or 4 m of
  a hull's origin. The drop must come between 0.05 s before the arrival and
  0.6 s after it (1.5 s for a weapon with no listed speed).
- **The mark goes up when the round arrives, not when it is fired**
  (reported 2026-10-04: "the hit indicator will appear instantly as the
  round fires, not accounting for the travel time"). Before, the mark was
  the fire time plus the distance at a stock 700 m/s, and the matcher took
  the round that passed closest. In a burst that is any of them, often the
  first, so the mark came up to 0.8 s before the round that hit.
- Of the shooter's rounds, the drop goes to the one whose arrival best
  explains when it came. Over 92 kills made with a single rifle or pistol
  round in five recordings, a remote shooter's victim's hit points drop
  -0.05 to 0.23 s after the round's arrival, median 0.06. The recording
  player's own come about 0.24 s after: his round goes to the server and
  the hit points come back (one kill measured, 0.24; the Bofors' drops on a
  BF109 in the Bocage round, 0.5 to 0.64).
- When rounds from two players reach him, the drop goes to the closest.
  The drop that kills him goes to the killer the kill log names, if one of
  the killer's rounds of that weapon passed within 3 m. A gun kill the hit
  points never show (the victim was out of the client's reach) marks at the
  killer's last round of that weapon, as long before the kill as a drop
  follows a hit.
- **What never marks.** What is thrown or laid: explosions never mark in
  the game (XHIT-4). A flak shell that reaches a moving hull (2.5 m/s or
  more): its proximity fuse bursts it beside the hull first (PROX-3), so the
  drop is the burst's. The fuse distance is the level's projectile table's
  `explodeNearEnemyDistance` (the page's guns hold it). Soldiers never set a
  fuse off (PROX-2), so a Bofors round that hits a soldier marks. An empty
  hull never marks (XHIT-5).
- One drop is one mark. The hit points come ten times a second, so a burst
  that lands inside one sample is one mark. That shows nothing different on
  screen: each mark only restarts the fade.
- The HUD feeds `CrossHair/HitIndicationTime` = 1 - (t - the last mark),
  floored at 0 (XHIT-3), and puts the layout's crosshair group up in his
  first person, on foot or in a seat. The group carries the four diagonals
  only. The page's DOM cross is still the cross. The marks go with the cross
  when the view is dragged off his aim. A `hud-layout.json` without the
  marks' binding keeps the group down, as `soldier-hud.js` does.
- Worked out once for every player the first time a first person asks (62
  ms for the 26-minute `replay_20261001-144253`). They are worked out again
  when the speed table lands and when the level's projectile table does.

It cannot see a hit on a teammate with friendly fire off (the game marks it,
but no hit points move), a hit on a soldier the recording has no hit points
for, unless it killed him, or a bot's fake rounds (no `f` at all).

**Checked against the server's own numbers:**

- Gun kills (the kill log names the killer and the weapon) with the killer's
  mark between 0.8 s before and 0.3 s after the kill: 99% of 227 in
  `replay_20261001-144253`, 96% of 67 in `replay_20260928-133433`, 97% of 61
  in `replay_20260928-214112`, 100% of 35 in `replay_20260927-203459`, 92% of
  257 in `replay_20260928-161948`. The marks sit 0.08 to 0.20 s before the
  kill at the 10th percentile, the median about at it. With the stock speed
  and the closest round they sat 0.33 to 0.44 s before it at the 10th
  percentile, and before the kill log credited the killing drop only 79-86%
  had a mark.
- The round-end tallies (`roundStats` `hit`, per player and weapon) in
  `replay_20261001-144253`: the marks number about what they say (pid 0, 103
  marks against 108 hand-weapon hits; pid 9, 272 against 296). The shortfall
  is mostly bursts inside one sample.
- Headless, Bocage round, skandia (pid 3): the Bar1918 burst that kills at
  156.82 s marks at 156.524, 156.654 and 156.794 s. Each mark is 0.037 s
  after the round that hit (156.487, 156.617, 156.757): 37 m at 1000 m/s.
  Its first eight rounds mark nothing. In the page the timer reads 0 at
  156.4 s and 0.994 at 156.8 s. His Bofors at the BF109 from 39 s marks
  nothing: every drop there is a burst beside a moving plane. The first
  version marked it at 40.9 s.

## The nose cam (2026-10-04)

Asked: "when you're in a vehicle we can go POV, which is the default camera,
but most players will switch to the second camera which is the full screen
view with just the cross hair (and ammo / health). Could we add that as a
camera when we're cycling through with C".

That view is retail's nose cam: the seat's eye pushed `OutsideHudOffset`
along the Camera's own axes, past the propeller, with no cockpit drawn. The
data gives it to every aircraft Camera and nothing else
([vehicle-camera-toggle-sweep](../vehicle-camera-toggle-sweep/README.md),
`seat-view.js` `NOSE_CAM_OFFSETS`). A tank or a gun has none in retail
either, so it has none here.

- In first person in an aircraft, C goes from the cockpit to the nose cam,
  then on to the free camera. 2 pressed again toggles the two, as the game's
  first-person key does on a second press. The help sheet says so.
- The eye is `noseCamOffset` from the seat's Camera node, in the node's
  frame. The hull is drawn from outside, not through its cockpit graft. The
  HUD is the seat's: the reticle, the vehicle's health, its ammunition.
- The recording's `gameRules` carries the server's `serverAllowNoseCam`
  (`noseCam`, now `rec.noseCam`). A server that switched it off gets no nose
  cam.
- The choice holds while the first person does. If he climbs out and into
  another aircraft, it comes back. Leaving the first person resets it to the
  cockpit.
- Headless, Midway round, skandia's Zero at 713 s: the cockpit, then after C
  the eye 5.26 m on (ZeroCamera's 0/-0.8/5.2, 2.3 m ahead of the propeller
  hub), no cockpit, the reticle and the Zero's HUD. C again goes to the free
  camera. 2, then 2 again, goes back to the nose cam.

Tests: `tests/test_replay_hitmarks.py` (`replay_hitmarks_harness.mjs`): a
round through a soldier whose hit points drop, a miss with no drop, a drop
with no round, a grenade's blast, the killing drop credited to the killer over
a closer round, an empty and then a manned Sherman, a kill with no hit points,
the timer, the HUD's variables (an old layout, the view dragged off), and the
nose cam (its offset, no cockpit, back and forth, reset by the free camera, a
tank's Camera and a closed server).

## The cross's size (2026-10-06)

Players said the replay's cross looked a bit bigger than the game's. It was.
The page drew the gap as the deviation above the weapon's `setMinDev`,
projected through the camera: about 9.6 HUD units a degree through the
replay's 57.3-degree lens, and about 20.5 zoomed to an SMG's or a BAR's
28.6 degrees.

Retail draws it with no camera in it (ledger XHIT-14, XHIT-15):
`CrossHair/Radius` and `CrossHair/Deviation` are the weapon's whole deviation
in degrees, floor included, times 5 (`Game.setCrossHairRadius 5`,
`Game.setCrossHairSize 5`). Each arm starts Radius units off centre and is
10 + Deviation - Radius units long, so 10. Zoom changes the lens, not the
cross.

| | before (hip / zoomed), units | retail and now, units |
|---|---|---|
| Thompson standing still (0.4 degrees) | 0 / 0 | 2 |
| Thompson running (1.36) | 9.2 / 19.7 | 6.8 |
| Thompson at its fire cap (2.4) | 19.2 / 41.0 | 12 |
| BAR running (3.0) | 21.6 / 46.2 | 15 |

On a 1280x720 stage a unit is 1.6 px across and 1.2 px down.

`replay-hud.js` `spreadAt` returns the whole cone now, and `crosshairAim`
hands it over in degrees. `vehicle-hud.js` `updateCrosshair` sets
`--ch-gap` and `--ch-len` from the two factors. The page's own soldier uses
the same law. `tests/test_replay_hud.py` checks the spread values and the
geometry: 2 units still, 6.8 running, the same zoomed, and the DP's
3.75 units at its floor on a 2560x1440 stage, the gap XHIT-11 measured on
the owner's capture.

### A seat gun's cross

A seat MG opens the cross by its own deviation, as retail does. The vehicle
HUD feed (client `0x006d7050`) writes `CrossHair/Radius` and `Deviation` from
the seat FireArms' total, the same law as on foot (XHIT-15). A vehicle gun is
a plain `FireArms`: no stance multiplier and no speed, turn or misc channel,
so its total is `setMinDev` plus the fire bloom, raised `setFireDev` b a pull
up to a and decayed c a 1/30 s tick.

The feed walks the seat's weapons for the two ammo panels and writes the cross
from each of the first two in the same loop, skipping one with the template
name of the weapon before it. The second write stands. So a tank driver's
cross is his coax's, not his main gun's, and a pintle or stationary MG's seat
shows that gun's own.

| seat gun (vanilla) | `setMinDev`, `setFireDev` | at rest, units | at the bloom's cap |
|---|---|---|---|
| `Coaxial_browning`, `Coaxial_MG42` (a tank driver's cross) | 0.75; 1.9 0.26 0.05 | 3.75 | 13.25 |
| `MG42`, `MG42_unlimited` | 0.7; 0.9 0.25 0.05 | 3.5 | 8 |
| `Browning`, `Browning_unlimited`, `Elco80_SideGunner`, `Type38_Oerlikon` | 0.5; 0.7 0.3 0.048 | 2.5 | 6 |
| `MG42_Air`, `Browning_Air` | 0.2; a cap of 0.2 | 1 | 2 |
| the naval guns (`fletcher_GunBarrel`, `YamatoFatCannon` ...), where the seat draws a cross | 1 or 2, no bloom | 5 or 10 | the same |

XPack2 adds `FlakPanzer_MG42` (the coax's numbers), `HDBrowning` (the
Browning's), `SturmTigerGunBarrel` (2) and `WasserFallGuns` (15; 10 0 0).
A tank's main gun ships no words, so a seat whose only weapon it is stays
closed.

The exporter carries the words as `fireArms.deviation = {min, fire}` on a
plain FireArms (`bf42/assemble.py` `_fire_arms`). `fire-state.js` `FireState`
runs the cone (`spread`, a `DeviationModel` over that block, `onShot` once a
pull, ticked by `step`), and `crossGunOf` picks the gun the feed leaves on the
cross. The page's seat reads it in `vehicle-hud.js` `crosshairAim`. The replay
runs the same `FireState` over the gun's recorded rounds (`gunStateAt`), so a
server recording and a bf42plus client recording open it alike: a coax at
0.75 degrees, 2.65 after a long burst, back to 0.75 1.3 s later.
`tests/test_replay_hud.py` checks all three. The glbs carry the block only
after the re-extract and re-bake below; until then the cross stays closed in a
seat.

**What the export change reaches** (scanned 2026-10-06: a plain FireArms node
named for a template with deviation words, in each glb's JSON chunk). A spot
extract of the Sherman and the MG42 changed only `fireArms.deviation` on those
nodes; the document extras, the reports and `scene.json` do not move.

| tree | templates with words | model glbs | levels (`scene.glb`) |
|---|---|---|---|
| vanilla | 16 | 71 of 650 | 23 of 23 |
| XPack1 | 16 (vanilla's) | 9 of 75 | 29 of 29 (own and inherited) |
| XPack2 | 20 | 31 of 134 | 32 of 32 |

Old viewer code ignores the new key and new code reads no key as a closed
cross, so the trees and the page can go live in either order. From
`tools/bf1942-models`, with this change checked out:

```bash
S=~/.cache/seat-gun-deviation   # on disk, not /tmp (quota; hard links)
python3 extract_all.py --level-all --configuration-all --cockpit -j 6 --out $S/models
python3 extract_all.py --mod XPack1 --own --level-all --configuration-all --cockpit -j 6 --out $S/models/mods/xpack1
python3 extract_all.py --mod XPack2 --own --level-all --configuration-all --cockpit -j 6 --out $S/models/mods/xpack2
# Install every $S/models/**/*.glb that differs from viewer/models/<same path>,
# with its .glb.gz, writing through the existing inode (cat new > old) for the
# hard-link mirrors. Not models.json, damage.json or the thumbs.
python3 optimise_mesh.py <the installed glbs>        # no-op if the .gz match
python3 extract_maps_all.py --out viewer/maps -j 8
python3 extract_maps_all.py --mod XPack1 --out viewer/maps/mods/xpack1 -j 8
python3 extract_maps_all.py --mod XPack2 --out viewer/maps/mods/xpack2 -j 8
cd ../.. && scripts/publish-mesh-delta.py models maps --hash --dry-run --list
```

The level bakes optimise as they promote, and each promote replaces the
level's directory: check nobody else is extracting into `viewer/maps` first,
and list the delta against the volume (to send and volume-only) before the
real send. The expected send is the 111 model glbs and 84 `scene.glb`, each
with its `.gz`. Publish them from a staging root of exactly those files
(`--root <stage> --hash --hash-remote`) if the hash record is stale.

## The cockpit interior is grey (2026-10-11, the hue)

The owner, on the Secret Weapons + Road to Rome round (Raid on Agheila, a
Flettner flown from 43 s): "The hud looks very green, but in the real game
it's more of a grey HUD."

The 2D HUD was never the green. Secret Weapons and Road to Rome ship no HUD
bar, panel or layout of their own (ledger HUD-14: their `Menu.rfa` holds
icons, flags and two jetpack/shotgun bars), so both draw vanilla's, and a
retail capture of the Flettner shows the vehicle bar's and soldier bar's
segments in exactly the pack's colour bins. The viewer's HUD canvas holds the
same bins and is byte-identical before and after this fix on all three frames
compared (on foot at 8.8 s, the Flettner at 63.8 s and 103.8 s).

What was green is the first-person interior the camera looks through. The
`Flettner.cockpit.glb` interior is `Flettner_interior.dds`, a dark grey
(mean rgb(50,54,56)). `ReplayCamera.setFirstPersonHull` grafted it through
`drive.loadCockpit()` with no `prepare` callback, so it stayed the model
browser's lit `MeshStandardMaterial` and the level's hemisphere and sun, a
warm haze on Raid on Agheila, turned it olive: the canopy bevels and dash
measured `rgb(19,18,10)`, hue 57 degrees, saturation 0.46, against the retail
capture's `rgb(29,30,30)`, saturation 0.04. The page's own flown vehicles
have always handed `level.unlitCockpit` to `loadCockpit` (map.html
`buildHullDrive`, level-shading.js `unlitCockpit`); the replay now does too,
through `ctx.unlitCockpit` (map.html's replay context), and warms the unlit
materials before the swap shows them. Every hull a replay is flown in goes
through the same call, so every mod's and every aircraft's, tank's and
boat's interior is fixed with it.

That fix left the interior at the texture's own brightness, about 1.5 to 2
times the retail game's. The section below closes it.

`tests/test_replay_cockpit.py` (harness `replay_cockpit_harness.mjs`) asserts
the replay hands `loadCockpit` a `prepare` that shades, then warms, and that a
context without the hook still loads the interior.

## The cockpit interior is lit (2026-10-11, the brightness)

The owner asked why the interior's brightness was handed back rather than
fixed. It is shaded now, for the page and the replay through one call, at a
brightness two retail captures set. The mechanism behind that brightness is
not found; the section says what is established and what is a calibration.

**What it was.** The page drew every first-person interior at its texture
(`unlitCockpit`, `MeshBasicMaterial`), on the theory that BF1942's light is
baked into what it draws. It is not: the interior is a lit StandardMesh
(`Flettner_Cockpit_M1.rs`: `lighting true; lightingSpecular true; envmap
true`, a DXT1 texture with no alpha, so the envmap stage adds nothing), drawn
by the plain fixed-function path like every hull (ledger DL-1, DL-2, DL-6,
DL-7).

**What was wrong in the first version of this section** (kept so it is not
repeated). It put `renderer.animatedMeshAmbientColor` and
`animatedMeshDiffuseFactor` under the interior, on a Zero-on-Iwo-Jima capture
that is Forgotten Hope's N1K1 on FH's own level (the pinned photograph, the
pilot's hand on the stick; the IL-2 and KV-1 captures in the folder are FH
too), and on a "1.37x tighter" camera that was that different cockpit. Those
two terms are read by the skinned-mesh draw only (DL-6); a cockpit is not
skinned.

**What the captures say.** Over the same texels drawn unlit:

| capture | level (declared) | shaded floor, per channel | tint (G/R, B/R) | against `2 * (ambient + global)` |
|---|---|---|---|---|
| Wake, a Corsair's dash | ambient 0.1, global 0.14/0.12/0.13, animated 0.25 | 0.442 / 0.408 / 0.431 | 0.92, 0.975 (sum predicts 0.917, 0.958; the animated grey 1.0, 1.0) | 0.93 |
| Agheila, the SW Flettner | ambient 0.15/0.14/0.14, global 0.10/0.10/0.12, animated 0.2 | 0.360 / 0.344 / 0.371 | 0.96, 1.03 (sum 0.96, 1.04) | 0.71 |

So the colour is `ambientColor + globalAmbientColor`'s and the magnitude is a
level's own: 0.87 times `animatedMeshAmbientColor` over the mean of that sum
fits both (0.70 and 0.95). `shadeCockpit` (level-shading.js) hands the
interior to `bindDynamicShading` with the level's ambient + global and
diffuse scaled by that `k` (clamped to 1; no animated term in a scene.json
written before it existed, k is 1). The 0.87 and the form are a fit, labelled
so in the ledger (DL-5), with the candidates that were ruled out.
`buildHullDrive` (map.html) and `ReplayCamera.setFirstPersonHull` both call it
through `ctx.shadeCockpit`: one path for every hull, mod and seat that loads a
`.cockpit.glb`. A hull outside keeps the plain terms (a test pins both).

**The numbers** (Raid on Agheila, the replay's second Flettner at its spawn,
level; hull yawed about its own centre so the sun reaches the panels as it
did in the capture; median luminance of the same screen patches, 1280x720, the
retail frame resized to match):

| patch | retail | before (unlit) | after (best yaw, 135) | plain terms |
|---|---|---|---|---|
| top plate | 30.1 | 86.6 | 30.1 | 43.1 |
| left panel | 47.6 | 62.4 | 45.3 | 64.9 |
| right panel | 23.7 | 67.8 | 23.0 | 33.4 |
| left bevel | 48.1 | 71.5 | 49.9 | 69.6 |

Mean absolute error over the four patches: unlit 113 %, plain terms 41 %, this
rule 3 %. On Wake (the live page, the same dash patches): retail 21.2 / 23.1
/ 17.6, unlit 48.6 / 51.2 / 38.4, this rule 20.2 / 22.0 / 17.2.

**The Ilyushin's missing instrument panel** (a second defect in the same
cockpits, found while measuring). `ILyushin_Cockpit_M1.rs` is
`transparent true;` for the whole interior with no `depthWrite` line. The
client writes depth unless the `.rs` says `depthWrite false` (ledger DL-8);
glTF has no such bit and three's loader clears it for every blended material,
so the interior drew in index order and the cowl behind the panel painted
over it. `scene.json` now lists the 96 materials that do declare
`depthWrite false` (`depthWriteOff`, layer `materials`), and `shadeCockpit`
gives every other blended interior material its depth back. 26 vanilla, 28
XPack1 and 32 XPack2 cockpit glbs carry a blended material; most only a
gunsight or a pane.

**The camera.** Every vehicle view is the render view's own 1 rad, 57.30
degrees vertical, as the soldier's is (ledger VIEW-8, VIEW-13); the page used
60 for seats, aircraft and cars. `local-player.js` `FLY_FOV` and
`replay-camera.js` `SEAT_LENS` are 57.3 now.

**Assets.** A scene.json written before this change has no
`lighting.animatedMeshAmbient` (k is 1: the plain terms) and no
`depthWriteOff` (blended interiors stay as loaded). `patch_scene.py --layer
environment materials --mod bf1942|XPack1|XPack2 --all` writes both; that is
the only asset change, no glb moved.

`tests/test_cockpit_light.py` (harness `cockpit_light_harness.mjs`) pins the
rule from the program the pass builds: Agheila's floor 0.174 / 0.167 / 0.181,
Wake's, the clamp, the tint, the hull outside untouched, the fallback, the
depth-write restore and the textureFade plane left alone, and that a
`lighting false` or additive material is not shaded.

## Open

- A seat gun's cross needs the vehicle models and every level re-extracted
  and re-baked (vanilla, XPack1, XPack2) before it opens: the exporter change
  is in, the trees are not ("A seat gun's cross").
- A seat gun's rounds do not wander inside its cone yet: `gun-groups.js`
  passes no `spreadDeg` for a vehicle group, and `FireArms::fireBarrel`
  applies the cone to any gun whose total is over 0.01. The cone is now on
  `FireState.spread` for it to read.
- A tank driver's cross reading the coax rests on the client's feed loop, not
  on footage. A capture of a Sherman driver standing still would show 3.75
  units of gap.
- **Recording the marks exactly.** The recorder could read its own player's
  `HitIndicationTime` (BFPlayer `+0x1cc`, XHIT-2) each sample. The timer runs
  down at one per second from 1.0, so a sample of `v` at `t` puts the last
  hit at `t - (1 - v)`, to the frame. That is exact for the recording player,
  and the inference would stand in for everyone else. It is a bf42plus change
  (`src/replay.cpp` `samplePlayers`). That checkout had another session's
  uncommitted edits on 2026-10-04, so it was left alone.
- A seat camera is the model's Camera node on the recorded hull and turret.
  It is not laid on the rounds' axes, even for a gun that fires along the
  camera (a coax or a pintle MG).
- The arms play the baked families only. The backward, strafe and turn
  states have first-person clips of their own at their own rates
  (extract_viewmodel.py names the gap), which take the nearest baked one
  here, and `Ub_Stand<W>`'s own clip takes the aim's.
- A mod weapon with no extracted rig draws its bare model at the page's
  stand-in offset, unanimated, as the page's own soldier does.
- The cockpit brightness is a calibration, not a read of the binary (DL-5):
  what scales a cockpit's light by the level's animated ambient is not found.
  A capture of one aircraft parked level on Berlin or Kharkov (animated
  ambient 0.15 / 0.3 against a sum of 0.22) would test the 0.87 form; the lab
  cannot be driven headlessly on this PC.
- A soldier's and an arm's light is DL-2's terms on the page; the engine's
  skinned path uses `animatedMeshAmbientColor` plus the scene ambient and a
  scaled sun with no global ambient (DL-6). Not calibrated: a retail capture
  of an arm needs its sun aspect, which no folder capture records.
