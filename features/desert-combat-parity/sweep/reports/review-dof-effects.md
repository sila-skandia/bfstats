**Verdict: LAND WITH FIXES.** I added three commits on `worktree-agent-a7806745e960f1d75`: `2d0b3508`, `d76abaa6` and `1bbc428f`. The engine claims hold in the binary and nothing in vanilla regresses. One open visual defect, the half-sunk raft, should be fixed before the `_shared` effects re-bakes go out.

**Proofs re-run:**
- Full Python suite in the worktree: 4,612 tests, OK, 10 skipped.
- `test_camera_dof` and `LevelEffectsTests`, re-run after my edits: OK.
- The agent's in-page check, re-run on port 5638 under the lock, no-key load first:
  - **No `effects` key** (an old tree): the level fetches only `_shared/effects.glb`, makes no level request and has no errors.
  - **With the key:** the four WRECKPCO bundles load, and one kill stands one ruin up.
- The http server is stopped.

**What I checked in the binary:**
- **EMT-10 holds.** `Emitter::handleUpdate` returns unless `+0x41a` is set, and `makeScript` maps `+0x41a` to `ObjectTemplate.IsSpawnEffect`. The spawn call is GameServer vtable `+0x50`, which is `spawnObject(IObjectTemplate*, Pos3, Vec3)`, and that calls `createObjectOnAllClients(..., 1, 0)`. The game data agrees: the DC ruin is 999999 HP with `hasMobilePhysics 0`, and recordings carry `Elco80Raft` and `Type38Raft` as networked objects.
- **ARM-11 holds.** On `Object`'s vtable, `+0x80` is `addChild`, `+0x78` is `setRelativeTransformation` with the identity rotation plus the offset, and `+0x14` is `init`. The order of the death-key branches checks out in objdump.
- **"Every death tier played twice" was real.** The engine plays a tier only when the effect pointer changes. The old viewer code played it in `showDamageTier` and again in `wreckVehicle`.

**`fireInCameraDof` (WP-C):**
- **DC and DC Final turn no table gun off.** DC Final's AH-6 and MH-500 guns write `fireInCameraDof 0` explicitly. The new export does turn table guns off in other mods, and the data supports it each time:
  - FH writes `0` on `Coaxial_MG42`, `Coaxial_browning` and `MG42_Air`.
  - FHSW writes `0` on `Coaxial_browning` and `MG42_Air`.
  - EoD's own `M3GrantGun` declares nothing, and both constructors clear the flag.
- **Bots on the T-72 NSVT aim from the camera.** In my own harness on a DC T-72 exported from the install, the bot's planned origin and direction match the gun's launch exactly: the origin is the camera plus the muzzle offset, and the miss on the crosshair is 0. The coax and the M2A3 TOW behave the same, and vanilla's Sherman is unchanged.

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| A spawned raft stays where it spawned, below where it should float. In the game it is a mobile object with floaters and settles onto the water. | Through the viewer's own float code, an `Elco80` floats with its origin 1.87 m under the water, so the raft stands 0.47 m under, 0.54 m below its own float height. It shows half sunk. A recorded Midway raft rides at water +0.07 to 0.12 m, which matches the float law's +0.068. On their next effects bake, Pirates' dinghy would hang 4.4 m in the air and FH's bee nest would put a raft on dry ground. | Med-Low (shows once `_shared` is re-baked) | Documented only. It needs a body for the spawned object, a float body over water and the ground otherwise, not a snap to the water level. |
| `write_level_effects` with `--no-optimise` left the old `.gz` next to a new glb, which the publisher refuses. | Code read | Low | Yes, `2d0b3508`, with a test |
| `test_camera_dof` exported two glbs through one Assembler, so the M2A3 glb pointed at meshes 27..37 of a 27-mesh file. | It crashed GLTFLoader | Low (test only) | Yes, `2d0b3508` |
| On No Fly Zone Day 2 the ruin lies on its side. It inherits the tower's frame, and the page's physics had already tipped the tower over. | My in-page re-run screenshots | Med (depends on landing order) | Documented, `1bbc428f` |
| The docs didn't say which other mods' guns move from the camera to the barrel. | Library census of every installed mod | Low | Yes, `d76abaa6` |
| No death offset lands meaningfully underground: the `0/-1/0` offsets sit within 0.2 m of the ground. Spawn effects only ever appear in boat `-1` tiers and objective `0` tiers, never in a plane's tier, so a crash landing never stands a second object up. | Survey of the death tiers of every installed mod | — | n/a |

**New gaps for other packages:**
- **Replay** (`replay-hulls.js`, owned by another session): a replay plays a death tier at the object's root with an upward normal and never clears effects on seek. A replayed DC or XPack2 objective kill would stand its wreck up with no heading, once more every time playback crosses the kill. The recording already holds the server's spawned object, so the replay should probably skip spawn emitters.
- **Netcode:** object damage isn't sent to other players at all (wreck state is listed as not built in `netcode-render.js`), so remote players won't see a ruin. This was already the case before this change.
- **Landing order:** land the `hasMobilePhysics` fix before or alongside this one. Publish the level glbs before the `maps.json` that names them, because the CDN caches a 404.

My scratch scripts (the census, the spawn survey, the bot and raft checks, the decompiles and the in-page run) are in `~/.cache/dc-sweep/review-dof-effects/`.