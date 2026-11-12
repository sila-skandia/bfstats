# soldier-physics

## Summary

Counts: MATCH 31 (grouped rows below), CODE-WRONG 4 (1 medium, 3 low), LEDGER-WRONG 1 (low),
DELIBERATE 4, INCONCLUSIVE 1.

All re-reads were done on our own `bf1942_lnxded.static` and `BF1942.exe` with objdump plus
readmem, with the linux 1.61 dump as the second reader where it mattered (addFriction,
updatePositionalPhysics).

Not reached, and why. These are citation-only, or the page's own numerics, so no binary read
was made:
- the COL-21/23/25 static-sweep rows in `body-statics.js` / `world-bodies.js`
- the TERR-16 triangle split in `heightfield.js`. It is lab-measured to the mm under PHY-34;
  I read only the `+0xbc` scale multiply at `0x083d6632`.
- the `[free]` page constants in `ground-contact.js`, `collision-meshes.js` and `body-world.js`
- the `test-hooks-soldier.js` hooks
- the geometry-search COL-14/15 walk
- PHY-6/PHY-9's ramp constants, which live in `soldier-locomotion.js` (not in this bucket).
  The walking body only consumes them.

## Findings (non-MATCH), most severe first

### F1 [CODE-WRONG] [medium] The walking body's Euler step has no 1000 m/s^2 accumulator clamp (and no fr drop)
- Code: `tools/bf1942-models/viewer/walking-body.js:767-797` (`#updateNode`): `v.x += a.x * dt + f.x * dt; ...` integrates the summed accumulator unclamped. The vehicle twin has the clamp: `rigid-body.js:60-64,392` (`ACCEL_CLAMP_LIMIT_SQ = 1e6`, `ACCEL_CLAMP_SPEED = 1000`, `POSITIONAL_FRICTION_ZERO_SQ = 62500`).
- Ledger: PHY-34 says the soldier's node is a `PhysicsNode` stepped by `PhysicsNode::updatePhysics` `0x082543d0` -> `0x08253570`. collision-response.md section 4.2 gives the clamp for that step: `if |acc|^2 > 1e6: acc *= 1000/|acc|; if |fr|^2 > 62500: fr = 0`. PHY-34's own description of the step leaves the clamp out.
- Third-party: `decompiled_functions_bf42linuxServer/updatePositionalPhysics.c:61-74`. It shows `if (_DAT_08685688 < fVar5) { fVar5 = _DAT_08665fa8 / SQRT(fVar5); *(this+0x28) *= ... }` and `if (_DAT_0868568c < |this+0x40|^2) { this+0x40.. = 0 }`. Its dyn constants are 1e6, 1000.0 and 62500.0.
- Our binary: `0x082544d8` is the only positional step in `PhysicsNode::updatePhysics`: `call 0x8253570 <PhysicsNode::updatePositionalPhysics>`. In that step:
  - `0x082536a1 flds 0x86d1388` = 1e6, then `fucom; jne` (skips when the value is <= 1e6)
  - `0x082536b8 fsqrt`
  - `0x082536ba flds 0x86b1ca8` = 1000.0, then `fdivp`, then three `fmul`s stored back to `+0x28..`
  - `0x082536f5 flds 0x86d138c` = 62500.0 for the friction adder `+0x40`
- Verdict reasoning: Wake's move-law probe never reaches 1000 m/s^2, so the mm match does not test the clamp. The jump is 180 m/s^2 and a landing push is about 15 * v_n. A blast banked through `_blastDv / dt` does reach it. KNOCK-6's crouched grenade is 600 m/s^2, so anything about 1.7x stronger (satchel, bomb, shell close in) exceeds 1000 m/s^2. Retail then throws the soldier at most 33.3 m/s per tick; the page throws him at the full value. A free-fall landing above about 67 m/s is clamped the same way.
- Fix: in `#updateNode`, before `v += a*dt`:
  - if `a.x²+a.y²+a.z² > 1e6`, scale `a` by `1000 / |a|`;
  - if `f.x²+f.y²+f.z² > 62500`, zero `f`.

  Reuse `rigid-body.js`'s `ACCEL_CLAMP_LIMIT_SQ` / `ACCEL_CLAMP_SPEED` / `POSITIONAL_FRICTION_ZERO_SQ`. Add the clamp to PHY-34's step description too.

