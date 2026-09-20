# Cockpit graft hosts (2026-09-21)

The owner's report: *"in most places, except for Wake allied the cockpit is
very broken. E.g. on Gazala both sides don't render the HUD (cockpit view)
correctly. It's this very strange distorted view."*

## What it was

The vehicle HUD and every working cockpit were innocent. What was missing was
the *interior* on a whole class of vehicles: the M3A1, the Priest, every naval
gun (Hatsuzuki, Yamato, Fletcher, Prince of Wales) and the Katyusha's steering
wheel had no first-person geometry at all, and the driver sat inside the closed
hull with its back faces culled away — world visible through invisible walls
around a few inward-facing fragments. That is the "very strange distorted
view". The Wake Sherman worked because it is the one shape whose cockpit
LodObject survives the ordinary export, so its interior grafted fine.

The graft has to land somewhere. `flight.js` `graftCockpit` matches the
cockpit glb's LodObject to the vehicle tree **by node name**: the wrapper node
(`lodPriestCockpit`) in the vehicle tree is the host, and the swap hides the
siblings the spec names. Vanilla, though, offers three shapes where the
ordinary export draws *nothing* inside the wrapper:

* The **M3A1 and the Priest** name *both* of their cockpit alternatives after
  the same first-person mesh — `M3A1CockpitExternal` and
  `M3A1CockpitInternal` both declare `ObjectTemplate.geometry
  1P_M3A1_Driver_M1` (the Priest's pair likewise). The fallback that swaps a
  picked `1P_*` alternative for a drawable sibling finds nothing, the
  selection stays on the 1P-named alternative, and the export refuses its
  mesh.
* The **naval guns** pair `ShipCockpitDummy` (no geometry at all) with
  `1p_shipgun_m1`. The selector picks the Dummy, the Dummy builds to nothing.
* The **Katyusha steering wheel** pairs `1P_Katyusha_Steer_M1` with a
  meshless low-LOD twin.

In all three the wrapper then had neither mesh nor surviving child, and
`build_node`'s empty-node rule pruned it whole. The scene and vehicle glbs
lost `lodM3A1Cockpit`, `lodPriestCockpit`, `lodShipCockpit`,
`lodShipCockpit2`, `lodKatyushaSteering` — the graft's hosts — and the swap
never existed. Measured across the 23 vanilla scenes before the fix: every
M3A1, Priest, ship and Katyusha instance was missing its cockpit wrapper.

## The fix

`bf42/assemble.py` `build_node`: a LodObject of the ordinary export one of
whose alternatives carries first-person geometry is kept as an **empty group**
even when nothing inside it is drawn. It is a graft host, not a visual part —
the cockpit export still owns the geometry, and the viewer still hides
whatever of `replaces` exists. Nothing else changes: wrappers that already
built children are untouched, buildings' `Interior`/`Exterior` pairs name no
`1P_*` mesh and are not affected, and the mesh reader still refuses 1P
geometry outside a cockpit export.

## Data regenerated

* `viewer/models/`: M3A1, Priest, Katyusha, Hatsuzuki, Yamato, Fletcher,
  PrinceOW re-extracted with `--cockpit --level-all --configuration-all` —
  every level variant and wreck carries the wrapper now.
* `viewer/maps/`: all 23 vanilla `scene.glb` re-extracted
  (`extract_maps_all.py -j 6`) and published with
  `scripts/publish-mesh-delta.py`. **The mods' level trees are still stale**
  (they predate even the seat-defects round's `crossHairType`); re-extracting
  them is the remaining work, unchanged from that round's ledger.

## Verification

* `tests/test_assemble.py`: two new tests — the M3A1 shape (both alternatives
  1P) and the ship shape (meshless Dummy beside a 1P mesh) — assert the
  wrapper survives with no mesh and no children, that the 1P mesh is never
  loaded by the ordinary export, and that the selection report is unchanged.
  Full suite: 2049 tests, green.
* Browser (`map.html`, Playwright, fixed spawn): before/after on Gazala —
  the Priest went from floating hull fragments to the 75 mm howitzer over the
  scuttle with seat dots and ammo panel; the M3A1 from see-through hull to
  its windshield frame. Wake's Hatsuzuki gun gained its blast shields and
  barrel; Kharkov's Katyusha gained its steering wheel and dashboard. The
  Sherman, Panzer IV, Hanomag, Willy, flak38 and BF109 re-shot unchanged.
