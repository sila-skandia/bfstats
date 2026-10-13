# Re-extract evidence: what the 2026-10-10/11 exporter fixes change outside FH

Measured 2026-10-11 against code frozen at `f06b678f`. BEFORE is the live tree
(main checkout `viewer/{models,maps,textures}`) drawn by the current viewer;
AFTER is a scratch extract with the frozen code, drawn by the same viewer
(`?ov=1` overlay server on :5340). Nothing here touched a live tree or published.
Scratch (images, json, scripts): the session scratchpad `.../scratchpad/ab/`
(`pairs/*.png` side-by-side + 6x amplified diff, `diffs.json`, `cmp_*.json`).

## Read this first: what earlier reports got wrong

| Earlier claim | Measured | Verdict |
|---|---|---|
| Alpha floor: vanilla 76 glbs / 141 materials, XPack1 12, XPack2 32 | Old vanilla tree: 20 glbs / 31 materials, **all** stale `.kit.glb` names or `poses/*` carrying a 2 % alpha-0 gun texture. Re-extracting 332 vanilla model glbs, 2 levels (el_alamein, wake) and 83 kit glbs: **0** materials change mode; the old scenes of all 23 vanilla levels hold 0 affected materials. XPack1/XPack2: **0** glbs. | Wrong. Vanilla/XPack alpha floor is NONE. |
| NaN UVs: vanilla 40 | Vanilla, XPack1, XPack2: **0** glbs with a NaN TEXCOORD (models and scenes). | Wrong. |
| Static-gun stamp: Nebelwerfer-class displacement in other trees | Vanilla/XPack1/XPack2: **0** templates would gain the stamp (their stationary guns write `hasMobilePhysics 1`). DC/DC Final/EoD: 8/10/25 templates would gain it, but **0.00 m** displacement in 8 viewer runs including EoD's EoD_M2A1/Quad50/ZPU2 which are bodies. Nebelwerfer was already fixed by `fbded906` (2026-10-10); FH was re-baked then. | Not reproduced outside FH. |
| Spelled-extension / missing-quote: FHSW SU76 + 17 levels | The defect is 4 hand-typed `.rs` files in FH/FHSW (`su76m_barrel`, `su76m_gun`, `stug3g_whelrear_right`, `pega_treeline01`). The chain `.rs` scan finds **0** such lines for vanilla, XPack1/2, EoD, DC, DC Final. | FH/FHSW only. |
| Viewmodel rest: FHSW 96, EoD 8, DC Final 6, XPack1 6, XPack2 6, DC 4, vanilla 8 | By bound-part rest vs bundle skeleton (>2 cm): FHSW 23 weapons (44 of 1640 rigs), EoD 1 weapon (SLR, 1 rig), all others **0**. The 219 vanilla rigs re-exported are animation- and rest-identical. | Wrong counts; vanilla/packs/DC NONE. |
| Flag swap: XPack1 5, XPack2 1, EoD 7, FHSW 27 | Re-measured from the game files: XPack1 5, XPack2 1, EoD 7 (6 real nations + 1 sign mesh), FHSW 27, vanilla/DC/DC Final 0. | Confirmed. |
| Rocket motors: vanilla/packs gain samples | Exactly two scripts (Katyusha rocket flight, torpedo flight) and 2 new mp3s. | Confirmed, narrow. |

## Fix x tree table

Status: VERIFIED-DEFECT (reproduced in the current viewer with the live bake),
ALREADY-FIXED, NOT-REPRODUCED, NONE (no asset changes). "M" = measured now,
"I" = inherited (only FHSW counts that were not re-rendered).

