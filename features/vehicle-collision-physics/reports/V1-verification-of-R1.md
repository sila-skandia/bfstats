# V1 - adversarial verification of R1 (terrain contact + friction solver)

Verifier V1, 2026-09-19. Target: `SP/reports/R1-terrain-friction.md`. Binary: `bf1942_lnxded.static`.
Method: my own `objdump -d` of every function below (raw opcode bytes kept, so the AT&T
reversed `fsub/fdiv` register forms were decoded from the bytes: `DE F1` = st1 = st0/st1, `DE F8+i` = st(i) = st(i)/st0,
`DE E1` = st1 = st0-st1, `DE E9` = st1 = st1-st0, `D8 FA` = st0 = st2/st0), explicit x87 stack tracking, every
`fnstsw` comparison worked from C0/C2/C3. Vtable slots checked with `SP/vt.py` (vptr-relative). Constants re-read with
`vt.rdf`. Scratch: `SP/v1/` (`v1-af.asm`, `v1-afaap.asm`, `v1-upp.asm`, `v1-urp.asm`, `v1-cvt.asm`, `v1-covo.asm`,
`v1-imp.asm`, `v1-mgr.asm`, `v1-enghu.asm`, `v1-psup.asm`, data scripts `v1-*.py`). R1's asm files were not used.

**Bottom line: no load-bearing claim of R1 was refuted.** Every sign, operand order and comparison direction I
re-derived agrees with the report. Four additions/corrections that matter to an implementer are listed first.

## 0. Corrections and additions (read these)

C1. **Wheel materials 37/38 are UNDEFINED in vanilla, so wheels get material 0, not the `Material()` defaults.**
    R1 F4's table row "every armour / building id: friction 1.0, resistance 0.01 (default)" is only true for ids
    that are *defined* without friction lines. A Counter over every `.con` in vanilla `bf1942/game.rfa` + `Objects.rfa`
    (`SP/v1/v1-matgrep.py`) finds ids **16..38 never defined**. `getFrictionForMaterial` 0x081751b0: lookup
    (`call *0x14`, 81751c1) null -> retry with id 0 (81751d9-dc). Data (`SP/v1/v1-smcheck2.py`): `Willy_WheL_M1`
    collision layer 0 = 4 verts, **mat 37**; `Kubel_wheelL/R` mat 37; Spitfire right + tail wheel mat 37 (left wheel 178);
    Sherman wheels 178 (defined, defaults). So a jeep wheel on dry grass has mu = 0.5*(1.0+0.8) = 0.9 and
    **resistance = 0.5*(0.02+0.06) = 0.04**, not the 0.035 of R1's hull example; a mat-178 tank wheel gets 0.035.
C2. **The "30" is not a constant.** `0x08716b5c` is the writable global `g_simulationFps` (`.data`, initial 30.0),
    used both for the limit division (825b7d7/825b800/825b804; soldier 825c5d8) and the final `F *= fps` (825bc67).
    `0x086b01b4` (the 30.0 cap on the bounding radius in checkVsTerrain) is a true rodata constant. Conversely the
    "gravity" inside the Coulomb limit is **hard-coded** `9.82 * 1.5` / `9.82 * 2.25` (rodata 0x086d16e4, 0x086be4d0,
    0x086d16e0); only `V.y += getGravity()/fps` (825b8e4-825b8ff, `basicPhysicsSystem` 0x0871dc30 vtable +0x14, ctor
    default 0xc16bae14 = -14.73 at 8251e3b) follows a changed gravity. R1 says this in prose; its symbol table lists
    0x08716b5c among "constants".
C3. **R1 section 5 (JS notes) drops the ENGINE_DUMMY exit.** The pseudo-code in F5 has it, the JS does not:
    `if (part.grip & 4) ...` would give the 68 vanilla `c_PGFEngineDummyGrip` springs real traction. In the binary
    `P & 0x20` and `P & 4` (825b750-5b, 825c660-71) returns before resistance, before the solve, and adds **no friction
    sample to the root mean** (so it also must not dilute the mean). Add `if ((grip & 0x24) === 0x24) { spin only; return; }`.
