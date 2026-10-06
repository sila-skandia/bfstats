**Verdict: LAND WITH FIXES.** I merged main twice (the second time to a8bbe93e, which includes con-reader). On the final merge the full suite passes: 4,920 tests, 10 skipped. My commits on `worktree-agent-a378e38d6be9db02d`:

- `c029bb6e`: the first merge of main (e39fc803).
  - The conflict is resolved as `if (player.kind === 'ship' || bindsPitch(vehicle))` with this branch's body, `vehicle.setInput('c_PIPitch', input.pitch)`. Nothing still refers to `axisToward` or `STICK_RATE`.
  - The Forklift test now uses the step law: full on the first tick.
  - A new ground scenario shows the forks still move at their own speed rather than jumping to the key: `Forklift_Fork` is `setMaxSpeed 60` over -160..20, which is 0.375 of full travel a second.
  - I also fixed the stale `axisToward` comment in `flight_harness.mjs`.
- `cd624fdd`: your must-fix. The look direction is now the acceleration's sign times the sign of `maxSpeed`.
  - I checked it in the binary first. `calculateAndClipAngle` multiplies by the template's `maxSpeed` with no `fabs` (`0x081d7866`). The `maxSpeed` console word (`ConsoleClass194` `0x081ce090`, found through its vtable `0x8721fa8` and name string `0x086c54f2`) stores the value as written.
  - `seatLookSigns` now uses that rule. A zero `maxSpeed` means the axis doesn't move; a missing one counts as the engine's default of +1.0.
  - I corrected MLK-13 and kept the old claim struck through in the row. The `local-look.js` comment and the README are corrected, and the symbol is recorded.
  - Tests: the BF109 and B17 now look the same way as the Corsair, every combination of the two signs is covered, and the F-14 RIO stays inverted.
  - Every camera that needs the look key in vanilla, XPack1, XPack2 and DC 0.7 now looks the normal way. Only DC Final's seven helicopter pilot cameras look inverted on the shipped setting.
- `18eb737e`: a new room test. A 14-byte page and a 17-byte page share one room: both walk, each sees the other, and each input arrives at its own record's resolution.
- `525aa9cb`: the second merge of main (a8bbe93e), with no conflicts.
- `55ff303a`: a note in MLK-14 that XPack2's `AW52PassengerSeat` is never added to the AW52.

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| The look direction used the acceleration's sign alone, so seven pilot cameras (the BF109, Mustang, B17, both Aichi Vals, `Ju88A_Camera` and DC's AC-130) would look inverted once re-baked | `fmuls 0x174(...)` at `0x081d7866` with no `fabs`; the console word stores the value raw. A census of the con-reader export confirms the counts | High | Yes, `cd624fdd` |
| The merge conflict and the Forklift test | as above | Med | Yes, `c029bb6e` |
| MLK-14 holds | `enter` `0x08316f00` calls `setVehicle(this)` through the player's vtable slot `+0x40`. Client `0x006d7780` reads `[arg+0x4c]`, and both of its callers pass an object they compare against the local player, which fits `arg` being the player. symbols.json still says what `arg` is "was not traced" | Info | Not fixed |
| MLK-15, MLK-16 and MLK-18 hold | Checked against the decompiles of `addAxisMapping` (both forms), `addTriggerMapping`, `update`, `resolveTriggerMapping`, `Wing::handleUpdate`, `calculateAndClipAngle` (its backlog), and the template constructor (0.1 acceleration, 1.0 `maxSpeed`) | Info | — |
| MLK-17 (positive pitch is nose-down) is consistent | It matches the exporter's long-standing `Rx(-pitch)` mapping and the data: pilot cameras run -40..0..14, and land drivers like the Kubelwagen and Lynx run -40..10. The new cockpit default of 40 up and 5 down also suits car drivers better than the old 40 down and 5 up | Info | — |
| W+S held together walks forward | `buttonsToAxis` `0x083f2080` tests the positive key first. Touch controls only add the crouch key, the touch-drag forward still works, the free camera has its own key handling, and bots write their input directly | Info | — |
| Old (14-byte) and new (17-byte) input records work together | Fuzzed 20,000 random inputs against main's encoder and decoder: the first 14 bytes match exactly, and an old server reading a new page (and a new server reading an old one) gets the same result. The new room test and `room_socket_test` (real TCP) pass | Info | Test added |
| `p2_two_browser_smoke.mjs` is out of date | It times out waiting for the deploy screen, identically on clean main a8bbe93e (ran it under the browser lock) | Low, not this package | No |
| XPack2's `AW52PassengerSeat` moving to the Air profile can't reach any player | `rem ObjectTemplate.addTemplate AW52PassengerSeat`, and no XPack2 archive names it | Info | Ledger note |
| Bots and the match runner are unchanged | A 60 s Wake match (seed 3, 8 bots a side) gives an identical summary on main and on the branch, apart from timings. `test_flight`, which includes the bot flight scenarios, passes | Info | — |
| Other mods | EoD's B52 and IL-28 rear gunners, the Huey's flex gunner and the SR-71's back seat are air-category seats with guns, so their aim now uses the Air sensitivity and invert setting. That matches what the engine does per MLK-14. The census rows for carriers are parked deck planes that `spawned-craft.js` already splits off as separate vehicles | Info | — |
| Slot replacement now also applies across the viewer's common and per-vehicle control files | The shipped defaults only overlap on the `c_PICamera` lines, which are identical in both. An imported profile that binds the same channel on another device in both files would now keep only the later line. The engine keeps these as separate control maps, so this is untested | Low | No |

**New gaps for other packages:**
- `turret-rig.js` and `vehicle-base.js` `advanceSurfaces` take the absolute value of `maxSpeed`. No look-bound turret declares a negative one, so nothing breaks today. But 23 parts in DC and 24 in DC Final that don't spring back on release do: right-side landing gear and hatches, and the CIWS barrel. The flight and gear package should check them.
- The re-bake that ships the camera data is still the lead's to run, as before. None of the live models carry `cameraView.look` yet (I checked BF109.glb, MH-6.glb and AC-130.glb). No asset commands come from this review.

Scratch work, including my decompiles, census scripts, the wire fuzz and the smoke logs, is in `~/.cache/dc-sweep/review-air-input-2/`. I've removed my temporary main worktree and the extra links, and no servers or browsers are left running.