| Fix | vanilla | XPack1 | XPack2 | EoD | DC | DC Final | FHSW |
|---|---|---|---|---|---|---|---|
| 1 alpha floor (3f83aa8f) glbs / materials in the live trees (M) | 0 models, 0 scenes; 20/31 stale kit+pose, 2 % texels. **NONE** | 0 / 0. **NONE** | 0 / 0. **NONE** | 799 glbs / 3395 mats (237 scenes, 195 models, 274 viewmodels, 76 poses). **VISIBLE (small objects)** | 229 / 968 (35 scenes). **VISIBLE (FlagBox), rest NEGLIGIBLE** | 289 / 1330 (48 scenes). same as DC | 3450 / 5204 (I for render; M for count) |
| 2 static stamp (fbded906) templates gaining stamp (M) / max displacement (M) | 0 / 0.00 m (el_alamein, wake). **NONE** | 0 / 0.00 m. **NONE** | 0 | 25 / 0.00 m (valley_of_death, berlin). **NOT-REPRODUCED** | 8 / 0.00 m (el_alamein, before and after). **NOT-REPRODUCED** | 10 / 0.00 m (dc_oil_fields). **NOT-REPRODUCED** | not run |
| 3 NaN UVs (01ecafce) glbs (M) | 0 | 0 | 0 | 86 models / 313 incl. scenes; M3A1 etc. **NEGLIGIBLE** (see below) | 60 / 95. NEGLIGIBLE | 70 / 117. NEGLIGIBLE | 357 / 9592 (27 degenerate-only) |
| 4 spelled ext / missing quote (27fcc8bc, rs.texture_refs) (M) | 0 lines | 0 | 0 | 0 | 0 | 0 | 4 `.rs` files (shared with FH) |
| 5 flag whole-mesh swap (149f7bd1) levels naming non-atlas cloth (M) | 0 | 5 (anzio, baytown, husky: Italian; cassino, santo_croce: French). **VERIFIED-DEFECT** | 1 (essen: Italian) | 7 (3 French, 3 Polish, 1 sign mesh). VERIFIED by the same code path | 0 | 0 | 27 |
| 6 rocket/torpedo flight sound (3e43b4c8, f9553031, dbbe3e66) (M) | gain 2 scripts + 2 mp3. **VISIBLE (audible)** | same | same | not run | not run | not run | not run |
| 7 viewmodel rest (93f37cb3, 28c09c5c) weapons / rigs differing (M) | 0 / 0 of 219 rigs. **NONE** | 0 of 32 weapon rigs | 0 of 37 | 1 / 1 (SLR). NEGLIGIBLE | 0 of 33 | 0 of 43 (muzzle-emitter node deltas from another commit, no clip change) | 23 / 44 of 1640 (positive control: FH 7 weapons) |

Also found: **8dc4c985 (RLE TGA rows read as stored)** touches 0 mesh textures in
vanilla, XPack1/2, DC, DC Final; 1 in EoD (`eod_loach_soar_windows`), 8 in FHSW
(`tracklight_o*`, crosshairs, prop blur). Measured by scanning every texture a
shader names.

## History check (does an earlier commit already cover it)

- Static stamp: the stamp for roots that wrote `hasMobilePhysics 0` or carry an
  Engine landed `5d6365fe` (2026-10-06) and `01f202c6` (2026-10-07); ledger
  PHY-16/PHY-17, `42735e35` (2026-10-07) records that a root that never writes
  the word is static in the engine. The viewer reads only the stamp
  (`hull-bodies.js` `isStaticRoot`); there is no viewer-side default for an
  unstamped root. `fbded906` (2026-10-10) is the last step and fixed FH's
  Nebelwerfer; outside FH nothing reproduces the symptom.
- Alpha: no earlier commit; the viewer sets `alphaTest` only from the material
  (`level-shading.js`), so an opaque material with cut-out texels was drawn in
  full. SM-15 in the ledger is the 2026-10-11 row.
- NaN UVs: first handled `01ecafce` (2026-10-11); no viewer-side guard.
- Flags: `13ebfc7f`/`151a1d33` (2026-09-20) made an unmapped nation draw no
  flag rather than a wrong one, which is the OLD behaviour shown below; the
  `_1` second-mode name fix in `149f7bd1` is viewer-only and needs no re-bake.
