## Verdict summary
24 confirmed, 1 corrected, 0 refuted, 0 unverifiable (plus X1-14 left as inferred). Safe to plan against for D1–D4 viewer fixes; only naming/summary nits, not load-bearing formula errors.

## Per claim
| # | Claim (abbreviated) | Verdict | What I found |
|---|---|---|---|
| X1-1 | Wake statics 20542; scene.json 6176/83 parts | CONFIRMED | Recheck `__collision().statics` = 20542; `viewer/maps/wake/scene.json` `objects.collision` = 6176 tris / 83 parts. Bridge sha MATCH. |
| X1-2 | Tree owners only `Pacific_Palm_4_M1`×5 = 95 tris; 0 TreeMesh palms | CONFIRMED | Independent headless recount: five Palm_4 variants ×19 = 95; no `Pacific_Palm_large_*` / `PALMHIGH` in statics. |
| X1-3 | Assembler returns `[]` for treemesh; `_skip_collision` discards hull | CONFIRMED | `assemble.py:627–632` early-returns on `kind == "treemesh"`; `treemesh.py:166–191` advances past `CID_SimpleCollisionMesh` without exporting. Geometries.con: `GeometryTemplate.create TreeMesh Pacific_Palm_large_1_M1`. |
| X1-4 | Palm `Pacific_Palm_large_1_M1` at `[1365.34,116.129,-771.936]`, owner 612 | CORRECTED | Position and id 612 match; scene node name is `Pacific_Palm_large_1_M1_21` (geom/template `Pacific_Palm_large_1_M1`). |
| X1-5 | Horizontal cast from 5 m west misses palm; hits farm t≈9.76 | CONFIRMED | Recheck: hit t=9.759…, owner 590 `pacificfarm1_m1_4`, mat 113. |
| X1-6 | Walk +W through palm; `blocked=false`; sweep miss | CONFIRMED | Evidence walk x 1361.84→1369.79, contacts 0; `sweep` null. |
| X1-7 | Shot hits farm/`RichoWoodDecal`, not palm | CONFIRMED | Evidence hit owner 590, effect `RichoWoodDecal`. |
| X1-8 | Palm_4 cast at one instance `hit: null` | CONFIRMED | Evidence `palm4Cast.hit` null despite 19 tris in index. |
| X1-9 | Scout No4 / FOV 57.3 world, near-pass 26.93 (`fov1p=0.47`) | CONFIRMED | Recheck hip: worldFov 57.3, nearPassFov 26.929…, fov1p 0.47; loadout No4Sniper. |
| X1-10 | `?fov1p=world` equalizes near to 57.3 | CONFIRMED | `x1_b2_fovworld.json` `nearPassFov: 57.3`. |
| X1-11 | After shot, clip=`fire` ≥20 frames via `cool` hold | CONFIRMED | 20/20 capture frames `clip=fire`; `map.html:5315–5320` `hw.active==='fire' && hw.cool>0`. |
| X1-12 | Flash ~21–29% of 800 px width, frames 0–4, gone by 5 | CONFIRMED | `flashOrange.flashFrac` 0.206–0.291; zero from f=5. (Summary’s “12–29%” is wrong for this metric.) |
| X1-13 | Bullet+`aimRay` → dim `#spawnTracer(...,false)`; `#muzzleVelocity` uses eye ray | CONFIRMED | `gunfire.js:545–554`, `577–594`, `637–678` (`shellMaterial` when `!bright`); `map.html` sets `aimRay` when `fireInCameraDof`. |
| X1-14 | Live tracers often empty; `__getFire().groups` = vehicleGuns only | CONFIRMED as diagnosis of instrumentation (report marked inferred) | `map.html:7572–7574` maps `vehicleGuns` only; capture `afterTracers: []`. |
| X1-15 | Rig parent `viewmodel root` → Scene (near pass) | CONFIRMED | Evidence `hip.rigParent === "viewmodel root"`. |
| X1-16 | Sherman → `TrackedVehicle` (ratio 4, mass 25000, …) | CONFIRMED | `driveClass` matches cited fields. |
| X1-17 | 3 s W: vf→9.25; throttle surface→1 by t=0.2 | CONFIRMED | `surfaces.throttle=1` at t=0.2; vf sequence matches cited checkpoints; final vf≈9.25. |
| X1-18 | fireArms 30/400; `mannedActive: false` on driver | CONFIRMED | Occupancy dump matches. |
| X1-19 | `mannedActive` skips FireState ammo feed | CONFIRMED | `map.html:3839–3841`, `4002–4022`; vars lack `Ammo/*AmmoText` despite fireArms counts. |
| X1-20 | Scale sx=1,sy=0.75; health `[174,525,32,64]` → y≈393.8 | CONFIRMED | Scale and layout rect verified; device y=393.75. |
| X1-21 | Drawn vehicle icon/health/ammo panels; culled AmmoText + soldier | CONFIRMED | `drawnRelevant` / `culledRelevant`; `Soldier/ShowSoldierIcon=false`; Primary/SecondaryAmmoText missing. |
| X1-22 | Cockpit internal/gunner meshes visible; external hidden; viewMode cockpit | CONFIRMED | `named` visibility + `viewMode: "cockpit"`. Wedge=that mesh remains attribution, not pixel proof. |
| X1-23 | Zoom FOV 57.3→~5.73, fovFactor→0.6, 0.7/0.3 ease | CONFIRMED | `map.html:5552–5555` / `5568`; zoomCurve settles ~5.73 / 0.6. |
| X1-24 | Zoomed: zero `CrossHair/*`; 14 leaves culled; sniper 256×256 | CONFIRMED | Recheck: zoomed, fovFactor 0.6, `crossKeys=[]`; all 14 `culledForMissing`; sprite 256×256 complete. |
| X1-25 | `hud.js:505` says nothing writes `CrossHair/*` | CONFIRMED | Comment at 502–506; viewer-wide grep: no `CrossHair/` writes outside that comment. |

## Load-bearing inferences
- Floating-bullet attribution to eye-line dim tracer (X1-13 path is code-confirmed; live tracer list empty so visual persistence not re-sampled). If retail never draws that stand-in, the fix is hide/relocate, not hit-test origin.
- Cockpit “black wedge” = `ShermanCockpitInternal` / `1P_Sherman_Gunner_*` (visibility confirmed; not pixel-matched to capture). Wrong mesh/extract would mis-target the fix.
- Soldier HUD in tank should be shown (retail claim) — viewer gate is confirmed; retail requirement is out of this report’s evidence.

## Anything the report missed
- Summary flash “~12–29%” conflicts with finding X1-12’s orange 21–29% (luminance `flashL` can be ~2–12%; do not mix metrics).
- Palm instance naming uses `_21` suffix in the live scene graph; geom/template name is what assemble keys on.
