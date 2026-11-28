# Pak40 shell impacts in the replay

Status: fixed 2026-11-28 (viewer only; no bake, scene layer or asset changed).

## The report

On the community map Strasbourg (`mod=bf1942`), a Pak40 shell in the replay
"has no collision: it goes straight through the ground". The user guessed the
projectile's material id was missing, and that every map with a Pak40
(Liberation of Caen) does the same. Recording:
`wj6jp56xzw` (server recording, 718 s, six Pak40 shots at 236.7, 240.6,
244.1, 498.3, 502.0 and 505.6 s).

## Verdict: in the data, drawn wrong (viewer side)

The file has everything (replay-forensics, section 3):

- each shot's `f` (`w: Pak40Gun`), the flight's `pn` (`Pak40Projectile`),
  its `pj` places every tick and its `pd`;
- an `i` for every one of the six, at the ground (`obj: -1`), e.g. 237.978 s
  at (1120.02, 95.72, 935.07), a tick after the last `pj`.

The material is not missing either. The live model's `Pak40Gun` FireArms
carries `Pak40Projectile` with `material 129`, `kind: shell`, a mesh and a
trail bundle, the same shape as the Sherman's and the Panzer IV's; the shared
`damage.json` has material 129 with an effect row for every ground material
(`e_ExplAni01`, `e_waterimpact` on water). Strasbourg's and Caen's scenes both
point at that same table.

On the live page (headless, `window.replay.flights`), the six Pak40 flights
were drawn, but every one had `impact: null`. With no collision linked,
`ReplayFlights.ends` plays nothing for a round that does not burst at the end
of its life, so the shell reached its last sample a metre or two above the
ground and vanished with no explosion: what the user saw.

## Root cause

`linkFlights` (`viewer/replay-recording.js`) links a flight to the `i` that
ended it only when the `i`'s fire origin `o` was within 2 m of the linked
shot's `f.p`. The two are not the same point:

- `f.p` is the matrix `fireBarrel` is called with, the barrel's;
- `i.o` is `Projectile+0x134`, where the round was made (HFD-4): that matrix
  moved by the FireArms' `ObjectTemplate.projectilePosition`.

`Pak40Gun` (Liberation_of_Caen.rfa's own template, which Strasbourg places)
has `projectilePosition 0/0/3`, so its origin is 3.0 m down the barrel. Every
Pak40 `i` in the file is 2.99-3.01 m from its `f`; the Sherman's and Panzer
IV's are 0.0 m (`projectilePosition` unset), which is why tank shells always
linked and the 2 m rule passed its first checks (El Alamein, Bocage, Wake had
no gun with a long offset and an `i`).

So the map is not broken: it places the vanilla (Caen) Pak40, which behaves as
it does on Caen. Any server recording of Caen with a Pak40 shot has the same
defect. Other guns with a `projectilePosition` past 2 m were affected the same
way whenever their round hit something: `flak38_gun_fire`, the AA barrels
(`AA_Allies_GunBarrel`, `Carrier_AA_GunBarrel`, `Radar_AA_Allies_GunBarrel`,
0/0/3), the Defgun (0/0/9.7), the Prince of Wales' cannons (0/0/16) and the
Yamato's (0/0/-14, -5); the planes' guns at 0/0/2 to 2.5 are bullets, which
the page draws itself.

A client recording (Caen `c8z2nt8m7u`) has no flights: the page fires its own
Pak40 round from `f` there, and that path was never affected (checked below).

## The fix

`linkFlights` now asks whether the fire origin lies on the shot's line
(`originOnShot`): within 2 m of it and at most 20 m along it, either way.
Another gun's origin beside the shot is still refused (the harness's
second-`i` case, 200 m off; a new case 3 m to the side).

## Checked

- `tests/test_replay_flights.py` (21 tests), with a new case: a Pak40 shot
  whose `i` origin is 3 m down its line links to it, and the `i` from 3 m to
  its side does not.
- `wj6jp56xzw` through the viewer's reader: Pak40 flights linked to their
  collision 6 of 6 (0 of 6 before), Flak38 12 of 17 (the other five burst in
  the air, no `i`). `q8uwcxrjcg` (Berlin) and `5txd9vj8ap` (Hellendoorn), both
  server files, link as before.
- The page, headless, on local code and then live: see "On the page" below.
