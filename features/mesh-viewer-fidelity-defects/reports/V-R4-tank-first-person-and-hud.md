## Verdict summary

11 confirmed, 1 corrected, 0 refuted, 0 unverifiable (among rows marked confirmed/corrected). Safe to plan against for cockpit mesh, independent 800×600 stretch, soldier-in-vehicle HUD, and Sherman static ammo words; keep IconLookRotation and CrossHair RGB defaults open.

## Per claim

| # | Claim (abbreviated) | Verdict | What I found |
|---|---|---|---|
| 1 | Riveted frame = `ShermanCockpitInternal` → `1P_Sherman_Gunner_M1` via `DistCompareSelector` / `addLodComparison 0.5` | CONFIRMED | Parsed `Objects/Vehicles/Land/Sherman/Objects.con`: `lodShermanCockpit` adds External then Internal; `shermancockpitSelector` is `DistCompareSelector` with `addLodComparison 0.5`; Internal geometry `1P_Sherman_Gunner_M1`. `reaches_first_person(library,"Sherman")==True` (also PanzerIV/Tiger/Corsair). |
| 2 | `--cockpit` asset exists; no extractor change | CONFIRMED | `viewer/models/Sherman.cockpit.glb` on disk; `Sherman.cockpit.report.json` has `cockpitSwaps: ["lodShermanCockpit: ShermanCockpitInternal replaces ShermanCockpitExternal"]`. |
| 3 | Eye at `ShermanCamera` `(-0.304,0,0.06)`; cockpit child `(0.234,-0.019,0.14)`; `vehicleFov` 0 → skip; world FOV | CONFIRMED | CON: under `ShermanGunBase`, `setPosition -0.304/0/0.06` follows `addTemplate ShermanCamera`; under `lodShermanCockpit`, `0.234/-0.019/0.14` follows Internal. No `vehicleFov`/`zoomFov`/`useScope` on Sherman. lnxded PCO ctor `0x083194a0`: `esi=0` → `mov %esi,0x248(%ebx)`; `getVehicleFov` `flds 0x248(%eax)`. `Camera::setVehicleFOV` `0x081aadd0` fucom-equals-zero path skips apply. (Runtime world FOV after `VideoDefault.con` is 1 rad ≈ 57.3°; RenderView ctor default is 60° — report’s “~57–60°” guidance is fine.) |
| 4 | Ortho 800×600; menu root 800×600; no letterbox | CONFIRMED | Raw client at `0x006021f0`: vtable+0x40(1), near `0.01`, far `1.0`, ortho W/H imm `0x44480000`/`0x44160000` (800/600). `FUN_008086c9`: `m00=2/w`, `m11=2/h`. `FUN_00603770` → `FUN_007eb4f0(w,h)` with size (w,h) and origin (−w/2,−h/2); call site pushes `FUN_00603770(0x44480000,0x44160000)` at `0x0045edf0`. Full-FB viewport + that ortho ⇒ independent stretch. |
| 5 | Formula `x·W/800` etc.; capture at 2542×1440 matches | CORRECTED | Arithmetic and predictions match: HP `(174,525)` → `(552.9,1260)` indep vs `(728.6,1260)` letterbox; crosshair `(400,300)` → `(1271,720)` rgb `(234,38,33)`. **Corrections:** (a) crosshair centre is identical under letterbox and indep on this aspect ratio (both map to screen centre) — it does not discriminate; (b) at y=1260 brightness **drops** into a black bar edge near x≈546 (matches indep), it does **not** “rise at x≈550–560”. Crop of left HUD shows soldier icon + vehicle HP + Sherman icon + blue local dot in the indep band, not at letterbox x≈729. Formula itself stands. |
| 6 | No HUD element exempt from 800×600 space | CONFIRMED | Layout groups (soldier, vehicle, ammo, crosshair, minimap via MEME-13) all authored in 800×600; single ortho path above. |
| 7 | Viewer landscape stretch OK; portrait letterbox wrong vs engine | CONFIRMED | `hud.js` `_scaleFor`: `W/H < 1` uses uniform letterbox; landscape uses `W/800`,`H/600`. Engine always independent stretch. Residual stage/CSS note remains inferred (not re-measured). |
| 8 | Soldier HUD stays live in vehicles; viewer blanks it | CONFIRMED | `SoldierHud::reset` `0x006e9570` zeros `+0x14` (pose) and restores icon string; no write to `ShowSoldierIcon`. Layout gates `soldierIcon` on `ShowSoldierIcon==true`. Capture left HUD: standing soldier sprite beside vehicle HP + tank icon. Viewer `updateSoldierHud` sets `ShowSoldierIcon = onFootActive` and `return`s when seated — defect matches. |
| 9 | Sherman root: 2 icons; cannon mag 30 reload; coax 400 heat; `c_PIAltFire` | CONFIRMED | Root Objects.con: `NumberOfWeaponIcons 2`, `ABAmmoBarReloadBar` + cannon icon, `ABAmmoBarHeatBar` + bullet icon. `Weapons.con` `magSize 30`. Coaxial Objects.con `magSize 400`, `setInputFire c_PIAltFire`, heat words. Capture ammo crop shows **400** on secondary; bars present. |
| 10 | Live ammo/heat/reload must come from driver FireArms; viewer only feeds `mannedActive()` | CONFIRMED | Registrars `0x006e8d70` (`PrimaryAmmoText`/`SecondaryAmmoText`/…) and `0x006ee610` (`ReloadTime`*). `feedVehicleHud`: `nodes = mannedActive() ? … : []` — drivetrain path leaves texts/heat/reload null. |
| 11 | `setHasTurretIcon 1`; dial angle open | (partial — not scored) | Objects.con has `setHasTurretIcon 1`; `ShowTurretIcon` registered in `0x006d6500`. Angle/unit unread — as report says. |
| 12 | `CHTCrossHair` → type 2; red in capture; default RGB open | CONFIRMED (type) | Root `setCrossHairType CHTCrossHair`; VHUD-5 maps to 2. Capture centre red `+`. Default RGB ints not re-traced — open as stated. |
| 13 | Local seat → Occupied state 1; blue dot in capture | CONFIRMED | VHUD-2 table: state `1` = `Icon_vehicledot_local.tga`. Capture: blue dot on Sherman icon. Live selector still open. |
| 14 | `C` cycles view modes | (inferred — not scored) | Not re-derived; do not block plan. |

## Load-bearing inferences

- **ShowSoldierIcon stays true only because reset never clears it** (no positive writer on vehicle entry found). If a hidden path forces false, fixing the viewer’s early-return alone would not match retail — but capture already shows the soldier group, so the implementer outcome is still “keep feeding soldier HP/icon while seated.”
- **IconLookRotation unit/sign/pivot** (claim 11): feeding `ShowTurretIcon=true` without a verified angle will draw a wrong dial; leave unfed until settled.
- **CrossHair RGB defaults**: type 2 + ShowCrossHair is enough to get *a* crosshair; wrong defaults only affect colour.
- **Why cockpit glb exists but mesh capture lacks interior**: viewer graft/`setFirstPerson` diagnosis — not an extract gap; do not re-open `--cockpit`.

## Anything the report missed

- On 16:9, **screen-centre** samples cannot prove independent stretch vs letterbox; use a non-centred rect (vehicle HP x, ammo panel). Report’s formula is still right; one piece of its capture evidence was overstated (corrected in #5).
- Secondary **400** is clear in the capture; I did not separately OCR a primary **30** digit in the ammo crop (icons/bars are there). Static CON declaration of 30 remains solid.