C4. **R1 Open-5 is settled: `pitch<float>()` takes degrees.** 0x08061dd0 -> `rotateAboutLine` 0x08061e10 ->
    `setRotateAboutLine` 0x080621b0 -> `rotateZDeg` (call at 8062253) -> `setRotateZDeg` 0x08062740 multiplies the angle
    by `0x086b1ca4` = 0.0174533 (806274c-57). SpinWheel adds `speed/radius` per tick, so the visual spin is
    30/57.296 = **0.524x** true rolling.
C5. **R1 Open-7 is confirmed in objdump** (it was flagged read-only): `updateRotationalPhysics` stores
    `torque + rotFriction` to -0x168 at 8253ea3-8253ee2 *before* the `|rotFriction|^2 > 40000` zeroing (8253f0c-8253f46);
    the first (row at +0x20, Z) projection uses that stale sum, the Y and X passes rebuild the sum from the re-read,
    post-zero accumulator (8253fef-8254038 `fadd %st(4)` with st4 = the `flds 0x4c(%edi)` at 8253f4d; 82540d8-8254120).
C6. Not in R1: `updateRotationalPhysics` has a second integration branch for objects with flag byte `obj+7 & 0x04`
    (8253c39-40): `dOmega = (torque + rotFriction) * dt/0.0314` (0x086d1398), zeroed when `|dOmega|^2 > 1e6`
    (8253ccd-8253cf1), no inertia. Which objects carry that flag is unread. Friction enters it the same way (summed
    with torque).

## 1. Verdicts

### F1 - the six floats are dead: **CONFIRMED**
Positive-`%ebp` operands in 0x0825b6e0..0x0825c749: `0x8(%ebp)` once (825b6f4), `0xc(%ebp)` 13 times; no
`lea` of a positive `%ebp` offset, no `%esp`-relative reads (the only `(%esp)` operands are float arg stores).
Caller pushes `0,0,2.0,0.45,0.9,0.45,node,this` at 825d599-825d5b3 (and 825d121-37). `PointResponsePhysics::addFriction`
0x08257e30 and `StaticResponsePhysics::addFriction` 0x0825f1c0 are `push/mov/pop/ret`.

