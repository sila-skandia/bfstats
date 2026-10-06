The fixed-wing package is done: every vanilla, XPack and DC fixed-wing aircraft now flies on the engine's own laws, checked against the lab recordings. It is on branch `worktree-agent-af900aeea9f96ae0a`, 14 commits, not pushed or merged. One regression comes with the asset re-extract: the AC-130's top speed drops from 44.6 to 33.9 m/s against the real game's 42.8 (details under "Open").

## Root cause
The viewer flew fixed wings on its own stand-ins, not the engine's laws:
- **Throttle:** W/S was latched 0..1 and fed straight to the thrust law.
- **Rotation:** a solid `/12` box with the modifier read as yaw/pitch/roll, a gyroscopic term the engine does not have, and 240 Hz sub-steps.
- **Box:** measured from every mesh in the model.
- **Lift regulators:** frozen at rest on every aircraft read from a glb.
- **Gear:** raised on height alone, at the Corsair's 25/23 m for every aircraft.
- **Engine sound:** revs clamped to 1, so the F-16 afterburner layer (1.0–1.2) never played.

Evidence:
- **Revs:** fed each recorded throttle input, the engine's roll axis and gearbox give back the recorded revs to a median error of 0.003–0.007. That covers about 94,000 engine ticks of Spitfire, Corsair, F-16, MiG-29 and AC-130. The old pedal model was off by 0.07–0.26.
- **Binary reads:** `LandingGear::handleUpdate` at 0x08241470 and `Engine::updateSound` at 0x0823e930. The `maxSpeed` sign in the servo law (0x081d7866) is recorded as ledger GUN-2.

## What changed
- **Throttle:** W/S is a held axis into each Engine's own roll axis and gearbox. It springs back on release, and S is reverse thrust.
- **Rotation and box:** no gyroscopic term, the `/3` geometry inertia read x/y/z, and the box from the engine's own search plus the model's header box.
- **Integration:** one step per 30 Hz engine tick.
- **Regulators:** run their own servo law from their data (PHY-26).
- **Gear:** goes up and down on height and engine revs (PHY-25); each part retracts the way its servo drives it.
- **Critical damage:** now stops a fixed wing's engines.
- **Engine sound:** revs are no longer clamped, so the afterburner layer plays.
- **Servo parts:** a negative `maxSpeed` keeps its sign in `turret-rig.js` and `vehicle-base.js`.
- **Bots:** a bot's last stick and throttle carry over a tick in which its plan wrote nothing (AI-112).
- **Exporter:** stamps each LOD's selector class (`selectorKind`), writes the gear's deployed and retracted angles, and carries the regulators' limits and rates.

## Commits (`git log --oneline main..HEAD`)
```
719b6d24 docs(flight): the page smoke, the F16 and the Spitfire on the throttle axis
84f420a8 docs(flight): section 10, every fixed wing on the engine's laws, before and after
c57a386e docs(engine): PHY-25..PHY-27 and SND-24; COL-13, COL-14, AI-80, PHY-14 built for every aircraft
f9a1bf30 test(flight): the Spitfire's numbers with its regulators moving
1b96d55a test(flight): the Spitfire fixture's regulators run their own servo
5ab37b6e test(con): a regulator Wing's physics carries its servo limits
322b40f1 fix(flight): a lift regulator runs its own servo, from its data
5e944beb fix(sound): an engine patch hears the gearbox's revs past 1.0
e2eda827 fix(rig): maxSpeed is signed in the servo law; a gear retracts the way its servo drives it
8b8c1c61 test(flight): the gear follows height and the engine's revs (LandingGear::handleUpdate)
2b9dc1f9 test(flight): the engine law gives back the real game's recorded revs
063b1c9f test(flight): the COL-14 search honours the selector class; the exporter stamps it
dfa88b01 fix(flight): every aircraft on the engine's tick, box search by selector class
1a73a03b wip(flight): fixed wings on the engine's throttle, gearbox, rotation and gear laws
```

