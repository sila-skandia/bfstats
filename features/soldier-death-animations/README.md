# Soldier death animations

A killed soldier now plays the game's own death: he falls the way the round
pushed him, a head shot drops him to his knees, a crouched or prone man dies in
his posture, and a gunner killed in his seat slumps over the gun. The corpse
stays down for the template's `timeToLiveAfterDeath` (10 s), whether or not he
has respawned by then.

The engine reading is ledger **DIE-1..DIE-9**
(`features/bf1942-engine-reference/ledger.md`, "Soldier deaths").

## How the engine picks one

`BFSoldier::handleDamage` (lnxded `0x08270980`), on the killing blow:

| test, in order | plays |
|---|---|
| he has a parent (a seat) | `Ub_DieInVehicle` on the torso only; the legs keep the seat's clip |
| the canopy is open | `Lb/Ub_ParachuteDie` |
| swimming | `Lb/Ub_DieSwim` |
| in free fall | `Lb/Ub_DieHitGround` |
| crouched | `Die{Chest,Back}Crouch` |
| prone | `DieLie` |
| standing, head bone hit | `DieHead` |
| standing, `rand() & 3 == 0` | `DieSlow` |
| standing | `Die{Chest,Back}Stand` |

Back means the round travelled the way he faces: shot in the back, he pitches
forward. The collision is the latest one on his body, not necessarily the
killing blow's.

## What was built

| piece | file |
|---|---|
| bakes the 20 death states into `poses/gaits/die.gait.glb` (`--die`; also run by `--shared-assets`) and writes `soldierBody` -- the eight hit capsules and the corpse time -- into `gaits.json` | `tools/bf1942-models/extract_pose.py`, `bf42/con.py` |
| the death choice above, pure and node-testable | `viewer/soldier-death.js` |
| the engine's hit capsules (DIE-10), and reading them off any drawn rig | `viewer/skeleton-hit.js`, `viewer/rig-capsules.js` |
| one seated-body implementation: seat pose glb, half body, arm IK to the wheel or gun, the slump | `viewer/seat-body.js` (used by `seat-pose.js`, `bot-visuals.js`, `netcode-render.js`) |
| the death families, and the corpse under the death cam | `viewer/soldier-body.js`, `viewer/foot-body.js`, `viewer/local-player.js` |
| the human killed in his seat: the seat's body slumps and stays, the seat empties, the death cam frames him | `viewer/vehicle-wrecks.js` `killOccupantInSeat`, `seat-pose.js` `detachSeatCorpse` |
| bot corpses and bots drawn in their seats | `viewer/bot-visuals.js` |
| remote players: corpses on foot, drawn and slumping in their seats | `viewer/netcode-render.js` |
| each body's latest round, `Armor.lastHit` | `viewer/armor.js`, fed by `bot-referee.js`, `vehicle-hits.js` (and `hand-fire.js` where no round flies) |

**How a round meets a soldier now.** Every path -- the bots' rounds
(`referee.resolveShot`), every flying projectile including the human's hand
weapon (`vehicle-hits.js` `roundBodyCast`) -- tests the drawn body's eight
capsules, first declared capsule wins, and prices the round against that
capsule's material. A BAR round is 22.5 to the head, 14.4 to the chest, 9 to a
calf. A soldier nobody draws (the headless runner) keeps the old stand-in
sphere. A seated man is a target where his seat draws a full body (a jeep's
passengers, a bare MG's gunner) and the round is his, not his hull's; a tank
driver is not drawn and cannot be shot.

**Two older bugs found and fixed on the way.** The human's rifle billed every
trigger pull twice against a bot on foot -- once by a hitscan written before
rounds could meet soldiers in flight, once by the round itself -- and the
hitscan priced every hit with no weapon at all, so any hit killed. The hitscan
now runs only on a page with no in-flight body test, and is priced by the held
weapon. And the flying round's firer lookup returned nobody for the hand
weapon, so it applied no self- or team-exclusion; an unowned group is now the
human's, the same convention the billing already used.

Published to `mesh.bfstats.io/models/poses/gaits/` on 2026-09-24 (`die.gait.glb`
and `gaits.json`). The viewer code goes out with the next Mesh Pipeline build.

## Frames

Captured headless on El Alamein, 30 Hz ticks:

- `chest.jpg`: shot from the front, falls backwards, ends face up
- `back.jpg`: shot from behind, falls forwards, ends face down
- `head.jpg`: head shot, drops to his knees (the end is face down)
- `crouch.jpg`: crouched, shot from behind
- `seatdie.jpg`: M3A1 ring-mount gunner, alive, then slumping over the Browning
- `seated-ik-and-slump.jpg`: top row, a bot gunner with his hands on the
  Browning's grips (arm IK), shot, slumping; bottom row, the first framing of
  the human's own seat death (since reframed)
- `local-seat-death.jpg`: the human killed on the Browning, slumping, from the
  seat death cam
- `local.jpg`: the human's own body under the on-foot death cam

## Stand-ins and open items

- **A remote's round is not on the wire**, so a remote on foot dies by pose
  only: chest, or the 1-in-4 slow death. Remote seat deaths were exercised
  against the real renderer with a scripted room client, not in a live room.
- **The replica hull a remote rides** is the browse model and sits lower than a
  level-placed hull; the seated body follows its seat node wherever it is.
  Older than this work.
- **`Lb_DieByVehicle`** is never entered by the server (DIE-6, 802 functions
  swept). The client binary was not swept.
- **The upper-state weapon gate** in `handleDamage` (DIE-8) is not modelled.
- **The human's hitscan** is kept as a fallback for a page with no
  `guns.bodyCast`; the map page always installs it.
