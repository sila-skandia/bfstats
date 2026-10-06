The air seat's input chain now follows retail's Air control map. With Left Shift up the mouse flies the aircraft, and a key fills its channel within one tick. The full suite passes (4620 tests, 10 skipped), and both changes were flown headless and checked in the page.

**What was wrong**
- **The mouse flew nothing.** `controls.js` skipped mouse axis lines, and `lookDelta` threw a pilot's mouse counts away when the key was up.
- **The keys had an invented spring.** `world-vehicle-tick.js` ran the rudder, roll and pitch through `axisToward` (2.4/s out, 3.2/s back), so a key took about 0.4 s to reach full deflection on top of the part's own servo.

**What the engine does** (new ledger rows MLK-7 to MLK-12, symbols recorded)
- **The mouse stick (MLK-7).** It uses the same device value as mouse look: `0.001 × counts/s × 3.85` on the Air profile. It is a rate, so a still mouse is a centred stick, and it is quantised on the wire up to ±16. This closes the "needs a client engine read" item.
- **Invert (MLK-8).** `setAirMouseInvert 1` inverts the mouse's Y axis for everything reading it. So it inverts the stick's pitch and the held look's vertical together.
- **Two bindings on one channel (MLK-9).** Each channel has a primary and a secondary slot, set by the line's last flag. The larger magnitude wins and the primary wins a tie; they never add. Shipped Air puts the mouse first and the arrows second.
- **Keys (MLK-10).** A key reaches full in 0.001 s and nothing shipped changes that, so a key is a step.
- **`setAirKeyboardSensitivity 0.5` does nothing in play (MLK-11).** The client stores it, shows it on the options slider and saves it, and nothing else reads it. Key deflection stays ±1, so the helicopter collective and the Harrier hover are unchanged. This settles the census's open question 2.
- **Mouse vs key (MLK-12).** The server cannot tell a mouse from a key.

**What changed**
- `controls.js`: parses mouse axis lines and each line's slot. `axis(trigger, mouse)` folds the mouse in by the slot rule, unclamped.
- `local-look.js`: a pilot's counts go to the stick when the key is up. When held they turn the head, with the Air invert on the vertical.
- `local-player.js`: the rudder, roll and pitch come from the control map plus the mouse. With the key up the look pair is zeroed, as retail does.
- `mouse-input.js`: Air starts inverted, matching a fresh install.
- `world-input.js`: the stick channels are capped at the wire's ±16 instead of ±1.
- `world-vehicle-tick.js`: the air branch has no spring. Helicopters and the Harrier take the raw value, since their parts clip themselves. Fixed-wing surfaces get it clipped to ±1, because `advanceSurfaces` has no clip of its own.
- `mouse-look-key.js`: header updated, plus `routeLookPair`, the router's released branch that zeroes the look pair.
- Ships keep their spring. Gunner seats are unchanged. The fixed-wing throttle latch and `aircraft.js` were not touched.
- **Behaviour changes the owner will notice:**
  - Holding Left Shift and looking up or down in a plane is now inverted, as retail's is. `game.setAirMouseInvert 0` turns that and the stick inversion off together.
  - Bots' rudder no longer goes through the spring either. Flown with and without it, the bot helicopter law gives the same results on five DC airframes (within 0.07 s and 1.2°), so I removed it for bots too.
  - The owner's own profile binds no mouse axis to the stick (it flies on a joystick), so for him the mouse still flies nothing.

**Tests**
- `test_mouse_look_key.py` (37 tests) runs the whole page chain on real modules:
  - 30 px in one tick gives a stick of +3.46 roll and −3.47 pitch (+3.46 pitch with invert off), and 1.21 at a quarter sensitivity.
  - Keys and mouse follow the slot rule.
  - Holding Shift sends the mouse to the look and leaves the stick at 0.
- New `test_world_air_input.py`: a key gives the full channel on the first tick and rest on the tick after release. A helicopter takes the mouse rate whole, a fixed-wing surface takes it clipped, and ±16 is the ceiling.
- `test_controls.py` and `test_mouse_input.py` were extended. `test_world_ship_pitch.py`'s air case now pins the step instead of the spring.

**Flights** (60 fps through the real World tick, input stage and flight model built from the glbs; "before" is main at 70d0b6ea)

| Aircraft and hand | Before | After |
|---|---|---|
| DC AH-64, mouse right 300 px/s for 0.5 s | nothing | roll rack at its 20° stop, 21°/s, 46° bank at 3 s |
| DC AH-64, mouse pulled back 200 px/s | nothing | nose up at 9.9°/s |
| DC AH-64, slow mouse 60 px/s | nothing | stick 0.23, rack 4.6°, 10.9°/s |
| Corsair, mouse right 300 px/s for 0.5 s | nothing | same as ArrowRight now: 61° bank at 1 s |
| Corsair, ArrowRight for 0.5 s | 46° bank at 1 s | 61° bank at 1 s |
| Corsair, mouse pulled back 200 px/s for 1 s | nothing | 46° nose up at 1.5 s |

The helicopter rates hold after the hand stops because nothing damps a helicopter's rotation; that is census open question 1, not the input. The Corsair's roll peaks around 240°/s, which is the fixed-wing model, not the input.

On the Wake page with a Corsair: the mouse gives a stick of 1.15 / −1.16 and the surfaces get ±1. A still mouse gives 0. ArrowRight is full on the first frame that runs a tick. With Shift held the stick is 0 and the camera turns. There were no page errors.

**Commits:** `9b715702` (code and tests), `870beea7` (ledger rows, symbols, docs). No asset commands are needed.

**Still open, belonging to other packages**
- **Aircraft physics:** `rememberExcessInput`, which vanilla's elevators declare, is not modelled. In retail a fast mouse flick's excess past full deflection is spent over later ticks; here it is clipped at ±1. The fix belongs in `vehicle-base.js` `advanceSurfaces`. Once surfaces clip themselves, the ±1 clip in `world-vehicle-tick.js` can go.
- **Stale comments:** `tests/flight_harness.mjs` (around line 1665) still mimics the removed rudder spring in its bot scenarios, and `seat-camera.js:463` and `test-hooks.js` still describe the spring.
- **Ships:** a ship's pitch keeps the viewer's own spring, although the same 0.001 s key law applies to it.
- **Still unproven:** that one browser pixel is one mouse count. It now scales the pilot's stick too.

Rows for `features/desert-combat-parity/README.md`:
- Item 8 (mouse flies the aircraft): **Works.** MLK-7 to MLK-9, `features/pilot-mouse-look`.
- Item 9 (key shaping): **Works.** MLK-10 and MLK-11. Air census open question 2 is closed: the keyboard sensitivity is inert.