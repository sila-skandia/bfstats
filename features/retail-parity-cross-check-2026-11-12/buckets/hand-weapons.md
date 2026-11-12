# hand-weapons

## Summary
- MATCH: 24 citation groups (list below), each read on lnxded.static (objdump/readmem) unless noted.
- CODE-WRONG: 2 (1 high, 1 low)
- LEDGER-WRONG: 1 (low: wrong ledger ids cited in code comments; also a missing ledger row)
- SETTLED: 1 (folded into F1: deviation.js's OPEN "AT family" item)
- INCONCLUSIVE: 2 (world-camera zoom FOV ease; non-uniform recoil CRDs)
- DELIBERATE: 0 new
- Not reached (time): hand-fire-sound.js SND-* rows, kit-ammo.js SUP-*/FA-7/FA-8 rows, viewmodel-anim.js ANIM-6/7 timers, weapon-part-pose.js ANIM-22, kit-graft/kit-icon (LOAD/KIT, data-only), weapon-bar.js HUD-14..17 beyond the two timeouts, arms-rig.js camera/projection addresses. Proving-ground files (viewer/proving-*.js, viewer/play/proving-ground-screen.js) hold no retail citations beyond "engine yaw" wording.

## Findings (non-MATCH), most severe first

### F1 [CODE-WRONG] [high] deviation.js reads `minDeviation` / `maxDeviation`, words neither binary knows (SETTLES the file's OPEN item)
- Code: tools/bf1942-models/viewer/deviation.js:161 — `return this.data.min ?? this.data.minDeviation ?? 0;` and :264-265 — `const lid = this.data.maxDeviation; if (lid !== undefined && total > lid) total = lid;`. Header :65-67 lists it as "OPEN ... the floor-and-lid reading here is the stand-in". Fed by tools/bf1942-models/bf42/con.py:2298-2299 (`"minDeviation": self.min_deviation, "maxDeviation": self.max_deviation`).
- Ledger: DEV-8 (refuted 2026-09-16): the 16 `minDeviation`/`maxDeviation`/`minDevStanding...`/`subDev...`/`addDev...` words are in neither binary's strings, so the engine ignores them; a template that uses only them keeps the FireArmsTemplate ctor's zero deviation. Code does not follow DEV-8 (tank-launchers.js:30 does).
- Third-party: no occurrence of `minDeviation` or `maxDeviation` anywhere in ~/projects/skandia/bf1942reverseengineering (rg over the whole tree: 0 hits); the only registered deviation words are setMinDev/setFireDev/setDevMod/setTurnDev/setSpeedDev/setMiscDev.
- Our binary: `strings | grep -ci 'minDeviation|maxDeviation'` = 0 for BF1942.exe and 0 for lnxded.static. FireArmsTemplate ctor 0x0828d7de..0x0828d7f6 writes esi (0) to +0x2ec..+0x304 (minDev at +0x2fc, written only by `setMinDev` 0x0828fb29 `movl %edx,0x2fc(%eax)`). `HandFireArms::updateDeviation` ends `flds 0x18c; fadds 0x2fc(tmpl); ... fadds 0x190; fstps 0x188` (0x08294139..0x0829415d) with no lid compare anywhere in the function.
- Verdict reasoning: a player's vanilla Bazooka/Panzerschreck (and the other 77 templates DEV-8 counts that use only those words) gets a cone floor of `minDeviation` and a lid in our game; retail gives them a zero cone (point-accurate, cross closed) plus whatever ordinary words they also carry. Total is never clamped in retail.
- Fix: in deviation.js `floor()` return `this.data.min ?? 0`; delete the `maxDeviation` lid in `current()` (keep only the `> 0` floor); remove the OPEN bullet from the header and cite DEV-8. Optionally stop exporting the two keys in con.py:2298-2299.

### F2 [CODE-WRONG] [low] Viewmodel crossfade snaps at factor >= 1000; retail snaps only above 1000
- Code: tools/bf1942-models/viewer/arms-rig.js:300 — `return factor >= VIEWMODEL_MORPH_SNAP || factor <= 0 ? 0 : 1 / factor;` (:253 comment "a factor of 1000 or more is a cut"); viewmodel-anim.js:13 "morphFactor >= 1000".
- Ledger: none found for the threshold (comment cites lnxded 0x0832b481).
- Third-party: not consulted (binary is unambiguous).
- Our binary: 0x0832b481 `flds 0x2c(%edi); flds 0x86b1ca8 (=1000.0, readmem); fxch; fucompp; testb $0x45,%ah; jne 0x832b354` — the blend path is taken when factor <= 1000; the snap (`movl $0x3f800000,0x34(%esi)` at 0x0832b499) only when factor > 1000.
- Verdict reasoning: at exactly 1000 retail blends (weight += dt*1000, full within one tick), so the visible difference is at most one frame. Boundary only.
- Fix: `factor > VIEWMODEL_MORPH_SNAP` in arms-rig.js:300 and "more than 1000" in both comments.

### F3 [LEDGER-WRONG] [low] recoil.js and hand-fire.js cite FA-2..FA-5 for the recoil ride; those rows are the projectile pool, velocity default, autoFire and dummies
- Code: tools/bf1942-models/viewer/recoil.js:2 — "(lnxded; ledger FA-2..FA-5)"; hand-fire.js:572 — "`BFSoldier::calcRecoil` (`recoil.js`, ledger FA-2..FA-5)".
- Ledger: FA-2 (projectile pool), FA-3 (velocity default 200), FA-4 (autoFire), FA-5 (dummy projectiles). The recoil draw is FA-22; the ride (tables, 20/8 counter, devMod, add into c_PIMouseLookX/Y, MenuSelect gate) has NO ledger row; NET-13 covers only the counter's network bits.
- Third-party: n/a (citation check).
- Our binary: the ride is fully as recoil.js says: tables readmem 0x0872ee20 (21 floats 0, .02, .03, .05, .07, .09, .12, .12, .09, .07, .05, .03, .01, -.01, -.03, -.05, -.07, -.1, -.13, -.16, -.2) and 0x0872ee80 (0, -.01 ... -.2); counter `((+0x331 != 0) - 1 & -12) + 20` at 0x0827e53b..0x0827e551; `yawRecoil` 0x0827e720 = `+0x54c * table[+0x544] * getDevMod()` (vt+0x124); applied at 0x08275c5f..0x08275c97 (`fadds` into the local look copies, then `decl 0x544`).
- Fix: cite FA-22 in both comments; add a ledger row for the ride (content = recoil.js header, with the addresses above, plus F-note below).
- Note for that row: `yawRecoil`/`pitchRecoil` read goBack (+0x331), hasForce (+0x330) and devMod from the CURRENTLY HELD weapon each tick, and zero the counter when it has no recoil force (0x0827e7b7). recoil.js snapshots goBack/devMod at the shot. Unreachable through MenuSelect (isNotFireingOrHaveRecoil 0x0827eaf0 refuses a select while +0x544 != 0), reachable only through an automatic switch, pickup or death mid-ride; not worth code.

### F4 [INCONCLUSIVE] [low] World-camera zoom FOV ease (hand-fire.js:960-965, "OPEN [stand-in]")
- Code borrows the arms' `0.7*cur + 0.3*target`, snap 0.001, for `page.camera.fov`.
- The arms' ease itself is MATCH (Mac client `BFSoldier::handleVisualUpdate`, decompiled_functions_MacClient/dice_ref2_world_BFSoldier_handleVisualUpdate.c:46-57: `fabs(...) <= 0.001` snap else `0.7*cur + 0.3*target`, then `applyFovModifier`; position ease `* 0.25` at :42-44; lnxded .rodata 0x086c08ac = 0.25).
- What would settle it: read the client camera-mode switch (0x004fc8b6) and `Camera::setVehicleFOV` callers for a per-frame lerp on the render view FOV.

### F5 [INCONCLUSIVE] [low] Non-uniform recoil CRDs are drawn as uniform
- recoil.js `draw()` and con.py `crd_range` (con.py:373-390) ignore the distribution; `calcRecoil` 0x0827e2f0 dispatches CRD 0 (NONE: fixed a), 1 (UNIFORM), 2 (EXPONENTIAL: -b*log r), 3 (NORMAL: getNormal) and the mirror byte (+0x314/+0x328). A `CRD_NONE/0.5/0/0` would be drawn uniform 0.5..0 instead of 0.5. recoil.js says every shipped weapon is uniform; no con tree on disk to check. Settle by surveying `setRecoilForce*` CRD kinds across the exported trees.

## MATCH list
- HandFireArms::updateDeviation 0x08293e80 (full objdump trace) -> deviation.js: devMod from tmpl +0x390/+0x394/+0x398 by getPose 0/1/else; speed gates binary on |input3| (throttle, +0x374) and |input0| (yaw/strafe, +0x378) > 0.01 x M; turn analog |input5|*+0x364*M + |input4|*+0x368*M behind the deadzone; misc +0x384*M on the bool; channel law (acc==0: max(s-d/M,0); s<cap: clamp(s+M*acc-d/M,0,capM); else max(s-d/M,capM)); fire decay +0x2f4/M floored at 0; total = fire + minDev(+0x2fc) + speed + turn + misc + AI(+0x190, zeroed after) stored to +0x188. M^2 confirmed at 0x0829431e.
- Setter layouts setTurnDev 0x08294740 / setSpeedDev 0x08294770 / setMiscDev 0x082947a0 / setFireDev 0x0828faf0 / setMinDev 0x0828fb20 -> deviation.js array order [cap, b, c, decay] / [cap, add, decay].
- Deadzone 0.01 at .rodata 0x086c08a4 (readmem) -> deviation.js INPUT_DEADZONE, throw-charge.js RELEASE_ABOVE.
- DEV-12 fire bloom in Fire 0x0828a2b3..0x0828a2da (min(fire+b, cap), no update call) -> deviation.js onShot/stored, fire-state.js registerShot.
- DEV-10 input channels 4=MouseLookX, 5=MouseLookY -> deviation.js, hand-fire.js:997.
- DEV-15 jump bool -> deviation.js, hand-fire.js:990 (ledger only, not re-read).
- TICK_HZ 30 / LOOP-1 -> deviation.js, fire-timer.js (ledger, not re-read).
- FA-22 calcRecoil 0x0827e2f0: hasForce +0x330 gate, seed from getCurrentInputIndex (vt+0xa0 at 0x0827e342), Schrage 0x5e30 then 0x661f, `((s>>7)|1)+1` * 2^-24, pitch->+0x548, yaw->+0x54c -> recoil.js inputRecoilRand/calcRecoil.
- FireArmsTemplate ctor 0x0828d4e0 defaults: roundOfFire 10 (+0x240 = 0x41200000), velocity 200 (+0x2e8), recoilForceUp CRD_NONE 1.0 (+0x30c = 1.0), leftRight 0, hasRecoilForce 0, goBackOnRecoil 1 (0x0828d85e), autoReload 0 (+0x262 at 0x0828d678), timeToNotAllowChange -1 (+0x33c = 0xbf800000) -> recoil.js, fire-timer.js, hand-fire.js:159.
- AI-133 FireArms ctor 0x08286870 `fdivs 0x240; fstps 0x234` -> fire-timer.js firePeriod.
- Timer decrement float32 0x08289388 and fireFinished at <= 0 (0x082893a4..0x082893b1); Fire SETS 0x234 at 0x0828a24e -> fire-timer.js timerTicks.
- GUN-19/GUN-14 grenade charge branch in handleUpdate 0x08288d42..0x08288e96 (pending/fire/reload gates, heat += +0x300 capped 1, flag cleared, release when heat > 0.01 -> Fire + triggerFireAnimation) -> throw-charge.js (the ledger said "decompile only"; now objdump-read).
- GUN-15 cooling gate (fire timer <= 0 and overheat timer <= 0, heat -= +0x304, floor 0) 0x08288ea0..0x08288f1d -> fire-state.js stepHeat.
- FA-9 isNotFireingOrHaveRecoil 0x0827eaf0 + getTimeToNotAllowChange 0x0828faa0 (recoil counter != 0 refuses; t <= 0 or t <= 1/rof - tna) -> hand-weapon.js fireHoldsItem / selectKitWeapon.
- FA-20 HandFireArms::enable 0x08293c90..0x08293ca7 (+0x1fc, msg 0x16 at 0.1 s = 0x3dcccccd, skipped for magType 1) -> hand-fire.js RAISE_TICKS, hand-weapon.js enableItem.
- CS-9 setCurrentState 0x0832b150 (timer -20.0 = 0xc1a00000 always; new state: +0x14=1, +0x15=0, +0x10=0) -> fire-shake.js enter().
- Morph default 5.0 at 0x08328bf8 (0x40a00000) -> arms-rig.js VIEWMODEL_MORPH_DEFAULT.
- Arms FOV ease 0.7/0.3 snap 0.001 and rig ease 0.25 (Mac handleVisualUpdate; lnxded 0x086c08ac) -> hand-fire.js:120-131, 950-985.
- Weapon bar timeouts 3.0 (client 0x006d4aa2 `mov [esi+0x1c],0x40400000`) and 1.5 (0x006d4baa `0x3fc00000`) -> weapon-bar.js SCROLL_TIMEOUT/PICK_TIMEOUT.
- FA-1 fireingForce +0x2ec gate in Fire 0x0828a293 -> gun-recoil.js (ledger row; push block not re-read).
- FA-13 fireDelay -> fire-timer.js, hand-fire.js:465-473, hand-alt-fire.js (ledger, verified 2026-10-17; not re-read).
- FA-11, FA-14, FA-6/FA-7, BODY-7, SND-13/14/15/17, XHIT-12, ANIM-6/7/22, HUD-14..17, KIT-4/7, LOAD-1/2, SUP-2/8 -> name/row citations only, not re-read (rows marked verified/confirmed in ledger).

## Fixes applied

### F1 (deviation.js reads minDeviation / maxDeviation)
- tools/bf1942-models/viewer/deviation.js: the header's OPEN bullet is replaced by a DEV-8 citation (ctor zero 0x0828d7de..0x0828d7f6, unclamped store 0x08294139..0x0829415d). The class doc says a block carrying only the AT words is a point. `floor()` is now `return this.data.min ?? 0;`. `current()` no longer has a `maxDeviation` lid, and its doc cites 0x0829415d and DEV-8.
- tools/bf1942-models/tests/test_deviation.py: the docstring is updated. `test_the_at_familys_lid_clamps`, which encoded the wrong lid, is now `test_the_at_words_floor_and_lid_nothing`. It asserts that the cone reaches the speed channel's own cap of 2.0, above `maxDeviation` 0.5.
- tools/bf1942-models/tests/deviation_harness.mjs: the comments are updated, and `results.capped` gains `channelCap`.
- con.py's export of the two keys is left in place, as instructed.
- Tests: `python3 -m unittest tests.test_deviation -v` 29/29 OK; `tests.test_tank_school` 49/49 OK.

### F2 (morph snap boundary)
- tools/bf1942-models/viewer/arms-rig.js:300 is now `factor > VIEWMODEL_MORPH_SNAP`. The comment at :253 now reads "above 1000 is a cut", cites 0x086b1ca8 = 1000.0, and notes that exactly 1000 blends.
- tools/bf1942-models/viewer/viewmodel-anim.js:13 is now "morphFactor > 1000 ... lnxded 0x0832b481".
- Tests: `tests.test_viewmodel_anim` and `tests.test_viewmodel` 58/58 OK.

### F3 (citations)
- tools/bf1942-models/viewer/recoil.js:2 now cites FA-22 for the draw and says the ride has no row yet.
- tools/bf1942-models/viewer/hand-fire.js:572 now cites FA-22.
- Not edited, because the file is outside this bucket: tools/bf1942-models/viewer/world-soldier-tick.js:33 still says "ledger FA-2..FA-5". It should say FA-22 (or the new row below once it has an id).

### F4 (world-camera zoom FOV ease): still INCONCLUSIVE, no code change
- 0x004fc8b6 is not a FOV path. 0x004fc83d..0x004fc8e7 decides the zoom flag. It sets or clears flag bit 2 through vt+0x28 on the soldier (`push 0x2; push 0x0` / `push 0x0; push 0x2`) and then on the weapon. The decision is gated on the weapon's vt+0xf8, template byte +0x3d8, and `fld [edi+0x3dc]; fcomp [0x8c41ac]; test ah,0x41`. No FOV value is written there. This matches ZOOM-1's caution and VIEW-12.
- The vehicle FOV path snaps. In the Mac `Camera::setVehicleFOV` (decompiled_functions_MacClient/dice_ref2_world_Camera_setVehicleFOV.c, tail), the render view's FOV is set straight to `getVehicleFov()` (vt+0x14), with no lerp.
- `FireArmsTemplate::getZoomFov` (Mac +0x2e8) has no direct caller in the Mac dump; it is reached only through a vtable. `FireArms::isZoomed` likewise has no named caller.
- So the world-FOV consumer was not found. The one analogous path that was read (vehicle FOV) snaps rather than eases. That is a lead for "snap", but it is not proof, so the stand-in is kept. To settle it: find the client function that reads the held FireArms template's zoomFov (client +0x3d0 area per ZOOM-2's offsets) and writes the RenderView FOV, for example by a data xref on the RenderView FOV setter.