### F2 [CODE-WRONG] [low] A swimmer gets 5.0*vCmd only; retail stacks the 0.75*vCmd locomotion force on top (5.75)
- Code: `walking-body.js:621-646`. The branches are `if (this.swimming) { body.addAcceleration(gain * cmdX, 0, gain * cmdZ) } else if (jumped) {...} else { LOCOMOTION_GAIN * cmd }`. `swim.js:131-141` says the 0.75 is under the `+0xa4` gate and the swim force is not.
- Ledger: PHY-34 says `acc += 0.75*vCmd` (`0x08274a09`) happens every tick, because the `+0xa4` gate is always open. PHY-6 gives the 5.0 at `0x086c5288`. No row says a swimmer skips the 0.75.
- Third-party: not needed. Our binary is linear here.
- Our binary, `BFSoldier::handlePlayerInput`:
  - `0x082749e3 jne 0x8274f86` is the jump branch; only a jump bypasses what follows.
  - `0x082749f3 fildl 0xa4(%eax) ... 0x08274a03 jne 0x8274ac9` is the impulse-count gate.
  - `0x08274a09 flds 0x86ba8cc` (0.75), times vCmd, then `call *0x6c` at `0x08274ac3`. There is no swim test before it.
  - Then `0x08274b5f testl $0x8,-0x280(%ebp); je` is the swim flag, `0x08274b6f flds 0x86c5288` (5.0), times all three components of vCmd (`-0x28`, `-0x24`, `-0x20`).
  
  So with the gate open, a swimmer gets both forces.
- Verdict reasoning: the swimmer's body is the page's own point body with a tuned ceiling (DELIBERATE, below), so the speed difference is mostly absorbed. The acceleration is still 13% short. Also, the y component of `5.0*vCmd` is dropped; it is zero only while he is upright.
- Fix: in the swimming branch, also add `LOCOMOTION_GAIN * cmd`, and pass `gain * cmdY`. Then re-check `SWIM_SPEED_CEILING_FACTOR`. Correct `swim.js:136-140`: the 0.75 is not skipped for swimmers. Since PHY-34, its gate is open for them too.

### F3 [CODE-WRONG] [low] `body-friction.js`'s soldier arm states a refuted engine fact and uses the vehicle law (dead code)
- Code: `tools/bf1942-models/viewer/body-friction.js:205-215`. It sets `const N = isSoldier ? ZERO3 : response.avgNormal;` with the comment "F8: a soldier's normal (+0x98) is written by nothing, so N is always zero". It then applies the vehicle `1.5 * 9.82 * N.y / 30` budget to soldiers. Nothing in the viewer calls it with `kind: 'soldier'`; the walking body runs its own law (`walking-body.js:833-860`).
- Ledger: PHY-2 and PHY-34 (4): the soldier pair is `A*4.8*9.82/30*Ny^5` / `A*7.2*9.82/30*Ny^5`, with N from `resp+0x98`, written by `BFSoldier::handleCollision` (PHY-2b).
- Third-party: `decompiled_functions_bf42linuxServer/addFriction_08262750.c:100-120`. It reads `if (iVar9 == CID_BFSoldierTemplate) local_1e8 = param_1 + 0x98;`, then `local_1d8 = (...*_DAT_086859e8 * fVar2)/g_simulationFps * fVar3 * local_1d4 * local_1d4` (Ny^5). Its dyn constants are 7.2 / 4.8 / 9.82.
- Our binary: `BFSoldier::handleCollision` `0x0827d52f movl %ecx,0x98(%ebx)`, `0x0827d538 ... 0x9c`, `0x0827d541 ... 0xa0` writes the normal. `addFriction` `0x0825c5e0 fmuls 0x86d16ec` (4.8), `0x0825c5ee fmuls 0x86d16e8` (7.2), and `0x086d16e4` = 9.82.
- Fix: delete the `'soldier'` arm from `body-friction.js`, or make it throw. If it is kept, it must use N from `+0x98`, the 4.8/7.2 coefficients and Ny^5, as in `walking-body.js#contactLaw`. Also delete the "written by nothing" comment at `:206` and `:221`.

