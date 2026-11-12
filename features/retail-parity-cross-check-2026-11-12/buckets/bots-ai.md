# bots-ai

## Summary
- CODE-WRONG: 7 (F1 high; F3 medium; F4, F5, F6, F7, F8 low). F7 is also LEDGER-WRONG (AI-44).
- LEDGER-WRONG: 2 (F2 AI-36/KNOBS/bot-fire header on the AA term; AI-44's 0.6914 in F7). F2 also SETTLES the controls.md "research disagreement" in AI-18's favour.
- RE-WRONG: 1 (F3: the linux dump's `ROUND` in sense.c is a truncation, the same x87 control-word trap the repo already notes for SCurve).
- INCONCLUSIVE: 1 (F9 wanted strength).
- DELIBERATE: 6 noted (F10).
- MATCH: ~25 value groups checked on the binary (list below), plus every cited 0x08xxxxxx address name-checked.
- Not reached: createFirePlan's 3 s timeout and `1 + floor(rand x 10)` shot draw (no 3000/10/3.0 immediate in createFirePlan or createPlan; KNOBS already marks the draw UNSOURCED); the client-side (0x004..0x006) citations (a handful, all names); the sim/ runner files beyond their retail citations (they cite rows, not values); doctrine-*.js and map-spotter/spotter value checks (only name citations sampled). A systematic hunt for other Ghidra `ROUND` -> trunc/ceil sites turned up F3-F6; other `Math.round` uses in the bucket are display or our own design.

## Findings (non-MATCH), most severe first

### F1 [CODE-WRONG] [high] The anti-aircraft term `C` of a bot's AI deviation is never passed: a ground bot shoots at aircraft with no AA penalty
- Code: `tools/bf1942-models/viewer/bot.js:346-351` — `this.deviation.setAIDeviation({ botSkill, timeSinceTarget, deviation, correctionTime })`, no `aaPenalty`, so `deviation.js:301` `aaPenalty = 0` is always used (`C = 0`). `bot-fire.js:137-138` `vehicleExtra: 30.0, vehicleOccupiedExtra: 10.0` are declared and read nowhere.
- Ledger: AI-18 (C = 0 when the bot's own equipment is ITAir or its target is not ITAir; else 10 or 30) — correct. AI-68 agrees (30, 10 for a seat, 3/1 continuous, 0 from an aircraft). AI-36 says "extra 0 / 30 / 10" without the air condition.
- Third-party: not needed (settled on our binary).
- Our binary: `EntryTrigger::execute` 0x086257d0, 0x08625cfc `call *0xd0(%eax)` (getCurrentEquipment E), 0x08625d87 `testb $0x10,0x4(%eax)` on E (ITAir = enum 4 -> bit 0x10, AI-9) -> C = 0 path; 0x08625de3 `call *0x80(%eax)` (getFiringTarget T), 0x08625e18 `testb $0x10,0x4(%eax)` on T: not air -> C = 0 (the 0 path pushes `$0x0` at 0x08625daf); T air: 0x08625e54 `call *0x6c(%edx)` on E's object or 0x08625e64 `testb $0x40,0x4(%ecx)` (ITNaval) -> `pushl $0x41200000` (10.0) at 0x08625e8c, else `pushl $0x41f00000` (30.0) at 0x08625eb8; then `call *0x84(%esi)` = `Weapon::setBotSkill(skill, targetTime, C)`. `WeaponFireArm::setBotSkill` 0x085ee580 multiplies C by `(1 - 0.75 skill)` (0x085ee59a `fmuls 0x86ba8cc` = 0.75; `fmuls 0x14(%ebp)` = C). `EntryTriggerContinously` 0x08625ff0 has the same tests (0x08626492/0x086264dc `testb $0x10`, 0x08626542 `testb $0x40`) and `pushl $0x40400000` (3.0) at 0x08626593.
- Verdict reasoning: a soldier or a ground/AA gunner bot firing at an aircraft gets `C = 30` (10 from a naval hull or when E's vt+0x6c predicate holds): at the default skill 0.75 that is `30 x 0.4375 = 13.1` hundredths of a radian added to the cone, on top of the weapon's `5 x 0.25 x 0.25 = 0.31`. The viewer flies these rounds ~40x tighter than retail against aircraft. `features/bf1942-ai-spec/README.md:163` lists it as a known divergence ("C is never passed (always 0)"), not a choice; nothing records it as deliberate.
- Fix: in `bot.js` tick, pass `aaPenalty`: 0 when `this.vehicle?.kind === 'air'` or the firing target is not an aircraft; else 10 when the bot's own unit is naval (`this.vehicle?.kind === 'ship'`) or (unnamed E vt+0x6c predicate; leave out until named), else 30. Use 3 (naval 1) under a continuous (burst/held) trigger plan. The unused `FIRE.vehicleExtra/vehicleOccupiedExtra` should become `{ air: 30, naval: 10, continuousAir: 3, continuousNaval: 1 }`.

### F2 [LEDGER-WRONG] [medium] KNOBS / bot-fire header / AI-36 describe `C` as "0 infantry, 30 vehicle, 10 primary/occupied"
- Code/doc: `tools/bf1942-models/viewer/bot-fire.js:61-64` ("`extra` is 0 against infantry, 30 (or 10 for a primary/occupied vehicle) against a vehicle"); `features/bf1942-ai-spec/KNOBS.md:87`; `features/bf1942-ai-spec/controls.md:74-80` (calls it an open "research disagreement").
- Ledger: AI-36's tail "extra 0 / 30 / 10"; AI-18 / AI-68 have it right.
- Our binary: as F1 (0x08625d87, 0x08625e18, 0x08625e64, 0x08625e8c, 0x08625eb8). The key is ITAir (0x10) on the shooter's equipment and on the target, not vehicle vs infantry.
- Verdict: SETTLED for the controls.md disagreement in AI-18's favour; AI-36 row, KNOBS row 87 and the bot-fire.js header should say "0 unless a non-air shooter fires at an ITAir target; then 10 from naval equipment (or E vt+0x6c), else 30; 3 / 1 under EntryTriggerContinously".
- Fix: doc text only (code fix is F1).

### F3 [CODE-WRONG] [medium] Sense ray count truncates in retail; viewer rounds (Ghidra ROUND trap)
- Code: `tools/bf1942-models/viewer/bot-sense.js:621` and `:633` — `Math.max(1, Math.min(RAYS_MAX, Math.round(RAYS_PER_METRE_RADIUS * r / Math.max(dist, 0.1))))`; header `bot-sense.js:17-18` and `features/bf1942-ai-spec/sensing.md:61`, `KNOBS.md:38`, `bf1942-ai-research-2026-09-21/bot-behaviours.md:36` all say `round`.
- Ledger: AI-33 (sensing) — no rounding stated.
- Third-party: `~/projects/skandia/bf1942reverseengineering/decompiled_functions_bf42linuxServer/sense.c:400` — `iVar12 = (int)ROUND(fVar1);` (Ghidra's x87 default).
- Our binary: `BotMain::sense` 0x08521cf0: 0x08522255 `flds 0x86b01b4` (30.0), `fmulp`, `fdivp` (by distance), then 0x08522265 `fnstcw`, 0x08522272 `movb $0xc,%ah` (RC = 11, truncate), 0x0852227b `fldcw`, 0x08522281 `fistpl`; `jle` -> 0x085227c3 `movl $0x1,%esi`; 0x0852229b `cmpl $0xa,%esi` / `movl $0xa,%esi`. Distance 0 -> 1e14 (0x86ffd70) -> 10.
- Verdict: n = clamp(trunc(30 r / d), 1, 10). RE-WRONG for the decompile; the viewer follows it. For a 1 m radius the viewer casts one ray more than retail in every band where frac(30/d) >= 0.5: 15..20 m (retail 1, viewer 2), 10.9..12 m (2 vs 3), 8.6..9.2 m (3 vs 4), and so on: bots spot partly-hidden targets more readily than retail.
- Fix: `Math.round` -> `Math.trunc` at both lines (the `max(dist, 0.1)` floor can stay; retail uses 1e14 for d = 0, i.e. 10 rays, which the clamp already gives). Update the four doc copies to `trunc`.

### F4 [CODE-WRONG] [low] The Aimer's halving count truncates; viewer rounds
- Code: `tools/bf1942-models/viewer/bot-aim.js:567` — `const halvings = Math.round(precision * 8 + 2);` (comment :552 "round(8 precision + 2)").
- Ledger: none for the rounding (KNOBS/aim rows cite `Aimer::getFiringDirection`).
- Third-party: not consulted (binary is direct).
- Our binary: `Aimer::getFiringDirection` 0x08538ad0: 0x08538b78 `fmuls 0x86c08c0` (8.0), 0x08538b99 `fadds 0x86c08c4` (2.0), 0x08538bd4 `movb $0xc,%ah`, 0x08538bdd `fldcw`, 0x08538be3 `fistpll` — truncation.
- Verdict: halvings = trunc(8 p + 2). Differs only when frac(8p) >= 0.5 (e.g. p = 0.35: 4 vs 5); one fewer bisection step leaves a slightly coarser elevation.
- Fix: `Math.trunc(precision * 8 + 2)`.

### F5 [CODE-WRONG] [low] WPMoveTo's R' is ceil(R), not round(R)
- Code: `tools/bf1942-models/viewer/strategic-ai.js:730` `const Rr = Math.round(R) + pathRadius;`, `:821` `const arrive = Math.round(R) + SAI.unitRadius;`, `doctrine-landing.js:614` `Math.round(order.radius) + ...`; comment `strategic-ai.js:720` "R' = round(R)".
- Ledger: none on the rounding (AI-70/AI-74 cite WPMoveTo::getUrgency).
- Our binary: `WPMoveTo::getUrgency` 0x085374a0: 0x085374c4 `flds 0x8(%edi)` (R), 0x085374ce `andl $0xfffff3ff,%eax`, 0x085374d3 `orl $0x800,%eax` (RC = 10, round up), 0x085374dc `fldcw`, 0x085374df `frndint`.
- Verdict: R' = ceil(R) + removal distance. A 7.3 m waypoint radius arrives at 8 + r in retail, 7 + r in the viewer (up to 1 m tighter); affects when an ordered bot counts as arrived and the urgency's `d^2 / 4R'^2`.
- Fix: `Math.ceil(R)` at the three sites; comment to "R' = ceil(R)".

### F6 [CODE-WRONG] [low] The mounted-infantry Fire score truncates the seat's strength; viewer rounds
- Code: `tools/bf1942-models/viewer/bot-fire.js:855` `base += (Math.round(t) + 1 + (myTable[st] ?? 0)) * ...`; `:329` `Math.round(SOLDIER_BATTLE_STRENGTH[targetType] ?? 1) * F`; doc `bot-fire.js:776` "round(seat[myType])".
- Our binary: `BBFire::calculateUrgency` 0x08563570: 0x08564707 `flds (%eax,%ecx,4)` (table entry), 0x0856471d `movb $0xc,%ah`, 0x08564732 `fldcw`, 0x08564738 `fistpl`, then `fildl`, 0x08564754 `fadds 0x14(%ebx)`, 0x0856475d `fadds (%eax,%ecx,4)` — the only fistp in the function, truncating.
- Verdict: trunc, not round. Vanilla strength tables are whole numbers, so no vanilla effect; a mod with a fractional `setBattleStrength` (x.5 and up) scores 1 higher in the viewer.
- Fix: `Math.trunc` at both lines; doc "trunc(seat[myType])".

### F7 [CODE-WRONG] [low] Upside-down test: retail compares the hull's up with the ground normal against 0.7071; viewer uses world up against 0.6914
- Code: `tools/bf1942-models/viewer/bot-units.js:371-372` `_up.set(0,1,0).applyQuaternion(...); const upright = _up.y >= 0.6914;`; `bot-vehicle.js:41`, `:113` `upsideDownCos: 0.6914` (unused constant).
- Ledger: AI-44 "not upside down (0x0855fcf0: up . normal < 0.6914)"; KNOBS.md:213, bot-behaviours.md:445 copy it.
- Third-party: `decompiled_functions_bf42linuxServer/isUpsideDown.c` — `(**(code **)(*(int *)param_2 + 0xa8))(param_2,*puVar1,puVar1[2],&local_2c);` then `... < param_3`; the caller in `BBChange::calculateUrgency` passes `0.7071` (recorpus lines 391-394, 585-588).
- Our binary: `BBChange::calculateUrgency` 0x0855e0c0 pushes `$0x3f350481` (0.7071, cos 45 deg) at 0x0855f2ad and 0x0855f606 before `call isUpsideDown` 0x0855fcf0; there 0x0855fd24 `call *0xa8(%edx)` (environment, at the object's x, z, fills the ground normal), 0x0855fd2f `call *0x28` (matrix) and the dot with row +0x10 (up), `flds 0x14(%ebp)` / `fucompp` / `sete`: upside down when `0.7071 > up . normal`. 0.6914 is nowhere in the binary (searched as float and double).
- Verdict: LEDGER-WRONG (AI-44's 0.6914) and CODE-WRONG (value and reference vector). A hull parked on a slope steeper than ~46 deg is wrongly refused by the viewer; one tilted 44..46 deg off its ground is wrongly accepted.
- Fix: `bot-units.js:372` -> `upright = _up.dot(groundNormalAt(pos)) >= 0.7071` (fall back to world up where the page has no normal); `CHANGE.upsideDownCos: 0.7071`; AI-44, KNOBS:213, bot-behaviours.md:445 -> 0.7071 against the ground normal at the hull's x, z.

### F8 [CODE-WRONG] [low] Behaviour urgencies pass through 8- and 5-point sketches of the SCurve / Declein tables
- Code: `tools/bf1942-models/viewer/bot-behaviours.js:43-60` — `SCURVE_POINTS = [[0,0],[0.25,0.087],[0.5,0.5],[0.75,0.913],[1,1]]`, `DECLEIN_POINTS` 8 points, linear between. Used by `unitUrgency` (`bot-vehicle.js:535`, SCurve(health)), Medic, TakeCover, Scout, Fire's `Declein(2 best)`.
- Ledger: none on the approximation; the file header calls the tables "101-entry ... the rest linear".
- Our binary: `SCurve::init` 0x08658030 writes 101 floats (`movl $0x3b136a80,0x4(%eax)` .. `movl $0x3f800000,0x190(%eax)`); `DecleiningSlopeCurve::init` 0x08655170 writes 101 (`$0x3cef8d24` at +4, `$0x3d6f8d24` at +8, ...). `bot-sense.js:168 SCURVE_TABLE` matches the SCurve one to 5e-10.
- Verdict: the sketch is off by up to 0.054 for SCurve (x = 0.37: retail 0.232, viewer 0.285, +23%) and 0.018 for Declein (x = 0.39: 0.835 vs 0.818). An exact SCurve already exists in bot-sense.js.
- Fix: `sCurve` -> `sCurveExact` (bot-sense.js); add a `DECLEIN_TABLE` from the 101 immediates of 0x08655170 and blend it the same way (`calculate` 0x08655560).

### F9 [INCONCLUSIVE] [medium] A held area's wanted strength
- Code: `tools/bf1942-models/viewer/strategic-ai.js:361` `s.wanted = owned ? Math.round(2 * presentValue) : Math.round(2 * presentValue * SAI.wantedNotOwned)`; header :32 "round(2 * max(1, sum of present values))".
- Our binary: `AIStrategicArea::update` 0x0863d6d0, Owned branch (status +0x70[side] == 0): 0x0863de2b `fld1`, `fildl 0xd4(%edx,%esi,4)` (the stored wanted), max of the two, then `SCurve::calculate(+0xac[side])` (0x0863de56), `fsubrs 0x86c08c4` (2 - SCurve), `fmuls`, truncating `fistpl 0xd4(...)` at 0x0863de89; three more truncating writes to +0xd4/+0xdc at 0x0863e124, 0x0863e2be, 0x0863d840 (`trunc(x + table[type])`).
- Verdict: retail is `trunc((2 - SCurve(+0xac)) x max(1, wanted))` with trunc, not `round(2 x present)`; what +0xac holds and the other branches were not read. Needs a full read of 0x0863dd2c..0x0863e2c0 and a ledger row.

### F10 [DELIBERATE] keep
- `bot-route.js:74 PATH_BUDGET_NODES`, `:84 PATH_SEARCH_OVERDUE_TICKS`: node budget in place of the engine's time slice (AI-6, AI-135), labelled INVENTION for determinism; documented in features/bot-path-budget.
- `bot-route.js:166 AI_TICK_HZ 30` with counts advanced by `dt x 30`: browser frame-rate adaptation of the 150 / 401 tick counts (documented in place).
- `bot-deviation.js` foot input index hashed per life (multiple of 4) and seat index 618: measured on lab recordings (AI-145), labelled INFERRED.
- `deviation.js` AI term held every tick instead of once per trigger pull (AI-19): listed in `features/bf1942-ai-spec/README.md:163` as a known divergence, not argued; with DEV-13 (the trigger statement runs every tick while held) the effect is small. Not a design choice, but not changed here.
- `SAI::update` 0x086306d0 slices its sub-steps against `0.95 x budget` (0x86d16cc); the viewer runs a pass whole. Not gameplay-visible.
- `deviation.js:306` `F38 = F34 > 0 ? 1/F34 : 0.1`: retail's console handler 0x085109c4..0x085109e8 stores 0 for F34 = 0; harmless because the max() term is then 0.

## MATCH list
- DEV-9 / AI-145 `fireBarrel` draw (k mask 0x3ff, seeds 0x0872fc80 = C rand() from seed 1 (41, 18467, 6334, 26500 checked), +-0x200 with `jbe 0x400`, Schrage x0x5e30 / x0x661f, `((z>>7)|1)+1` x 2^-24 (0x86c4c10), 0.01 draw floor 0x86c08a4, word 1024 = 0) -> bot-deviation.js whole file.
- AI-16 / AI-68 setBotSkill formula (0x085ee580 x87 re-derived) and WeaponTemplate defaults 5.0 / 10.0 / 0.1 (0x085ef936..0x085ef944) -> deviation.js:301-318, bot.js:346-351.
- AI-14 AISettings defaults: botSkill 0.75 (0x08484613), view distance 600 (0x084845f7), SAI update 2.0 (0x0848461a); setBotSkill no clamp -> bot.js:58,60; strategic-ai.js:90. (The viewer's 0.25..1.0 clamp at bot.js:80 is the menu's range, AI-20.)
- AI-33 frustum bands 0/.5/.75/1 (0x086ffed8), FOV 100/60/30 and 75/45/15, reset cos of 25/15/7.5 and 18.75/11.25/3.75 (static init 0x0852f36b..0x0852f41b) -> bot-sense.js FRUSTUM_*.
- Hearing (soundPerceptionCalculation 0x08523290): 3.0 s shot window, `((1-d) pMin + d pMax)(1-x) < rand`, x = max(speed/maxSpeed, 1), crouch/prone deaf (pose 2..3) -> bot-sense.js header, DEAF_AFTER_FIRE, SHOT_SOUND_WINDOW.
- updateHearingMemory 30 s (0x0852423d); updateMemory 60 s expiry (0x0852582a), fire list min(60/n, 5) (0x08525054..), attacker map max(300/n, 10) (0x085251ed..), hit x10 (0x085250b5) -> bot-sense.js constants.
- mouseControlLookAtDirection +-4.0 counts (0x086285e4 / 0x0862860d, 0x86c0304 / 0x86e9be0) -> bot-aim.js LOOK_COUNTS_MAX, AIM_COUNTS_MAX.
- Aimer::getFiringDirection: +-1.5393804 (0x87002e8), indirect (a + 1.5079645) x 0.5, step pi / (60 p + 5) -> bot-aim.js firingDirection (rounding aside, F4).
- correctAim 0x0853a6d0: 0.8, 0.1, 0.99, 10 -> bot-aim.js CORRECTION_*.
- infanteryControlTowardsDirection 0.5497787 (0x8705868) -> bot-route.js STEER_CONE.
- getNewIntermediatePathPos `cmpl $0x96` (0x0852afe2) / `cmpl $0x190` (0x0852af40) -> OBSTRUCTED_TICKS 150, PATH_FAIL_TICKS 401.
- updateLocalPath 10 + rand x 14 (0x86b9314, 0x86ffd78) -> LOCAL_SEARCH_RADIUS_*; ObstructionDetection 0.1 rad/s; getMaxPathPosRemovalDistance 0.99 x max(0.5, ...) -> CHANGE_ARRIVE; BBPGotoWaypointSoldier 4R -> REPLAN_GOAL_MOVE.
- decisionMaking hysteresis 0.87 / 1.15 (pushes at 0x08520c85/8a) and BotBehaviour ctor 1e-5 (0x3727c5ac) -> bot-decision.js.
- BBChange: 144 / 12 m (0x87023d4/d8), x1.25, 0.77, 4.0; calculateVehicleUrgency 0.15, 15 s ramp (1/15); move urgency 4.0 / 2.5 (0x08584310); calculateFireStrength 0.4 / 0.9 -> bot-vehicle.js CHANGE, bot-strength.js.
- BBPChange 12.5 (0x8702aa4), 12.375 = 12.5 x 0.99, 6.25 (push 0x0858e7be), behind -0.8 (0x0858def5); initObjectFinding 1.1; landing bail 4.0 (0x085608ea) -> bot-mount.js, bot-vehicle.js.
- BBFire::calculateUrgency constants (0.75, 20, 2, 30, 0.05, 0.5, 0.25, 1.5, 0.1, 1.2, 0.33, 0.9, 5, 60) -> bot-fire.js FIRE; createFirePlan 0.25 / 0.4 / 5 deg (0x3db2b8c2) / heat 0.8, 0.5 -> FIRE.aim*, heatStop/Resume.
- PlaneControl::towardsDirection 43, ln10, -0.833, 0.333, 0.866, 0.134, 0.9, 0.1, 18, 0.3, 9 (0x087058a8..) -> bot-vehicle-air.js TOWARDS.
- SAI: 0.83 / 1.2 doubles (0x8705dd0/d8), 1.25 / 1.5 doubles, 0.1, 0.8, 0.9, 1.1, 20 / 35 imm, orderAirBot 75 / 40 / 120 / 50 -> strategic-ai.js SAI.
- EntryTrigger AA test structure (F1) confirms AI-18 and AI-68.
- ~600 address citations name-checked against lnxded.static symbols by script: all resolve to the named function or a site inside it (call sites cited by their caller); no misnamed address found.


## Fix-phase additions (2026-11-12)

### F8 refined: Declein has no blend in retail
`DecleiningSlopeCurve::calculate` 0x08655560 computes its fraction as `fld %st(0); fsubp %st,%st(1)` (0x086555a6..0x086555ab): x100 less itself, so 0, with no `fildl` of the truncated index (contrast `SCurve::calculate` 0x08658465..0x08658475, which `fildl`s it and blends). The result is `table[clamp(trunc(100 x), 0, 99)]` (0x08655597 truncating control word, 0x086555b1 `cmpl $0x63`): a step curve. Implemented as such.

### F9 not implemented: the wanted strength is a learned, sampled quantity
Read 0x0863dd2c..0x0863e2cb of `AIStrategicArea::update` 0x0863d6d0. `+0xd4[side]` is a running integer, not recomputed from presence:
- each pass, Owned (+0x70[side] == 0): `trunc((2 - SCurve(+0xac[side])) x max(1, +0xd4[side]))` (0x0863de2b..0x0863de89); not Owned: `trunc((2 - SCurve(+0xb4[side])) x 1.25 x max(1, +0xd4[side]))` (0x0863dec3..0x0863df0b, 1.25 at 0x87023d0); `+0xb4[side]` is the ratio stored at 0x0863dd5c from 0x0863dd07's `fdivp`;
- then per object in the area `+0xd4[side] = trunc(+0xd4[side] + sample[status == 0])` (0x0863e0f1..0x0863e124 and 0x0863e28b..0x0863e2be), the sample array from `EnemyStatistics::sample` 0x0862dfa0 and `SampleHelper::addSample` 0x0862e0a0, which this pass did not read.
So `round(2 x present)` is wrong in form, but the replacement depends on `EnemyStatistics` / `SampleHelper` and on what `+0xac` holds. Stopped here per rule 4; needs a read of 0x0862dfa0 and 0x0862e0a0 and a new ledger row before code changes.

### Fire plan timeout and shot draw
No 3 s timeout constant in `createFirePlan` 0x085ac240 or `createPlan` 0x085a3870 (no 3000 / 0xbb8, no 3.0 load in createFirePlan; its timeouts are `unsigned long long` arguments built from registers). `createPlan` draws `2 + 3 x rand` (0x085a534e..0x085a5360: `fildl`, `fmuls 0x86c4c10` (2^-24), `fmuls 0x86c08c8` (3.0), `fadds 0x86c08c4` (2.0)): that is ledger AI-131's "2 to 5 pulses", which the bot-fire.js header already records as a deliberate departure (the viewer keeps 1 to 10, features/bot-weapons). Nothing changed; the 3 s timeout stays INCONCLUSIVE.

## Fixes applied

| Finding | Files and lines | Change |
|---|---|---|
| F1 | `viewer/bot-fire.js` header (the `EntryTrigger` bullet, ~l.61-70), `FIRE.aaPenaltyGround [30, 3]` / `aaPenaltyNaval [10, 1]` (replace the unused `vehicleExtra` / `vehicleOccupiedExtra`), new `aaPenalty({ shooterKind, targetAir, continuous })` before `weaponHeatHolds`; `viewer/bot.js` import (l.22) and the tick's AI-term block (~l.345-361) | the tick finds the plan's `Trigger` / `TriggerContinously` statement and passes `aaPenalty` to `deviation.setAIDeviation` (0 with no trigger statement, as retail adds it only from the trigger statements) |
| F2 | `features/bf1942-ai-spec/KNOBS.md:87`, `controls.md` (the `C` line and the "Research disagreement" paragraph, now the settled rule), `features/bf1942-ai-spec/README.md:163` (divergence row marked fixed) | doc |
| F3 | `viewer/bot-sense.js` both ray-count sites (`Math.round` -> `Math.trunc`), header bullet and `RAYS_*` comment; `features/bf1942-ai-spec/sensing.md:61`, `KNOBS.md:38`, `features/bf1942-ai-research-2026-09-21/bot-behaviours.md:36` | trunc |
| F4 | `viewer/bot-aim.js:567` and its comment (~l.552) | `Math.trunc(precision * 8 + 2)` |
| F5 | `viewer/strategic-ai.js:730`, `:821` (and comments ~l.720, ~l.775); `viewer/doctrine-landing.js:614` and its comment (`WPMoveToBeachLanding::getUrgency` 0x08537e50 rounds up the same way: `andl $0xfffff3ff` / `orl $0x800` / `frndint` at 0x08537ed0..0x08537ee1) | `Math.ceil(R)` |
| F6 | `viewer/bot-fire.js:329`, `:855` (and the doc bullet ~l.776) | `Math.trunc` |
| F7 | `viewer/bot-units.js` (import of `CHANGE` from bot-vehicle.js; the upright test ~l.372-380); `viewer/bot-vehicle.js` header and `CHANGE.upsideDownCos: 0.7071`; `KNOBS.md:213`, `bot-behaviours.md:445`, a dated note in `features/vehicle-collision-physics/README.md:341` | `upright = dot(hull up, heightfield.normal(x, z)) >= 0.7071`, world up where the page has no heightfield |
| F8 | `viewer/bot-behaviours.js` (the curve block ~l.43-106): `SCURVE_TABLE` / `sCurveExact` moved here from bot-sense.js (bot-sense.js re-exports them, so bot-behaviours.js keeps no imports and the test staging lists need nothing new); new `DECLEIN_TABLE` (101 floats from `DecleiningSlopeCurve::init` 0x08655170); `decleiningSlope` = `table[clamp(trunc(100x), 0, 99)]`, no blend; `sCurve` = `sCurveExact` | exact tables |
| F9 | none | stopped (see "Fix-phase additions") |

New test: `tools/bf1942-models/tests/test_bot_retail_parity.py` + `bot_retail_parity_harness.mjs` (the AA penalty per shooter and trigger kind; the spread at skill 0.75 rising by exactly 13.125 at an aircraft over the settled 0.3125; `bot.js` passing it; Declein's table and its no-blend steps; `sCurve` equal to the exact table). 5 tests, OK.

Suites run, from `tools/bf1942-models`: every `tests.test_bot*`, `test_strategic*`, `test_landing`, `test_doctrine`, `test_sim_*`, `test_vehicle_instance`, `test_deviation` (591 tests, OK, 34 skipped), and every test module that mentions `page_source`, `bot-units`, `bot-sense`, `bot-behaviours`, `bot-fire`, `strategic-ai` or `doctrine-landing` (19 modules, 486 tests, OK, 3 skipped). No existing test encoded an old value. (A first run failed in four staged harnesses because bot-behaviours.js imported bot-sense.js; moving the SCurve table into bot-behaviours.js fixed it without touching their module lists.)

## DICE trace changes

Method: `sim/run.mjs` (runner defaults: `sai` doctrine, skill 0.75), 120 s, `--trace-every 3`, seeds 1-3, 8 and 16 a side, with vehicles and `--no-vehicles`, on Berlin, Stalingrad, Kharkov, Bocage, Midway and Gazala (72 matches), maps and models from `~/.cache/bfstats-mesh-remote`. Market Garden could not be run: that cache has no `market_garden/scene.glb` (and no other local tree has it). "Before" is a snapshot of the viewer's code taken before the first edit; "after" is that same snapshot with only my nine changed viewer files copied in (`scratchpad/dice/viewer-all`): other sessions changed about 30 viewer files (armor, vehicle-damage, tracked-vehicle, world-damage, ...) while this ran, and a run against the live viewer would have mixed their changes in. Hash = the first 12 hex digits of `summary.trace.sha256`.

Result: 66 of 72 traces moved; the 6 unmoved are all of Midway on foot (the bots never leave the carriers there: 1,320 route failures, no sighting, no fight, only MoveTo; nothing a fix touches runs).

Attribution: leave-one-out on the 8-a-side seed-1 match of every level and both configurations: the full fix set with one fix reverted (`viewer-noF<n>`); an X means reverting that fix changes the trace, so that fix moved it.

| match | F1 | F3 | F4 | F5 | F6 | F7 | F8 |
|---|---|---|---|---|---|---|---|
| berlin-foot-8-s1 | . | X | . | X | . | . | X |
| berlin-veh-8-s1 | . | X | . | X | . | . | X |
| bocage-foot-8-s1 | . | X | . | X | . | . | X |
| bocage-veh-8-s1 | X | X | . | X | . | X | X |
| gazala-foot-8-s1 | . | . | . | X | . | . | X |
| gazala-veh-8-s1 | X | X | . | X | . | . | X |
| kharkov-foot-8-s1 | . | . | . | X | . | . | X |
| kharkov-veh-8-s1 | X | X | . | X | . | X | X |
| midway-foot-8-s1 | . | . | . | . | . | . | . (unmoved) |
| midway-veh-8-s1 | . | . | . | X | . | . | X |
| stalingrad-foot-8-s1 | . | . | . | X | . | . | X |
| stalingrad-veh-8-s1 | . | X | . | X | . | . | X |

Every moved trace in the sample has a named fix behind it, and each pattern fits the fix. F5 (ceil arrival radius) and F8 (exact curves, in every urgency) move every match where the bots move. F3 (one ray fewer in some distance bands) moves the ones with sightings at those ranges. F1 moves only levels with aircraft (Bocage, Gazala, Kharkov with vehicles). F7 moves only Bocage and Kharkov with vehicles, where a hull's up against the terrain normal gives a different answer from its up against world up (a hull on a static over steep ground, a banking plane; see "Bars rebuilt"). F4 and F6 move nothing: no vanilla precision has frac(8p) >= 0.5 and no vanilla strength is fractional. The other 54 moved traces (seeds 2-3 and 16 a side) were not ablated one by one; they are the same levels and configurations, and F5 and F8 alone account for a move in each.

Full before/after table (72 rows) below.

| match | before | after | |
|---|---|---|---|
| berlin-foot-16-s1 | 0c48c6d0bd80 | 819872d1b439 | moved |
| berlin-foot-16-s2 | ec304ba9885b | a4e7a5807afe | moved |
| berlin-foot-16-s3 | 0f17f4e68558 | 224a4d95f574 | moved |
| berlin-foot-8-s1 | d917d89dd165 | e66cb7a09e6d | moved |
| berlin-foot-8-s2 | eb213476f0cf | 0055a646b0c8 | moved |
| berlin-foot-8-s3 | 25323e637e15 | 8bf81d7ff446 | moved |
| berlin-veh-16-s1 | 76e23cedb7d4 | 6794e6666275 | moved |
| berlin-veh-16-s2 | 83ca1d8702d1 | 056211dfe22f | moved |
| berlin-veh-16-s3 | 14f913632ddb | 29ebad786ac7 | moved |
| berlin-veh-8-s1 | 89bfb629f795 | bdf2d0ee15cd | moved |
| berlin-veh-8-s2 | a37cce64f1d3 | 4358f6cfb3bb | moved |
| berlin-veh-8-s3 | 9a5ae44125d8 | 5769bfdd61f3 | moved |
| bocage-foot-16-s1 | 74fa50559594 | 6b20cf5f24bd | moved |
| bocage-foot-16-s2 | 1ac5057177ff | 19f8f941c100 | moved |
| bocage-foot-16-s3 | ba939572785b | 05e3a5742d60 | moved |
| bocage-foot-8-s1 | d4071aab7a9f | b7dda28063b5 | moved |
| bocage-foot-8-s2 | 3422ddca8e43 | 1faee8a72913 | moved |
| bocage-foot-8-s3 | c414bdb9926b | 809ef4d2d413 | moved |
| bocage-veh-16-s1 | 54c2ccf04a4c | 4f876cddd35b | moved |
| bocage-veh-16-s2 | fccc1254167f | 19d0e64c6ed2 | moved |
| bocage-veh-16-s3 | 6a39f6c311bd | 02cb5a1ed51a | moved |
| bocage-veh-8-s1 | a3399a2f9841 | 6b35486305d9 | moved |
| bocage-veh-8-s2 | fb3631581c7f | 7fe8ccf7d917 | moved |
| bocage-veh-8-s3 | 16bccb4bd321 | 2e83d350faee | moved |
| gazala-foot-16-s1 | 17272bc4b66f | cf9a46bd1317 | moved |
| gazala-foot-16-s2 | 817c07f472d7 | cc948a148855 | moved |
| gazala-foot-16-s3 | 4567f33a96ca | a618634ca058 | moved |
| gazala-foot-8-s1 | 1fbf3562a239 | 4f335e74fbcd | moved |
| gazala-foot-8-s2 | 85d0848f07d9 | 977ec3b7feed | moved |
| gazala-foot-8-s3 | d8b29b257bb7 | 7785e2f90bdb | moved |
| gazala-veh-16-s1 | 6be9354bf701 | 517a38cbc450 | moved |
| gazala-veh-16-s2 | e748d542a464 | 4dfec824447e | moved |
| gazala-veh-16-s3 | be919ab1d538 | c20fdd5be465 | moved |
| gazala-veh-8-s1 | e95553930bc3 | 700bc6707bba | moved |
| gazala-veh-8-s2 | b7cbc8043a59 | 15176cc341e6 | moved |
| gazala-veh-8-s3 | aed2556cec2a | e1d1c75ff937 | moved |
| kharkov-foot-16-s1 | e4e60ef769d3 | d0d04b3e9754 | moved |
| kharkov-foot-16-s2 | 8d3ef55737b0 | 606f28ad1127 | moved |
| kharkov-foot-16-s3 | 1b350ca8c963 | 72dfb5bf9cf1 | moved |
| kharkov-foot-8-s1 | 1fe9ecf24474 | 73cb3b095458 | moved |
| kharkov-foot-8-s2 | e795131cce40 | 29af3ae2cf9c | moved |
| kharkov-foot-8-s3 | f08cacd8e171 | d70f3c3441c2 | moved |
| kharkov-veh-16-s1 | 001166ac0ad8 | e6d1a78afb31 | moved |
| kharkov-veh-16-s2 | deea75bc8145 | 2ee802f78b6d | moved |
| kharkov-veh-16-s3 | 61ee08e2c137 | 7b04f6027784 | moved |
| kharkov-veh-8-s1 | a6f70b61394d | 7f64bbfc9ae4 | moved |
| kharkov-veh-8-s2 | b34fe5feff2c | fdaafa100efc | moved |
| kharkov-veh-8-s3 | a5e268a493d3 | becab2133dbf | moved |
| midway-foot-16-s1 | ecbb23f01f88 | ecbb23f01f88 | identical |
| midway-foot-16-s2 | b4115cc5250e | b4115cc5250e | identical |
| midway-foot-16-s3 | 295416d52e52 | 295416d52e52 | identical |
| midway-foot-8-s1 | 71fd6a2797e6 | 71fd6a2797e6 | identical |
| midway-foot-8-s2 | 639bb988faf5 | 639bb988faf5 | identical |
| midway-foot-8-s3 | 8cecac104204 | 8cecac104204 | identical |
| midway-veh-16-s1 | e447bebb7f3b | 2cb28003969f | moved |
| midway-veh-16-s2 | bad0cc2de959 | 6c487615307e | moved |
| midway-veh-16-s3 | 60a2e64d20ce | 95f0254d07ec | moved |
| midway-veh-8-s1 | d9976b1c37c8 | 031fe0a253bf | moved |
| midway-veh-8-s2 | 7033447e33c8 | 3b12a23f0c15 | moved |
| midway-veh-8-s3 | e2a277172e56 | 8862adfe4417 | moved |
| stalingrad-foot-16-s1 | 6a8be96db4cf | 915da56015a6 | moved |
| stalingrad-foot-16-s2 | 88339d58859b | 632eeab0e6c6 | moved |
| stalingrad-foot-16-s3 | 35a98c4e1073 | 30575ca4a7a7 | moved |
| stalingrad-foot-8-s1 | cde56e6bda37 | 3233c402b47d | moved |
| stalingrad-foot-8-s2 | 83a99264a7b5 | 8209e9e62d25 | moved |
| stalingrad-foot-8-s3 | c68407bca13e | e7f8047a7794 | moved |
| stalingrad-veh-16-s1 | 5a7bb02a8921 | 4f737575e47d | moved |
| stalingrad-veh-16-s2 | 4cc67c32cda4 | 8d70a5bd32e3 | moved |
| stalingrad-veh-16-s3 | 87af912e7c47 | 85eac0b8587d | moved |
| stalingrad-veh-8-s1 | 2bce381d2c9d | 386e1b311b56 | moved |
| stalingrad-veh-8-s2 | f187a69dbe49 | 99a337ccc5b7 | moved |
| stalingrad-veh-8-s3 | 41fdd4f8f1e7 | 2fda48c8a173 | moved |

## Ledger edits

Ready to paste; the coordinator applies them (`features/bf1942-engine-reference/ledger.md`).

**AI-36** (row 1530): replace the tail "`EntryTrigger` hands `setBotSkill(botSkill, firingTargetTime, extra)` with extra 0 / 30 / 10" with:
> `EntryTrigger` hands `setBotSkill(botSkill, firingTargetTime, C)` with C the anti-aircraft penalty of AI-18 (0 unless a shooter whose equipment is not ITAir fires at an ITAir target; then 10 from ITNaval equipment or when the equipment's vt+0x6c predicate holds, else 30; `EntryTriggerContinously` 1 / 3). *Corrected 2026-11-12: the earlier "0 infantry / 30 vehicle / 10 primary-occupied" read the same three branches without their key (`testb $0x10,0x4` on the equipment at 0x08625d87 and on the target at 0x08625e18, `testb $0x40` at 0x08625e64, pushes 0x41200000 at 0x08625e8c and 0x41f00000 at 0x08625eb8; continuous 0x3f800000 at 0x0862656a, 0x40400000 at 0x08626593).* Viewer: `bot-fire.js aaPenalty`, passed by `bot.js` tick (before 2026-11-12 never passed, C = 0).

**AI-18** (row 1512): append to the status cell: "**settled 2026-11-12 on lnxded.static** (bots-ai cross-check): the reading above holds, AI-36's disagreement is withdrawn; the viewer now passes it (`bot-fire.js aaPenalty`)."

**AI-44** (row 1538): replace "not upside down (0x0855fcf0: up · normal < 0.6914)" with:
> not upside down (`isUpsideDown` 0x0855fcf0: the hull's up, its matrix row +0x10, dotted with the ground normal the environment's vt+0xa8 returns at the hull's x, z, below the threshold its caller pushes, `0x3f350481` = 0.7071, cos 45 deg, at 0x0855f2ad and 0x0855f606; ~~0.6914~~, a value the binary does not hold, corrected 2026-11-12)

and add to the evidence cell: "`viewer/bot-units.js` upright test: `dot(up, heightfield.normal) >= CHANGE.upsideDownCos` (0.7071) since 2026-11-12; before, world up >= 0.6914."

**AI-33** (row 1527): where it gives the ray count, make it `n = clamp(trunc(30 r / d), 1, 10)` and add: "truncated: `BotMain::sense` 0x08521cf0 converts with `fistpl` at 0x08522281 under the control word 0x08522272 sets to truncate (`movb $0xc,%ah`); d = 0 gives 1e14 (0x86ffd70), so 10. The linux dump's `sense.c:400` shows `ROUND`, Ghidra's x87 default (RE-WRONG). Viewer `bot-sense.js` used `Math.round` until 2026-11-12."

**New row, AI-1xx (next free id): the curve tables.**
> | AI-1xx | **SCurve blends its table; DecleiningSlope does not.** `SCurve::calculate` 0x08658420: 0 below 0, 1 from 1, else `(1 - f) t[i] + f t[i+1]` with `i = trunc(100 x)` (0x08658457 truncating control word, `fildl` of i at 0x0865846f, `fsubrp` 0x08658475); its 101 floats from `SCurve::init` 0x08658030. `DecleiningSlopeCurve::calculate` 0x08655560: `i = clamp(trunc(100 x), 0, 99)` (0x08655597, `cmpl $0x63` 0x086555b1) and the fraction `fld %st(0); fsubp` (0x086555a6..0x086555ab) is x less itself, 0, so the result is `t[i]`: a step curve over the 101 floats `DecleiningSlopeCurve::init` 0x08655170 writes (`0x3cef8d24` at +4 ... `0x3f800000` at +0x190) | **verified** (2026-11-12, objdump) | `viewer/bot-behaviours.js` `SCURVE_TABLE`, `sCurveExact`, `DECLEIN_TABLE`, `decleiningSlope`; before 2026-11-12 both were 5- and 8-point linear sketches (SCurve up to 0.054 off at x = 0.37) |

**New row, AI-1xx: WPMoveTo rounds the radius up.**
> | AI-1xx | **A waypoint's arrival radius is `ceil(R)` plus the bot's removal distance.** `WPMoveTo::getUrgency` 0x085374a0 loads R (+0x8) and runs `frndint` under a control word with RC = 10 (`andl $0xfffff3ff` / `orl $0x800`, 0x085374ce..0x085374df), round up; `WPMoveToBeachLanding::getUrgency` 0x08537e50 the same (0x08537ed0..0x08537ee1) | **verified** (2026-11-12, objdump) | `viewer/strategic-ai.js` order `urgency`, `_captureRing`; `doctrine-landing.js` route pop; `Math.round` before 2026-11-12 |

**New row, AI-1xx (or fold into the Aimer row): the Aimer's halving count** — "`Aimer::getFiringDirection` 0x08538ad0 stops after `trunc(8 precision + 2)` halvings (`fmuls 8.0` 0x08538b78, `fadds 2.0` 0x08538b99, `fistpll` 0x08538be3 under the truncating word at 0x08538bd4)"; viewer `bot-aim.js firingDirection`.

**New row, AI-1xx: the mounted-infantry Fire score truncates the seat strength** — "`BBFire::calculateUrgency` 0x08563570 truncates `table[type]` before adding (`fistpl` 0x08564738 under 0x0856471d's truncating word, then `fildl`, `fadds 0x14(%ebx)`, `fadds table`)"; viewer `bot-fire.js` `scoreMountedInfantry`, `scoreTargets`.

**New row, AI-1xx (open): a held area's wanted strength** — "`AIStrategicArea::update` 0x0863d6d0 keeps `+0xd4[side]` as a running integer: each pass `trunc((2 - SCurve(+0xac[side])) x max(1, wanted))` when Owned (0x0863de2b..0x0863de89), `trunc((2 - SCurve(+0xb4[side])) x 1.25 x max(1, wanted))` otherwise (0x0863dec3..0x0863df0b), then `+= sample[status == 0]` per object (0x0863e0f1..0x0863e124, 0x0863e28b..0x0863e2be) from `EnemyStatistics::sample` 0x0862dfa0 / `SampleHelper::addSample` 0x0862e0a0 (not read). **open**; the viewer's `round(2 x present)` (`strategic-ai.js:361`) is not this."

## Bars rebuilt (rollout step 4)

DICE's traces moved, so `tools/bf1942-models/sim/baselines/onfoot-dice.json` and `vehicles-dice.json` were rebuilt (`botbatch.mjs baseline`, four levels, 8 and 16 a side, seeds 1-10, 600 s, garrison doctrine, 80 matches each) on the pre-edit snapshot plus my nine files only (`scratchpad/dice/tb`, its `viewer` linked to `viewer-all`), so other sessions' uncommitted viewer work is not in the bars. `page-dice.json` (pagematch) and the mod bars were not touched. Tests `test_bot_bars`, `test_bot_judge_sides`, `test_bot_judge_vehicles`, `test_bot_layer`, `test_sim_match`: 141 OK.

On-foot bar: small moves (p50 route failures 0.039 -> 0.021 at 8, 0.073 -> 0.150 at 16; kills, captures, traps flat).
Vehicles bar: large moves at both sizes. Route failures p50 0.081 -> 0.314 (8) and 0.119 -> 0.690 (16), stuck seconds roughly x2, `tankSilentShare` 0.09 -> 0.15, `mountedShare` 0.71 -> 0.64.

**What moves the vehicles bar is F7.** A probe (Kharkov and Bocage, 8 a side, seeds 1-3, 600 s, garrison) gives route failures of before 4-37, all fixes 66-304, all-but-F7 14-64, all-but-F5 67-265, all-but-F8 61-450. F7's rule is the binary's: `isUpsideDown` dots the hull's up with `BFEnvironment::getNormal` 0x085e50e0, which is `terrainBase` (0x087435f0) vt+0x50, the **terrain** normal (vtable for BFEnvironment +0xa8 resolves to `getNormal`). A logged run shows the cause. A level PanzerIV sitting on a static over steep ground (up (0.16, 0.99, 0), terrain normal (-0.73, 0.68, 0.02)) now reads as upside down. `bot-mount.js:202` then zeroes its crew's "staying" and they bail and re-route, where world up called it upright. Banking aircraft also read differently, now against the ground under them. I kept F7 because it is what retail computes. But the viewer's own-hull use of `upright` (`bot-mount.js:202`, pre-existing) was not checked against which Information the second `isUpsideDown` call (0x0855f606) tests. If the coordinator wants the vehicles bar left alone, the change to revert is F7's line in `bot-units.js` (and `CHANGE.upsideDownCos` back to 0.6914); the other fixes do not move these numbers much.

## F7 check

**(1) The normal and the frame.** The `IAIEnvironment` slot `isUpsideDown` calls (vt+0xa8, 0x0855fd24) is, in `vtable for dice::bf::ai::BFEnvironment` (0x08761580 + 8 + 0xa8), `BFEnvironment::getNormal(float, float, Vec3&)` 0x085e50e0. That function loads `dice::ref2::geom::terrainBase` (0x087435f0) and tail-calls its vt+0x50, which in `vtable for PatchTerrain` (0x08748fa0 + 8 + 0x50) is `PatchTerrain::getNormal(float, float, Vec3&)` 0x083d6b30 (+0x54 is `getHeightAndNormal`, +0x58 `getSlope`). So it is the heightmap normal at the object's (x, z), with statics ignored, not the contact surface. The x and z passed are the Information position's [0] and [2] (`call *0x1c` then `(%eax)`, `0x8(%eax)` at 0x0855fd13..0x0855fd23). The up is the object's matrix row +0x10.

In the viewer, `Heightfield.height(x, z)` takes the page's (x, z) and negates z itself (`const v = -z / this.spacing`, heightfield.js `height`). `normal(x, z)` differentiates `height` in the page's x and z, so the normal comes out in the page's frame. `_up` is the hull node's world quaternion applied to (0, 1, 0), also the page's frame. A z flip changes the sign of both z components, so the dot is the same in either frame. Spot check at spawn on Kharkov: every hull's up and the normal under it agree component by component (Hanomag up (-0.022, 0.999, -0.034), normal (-0.003, 1.000, -0.011); T34-85 up (-0.015, 1.000, -0.015), normal (-0.004, 1.000, -0.018)).

**(2) Kharkov, 16 a side, seed 1, 600 s, garrison, with vehicles (all fixes, before the air/gun exemption below).** Every hull test where either rule says upside down was logged: 6,720 samples.
- Ground and tank hulls flagged by the new rule: 4,507 samples. **4,462 of them (99%) are within 40 m of Kharkov's two `stonebridge_sml_M1` statics** at (600.6, 97.6, -536.4) and (427.1, 97.6, -532.6). Example: T34-85 at (407.7, 104.7, -535.3) on the bridge deck, hull up (-0.179, 0.984, 0.005), so 10 deg from level. The terrain normal of the bank below it is (0.652, 0.719, 0.24), a 44 deg slope; dot 0.592. Across those samples, terrain slope is median 52 deg (28 to 69) and hull tilt median 9 deg (0 to 35). The hulls sit 0.4 to 21 m above the terrain, median 8.3 m. That is 68 separate episodes (gaps over 2 s), spread over every ground hull type on the level.
- The other 45 samples are one PanzerIV_1 genuinely rolled on flat ground (normal (0.002, 1, -0.015), up down to (0.83, -0.32, -0.46)). The old rule flags it too.
- No hull on an ordinary terrain slope is flagged. Every sample where the hull rests on the terrain has its up within a few degrees of the normal.
- Aircraft: 1,921 flying samples were judged against the ground under them (both rules flipped back and forth in banked turns; the old world-up rule had flagged 1,901 of them).

So the move is retail behaviour, not a frame bug. Retail's terrain-only normal reads a level hull on a stone bridge over a steep bank as upside down. The own-unit test then sets "staying" to 0 and puts the bot's urgency on foot in play (0x0855f633..0x0855f641, then 0x0855e7f7..0x0855e892 `calculateVehicleUrgency` for the soldier). The crew bails mid-bridge, which is where the route failures come from. The viewer's `bot-mount.js:202` does the same thing.

**What the read changed in F7.** Neither call tests an aircraft, and the candidate call tests only mobile units:
- the candidate test (0x0855ed0c..0x0855ed25) runs only when the unit's Information has a Mobile plug-in (+0x2c non-null) and is neither ITAir (`testl $0x10`) nor ITSoldier (`testl $0x400000`);
- the own-unit test is skipped for ITAir equipment (0x0855e7a6 `testb $0x10,0x4(%edi)`, `jne 0x0855e7b9`).

`bot-units.js` now sets `upright = true` for `kind === 'air'` and for `kind === 'gun'`, the fixed guns the page already marks `mobile: kind !== 'gun'` (that the gun templates carry no Mobile plug-in is INFERRED from that existing mapping). Before this, both the old world-up rule and the first F7 cut judged a banking plane, and retail never does. Re-probe on Kharkov and Bocage, 8 a side, seeds 1-3, 600 s:

| route failures | s1 | s2 | s3 |
|---|---|---|---|
| Kharkov, before | 13 | 17 | 37 |
| Kharkov, all-but-F7 | 20 | 14 | 14 |
| Kharkov, all with F7 + exemption | 304 | 376 | 175 |
| Bocage, before | 27 | 4 | 8 |
| Bocage, all-but-F7 | 15 | 64 | 15 |
| Bocage, all with F7 + exemption | 104 | 66 | 88 |

The rise is the bridge bail. It is what the binary computes, so I keep it. The ledger AI-44 edit gains the exemption (below). Tests re-run after the change: the bot, strategic, sim, landing, doctrine, vehicle-instance and deviation suites, 591 OK, 34 skipped. The bars were **not** rebuilt again, as asked. The bars installed earlier came from the first F7 cut, with no air/gun exemption, so they are stale either way until the coordinator's final rebuild.

**Ledger edit, AI-44 (addition to the replacement above):** "Neither call tests an aircraft: the candidate test runs only for a unit whose Information has a Mobile plug-in (+0x2c) and is neither ITAir nor ITSoldier (0x0855ed0c..0x0855ed25), and the own-unit test is skipped when the bot's equipment is ITAir (0x0855e7a6). An upside-down own unit gets staying urgency 0 and its on-foot urgency is weighed (0x0855f633..0x0855f641, 0x0855e7f7..). `getNormal` is `BFEnvironment::getNormal` 0x085e50e0 -> `PatchTerrain::getNormal` 0x083d6b30: terrain only, so a hull on a bridge over a steep bank reads as upside down (measured on Kharkov's two stone bridges, 2026-11-12)."

## AI-45 check (the bot tank's drive law, for the M1A1 cruise question)

Read `TankControl::controlTowardsDirection` 0x0862c670 on lnxded.static (objdump; all constants by readmem). Verdict: **the viewer's `tankControl` (bot-vehicle.js:157-194) matches the binary in its constants and structure. No porting error found; nothing changed; the cruise test was not touched.**

- **Angle.** `A = -arg+0x28` (`fchs` 0x0862c9cd), with the incoming angle's sign flipped when the hull moves against a non-zero drive (`xorb $0x80,0x2b(%ebp)` 0x0862c9c2). Viewer: `if (drive !== 0 && sign !== drive) angle = -angle`.
- **Yaw rate.** `R = dot(vt+0x18 vector, matrix row +0x10)` (0x0862d146..0x0862d175): the angular velocity about the hull's up. Viewer: `yawRate: -w.y` (bot-route.js:1041, bot-plans.js:929). The page's z is the engine's negated, and that reflection flips an axial vector's y (ω'_y = det(M)·(Mω)_y = -ω_y), so `-w.y` is the engine's R. Empirically, on 8 tanks of a Kharkov run, the angle moves against the passed rate in 3,710 of 5,827 tick pairs, so the term damps.
- **Steer.** `q = R / (30.0 |A| + 1.0)` (`fmull 0x87046e8` = 30.0 and `faddl 0x86c52b0` = 1.0, both doubles, 0x0862d17f..0x0862d18b). `q` is stored to float (0x0862d195) and clamped to [-10, 10] (`flds 0x86e24d4` = -10.0, `0x86b9314` = 10.0). Then `steer = -A - q` (0x0862d1b4..0x0862d1bf), which is `angle_in - q` in the viewer's terms; clamped to [-1, 1] (0x0862d2de..0x0862d316) and written to ControlInfo +0x54 (0x0862d346..0x0862d368). The viewer has the same 30 (`speedDamping`), 10 (`dampingCap`), unit gain, and ±1 clamp. There is **no deadband and no rounding in the law**; the hundredth rounding is TANK-24's, downstream in the input layer.
- **Throttle.** `wanted = 20 (1 - SCurve((slope + ...) x ControlInfo+0x4c))` (0x0862ce11, 0x0862d1e0..0x0862d1fa), floored at 2.0 (0x0862d206..0x0862d21d), divided by `|roll rate| x 10.0 + 1` (0x0862d25d..0x0862d26b), capped at arg+0x20 (maxSpeed), times arg+0x24 (drive), minus speed. Then `damp = speed / (|delta| x 30 + 1)` clamped ±10 (0x0862d29f..0x0862d2d2), and `throttle = clamp(2 (delta - damp), ±1)` (`fadd %st(0)` 0x0862d2e8), written to +0x50. The viewer's TANK constants (20, 2, 10, 30, 10, 2) all match.
- **Precision (one difference, not a porting error).** Retail rounds `q` to a float before the clamp and keeps the rest of the law in x87 extended precision with float stores; the viewer computes in doubles. At a knife edge between limit cycles (BOX_AREA 0.78520 vs 0.78530), a last-bit difference like this could pick the basin. It is not something the law's structure decides.
- **Slope term units (aside).** The slope probe (0x0862cf12..0x0862d121: `acos` x 57.2957 into degrees, the probe parameter stepping by 0.05 up to 1) feeds `SCurve(... x ControlInfo+0x4c)` in degrees. The viewer's `slopeGain: 1.0` is already labelled INVENTION. It plays no part on the flat cruise in question.

So the ±0.01 / ±0.02 hunt is what this law does through TANK-24's hundredth steer, not a constant or sign error in AI-45. Whether retail sits in the ±0.01 basin at 0.785 can only be read off the lab's per-tick steer words for an M1A1 bot. The coordinator decides the test.

## Final DICE run

**Tree.** The working tree as it stood after "go", copied to `scratchpad/dice/viewer-final` so no edit could land mid-run. sim/ and server/ were the repo's. Same matrix as before: `sim/run.mjs` defaults (`sai`, skill 0.75), 120 s, `--trace-every 3`; Berlin, Stalingrad, Kharkov, Bocage, Midway, Gazala; with vehicles and on foot; 8 and 16 a side; seeds 1-3; 72 matches. Market Garden is still not runnable (no `scene.glb` in any local tree).

**Variants used for attribution.** Each is a full 72-match matrix:
- `before2`: the pre-edit viewer snapshot on today's sim/server. It equals the first `before` run in 72 of 72, so the sim/server changes since then (botbatch.mjs, server/level-*.mjs) move nothing.
- `final`: the working tree.
- `finalNoMine`: the working tree with my nine files put back to the snapshot. This isolates the other verifiers' changes.
- `after2`: the snapshot plus my nine files only. It differs from the first `after` run in exactly 2 matches (gazala-veh-16-s2, kharkov-veh-8-s2), both from F7's later air/gun exemption.

**Result.** 66 of 72 traces moved, and every move is explained.
- **Unmoved: the 6 Midway on-foot matches.** The bots never leave the carriers, so nothing any fix touches runs.
- **My fixes move 66 of 66** (`final != finalNoMine` in every moved match). The per-fix pattern is the leave-one-out table in "DICE trace changes": F5 and F8 in every match where the bots move; F3 where they spot at range; F1 on the levels with aircraft; F7 (bridges, now with the air/gun exemption) on Bocage and Kharkov with vehicles. F4 and F6 move nothing.
- **The other verifiers' changes move 60 of 66** (`finalNoMine != before2`). The 6 they leave alone are berlin-veh-8-s2, gazala-foot-8-s2, stalingrad-veh-16-s2 and three Midway on-foot matches. Per-file ablation:
  - **On foot (all 36 on-foot matches except Midway's and gazala-foot-8-s2): damage-armour F3**, `vehicle-hits.js botRoundDamage` priced through `crash-damage.js materialDamage` / `damageModifier`. Reverting that one file gives back the before2 hash (berlin-foot-8-s1, stalingrad-foot-16-s2). Reverting it together with five other files gives back all of them.
  - **With vehicles:** adding one changed file to the snapshot moves Kharkov / Gazala through `aircraft.js` (air-sea F1, engine defaults), `armor.js` + `vehicle-damage.js` (damage-armour F1/F2: upside-down and water HP loss, water delay), `round-impact.js` (damage-armour F3, DMG-1's missing cell = 0), `amphibious.js` (Kharkov), and `body-float.js` (Kharkov, Gazala, Midway). `vehicle-hits.js` alone reproduces Berlin's vehicle move. `world-damage.js` cannot be added alone (it needs the armor.js additions).
- **Gravity.** `rigid-body.js` differs from the snapshot only in its comment: its `GRAVITY` was already -14.73. On its own it moves nothing, and no ablation names it. What moves is `body-float.js`, whose `GRAVITY` went from its own -14.7295379 to rigid-body's -14.73 (air-sea F3). body-float's `floatAcceleration` is the float law for ships (Midway), for aircraft floats, and, through `body-ground.js`, for ground hulls in water. So Kharkov's river and Gazala's coast move, and Midway's ships move. That is buoyancy, not the ground hulls' gravity. The flight law's held -14.7295379 (`aircraft.js FLIGHT_GRAVITY`, `aircraft-ground-law.js`) is unchanged from the snapshot.

**A regression found while rebuilding the bars (not mine; for the damage-armour owner).** On the final tree, bots on foot all but stop killing. `onfoot-dice` enemy kills per bot-minute fell from p50 0.874 to 0.016 (8 a side) and from 0.965 to 0.014 (16); `vehicles-dice` from 0.363 to 0.141 (8) and 0.511 to 0.147 (16). Before2 berlin-foot-8-s1 has 19 kills; final and finalNoMine have 0; finalNoMine with `vehicle-hits.js` reverted has 19 again. The cause is damage-armour F3's new `botRoundDamage`. A probe in that function (`viewer-dbg3`) prints `attacker=null defender=41 base=30 mod=0.001` on every bot round. The round's attacker material is unresolved (`page.guns.attackerMaterial(spec)` is null for the bots' weapon data). The new code then reads that as material 0, whose cell against the chest's def group is 0.001, so a round does 0.03 HP. The old code fell back to 1 for a missing pair, so 30 HP. Retail's "unknown id = material 0" may be right in itself, but here the null is a plumbing gap (the bot's round spec carries no material), not an unknown id. The same `stats` reach the live page through `bot-referee.js fireRays`, so the page's bots are likely as harmless. I did not fix it (not my file). It needs either the bots' round material resolved, or `botRoundDamage` keeping its old fallback while `attacker` is null.

**Bars.** I rebuilt `sim/baselines/onfoot-dice.json` and `vehicles-dice.json` on the final tree (`botbatch.mjs baseline`, 80 matches each). Those bars encode near-zero-kill bots, so they would pass a level with harmless bots and fail one that fights. I saved them to `scratchpad/dice/bars-final-tree/` and **put the committed (HEAD) bars back in the working tree** (`git show HEAD:... >`, the two files only; nothing staged). Once the regression above is fixed, the rebuild is `cd tools/bf1942-models && node sim/botbatch.mjs baseline --maps ~/.cache/bfstats-mesh-remote/maps --models ~/.cache/bfstats-mesh-remote/models --levels berlin,stalingrad,kharkov,bocage [--vehicles] --jobs 8`, about 25 min for both. For reference, the bars built on my fixes alone (`scratchpad/dice/tb/sim/baselines/`, the first F7 cut) are in "Bars rebuilt" above.

**Suites on the final tree:** every `tests.test_bot*`, `test_strategic*`, `test_landing`, `test_doctrine`, `test_sim_*`, `test_vehicle_instance`, `test_deviation`: 591 tests OK, 34 skipped. With the bars put back: `test_bot_bars`, `test_bot_judge_sides`, `test_bot_judge_vehicles`, `test_bot_layer`: OK.

Per-match table (hash = first 12 hex of `summary.trace.sha256`):

| match | before (pre-edit) | final | moved | by my fixes | by other verifiers |
|---|---|---|---|---|---|
| berlin-foot-16-s1 | 0c48c6d0bd80 | 45b5a9c1daa4 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| berlin-foot-16-s2 | ec304ba9885b | 9f2931d0ef3a | moved | yes | damage-armour F3 (vehicle-hits.js) |
| berlin-foot-16-s3 | 0f17f4e68558 | 4b34cd845bce | moved | yes | damage-armour F3 (vehicle-hits.js) |
| berlin-foot-8-s1 | d917d89dd165 | 4bef2d911344 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| berlin-foot-8-s2 | eb213476f0cf | 62208c796368 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| berlin-foot-8-s3 | 25323e637e15 | 9f6fe4b6522e | moved | yes | damage-armour F3 (vehicle-hits.js) |
| berlin-veh-16-s1 | 76e23cedb7d4 | 17ae6147dc60 | moved | yes | see attribution |
| berlin-veh-16-s2 | 83ca1d8702d1 | 7c45329f319f | moved | yes | see attribution |
| berlin-veh-16-s3 | 14f913632ddb | 1c1e90f0a116 | moved | yes | see attribution |
| berlin-veh-8-s1 | 89bfb629f795 | efb0659914dc | moved | yes | see attribution |
| berlin-veh-8-s2 | a37cce64f1d3 | f8d2872c7a64 | moved | yes | . |
| berlin-veh-8-s3 | 9a5ae44125d8 | 5916fa1f1c29 | moved | yes | see attribution |
| bocage-foot-16-s1 | 74fa50559594 | 617e223ce190 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| bocage-foot-16-s2 | 1ac5057177ff | 21c9134e3386 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| bocage-foot-16-s3 | ba939572785b | 8077c05c8e1c | moved | yes | damage-armour F3 (vehicle-hits.js) |
| bocage-foot-8-s1 | d4071aab7a9f | ef3172b11ba7 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| bocage-foot-8-s2 | 3422ddca8e43 | 6c69e095e76b | moved | yes | damage-armour F3 (vehicle-hits.js) |
| bocage-foot-8-s3 | c414bdb9926b | f17b3fda4374 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| bocage-veh-16-s1 | 54c2ccf04a4c | eb2ff10d3e20 | moved | yes | see attribution |
| bocage-veh-16-s2 | fccc1254167f | 62d79bbaf1f8 | moved | yes | see attribution |
| bocage-veh-16-s3 | 6a39f6c311bd | 77f23d54e903 | moved | yes | see attribution |
| bocage-veh-8-s1 | a3399a2f9841 | a3e69e6b6faa | moved | yes | see attribution |
| bocage-veh-8-s2 | fb3631581c7f | a80ae3c70539 | moved | yes | see attribution |
| bocage-veh-8-s3 | 16bccb4bd321 | ce45b81b4bb8 | moved | yes | see attribution |
| gazala-foot-16-s1 | 17272bc4b66f | 2267e9749b70 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| gazala-foot-16-s2 | 817c07f472d7 | 819f7173c970 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| gazala-foot-16-s3 | 4567f33a96ca | a50dabe199a1 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| gazala-foot-8-s1 | 1fbf3562a239 | 56b250cfeb11 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| gazala-foot-8-s2 | 85d0848f07d9 | 977ec3b7feed | moved | yes | . |
| gazala-foot-8-s3 | d8b29b257bb7 | 4b56076227b2 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| gazala-veh-16-s1 | 6be9354bf701 | 40f3acbe221a | moved | yes | see attribution |
| gazala-veh-16-s2 | e748d542a464 | e64c0e52af32 | moved | yes | see attribution |
| gazala-veh-16-s3 | be919ab1d538 | 4c1ed70e78a4 | moved | yes | see attribution |
| gazala-veh-8-s1 | e95553930bc3 | d476cc9ca6e0 | moved | yes | see attribution |
| gazala-veh-8-s2 | b7cbc8043a59 | 3c8bddaf167a | moved | yes | see attribution |
| gazala-veh-8-s3 | aed2556cec2a | 4d39e1317669 | moved | yes | see attribution |
| kharkov-foot-16-s1 | e4e60ef769d3 | 2a35268ad95c | moved | yes | damage-armour F3 (vehicle-hits.js) |
| kharkov-foot-16-s2 | 8d3ef55737b0 | 31484dd6ceb1 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| kharkov-foot-16-s3 | 1b350ca8c963 | ffe03605e6f3 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| kharkov-foot-8-s1 | 1fe9ecf24474 | 17cfa4031ce6 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| kharkov-foot-8-s2 | e795131cce40 | 5124d24516c7 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| kharkov-foot-8-s3 | f08cacd8e171 | 741bbb1e675e | moved | yes | damage-armour F3 (vehicle-hits.js) |
| kharkov-veh-16-s1 | 001166ac0ad8 | 9917dc6e3cd9 | moved | yes | see attribution |
| kharkov-veh-16-s2 | deea75bc8145 | fe7ba75232f7 | moved | yes | see attribution |
| kharkov-veh-16-s3 | 61ee08e2c137 | b9e28f41ca3c | moved | yes | see attribution |
| kharkov-veh-8-s1 | a6f70b61394d | 6492bb50d1d2 | moved | yes | see attribution |
| kharkov-veh-8-s2 | b34fe5feff2c | e7e6a379e7ab | moved | yes | see attribution |
| kharkov-veh-8-s3 | a5e268a493d3 | 0f7c998f923b | moved | yes | see attribution |
| midway-foot-16-s1 | ecbb23f01f88 | ecbb23f01f88 | identical | . | . |
| midway-foot-16-s2 | b4115cc5250e | b4115cc5250e | identical | . | . |
| midway-foot-16-s3 | 295416d52e52 | 295416d52e52 | identical | . | . |
| midway-foot-8-s1 | 71fd6a2797e6 | 71fd6a2797e6 | identical | . | . |
| midway-foot-8-s2 | 639bb988faf5 | 639bb988faf5 | identical | . | . |
| midway-foot-8-s3 | 8cecac104204 | 8cecac104204 | identical | . | . |
| midway-veh-16-s1 | e447bebb7f3b | 85dab547fa3a | moved | yes | see attribution |
| midway-veh-16-s2 | bad0cc2de959 | 00e816ac45f9 | moved | yes | see attribution |
| midway-veh-16-s3 | 60a2e64d20ce | eba32399f600 | moved | yes | see attribution |
| midway-veh-8-s1 | d9976b1c37c8 | f5e076e3496e | moved | yes | see attribution |
| midway-veh-8-s2 | 7033447e33c8 | bad8b2895a94 | moved | yes | see attribution |
| midway-veh-8-s3 | e2a277172e56 | 5ffdae4b9995 | moved | yes | see attribution |
| stalingrad-foot-16-s1 | 6a8be96db4cf | dd926da1a1e0 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| stalingrad-foot-16-s2 | 88339d58859b | 3beae865eaf7 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| stalingrad-foot-16-s3 | 35a98c4e1073 | f5ac752fc174 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| stalingrad-foot-8-s1 | cde56e6bda37 | 8a39dd6f1614 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| stalingrad-foot-8-s2 | 83a99264a7b5 | 2b240d16cc21 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| stalingrad-foot-8-s3 | c68407bca13e | 9dcc889a36b9 | moved | yes | damage-armour F3 (vehicle-hits.js) |
| stalingrad-veh-16-s1 | 5a7bb02a8921 | 1793de3b8e93 | moved | yes | see attribution |
| stalingrad-veh-16-s2 | 4cc67c32cda4 | dad259a32865 | moved | yes | . |
| stalingrad-veh-16-s3 | 87af912e7c47 | 85eac0b8587d | moved | yes | see attribution |
| stalingrad-veh-8-s1 | 2bce381d2c9d | 386e1b311b56 | moved | yes | . |
| stalingrad-veh-8-s2 | f187a69dbe49 | 99a337ccc5b7 | moved | yes | . |
| stalingrad-veh-8-s3 | 41fdd4f8f1e7 | 2fda48c8a173 | moved | yes | . |

### Round 4: the runner's own damage copy (steps 1-2)

- `tools/bf1942-models/sim/level.mjs`, the no-stage `roundDamage` (used by the synthetic level and by a real level whose stage did not load), now runs the page's law through the shared lookups. This replaces its own pre-F3 copy (`mod === null ? 1 : mod`, attacker by raw id). It calls `crash-damage.js roundAttackerMaterial` over a GunFire-shaped view of `damage.json` (the spec's `material`, else its template's row, else material 0 for a listed template with none). A null (no weapon data, an unlisted round) prices at the 30 HP stand-in with the full modifier. Otherwise it is `materialDamage` x `damageModifier`, 0 for an unauthored cell (DMG-1), x the falloff. This is the same order `vehicle-hits.js botRoundDamage` uses. A viewer older than the shared lookups (a `--viewer` before/after run) keeps the law as it stood then, so old snapshots still replay.
- `tools/bf1942-models/sim/env.mjs` loads `crash-damage.js` (guarded) and hands `roundAttackerMaterial`, `materialDamage` and `damageModifier` to the level.
- Kills on the tree as it now stands (120 s, `sai`), against the pre-edit snapshot (`before2`) and my fixes alone (`after2`):

| match | now | before2 | after2 |
|---|---|---|---|
| berlin, on foot, 8, s1 | 11 / 11 | 12 / 7 | 11 / 11 |
| stalingrad, on foot, 16, s2 | 0 / 4 | 9 / 5 | 0 / 4 |
| bocage, on foot, 8, s1 | 6 / 11 | 10 / 7 | (not run) |
| kharkov, vehicles, 8, s1 | 2 / 1 | 0 / 1 | 2 / 0 |
| synthetic, 4, s1 | 7 / 4 | | |

  Kills are back at the level of my fixes alone (the Berlin and Stalingrad numbers are `after2`'s exactly); the zero-kill regression is gone. `test_sim_match`, `test_sim_tickets`, `test_sim_vehicles`: OK (28 skipped).
- Step 3 (final traces and bars) waits for the coordinator's word that the round-impact.js edit has landed.

### Final DICE run, round 4 (supersedes the bars note above)

**Tree.** The working tree after the damage verifier's round-4 fix (`crash-damage.js roundAttackerMaterial`, `vehicle-hits.js`, `round-impact.js`) and my `sim/level.mjs` / `sim/env.mjs`, frozen as `scratchpad/dice/viewer-final3`. Same 72-match matrix as before.

**Result: 66 of 72 moved; the 6 Midway on-foot matches are identical (bots stranded on the carriers).** Every move is explained:
- **On foot, all 30 moved matches: my fixes and nothing else.** `final3` equals `after2` (the pre-edit snapshot plus only my nine bot files) in 36 of 36 on-foot matches. The damage regression is gone, and with it every on-foot move the other verifiers caused in rounds 1-3. The leave-one-out table in "DICE trace changes" gives the per-fix split (F5, F8 everywhere bots move; F3 where they spot at range).
- **With vehicles, all 36: my fixes (F1, F3, F5, F7, F8; leave-one-out above) plus the other verifiers' vehicle changes** named in the round-1-3 attribution: air-sea F1 (`aircraft.js` engine defaults), air-sea F3 (`body-float.js` buoyancy gravity -14.7295379 -> -14.73; ground hulls' `rigid-body.js` gravity unchanged and moving nothing), damage-armour F1/F2 (`armor.js` / `vehicle-damage.js`), damage-armour F3 (`round-impact.js`, `vehicle-hits.js`), and `amphibious.js`. `final3` equals `after2` in 11 of the 36.
- **What changed since the last final run (42 matches):** all of it is the damage group. Adding `crash-damage.js` + `vehicle-hits.js` + `round-impact.js` from the new tree onto the previous final tree reproduces `final3` in 42 of 42. The other files that changed meanwhile (`hull-bodies.js`, `static-index.js`, `static-settle.js`, `test-hooks-vehicles.js`), added the same way, move no match.
- **Kills:** berlin on foot 8 s1 11 / 11, stalingrad on foot 16 s2 0 / 4, kharkov with vehicles 8 s1 2 / 1. The on-foot numbers are `after2`'s exactly.

**Bars, rebuilt and installed** on this tree (`node sim/botbatch.mjs baseline [--vehicles] --levels berlin,stalingrad,kharkov,bocage`, 80 matches each, garrison, 600 s):
- `sim/baselines/onfoot-dice.json`: enemy kills p50 0.874 -> 0.851 (8) and 0.965 -> 0.974 (16); route failures 0.039 -> 0.021 / 0.073 -> 0.150; stuck seconds 1.29 -> 1.21 / 1.01 -> 1.12; captures flat. It is byte for byte the bar built on my fixes alone, as the on-foot traces say it must be.
- `sim/baselines/vehicles-dice.json`: enemy kills 0.363 -> 0.283 / 0.511 -> 0.443; route failures 0.081 -> 0.216 / 0.119 -> 0.646; stuck seconds 0.50 -> 0.82 / 0.48 -> 1.26; mounted share 0.71 -> 0.68 / 0.53 -> 0.48; tank-silent share 0.09 -> 0.18 / 0.03 -> 0.09. The route-failure and stuck rises are F7's bridge bail ("F7 check"); the rest is the vehicle changes listed above together with mine.
- `page-dice.json` and the mod bars are untouched.

**Suites on this tree:** bot, strategic, landing, doctrine, sim, vehicle-instance and deviation (591 OK, 34 skipped); `test_bot_bars`, `test_bot_judge_sides`, `test_bot_judge_vehicles`, `test_bot_layer`, `test_bot_retail_parity`: OK.

**Working-tree files of mine in sim/:** `sim/level.mjs`, `sim/env.mjs`, `sim/baselines/onfoot-dice.json`, `sim/baselines/vehicles-dice.json`. Nothing staged.

Per-match table, round 4:

| match | before (pre-edit) | final | moved | my fixes | other verifiers |
|---|---|---|---|---|---|
| berlin-foot-16-s1 | 0c48c6d0bd80 | 819872d1b439 | moved | yes | none: equals my fixes alone |
| berlin-foot-16-s2 | ec304ba9885b | a4e7a5807afe | moved | yes | none: equals my fixes alone |
| berlin-foot-16-s3 | 0f17f4e68558 | 224a4d95f574 | moved | yes | none: equals my fixes alone |
| berlin-foot-8-s1 | d917d89dd165 | e66cb7a09e6d | moved | yes | none: equals my fixes alone |
| berlin-foot-8-s2 | eb213476f0cf | 0055a646b0c8 | moved | yes | none: equals my fixes alone |
| berlin-foot-8-s3 | 25323e637e15 | 8bf81d7ff446 | moved | yes | none: equals my fixes alone |
| berlin-veh-16-s1 | 76e23cedb7d4 | cccb299ba815 | moved | yes | round 1-3 (see list) |
| berlin-veh-16-s2 | 83ca1d8702d1 | 056211dfe22f | moved | yes | round 1-3 (see list) |
| berlin-veh-16-s3 | 14f913632ddb | 29ebad786ac7 | moved | yes | round 1-3 (see list) |
| berlin-veh-8-s1 | 89bfb629f795 | bdf2d0ee15cd | moved | yes | round 1-3 (see list) |
| berlin-veh-8-s2 | a37cce64f1d3 | 4358f6cfb3bb | moved | yes | . |
| berlin-veh-8-s3 | 9a5ae44125d8 | 5769bfdd61f3 | moved | yes | round 1-3 (see list) |
| bocage-foot-16-s1 | 74fa50559594 | 6b20cf5f24bd | moved | yes | none: equals my fixes alone |
| bocage-foot-16-s2 | 1ac5057177ff | 19f8f941c100 | moved | yes | none: equals my fixes alone |
| bocage-foot-16-s3 | ba939572785b | 05e3a5742d60 | moved | yes | none: equals my fixes alone |
| bocage-foot-8-s1 | d4071aab7a9f | b7dda28063b5 | moved | yes | none: equals my fixes alone |
| bocage-foot-8-s2 | 3422ddca8e43 | 1faee8a72913 | moved | yes | none: equals my fixes alone |
| bocage-foot-8-s3 | c414bdb9926b | 809ef4d2d413 | moved | yes | none: equals my fixes alone |
| bocage-veh-16-s1 | 54c2ccf04a4c | eb2ff10d3e20 | moved | yes | round 1-3 (see list) |
| bocage-veh-16-s2 | fccc1254167f | 62d79bbaf1f8 | moved | yes | round 1-3 (see list) |
| bocage-veh-16-s3 | 6a39f6c311bd | 77f23d54e903 | moved | yes | round 1-3 (see list) |
| bocage-veh-8-s1 | a3399a2f9841 | a3e69e6b6faa | moved | yes | round 1-3 (see list) |
| bocage-veh-8-s2 | fb3631581c7f | a80ae3c70539 | moved | yes | round 1-3 (see list) |
| bocage-veh-8-s3 | 16bccb4bd321 | 928d09502b2c | moved | yes | round 1-3 (see list) |
| gazala-foot-16-s1 | 17272bc4b66f | cf9a46bd1317 | moved | yes | none: equals my fixes alone |
| gazala-foot-16-s2 | 817c07f472d7 | cc948a148855 | moved | yes | none: equals my fixes alone |
| gazala-foot-16-s3 | 4567f33a96ca | a618634ca058 | moved | yes | none: equals my fixes alone |
| gazala-foot-8-s1 | 1fbf3562a239 | 4f335e74fbcd | moved | yes | none: equals my fixes alone |
| gazala-foot-8-s2 | 85d0848f07d9 | 977ec3b7feed | moved | yes | none: equals my fixes alone |
| gazala-foot-8-s3 | d8b29b257bb7 | 7785e2f90bdb | moved | yes | none: equals my fixes alone |
| gazala-veh-16-s1 | 6be9354bf701 | 40f3acbe221a | moved | yes | round 1-3 (see list) |
| gazala-veh-16-s2 | e748d542a464 | e64c0e52af32 | moved | yes | round 1-3 (see list) |
| gazala-veh-16-s3 | be919ab1d538 | 4c1ed70e78a4 | moved | yes | round 1-3 (see list) |
| gazala-veh-8-s1 | e95553930bc3 | d476cc9ca6e0 | moved | yes | round 1-3 (see list) |
| gazala-veh-8-s2 | b7cbc8043a59 | 3c8bddaf167a | moved | yes | round 1-3 (see list) |
| gazala-veh-8-s3 | aed2556cec2a | 4d39e1317669 | moved | yes | round 1-3 (see list) |
| kharkov-foot-16-s1 | e4e60ef769d3 | d0d04b3e9754 | moved | yes | none: equals my fixes alone |
| kharkov-foot-16-s2 | 8d3ef55737b0 | 606f28ad1127 | moved | yes | none: equals my fixes alone |
| kharkov-foot-16-s3 | 1b350ca8c963 | 72dfb5bf9cf1 | moved | yes | none: equals my fixes alone |
| kharkov-foot-8-s1 | 1fe9ecf24474 | 73cb3b095458 | moved | yes | none: equals my fixes alone |
| kharkov-foot-8-s2 | e795131cce40 | 29af3ae2cf9c | moved | yes | none: equals my fixes alone |
| kharkov-foot-8-s3 | f08cacd8e171 | d70f3c3441c2 | moved | yes | none: equals my fixes alone |
| kharkov-veh-16-s1 | 001166ac0ad8 | 9917dc6e3cd9 | moved | yes | round 1-3 (see list) |
| kharkov-veh-16-s2 | deea75bc8145 | 527d7255ee7d | moved | yes | round 1-3 (see list) |
| kharkov-veh-16-s3 | 61ee08e2c137 | 26280e0e6ccf | moved | yes | round 1-3 (see list) |
| kharkov-veh-8-s1 | a6f70b61394d | 9bc845318c0a | moved | yes | round 1-3 (see list) |
| kharkov-veh-8-s2 | b34fe5feff2c | e7e6a379e7ab | moved | yes | round 1-3 (see list) |
| kharkov-veh-8-s3 | a5e268a493d3 | 35313581ba21 | moved | yes | round 1-3 (see list) |
| midway-foot-16-s1 | ecbb23f01f88 | ecbb23f01f88 | identical | . | . |
| midway-foot-16-s2 | b4115cc5250e | b4115cc5250e | identical | . | . |
| midway-foot-16-s3 | 295416d52e52 | 295416d52e52 | identical | . | . |
| midway-foot-8-s1 | 71fd6a2797e6 | 71fd6a2797e6 | identical | . | . |
| midway-foot-8-s2 | 639bb988faf5 | 639bb988faf5 | identical | . | . |
| midway-foot-8-s3 | 8cecac104204 | 8cecac104204 | identical | . | . |
| midway-veh-16-s1 | e447bebb7f3b | 85dab547fa3a | moved | yes | round 1-3 (see list) |
| midway-veh-16-s2 | bad0cc2de959 | 00e816ac45f9 | moved | yes | round 1-3 (see list) |
| midway-veh-16-s3 | 60a2e64d20ce | eba32399f600 | moved | yes | round 1-3 (see list) |
| midway-veh-8-s1 | d9976b1c37c8 | f5e076e3496e | moved | yes | round 1-3 (see list) |
| midway-veh-8-s2 | 7033447e33c8 | bad8b2895a94 | moved | yes | round 1-3 (see list) |
| midway-veh-8-s3 | e2a277172e56 | 5ffdae4b9995 | moved | yes | round 1-3 (see list) |
| stalingrad-foot-16-s1 | 6a8be96db4cf | 915da56015a6 | moved | yes | none: equals my fixes alone |
| stalingrad-foot-16-s2 | 88339d58859b | 632eeab0e6c6 | moved | yes | none: equals my fixes alone |
| stalingrad-foot-16-s3 | 35a98c4e1073 | 30575ca4a7a7 | moved | yes | none: equals my fixes alone |
| stalingrad-foot-8-s1 | cde56e6bda37 | 3233c402b47d | moved | yes | none: equals my fixes alone |
| stalingrad-foot-8-s2 | 83a99264a7b5 | 8209e9e62d25 | moved | yes | none: equals my fixes alone |
| stalingrad-foot-8-s3 | c68407bca13e | e7f8047a7794 | moved | yes | none: equals my fixes alone |
| stalingrad-veh-16-s1 | 5a7bb02a8921 | 4f737575e47d | moved | yes | round 1-3 (see list) |
| stalingrad-veh-16-s2 | 4cc67c32cda4 | 8d70a5bd32e3 | moved | yes | . |
| stalingrad-veh-16-s3 | 87af912e7c47 | 85eac0b8587d | moved | yes | round 1-3 (see list) |
| stalingrad-veh-8-s1 | 2bce381d2c9d | 386e1b311b56 | moved | yes | . |
| stalingrad-veh-8-s2 | f187a69dbe49 | 99a337ccc5b7 | moved | yes | . |
| stalingrad-veh-8-s3 | 41fdd4f8f1e7 | 2fda48c8a173 | moved | yes | . |
