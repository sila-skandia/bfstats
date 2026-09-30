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

## 2026-09-30: interiors that draw nothing, and interiors that are a place

Two Desert Combat defects of the same graft, settled against the engine in the
ledger's LOD section (LOD-1..LOD-4).

**An interior with no mesh is still a swap.** DC's M1A1, T72 and Shilka name a
gunner interior (`1p_M1A1_Gunner_m1`) whose `GeometryTemplate.file` line is
commented out ("Todo, make M1A1 Cockpit"); the SCUD-B's `.sm` ships nowhere, and
the BRDM2's `1P_BRDM2_Str_M1` wheel likewise. EoD's Chi-ha names a geometry no
script creates. The engine builds that alternative anyway, with no geometry
(LOD-4), and the Inside view selects it (LOD-2), so first person hides the
exterior half and draws nothing. The cockpit export dropped the empty wrapper
and wrote a bare root, so the viewer grafted nothing and kept drawing the turret
face at the camera. `build_node` now keeps a wrapper that carries a
`lodAlternative` stamp; the viewer's `CockpitSwap` already hides `replaces`
with an empty interior.

**An interior can be first person by where it is drawn.** DC's
`AC-130_Howitzer_Cockpit` puts the `AC-130_Sight_Internal` reticle pane ahead of
a meshless `AC-130_Sight_External` under a 1 m `DistanceSelector`. The engine
draws the pane only for a camera within a metre of it (LOD-3), which is the
gunner's eye; the ordinary export took the near rung as it does a building's
interior and the viewer drew a green pane in front of every AC-130, Stryker and
DC Final AH-64. `near_rung_is_first_person` makes the near rung of a
`DistanceSelector` whose first distance is at most `NEAR_RUNG_FIRST_PERSON_M`
(2 m, our number) the first-person half, but only where no alternative is named
`1P_`: the name keeps deciding where it exists (EoD's Katyusha wheel is authored
far-rung first). Everything under such a rung belongs to the cockpit export
whatever its meshes are called (`build_node`'s `first_person_branch`).

What moved:

* DC and DC Final: every `.cockpit.glb` of M1A1, T72, SCUD-B, Shilka, BRDM2,
  BRDM2_Spandrel (and DC Final's SA-9_Gaskin) now carries its swaps; AC-130 and
  Stryker lost the pane in their ordinary exports and gained a cockpit glb that
  carries it for the gunner's seat. DC Final's AH64 needs the same re-extraction
  (a helicopter, sequenced separately), and the DC level scenes that place these
  hulls bake the old pane until their scene layer is re-baked.
* Vanilla, XPack1, XPack2: no output moves.
* EoD: the Chi-ha, PanzerIV and monster_gaz cockpit glbs gain their swaps.
* FH and FHSW: 95 and 158 LodObjects (control sticks, pedals, throttles, gun
  sights at 0.1-1.8 m) change sides, so their
  ordinary and cockpit exports and level scenes move on the next bake.

Checked with `tests/test_assemble.py` (`CockpitExportTests`), and in the browser
(Playwright, DC Final's 73 Easting): before, entering an M1A1, T72 or SCUD-B
grafted nothing (`__cockpitReady()` false) and the exterior stayed drawn in the
cockpit view; after, the swap grafts, the entered hull's `M1A1CockpitExternal`,
`T72CockpitExternal` and `SCUD-BExterior` hide in the cockpit view and show again
in the chase view. The pre-fix glbs were served through `page.route` for the
before run.