### F5 (non-uniform recoil CRDs): SETTLED, no code change needed
- I surveyed every `.con` inside every non-level `.rfa` of both installs, for all 12 mods: ~/.cache/vimpact-game/Mods and the CrossOver bottle's `Battlefield 1942/Mods`, the latter including FHSW and FHSWEurope. The survey script is <scratch>/f5/survey.py.
- Result: 2,264 `setRecoilForceUp`/`setRecoilForceLeftRight` lines, all `CRD_UNIFORM`, all with mirror field 0. Per mod: bf1942 28, XPack1 8, XPack2 12, DC 52, DC_Final 54, EoD 68, FH 774, FHSW 513, FHSWEurope 511, GCMOD 60, bf1918 184.
- recoil.js's uniform draw therefore covers every shipped weapon, and the CRD_NONE/EXP/NORMAL and mirror paths of `calcRecoil` are unused by shipped data. One caveat: con.py's `crd_range` drops the kind, so a future mod using another kind would be drawn wrong silently.

## Ledger edits

### New row (FA- next free id): the hand weapon's recoil ride
| FA-?? | (2026-11-12) **A hand weapon's recoil kick reaches the aim over 8 ticks, and a `goBackOnRecoil` weapon returns it over the next 12; the ride rides the soldier's look input, not the view.** `BFSoldier::calcRecoil` 0x0827e2f0 (FA-22's draw) arms the counter `+0x544 = ((tmpl+0x331 != 0) - 1 & -12) + 20` (0x0827e53b..0x0827e551): 20 with goBack, 8 without. Each tick `BFSoldier::handlePlayerInput` (0x08275c5f..0x08275c97), while `+0x544 != 0`, adds `yawRecoil()` to its local `c_PIMouseLookX` copy and `pitchRecoil()` to `c_PIMouseLookY`, after the zoom factor has scaled them (0x08275bf2..0x08275c11, ZOOM-4), then decrements the counter. `yawRecoil` 0x0827e720 = `+0x54c x table[+0x544] x heldWeapon->getDevMod()` (vt+0x124); `pitchRecoil` 0x0827e7d0 the same with `+0x548`. The table is `recoilTabel` 0x0872ee20 with goBack, `recoilTabel2` 0x0872ee80 without, indexed by the counter from 20 (or 8) down to 1. recoilTabel [1..20] = .02 .03 .05 .07 .09 .12 .12 .09 .07 .05 .03 .01 -.01 -.03 -.05 -.07 -.1 -.13 -.16 -.2 (index 0 = 0); recoilTabel2 [1..8] = -.01 -.03 -.05 -.07 -.1 -.13 -.16 -.2. Each half sums to 0.75, so the kick is 0.75 of the drawn amount and goBack returns exactly that. A new shot re-arms the counter and overwrites both amounts. `yawRecoil`/`pitchRecoil` read goBack (+0x331), hasRecoilForce (+0x330) and devMod from the weapon held **on that tick**, not the one that fired. A held weapon without recoil force zeroes the counter (0x0827e7b7), and no held item (+0x3b8 == -1) returns 0 while the counter still counts. `BFSoldier::isNotFireingOrHaveRecoil` 0x0827eaf0 refuses every MenuSelect while `+0x544 != 0` (FA-9's other half), so the held weapon changes mid-ride only through an automatic switch, a pickup or a death. Template ctor 0x0828d4e0: goBack 1 (0x0828d85e), hasForce 0 (0x0828d857), recoilForceUp CRD_NONE 1.0 (+0x30c), leftRight CRD_NONE 0. Every shipped `setRecoilForce*` line in all 12 mods is CRD_UNIFORM with mirror 0 (2,264 lines, 2026-11-12 survey) | **confirmed** (lnxded objdump + readmem) | `viewer/recoil.js` (`RECOIL_TABLE`, `RECOIL_TABLE2`, `calcRecoil`, `recoilStep`; snapshots goBack/devMod at the shot, the unreachable-by-select difference above), `world-soldier-tick.js`, `hand-weapon.js` `selectKitWeapon` |

### DEV-8: append to the evidence column
"Re-checked 2026-11-12: `strings | grep -ci 'minDeviation|maxDeviation'` = 0 in BF1942.exe and lnxded.static, and 0 hits in the third-party corpus. `HandFireArms::updateDeviation` stores `fire + minDev(+0x2fc) + speed + turn + misc + AI` with no clamp (0x08294139..0x0829415d). `viewer/deviation.js` no longer reads either word (it had used them as a floor and a lid)."

### GUN-19: status upgrade
"The grenade's charge-and-release branch of `handleUpdate` is now read in objdump (2026-11-12): `cmpb $0,0x333` 0x08288d42; pending (+0x294), fire-timer and reload-timer gates 0x08288d4f..0x08288de0; with +0x224 up, `heat += tmpl+0x300`, capped at 1.0, flag cleared (0x08288def..0x08288e18); with it down, `heat > 0.01` (0x086c08a4) calls `Fire` and `triggerFireAnimation` (0x08288e28..0x08288e8e)." The same text also upgrades GUN-14's "the grenade's charge-and-release branch of `handleUpdate` read in the decompile only".
