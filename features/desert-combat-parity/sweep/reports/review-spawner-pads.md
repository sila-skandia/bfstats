**Verdict: LAND WITH FIXES.** The package mostly holds up against the binary and the lab recordings. It got one engine law wrong: what a pad does at round start when its flag begins neutral. I fixed that and one replay problem on the branch, with 4 commits:

- `066be336` fix(viewer): a flag that opens neutral leaves its pads on their own side
- `67b37112` fix(viewer): the replay's stand-ins leave the pads' other-side vehicles out
- `d889bf46` docs(engine): SPAWN-20 timing clarified
- `b8ac9b5a` docs(viewer): README note for the extra vanilla change

**Merge onto main:** one conflict, the SPAWN-13 row in the ledger. Keep main's version (the kit-pickups review refined it). The full suite on the merge passes: 4,716 tests before my fixes, 4,717 after, 10 skipped each time.

## Findings

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| **SPAWN-19's round start is wrong.** A flag that starts neutral does not switch its pads off. A pad with its own `Object.setTeam` spawns that side's vehicle from the first frame. The agent took `ControlPoint::reset` to be the round start. | Binary: `ControlPoint::init` (0x08283a90) switches pads on only when the point belongs to a side. `reset` is called only from `restartMap` (0x08157d31). `restartMap` then runs `ObjectSpawner::reset` (0x08314880) on every pad, which puts back the pad's own on/off state and team, undoing reset's switch-off. SPAWNGRP-3 already recorded the init/restart facts. Lab: DC El Alamein (4 rounds) and Day 2 (2 rounds) have the South outpost's ZPU-4 standing at t=0 with the flag neutral. The round starts with 9 AA kits; switching the outpost off would give 5. Vanilla El Alamein starts with 2 flak38s. | Medium. Missing at round start: 31 DC pads, 30 DC Final, 13 vanilla, 17 XPack1, 43 XPack2. The agent's harness tested the wrong law, and its open item calling the kit page "a gap" was backwards. | Yes. `followPoint` now switches off only pads with no team of their own. New harness case added. SPAWN-19 rewritten, a note added to SPAWN-2, 4 symbols recorded. Page check: the ZPU-4 now stands at the start. |
| **Replay stand-ins.** `levelVehicles` in map.html listed the loaded other-side vehicles too, so each pad offered two places. The pairing in `replay-standins.js` refuses whenever places outnumber roots, so stand-ins would be lost. | Read from the matching code; not run against a recording. | Low–Medium | Yes, a one-line filter in map.html (no `replay*.js` touched) |
| SPAWN-20's out-of-area damage happens on every abandoned 0.5 s step, not only after the countdown runs out. | asm: the countdown's decrement path at 0x08319252 jumps back to the area check at 0x08319097 | Low (not modelled anyway) | Ledger wording |
| **SPAWN-17 confirmed.** "15" and "60" fail the bool parse and leave the value unchanged. | The linked libstdc++ (GCC 3.2.3/3.3.3) bool parse fails on anything above 1 without storing it (0x0867997c). The console stores the function-static unconditionally. All six DC lines follow a `spawnDelayAtStart 0`. | — | — |
| **Open:** `spawnDelayAtStart 1` is probably cancelled on a level's first round. Any `setTeam` during pre-game resets the delay to −1. | DC Final DC_Cornered's 6 pads all have `setTeam` and an owned flag. The viewer holds them back; the engine likely spawns them at once. Whether the level loads during pre-game is not proven. | Low (DC Final, one level) | No |
| **SPAWN-18 confirmed.** The count is every connected player, bots included, alive or dead, both teams. The delay runs from destruction. | `getNumberOfPlayers` measures the full player list; `getMaxNrOfPlayers` reads Game+0x1c. Lab: an MLRS arrived 41.3 s after a capture, which is 40 + 20×(1−30/32). | — | — |
| The first respawn delay uses the round's player count. The lab measured the maximum delay, but only because its server had 0 players when the map loaded. | The viewer's choice fits a map rotation with players already connected. | Note only | No |
| SPAWN-19 (captures) and SPAWNGRP-10 confirmed: a capture restarts the delay, a parked hull stays, and a spawn takes a random live point or is refused. | Decompiles; lab captures spawn the taker's vehicle at once | — | — |
| Bots handle a pad whose vehicle changes mid-round. | Vanilla Gazala on a re-patched scratch tree, seed 2, 600 s: Axis capture, PanzerIVs and flak38s stand at once, two bots mount the loaded PanzerIVs | — | — |
| **Room play:** the room server runs no pads and no vehicle respawn (true before this branch too). The page's local pads can now show other-side vehicles the room server never created; `netVehicleIdFor` could match one to a same-type room vehicle anywhere on the map. | Code read | Low | No |
| `disableWhenLosingControl` is not modelled: the engine switches a point's pads off while it is being taken. | `losingControl` (0x08284030). Used by 3 points on XPack2 Telemark and DC/DC Final Basrah's Edge | Low | No |

**Performance:**
- **No Fly Zone (both days):** loads no extra vehicles, so no change.
- **Worst DC case:** Oil Fields, 1.15 MB gzipped.
- **Worst DC Final case:** Oil Fields, 12 vehicles, 3.13 MB raw / 1.35 MB gzipped. Local page load is about 10.0–10.5 s, against 8.9–9.3 s with those models blocked.
- **The biggest cost is outside DC.** FHSW's gazaps-1945 loads 4.4 MB gzipped and seelow-heights 3.1 MB.
- **No 404 storm.** A missing model costs 2 requests, once: DC Midway's `ZPU_4` and FHSW's `opelblitz`.

## Gaps for other packages
- Rooms: pads and vehicle respawn belong on the server.
- `disableWhenLosingControl`.
- `spawnDelayAtStart` against pre-game `setTeam`: confirm whether the level loads in pre-game.
- Still open from the agent: the TKT-5 end-of-round bleed and the AC-130's spawn point riding the aircraft.

The lead's asset commands are unchanged: re-patch the `spawns` layer in all five trees, then publish.

Files I changed:
- `<repo>/.claude/worktrees/agent-a779345840402c239/tools/bf1942-models/viewer/level-statics.js`
- `<repo>/.claude/worktrees/agent-a779345840402c239/tools/bf1942-models/viewer/map.html`
- `<repo>/.claude/worktrees/agent-a779345840402c239/tools/bf1942-models/tests/vehicle_pads_harness.mjs`
- `<repo>/.claude/worktrees/agent-a779345840402c239/tools/bf1942-models/tests/test_vehicle_pads.py`
- `<repo>/.claude/worktrees/agent-a779345840402c239/features/bf1942-engine-reference/ledger.md`
- `<repo>/.claude/worktrees/agent-a779345840402c239/features/bf1942-engine-reference/symbols.json`
- `<repo>/.claude/worktrees/agent-a779345840402c239/features/vehicle-spawner-pads/README.md`

Probe scripts are in `~/.cache/dc-sweep/review-spawner-pads/` (3.9 MB). My HTTP server on port 5643 is stopped and the trial-merge worktree has been removed.