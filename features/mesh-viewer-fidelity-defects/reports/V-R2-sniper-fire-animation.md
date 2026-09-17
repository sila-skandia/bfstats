## Verdict summary
16 confirmed, 1 corrected, 0 refuted, 0 unverifiable. Safe to plan against for the fire→reload chain, invisible rifle projectiles, and 1P muzzle numbers; treat K98 shell attach as the corrected offset below.

## Per claim
| # | Claim (abbreviated) | Verdict | What I found |
|---|---|---|---|
| 1 | Fire→StandReload→_POSE_ via `addTransitionWhenDone`; PlayOnce morph 10000 | CONFIRMED | `animations/AnimationStatesShoot.con` L252–270 (`rem No4/K98 - Trigger reload after fire`). `parse_asm`: `Ub_FireNo4Sniper` `return_to=Ub_StandReloadNo4Sniper`, loop `c_AsmPlayOnce`, morph 10000; reload → `_POSE_`. Same for K98*/plain No4/K98 and lie variants. |
| 2 | Distinct 1P fire/reload clips; spans 1.0 s / 1.667 s | CONFIRMED | `1PFireNo4.baf` 11 frames, speed 1.0 → span `1/speed=1.0 s`; `1PReloadNo4.baf` 99 frames, speed 0.6 → `1.6667 s`. K98 1P fire/reload same speeds/spans. Duration is phase/`speed`, not frames/fps; reported seconds match. |
| 3 | Thompson fire loops; bolt rifles must not inherit | CONFIRMED | `Ub_FireThompson` 1P: speed 10, `c_AsmLooping`, span 0.1 s, `return_to=_POSE_`. Sniper/bolt fires are `c_AsmPlayOnce` with reload `return_to`. |
| 4 | `extract_viewmodel` hardcodes fire `loop=True`; `returnTo` still in extras | CONFIRMED | `FAMILIES` L82 `("fire", "Fire", True)`. `resolve_families` writes that hardcoded `loop` into report/extras while still storing `returnTo` from the state. Viewer does not chain on `returnTo`. |
| 5 | Viewer plays fire once, holds clamped fire while `cool>0`; reload only on mag/R | CONFIRMED | `map.html`: `onShot` plays `'fire'` and sets `cool = 1/(roundOfFire\|\|1)` (~5486–5489). `updateViewmodelAnimation` keeps `want='fire'` while `active==='fire' && cool>0` (~5315–5316). Reload only via `hw.reload` / `startReload`. `LOCO_LOOP` is idle/walk/run only, so fire is `LoopOnce`+clamp. |
| 6 | Sniper ROF/mag/fireOnce/reloadtime; plain ROF 0.37; period ~3.33 s | CONFIRMED | Objects.con: No4Sniper/K98Sniper `roundOfFire 0.3`, `reloadtime 1.6`, `fireOnce 1`, `magSize 5`, `numOfMag 3`; No4/K98 `roundOfFire 0.37`. `1/0.3≈3.333`. Binary ROF mapping left open in report — not re-litigated. |
| 7 | Scope/unzoom 3.0; viewer hides scoped rig | CONFIRMED | Snipers: `useScope 1`, `zoomFov 0.1`, `unZoomBetweenFireTime 3.0`. `hw.rig.visible = !(scope && zoomed)` at ~5580. Matches ZOOM-2. |
| 8 | `no4`/`k98` projectiles `invisible 1`; no body draw | CONFIRMED | Common/Weapons.con: geometry `bullet_m1`, `invisible 1`, TTL 1, `gravityModifier 0`, materials 218/219, no tracer words. `assemble.py` skips `template.invisible`. |
| 9 | `gunfire.js` dim `aimRay` streak every hand-weapon bullet | CONFIRMED | L545–554: for `kind==='bullet'`, non-tracer round with `group.aimRay` calls `#spawnTracer(..., false)`. Hand weapons set `aimRay` when `fireInCameraDof`. |
| 10 | `e_MuzzGun` 1P flash size 0.2 / TTL 0.07; glow 3P only | CONFIRMED | Effects.con: child pos No4* `0/0.045/0.745`; `em_1P_MuzzGun` `showInFirstPerson 1` → `fx_1p_MuzzGun` size 0.2, TTL 0.07; emitter TTL 0.1, intensity 10, `startRotation` 0–180. `em_MuzzGun_glow` has `showInThirdPerson 1` (no 1P flag). |
| 11 | Shell `e_Shell792D` delay 2.0 s at `0/0.03/0.39` | CORRECTED | Delay 2.0 on both emitters confirmed. Attach `0/0.03/0.39` is No4/No4Sniper only; K98/K98Sniper shell is `0/0.05/0.41`. |
| 12 | Weapon-channel `No4Fire.baf` / `No4SniperReload.baf` missing; K98 reload uses `No4Reload.baf` | CONFIRMED | bf1942: `No4Fire.baf` and `No4SniperReload.baf` absent; `No4Reload.baf` present (bone `Load`, 99 frames). State machine cites those paths. (FHSW alone ships `No4SniperReload.baf` — out of vanilla scope.) |
| 13 | Fire clip large arm rotation; clamp holds dip | CONFIRMED | `1PFireNo4` end-vs-start: R UpperArm **88.72°**, R Hand **63.79°** (~89° / ~64°). |
| 14 | Sniper fire camera shake rows; factor 1.0 (CS-6) | CONFIRMED | `AnimationStatesCameraShakes.con`: `Ub_FireNo4Sniper`/`K98Sniper` pitch `0 2.0 10`, fadeOut `4.0`, layer1 pitch `0.1/1.0`, yaw `-0.03/2.3`. Distinct from Ub_FireNo4’s multi-axis set and Thompson’s small pitch. CS-6 ledger: Ub fire shakes use hardcoded 1.0. |
| 15 | No4Sniper has no setFireDev/setMinDev/setRecoilForce* | CONFIRMED | No4Sniper/K98Sniper: only `setSpeedDev` / `setMiscDev`. Plain No4/K98 have fireDev/minDev/recoil. |
| 16 | center1pHands / set1pFov / No4Sniper camera offsets | CONFIRMED | CommonSoldierData.inc: `center1pHands -0.12/-1.56/0.1`, `set1pFov 0.47`. No4Sniper: `soldierCameraPosition -0.03/-0.04/0.1`, `soldierZoomPosition 0.1/0/0`, `soldierZoomFov 0.6`. Placement/FOV still open as stated. |

Bridge: `./xref.py check` → sha256 `60c9452d…` **MATCH**.

## Load-bearing inferences
- **ROF = `1/roundOfFire` seconds** — plan timing (~3.33 s gate vs 1.0+1.67 anim) assumes this. If the binary used a different mapping, cooldown math drifts; anim chain itself does not.
- **Missing weapon BAFs ⇒ body-only motion** — likely; if the client substitutes another clip, weapon-bone motion could still appear. Body 1P clips remain the primary fix target.
- **Hip placement / VIEW-9** — report correctly does not block the anim fix on this; FOV/mount is secondary.

## Anything the report missed
- Viewer already treats `fire` as `LoopOnce` (`LOCO_LOOP` = idle/walk/run only). The visible sniper bug is **holding clamped fire for all of `cool`**, not playing fire as a loop; `extract_viewmodel`’s hardcoded `loop=True` still corrupts the extras flag and bake wrap.
- `em_MuzzGun` (3P flash) also has `showInThirdPerson 1`, same as glow.
- FHSW ships `animations/Weapons/No4Sniper/No4SniperReload.baf`; vanilla bf1942 does not.