- Rocket motors: `e218aae0` (2026-10-10) already shipped looping round scripts
  (the bazooka's four loops are in the live table); `3e43b4c8`, `f9553031`,
  `dbbe3e66` (2026-10-11) add the Katyusha/torpedo ones.
- Viewmodel rest: `10031284` (2026-10-10) and `7f5b1346` (2026-10-07) are other
  rig fixes; EoD's K98/M40 reload clips also differ from the live tree
  (rotation delta 0.85) and that comes from a commit **before** `93f37cb3`
  (reproduced with the exporter at `27fcc8bc`), i.e. the EoD viewmodels tree is
  stale for unrelated reasons.

## Evidence per fix

### 1 Alpha floor (pixel diffs, 3 fixed views, 900x700 canvas)

Changed-pixel share of the canvas / mean abs diff (0-255) / share of object
pixels. Control (same glb twice) is exactly 0. `pairs/<mod>.<name>.v{0,1,2}.png`.

| Asset | tree | changed px | MAD | verdict |
|---|---|---|---|---|
| Sherman, M3A1, Tiger | vanilla | 0.000 % | 0.000 | NONE (control) |
| FlagBox | DC | 4.4-5.2 % | 1.4-1.9 | VISIBLE: solid slab becomes a wire cage (27 % of the object's pixels) |
| air_hangar_bunker_SU_des | DC | 0.00-0.19 % | <0.09 | NEGLIGIBLE (window texel cut-outs; 341 m^2 whole texture has alpha-0 texels but only a strip is visible) |
| Sherman, M3A1, Shilka (tracks, wheels) | DC | 0.02-0.11 % | <0.02 | NEGLIGIBLE (track links, sub-pixel at this scale) |
| air_control_tower_des | DC | <0.005 % | 0 | NONE |
| EoD_Loc | EoD | 9.2-10.0 % | 1.8-2.1 | VISIBLE: black rail/handrail slabs removed |
| IL-28 | EoD | 1.5-2.0 % | 0.2-0.26 | small but visible (tail/wing glass) |
| C47 | EoD | 0.02-0.03 % | 0.03 | NEGLIGIBLE |
| K63, T62, M10 | EoD | 0.00-0.02 % | 0 | NONE / NEGLIGIBLE (track links) |

Levels (re-baked with frozen code, one per tree): vanilla el_alamein and wake:
material modes identical (0 flips), 0 stamp changes. DC el_alamein: 29 materials
flip OPAQUE->MASK (Chi-Ha/Sherman tracks, M1A1 rack, DPV hull, RiBro body ...).
EoD berlin: 11 flip (Berlin_Galler, buildings, `0_CL_box01`, M60 mount, tracks).
XPack1 cassino: 0 flips. The material area that is alpha-0 is hundreds of m^2 per
level (EoD scene median ~650 m^2, camouflage nets `greencammo_m1` in 130 levels,
crates `0_CL_box*` in ~40, rice and driftwood props).

### 2 Static stamp

`__bodies()` before/after a 5 s simulated settle (50 frames at dt 0.1).
No displacement at all (max 0.00 m) in: vanilla el_alamein (28 bodies, before and
after), vanilla wake (17), XPack1 el_alamein (28), DC el_alamein (31, before and
after the re-bake that stamps SA-3, Stationary_Browning, AA_Allies, ZPU-4,
flak38), DC Final dc_oil_fields (42), EoD valley_of_death (40, includes EoD_M2A1,
EoD_Quad50, EoD_ZPU2, M125Mortar), EoD berlin (2, before and after). Positive
control not available (FH's live tree is already stamped; `fbded906` documents
9-13 m on Gold Beach). **Caveat:** the guns in DC el_alamein are not bodies in
the live viewer at all; the stamp matters only where a gun has spring-like
parts (FH's Nebelwerfer trail legs). DC FlagBox gains the stamp too
(PlayerControlObject, no Engine); it is never a body either.

### 3 NaN UVs

M3A1/Sherman/PanzerIV/air_control_tower in DC and EoD carry NaN on RiBro
bodies (2 primitives per glb). Rendered before/after (`M3A1`, `Sherman`, DC):
0.02-0.11 % pixels differ, i.e. the affected triangles are not visibly smeared in
this renderer (Chromium/Vulkan samples texel (0,0)). NEGLIGIBLE; correct on other
GPUs is not measured.

### 5 Flag swap (VERIFIED-DEFECT, XPack1 cassino)

Human on the Allies/French side captured FIRST_LINE_OF_DEFENSE (team 1 -> 2) by
standing in the zone 22 s, current viewer, live bake vs re-bake:
`pairs/flag_cassino_b.png`. BEFORE: the point's only cloth is the German mesh,
still visible with the German atlas cell (`uvCell` 0.438,-0.734..): the flag
stays German after a French capture. AFTER: the German cloth is hidden and
`flagfr_m1` (`flagClothAlt`, teams [2]) shows: tricolour. Bake cost of the fix:
+8 cloth meshes per level (cassino scene.glb only a few hundred KB larger). Vanilla levels re-baked (el_alamein, wake)
gain 8 and 13 alt cloths and the neutral-point anchors (2->5, 7->10) with no
visible difference because no vanilla nation is outside the atlas.

### 6 Rocket / torpedo motor sounds

Live `_shared/effects.sounds.json` vs `extract_effects.py --sound-only`: only
`katyusharocketengine.ssc#flight` and `torpedengine.ssc#flight` (bundles
`katyusharocket`, `torpedo`, `aircrafttorpedo`) are added, identically for vanilla,
XPack1 and XPack2; new samples `trpfire3.mp3`, `trpfire4.mp3` (the Katyusha
reuses `flaksmall.mp3`, `rcktlp1.mp3`). The page's own `audibleAt(layers, d)`
(`effect-audio.js`): Katyusha 0.655 at 100 m (0.900 at 20 m), torpedo 0.727 at
100 m; before: no script, **0.0** (silent). The vanilla bazooka round already
plays (script present). Not measured through `__effectAudio()` in a browser
(no Katyusha/torpedo firing harness run). Levels: Kharkov and Kursk
(Katyusha), Wake/Midway/Philippines (SBD-T torpedo). Cost: one JSON + 2 mp3,
no bake. (Three listed commits cannot be told apart by the table diff; the whole delta is these two scripts.)

### 7 Viewmodel rest

Data comparison of every re-exported rig (animation samplers and node rests):
vanilla 219/219 identical; XPack1 32, XPack2 37, DC 33: 0 differ. DC Final: 5
differ only in muzzle-emitter node transforms (not the fixes). EoD: 8 of 76
differ: SLR magazine (idle `slr_mag` rotation delta 0.51, a real 28-clip change
from `28c09c5c`; weapon template skeleton differs from the bundle's by 119 deg and
29 cm) and K98/M40/Walther reload bones (older commit). Not rendered: the rig
page needs a spawn; the SLR is 1 rig of 295.

## Recommendation

Cost basis: vanilla ~5-9 min per level (Wake measured 9 min under load), packs
~15 min, EoD ~1.5 h full, FHSW hours; models are 3-4 s per template.

| Tree | Re-extract | Skip |
|---|---|---|
| vanilla | **sound tables only** (`effects.sounds.json` + 2 mp3, seconds, small). | models, kits, viewmodels, levels: byte-for-byte equal in every measured respect |
| XPack1 | sound tables; **5 levels** (anzio, baytown, husky, cassino, santo_croce), ~75 min; each publish is a full scene.glb (~20-35 MB) | models, kits, viewmodels, other 24 levels |
| XPack2 | sound tables; **essen** (~15 min) | everything else |
| DC | models: FlagBox (+ FlagBox wreck) and, if you want glass/ladders correct, the 128 model glbs with a cutout material (minutes); level **dc_medina_ridge** only (the one level whose scene holds FlagBox, ~15 min) | viewmodels, kits, sound, other levels (alpha gain is track links) |
| DC Final | same as DC (FlagBox, dc_medina_ridge) | the rest |
| EoD | affected model glbs (105 templates, ~30 min) and the 237 scenes only if the crate/net/prop cut-outs matter: ~1.5 h x ~0.6 = most of a full pass, 38 MB-65 MB each; **at least** the 7 flag levels (battle_of_dien_bien_phu, baytown, h_mong, ho_chi_minh_trail, laos_boundary_dispute, na_san, operation_enoggera) | viewmodels except SLR (1 rig), stamps (not reproduced) |
| FHSW | not re-measured visually here; by count the fixes apply (3450 glbs alpha, 357 NaN, 27 flag levels, 44 rigs, 4 `.rs`): treat as the FH precedent and run the pipeline | nothing proven NEGLIGIBLE |

Honest summary: for vanilla, XPack1 and XPack2 the exporter fixes of 10-10/10-11
change **nothing a player can see in models, kits, viewmodels or the two levels
re-baked**; the only real items are the Katyusha/torpedo flight sound table and
the French/Italian flags on 6 pack levels. Desert Combat gains one object
(FlagBox cage). EoD gains cut-out props and the Polish/French flags.
