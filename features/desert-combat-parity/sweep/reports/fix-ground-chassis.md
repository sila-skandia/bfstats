All four items in the brief, plus the three you added (CW2, CW10, CW11), are done in 6 commits on my worktree branch. The full suite passed on the final commit: 4620 tests, 10 skipped. That run had finished before the cut-off (its log was started 6 s after the last commit), so I didn't re-run it.

**Two outcomes that don't match your expectations:**
- **The real-glb Willys is not byte-identical.** The `WILLYS` table's inertia box was a guess (1.6 × 1.5 × 3.6 m); the engine's box is 1.734 × 1.523 × 3.636. Top speed moves 111.3 → 111.2 km/h and the full-lock turn stays at 14.1 deg/s. The harness Willys and Kübelwagen, which carry no meshes, are byte-identical.
- **BMP-2 now swims at 5.6 m/s, not ~3.3.** The old 3.3 came from the glb's last collision layer; the engine measures depth on col0, and the drive now gets col0 from the body world.

**What was wrong and what changed:**
- **G1, own chassis.** `GroundVehicle` used the Willys table for every wheeled vehicle. It now reads the root's own mass and drag, each wheel's radius from its own mesh, and inertia from the engine's geometry box. Which box the engine uses was unread, so I read it from the Linux server binary (new ledger row COL-13): for a car it is the cockpit hull mesh (`Willy_Hull_M1`), for a tank the root LOD's first child (`ShermanComplex`), and the box is the `.sm` header bounds. SCUD-B full lock at speed drops 35.6 → 15.6 deg/s.
- **G2, land vehicles in water.**
  - Every land vehicle now stands on the sea bed, since water produces no impulse in the engine (new row PHY-16).
  - Underwater, the submerged drag multiplier applies, using the root part's own col0 depth.
  - `submarineData` crush and crew oxygen now run. PHY-3 was wrong that +0x17c gates this block: every code path reaches it.
  - Measured in the headless runner on Operation Bragg: the Humvee sinks to the bed in 2 s, crawls at 4.6 m/s and loses 5 HP/s. The M1A1 sinks, drives at 6.8 m/s and is crushed at 5 HP/s.
  - XPack2's Schwimmwagen swims faster too: 15 → 22 km/h.
- **CW2, upside-down damage.** I read the test from `Armor::update` (new row HP-18): touching something or at rest, within two bounding radii of the ground, and the up axis under 0.3 against world up. It bills the whole one-second bank. A Humvee rolled onto its roof is billed 5.17 HP/s once it has lain still 3.3 s and is wrecked at 23 s. An AH-64 held on its back is wrecked at 5.2 s.
- **CW10, Forklift steering.** Each steered wheel now turns as its own bundle does, including the rear axle's reversed direction. The Forklift's turn at a third of throttle went from +14.9 to −14.9 deg/s, so right stick now turns right.
- **Item 4 + CW11, `c_PIPitch`.** It now reaches any land vehicle whose own rig binds it: the Forklift's lift and forks, and the Ural5323's ramp. The M2A3 ramp isn't exported, so it stays dead.
- **G5, DPV spin-out: no code change, because the engine's own law produces it.** The body turns about its origin, and the DPV's origin sits 0.94 m ahead of the rear axle. Moving it to mid-wheelbase stops the spin (186° → 86° in 3 s); moving the Humvee's origin to the DPV's place makes it spin (151°). Only the free `angularDamping` constant could hide it, and I didn't retune it. A harness test pins the cause. Confirming against the real game needs a recorded drive.

**Commits (`git log --oneline main..HEAD`):**
- `73673098` G1
- `e841b316` G2
- `47a859ba` CW2
- `a395e238` CW10
- `d1d64a47` `c_PIPitch` (item 4 + CW11)
- `bdb6e385` G5 finding and feature README

**Files outside my list, and why:**
- `ship-spec.js`: the geometry search lives beside `hullGeometry` so `hull-bodies.js` can use it without pulling in the aircraft modules.
- `hull-bodies.js` (+5 lines): tags the engine's root collision part on each vehicle's collision description and hands it to the drive at boarding.
- `world.js` (1 line): passes `submarineData` through.
- `world-vehicle-tick.js`: land branch only, away from the air branch.
- `tracked-vehicle.js`: exports `measureWheelRadius` and puts tanks on the sea bed too.
- The world ship-pitch test harness and its Python test: one new scenario.
- I also added the world damage harness and its test (`world_damage_harness.mjs`, `test_world_damage.py`) as new files.

**Docs:** new ledger rows COL-13, PHY-16 and HP-18, PHY-3 corrected, new symbols recorded, short notes in three engine subsystem docs, and a dated section in `features/viewer-ground-hull-collision/README.md`. For `features/desert-combat-parity/README.md`, the package's rows are: G1, G2, CW2, CW10 and CW11 done; G5 closed as the engine's own behaviour.

**Assets:** none to re-extract.

**Still open:**
- **The most important one:** any land vehicle driven into a terrain face of 55° or steeper is launched at very high speed (M1A1 716 m/s, Willys 84; identical on `main`). The drive meets terrain only through its springs, with no hull-vs-terrain collision. Underwater banks are often that steep, so it is easier to hit now that vehicles sit on the sea bed.
- The critical-damage bleed still uses flat per-second ticks rather than HP-17's whole-bank bill.
- The engine's per-tick water collision damage (COL-4's water arm) is still not applied in the body world.
- Crew suffocation is billed but has no death path; no land vehicle in vanilla or Desert Combat (DC) triggers it.
- Submerged wheel friction: the page uses water's 0.1, while ships on the bed use the bed's own material. Which one the engine uses is unread.
- `TrackedVehicle` still takes its inertia from the wheel footprint rather than the engine's geometry box.

**For other packages:** the Forklift is classified as a sea vehicle (`VCSea`) when parking, which belongs to spawner-pads. There is also no BRDM-2 on Al Khafji to test swimming against.

The full DC drive and swim numbers are in `~/.cache/dc-sweep/ground-chassis/drive_dc_g1.json`.