# Death cam → spawn screen (2026-09-18)

The on-foot soldier's death flow in the map viewer: when the body's `Armor`
dies, the camera floats a short beat over/by the corpse and the deploy(spawn)
screen opens — matching retail BF1942.

## Engine facts (researched in the client)

- The client opens the spawn screen **synchronously and immediately** on the
  local player's death. In `BF1942.exe` (sha `60c9452d...` MATCH, Ghidra
  bridge), the kill/death message dispatcher `FUN_004933d0` (`0x004933d0`),
  case `0x2a` sub-switch `+0x3`, on `DEATH`:
  - formats the death/kill banner,
  - clears the player's alive byte at `BFPlayer+0xa9`,
  - and, when the dying player **is** the local player (`[edi+0x170]`
    comparison at `0x4946b6`–`0x4946c5`), calls
    **`SpawnScreenStuff::setVisible(true)`** (`FUN_006cce20`, `0x6cce20`)
    directly — the deploy screen opens, no client-side death-cam timer or
    camera-dolly constant precedes it in this vanilla build.
- `game.serverDeathCameraType` (`0x008d2fe8`, registrar `FUN_00425690`
  `0x00425690`, default table `0x008c596c`) is server-informed; its integer
  modes and any per-mode *camera* animation (the floating-above-corpse death
  cam) were not decoded — likely a server-orchestrated/spectator surface
  rather than a client-timed beat before deploy. The brief float the player
  observes in-game is reproduced as a short fade/hold beat before the deploy
  screen, not as a decoded client animation.

Recorded in `features/bf1942-engine-reference/subsystems/hitpoints-and-damage.md`
§7.

## Viewer implementation (`tools/bf1942-models/viewer/map.html`)

State (near the fall-damage constants):

```
let soldierDead     // latches once the body is destroyed, until respawn
let deathCamTimer   // seconds left floating over the corpse before openDeploy
const DEATH_CAM_BEAT = 1.2   // the short float beat
```

In `onFoot(dt)`:

1. **Zero the movement input when dead** so the corpse does not keep walking
   (before `soldier.step`).
2. **After fall damage is applied**, latch on death:
   `if (soldierArmor && !soldierDead && soldierArmor.destroyed) { soldierDead =
   true; deathCamTimer = DEATH_CAM_BEAT; }`. This catches fall-death,
   `window.__damage(n)`, and any future projectile.
3. While `soldierDead`, tick `deathCamTimer -= dt`; when it reaches 0 (and the
   deploy screen is not already up) call `openDeploy()` — the game's
   synchronous `SpawnScreenStuff::setVisible(true)`.
4. **The corpse cam**: where the eye pose normally writes the camera, a dead
   body instead parks it `footEye.y + 3.5` (a couple of metres above the
   corpse) and pitches down (`look.pitch = -0.9`) onto it — the "floats above
   the dead player" view.
5. A dead body cannot fire or scan for entry: `footFire` and `scanForEntry`
   are skipped while `soldierDead`.

`spawnAtFlag()` resets `soldierDead = false` and `deathCamTimer = 0`, the same
place it makes the fresh full-health body — so the next spawn (from the deploy
screen, R, or the browser reset) clears the death cam. `deploySpawn()` →
`spawnAtFlag()` (deployRejoin) reuses this.

## Testing

- Load a track, go on-foot, and kill the soldier with `window.__damage(9999)`
  (or fall to death). The camera should rise above the body for ~1.2 s, then
  the deploy screen opens. Spawning from the deploy screen gives a fresh
  body at full HP with a live camera.
- A death while the map/deploy is already open should not double-open it
  (`!deployActive()` guard).
- The corpse must not keep walking or firing during the death cam, and the
  next `__damage` on the dead body must not re-fire the flow (latch).

## Unresolved

- The exact `serverDeathCameraType` mode values and any true camera-animation
  the client runs when it is server-instructed to show a killer/death cam.
  The current viewer beat is a documented approximation of the float; settle
  it against the client if a specific mode's camera motion is wanted.
## 2026-09-24: the corpse cam frames the body

The owner: "When you die from a player, it should show your dead body in the
death cam. Otherwise it feels like you're dieing randomly."

The on-foot shot above -- `lift 3.5`, `back 0`, pitch -0.9 rad -- parked the
camera straight over the eye and looked 52 degrees down *ahead* of it. At the
soldier's 57.3 degree field of view the bottom edge of that frame is 81
degrees down, so the body, lying directly underneath, was never in it: the
player saw a patch of ground and then the spawn screen, and the spawn screen
covers the whole stage (`spawn-layout.json`: the kit column and the 512 px
map pane), so there was no later look either.

Now (`soldier-view.js` `corpseCam`, `local-player.js` `DEATH_CAM.foot`):

- The side of the shot is chosen on the frame of the death: the far side of
  the body from whoever last hit the player (`comms.lastAttack`'s speaker
  position, the message log's own record of the attack), so the body lies in
  the middle of the frame with the killer beyond it. No attacker (a fall, his
  own grenade): behind the body along the heading it fell on.
- Every frame the camera stands `back 4.2` along that side and `lift 1.8`
  above the drawn body's `Bip01_Pelvis`, looking at the pelvis: 23 degrees
  down, so the frame's top edge sits 5.6 degrees above the horizon and the
  ground out to the shooter is in the picture. Pulled in to whatever stands
  between the body and the camera (`collider.cast`), never below the ground.
- The beat is 3.0 s (was 1.2): the deaths run 0.7 .. 1.6 s, and this is the
  only look the player gets before the spawn screen.

Hull and seat deaths keep their own shots (`DEATH_CAM.vehicle`, `.seat`).
[HOUSE RULES, as before: the client's death cam is not decoded.]

Verified headless on El Alamein: an Axis bot with an MP 40 placed 20 m from
the human killed him (`Hans [Mp 40] Player`); the human's pelvis projected to
NDC (0.00, 0.00) at 0.2 s, 1.0 s and 2.5 s after the death, and the killer to
(0.00, 0.62 .. 0.68), in frame behind the body.
