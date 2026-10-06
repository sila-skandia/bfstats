**Verdict: LAND WITH FIXES.** My commit is `c792b79a` on `worktree-agent-a09e4ba761602b48f`. It sits on the agent's `9b715702` and `870beea7`, uses `--only`, and has no Co-Authored-By line. The full suite passes in the worktree after my fixes: 4622 tests, 10 skipped. Main at 70d0b6ea also passes: 4594 tests, 10 skipped.

The engine reads hold up, except one wrong conclusion drawn from MLK-8. The shipped default does not invert the held look in most planes.

**Engine checks I did myself** (lnxded objdump and decompile, BF1942.exe objdump with the matching sha):
- **MLK-7 is right.** `axisToAxis` with option 0 returns the device's relative register. The client's device update (`0x0066ffe0`) rebuilds that register from `lX` on every pumped frame, so a still mouse reads 0.
- **MLK-8's device half is right.** `applyMouseSensitivity` calls `setInvertAxis(1, invert)`, and the profile is chosen by category (cmp 2 at `0x006ae4f4`). The sign is right too: pulling the mouse back gives negative `c_PIPitch`, the ArrowDown sense.
- **MLK-9 is right.** `fucompp` at `0x083f1ecf` with `test ah,0x45` replaces the primary only when the secondary's magnitude is strictly larger.
- **MLK-10 is right.** Both binaries seed the key rise and fall times at 0.001 s, and no shipped `.con` changes them.
- **MLK-11 is right.** I swept every access to `+0x18`: only the constructor (`0x6ec3ec`), the slider binding (`0x6ec49d`) and the profile writer (`0x6ecbe2`) touch it. The name string is pushed once, and none of the settings vtable's methods read it.
- **MLK-12 is right.** `PlayerAction::set` never reads `+0xe4` or `+0xe8`.

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| Inverting the Left Shift look is not retail's default for most planes | The held look is the Camera's own bundle, so its direction is the camera's pitch `setAcceleration` sign times the invert box (GUN-2, MLK-3). Pilot cameras are negative in 8 of 13 vanilla (Corsair, Spitfire, Stuka, Yak-9, Zero, both SBDs, Il-2), every XPack1 and XPack2 pilot, and 23 of DC's 24. The minus cancels `setAirMouseInvert 1`. Only BF109, Mustang, B17, the two Aichi Vals, DC's AC-130 and 9 DC Final cameras are inverted in retail. | Medium | Yes. The page now assumes the negative majority: the shipped box leaves the look as it was, and turning the box off inverts it. New ledger row MLK-13; MLK-8 points to it. |
| The Harrier's wings deflect past their limit on a fast mouse | Helicopters and the Harrier take the raw value, but their Wing surfaces go through `advanceSurfaces`, which had no clip. A 500 px/s hand held for 1.5 s drove the AV-8B ailerons to 1.92 times full deflection: 106° bank at 2 s instead of 78.5°. The racks clip themselves; I checked every DC, DC Final and XPack2 rack. | Medium | Yes. `vehicle-base.js` `advanceSurfaces` now clips its target at ±1 (free axes excepted). New test in `test_flight.py`. |
| On touch, dragging the look zone in a pilot seat now flies the plane | A seated player is never `touchFlying`, so the drag went into the stick. The agent's touch test used a seated `touchFlying=true` state the page never produces. The report says touch is unchanged. | Medium-low | Yes. `touch-controls.js` tags the drag as a finger and `lookDelta` ignores it there. New test. |
| The flight harness's bot helicopter still used the removed rudder spring | `flight_harness.mjs` around line 1665 | Low | Yes, spring removed; tests still pass. Stale spring comments in `seat-camera.js` and `test-hooks.js` are fixed too. |
| The owner's joystick now reaches the control surfaces with no 0.4 s spring | The report doesn't mention it. This is engine-correct (a stick axis is a position) and nothing doubles: with no mouse bound, the old key-plus-joystick fold is unchanged. | Info | n/a |
| "One pixel is one count" | It is the same unproven unit the foot look and turrets already use (GUN-2b, `countsPerPixel` 1). The stick is full at about 260 px/s, as retail is at 260 counts/s, so a flick is a full-deflection step, which is retail-like. | Low (open) | No |
| Regressions | Bot planes on Wake (Corsair, Zero) fly the same altitude tracks as main within 2 m. On DC Bocage, the bots in the UH-60, Mig29 and F-15C behave like main's; main crashes them too. Tank and boat inputs are identical for ±1 values. Netcode carries pitch and roll up to ±16. The replay imports none of the changed modules. | — | — |

**New gaps for other packages:**
- The per-camera pitch sign and `toggleMouseLook` are not exported. Emitting both in `cameraView` and re-baking the aircraft would fix the five vanilla positive cameras, DC's AC-130 and the 9 DC Final ones (the Mi-8's is +100000).
- The cockpit look limits look mirrored. `LOOK_LIMITS.cockpit` allows 40° down and 5° up, but the engine's negative pitch is up, so the Corsair camera's `-40..5` means 40° up and 5° down. Not checked against a recording.
- The viewer still sums keys and joystick on one channel. MLK-9 says the larger slot wins and they never add; this predates the package.
- Netcode sends the rudder as sign bits only, so an analogue rudder (joystick, or a profile that binds the mouse to it) is lost for remote players. This also predates the package.
- DC's VCAir co-pilot and passenger seats (`H6CoPilot`, `MH6Passenger_PCO3..6`, `SA342CoPilot`/`Passenger3,4`, `MH53CoPilot`, `F14BRIO`) get the LandSea profile and no look key. Retail gives them the Air profile, and the MH-6 and SA-342 passenger cameras also need the key.

Scratch work and measurements are in `~/.cache/dc-sweep/review-air-input/`. I removed the temporary main worktree and started no server on 5632.