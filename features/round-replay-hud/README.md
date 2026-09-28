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

## What each part of the HUD comes from

| part | source | |
|---|---|---|
| the cross's type | his weapon's `setCrossHairType` (glb `weapon.crossHair`), or in a seat the seat's (`hud.crossHairType`) | exact. A K98 sniper's is `CHTNone`, a grenade's the `hk` icon, and the Bofors draws none: its ring sight is on the gun |
| the centre dot | the server's `serverCrossHairCenterPoint`, `gameRules`' last byte | exact |
| the cross's spread | his weapon's deviation (`deviation.js`) run tick by tick over his recorded stance, his legs' state (walk, run and strafe mean the key was down; a jump) and his rounds, from as far back as the weapon takes to settle (`settleTime`: a BAR's bloom 3.9 s, a Thompson's 1.3) | computed |
| his zoom | the body record's state bit `0x20` (`ZOOM_BIT`), which the server sends for every soldier, not only the recording client's own | recorded. The view takes the weapon's `zoomFov` (a BAR's 28.6 degrees, a sniper rifle's 5.7), eased 0.3 a frame as the page eases its own; a scoped rifle draws the layout's scope and no cross, as in play |
| his health bar, stance icon, kit art | `a` records (hit points), `st` (stance), his kit | exact. A soldier with no recorded hit points (18 of 214 in the Bocage round) shows his spawn's full bar |
| a vehicle's icon, health, seat dots, turret dial | the seat's `hud` block, the hull's `a` records, the recorded crew, `IconLookRotation` from the camera against the hull | exact |
| ammunition on foot | counted from a full kit at his spawn: one round per `f`, a magazine change `reloadTime` after his torso's reload state or a dry magazine (the old magazine's rounds are lost, as in `hand-fire.js`), refills (`special` 0) | exact for a recording player. For anyone else it is an estimate: a client can miss a remote player's single taps, and nobody else's refills reach it |
| a seat gun's ammunition, heat, readiness | the page's `FireState` run over the gun's recorded rounds since the hull's spawn | the same estimate for anyone but a recording player |
| the hit marks | not recorded | the server raises them with SpecialGameEvent 1 (XHIT-4), and none of the six recordings has one, so this client was never sent them |

## Files

- `viewer/replay-hud.js`: the state (`heldWeapon`, `weaponEvents`, `handAmmoAt`,
  `settleTime`, `spreadAt`, `gunStateAt`), the feed into `gameHud.vars`, and
  `crosshairAim`.
- `viewer/replay-camera.js`: `eyeAim`, `viewOf`, `shotFix`, `roundAxes`, and
  `sight` (what the first person looks out of).
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
  (640, 360), spread 2.25 degrees running (34.5 x 25.9 px), his recorded
  10/30 on the assault kit's bar, the BAR at 0 rounds and 4 spares mid-change.
  Prone at 217.6 s: the cross closed. The grenade at 73 s: the `hk` icon, 2
  left. The KettenKrad's MG seat at 248 s: the KettenKrad's icon at 23/50,
  462 rounds, the cross. The Bofors at 101 s: no HUD cross. The orbit: nothing.

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
narrower lens.

## Open

- The hit marks: see the table.
- A seat camera is the model's Camera node on the recorded hull and turret.
  It is not laid on the rounds' axes, even for a gun that fires along the
  camera (a coax or a pintle MG).
