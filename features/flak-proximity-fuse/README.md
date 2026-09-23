# Flak bursts on the aircraft it meets (2026-09-24)

## The report

The owner manned an AA gun (AA_Allies) against a bot-flown plane. The
rounds went straight through the aircraft, and every one burst at the same
distance in the sky. In the game the round bursts on the aircraft it meets.

## What the engine does

Ledger PROX-1..PROX-9 and AI-78. The write-up is
`features/bf1942-engine-reference/subsystems/projectiles-and-impacts.md`
section 5.

- **The proximity fuse.** `Projectile::handleUpdate` (0x0831e940) is almost
  all fuse. Once the round is older than its `ProximityFusePrimer`, it
  detonates on the first object within `explodeNearEnemyDistance` that
  passes these tests. In air: heavier than the round, at most 100,000,
  moving at 2.5 m/s or more. Under water: 50,000 or more, height only.
  Soldiers never set it off, and no team is tested. The detonation is the
  end-of-life burst: `e_FlakBig` and the material-199 splash out to 20 m.
  The AA gun and the carrier's shells author 10 m with a 0.1 s primer. The
  Flak 38's authors 10 m with no primer.
- **Contact.** A flak shell that touches a hull dies silently (HP-9e). The
  hull takes the direct hit of material 228 and no burst.
- **The lifetime.** `timeToLive` is drawn per round from its CRD, and on
  expiry a `hasOnTimeEffect` round detonates. The AA gun's
  `CRD_UNIFORM/0.8/1.4/0` puts the burst anywhere from 240 to 420 m out.
  So the fixed range the owner saw was the viewer's doing: the extractor
  kept only the CRD's first number, 0.8 s, which is 240 m every time.
- **An AA gun is anti-aircraft.** `setIsAntiAircraft` belongs to the
  unit's Armament plug-in, not to an AI weapon (AI-78).

## Why the viewer's round did not hit the plane

The brief suspected the round cast: that it tested statics and soldiers
but not bot-driven hulls. It does test them. A driven hull, the human's or
a bot's, leaves the static index through `setMovedOwner`
(`hull-bodies.js publishMovedHull`) and is cast against where it flies
every tick. Live on El Alamein, rays through four bot-flown planes (BF109s
and a Stuka) hit them at their live positions. A round aimed dead through a
bot's BF109 lands on it (material 60, 17.2 HP). What was missing:

1. **The fuse.** `explodeNearEnemyDistance` was never parsed. A shell only
   ended by touching the hull, which a 300 m/s round crossing a moving plane
   rarely does and which kills it with no burst, or at the end of its
   lifetime in empty sky.
2. **The lifetime** was one number, so every shell burst at 240 m.
3. **The reverse direction** had two bot faults. First, bots sensed a
   seated player where he boarded: `playerPosition` read the world
   record's `soldier`, which does not move while he rides. Second, an AA
   gun was never anti-aircraft: the flag was looked for on the AI weapons.
   Together these meant a bot AA gunner never saw the human's plane, and
   could not have scored it if he had.

## What changed

- `bf42/con.py`: parses `explodeNearEnemyDistance`, `ProximityFusePrimer`
  and the whole `timeToLive` CRD.
- `extract_map.py`: `projectile_materials` writes them into `damage.json`'s
  projectile rows, with `mass` for a fused round. The baked
  `fireArms.projectile` block carries neither, and the side table avoids
  re-baking every level. `--damage-only` rewrites a mod's shared
  `damage.json` and nothing else.
- `viewer/proximity-fuse.js`: the law. `projectile-flight.js` asks it once
  per advance, after the contact test. `round-launch.js` attaches the fuse
  and draws `timeToLive` from the CRD. `vehicle-hits.js proximityObjects`
  (`guns.nearObjects`) hands it every hull in the level, from the body world
  when it has a body, whoever drives it.
- `viewer/bot-sense.js playerPosition`: a seated player is at his seat.
- `extract_vehicle_ai.py` and `viewer/bot-units.js` / `bot-perception.js`:
  the seat's Armament `isAntiAircraft` rides the mount into the fire
  scoring.
- `test-hooks-vehicles.js`: `__plane().orient(x, y, z, w)` for a scripted
  pass.

Republished: `maps/_shared/damage.json` and the three mod trees'
`_shared/damage.json` (the MaterialManager tables are unchanged, and only
the projectile rows grew), and vanilla's `maps/_shared/vehicle-ai.json`.

## Verified live

El Alamein, 8 bots, `?shots&noaudio&botDebug`, the worktree's viewer with
the rAF loop stopped. The human sits in AA_Allies_1 (owner 979), elevated
to about 80 degrees. A bot's BF109 (owner 1004) flies a scripted straight
pass across the line of fire, 150 m out and 60 m/s, with the controller
frozen and the drive's state set each frame.

| pass (plane's miss off the line) | before (HEAD) | after |
|---|---|---|
| 4 m | HP 100 -> 100; all 15 bursts at 250 m travelled | HP 100 -> 84.47; one burst fused on 1004 at 160 m; the rest 250..420 m |
| 7 m | not run | HP 84.47 -> 71.75; one fused on 1004 at 160 m |
| 12 m (outside the fuse) | not run | HP unchanged; no fuse |
| 0 m (through the hull) | direct contact on 1004, material 60, 17.22 HP | the same: the 10 m step puts the shell into the hull before a fuse sample |

Reverse. Bot_1 (Axis) takes AA_Allies_1 with `__botMount`. The human flies
Spitfire_1 (owner 975) head-on over the gun, 90 m up, at 55 m/s. Allied
bots are frozen far away so the human is the only enemy. With the fixes,
the gunner's Fire behaviour targets `local`. His own aim law never settles
on a 55 m/s target, because the turret swings about the target
(Brief F), so he never pulls the trigger. With the seat's input driven from
the page (the bot's own `_aimLook` and `isFiring`, a quarter of the error
each tick), 8 rounds from the bot's seat produced 7 bursts fused on 975,
from 280 m in to 190 m, and the Spitfire went from 100 to 0 HP.

Tests: `tests/test_proximity_fuse.py` (the law, plus a round against a real
`CollisionIndex` hull flown by `setMovedOwner` each tick: the cast meets it
where it flies and not where it was baked, a near miss bursts on it, a far
miss, a parked hull or no fuse does not, and the lifetime spans the CRD),
`test_collision.py` (the table rows), `test_extract_vehicle_ai.py`,
`test_bot_ai.py` (an AA gun scores a plane in flight and a plain gun does
not; a seated player's position). The headless runner (El Alamein, seed 3,
300 s) writes an identical trace before and after.

## Open

- **The bot gunner's aim** does not converge on a fast target, so a bot in
  an AA seat targets a plane and does not fire at it. That is Brief F in
  `features/bf1942-ai-research-2026-09-21/AGENT_BRIEFS.md`.
- **`hasOnTimeEffect`** is not modelled. The viewer bursts every
  `damageType` 1/4 round at expiry, where the engine recycles one without
  the word silently (PROX-7).
- The object query's flag `0x2000000`, the vt+0x28 filter and how the
  manager measures its radius are not read. `proximityObjects` takes every
  damageable hull whose origin is within the distance plus its bounding
  radius.
- The fuse also arms the landmine (3 m, a vehicle heavier than 130 kg at
  2.5 m/s) and the depth charge. Neither was tested live.
- Which runs first within an engine tick, the physics contact or
  `handleUpdate`, was not read. The viewer tests contact first.
