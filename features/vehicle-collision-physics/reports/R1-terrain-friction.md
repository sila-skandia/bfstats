# R1 - terrain contact and the friction solver (lnxded)

Track R1-terrain-friction, 2026-09-19. All addresses are `bf1942_lnxded.static`.
Confidence: **verified** = read in the decompile and cross-checked in `objdump`
(flags worked by hand where a sign / comparison / operand order matters, raw
opcode bytes checked for the AT&T `fsub/fdiv` reversed-mnemonic forms);
**read** = decompile only; **inferred** = a conclusion drawn from verified parts.
Units: metres, seconds; "per tick" means per 1/30 s. `g` = `basicPhysicsSystem->getGravity()` = -14.73.

Scratch material (mine, prefixed `r1`): `SP/r1/r1-af.asm` (addFriction), `SP/r1/r1-cvt.asm`
(checkVsTerrain), `SP/r1/r1-spin.asm`, `SP/r1/r1-full.asm` (whole `.text`, for xref greps with
`SP/r1/r1-xref.py <regex>`), extra decompiles in `SP/r1-decomp/`.

---

## 1. Findings

### F1. The six float arguments of `addFriction` are dead - **verified**

`ResponsePhysics::addFriction` (0x0825b6e0 .. 0x0825c750) never reads `0x10(%ebp)`..`0x24(%ebp)`.
The only positive-`%ebp` operands in the whole body are `0x8(%ebp)` (this, once) and `0xc(%ebp)` (the node,
13 times). `ResponsePhysicsManager::update` does push `0.45, 0.9, 0.45, 2.0, 0, 0`
(0x3ee66666, 0x3f666666, 0x3ee66666, 0x40000000, 0, 0) but nothing consumes them. `PointResponsePhysics::addFriction`
(0x08257e30) and `StaticResponsePhysics::addFriction` (0x0825f1c0) are empty functions. Every constant
that matters is hard-coded (F5). Do not try to give the six literals a meaning.

### F2. Who runs what (manager) - **read**

`ResponsePhysicsManager::addObject` (0x0825cfd0) files a response by `getClassID()`:
`0xc42d` (ResponsePhysics) into the root list `+0xc`, `0xc42e` (PointResponsePhysics) into the flat list `+0x14`;
a StaticResponsePhysics is not registered at all. In `update` (0x0825d0b0):

- pass 1, both lists: `checkObjectVsObjects(dt,obj)` then `checkVsTerrain(dt)` - so when a part has
  both an object contact and a terrain contact in one tick, the **terrain's** material pair is the last
  one written (F4, "last contact wins").
- pass 2, flat (Point) list: `solveImpulse` only. Root list (walking `getNextToCheck`):
  `solveImpulse` then `addFriction`, skipped when the node `getHasSeparatePhysicsUpdate()`.
- the single-object form (`obj != 0`, used for separate-physics-update objects) does
  check + terrain + `solveImpulse` + `addFriction` for that one object.

Which response class an object gets (`SimpleObjectTemplate::setResponsePhysicsComponent` 0x081dd1d0,
template flag byte `+0x70`): bit 3 (`hasPointPhysics`) -> PointResponsePhysics; else bit 0
(`hasMobilePhysics`) -> ResponsePhysics; else StaticResponsePhysics. Defaults: `SimpleObjectTemplate`
ctor clears bits 0-3 (0x081dbd0d-19); `ProjectileTemplate` ctor sets them all (`orb $0xf,0x70` at 0x0831faa9),
so **every projectile is a Point body unless the .con says `setHasPointPhysics 0`** (vanilla: 13 scripts,
first `Objects/HandWeapons/ExpPack`, also `Vehicles/Sea` weapons - those become ordinary rigid bodies). The template's grip byte `+0x71` (default **1 = ContactGrip**,
0x081dbd22) goes to `setPermanentGrip`, `+0x78` to `addToCollisionGroup`.

### F3. `ResponsePhysics::checkVsTerrain(dt)` 0x0825a960 - **verified** (dt itself is never read)