### F4 [CODE-WRONG] [low] Box drag area uses `Math.PI / 4`; the engine folds 3.14 * 0.25 = 0.785
- Code: `tools/bf1942-models/viewer/ground-contact.js:530`: `const BOX_AREA = Math.PI / 4;`. Its comment reads "pi / 4: each face of the drag box is the ellipse inscribed in it". `swim.js`'s doc repeats `(pi/4)`.
- Ledger: PHY-22 says "forms `3.14f * 0.25` (`ds:0x86d1384` = 3.14 ...) ... with pi as 3.14". The code has drifted from its own row.
- Third-party: not consulted. The binary is direct.
- Our binary: on lnxded, `0x082545b8 flds 0x86d1384`, and readmem gives 3.140000104904175. On the client, `PhysicsNode::updatePhysics` `0x00540be7 fmuls 0x8f733c` (three times), and readmem gives 0.7850000262260437.
- Verdict reasoning: every vehicle's box drag is 0.05% too strong (Krupp top speed about 0.005 m/s low). This is not felt, but it is a wrong constant with a binary-exact value available.
- Fix: `const BOX_AREA = 0.785;`, commented "3.14f * 0.25, client 0x008f733c / lnxded 0x086d1384 x 0x086c08ac".

### F5 [LEDGER-WRONG] [low] Handler gate is `|v|^2 > 0.1` (strict), not `>= 0.1`
- Code: `walking-body.js:839`: `const handled = v.x*v.x + v.y*v.y + v.z*v.z >= SOLDIER_HANDLER_SPEED_SQ;`. `obstacle.js` and `body-contact.js` say "exceeds", which is correct.
- Ledger: PHY-34 (3) says "`BFSoldier::handleCollision` `0x0827d3b0` (only at `|v|^2 >= 0.1`)".
- Third-party: not consulted.
- Our binary: `ResponsePhysics::checkVsTerrain` `0x0825af9d flds 0x86b1ca0` (0.1), then `fxch; fucompp; testb $0x45,%ah; jne 0x825adcd` at `0x0825afac`. That skips the handler when `|v|^2 <= 0.1`.
- Fix: PHY-34 should say `> 0.1`. In code, change `>=` to `>` (an equality case of measure zero, so no behaviour change in practice).

### F6 [DELIBERATE] [low] Swimming and the parachute step the old PointPhysicsNode (4 sub-steps, sphere drag)
- `walking-body.js:661-671`, documented there and in PHY-34's "not covered" list. Keep it, and note F2 when retuning.

### F7 [DELIBERATE] [low] Catch-up caps differ from retail's
- `fixed-step.js:40`: `MAX_CATCH_UP_TICKS = 12`, documented against retail's 9 (`GameServer::update` `0x08132955 cmpl $0x9`; client `GameClient::update` `0x0048fca8 cmpl $0x9`).
- `body-world.js:30`: `MAX_BACKLOG_TICKS = 10` ("the engine's own rule is 10") runs 10 ticks for a 10-tick backlog. Retail's client drops any backlog over 9 to 1 at `0x0048fca8`; 10 is InputManager's earlier threshold.
- Both are browser adaptations. Keep them, but the body-world comment should say "client InputManager >10 -> 1; GameClient::update then clamps >9 to 1".

### F8 [DELIBERATE] [low] `LOW_SNAP_SHARE_B = -1` instead of the binary's +1.0
- `body-contact.js:59`, documented as the one named exception (collision-response.md sections 6.1 and 12).
- Our binary: `0x0825a3d5 fldz; fxch; fstps -0x1d8; fstps -0x1d4` stores shareA = 0 and shareB = the residual stack value. Keep.

