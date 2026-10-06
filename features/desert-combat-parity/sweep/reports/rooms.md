All six `rooms` items are built and committed on `worktree-agent-a1ec44a982eed3867`, but two of them use a departure from retail: the clients report where their own rounds land, and the room prices them. The two-page smoke now passes end to end. Nothing is pushed.

**Branch state.** I merged the terrain-contact branch (`worktree-agent-a40116b8a798088be`, still in review) into mine as you suggested, because I edited the same server files (`level-data.mjs`, `level-instance.mjs`, `level-load.mjs`, `glb-scene.mjs`). My hunks build on theirs. The only one in `level-instance.mjs` is the constructor taking the layer's `extras`/`spawnables`; their drive-input block is untouched. The merge had one conflict, in `ground_harness.mjs`: main's forklift test and their probe-face test had appended blocks at the same place, and I kept both. Main has moved since; a trial merge of main into my branch has no conflicts.

**What was wrong and what changed**
1. **Pads and respawn** (`server/room-pads.mjs`). The room ran no pads, and the page matched its vehicles to room vehicles by template and distance anywhere on the map.
   - The server now runs the page's pad law: SPAWN-2, 10–13, 17–19, the abandoned clock, and wrecks. Other-side hulls are in the vehicle table from the start.
   - New rows: `padSpawn`, `vehicleGone`, `hull`, and `object` for armoured statics. In a room, the page's own pads and wreck clock stand down and follow those rows.
   - Pad helpers (`padFromSpawn`, `followPadPoint`, `padSides`) moved into `deployables.js` so the page and server share them.
   - Placed objects are now named by their node index in `scene.glb` on both sides. GLTFLoader's own lookup table proved unusable for this: it gives every copy of a reused mesh the same index, which is why the smoke couldn't find four of Aberdeen's guns. `test_level_nodes.py` checks the naming on Aberdeen and Wake.
2. **Blasts and throws** (`server/room-hits.mjs`). This is the departure. The room still flies no rounds, so the page reports each landing of its own rounds and the server prices it with the page's own hit and splash code, pushes the soldier (KNOCK-4..9), and sends a `blast` row. The flight state rides two spare codes in the snapshot's swim bits, and remote pages play it. In a room the page no longer applies hits or splash itself; the shooter's figures are trusted within clamps.
3. **Object damage and wrecks.** Hulls and statics now replicate through the server's hit points; a page in a room bills no object damage of its own (`World.remoteDamage`). A page also puts a hull another player left where the server has it, instead of back on its pad. What a death tier stands up (EMT-10) is still drawn by each page from those hit points.
4. **Reloads.** The page announces its own reloads, the server relays them (rate-limited, dropped from the dead), and other pages play the Reload sound at that soldier (SND-17). Also a departure, since retail's server runs the weapon itself.
5. **Rounds.**
   - **Round end and restart:** at the round's end the room now sends the result, clears the world (HP-20) and restarts 10 s later (ROUND-9). New ledger row ROUND-11, read from the disassembly: `spawnPlayer` refuses a human unless the round is playing, or when his side is out of tickets in modes 2/4/5. I first claimed ROUND-10, found the round-gaps package already had it, and renumbered.
   - **Layer choice:** a room plays the layer its creating join names via `?mode=`, and CREATE GAME has the file's own GAME TYPE list.
   - **The page follows:** the debriefing shows the server's medals and waits for the server's `restart` row.
6. **The smoke.** It now:
   - accepts the briefing (Enter);
   - steers A to the nearest hull with the mouse;
   - checks both pages see each other;
   - checks all 64 room vehicles match their page copies;
   - lands a hit and a blast through the room.

   It runs as one browser process under the lock. Last result: OK. A moved 40 m, the hit on a PanzerIV showed up on B's page, B lost 9 HP and A saw him in the backward flight.

**Commits** (`git log --oneline main..HEAD --first-parent`): `69f0c864`, `45c74347` (the merge), `6e851ff5`, `307029be`, `9dcf2131`, `aab1c710`, `4f796763`, `c6f93f59`, `a2713213`, `59cbcf04`, `1069f725`, `b78bc205`, `41fcd055`.

**Tests.**
- `test_room.py`: 58 tests, including new scenarios x, y, z, z2–z5.
- Other new and changed checks: `test_level_nodes.py`, a room case in `test_round_end.py`, whole rows and flight in `test_netcode_client.py`, and 588 tests across the 24 suites that touch the modules I changed.
- Full suite: 5039 tests, 10 skipped, 1 failure: `test_carried_spawn_flags` (`test_an_ai_only_group_draws_no_ring_on_a_humans_screen`). It isn't mine: the live Battle of Britain tree has been re-patched, and main already has the updated assertion, so it passes once main is merged.

**Asset commands:** none; nothing touches the exporter.

**Open**
- The server still flies no rounds: no server `GunFire`, and no weapon slot on the wire. A rifle round never hits another player in a room.
- No remote gunfire sound, and seat-gun reloads aren't relayed.
- The room's pads keep running during EndGame; whether retail's do isn't read.
- Rooms load no score settings, so medal scores use the engine defaults.
- CTF and TDM rooms have no score or time limit, so they never end.
- In a room, a driver's crash no longer washes his screen (the wash comes from a crash, not from a hit-point row).
- `disableWhenLosingControl` and TKT-5 are still unbuilt.

**For other packages:** HP-20 on the spawned-objects branch and round-gaps' ROUND-10 cover the same `clearWorld` and restart on the page; the room cites them. Expect a merge conflict at the ledger's ROUND rows (keep both).

Rows for the parity README: rooms pads/respawn, splash/throws, object damage, reloads, rounds/layer and the smoke are all built and proved by room tests plus the smoke; the cited departure is client-reported landings.

The main write-up is `<repo>/.claude/worktrees/agent-a1ec44a982eed3867/features/netcode-play-multiplayer/README.md`, section "The round, the pads, the landings and the reloads". The new server code is in `tools/bf1942-models/server/room-pads.mjs` and `room-hits.mjs` under the same worktree.