```
if (getCollisionGroups() & 1) return            // 825a972; 1 = c_CGLandscape (ObjTemplBFModule::init 0x08299447)
vc = getVertexCollision(0)  ; if !vc return      // 825a991: collision LOD 0 of the part's OWN mesh
obj = this+0x10 ; P = obj.getAbsolutePosition()  // 825a9d9
node = obj+0x60 ; root = walk node.getParent()   // 825aa10
minY = 9999.0                                    // 0x086d16d0
n = vc.getVertexCount() ; if n == 0 return
if n <= 3  n = 1                                  // 825aa5c: only vertex 0 is tested
doCheck = true
if n > 10:                                        // 825aa72 -> 825b04f, bounding-box early-out
    bb = geometry.getBoundingBox()                // floats [0..2]=min xyz, [3..5]=max xyz
    r  = min(1.43 * max(|bb.minX|,|bb.maxX|,|bb.minY|,|bb.maxY|), 30.0)   // 0x086d16d4, 0x086b01b4
    M  = obj has parent ? obj.getRelativeTransformation() : obj.getAbsoluteTransformation()
    P1 = P + M.rowZ * bb.maxZ ;  P2 = P + M.rowZ * bb.minZ
    if (P1.y - r) - H(P1) > 0  and  (P2.y - r) - H(P2) > 0   doCheck = false   // 825b2a3, 825b2e9
if templateClass == 0x9493 (soldier)  n = 5       // 825aa94 -> 825b040
M = obj.getAbsoluteTransformation()
for i in 0..n-1:
    w = P + rotate(M, vert[i].xyz)                // row-vector: w.x = M[0]*vx + M[4]*vy + M[8]*vz ...
    if doCheck:
        h, N = terrain.getHeightAndNormal(w.x, w.z)          // PatchTerrain 0x083d6f10, N unit length
        depth = w.y - h                                       // 825adb1 (st0 = w.y - h)
        if !(0 < depth):                                      // 825adc2 test $1,%ah ; je -> contact. depth <= 0
            C      = (w.x, h, w.z)                            // contact point = the terrain point under the vertex
            relPos = C - P                                    // 825aee1-eb
            speed  = root.getTangentSpeed(C)                  // 825af53, = rootV + rootOmega x (C - rootPos)
            matSelf  = u16 at vert[i]+0xc                     // per-vertex material
            matOther = terrain.getMaterial(C.x, C.z)          // vtable +0x4c, 0x083d6800
            if |speed|^2 > 0.1:                               // 825afa5, 0x086b1ca0, strict
                obj.handleCollision(obj, NULL, speed, N, relPos, matSelf, matOther)   // 825b02e, RETURN VALUE IGNORED
            this.impulseOn(relPos, speed, N, depth, matSelf, matOther)               // 825ae18, always
            avgC = running mean of C                          // 825ae1b-77
    minY = min(minY, w.y)                                     // 825abde; runs even when doCheck is false
water = terrain.getWaterLevel(P.x, P.z)           // PatchTerrain: one global level, *(terrain+0x30)
if 0 > minY - water:                              // 825ac26, strict
    node.setUnderWater(water - minY)              // 825ac60, on the part's OWN node, not the root
    obj.handleCollision(obj, NULL, root.getPositionalSpeed(), (0,1,0), (0, water - P.y, 0),
                        vert[0].material, 1)      // 825aced; 1 = the Water material. No impulseOn.
else node.setUnderWater(0)                        // 825ad41
this+0xd0 = anyContact ; this+0xc4 = avgC         // what getIsIntersectingTerrain returns
```

Points that matter:

- **Vertices, not faces, and LOD 0.** Collision layer 0 of the part's own `.sm`. Data check: Willy hull layer 0
  = 16 vertices (layer 1 = 56), Sherman wheel = 3 vertices with vertex 0 at the bottom of the wheel
  (0.002, -0.323, -0.002), Willy wheel = 4. The `n <= 3 -> 1` rule is how a 3-vertex wheel mesh becomes a single
  contact point.
- **Penetration is vertical** (`w.y - h`, <= 0), but `impulseOn` multiplies it onto the (sloped) normal:
  positional adjust `= -depth * N`, so on a slope the push-out is `|dy|` along N, not `|dy|*N.y`.
- **No share**: `impulseOn` has no share parameter. Against terrain the full speed and full depth are passed
  (an implicit share of 1.0); in object-vs-object the caller pre-multiplies both by the share.
- **`handleCollision`'s verdict is ignored for terrain** - the impulse is applied regardless (contrast
  object-vs-object, where both must return 1).
- Water never produces an impulse here. It sets `underWater` (which scales drag x25, physics.md s.3) and fires a
  collision notification **every tick** the lowest tested vertex is below the water level, with no speed floor.
- `getIsIntersectingTerrain` (0x0825ce10: copies `+0xc4`, returns byte `+0xd0`) has exactly one consumer,
  `AIObjectPhysical::isTouchingLand` 0x085d6700.
- The 4th float of a collision vertex in the `.sm` file is **not a float**: its low u16 is the material id
  the engine reads at `vertex+0xc` (Willy hull 45, Sherman hull 50/51/52, Spitfire fuselage 60-63, wheels 37/38/178).

### F4. What `impulseOn` leaves behind for the friction pass - **read** (0x08258900)

Running means over the tick's contacts (count `+0xa4`): normal `+0x68`, speed `+0x74`, relative position `+0x8c`.
**Not** averaged: friction `+0xa8`, elasticity `+0xac`, resistance `+0xb0` - each call overwrites them with
`0.5*(value(mat1) + value(mat2))`, so the last contact of the tick wins. Live grip `+0xb4 = (live & 0x80) | getPermanentGrip()`.
The Vec3s at `+0x80` and `+0x98` are zeroed by ctor / `reset()` / addFriction and written by nothing else
(grep of every `0x98(%e..)` operand in `ResponsePhysics::*`), which matters for soldiers (F8).

Material numbers (`Bf1942/Game/materialManagerdefine.con`; `Material::Material()` 0x08174550 defaults
friction 1.0, elasticity 0, **resistance 0.01**; an undefined id falls back to material 0):

