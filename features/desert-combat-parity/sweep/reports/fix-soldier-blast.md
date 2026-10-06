Blasts now throw soldiers on the play page, and the soldier template's numbers come from data instead of hard-codes. Item 3 (random heads) is not built; it's reported below. Three commits on `worktree-agent-afe34b28b14293bcc`, nothing pushed or merged. Your two notes are handled: everything is committed, and the one suite failure is not from the TMPDIR deletion — it fails the same way on the base commit.

**What was wrong**
- **S7:** the page's blasts only took hit points off a soldier. Nothing read a projectile's `forceOnExplosion` or a soldier's `explosionForceMod`, so only a replay ever played the explosion states.
- **S8:** `kit-loadout.js` hard-coded vanilla's heal and repair numbers, so Desert Combat's wrench (`repairFactor 0.20`) healed at vanilla's 0.15.

**Engine read: new ledger rows KNOCK-4 to KNOCK-9**
Read in lnxded; every operand order and comparison was re-checked against the disassembly.
- **Size of the push:** `explosionForceMod × forceOnExplosion / radius × exposure`, times 0.1 when the soldier is in water, times friendly fire's cut of the damage, capped at `explosionForceMax`. It only happens when the blast actually costs him hit points, and it does not fall off with distance.
- **Direction:** away from the blast plus his nearest body axis, with the upward part replaced by `(1 − d/r) × 5`. Past half the radius there is no push at all.
- **Speed:** it lasts one 1/30 s engine tick, so he leaves at force ÷ 30 m/s. He is thrown into the flight animation at 8 m/s or more.
- **Data:**
  - soldier templates: vanilla, XPack1 and XPack2 are 75 / 600 (force, cap); Desert Combat is 150 / 600.
  - engine defaults: 1 / 300 for the soldier pair, 150 for the round's force.
  - vanilla's grenades and bazooka write `ForceOnExplosion` on the weapon rather than the projectile. The engine ignores it there, so their rounds push at 150.
- **Landing:** only a bot plays the get-up-after-landing animation. A human goes straight back to standing.
- **Correction:** an earlier note said the 0.1 always applies. It only applies in water; `hitpoints-and-damage.md` is fixed.

**DC is not always "thrown twice as far".** The 600 cap usually bites. A grenade 5 m off throws a standing vanilla soldier at 12.5 m/s and a DC soldier at 20 m/s. A crouched soldier goes at 20 m/s in both. A clean 2× only shows on weak blasts.

**What I changed**
- `knockback.js`: the push formula and a small state machine for the flight, landing and get-up.
- `walking-body.js`: the soldier body takes the push.
- `vehicle-hits.js`: `throwSoldier`, called from the splash pass for the human and bots on foot.
- `world-soldier-tick.js`: a dead soldier's body knows it is dead, so a killing blast throws the corpse.
- `foot-body.js` and `bot-visuals.js`: draw the flight and landing, and a thrown corpse follows the body.
- Data: `con.py` reads the three words, `damage.json`'s projectile table carries the round's force, and `gaits.json` `soldierBody` gets each soldier template's force and heal/repair numbers.
- `kit-loadout.js`: reads the heal/repair numbers from `soldierBody`. Vanilla values are unchanged; DC's wrench now heals 0.20 a round.

**Files outside my list** (small hunks):
- `vehicle-damage.js`: returns the pre-friendly-fire damage, needed for the push.
- `round-impact.js`: two lines to carry the round's force on the blast record.
- `world-soldier-tick.js`: the dead flag above.
- `hand-weapon.js` and `map.html`: getters to pass `soldierBody` and the template name through.
- `test-hooks-world.js`: a `force` option on `__blast`.
- Three tests' module lists, because `kit-loadout.js` now imports `soldier-death.js`.

**Tests**
- New `tests/test_knockback.py` (17 tests over a node harness): at the same blast a DC soldier gets exactly twice vanilla's push (5.0 vs 10.0 m/s), and the 600 cap, the half-radius cutoff, water, friendly fire, direction, bot vs human landing, dead landing, walls and respawn all behave as read.
- Added cases in `test_con`, `test_die_assets` and `test_kit_level_js`.
- Full suite: 4614 tests, one failure: `test_bocage_match_route_failures` (306 route failures, limit 100). The base commit 70d0b6ea gives the identical 306, all from one bot, and every match metric is unchanged.
- Page check on Lost Village with two bots, in headless Chromium under the lock:
  - a thrown human was standing on the frame he landed;
  - a bot ran through the survive landing and the get-up with his weapon stowed;
  - a killed bot's corpse flew about 17 m;
  - a killed human held the dead landing.
  - No page errors. Port 5625 is stopped and scratch is pruned to about 8 MB.

**Commands for you to run** (scratch-extracted for vanilla and DC: `soldierBody` gains only the new fields, `die.gait.glb` is byte-identical):
- Every pose tree: `extract_pose.py --die --mod <M> --out <tree>/poses`. This rewrites only `gaits.json`'s `soldierBody`.
- Every maps tree: `patch_scene.py --layer damage --mod <M> --all` (for `forceOnExplosion`), then `publish-mesh-delta.py`.
- Until then, every tree uses vanilla's 75/600 and every round pushes at the default 150.

**Random heads (item 3): not done.** The roll rule is known (LOAD-6, KIT-1; `random-items.js` `nextRoll`). But the head roll shares one counter with the kit rolls, and the order they run in at spawn hasn't been read. It also needs every head variant baked into each soldier rig, a re-extract of all pose trees, and changes to the pose composer and three renderers — beyond this package.

**Rows for `desert-combat-parity`:** S7 is done for the human and bots on the page; S8 is done.

**Still open** (detail in `features/bf1942-blast-and-bounce` section 4):
- Remote players aren't thrown: the room server has no splash, and the network wire carries no explosion state.
- Vehicles aren't pushed.
- A corpse hit by a later blast isn't thrown.
- In first person the human can still fire while flying — `hand-weapon.js`, the weapons package's file.
- A prone soldier who is thrown goes back to prone after landing, because the page's prone toggle stays on.
- The free-look lock during flight isn't modelled.
- The landing reads one contact per tick.