## Files touched
Code under `<repo>/.claude/worktrees/agent-af900aeea9f96ae0a/tools/bf1942-models/`:
- **Package files:** `viewer/aircraft.js`, `viewer/vehicle-base.js`, `viewer/turret-rig.js`, `viewer/world-vehicle-tick.js` (throttle axis and critical-damage hook), `viewer/bot-pilot.js`, `viewer/vehicle-audio.js` (comment).
- **New data file:** `tests/fixtures/engine_revs_recorded.json`.
- **Tests:** `tests/flight_harness.mjs`, `tests/test_flight.py`, `tests/test_con.py`, `tests/test_assemble.py`, `tests/mouse_input_harness.mjs`, `tests/test_mouse_input.py`, `tests/test_engine_audio_default.mjs`.

Outside the package list, with reasons:
- `viewer/bot.js`: AI-112. With the held throttle axis, a bot that sidestepped its own carrier for one tick wrote no air input, and the sim's `deckAir` test failed.
- `viewer/bot-aim.js`: a comment only.
- `viewer/engine-audio.js`: removes the rpm clamp. Without it the afterburner layer cannot sound.
- `viewer/ship-spec.js`: the box search honours the selector class. Otherwise the AH-6 family's search lands on its control stick.
- `bf42/assemble.py` and `bf42/con.py`: the exporter changes above.

Docs, under `features/`:
- `flyable-vehicles/flight-model.md`: new section 10; the header and §9e now say it supersedes them.
- `flyable-vehicles/helicopters.md`.
- `bf1942-engine-reference/ledger.md`: new rows PHY-25..27 and SND-24; updated COL-13, COL-14, AI-80, PHY-13 and PHY-14.
- `bf1942-engine-reference/symbols.json`: six entries added.

The ledger IDs are claimed in `LEDGER_IDS.md`, and none collides with main.

## Tests
- **Full Python suite on this branch:** 5007 tests, 1 failure. It is not from this branch: `test_carried_spawn_flags.test_an_ai_only_group_draws_no_ring_on_a_humans_screen` reads the live level tree, which main's 1cf7d440 re-baked, and main updated the test in the same commit.
- **Main's current code merged with this branch, with the code conflict resolved as suggested below, in a scratch copy:** 5140 tests. The only 3 errors are files the scratch copy left out (`features/`, `mesh/nginx.conf`). That run includes main's landed-helicopter tail-wheel test, which passes on per-tick integration.
- **Bot flight:** the sim's air scenarios pass, `deckAir` included, and so do the harness's bot flights.
- **In the page** (port 5652, under the browser lock; server stopped afterwards):
  - DC Gazala's F16 on W: revs 1.2 at 2.5 s, airborne at 6 s, 80 m/s at 8.5 s. Flown hands-off at 5 m, it then hit the ground and was destroyed.
  - Vanilla Gazala's Spitfire: off the ground at 45 m/s at 11 s. On release, the throttle springs back and the revs fall from 1.05 to 0.76 in 3 s.
  - Neither page threw an error.

## Before and after
The full table for all 32 aircraft is in `flight-model.md` §10, with the lab's figures beside it (main / this branch on the live trees / this branch on re-extracted trees).
- **Lift-off:** vanilla went from 29–39 m/s to 25–32, against the lab's 25.4–30.4. The DC jets went from 37–53 to 43–53, against 44.3–55.1.
- **Top speed:** the recordings at full throttle in near-level flight stop gaining speed at these points (`~/.cache/dc-sweep/fixed-wing/top_speed.py`):

| Aircraft | Real game (m/s) | Viewer (m/s) | Viewer trees |
|---|---|---|---|
| Spitfire | 68.8 | 70.2 | re-extracted |
| BF109 | about 72 | 69.8 | re-extracted |
| SU-25 | 79.5 | 76.8 | re-extracted |
| F-16 | 90.6 | 86.6 | re-extracted |
| AC-130 | 42.8 | 44.6 | live |

  The lab's "level p95" of about 61 m/s is not a top speed: bots rarely hold level flight long enough. So the AI-80 brackets are retired.