| id | terrain | friction | resistance |
|---|---|---|---|
| 0 default | | 1.0 | 0.02 |
| 1 water | | 0.1 | 0.1 |
| 2 / 3 dry / juicy grass | | 0.8 | 0.06 / 0.08 |
| 4 dry dirt | | 1.0 | 0.04 |
| 5 wet dirt | | 0.8 | 0.06 |
| 6 / 7 mud / outside map | | 0.5 | 0.1 / 0.08 |
| 8 gravel | | 1.1 | 0.02 |
| 9, 10 frozen, dry sand | | 0.8 | 0.05 |
| 11 wet sand | | 0.8 | 0.04 |
| 12 rock | | 0.6 | 0.01 |
| 13, 14 sand / dirt road | | 1.0 | 0.02 |
| 15 paved road | | 1.1 | 0.01 |
| 70 | | 2.0 (elasticity 2.0, resistance 2.0) | |
| 96-98 (stairs) | | 10.0 | 1 |
| every armour / building id | | 1.0 (default) | 0.01 (default) |

All terrain elasticities are 0. So a vehicle part (mat 45, mu 1.0) on dry grass has mu = 0.9, resistance 0.035;
vehicle on vehicle has mu = 1.0, resistance 0.01.

### F5. `ResponsePhysics::addFriction(node, ...)` 0x0825b6e0, the whole thing - **verified**

`P` = `getPermanentGrip()` (authored byte `+0xb5`), `L` = live byte `+0xb4`.

```
if (P & 0x20):                                  // 825b750 DummyGrip
    if (P & 4): goto ENGINE_DUMMY               // 825c660
    // DummyGrip WITHOUT EngineGrip falls through to the normal path
if count(+0xa4) == 0 or P == 0:  L = 0 ; return // 825b761 / 825b786: NoGrip = no friction, latch cleared.
                                                // (the P==0 exit does NOT reset the contact averages)
N = (soldier 0x9493) ? this+0x98 : this+0x68    // 825b7a2; +0x98 is always zero, see F8
mu = this+0xa8
limA = mu * 2.25 * 9.82 / 30 * N.y              // 825b7c9-825b81b  "static"  = mu*N.y*0.7365 m/s per tick (22.095 m/s^2)
limB = mu * 1.5  * 9.82 / 30 * N.y              //                   "kinetic" = mu*N.y*0.4910 m/s per tick (14.73 m/s^2 = |g|)
   soldier: limA = mu*7.2*9.82/30*N.y^5, limB = mu*4.8*9.82/30*N.y^5      // 825c5d2-825c633
root = walk node.getParent()
V   = avgSpeed(+0x74) - surfaceSpeed(+0x50)     // 825b899-ae  (fsubrs: mem - st0)
V.y += g / 30                                   // 825b8e4-ff  next tick's gravity, plain getGravity(), no gravityModifier
Vt  = V - N * (V.N)/(N.N)     (Vt = V if N.N == 0)     // 825b91a-825b9a0
fwd = (node.getParent() ?: node).getAbsoluteTransformation().rowZ       // 825b9cf-825ba03

// (a) resistance - an ACCELERATION, summed, at the root's origin
if resistance(+0xb0) > 0:                       // 825ba10
    root.addAccelerationAtRelativePosition((0,0,0), -resistance * Vt)   // 825bae3, vtable +0x6c

// (b) the velocity change the contact would like, per tick
if L & 4:            // EngineGrip                                        825c1b0
    engine = nearest ancestor node whose object template class is 0x9476 (EngineTemplate)
    if !engine:      dV = 0 ; spin = 0
    else:
        if this object is a Spring (0x9481): wheelNode = node ; wheelNode+0xdc = 0
        ws = engine.getCurrentRatio() * engine.getCurrentDifferentialRPM(node.getRelativePosition().x)
        if engine+0xb4 (byte) != 0:  T = 0                                // braking, see F7
        else:
            s = engine+0xb8                                               // 1.0 at creation, decays to 0, see F7
            T = (1 - 0.5*s) * fwd * ws + (0.5*s) * fwd*(Vt.fwd)/(fwd.fwd) // 825c2ed-825c40d
            T = T - N*(T.N)/(N.N)                                         // 825c410-825c48e
        dV = T - Vt ; spinVec = T                                         // 825c2a3-e8
elif L & 2:          // RollGrip                                          825bf99
    X  = node.getAbsoluteTransformation().rowX                            // the wheel's own axle, so steering rotates it
    Xt = X - N*(X.N)/(N.N)
    Lat = Xt * (Vt.Xt)/(Xt.Xt)                                            // 825c0e9-825c143 (DE F4 = st4 = st0/st4)
    dV = -Lat ; spinVec = Vt - Lat                                        // 825c085-e1
else:                // ContactGrip (and bare DummyGrip)                  825bb11
    dV = -Vt ; spinVec = 0
if this object is a Spring: SpinWheel(fwd . spinVec)                      // 825bb66 -> 825bf6b

// (c) Coulomb clamp with a static latch - applies to ALL three grips
F = dV
if L & 0x80:                                    // 825bb78 jns
    if |F|^2 > limA^2 and |F|^2 > 1e-6:         // 825bbb7, 825bbce (0x086d139c)
        L &= 0x7f                               // 825bdf1 latch breaks
        F *= |limA|/|F| ; then F *= |limB|/|F| if |F|^2 > limB^2 (it always is) -> |F| = |limB|
    // else: F = dV in full, the contact holds
else:
    if |F|^2 > limB^2 and |F|^2 > 1e-6:  F *= |limB|/|F|                 // 825bef3-825bf3c
    else:                               L |= 0x80                        // 825bf47 latch sets
if engine: r = PhysicsEngine::feedbackLoop(engine, F, fwd) ; if wheelNode: wheelNode+0xdc = r   // 825bc45-61

// (d) apply
pos = node.getAbsolutePosition() + (soldier ? 0 : avgContactPos(+0x8c))   // 825bc90-825bce2
root.addFrictionAtAbsolutePosition(pos, F * 30)                           // 825bc67-8a, 825bd0f, vtable +0x70

// (e) housekeeping
if |avgSpeed(+0x74)|^2 > 0.1 and root.getSleepiness() >= 0: root.setIsAwake()   // 825bd3a, 825bdc5
zero +0x50 (surface speed!), +0xa4 count, +0x68, +0x98, +0x74, +0x80, +0x8c     // 825bd43-825bdaf

ENGINE_DUMMY (P & 0x24 == 0x24):                // 825c677
    if node.isSleeping() return
    engine = ancestor walk as above
    if engine and engine+0xb4 == 0: SpinWheel(ratio * differentialRPM(relPos.x))
    return                                       // no friction, no feedback, no reset
```

