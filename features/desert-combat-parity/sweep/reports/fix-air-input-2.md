All six items are built and committed on `worktree-agent-a378e38d6be9db02d`, in 10 commits based on 9c417cec. The full suite passes except one asset test that is not mine: 4662 tests, 10 skipped, 1 failure. The branch merges into the current main with no conflicts (`git merge-tree`), and the main suites pass on the merged tree, including `test_flight` with the real DC glbs.

**Your message about which seats need the key doesn't match DC's data.** The H-6 and SA-342 co-pilot cameras have `rem ObjectTemplate.toggleMouseLook 1` (DC's comment says "remmed to give freelook"), and so does the Stryker passenger camera. The con-reader's own export agrees: all three come out `false`. The seats that actually take the key are:
- the MH-6 benches (passengers 3 to 6);
- the SA-342 benches (passengers 3 and 4);
- the MH-53 co-pilot, who sits behind the pilot's own `MH53PilotCamera`.

DC 0.7's `Mi8_CoPilot` is a land-category seat behind the word-carrying `Mi8Camera`. Its control map has no look key, so it can never look around, in retail and now here.

**Engine reads.** New ledger rows MLK-14 to MLK-18, read in the Linux server binary; IDs claimed in `LEDGER_IDS.md`, symbols recorded:
- **MLK-14:** entering a seat makes that seat's own control object the player's vehicle, so the control map and mouse profile follow the seat's category, not the hull's.
- **MLK-15:** a control-file line fills the slot it names and a later line replaces it; a secondary line for a channel with no primary yet is refused.
- **MLK-16:** the excess-input backlog is spent once a tick in the control surface's own servo.
- **MLK-17:** a camera's pitch angle is positive nose-down, so the Corsair camera's `-40..5` means 40° up and 5° down.
- **MLK-18:** a look axis with no acceleration doesn't turn (the default is 0.1 deg/s²).

**What changed, one commit each:**
1. **Co-pilot and passenger seats.** They now get the profile and control map of their own category, so DC's air seats are on Air. A seat needs the key if its camera's `cameraView.toggleMouseLook` says so. On today's trees, which don't carry that word, it falls back to the pilot rule plus "shares the pilot's camera template". The look's direction per axis now comes from each camera's own data. A passenger in a hull with no pilot can look around; before, his mouse went to the free camera. This is tested against a fixture cut from the con-reader export (`tests/fixtures/air-seats.json`), as you asked.
2. **Slots, not sums.** Each channel's two slots are filled in line order and the larger magnitude wins, on foot and in every seat. As a result W+S held together walks forward (retail's buttonsToAxis takes the first key), where it used to cancel. A joystick held against a key now gives the key's full value: A with yaw at 0.18 reads -1, where it used to read -0.82.
3. **Cockpit look limits.** The defaults are now 40° up and 5° down, and a camera's own limits are used where the glb carries them. This needed small edits in `vehicle-camera.js` and `seat-camera.js`, which weren't on my file list; the item couldn't be fixed without them.
4. **Netcode.** The input record is now 17 bytes. The rudder and throttle travel at full 12-bit resolution, as retail's yaw and throttle channels do. Byte 13 keeps the old sign bits, and both the room and the decoder still read 14-byte records from older pages. A remote pilot's -0.37 rudder now arrives as -0.37, not -1.
5. **Ship pitch.** The spring is gone; a ship's pitch key is now a step. The `STICK_RATE`/`axisToward` code is removed from `world-input.js` and `world.js`.
6. **`rememberExcessInput`.** The backlog is spent once per 30 Hz tick in `advanceSurfaces`, and the ±1 clip in `world-vehicle-tick.js` is gone. A one-tick flick of 3.46 now gives [-1, -1, -1, -0.46, 0]. Bots are unaffected because their output is already within ±1. I also removed a leftover rudder spring in a test-only scenario of `flight_harness.mjs`.

Smaller things: a comment-only edit to `bot-plans.js` (a stale mention of the spring), and updates to `features/pilot-mouse-look/README.md`, the engine-reference README row and the ledger.

**Tests and page check:**
- Passing: `test_mouse_look_key` 56, `test_controls` 37, `test_flight` 81, `test_netcode_client` 16, `test_room` 38, `test_world_air_input` 8, `test_world_ship_pitch` 9.
- The one suite failure, `test_extract_loadouts` (DC's `M82Sniper` AI entry), reads the shared `maps/mods/desertcombat/_shared/loadouts.json` asset tree, not code I touched.
- Page check on `dc_lostvillage` (port 5629, under the browser lock, no page errors): the MH-6 bench, co-pilot and pilot are all on the Air profile; the pilot's look needs the key and eases back; the co-pilot's neck is his camera's own (60° up, 45° down). The server is stopped.

**For the lead:**
- **Asset commands:** none from me. The benches need the key, and the positive cameras (BF109, Mustang, B17, DC Final's passengers) and per-camera limits take effect, only after the con-reader export is re-baked into every aircraft model and every level that places one.
- **ground-chassis branch:** it changes the same ship-pitch `if` in `world-vehicle-tick.js` to add `bindsPitch(vehicle)`, and it calls `axisToward`, which no longer exists. When merging, keep `if (player.kind === 'ship' || bindsPitch(vehicle))` with my body (`vehicle.setInput('c_PIPitch', input.pitch)`).

**Still open:**
- **Ramps don't stay where they're left.** In retail, parts without `setAutomaticReset` (LCVP and Daihatsu ramps, sub float trim, Forklift lift, Ural and AC-130 ramps) keep moving while the key is held and stay where they stop. Here they return to rest when the key is released. The correct law already exists in `clipAngleStep`, but switching these parts to it changes how the wheeled drive reads its steering, so it needs its own drive checks. That belongs to a ships/ground package.
- **Trigger slots replace too.** Per MLK-15, shipped `Common.con` binds the console to Grave and then Caps Lock in the same slot, so the binary keeps only Caps Lock. The viewer still treats any bound key as pressing it. I left this alone until retail's console key is checked in the real game.
- **Land seats left alone.** A land-category seat whose camera has a frozen axis still gets the viewer's free look.
- **Mouse units.** Whether one browser pixel equals one mouse count is still unproven.
- **Behaviour changes in other packs.** XPack2's `AW52PassengerSeat` is an air-category seat of its own, so it now gets the Air profile, and its positive camera looks inverted at the shipped invert setting. DC's old `F14A` model has its RIO as the root seat, so today's trees wrongly give that RIO the look key until the re-bake.
- **Stale comment on main.** Line 1866 of `flight_harness.mjs` still says the tick springs the pedals through `axisToward`.

Rows for `features/desert-combat-parity/README.md`:
- Non-pilot air seats: works (MLK-14); the benches get the key after the re-bake.
- Slot rule: works (MLK-9, MLK-15).
- Cockpit limits: fixed (MLK-17).
- Analogue rudder on the wire: works (W-1, W-2).
- Ship pitch spring: removed (MLK-10).
- `rememberExcessInput`: works (MLK-16).