### F9 [DELIBERATE] [low] The dead soldier's `setCollisionOffset` arm and the hull vertices are not modelled
- `walking-body.js:890-895`. Our binary takes the dead branch at `0x08273512 jne 0x827387d`. Documented in PHY-38. Keep.

### F10 [INCONCLUSIVE] [low] `SOLDIER_BOUNDING_RADIUS = 0.8` (point-body drag radius, "still inferred")
- `point-body.js:41,72` and `soldier-locomotion.js:367`.
- The client drag `0x00578990` takes r as its first argument (`fmuls 0x20(%esp)` twice, after `pi` `0x8fdaf0`). r comes from the caller's virtual `+0x1c` at `0x00578ca0`, and its value is the soldier geometry's radius, not a constant.
- To settle it: read `getBoundingRadius` for a BFSoldier at runtime, or from his collision mesh. It matters only for the swim/parachute point body (F6).

## MATCH list
- GRAVITY -14.73 -> `point-body.js:17`; client `0x00578f11 movl $0xc16bae14` = -14.73
- SUB_STEPS 4 / h = dt*0.25 -> `point-body.js:23`; client `0x00578aa8 fmuls 0x8d5c04` = 0.25
- Point drag pi r^2 drag/mass, wind-relative, scale*v -> `point-body.js:applyDrag`; client `0x00578990..0x578a8e` (pi = 0x8fdaf0 3.1415927, 1/mass `fdivrs 0x8c53c8`)
- PHY-7 submersion 25.0 -> `point-body.js:43`; client `0x00540c2d fmuls 0x8f7210` = 25.0 (box law); PHY-7 row
- PHY-34 node step v += a dt; v += fr dt; x += v dt -> `walking-body.js#updateNode` (bar F1); `0x082544d8 -> 0x08253570`
- PHY-1 jump 6.0, 0.25*vCmd, K = min(1 + d.N, 1), y-zeroed d -> `walking-body.js#tryJump` (constants imported); row only
- PHY-2 soldier friction 4.8 / 7.2 * 9.82 / 30 * Ny^5, latch, eps 1.0000001e-6 -> `walking-body.js#contactLaw`; `0x0825c5e0/0x0825c5ee`, `0x086d139c`; linux dump `addFriction_08262750.c:113-120`
- PHY-2 vehicle 1.5 / 2.25 * 9.82, latch shape -> `body-friction.js` (non-soldier arms); `0x086be4d0` 1.5, `0x086d16e0` 2.25, `0x086d16e4` 9.82; dump lines 106-109, 350-382
- PHY-2b normal written to resp+0x98 -> `walking-body.js:803`; `0x0827d52f..0x0827d541`
- Contact impulse spdAdj*30*0.5 -> `walking-body.js:828` (`CONTACT_IMPULSE_GAIN`); PHY-34 row
- PHY-34 0.75*vCmd every tick -> `walking-body.js:645`; `0x08274a09 flds 0x86ba8cc` = 0.75
- PHY-6 swim 5.0 -> `walking-body.js:633`; `0x08274b6f flds 0x86c5288` = 5.0 (but see F2)
- PHY-38 lean, lying k = 0.1 toward the terrain normal or the contact normal (c.y >= 0.3), else upright; standing k = 0.5 while up.y > 0.1 -> `walking-body.js#updateTilt`; `0x0827357a/0x082737d4 flds 0x86b1ca0` = 0.1, `0x08273534 flds 0x86c030c` = 0.3 with `je` (0.3 > c.y -> upright), `0x08273812 flds 0x86b05e8` = 0.5, `0x082737e3 jne` (up.y <= 0.1 -> upright)
- HP-14 fall damage: whole formula -> `fall-damage.js`. Our binary `0x08154960`:
  - 8.0 `0x086c08c0` subtracted first, with the early return (`0x08155189`)
  - X = 1 below F = 2, else F - 1 (`0x08154d62`, `0x08154e07` with 2.0 at `0x086c08c4`)
  - Q = max(1, X*damp)
  - height lerp A += (1 - A)(F - 2), A = 1 at F >= 3 (`0x08154e0d`/`0x08154e3b`)
  - speed saturates at v > 30 (`0x086b01b4`); lerp for 10 < v <= 30 over 20 (`0x086b9314`, `0x086c0314`)
  - Q^2 (`0x08154dbb/0x08154dbd`), delivered only when > 1.0 (`0x08154c6b`)
  - |cos| (`andb $0x7f` at `0x081549db`), cubed, squared on material 1 (`cmpl $0x1,0x20(%ebp)` `0x08154a89`)
  - speedMod * v^2, damageMod, materialDamage (`0x08154bf8`, `0x08154c06`, `0x08154c29`)
