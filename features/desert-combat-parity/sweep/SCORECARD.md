# Desert Combat parity scorecard (census 2026-10-06)

Scored from DC's data, the viewer code and node harnesses (no browser play).
Works 1.0, Partial 0.5, Broken 0.2, Missing 0; weights High 3, Med 2, Low 1.

| Domain | Score | Weighted | Report |
|---|---|---|---|
| Aircraft | 62% | 34.8 / 56 | reports/air.md |
| Ground and sea vehicles | 78% | 45.2 / 58 | reports/ground.md |
| Weapons, projectiles, kits, damage | 79% | 47.2 / 60 | reports/weapons.md |
| Levels, modes, world, bots | 79% | 52.0 / 66 | reports/levels.md |
| Soldiers, HUD, menus, sound | 85% | 87.4 / 103 | reports/soldier.md |
| **Overall** | **78%** | 266.6 / 343 | |

## Work packages and owners

Wave 1 (one agent each, own worktree):

| Id | Package | Closes | Hot files it owns |
|---|---|---|---|
| air-flight | RollGrip friction bug, no gyro term on vectored airframes, Harrier bots, AC-130 drag box | air 3, 5, 10, 26 | aircraft.js, bot-vehicle-air.js, ship-spec.js (min) |
| air-input | Mouse flies the aircraft, keyboard axes without the invented spring, airKeyboardSensitivity | air 8, 9 | local-player.js, controls.js, world-input.js, mouse-*.js, world-vehicle-tick.js (air input) |
| ground-chassis | Wheeled vehicles read their own chassis; land vehicles sink and take water/depth damage; DPV spin; forklift pitch | ground G1, G2, G5, G7-forklift | wheeled-vehicle.js, ground-specs.js, amphibious.js, world-damage.js, map.html buildHullDrive, sim/stage.mjs |
| rounds | Rockets fall (IMP-7) and fly their own motor; bullet-kind gravity; CBU-87 | weapons 21, 22, 24, 19 | projectile-flight.js, round-launch.js |
| hand-weapons | Shotgun barrels, Stinger/SA-7 sight, hand-MG heat | weapons 3, 7, 18 | hand-weapon.js, hand-fire.js, soldier-hud.js |
| kit-pickups | Spawner-placed kits (M82, US_AA, Bragg kits), their viewmodels, restore lost mortar/pad record | weapons 13, soldier S12 | extract_loadouts.py, extract_kits.py, bf42/kit.py |
| spawner-pads | Pads spawn the controller's vehicle, abandon clock, start delay, dead carriers drop spawns | levels 22, 24, 25 | level-statics.js, hull-bodies.js, vehicle-wrecks.js, spawning.js, spawn-flags.js |
| bots | Bots frozen in Change, DC route failures, nav decode, door-less artillery seats, vehicle AI records | levels 28, 29; ground G6; air 25 | bot-*.js, nav-*.js, extract_vehicle_ai.py |

Wave 2 (after wave 1 lands): CTF in the page; round-end screen; sound
(reload slot, release tails, vehicle gun release slots, projectile flight
sounds, part sounds); artillery spotting; static Nimitz + small data words +
depot vehicle types; terrain tile grid (Medina Ridge); blast knockback and
soldier template numbers; player-flown missiles (SA-3, Tomahawk); DC scripted
objectives; polish (kill-feed case, six kit slots in rooms, random heads).

Owner decision: fixed-wing throttle as retail's held axis with spring-back and
reverse thrust (changes vanilla too).
