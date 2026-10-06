dc-land is merged and all six conflicts are resolved with both sides' behaviour kept. **The merge head is `28fd63f6`.** Tests on the merged tree with `TMPDIR=~/.cache/dc-sweep/tmp`: 513 ran, all passed, across 23 modules. That covers my modules, `test_room`, `test_round_end`, `test_carried_spawn_flags`, `test_vehicle_pads` (there is no `test_vehicle_spawner_pads`) and the other suites that touch the merged files. No browser checks, nothing pushed, no Co-Authored-By line.

dc-land moved while I worked, so the branch now holds it at `52a49bc3`, not just `a9f7c40c`:
- **`a44d0dfd`:** the merge of `a9f7c40c` with the six resolutions.
- **`a2e70039`:** a second merge, clean, bringing in `7f676be7` (and with it vehicle-part-collision). I needed it because at `a9f7c40c` `test_room` fails on its own: the room server imports `afterDeath` from `vehicle-wrecks.js`, which the test's module set doesn't carry. `7f676be7` moves it to `after-death.js`.
- **`28fd63f6`:** a test fix. My new room scenario reused the result key `z2`, which the magazine-change scenario already uses.

How each rule was handled:
- **Page end game stands down in a room:** the page's end-of-round clear already returned early in a room. The restart driven by the server's `restart` row now skips the field clear, the pad resets and `restartHulls`. `wrecks.clearWorld` and `restartHulls` also return when `vehiclePads.remotePads` is set, the same gate `stepWrecks` uses. A new wrecks-harness case checks this.
- **spawning.js:** one check now refuses a human whenever the round is not playing, for the page's own round and a room's alike. My separate `roundOver` hook is gone.
- **vehicle-wrecks.js:** `remoteStand` and `remoteGone` sit beside `clearWorld` and `damageOfNode`. The `remote` lines in `stepWrecks` are kept, along with my PCO guard and the hand-over to `effect-objects.js`.
- **level-statics.js:** both rules moved onto the shared helpers in `deployables.js`. The page and `server/room-pads.mjs` both use them.
  - SPAWN-22 (a point being taken switches its pads off) is now inside `followPadPoint`.
  - SPAWN-21 (a pre-game `setTeam` cancels `spawnDelayAtStart`) is a new `preGameSetTeam`. The room server runs it at load through `resetPads({ preGame: true })` and not at restart.
  - A new room-harness scenario checks SPAWN-21: at load the pad with its own side stands its hull and the one without waits. Without the change the test fails.
  - `vehicleSpawnActive` keeps both the `remoteGone` check and the `cleared` check.
- **Ledger:** ROUND-10 and ROUND-11 are both kept. ROUND-11 has one added sentence saying its status refusal is ROUND-10's read. The SPAWN-21 and SPAWN-22 rows now name the shared helpers.

I also fixed a misplaced comment in `map.html`: the `restartRound` doc comment had ended up above `clearWorld` on my branch, and it now sits on `restartRound`.

One item stays open: SPAWN-22 does not reach a room's pads yet. The room's own capture law (`captureFlags` in `server/authority.mjs`) never writes the flag's `spawnsEnabled`, so its pads never switch off. It needs that capture law to apply the SPAWN-22 rule. This is noted in the SPAWN-22 row and the round-end README.