- HP-14 kitDamping = min over worn parts, 1.0 with none -> `world-soldier-tick.js:78`; `getDamageDampingFromActiveKitParts` `0x0827ec00..0x0827ec4b`
- OBS default damage 5.0 -> `obstacle.js:35`; `0x08315e8a movl $0x40a00000,0x150(%ebx)`
- OBS col list ring & 0xf, lifetime 1.0 - queued -> `obstacle.js` ColObjectList; `addColObject` `0x08173744 fld1`, `0x08173760 fsubs 0x94(..)`, `andl $0xf`
- COL broadphase: part radius 0.45, swept margin 0.25, vertex count > 3 -> `body-contact.js:67-71`; `checkObjectVsObjects` `0x086d1798` 0.45, `0x086c08ac` 0.25, `cmpl $0x3` at `0x0825dc92`
- COL share snaps 0.95 / 0.05, LOD radius 4.0, handler 0.1 -> `body-contact.js:62-77`; `checkObjectVsObject` `0x086d16cc` 0.95, `0x086c08a8` 0.05, `0x086c0304` 4.0, `0x086b1ca0` 0.1
- STATIC_MASS 1e12 -> `body-statics.js:102`; `StaticPhysicsNode::getMass` `0x0825e911 flds 0x86d180c` = 999999995904
- PHY-5 spring -1/9.82 -> `body-ground.js:177`; `0x086d0e8c` = -0.101833
- PHY-22 box rows/areas order -> `ground-contact.js addBoxDrag` (bar F4's constant)
- Material ctor defaults friction 1.0, resistance 0.01 -> `ground-contact.js:108-131` doc; `Material::Material` `0x0817456a movl $0x3f800000,0xc`, `0x08174578 movl $0x3c23d70a,0x14`
- LOOP-1 dt 1/30, server clamp >9 -> `fixed-step.js` doc, `world-soldier-tick.js`; `0x08132955 cmpl $0x9`; client `0x0048fca8`
- TERR heights x yScale (+0xbc) -> `heightfield.js:129`; `0x083d6632 fmuls 0xbc(%eax)`
- PHY-40/43, PHY-8, PHY-9, PHY-35, VIEW-14 -> `walking-body.js` / `foot-body.js` cite these rows only; no new value in this bucket. Name-level MATCH.
- `world-soldier-tick.js` obstacle path (giveDamage -1 attacker, slow flag) -> OBS rows; name-level MATCH
- `physics.js` header summary (PHY-1/4/6/7/9/34, LOOP-1) -> consistent with the rows above

## Fixes applied

Concurrency note: another session (VIEW-15, the eye-height ease) was editing `walking-body.js` at the same time. Its hunks (constructor eye fields, `setPose`, the end-of-step eye lerp) are still in the file next to mine; nothing of theirs was reverted. I did not edit `swim.js`, per the coordinator's correction.

- **F1** `viewer/walking-body.js`:
  - It now imports `ACCEL_CLAMP_LIMIT_SQ`, `ACCEL_CLAMP_SPEED` and `POSITIONAL_FRICTION_ZERO_SQ` from `./rigid-body.js`, so no number is duplicated.
  - In `#updateNode`, before `v += a dt`: when `|a|^2 > 1e6`, `a` is scaled to 1000; when `|f|^2 > 62500`, `f` is zeroed. A comment cites `0x08253570`, `0x082536a1..c8`, `0x082536f5` and PHY-34. The `#updateNode` doc comment names both steps.
  - Because `walking-body.js` now imports `rigid-body.js`, I added `rigid-body.js` to the module staging lists of the 16 tests that copy `walking-body.js` into a temp dir and did not stage it yet: `test_bomb_release`, `test_fall_damage`, `test_fuse_round_rest`, `test_gunfire_layers`, `test_gait_select`, `test_idle_vehicle`, `test_jump_law`, `test_ladder`, `test_loaded_rounds`, `test_move_law`, `test_parachute`, `test_physics`, `test_proximity_fuse`, `test_rocket_flight`, `test_seats`, `test_soldier`. Each change is one entry.
  - New test: `tests/physics_harness.mjs` `accelClamp`, plus `tests/test_physics.py` `test_one_tick_of_a_huge_push_is_held_to_1000_m_s2`. A soldier in the air takes `blast(2000, 0, 0)` and one 1/30 s step; the speed comes out at 1000/30 = 33.33 m/s along `(2000, -14.73)`.
- **F2** `viewer/walking-body.js`, the swimming branch of `step`: the push is now `(gain + LOCOMOTION_GAIN) * (cmdX, cmdY, cmdZ)`, that is `5.0 + 0.75` with the y component included. The comment cites `0x08274a09`, `0x082749e3`, `0x08274b5f` and `0x08274b75..98`. The swim force is applied here, not in `swim.js`; `swim.js` only supplies `gain`. The point-body choice is unchanged.
  - Left for the soldier-states verifier: the comment at `swim.js:136-140` still says the 0.75 is gated off for swimmers. Since PHY-34 its gate is open, so a swimmer gets both forces.
  - `SWIM_SPEED_CEILING_FACTOR` was not re-tuned. `test_physics`' "a swimmer moves and is slower than a runner" still passes.
- **F3** `viewer/body-friction.js`:
  - `rg` found no caller that passes `kind: 'soldier'` (callers: `body-ground`, `ship`, `aircraft`, `vectored-engines`).
  - I deleted the `isSoldier` arm: the zero-normal `N` and the no-offset arm position. A `'soldier'` response now throws and points to `walking-body.js #contactLaw`.
  - The doc comment states the real law (normal from `+0x98` written at `0x0827d52f`; budgets 4.8/7.2·Ny^5 at `0x0825c5e0`/`0x0825c5ee`; PHY-2, PHY-34). The "written by nothing" comments are gone.
- **F4** `viewer/ground-contact.js`:
  - `BOX_AREA = Math.fround(Math.fround(3.14) * 0.25)`, which is 0.7850000262260437, bit-equal to the client's `0x008f733c`. The comment cites `0x086d1384`, `0x086c08ac`, `0x082545b8` and PHY-22.
  - The `addBoxDrag` doc formula now reads `3.14/4`.
  - `tests/test_ground.py` `test_a_hull_drags_by_the_box_law` encoded `math.pi / 4`, the old wrong value. It now uses 0.785f, with the comment updated.
  - Not in my files: `viewer/projectile-flight.js:203` documents `(pi/4)` for rounds' box drag, and `swim.js:156` repeats it. Whoever owns them should check whether they use `Math.PI`.
- **F5** `viewer/walking-body.js` `#contactLaw`: `handled = |v|^2 > SOLDIER_HANDLER_SPEED_SQ`, strict. The comment cites `0x0825afac`.
- **F7** `viewer/body-world.js`: the `MAX_BACKLOG_TICKS` comment now cites the client's `GameClient::update` `0x0048fca8` (>9 to 1), the server's `0x08132955` and LOOP-1, and says ours is a deliberate 10. The value is unchanged.
- **F10: not changed. I stopped here, under rule 4.**
  - The radius the point body reads is `PointPhysicsNode::getBoundingRadius` `0x08256510`, which is the owner object's vt+0x48. For a BFSoldier that slot (`_ZTV...BFSoldier` + 8 + 0x48 = `0x0872f090`) is `BCompositeObject<IPlayerObject>::getBoundingRadius` `0x08165630`. It returns a cached `+0xb4` and, when flag `0x80000` is set, recomputes it from the object's `+0x5c` member (vt+0x20) and every child (vt+0x7c walk: offsets and radii).
  - So it is a **runtime composite radius**: the soldier's own geometry plus his kit's children (weapons and so on). It is neither the collision mesh alone nor a constant, and the repo has no extracted equivalent I could compute it from.
  - It also only feeds the swim and parachute point body, whose `SWIM_SPEED_CEILING_FACTOR` and `effectiveParachuteDrag` were tuned against 0.8. Replacing the 0.8 without re-tuning those would break a DELIBERATE choice (F6).
  - What would settle it: a lab read of `getBoundingRadius()` on a live BFSoldier (e.g. a bf42plus hook on `0x08165630`'s return value), or identifying the `+0x5c` member's class and the kit children's offsets.

Tests run from `tools/bf1942-models` (`python3 -m unittest tests.<m>`):
- OK: `test_physics` (62, new test included), `test_move_law` (6), `test_jump_law` (7), `test_prone_slope` (5), `test_fall_damage` (15), `test_parachute` (24), `test_bomb_release` (29), `test_fuse_round_rest` (11), `test_gunfire_layers` (9), `test_gait_select` (16), `test_idle_vehicle` (15), `test_ladder` (22), `test_loaded_rounds` (11), `test_proximity_fuse` (13), `test_rocket_flight` (34), `test_seats` (88), `test_body_ground` (25), `test_vehicle_bodies` (41), `test_tank_law` (8), `test_world` (24), `test_ship` (38), `test_flight` (108, 1 skipped), `test_bot_ai` (76), `test_obstacle` (11, 1 skipped), `test_contact_response` (14). `test_room` skipped.
- The move-law and jump-law lab replays still pass to the mm (the clamp never fires on Wake).
- **Failing, and I judge them not mine:**
  - `test_soldier` `test_stance_transitions_take_the_time_the_clips_declare` fails with `KeyError: 'crouchToProneFrames'`. No harness emits that key any more; it is the concurrent VIEW-15 eye/stance change.
  - `test_ground`: five drivetrain tests (`rev_filter`, `steering_term`, `throttle_term`, `a_tree_extracted_before_this_branch_still_steers`, `a_driven_steered_wheel_drives_along_its_bundle`) read zeros. `ground-engine.js` is being edited by another session. None of the five touches the box drag, and the box-drag test passes after its expectation update.

## Ledger edits

PHY-34, law item (2). Replace

> then **one** Euler step `0x08253570`: `v += acc·dt; v += fr·dt; x += v·dt`; acc reset to gravity, fr to 0.

with

> then **one** Euler step `0x08253570` (`PhysicsNode::updatePositionalPhysics`): the accumulator held to 1000 m/s² (`|acc|² > 1e6` scales it to length 1000, `0x082536a1`..`0x082536c8`, constants `0x086d1388` = 1e6, `0x086b1ca8` = 1000.0) and the friction adder dropped whole when `|fr|² > 62500` (`0x082536f5`, `0x086d138c`), as for a vehicle (collision-response.md §4.2); then `v += acc·dt; v += fr·dt; x += v·dt`; acc reset to gravity, fr to 0. One tick therefore moves a soldier at most 33.3 m/s: a blast above 1000 m/s² (KNOCK-6) is cut there. Built 2026-11-12, `walking-body.js` `#updateNode`, `tests/test_physics.py` `test_one_tick_of_a_huge_push_is_held_to_1000_m_s2`.

PHY-34, law item (3). Replace

> `BFSoldier::handleCollision` `0x0827d3b0` (only at `|v|² >= 0.1`)

with

> `BFSoldier::handleCollision` `0x0827d3b0` (only at `|v|² > 0.1`, strict: `checkVsTerrain` `0x0825af9d`/`0x0825afac` `fucompp; jne` skips the handler at `<= 0.1`)

PHY-34, law item (1). Append after "`acc += 0.75·vCmd` (`0x08274a09`) **every tick** ...":

> including a swimmer's: no swim test stands between the jump branch (`0x082749e3`) and the swim block (`0x08274b5f`), so a swimmer is pushed by `0.75·vCmd + 5.0·vCmd` (PHY-6's `0x086c5288`, all three components, `0x08274b75`..`0x08274b98`). Built 2026-11-12 in `walking-body.js` (the swimmer's point body itself is unchanged).

PHY-22: append

> The viewer's land drives use the engine's float, `BOX_AREA = 0.785f` (`ground-contact.js`, 2026-11-12; was `Math.PI/4`); the client folds the constant to `0.785f` at `0x008f733c` (`PhysicsNode::updatePhysics` `0x00540be7`).

New note under PHY-7 (or a new PHY row): the soldier's point-body radius.

> `PointPhysicsNode::getBoundingRadius` `0x08256510` returns its owner's vt+0x48. For a BFSoldier that is `BCompositeObject<IPlayerObject>::getBoundingRadius` `0x08165630` (vtable `0x0872f040`+8+0x48): the composite radius cached at `+0xb4`, recomputed on flag `0x80000` from the `+0x5c` member's radius (vt+0x20) and every child's offset plus radius. It is a runtime value of geometry plus kit, not a constant; the viewer's `SOLDIER_BOUNDING_RADIUS = 0.8` stays inferred. Open: a lab read of `0x08165630` on a live soldier.

### F1 follow-up (coordinator, knockback seams)
- `tests/knockback_seams_harness.mjs` case 2 is rewritten as `blastPair({ exposure })`, run twice:
  - `twoBlasts`, exposure 1: each push is capped at 600 m/s^2 (20 m/s, KNOCK-7), so the pair is 1200 m/s^2.
  - `twoSmallBlasts`, exposure 0.2: 300 each, a 600 m/s^2 pair.
- The expectation is computed the way `#updateNode` clamps. The accumulator going into the step (gravity plus last tick's contact push, read from `s.body.body.accel`) plus the banked pair is scaled by `min(1, 1000/|A|)`, then multiplied by 1/30.
- Results:
  - Capped pair: |A| = 1200.0, horizontal 17.15 m/s, unclamped sum 20.58.
  - Small pair: |A| = 600.0, horizontal 10.29 m/s, equal to the plain sum.
- `tests/test_knockback_seams.py`:
  - `test_two_blasts_in_one_tick_add` is now `test_two_blasts_in_one_tick_add_then_the_step_clamps_them`. It still asserts each push at 20.0, asserts |A| > 1000, and asserts horizontal == clamped expectation and < unclamped - 3. The old expectation (20.58) encoded the unclamped sum.
  - New: `test_two_small_blasts_in_one_tick_add_exactly`.
  - The comments and module docstring cite KNOCK-6, KNOCK-7 and PHY-34's `0x082536a1..c8`.
- The ladder and item-gate scenarios use one 600 m/s^2 push (plus about 0 to 15 of gravity and contact), which stays under the clamp, so neither assumption changes. Both pass.
- The other test modules that use blasts all pass: `test_knockback_seams` (4), `test_knockback` (17), `test_soldier_exposure`, `test_stance_clips`, `test_friendly_fire`, `test_bomb_release`, `test_sticky_round`, `test_hand_fire`, `test_hand_alt_fire`, `test_fuse_round_rest`, `test_proximity_fuse`, `test_killer_charge`, `test_effects`, `test_vehicle_damage`, `test_bot_weapons`, `test_hull_wash`, `test_tank_school`, `test_test_hook_vehicles`, `test_room` (62), `test_netcode_client`, `test_replay_rounds`, `test_replay_accuracy`. No other test assumed an unclamped soldier push.