Every comparison above was worked from the `fnstsw` flags: `test $0x45 ; jne` after `fucom` with
`st0 = |F|^2, st1 = lim^2` skips unless `|F|^2 > lim^2` (strict); the division that builds the scale factor is
`DE F1` = `st1 = st0/st1` = `|lim| / |F|`; the limit division is `DE FB` = `st3 = st3/st0` = `1.5*mu*9.82 / 30`.

**The force magnitudes (the open item in physics.md s.6).** There is no force and no mass in the friction
solver. Each contacting part asks for the velocity change `dV` that would make its contact patch do what its
grip wants (stop; stop sideways; match the engine's surface speed), clamps the *vector* to a Coulomb disc of radius
`mu * N.y * 14.73/30` m/s per tick (`mu * N.y * 22.095/30` while latched static), multiplies by 30 to make an
acceleration, and hands it to the root node at the contact point. `1.5 * 9.82 = 14.73` is exactly the game's
gravity, so kinetic friction is textbook `mu * g * cos(slope)`; static is 1.5x that, with hysteresis (break above
limA, re-latch only once the wanted `dV` is back inside limB).

**What makes the power slide - inferred from the above.** The clamp is on the combined vector (a friction
circle). A driven wheel that is spinning asks for a longitudinal `dV = ws - v` of several m/s against a
0.44 m/s budget (grass), so after the clamp almost the whole budget points forward and the wheel's lateral grip
collapses; the RollGrip front wheels only ever ask for `-Lat`, so they keep theirs. Rear breaks away, front holds.
No slip-angle curve exists anywhere.

**What is added vs averaged - verified** (F6): resistance goes through `addAcceleration...` and *sums*
over parts; the Coulomb term goes through `addFriction...` and is a *mean* over the parts that touched this tick.

### F6. `PhysicsNode::addFrictionAtAbsolutePosition` 0x08254e50 and how friction integrates - **verified**

```
n = node+0x64 (float)
posFriction(+0x40) = (posFriction*n + F) / (n+1)                 // D8 FA: st0 = st2/st0 = 1/(n+1)
rotFriction(+0x4c) = (rotFriction*n + (pos - nodePos) x F) / (n+1)   // r x F, DE EB / DE E1 checked component by component
node+0x64 = n + 1
```
A child node with byte `+0x91` set does **not** forward this call to its parent (unlike the acceleration
calls); it logs a Debug error. addFriction always calls it on the root, so that path is never taken.

Differences from the acceleration accumulators (`addAccelerationAtAbsolutePosition` 0x08255110, read):

| | acceleration `+0x28` / torque `+0x34` | friction `+0x40` / `+0x4c` |
|---|---|---|
| combine | sum | running mean, count at `+0x64` (reset in `updateRotationalPhysics`) |
| lever arm | `pos - nodePos - centreOfMassOffset(+0x70)` | `pos - nodePos` (no CoM offset) |
| safety | `|a| > 1000` -> rescaled to 1000 (0x082536a9) | `|f| > 250` -> **zeroed** (62500, 0x082536fd); rot `|f| > 200` -> zeroed (40000, 0x086d1394) |
| integrate | `v += dt*a` | `v += dt*f` (`updatePositionalPhysics` 0x08253570); torque and rotFriction are added and go through the same `/(inertiaModifier*I)` (`updateRotationalPhysics` 0x082539e0, read) |

`PhysicsNode::updatePhysics` (0x082543d0, read) does one positional + one rotational step per tick (no
4 sub-steps; those are `PointPhysicsNode`), then re-seeds `accel.y += g*gravityModifier`. That re-seeded gravity
is what the `V.y += g/30` in addFriction anticipates: friction is computed against the velocity the body will have
*after* gravity acts, so a body inside its static limit does not creep down a slope.

Consequence (inferred): maximum Coulomb deceleration of a whole vehicle is `mu*g*N.y` however many wheels touch;
with two driven and two rolling wheels the best drive acceleration is half of that (two clamped entries out of four).
A hull contact with a vertical face (F9) adds a zero entry and *dilutes* wheel friction and traction.

### F7. EngineGrip inputs - **read** (Engine::handleUpdate 0x0823e120, PhysicsEngine 0x0824c6f0..)

- `ws = getCurrentRatio() * getCurrentDifferentialRPM(x)` is a **surface speed in m/s**: ratio is
  `3.5*differential/curve[gear]` (tank-driving.md TANK-3), the "RPM" is the engine value `+0xa0` in [-1,1]
  (differential-adjusted, TANK-2). Willy gear 1: 7.0 m/s at full engine value.
- `engine+0xb4` (byte) = **brake**: set to 1 in `Engine::handleUpdate` when the throttle input (`Engine+0x124`)
  opposes the running engine value (`input < -0.1 && value > 0`, or `input > 0.1 && value < 0`; doubles -0.1 / 0.1 at
  0x086cf658 / 0x086ba1d8), else 0. While set, driven wheels want `T = 0`: a full stop in every direction, like ContactGrip.
- `engine+0xb8` = 1.0 from the ctor (0x0824c74c), reduced each tick by `dt / template[+0x374]`, floored at 0, and
  **nothing ever sets it again** (only writers: ctor, that decay). So in steady state `s = 0` and
  `T = fwd * ws`. (`template+0x374` sits after numberOfGears `+0x360`, differential `+0x364`, gear-up `+0x36c`,
  gear-down `+0x370`; "gear change time" is inferred from position, not read.)
- `feedbackLoop(engine, F, fwd)` 0x0824c850: `load = (F.fwd) * ratio / torque` (clamped to [-1,1] when template
  flag 2), folded into `engine+0xa4` as a 0.99-damped running mean; `handleUpdate` pulls the engine value toward
  `target - load`. F is the clamped per-tick `dV` (before the x30). This is the only place traction talks back to the engine.

### F8. Soldiers and `setSurfacePositionalSpeed` - **verified** for the mechanism

For template class 0x9493 addFriction takes its normal from `this+0x98`, which nothing ever writes, so
`N = 0`: `limA = limB = 0` (and they scale with `N.y^5` anyway), no normal is removed (`Vt = V`), and the
Coulomb term clamps to exactly zero. What is left is (a): `accel = -resistance * (avgContactSpeed - surfaceSpeed + (0,g/30,0))`
on the root. The only callers of `setSurfacePositionalSpeed` in the binary are `BFSoldier::handlePlayerInput`
(0x08274e2f) and `BFSoldier::handleUpdate` (0x08272af3, which keeps Y and zeroes X/Z); found by scanning every
`call *0x74/0x78` whose receiver was loaded from `obj+0x64`, plus every function that references IID 0xc42c.
addFriction zeroes `+0x50` every tick, so it is a per-tick input. `resistance` for a soldier on terrain is
0.5*(0.02 + terrain), i.e. 0.015-0.06 /s - a very weak coupling; soldier locomotion proper is elsewhere (physics.md s.8).

### F9. Does a moving vehicle drag what it touches? - **read** (+ inferred)

Not through `surfacePositionalSpeed` - no vehicle code writes it (F8). It happens through the averaged
contact speed: `checkObjectVsObject` (0x08259690, decompile lines 455-640) passes
`impulseOn(hit - posA, shareA * (vA(hit) - vB(hit)), n, shareA*depth, matVertex, matFace)` and the mirror with
`shareB`, so the speed addFriction sees for an object contact is the **share-scaled relative velocity**.
Friction therefore drives the tangential *relative* velocity to zero: a light object resting on a heavy moving
one (share about 1) is carried along; the heavy one (share snapped to 0) gets no `impulseOn` at all and so no
friction entry. Three caveats, all from F5:

1. The budget scales with the contact normal's **Y**, not with any normal force. A jeep ramming a parked plane
   side-on has `N.y` near 0, so `limA = limB` near 0 and the contact contributes **no Coulomb friction** (it still
   adds a zero sample to the mean, diluting the wheels'), only `-0.01 * Vt` of resistance. Friction between
   objects exists only for roughly horizontal contact faces (something standing or lying on something).
2. `V.y += g/30` is added unscaled even though the speed is share-scaled.
3. A part that touched both an object and the terrain this tick has one merged average (normal, speed,
   position) and the terrain's material pair.

The **parked plane itself**: every aircraft wheel in vanilla is `c_PGFRollGripWhenOccupied` (13 aircraft x 3);
`PhysicsSpring::updatePhysics` (0x0824ddd0, line 114-128, read) rewrites the *permanent* grip to 9 (empty) or
10 (occupied) from object byte `+0x105`. So an empty plane stands on three ContactGrip wheels holding it with static
friction up to `22.1 * mu * N.y` m/s^2 (averaged), and the ram has to beat that; an occupied one rolls freely
along its wheels' forward axis.

### F10. `SpinWheel(speed)` 0x0825b440 - **verified** (constants and comparisons), purely visual

Gate: `getPermanentGrip() & (4|2)` and the object has a geometry. `|speed| > 10000 -> 0`.
`radius = max(0.5*(bb.maxY - bb.minY), 0.05)`; `angle(+0xc0) += speed / radius` per tick, wrapped by one turn at
+-360; the part's relative transformation is re-posed with `pitch(M, angle)`. No force. (If `pitch` takes degrees,
as the 360 wrap suggests, the visual spin is 30/57.3 = 0.52x true rolling; not checked.) ContactGrip wheels get
`SpinWheel(0)` and the gate then drops it.

### F11. The Point twins - **read**

`PointResponsePhysics` (projectiles, grenades, bombs; F2): `impulseOn`, `addFriction` and `reset` are empty.
`checkVsTerrain(dt)` (0x08257720): skip if `collisionGroups & 1`; `node.setUnderWater(0)`; sweep the segment
`prev = pos - v*dt -> pos` against the terrain through `ResponsePhysicsManager::getTerrainVectorCollider()`
(0x0825e3b0: caches `terrainBase->queryInterface(0xb54616fc)` at manager `+8`; this is the only user of it) with
`getDistanceToGeometry`. It keeps one record, the hit farthest from the current position
(`+0x1c` = dist^2, `+0x20` other object or NULL, `+0x24` hit point, `+0x30` own position, `+0x3c` other's speed,
`+0x48` own (relative) speed, `+0x54` = 1.0, `+0x58` a float from the collider, `+0x5c` normal, `+0x68` own material = 0,
`+0x6c` other material = `terrain.getMaterial`). If the segment crossed the water plane (`pos.y <= water <= prev.y`)
and that crossing is farther, the record becomes normal (0,1,0), material 1, and `setUnderWater(water - pos.y)`.
`checkObjectVsObject` (0x08257030) does the same sweep in B's frame against B's **LOD 1** face mesh, skips a
projectile's own shooter vehicle, requires `isSolidMaterial`, and stores speed `= vA - B.getTangentSpeed(hit)`.
`solveImpulse` (0x08256f70): `if record.dist2 >= 0: obj.handleCollision(obj, other, &speed, &normal, hit - pos, 0, otherMat); dist2 = -1`.
**The engine applies no physical response to a Point body and none to what it hits**; bounce, stick or detonate
is entirely the object's own `handleCollision`.

### F12. `reset()` 0x08258ca0 - **read**

Zeroes adjusts `+0x14..+0x34`, normal/speed/`+0x80`/position/`+0x98`, count. Leaves `+0x50`, the three material
values and both grip bytes. In the normal tick its work is split: `solveImpulse` zeroes the adjusts at its end,
addFriction zeroes the averages (and `+0x50`). A part with permanent grip 0 exits addFriction before that and
keeps accumulating its averages across ticks (no vanilla object has grip 0: the survey finds only
EngineDummyGrip 68, EngineGrip 43, RollGripWhenOccupied 39, RollGrip 16, all on Springs; everything else is the default 1).

---

## 2. Symbol table

| address | name | note |
|---|---|---|
| 0x0825a960 | ResponsePhysics::checkVsTerrain(float) | F3; `dt` unused |
| 0x0825b6e0 | ResponsePhysics::addFriction(IPhysicsNode*, 6 floats) | F5; the floats unused; ends 0x0825c750 |
| 0x0825b440 | ResponsePhysics::SpinWheel(float) | F10; angle at `+0xc0` |
| 0x08258900 | ResponsePhysics::impulseOn | F4 |
| 0x08258ca0 | ResponsePhysics::reset | F12 |
| 0x0825ce10 | ResponsePhysics::getIsIntersectingTerrain(Vec3&) | `+0xc4` mean terrain contact point, `+0xd0` flag |
| 0x0825ce90 / 0x0825ceb0 | set / getSurfacePositionalSpeed | `+0x50`; BFSoldier only |
| 0x0825ce40 / 0x0825ce60 | get / setPermanentGrip | `+0xb5` |
| 0x082587e0 | ResponsePhysics::getVertexCollision(uchar lod) | caches mesh (IID 0xd0867dfb) at `+0xdc`, dirty byte `+0xd8` |
| 0x08254e50 | PhysicsNode::addFrictionAtAbsolutePosition | F6 |
| 0x08255230 | PhysicsNode::addAccelerationAtRelativePosition | `accel += a; torque += (rel - com) x a` |
| 0x08254b90 | PhysicsNode::getTangentSpeed(Pos3) | `rootV + rootOmega x (p - rootPos)` |
| 0x08253570 / 0x082539e0 | PhysicsNode::updatePositional / RotationalPhysics | clamps 1000 / 250 / 200 |
| 0x0825cfd0 | ResponsePhysicsManager::addObject | class 0xc42d -> list `+0xc`, 0xc42e -> list `+0x14` |
| 0x0825d0b0 | ResponsePhysicsManager::update | F2 |
| 0x0825e3b0 | ResponsePhysicsManager::getTerrainVectorCollider | terrain as IVectorCollider 0xb54616fc, cached `+8` |
| 0x08257720 / 0x08257030 / 0x08256f70 | PointResponsePhysics::checkVsTerrain / checkObjectVsObject / solveImpulse | F11 |
| 0x08256f50 / 0x08257e30 / 0x08256f60 | PointResponsePhysics::impulseOn / addFriction / reset | empty |
| 0x0825f1b0 / 0x0825f1c0 / 0x0825f120 / 0x0825f140 | StaticResponsePhysics::checkVsTerrain / addFriction / impulseOn / solveImpulse | empty |
| 0x081dd1d0 | SimpleObjectTemplate::setResponsePhysicsComponent | template `+0x70` bit 3 Point, bit 0 mobile; `+0x71` grip; `+0x78` groups |
| 0x081ddeb0 / 0x081ddec0 | SimpleObjectTemplate::setGrip / getGrip | `+0x71`, ctor default 1 |
| 0x08748fa0 | vtable PatchTerrain | `+0x4c` getMaterial, `+0x54` getHeightAndNormal, `+0x5c` getWaterLevel |
| 0x083d6f10 | PatchTerrain::getHeightAndNormal | alternating-diagonal triangles, unit face normal (Phong if terrain `+0xf4`) |
| 0x083d7a80 | PatchTerrain::getWaterLevel | returns `*(this+0x30)`, ignores x,z |
| 0x08747fc0 | vtable SimpleCollisionMesh (2nd vptr) | `+0xc` setCollisionLod, `+0x14` getNumCollisionLods, `+0x18` getVertexCount, `+0x1c` getVertices (16-byte records, u16 material at +0xc) |
| 0x0824c850 | PhysicsEngine::feedbackLoop(Vec3, Vec3 const&) | F7 |
| 0x0823e120 | Engine::handleUpdate | writes engine `+0xb4` brake, decays `+0xb8` |
| 0x08174550 | Material::Material() | friction 1.0, elasticity 0, resistance 0.01 |
| 0x086c2b30 / b54 / b88 | CID constants 0x9476 Engine, 0x9481 Spring, 0x9493 BFSoldier | |
| constants | 0x086d16e4 9.82, 0x086d16e0 2.25, 0x086be4d0 1.5, 0x086d16e8 7.2, 0x086d16ec 4.8, 0x08716b5c 30, 0x086d139c 1e-6, 0x086b1ca0 0.1, 0x086d16d0 9999, 0x086d16d4 1.43, 0x086b01b4 30, 0x086b05e8 0.5, 0x086ba8d4 1.0 | all read with `vt.rdf` |
| collision groups | c_CGLandscape 1, c_CGStaticObjects 2, c_CGLadders 4, c_CGProjectiles 8 | ObjTemplBFModule::init 0x08299447.. |

---

## 3. Corrections

To the briefing:

- s.4 item 1: addFriction's literals are passed but never read (F1); and the flat list (`+0x14`, Point bodies)
  gets `solveImpulse` only, never `addFriction`.
- s.3 "`+0xa8/+0xac/+0xb0` averaged friction / elasticity / resistance": averaged over the two materials of one
  contact, **not** over the tick's contacts - the last `impulseOn` wins.
- s.3 PhysicsNode "`+0x4c` rotational friction accumulator": add `+0x40` positional friction accumulator and
  `+0x64` the float sample count; both are means, not sums.

To the corpus:

- physics.md s.6 / ledger PHY-2 "force magnitudes were not read": now read (F5). Also: the StaticFriction latch
  (0x80) is applied in all three grip modes, not only "neither"; EngineGrip is not just a wheel spin - it sets the
  friction *target velocity* to the engine surface speed, and that is the only traction force; DummyGrip bypasses
  the solve only together with EngineGrip (0x24) - a bare 0x20 runs the ordinary ContactGrip path.
- tank-driving.md Open, "`SpinWheel`'s own internal gate": confirmed, `getPermanentGrip() & 4` or `& 2` (0x0825b455-70).
- tank-driving.md Open, "exact Coulomb friction force magnitude at a single wheel contact": F5 / F6.
- `tools/bf1942-models/bf42/stdmesh.py` documents a collision vertex as `f32 position[3], f32 unknown`; the engine
  reads a **u16 material id** at +0xc (verified against Willy / Sherman / Spitfire data). The upper u16 is unidentified.

---

## 4. Open

1. `PhysicsSpring +0xdc` (receives `feedbackLoop`'s return for driven Spring wheels): no reader found in
   `PhysicsSpring::updatePhysics`; next lead: grep `0xdc(%e` in `SpringNetworkable` / effect code.
2. `Engine::handleUpdate`'s evolution of the engine value (`((target - load) - value*0.5)*0.05 + value`, the 1.2 / -1
   clamps, gear shifting) was only skimmed; needed for exact acceleration curves, not for friction.
3. `template+0x374` naming (gear change time?) and whether anything re-arms `engine+0xb8` on the client.
4. c_CGLandscape semantics beyond "skips the terrain test"; no vanilla object uses it.
5. Whether `pitch<float>()` takes degrees (SpinWheel visual rate).
6. Client twins of all of the above were not located this round.
7. `updateRotationalPhysics`: the Z-axis projection uses the torque+friction sum computed *before* the
   `|rotFriction| > 200` zeroing while X and Y re-read it after (decompile lines 126-136) - read only, unverified in objdump.
8. The averaged normal is not re-normalised before `N.y` scales the limits (mean of unit normals, so <= 1).

---

## 5. Implementation notes (JavaScript, fixed 30 Hz)

Per tick, per physical part (hull, each wheel) keep `{n:0, normal, speed, pos, mu, res, grip, latch}`.

```js
// 1. terrain contact (after object-vs-object for the same part)
const verts = part.colLayer0; const N = verts.length <= 3 ? 1 : verts.length;    // soldiers: 5
for (let i = 0; i < N; i++) {
  const w = add(objPos, rotate(objRot, verts[i].p));
  const {h, n} = terrain.heightAndFaceNormal(w.x, w.z);       // unit face normal of the alternating-diagonal triangle
  const depth = w.y - h;  if (depth > 0) continue;
  const C = {x:w.x, y:h, z:w.z};
  const v = add(root.v, cross(root.w, sub(C, root.pos)));
  if (dot(v,v) > 0.1) onCollision(part, null, v, n, sub(C,objPos), verts[i].mat, terrain.material(C.x,C.z));
  impulseOn(part, sub(C,objPos), v, n, depth, verts[i].mat, terrain.material(C.x,C.z));   // always
}
// impulseOn: posAdjust=-depth*n, speedAdjust=-(v.n)n (per-axis setAdjust merge), running means of n/v/pos,
//            part.mu = (mu[a]+mu[b])/2, part.res = (res[a]+res[b])/2  (overwrite, last wins)

// 2. friction (after solveImpulse)
function addFriction(part, root) {
  if (part.n === 0 || part.grip === 0) { part.latch = false; return; }
  const Nn = part.normal, limB = part.mu * 14.73/30 * Nn.y, limA = 1.5 * limB;
  let V = sub(part.speed, part.surfaceSpeed || ZERO);  V.y += GRAVITY/30;       // GRAVITY = -14.73
  const Vt = sub(V, project(V, Nn));
  if (part.res > 0) root.accel = add(root.accel, scale(Vt, -part.res));          // + torque (-(com)) x a
  let dV;
  if (part.grip & 4)      dV = sub(tangent(engineBraking ? ZERO : scale(fwd, ratio*rpm), Nn), Vt);
  else if (part.grip & 2) dV = neg(project(Vt, tangent(part.axleX, Nn)));
  else                    dV = neg(Vt);
  const m = len(dV);
  if (part.latch) { if (m > Math.abs(limA) && m*m > 1e-6) { part.latch = false; dV = scale(dV, Math.abs(limB)/m); } }
  else if (m > Math.abs(limB) && m*m > 1e-6) dV = scale(dV, Math.abs(limB)/m);
  else part.latch = true;
  root.frictionSamples.push({pos: add(part.nodePos, part.pos), f: scale(dV, 30)});
  part.n = 0; /* zero the means and surfaceSpeed */
}

// 3. integrate root (once per tick, no sub-steps)
const k = root.frictionSamples.length;
const f  = k ? scale(sum(s => s.f), 1/k) : ZERO;
const tf = k ? scale(sum(s => cross(sub(s.pos, root.pos), s.f)), 1/k) : ZERO;    // no CoM offset here
if (dot(f,f) > 62500) f = ZERO;  if (dot(tf,tf) > 40000) tf = ZERO;
root.v = add(root.v, scale(add(root.accel, f), DT));  root.pos = add(root.pos, scale(root.v, DT));
// angular: (root.torque + tf) projected on each body axis / (inertiaModifier.axis * I_axis), as the lead's item 5
root.accel = {x:0, y:GRAVITY*root.gravityModifier, z:0}; root.torque = ZERO; root.frictionSamples = [];
```

Things that are easy to get wrong: friction is a **mean over touching parts, resistance a sum**; the limits use
the averaged normal's **Y component** (side-on object contacts have no friction budget); the clamp is on the
**vector**, not per axis (this is the power slide); the static latch has hysteresis (break > limA = 1.5 limB,
re-latch <= limB) and lives per part across ticks but is cleared the first tick the part has no contact; gravity's
next increment is added to the contact speed before the tangential split; empty aircraft and any other
`RollGripWhenOccupied` wheel are ContactGrip; nothing here depends on mass.
