# Handoff: Desert Combat vehicle defects reported 2026-10-09

Owner's report, DC Wake on play.bfstats.io:

1. Bail out of an aircraft and it hangs at its position in the sky. Vanilla
   planes on the same site cruise on and eventually crash (retail behaviour).
2. The AV-8 that spawns beside the large helicopter on the Nimitz has no
   missiles on its wings. Retail DC shows them.
3. In the AV-8 cockpit the HUD is blurry; in the plane the HUD is missing.
4. The helicopter at the back of the Nimitz does not spin its rotors.

## Question answered: does a mod inherit the engine?

Yes. Physics, animation, the cockpit swap and HUD drawing are code in
`BF1942.exe`; a mod ships only `.con` data and assets. DC inherits all of it.
Where the viewer's assumptions break is the data vocabulary: DC writes words,
spellings and combinations vanilla never used (CW1 `setGeometry`, `holdObject
0`, `hasMobilePhysics 0`, `c_PGFDummyGrip`). `sweep/reports/adv-modsystem.md`
checked path, texture, sound and HUD fallbacks and found them right; the gaps
were in what the exporter reads. One real divergence from the engine: viewer
fallbacks are two-level (mod, then vanilla), not the mod's `init.con` chain
(MS-10), harmless today.

## Findings per item

1. **Bail-out.** `viewer/world-vehicle-tick.js` `assignIntegrators` only
   integrates hulls with an occupant. `vehicle-instance.js` `#vacate` zeroes the
   root seat's inputs. `hull-bodies.js` `releaseDrivenBody` ->
   `world-bodies.js` `releaseDriven` hands the vacated hull to the parked
   rigid-body world with its velocity, no lift. Only destroyed hulls keep
   flying (`vehicle-wrecks.js`, `world.falling`). The owner says vanilla planes
   cruise on in the viewer, so a vanilla path exists that DC's vectored
   airframes (`Aircraft.engineLaw`, PHY-12..14) or the Nimitz pad craft
   (`holdObject 0`, `spawned-craft.js`; `Nimitz_Static*` `hasMobilePhysics 0`,
   PHY-17) miss. An agent was briefed to find the mechanism, fix it in the
   viewer, add a node test (`tests/flight_harness.mjs`), and push to
   `claude/sharp-archimedes-q3vu81`.
2. **Missiles.** CW1 (`setGeometry` unread) was fixed 2026-10-06 (CON-15) and
   the 2026-10-07 asset pass re-baked the Nimitz decks. If still missing, the
   AIM-9 racks use a construct not yet read. Needs DC's `.con` data.
3. **Cockpit HUD.** The interior grafts (screenshot). DC cockpits were missing
   until WP4 (`inside_view_alternative`). The HUD glass is a texture on the 1P
   mesh; `optimise_mesh.py` is lossless, so blur or absence is most likely a
   material path (alpha or additive overlay) the exporter does not reproduce.
   Unverified; needs DC data.
4. **Rotor.** Engine rule: a meshless Engine's revs spin its RotationalBundle
   children, exported as `spinsChildren` (`bf42/assemble.py` ~3650). PHY-14:
   the engine idles only with someone aboard, so an empty helicopter's rotor
   is still in retail too. If it does not spin when boarded, the baked Nimitz
   node predates the field or DC drives it another way. Needs DC data.

## Blocker for 2 to 4

The cloud session has no DC archives: the `bf1942-binaries` release holds
only `game-bf1942.zip`, `game-xpack1.zip`, `game-xpack2.zip`. Either work
locally against the install, or package `Mods/DesertCombat` as
`game-DesertCombat.zip` per the `bf1942-game-archives` skill and upload it.

## Resolved (2026-10-09, local, against the install)

Items 2 to 4 are read and 2 and 3 are fixed; the record is the tracker's
"The owner's vehicle report of 2026-10-09" section in [README.md](README.md).
In short: the pad fields `AV-8A`, which no tree carried, and whose AIM-9s are
`visibleDummyProjectileTemplate`s the viewer never drew while loaded (FA-5,
built in `viewer/loaded-rounds.js`); the AV-8, F-16 and Su-25 canopies were
opaque white from a doubled quote in their `.rs`; the MH-53's rotor spins when
boarded and spools at DC's own 10 deg/s. Item 1 is the branch's Part 1.
