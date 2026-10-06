**Verdict: LAND WITH FIXES.** Four review commits are on `worktree-agent-a3ebbf5bd5063a80b`: 8ecca614, 65debd32, 9cb76c6c, plus the earlier comment fix folded into 65debd32. The branch merges cleanly onto current main, with air-input landed (9c417cec). The owner's two reports are fixed: the Harrier no longer swings sideways or answers backwards, and the Black Hawk no longer rolls when you press a pedal. Fixed-wing is byte-identical against both the old and the current main. The weak spot is the box that the drag and inertia read (end of findings).

**Findings**

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| COL-13 is right | My own disassembly: the `.con` triple goes into the engine as plain x, y, z. The first value (x) scales the inertia about the body's right axis, which is pitch; the second is yaw, the third roll. Rows 0/1/2 are right/up/forward, and the glb only mirrors Z, so no axis is swapped. The rest of the viewer (`rigid-body.js`, `vehicle-bodies.js`) already read it as x/y/z. | — | — |
| The Harrier's nose-up is in DC's data, not a viewer artefact | Per-surface moments: in the S climb the rear-placed roll wings push the tail down under vertical airflow. The front and rear wings cancel, and engine thrust adds no moment. The lighter pitch axis makes it about 3× larger. In the page, W hands-off peaks at 42°. | Feel change | — |
| The Harrier is still flyable | A keyboard pilot holds the hover within 3.5° (1.7° with air-input merged) and the transition within 5.7° (8° merged) of target. In the page through the real key chain (DC 0.7 and DC Final, branch and main+branch): S lifts with no bank or heading change, and the pull answers nose-up. | — | — |
| COL-8: rotation rate stays in world axes, no gyroscopic term | UH-60 spinning free with nothing pushing: rate drift 3e-15 (main: 0.63 rad/s). | — | New test 8ecca614 |
| PHY-14 holds in the binary | Engine messages 0x14/0x15 stop the engine and latch it; 0x13 restarts it if the seat is held; Armor sends with no player and the Armor's "sending" flag held. Every seam goes through `World` `vehicleTick` (page, bots, sim runner, server for remote players). Page test: critical → engines off and the helicopter falls; healed → running again. | — | — |
| The critical-stop test used a stub hull | Now uses the page's own `DamageableVehicle`, and re-boarding mid-critical stays stopped (the latch). | Low | Yes (8ecca614) |
| The two branches together break `test_flight` | air-input's `world-input.js` imports `mouse-input.js`, which the flight harness did not stage, so the whole suite failed to load. | Medium | Yes: staged it (8ecca614) |
| Comment said "vectored airframes are the only drive that reads the byte" | Tanks and wheeled vehicles read it too and are not hooked. PHY-14 now lists this as open. | Low | Yes |
| COL-14 / symbols note misread the flag gate | `findLodGeometry` returns nothing without flag `0x1000000`; both tries sit behind it. The flag means "has a child", so every vehicle root passes. | Low (no effect) | Yes (65debd32) |
| The COL-14 patch is not the engine's rule | The engine does a depth-first search that backtracks to siblings, tests the LOD selector's class, and stops at seat objects; the glb extras do not carry the selector class. The viewer's first-child walk misses the AH-6 family (a dead end in `H6Common`), and the EoD helicopters and Flettners (their exterior is a `SimpleObject`). All of them measure the rotor disc: the AH-6 reads 9.1 m wide, a Huey 15.2 m. | Medium, existing | Documented |
| **The drag and inertia box is the `.sm` file's header box** | The mesh's bounding-box call returns a box copied from the file header (`0x083b4e40`, ctor `0x083b4410`, `loadHeader`). Vanilla headers equal their vertices; DC's do not (the AC-130's header has no wing). On the header box the Mi-24's full-collective climb is 23.8 m/s against retail's 24 (12.4 today). | High, other packages | Ledger and symbols only (9cb76c6c) |
| XPack2's Flettner and jetpack change behaviour | They take the new axis order and lose the gyroscopic term; this is engine-correct. Flettner heading after pedal + roll: 7.7° → −56.8°. | Low | Noted |

**Checks**
- **Full Python suite:** 4594 tests on the branch and 4599 on main (the counts differ by five), both OK with 10 skipped, no failures.
- **main + branch:** flight 80, bots 144, ships 30, ground 102, vehicles 142, world 50, mouse 76, controls 33, all OK.
- **Fixed-wing tracks:** 22 airframes × 2 starts, through the page's `vehicleTick`, hash-identical against both mains.
- **Other mods:** none of the 80 vectored airframes is critical at spawn. EoD, FHSW and XPack2 hover without errors.

**Lab ground truth**
1. **No damping:** the harness matches retail; rates hold.
2. **Mi-24 climb and Mi-8 yaw:**
   - **Not reproduced, before or after COL-13.** The Mi-24's climb gives −0.01 deg/s² (−0.04 on the header box), against retail's 1.1–1.4 deg/s² nose-down.
   - **Mi-8 yaw holds:** it stays at 40 deg/s at 20–50 m/s.
   - **No law in the data gives either:**
     - Neither airframe has wings or a centre-of-mass offset.
     - The hover engines are symmetric, and the dummy rotors sit at about 0.007 m/s².
     - Box drag adds no moment (`updatePositionalDragAdvanced` writes acceleration only), and the angular drag is about 1e-4 rad/s².
   - **Rack tilt explains the size:** a 2° tilt, inside the lab's "square" tolerance, gives about 1.1 deg/s². The recorded rack angles, and the Mi-8's pedal racks, need checking before this is called a law.
3. **AC-130:** I flagged COL-14's 21 m/s prediction as contradicted.
   - **The search is right; the box is not:** COL-14's search reads correctly, but the box is the file header's.
   - **Neither box matches retail:** on the header box the AC-130 holds 59 m/s level on full throttle, above retail's 53.7 maximum. On the vertex box it cannot stay up (20.7 m/s).
   - **The drag law is not refuted.** The bots' throttle is unknown, so this stays open.
4. **Harrier on the pad:** consistent with the RollGrip fix.

**For the ground-chassis reconciliation:** COL-14's box rule changes. Whatever object the search picks, the box is the `.sm` header's `boundsMin`/`boundsMax`, not the mesh vertices. This matters wherever DC's headers differ from the vertices, ground vehicles included.

**New gaps for other packages**
- **Header box:** the exporter should carry each geometry's header box in the extras, and `hullGeometry` should read it. This affects aircraft, ships and ground vehicles in DC.
- **Critical damage on ground vehicles:** retail stops their engines too, so a critical tank cannot drive. The viewer does not hook them.
- **Helicopter climb rates:** the viewer's Mi-24 climbs at half the retail rate today; this is the box issue above.
- **Nose rises on the ground:** after landing with a pitch rate, nothing stops the nose rising on the ground (`settle` leaves nose-up alone). This was already on main.

The http.server on 5633 is stopped and my scratch worktrees are removed.