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
| a seat gun's ammunition, heat, readiness | the page's `FireState` run over the gun's recorded rounds since the hull's spawn | the same estimate for anyone but a recording player |
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

Still short of retail: a seat MG's cross (the coax and pintle guns, the
stationary MG42 and Browning) stays closed. Retail opens it by the gun's
`setMinDev` and `setFireDev`, through the same feed, but the exporter does
not carry deviation on vehicle FireArms. A tank's main gun ships none, so its
closed cross is right.

## Open

- A seat MG's cross stays closed: vehicle FireArms carry no deviation in the
  glbs ("The cross's size").
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