### F2 - manager: **CONFIRMED** (parts re-read)
Flat list `+0x14` (825d491-94) gets only `call *0x1c` solveImpulse (825d4e4). Root list `+0xc` (825d4ec-ef), walking
`*0x40` getNextToCheck (825d559): node = `obj+0x60` (the part's OWN node), skip if `*0xbc` getHasSeparatePhysicsUpdate
(825d581), then solveImpulse (825d594) and addFriction (825d5b3). Addition: both pass-2 loops also gate on object flags
`(flags & 1) == 0 && (flags & 0x200) != 0` (825d4b9-cb, 825d518-2a, 825d53c-51). Pass 1 order checkObjectVsObjects
(825d3ae) then checkVsTerrain (825d3bc) confirmed. `setResponsePhysicsComponent` 0x081dd1d0: `shr $3; and $1`
(81dd1e7-ef) -> PointResponsePhysics ctor 0x08256c00; else bit 0 (81dd1f5-fa) -> ResponsePhysics 0x082582f0; else
Static 0x0825ebc0; grip `+0x71` -> `*0x70` setPermanentGrip (81dd23c-41); `+0x78` -> `*0x30` (81dd245-4d).
Ctor defaults: `(al|0x10)&0x90` (81dbd0d-19), `movb $1,0x71` (81dbd22), `orb $0xf,0x70(%ebx)` (831faa9). Not re-checked:
`addObject` class-id filing, the "13 scripts" count.

### F3 - checkVsTerrain 0x0825a960: **CONFIRMED** in full
- `*0x38` getCollisionGroups `& 1` -> return (825a972-7d). `*0x5c` getVertexCollision with `push $0` (825a98e-91).
  `dt` never read (only `0x8(%ebp)` appears).
- `cmp $3; jg` else n = 1 (825aa5c-61); `cmpl $0xa; jg 825b04f` on the already-reduced n (825aa72-79); soldier
  `movl $5` at 825b040 reached after the bbox block (all its exits jump to 825aa7f).
- bbox: max(|bb[0]|,|bb[0xc]|) (825b085-825b0a1), max with |bb[4]|,|bb[0x10]| (825b0a7-e7), `* 1.43` (0x086d16d4),
  `min(.,30)` (825b0f5-825b10e: `fucomp` r vs 30, `jne` = not greater keeps r). M = `*0x74` getRelativeTransformation
  when QI(0xc378) result has `+0x50` parent (825b12c-4d), else `*0x40`. P1 = P + rowZ*bb[0x14], P2 = P + rowZ*bb[8].
  `(P1.y - r) - h1` via `fsubrs` (825b258, 825b29a), `fucompp` vs 0, `jne 825aa7f` = NOT > 0 keeps doCheck; both > 0 ->
  `movb $0` (825b2f6). Directions as R1 states.
- depth: st0 = `w.y - h` (`fsub %st(2),%st` D8 E2 at 825adb1), compare `0` vs depth, `test $0x1,%ah; je` (825adc2-c5):
  C0 clear = NOT(0 < depth) -> contact, i.e. **depth <= 0**; NaN -> no contact. C = (w.x, h, w.z) (825aeca-dc),
  relPos = C - P (`fsubs` 825aee1-eb). speed = `root->*0x74(C)` (825af53; edi = root from the getParent walk 825aa10-2e);
  getTangentSpeed 0x08254b90 = `root.v + root.omega x (C - root.pos)`, **no centre-of-mass offset** (8254bb2-8254c5a).
- `|speed|^2` vs 0.1 (0x086b1ca0): `fucompp; test $0x45; jne 825adcd` (825afa5-ac) -> handleCollision only when
  strictly greater; its return value is discarded (825b02e-34). impulseOn `*0x18` (825ae18) runs for every contact,
  args (relPos, speed, N, depth, matSelf, matOther); inside impulseOn the adjust is `-depth * N` (`fchs` 8258984).
- materials: u16 at `verts + i*16 + 0xc` (825afd1 / 825ae9c), terrain `*0x4c` getMaterial(C.x, C.z).
- minY `fucomp` (825abde) updates when minY > w.y, outside the doCheck gate. Water: `minY - water` (`fsub` 825ac1f),
  `0 > that` strict (825ac26-2d), own node `*0xc0` setUnderWater(water - minY) (825ac60), handleCollision with
  root `*0x38` speed, normal (0,1,0), relPos (0, water - P.y, 0), vert[0] material, matOther = 1 (825acb5-ed), no impulseOn.
- vtables: PatchTerrain +0x4c/+0x54/+0x5c, object +0x74/+0x58, SimpleCollisionMesh second vptr (+0x18 getVertexCount,
  +0x1c getVertices) all as R1 lists. `getIsIntersectingTerrain` single consumer reproduced by scan (85d6731).
- Data: Willy hull L0 16 verts mat 45 / L1 56; Sherman wheel 3 verts, v0 = (0.0016,-0.3229,-0.0017), mat 178;
  Willy wheel 4 verts mat 37 (see C1).

### F4 - what impulseOn leaves: **CONFIRMED**, table **CORRECTED** by C1
Running means over `+0xa4` for normal `+0x68`, relPos `+0x8c`, speed `+0x74` (8258a6a-8258b48). `+0xa8/+0xac/+0xb0`
overwritten with `0.5*(f(mat1)+f(mat2))` (8258b76-8258c06). `L = (L & 0x80) | P` (8258b54-64). `+0x98` is written only
by zeroing (reset 8258ceb, addFriction 825bd70, ctors) - grep over every ResponsePhysics method. `Material()`
0x08174550: +0xc = 1.0, +0x10 = 0, +0x14 = 0x3c23d70a = 0.01. Material numbers re-parsed from
`materialManagerdefine.con`: every row of R1's table matches; the fallback consequence for ids 16-38 is C1.

### F5 - addFriction 0x0825b6e0: **CONFIRMED**, every branch
- Entry: `P & 0x20` -> 825c660, there `P & 4` else back to 825b761 (bare DummyGrip = normal path). count == 0 or
  P == 0 -> `movb $0,0xb4` and return, without clearing averages (825b761-8e).
- Limits (stack tracked 825b7c9-825b823): `-0x1d4` = mu*2.25*9.82/fps * N.y, `-0x1d0` = mu*1.5*9.82/fps * N.y;
  mu = `+0xa8`, N.y = `4(N)` with N = `+0x68`, or `+0x98` for class 0x9493 (825b7a2-a8 -> 825c63e). `fdiv %st(1),%st`
  is st0/st1; `DE FB` is st3/st0. Soldier variant 825c5d2-825c633: 7.2 / 4.8 and N.y^5 confirmed (three `fmul` by N.y^2
  pairs after one by N.y). Only `fabs(lim)` and `lim^2` are ever used, so the sign of N.y is irrelevant.
- V = `+0x74` - `+0x50` (`fsubrs` memory form = mem - st0, 825b8a4-ae). V.y += getGravity()/fps (825b8e4-825b905).
  Vt = V - N (V.N)/(N.N) (825c579-825c5cd, `DE F2` = st2 = st0/st2; then `fsubrs -0x78` 825b996-a0); N.N == 0 -> Vt = V.
- fwd = `(node.getParent() ?: node)->*0x20` floats +0x20..+0x28 (825b9cf-825ba03, 825c568).
- Resistance: `fucom` res vs 0, `test $0x45; jne` skips unless res > 0 (825ba10-17); vector is `fchs(Vt) * res`
  (825ba25-4e) -> **-res*Vt**; `root->*0x6c` = addAccelerationAtRelativePosition (vt.py +0x06c) with the static zero
  vector as position (825ba8e-825bae3). That function uses `r = rel - com(+0x70)` (8255267-73), so a torque
  `(-com) x a` results, as R1's JS comment says.
- ContactGrip: dV = 0 - Vt (`fsubs` memory form, 825bb19-23), spinVec = 0.
- RollGrip: X = `node->*0x20` floats +0..+8 (the wheel's own node, 825bfa5-cb); Xt = X - N (X.N)/(N.N) (825c14b-ab,
  `DE F4`); Lat = Xt (Vt.Xt)/(Xt.Xt) (825c0e9-825c143); dV = (zero-initialised -0x58) - Lat, spinVec = Vt - Lat
  (825c085-e1: `fsub %st(2),%st` = st0 - st2; `fsubrs -0x38` = Vt - Lat).
- EngineGrip: ancestor walk starts at `node.getParent()` comparing template class with 0x9476 (825c1b2-fa); no engine ->
  dV = 0, spin = 0 (a zero sample still reaches the root). Spring -> wheelNode = node, `+0xdc = 0` (825c548, 825c237-42).
  ws = getCurrentRatio * getCurrentDifferentialRPM(`node->*0x34`->x) (825c252-88). `engine+0xb4 != 0` -> T = 0
  (825c28a-a0). Else T = (1 - 0.5 s) fwd ws (`fsubrs 1.0` = 1 - 0.5s, 825c32b-46) + 0.5 s fwd (Vt.fwd)/(fwd.fwd)
  (825c4e6-825c543, 825c3b1-825c40d), then minus its N component (825c493-e1, `DE F1`), dV = T - Vt (825c2a3-e8).
- SpinWheel(fwd . spinVec) for class 0x9481 on all three paths (they converge at 825bb54; 825bb66 -> 825bf6b).
- Clamp and latch (all three grips): `test %dl,%dl; jns` (825bb78-7a) = bit 7 clear -> unlatched path 825bebc.
  Latched: `|F|^2` vs `limA^2`, st0 = |F|^2, `test $0x45; jne` leaves unless strictly greater (825bbb7-c0); same vs 1e-6
  (825bbce-d7); scale k = |limA|/|F| (`fabs`, `DE F1`, 825bbdd-ec) applied to all three components (825bbfa-fe);
  `eax = 1; dec %al; je 825bdf1` -> `and $0x7f` store (825bdf1-f4), then the same test vs limB and rescale to |limB|
  (825be27-6b). Unlatched: exceeds limB and 1e-6 -> scale to |limB| (825bef3-825bf32), else `or $0x80` (825bf47-4a).
  **The clamp is on the magnitude of the whole 3-vector**, one common factor. Edge case R1 glosses over: if
  `limA^2 <= 1e-6` the second rescale is skipped and |F| stays |limA| (< 0.001 m/s per tick; harmless).
- feedbackLoop(engine, F by value, &fwd) before the multiply (825bc45); result `fstps 0xdc(wheelNode)` (825bc61).
- Apply: `F *= g_simulationFps` (825bc67-8a); pos = `node->*0x2c` (+ `+0x8c` unless soldier) (825bc90-825bce2);
  `root->*0x70` with (pos, F) (825bd09-0f). vt.py: PhysicsNode +0x070 = addFrictionAtAbsolutePosition (0x08254e50).
  Point/Static node overrides 0x08256610 / 0x0825e730 are empty.
- Housekeeping: `|+0x74|^2 > 0.1` (`fucompp; test $0x45; je` = greater, 825bd3a-41) then `*0xdc` getSleepiness,
  `js` skips, `*0xd4` setIsAwake (825bdba-d1). Zeroes +0x50, +0xa4, +0x68, +0x98, +0x74, +0x80, +0x8c (825bd43-ac);
  material values and grips untouched.
- ENGINE_DUMMY: `node->*0xcc` isSleeping -> return; engine found and `+0xb4 == 0` -> SpinWheel(ratio*rpm); return
  through the plain epilogue (825c677-825c73c). No sample, no reset.

### F6 - addFrictionAtAbsolutePosition 0x08254e50 and integration: **CONFIRMED**
- Running mean: `(f*n + F) * 1/(n+1)` with `fld1; fadd; D8 FA` (8254eae-8254f35); torque term
  `r x F`, r = pos - `this->*0x2c` with **no `+0x70` reference anywhere in the function**; components
  ryFz - rzFy (`DE EB`), rzFx - rxFz (`DE E1`), rxFy - ryFx (`DE E1`) (8254f4a-8254fba); same mean (8254fc0-825503f);
  `n += 1` (8255042-45). Child with parent and `+0x91`: logs "addFriction only works on rootParents." (0x086d13e0),
  no forward (8255050-...). addAccelerationAtAbsolutePosition 0x08255110: sums, `fsubs 0x70(%ebx)` CoM offset
  (82551a9-bb), same `r x a` orientation, forwards to parent `*0x68` when `+0x91` (8255215-26).
- updatePositionalPhysics 0x08253570: `|a|^2 > 1e6` (0x086d1388) -> scale 1000/|a| (`DE F1`, 82536a1-d8);
  `|f|^2 > 62500` (0x086d138c) -> **zeroed** (82536f5-8253711, `jne` skips unless greater); `v += dt*a`,
  `v += dt*f`, `pos += dt*v` (new v), then both accumulators zeroed (82537d3-8253916).
- updateRotationalPhysics 0x082539e0: torque `> 1e6` -> scale to 1000 (8253b00-2f); `|rotFriction|^2 > 40000`
  (0x086d1394) -> zeroed (8253f25-46); torque and rotFriction summed and divided by `inertiaModifier.axis * I_axis`
  per body axis; `+0x64` reset at 8253ddc on every exit path. See C5, C6.
- updatePhysics 0x082543d0: one positional (82544d8) + one rotational (82544e4) call, then
  `accel.y += getGravity() * (+0x88)` (82544e9-8254502).
- The "mean not sum" consequences (max decel mu*g*N.y, drive accel halved with 2 of 4 wheels driven, a zero sample
  from a side-on hull contact dilutes) are sound inferences: every part with count > 0 and P != 0 contributes exactly
  one sample, including zero ones (RollGrip wheel with no lateral slip, EngineGrip with no engine).

### F7 - EngineGrip inputs: **CONFIRMED** where re-derived
Brake (Engine::handleUpdate 0x0823e120, edx = engine node): `-0.1 > input` (823e266-77) and `value > 0` (823e283-8a)
-> `movb $1,0xb4` (823e2b8); else `input > 0.1` (823e290-a1) and `0 > value` (823e2a7-b0) -> 1; else 0 (823e472). Doubles
-0.1 / 0.1 read. Decay: only while `s > 0`, `s -= dt / template[+0x374]` (`DE E9` = st1 - st0, 823e23c-45), floored at 0
(823e247-5a). Binary-wide scan for stores to `0xb8(%reg)`: in engine/physics code only that decay and the two
PhysicsEngine ctors; `PhysicsEngine::enterPush` 0x0824c840 is an empty function on the server. feedbackLoop:
`(F.fwd * ratio) / torque` order confirmed (`DE F1` at 824c89d). Not re-derived: the 0.99 running mean details, the
meaning of `template+0x374`, "Willy 7.0 m/s". Note: lnxded getCurrentRatio interpolates linearly between `curve[i]`
and `curve[i+1]` (decompile 0824ca70) - exact at gear/5 control points, a TANK-3 matter, not R1's.

### F8 - soldiers: **CONFIRMED**, one nuance
`+0x98` never written non-zero, so N = 0, limits 0, Vt = V. The Coulomb term is exactly zero only when
`|dV|^2 > 1e-6`; below that the latch path passes dV through unclamped (<= 0.001 m/s per tick = 0.03 m/s^2).
setSurfacePositionalSpeed callers: independent scans (every `call *0x74` with a receiver loaded from `+0x64`;
every function referencing IID 0xc42c) find only 8274e2f and 8272af3 (the latter re-sends (0, old.y, 0)).

### F9 - object contacts use **share-scaled RELATIVE velocity**: **CONFIRMED**
checkObjectVsObject 0x08259690: `-0x1c8` = A's node, `-0x1cc` = B's node (82597ba, 8259811); tangent speeds into
-0x128 (A) and -0x108 (B) (8259d76, 8259db3); rel = A - B via `fsubrs -0x128` (mem - st0) (8259dc4-e5).
shareA = massB/(massA+massB) (`DE F1`, 8259947-5f), shareB = -(1 - shareA) (`fsubr %st(2)` + `xorb $0x80`, 8259972-80),
snap > 0.95 (0x086d16cc). A's impulseOn gets `shareA * rel` (8259fdf-825a013) and `shareA * depth` (825a0c3), only when
`shareA != 0` (8259e7a-8e); mirror for B (8259ecd-...). So addFriction's `+0x74` for an object contact is relative, not
absolute. Caveats 1-3 follow from F5/F2 and stand. PhysicsSpring::updatePhysics 0x0824ddd0: `P & 8` (824de14-1f),
own object byte `+0x105` (824de24) -> setPermanentGrip(0xa) (824de35-38) else 9 (824e544). Survey reproduced exactly:
EngineDummyGrip 68, EngineGrip 43, RollGripWhenOccupied 39, RollGrip 16, all Springs; 13 aircraft x 3.

### F10 - SpinWheel 0x0825b440: **CONFIRMED** (+ C4)
Gate `P&4` or `P&2` (825b452-70) and geometry non-null; `speed > 10000` or `-10000 > speed` -> 0 (825b49e-c7);
radius = max(0.5*(bb[0x10]-bb[4]), 0.05) (825b4d3-f7); `speed / radius` (`fdivrs`) added to `+0xc0`, wrap at +-360
(825b4fc-825b54e); pitch + setTransformation on the relative (or absolute) matrix.

### F11 - Point twins: **NOT VERIFIED** beyond spot checks
impulseOn 0x08256f50, reset 0x08256f60, addFriction 0x08257e30 are empty (read). checkVsTerrain / checkObjectVsObject /
solveImpulse of the Point class were not re-derived; nothing in them carries a sign I could cheaply break.

### F12 - reset(): **CONFIRMED**
Zeroes +0x14, +0x20, +0x2c, +0x68, +0xa4, +0x98, +0x74, +0x80, +0x8c; not +0x50, +0xa8..+0xb0, +0xb4/+0xb5.

## 2. Constants re-read (`vt.rdf`)
0x086d16e4 9.82 | 0x086d16e0 2.25 | 0x086be4d0 1.5 | 0x086d16e8 7.2 | 0x086d16ec 4.8 | 0x08716b5c 30.0 (**`g_simulationFps`,
.data, mutable**) | 0x086d139c 1e-6 | 0x086b1ca0 0.1 | 0x086d16d0 9999 | 0x086d16d4 1.43 | 0x086b01b4 30 | 0x086b05e8 0.5 |
0x086ba8d4 1.0 | 0x086d1394 40000 | 0x086d138c 62500 | 0x086d1388 1e6 | 0x086b1ca8 1000 | 0x086d1398 0.0314 |
0x086c04a8 / 0x086d16d8 +-10000 | 0x086c08a8 0.05 | 0x086c0320 / 0x086d16dc +-360 | 0x086d16cc 0.95 | 0x086b1ca4 pi/180 |
CIDs 0x086c2b30 0x9476, 0x086c2b54 0x9481, 0x086c2b88 0x9493. All match R1.

## 3. R1's "Corrections" section
- Briefing s.4 item 1 (floats dead; flat list solveImpulse only): **correct**.
- Briefing s.3 "+0xa8.. averaged": **correct** - per-contact overwrite, last wins.
- Briefing s.3 PhysicsNode +0x40 / +0x64 means: **correct**.
- physics.md s.6 / PHY-2: latch in all three grips - **correct** (common tail after 825bb54); EngineGrip sets the
  friction target, not just a spin - **correct**; DummyGrip bypasses only with EngineGrip - **correct** (825c669-71).
  The working-tree physics.md already carries the magnitudes paragraph but its bullet list still says "Neither ...
  StaticFriction" and "DummyGrip ... bypasses the friction solve"; those two bullets still need the edit.
- tank-driving.md SpinWheel gate: **correct** (825b452-70). Coulomb magnitude: **answered** by F5/F6.
- stdmesh.py: **correct** - engine reads u16 at vertex+0xc; data gives coherent ids. Observation: the upper u16
  values (e.g. 0x3DC0, 0xBDAE, 0x3F2E) look like the high half of a small float, i.e. the material id appears to have
  been written over the low word of a float; unidentified, as R1 says.

## 4. Still open after this pass
F11 internals; `addObject` class filing; what `feedbackLoop` leaves in st0 (the value stored at spring `+0xdc`);
the `obj+7 & 4` rotational branch (C6); whether `+0x105` on the spring object really means "occupied".