- **Drag:** within 12% of the recordings for the Spitfire, BF109, SU-25 and MiG-29; the F-16 is 5–13% low.
- **Trim:** the level-flight nose angle is within about 1 degree of the recordings once the regulators move.
- **AC-130:** before, its top speed was 11.5 m/s and it could not take off. It now lifts off at 28.3 against 27.1.
- **AV-8B:** on a re-extracted tree it rolls at 116.5 deg/s, against the lab's 118.2.

## Assets for you to run
The exporter changes touch every model glb with a LOD selector, gear or regulator, and every level that places vehicles. That is a full re-bake of models and levels for vanilla, XPack1, XPack2, DC and DC Final. Run from `tools/bf1942-models`:
1. **Models:** `extract_all.py --level-all --configuration-all --cockpit -j 6 [--mod M --own]` into a scratch `--out`. Install the glbs and reports in place, and do not take that run's `models.json`.
2. **Levels:** `extract_maps_all.py --mod M` per mod, adding `--levels <own levels>` for the packs and DC mods.
3. **Pack and publish:** `optimise_mesh.py` over the output, then `scripts/publish-mesh-delta.py models` and `scripts/publish-mesh-delta.py maps --hash`.

Until then the live trees behave like the "live trees" column: regulators at rest, the old gear retract direction for 56 DC gear axes, and helicopters on the old whole-mesh box.

Decision for you: the re-extract improves the Spitfire's trim, the AV-8B's roll and the AH-6's box. But it drops the AC-130's top speed from 44.6 to 33.9 m/s (real game 42.8). Re-baking and keeping the AC-130 as an open item seems right, since before this branch it could not fly at all.

## Open
- **AC-130 regulators:** its two regulators run to their −30 degree stop. On a re-extracted tree it trims 0.3 degrees nose-up (recording: 2 down) and holds 33.9–35.5 m/s (recording: 42.8). The recorder keeps no Wing angles, so the real regulator angle is unknown. The next step is to re-read whether `calculateNeutralLift`'s transform includes the deflection.
- **Ground roll:** below 20 m/s the gearbox reads revs 0.05–0.22 high. The ground adds a load the law does not see.
- **Idle tail slide:** the Corsair and Stuka go into a pitch tumble; not checked against the game.
- **Dive-angle sound:** `Engine::DiveAngle` was read but not built.
- **Not changed:** ships keep their old rotation law.
- **DC F-14A:** its glb has no physics, so it flies the Corsair table.
- **F-16 gear doors:** they are listed under the engine as spinning parts; whether the page spins them was not looked at.
- **Not checked:** DC Final's steering front gear on the AC-130; and whether the engine's `InfantryResetControls` clears flight channels (clearing them every plan change broke `deckAir`).

## Findings for other packages and for the merge
- **Two merge conflicts with current main:**
  - `world-vehicle-tick.js`: keep main's land and ship hooks and widen the condition to `(vehicle?.engineLaw || vehicle?.landDrive || vehicle?.shipDrive) && activeRoot`. `engineLaw` already covers the vectored airframes.
  - `ledger.md`: keep main's PHY-24 followed by my PHY-25..27; take my PHY-13 numbers; apply my "every aircraft" wording to main's PHY-14.

  The resolved merge's suite result is in the Tests section above.
- **Sounds package:** `~/.cache/dc-sweep/sounds/part_probe.cjs` lifts a plane 300 m with `place()` and expects the gear to retract. Under the engine's gear law it needs revs of at least `setGearUpEngineInput`, so a placed plane at idle keeps its gear down.
- **Bots:** bots now cruise at full-throttle top speed (Spitfire median 70.5 m/s, was 61.3), as the real game's plane law asks.

## Suggested DC parity README row
Move "The fixed-wing engine law" from Queued to landed: "**fixed-wing**: the throttle as the engine's held axis with reverse and gearbox (the F-16 afterburner sounds), the rotation law and header box, one step per engine tick, lift regulators on their own servo, landing gear from `LandingGear::handleUpdate`, signed `maxSpeed` on servo parts; the AC-130 flies. Open: the AC-130's regulators after the re-extract."

Scratch scripts and data are in `~/.cache/dc-sweep/fixed-wing/`: `compare.mjs`, `revs_replay.mjs`, `top_speed.py`, `table.md` and `page_smoke.cjs`.