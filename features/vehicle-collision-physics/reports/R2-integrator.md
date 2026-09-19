# R2-integrator: PhysicsNode integrator, sleeping, node hierarchy, tick order

Track R2, round 2026-09-19. Binary: `bf1942_lnxded.static` unless marked `client`.
Confidence ladder: **verified** = read in objdump (signs / comparison directions worked
out by hand, x87 `fsub/fdiv` reversed forms checked against raw opcodes) **and, for the
whole integrator, reproduced numerically**: the real machine code of
`PhysicsNode::PhysicsNode`, `addAccelerationAtAbsolutePosition`,
`addFrictionAtAbsolutePosition`, `addSpeedAtAbsolutePosition`, `getTangentSpeed`,
`rotateAboutLine` and `updatePhysics` was executed under the Unicorn CPU emulator against
a fake composite object, and a plain Python model of the formulas below tracked it to
float32 rounding (worst abs error 6.5e-6 over 40 random ticks; all clamp / sleep edge
cases identical). Harness: `SP/r2/r2_emu.py`, `SP/r2/r2_node_test.py`,
`SP/r2/r2_node_test2.py` (run with `uv run --with unicorn python3 ...`).
**read** = decompile / disassembly read only. **inferred** = not read.

---------------------------------------------------------------------------------------

## 1. Findings

### F1. PhysicsNode layout and constructor defaults  (verified, ctor `0x08252b70`)

| off | field | ctor default | note |
|---|---|---|---|
| +0x00 | vptr `0x0872df08` | | symbol `0x0872df00` + 8 |
| +0x04 | list node in PhysicsNodeManager | - | written by `addPhysicsNode` `0x082556eb` |
| +0x08 | refcount | 1 | |
| +0x0c | composite object | 0 | **the node stores no transform of its own** (F2) |
| +0x10 | positionalSpeed v (m/s, world) | 0 | |
| +0x1c | rotationalSpeed w (rad/s, **world axes**) | 0 | |
| +0x28 | positional acceleration accumulator (SUM) | 0 | |
| +0x34 | rotational acceleration accumulator (SUM of r x a) | 0 | |
| +0x40 | positional friction accumulator (**running MEAN**) | 0 | |
| +0x4c | rotational friction accumulator (**running MEAN**) | 0 | |
| +0x58 | dragOffset | 0 | read by nothing |
| +0x64 | friction sample count n (a float) | 0 | unknown to the briefing table |
| +0x68 | drag | 0.1 | template default overrides it with 0.0 (F9) |
| +0x6c | mass | 1.0 | |
| +0x70 | centreOfMassOffset | 0 | world-axis vector, never rotated (F4) |
| +0x7c | inertiaModifier x,y,z | 1,1,1 | |
| +0x88 | gravityModifier | 1.0 | |
| +0x8c | underWater | 0 | |
| +0x90 | hasSeparatePhysicsUpdate (byte) | 0 | |
| +0x91 | "fixed to parent" byte | **1** | only other writer: `PhysicsSpring` ctor `0x0824dd73` -> 0 |
| +0x94 | sleepiness (int) | 100 | ctor tail-jumps to `setIsAwake` |

Size 0x98 (`setPhysicsNodeComponent` allocates 0x98). `reset()` `0x08252d10` zeroes
+0x10..+0x54 and +0x64 only.

### F2. The node is a view onto the composite object  (verified, `0x082548c0`-`0x08254b30`)

```
getAbsoluteTransformation()  -> obj->vtbl[+0x40]()            0x08254950
setAbsoluteTransformation(m) -> if !checkMat4ForNAN(m): obj->vtbl[+0x44](m)   0x08254910
getAbsolutePosition()        -> obj->vtbl[+0x38]()            0x08254990
setAbsolutePosition(p)       -> if finite(p.xyz): obj->vtbl[+0x3c](p)         0x082549b0
getParent()   -> obj->parent(+0x50) ? parent->physicsNode(+0x60) : 0          0x082548f0
setParent()   -> no-op                                        0x082548c0
getRootNode() -> getRootParent(obj)->physicsNode(+0x60)       0x082548d0
getRootParent(obj) 0x0818d4b0: obj if obj.flags & 0x2000000, else cached obj+0xd4,
                               else recurse on obj+0x50 and cache.
```

`getPositionalSpeed` `0x08254a90` / `getRotationalSpeed` `0x08254ae0` are not trivial
because **a node whose object has a parent (obj+0x50 != 0) returns a static zero vector
(`0x087dbf10`)**; only a parentless node returns `&this->v` / `&this->w`. Child nodes never
report a speed of their own.

### F3. `getTangentSpeed(p)` `0x08254b90`  (verified: objdump + emulation)

```
root = getRootNode()
r    = p - root.getAbsolutePosition()          // `flds (rootPos); fsubrs (p)` = p - rootPos
out  = root.getPositionalSpeed() + cross(root.getRotationalSpeed(), r)
cross(w,r) = (w.y*r.z - w.z*r.y, w.z*r.x - w.x*r.z, w.x*r.y - w.y*r.x)
```

`r` is measured from the **root object's origin, not from the centre of mass** and not
from the node it was called on. Opcodes checked: `0x8254c11 de ea` (st2 = st2 - st0),
`0x8254c25 de e3` (st3 = st0 - st3), `0x8254c33 de e9` (st1 = st1 - st0).
`StaticPhysicsNode::getTangentSpeed` `0x0825e6c0` returns zero.

### F4. The accumulators  (verified: objdump + emulation)

All four `add...At...` functions start with the same gate (e.g. `0x08255128`):
`if (getParent() != 0 && this[+0x91] != 0) -> forward`, else act on `this`.

**addAccelerationAtAbsolutePosition(p, a)** `0x08255110`
```
if parent && fixed: parent->addAccelerationAtAbsolutePosition(p, a)   // vtbl +0x68, recursive
else:  acc  += a                                       // +0x28, plain sum
       r     = (p - nodePos) - comOffset               // 0x825517c fsubr, 0x82551a9 fsub [+0x70]
       racc += cross(r, a)                             // +0x34, plain sum
```
`comOffset` is subtracted **in world axes, unrotated**. No `.con` word sets it (no
"centerOfMass" string in the binary; template default 0); the only runtime writers are
`BFSoldier::handlePlayerInput` `0x082754c0` and `BFSoldier::addKitPart` `0x08278ffe`. For
every vehicle it is (0,0,0), so the arm is simply `p - objectOrigin`.

**addAccelerationAtRelativePosition(rel, a)** `0x08255230` (read): same with
`r = rel - comOffset`. Quirk: when forwarding it hands the parent the **same** `rel`
without re-basing it.

**addFrictionAtAbsolutePosition(p, f)** `0x08254e50`
```
if parent && fixed: Debug "addFriction only works on rootParents."   // NOT forwarded, dropped
else:  n    = this[+0x64]
       fr   = (fr  * n + f) / (n + 1)                  // running mean, 0x8254f04..0f
       r    = p - nodePos                              // NO comOffset here
       rfr  = (rfr * n + cross(r, f)) / (n + 1)
       this[+0x64] = n + 1
```
**addSpeedAtAbsolutePosition(p, dv)** `0x08254c70`: `v += dv; w += cross(p - nodePos, dv)`
- no inertia, no comOffset, dimensionally crude. `addSpeedAtRelativePosition`
`0x08254d90` (read): `v += dv; w += cross(rel, dv)`. `addPositionalSpeed` /
`addRotationalSpeed` `0x08254b30/60`: plain `+=` on `this`, **no forwarding**.

So friction differs from acceleration in four ways: mean instead of sum; arm from the
origin instead of origin+com; never forwarded from a child; and it is *discarded* rather
than clamped when too large (F5/F6).

### F5. Linear integration - `updatePositionalPhysics(dt)` `0x08253570`  (verified)

```
if !finite(acc) acc = 0;   if !finite(fr) fr = 0
if |acc|^2 > 1e6:    acc *= 1000 / |acc|        // 0x86d1388 = 1e6, 0x86b1ca8 = 1000; clamp, keep direction
if |fr|^2  > 62500:  fr = 0                     // 0x86d138c; |fr| > 250 m/s^2 -> dropped entirely
(NaN guards again)
v   += dt * acc
v   += dt * fr
pos  = getAbsolutePosition() + dt * v           // semi-implicit: uses the NEW v
setAbsolutePosition(pos)
acc = 0; fr = 0
```
Comparisons: `0x82536a9 fucom` with st0 = |acc|^2, st1 = 1e6, `jne` skips unless st0 > st1;
`0x82536fd fucompp` same shape for friction. One step per tick, **no sub-stepping**
(the 4 sub-steps in physics.md section 3 belong to `PointPhysicsNode` only).

### F6. Angular integration - `updateRotationalPhysics(dt)` `0x082539e0`  (verified)

```
NaN guards on rfr, racc
if |racc|^2 > 1e6: racc *= 1000 / |racc|                    // 0x8253b08
geom = obj->queryComponent(0x492fe0fe, 0x492fe0fe) ?: findLodGeometry(obj, 0x94a7, 0x94b1, 0xc4c2)

if geom && !(obj.flags & 0x4000000):                        // 0x8253c35..c40  - the live branch
    (Iz, Iy, Ix) = getGeometryInertia(geom)                 // F7
    M     = getAbsoluteTransformation()                     // rows 0,1,2 = body X,Y,Z in world
    Tpre  = racc + rfr
    if |rfr|^2 > 40000: rfr = 0                             // 0x86d1394, 0x8253f2d
    Tpost = racc + rfr
    dw  = proj(Tpre , M.row2) * dt / (inertiaMod.z * Iz)    // 0x8253f50..  (+0x84, out1)
    dw += proj(Tpost, M.row1) * dt / (inertiaMod.y * Iy)    // 0x825403e..  (+0x80, out2)
    dw += proj(Tpost, M.row0) * dt / (inertiaMod.x * Ix)    // 0x8254126..  (+0x7c, out3)
    if !finite(dw) dw = 0
else:                                                       // fallback, 0x8253c46
    dw = (racc + rfr) * (dt / 0.0314)                       // 0x86d1398 = 0.0314
    if |dw|^2 > 1e6: dw = 0                                 // 0x8253cd7
    if !finite(dw) dw = 0

w += dw
if |w|^2 > 1.0000001e-6:                                    // 0x86d139c
    rotateAboutLine(M, w/|w|, dt * |w| * 57.29578)          // DEGREES; 0x86c0318
    setAbsoluteTransformation(M)
racc = 0; rfr = 0; this[+0x64] = 0

proj(T, e) = e * (dot(T, e) / dot(e, e)),  or 0 when dot(e,e) == 0    // `de f4` = st4 = st0/st4
```
- `k = dt / (inertiaMod * I)`: `0x8253fba de f2` is Intel `fdivrp st(2),st` = st0/st2.
- Units: `racc` is r x a (m^2/s^2); `I` is a per-unit-mass box inertia (m^2); the quotient
  is rad/s^2. **Mass never enters rotation**; there is no gyroscopic term; w lives in world
  axes and is not re-expressed when the body turns.
- Quirk (verified by emulation, test C): the Z-axis projection uses `Tpre`, computed
  *before* the 40000 test, so an over-limit rotational friction still acts about body Z
  and is dropped only for X and Y.
- **Fallback branch**: taken when the object has no geometry at all, or flag `0x4000000`
  is set (never, ledger PHY-4). `dt/0.0314` = 1.0616 at 30 Hz: the accumulated torque is
  treated as a per-reference-step speed change with no inertia. Emulated (test D).
- `rotateAboutLine` `0x08061e10` -> `setRotateAboutLine` `0x080621b0`
  (`makeOrthonormalBasis`, transpose, `rotateZDeg`, mult): only the 3x3 rows change,
  **row 3 (translation) is untouched, so the body turns about the object origin**, not
  about origin+com. Sense, from emulation: `row' = row + theta * cross(n, row)` to first
  order, i.e. full Rodrigues with the same cross-product convention as F3, so
  `v_point = w x r` holds.

### F7. `getGeometryInertia(geom, out1, out2, out3)` `0x08253930`  (verified)

```
(min, max) = geom->vtbl[+0x1c]()      // {min.xyz at +0, max.xyz at +0xc}
D = max - min
*out3 = Ix = (DY^2 + DZ^2) / 3        // 0x86d1390 = 0.3333333
*out2 = Iy = (DX^2 + DZ^2) / 3
*out1 = Iz = (DX^2 + DY^2) / 3
```
Briefing item 5 is right about the formula; note the **out-parameter order is z, y, x**.
The box is the bounding box of the object's *own* mesh (or, via `findLodGeometry`
`0x0818d860`, of the highest LOD child's mesh) - not of the assembled vehicle. `1/3` with
full extents is 4x a real solid box (1/12).

### F8. `PhysicsNode::updatePhysics(dt)` `0x082543d0` - the whole per-tick update  (verified)

```
root = getRootNode()
if sleepiness >= 0 and this == root and templateClassId != 0x9493 (soldier):   // 0x82543f2, 0x8254787
    if      |acc|^2 >= 2.5 : setIsAwake()        // 0x86d13a0; test on the accumulator BEFORE drag
    else if |v|^2   >= 0.25: setIsAwake()        // 0x86c08ac
    else if |w|^2   >= 0.25: setIsAwake()
    else if sleepiness > 0 : sleepiness -= 1
(debug counters frames / sleepingParents / posAcc / posSpeed / rotSpeed at 0x0872ded0..ee8)

if isSleeping() or this != root:                  // 0x8254406..15
    if root: this.setSleepiness(root.getSleepiness())     // vtbl +0xdc then +0xd8
    v = w = acc = racc = fr = rfr = 0; this[+0x64] = 0    // and return: NO gravity seeded
else:
    if drag > 0: (mass < 1e-5 -> Debug) box drag, or sphere drag if flag 0x4000000   // physics.md s3
    updatePositionalPhysics(dt)                   // F5
    updateRotationalPhysics(dt)                   // F6
    acc.y += basicPhysicsSystem.getGravity() * gravityModifier     // 0x82544e9: seeds NEXT tick
```
Comparison directions: `0x82547b3 fucompp` has st0 = 2.5, st1 = |acc|^2 and `jne` fires
unless 2.5 > |acc|^2, hence `>=`. Same for the two 0.25 tests.

Consequences:
- Gravity used in tick N was written at the end of tick N-1. A new or just-woken node
  gets **no gravity in its first integrated tick**.
- The `|acc|^2 >= 2.5` test sees gravity + everything children and `solveImpulse` added, so
  a free-falling body (|g| = 14.73) can never fall asleep; a body can only sleep while
  something cancels gravity to within 1.58 m/s^2 (springs, contact impulses).
- **Only a root node integrates.** Every non-root `PhysicsNode` is wiped each time its
  `updatePhysics` runs; whatever was accumulated on it is lost.

### F9. Which nodes integrate, which forward  (verified)

- `SimpleObjectTemplate::setPhysicsNodeComponent` `0x081dd490` (called from the
  `SimpleObject` ctor at `0x081da181`): template byte +0x70 bit0 clear ->
  `StaticPhysicsNode` (0x10 bytes; `isSleeping` = false, `getIsMobile` = false, all adders
  no-ops, not registered). Bit3 set -> `PointPhysicsNode` (0x50). Otherwise `PhysicsNode`
  (0x98) and: `obj->setComponent(0xc422, node)`, `obj->updateFlags(8, 0)`,
  `setDrag(tmpl+0x44)`, `setDragOffset(tmpl+0x48)`, `setMass(tmpl+0x54)`,
  `setCenterOfMassOffset(tmpl+0x58)`, `setInertiaModifier(tmpl+0x64)`,
  `physicsNodeManager->addPhysicsNode(node)`. **gravityModifier, +0x90, +0x91 and
  sleepiness are not copied.** The point branch copies the same minus the COM offset.
- Template ctor defaults (`0x081dbc70`): drag **0.0**, dragOffset 0, mass **1.0**,
  COM 0, inertiaModifier (1,1,1), +0x70 = (old & 0x90) | 0x10 so hasMobilePhysics and
  hasPointPhysics start clear. Vanilla `.con` census: `hasMobilePhysics` 514,
  `gravityModifier` 354 (projectiles/particles), `drag` 172, `mass` 69, `inertiaModifier`
  13 (41 in DC, 126 in FH), `dragOffset` 4, centre-of-mass 0 in every mod checked.
- Engine / Spring / Wing / FloatingBundle overrides (`0x0823fc20`, `0x082502f0`,
  `0x08251af0`, `0x08241090`) build subclass nodes (0xc0 / 0xe0 / 0xe4 / 0xb4 bytes),
  copy **none** of mass/drag/inertia/COM (base ctor defaults stay), and register them.
  Only the Spring clears +0x91.
- Their `updatePhysics` overrides never call the base and **talk to the root directly**:
  `PhysicsEngine` `0x0824cbb0` -> `root->addAccelerationAtAbsolutePosition`;
  `PhysicsSpring` `0x0824ddd0` -> `root->addAccelerationAtRelativePosition`;
  `PhysicsFloatingBundle` `0x0824d640` -> `root->addAcceleration...`; `PhysicsWing`
  `0x0824ed10` -> `getTopFixParent()->addAccelerationAtAbsolutePosition`. The +0x91
  forwarding in F4 is only a safety net for callers holding a child node.
- `getTopFixParent` `0x08252d90` walks `getParent()` while **the original node's** +0x91 is
  set (it re-tests `%esi`, never the node it has climbed to).

### F10. Sleeping  (verified unless marked)

- `isSleeping()` `0x0824d480`: `sleepiness <= 0` (`setle`). `setIsSleeping()` `0x0824d4a0`:
  sleepiness = 0. `setIsAwake()` `0x08255330`: sleepiness = (byte)
  `PhysicsNode::mFramesBeforeSafeToSleep` = **100** (`0x0872deec`, .data, one reader, no
  writer) = 3.33 s. `setSleepiness(int)` `0x0824d4c0`, `getSleepiness()` `0x0824d4e0`.
  Negative = "never wake": F8 skips the wake tests, `addFriction` and `PhysicsEngine`
  refuse to wake it.
- Goes to sleep: by the F8 countdown (100 consecutive quiet root ticks - a freshly
  spawned vehicle is born awake at 100, settles on its springs, and sleeps about 3.3 s
  after it stops moving); by `ObjectSpawner::handleFrameUpdate` `0x08313e0d` on the tick a
  *held* object (spawner byte +0x164, the carrier-deck case) is released:
  `node->setSleepiness(0)` + `setPositionalSpeed(carrier root's getTangentSpeed(objPos))`
  (read; while held and the object's engine input is < 0.1 it calls `node->reset()` and
  the same `setPositionalSpeed` every frame); and by `AIObjectPhysical::disablePhysics`
  `0x085d63f3` (`setSleepiness(-1)`). `ObjectSpawner::spawnObject` touches no sleep slot.
- Wakes (all set 100):
  1. F8 tests on the root: |acc|^2 >= 2.5, |v|^2 >= 0.25, |w|^2 >= 0.25.
  2. `ResponsePhysics::addFriction` `0x0825bd1b..0x0825bdd1`: after posting friction, if
     `|avgContactSpeed (+0x74)|^2 > 0.1` (`0x86b1ca0`) and `rootNode.getSleepiness() >= 0`
     -> `rootNode.setIsAwake()`; it then clears the response's contact accumulators.
  3. `PhysicsEngine::updatePhysics` `0x0824cbc8`: |input (+0xa0)| >= 0.05 and root
     sleepiness >= 0 -> `root.setIsAwake()`; otherwise it copies the root's sleepiness.
  4. `PhysicsFloatingBundle::updatePhysics` `0x0824da3a/56`: non-zero inputs wake the parent.
  5. `GameServer::handleExplosionOnObject` `0x08156aa4`: unconditional `setIsAwake()` then
     `addAccelerationAtAbsolutePosition` `0x08156b92`.
  6. `PlayerControlObject::enter` `0x083172b9`, `FireArms::Fire` `0x0828a44e`,
     `AIObjectPhysical::enablePhysics` `0x085d6452`, bot code, the client's
     `SimpleObjectNetworkable::setNetUpdate/predict`.
- A sleeping root: state and accumulators zeroed every tick, no gravity, no drag.
  `PhysicsSpring` and `PhysicsFloatingBundle` copy the root's sleepiness and skip their
  force when asleep; `PhysicsWing` never copies or checks it (read).
- `solveImpulse` itself never wakes anything (no +0xd4 call in `0x08258d30`).

### F11. Order of operations in one 30 Hz tick - `GameServer::simulateFrame(dt)` `0x0815c2a0`  (verified call order; client twin `0x004b6cb0` identical per corpus)

```
0  [game state 1]  updateAI(dt)
1  simulatePlayersUpdate(dt)  0x0815bfa0 -> simulatePlayerUpdate 0x0815bd00 per player:
     pop one buffered PlayerInput, player->vtbl[+0x34](input, dt),
     performHandleUpdate(dt, vehicle, 0, false) 0x08147300 -> handleUpdate (obj vtbl +0x54) on the
     vehicle and its non-PCO / non-soldier descendants; player[+0x14b] = 1
2  objectManager->updateTweakingObjects() (+0x1c); objectManager->updateObjects(dt, 0, 3) (+0x14)
     0x0819be10: handleUpdate on objects whose getUpdateFrequencyType() (+0x64) == 0
3  simulatePlayersPhysics(dt) 0x0815c0f0 -> simulatePlayerPhysics 0x0815c040 (needs +0x14b)
     -> performMobilePhysicsUpdate(dt, vehicle, false) 0x08147470:
        recurse into children first (skip flag&1, skip PCO 0xc4c2 / soldier 0x9493 children),
        then physicsNodeManager->update(dt, 0, thisNode)
4  physicsNodeManager->update(dt, 0, 0) 0x08255740: every registered mobile node except
     obj.flags&1 and hasSeparatePhysicsUpdate; list order = REVERSE creation order
5  rpm->resetCachedCollisionObjects() (+0x1c);  Game::updateWorldCollision(dt) 0x0805da00:
     objectManager->updateObjectsInGrid() (+0x6c); rpm->reset() (+0x18 = ++collisionCheckedCounter);
     rpm->update(dt, 0) 0x0825d0b0
6  rpm->resetCachedCollisionObjects();  simulatePlayersCollisions(dt) 0x0815c140
     -> simulatePlayerCollisions 0x0815c0a0 (needs +0x14b, clears it): rpm->update(dt, vehicle),
        then performMobileCollisionUpdate 0x08147580 on each non-PCO / non-soldier child
7  death cameras, updateGameLogic(dt), updatePortals(dt), ++tick counter (+0x1b4)
```
(a) **Forces from engines, wings, springs, floats** are accumulated inside those nodes'
`updatePhysics`, i.e. in step 3 or 4, in the same pass as and **before** the root
integrates: `addPhysicsNode` `0x08255680` is a `push_front`, the root's node is created in
the `SimpleObject` ctor before `BundleTemplate::addBundleChilds` (`Bundle` ctor
`0x081a730f` then `0x081a7327`), so all descendants sit ahead of their root in the list;
`performMobilePhysicsUpdate` recurses children-first explicitly. `handleUpdate` (steps
1-2) only feeds controls; no node adder is called from any `handleUpdate` except the
soldier's.
(b) **Integration** is steps 3 and 4. `BasicPhysicsSystem::update` `0x08251ef0`, called at
the top of every `PhysicsNodeManager::update`, is an empty function.
(c) **Contacts** are steps 5 and 6, after every integration. Within `rpm->update(dt, 0)`:
pass 1 detect (`checkObjectVsObjects` + `checkVsTerrain` +0x24), pass 2 resolve
(`solveImpulse` +0x1c then `addFriction(node, 0.45, 0.9, 0.45, 2.0, 0, 0)` +0x20).
Every pass first requires `!(obj.flags & 1) && (obj.flags & 0x200)`. Node-state gates, all
read in objdump: flat list `+0x14` (PointResponsePhysics, getClassID 0xc42e, `addObject`
`0x0825cfd0`) pass 1 tests only `hasSeparate` (`0x825d1cf`), pass 2 tests none; root list `+0xc`
(ResponsePhysics 0xc42d, walked with `getNextToCheck` +0x40) pass 1 tests
`!hasSeparate && !isSleeping` (`0x825d379`, `0x825d38c`), **pass 2 tests only
`!hasSeparate` (`0x825d581`) - a sleeping object is still resolved.**

**What `hasSeparatePhysicsUpdate` (+0x90, vtbl +0xbc) changes.** `disablePhysics(obj,
recurse)` `0x08147730` - called from `GameServer::enterVehicle` `0x0814e91d`,
`exitVehicle`, `BFSoldier::addItem`, `Projectile::handleCollision` - sets it to 1 and the
object's update type to 10 (`obj->vtbl[+0x68](10)`), recursing into children that do not
answer IID 0xc4c5. `reenablePhysics` `0x08147680` undoes both. Effect: the object leaves
steps 2, 4 and 5 and is driven once per *player input* in steps 1, 3 and 6 instead. The
single-object modes: `PhysicsNodeManager::update(dt, 0, node)` just calls
`node->updatePhysics(dt)` unless obj.flags&1; `rpm->update(dt, obj)` stamps the response
with `collisionCheckedCounter - 1` (+0x28), detects only if the node is awake
(`0x825d101`), then always `solveImpulse` + `addFriction`. If the server processed no
input for that player this tick, `+0x14b` stays 0 and the vehicle is neither integrated
nor collided that tick (read).

**Latency of a collision impulse.** `solveImpulse` moves the position immediately (tick N,
step 5 or 6) and posts `speedAdjust * 30 * (1+e)/2` into `acc`. That accumulator is
consumed by the next `updatePhysics`, **tick N+1** (step 3 or 4): `dv = acc * dt` =
`speedAdjust * (1+e)/2`, subject to the shared |acc| <= 1000 clamp (33.3 m/s per tick,
applied to the *sum* with gravity, thrust and springs). Friction posted by `addFriction`
follows the same path through the mean accumulators.

**Jeep rams a sleeping parked plane.** Tick N step 6: the jeep (hasSeparate) detects,
`impulseOn` loads both responses, only the jeep is resolved. Tick N+1 step 4: plane still
asleep (nothing in `acc` yet). Tick N+1 step 5 pass 2: the plane, not hasSeparate, gets
`solveImpulse` (position corrected, impulse into `acc`) and `addFriction`, whose
contact-speed^2 > 0.1 test calls `setIsAwake()`. Tick N+2 step 4: springs see sleepiness
100 and push again, the root passes `|acc|^2 >= 2.5`, integrates the impulse, and seeds
gravity for N+3. Two ticks from touch to motion; one if the plane was already awake and
detected the jeep itself in step 5 (pair de-duplication is the other track's).

### F12. Client agrees  (verified, client `0x00540920`)

Same control flow, same vtable offsets (+0xcc, +0xd4, +0xd8, +0xdc), thresholds 2.5
(`0x008f7364`) and 0.25 (`0x008d5c04`); the zero branch at `0x00540c92` is
`root->vtbl[+0xdc]()` -> `this->vtbl[+0xd8](value)` followed by stores of zero to
+0x10..+0x54 and +0x64.

---------------------------------------------------------------------------------------

## 2. Symbol table (lnxded)

| address | name | note |
|---|---|---|
| 0x08252b70 / 0x08252c40 | PhysicsNode::PhysicsNode | defaults F1 |
| 0x08252d10 | PhysicsNode::reset | zero speeds + accumulators + n |
| 0x08252d90 | PhysicsNode::getTopFixParent | climbs while *this* +0x91; only PhysicsWing calls it |
| 0x082543d0 | PhysicsNode::updatePhysics | F8 |
| 0x08253570 | PhysicsNode::updatePositionalPhysics | F5 |
| 0x082539e0 | PhysicsNode::updateRotationalPhysics | F6 |
| 0x08253930 | getGeometryInertia | outs are Iz, Iy, Ix |
| 0x0818d860 | findLodGeometry | highest-LOD child mesh, needs obj flag 0x1000000 |
| 0x0818d4b0 | getRootParent | flag 0x2000000 = is root; cache at obj+0xd4 |
| 0x082548d0 / 0x082548f0 / 0x082548c0 | getRootNode / getParent / setParent (no-op) | F2 |
| 0x08254a90 / 0x08254ae0 | getPositionalSpeed / getRotationalSpeed | static zero `0x087dbf10` for non-root |
| 0x08254b30 / 0x08254b60 | addPositionalSpeed / addRotationalSpeed | local +=, no forwarding |
| 0x08254b90 | getTangentSpeed | F3 |
| 0x08254c70 / 0x08254d90 | addSpeedAtAbsolute / RelativePosition | F4 |
| 0x08255110 / 0x08255230 | addAccelerationAtAbsolute / RelativePosition | F4 |
| 0x08254e50 | addFrictionAtAbsolutePosition | running mean; string `0x086d13e0` |
| 0x0824d480 / 0x0824d4a0 / 0x0824d4c0 / 0x0824d4e0 / 0x08255330 | isSleeping / setIsSleeping / setSleepiness / getSleepiness / setIsAwake | F10 |
| 0x0872deec | PhysicsNode::mFramesBeforeSafeToSleep | byte 100 (Point twin `0x0872e064` also 100) |
| 0x0872ded0..0x0872dee8 | frames, sleepingParents, rotSpeed, posSpeed, posAcc | debug float counters |
| 0x0824d3f0 / 0x0824d410 | set / getHasSeparatePhysicsUpdate | byte +0x90 |
| 0x0872e020 | vtable PhysicsNodeManager | +0xc add, +0x10 remove, +0x14 update |
| 0x08255680 / 0x08255740 | PhysicsNodeManager::addPhysicsNode / update | push_front if getIsMobile / F11 |
| 0x0871dc18 / 0x0871dc30 | physicsNodeManager / basicPhysicsSystem globals | |
| 0x08251ef0 | BasicPhysicsSystem::update | empty |
| 0x08061e10 / 0x080621b0 | rotateAboutLine / setRotateAboutLine | degrees, 3x3 only |
| 0x081dd490 | SimpleObjectTemplate::setPhysicsNodeComponent | F9; template vtbl +0x64 |
| 0x081dbc70 | SimpleObjectTemplate ctor | template defaults F9 |
| 0x0823fc20 / 0x082502f0 / 0x08251af0 / 0x08241090 | Engine / Spring / Wing / FloatingBundle setPhysicsNodeComponent | subclass nodes, no field copy |
| 0x0815c2a0 | GameServer::simulateFrame | F11 |
| 0x0815bfa0 / 0x0815bd00 | simulatePlayersUpdate / simulatePlayerUpdate | sets player+0x14b |
| 0x0815c0f0 / 0x0815c040 | simulatePlayersPhysics / simulatePlayerPhysics | |
| 0x0815c140 / 0x0815c0a0 | simulatePlayersCollisions / simulatePlayerCollisions | clears +0x14b |
| 0x08147300 / 0x08147470 / 0x08147580 | performHandleUpdate / performMobilePhysicsUpdate / performMobileCollisionUpdate | tree walks |
| 0x08147730 / 0x08147680 | disablePhysics / reenablePhysics | hasSeparate + update type 10 / 0 |
| 0x0805d9b0 / 0x0805da00 | Game::updateWorld / updateWorldCollision | |
| 0x0819be10 | ObjectManager::updateObjects | handleUpdate where type matches |
| 0x0825d0b0 / 0x0825e1a0 / 0x0825e190 | ResponsePhysicsManager::update / reset / resetCachedCollisionObjects | reset = ++counter; resetCached = byte +0x1c = 1 |
| 0x083138c0 | ObjectSpawner::handleFrameUpdate | held object: reset() each frame; on release setSleepiness(0) + carrier tangent speed |
| 0x085d63b0 | AIObjectPhysical::disablePhysics | setSleepiness(-1) |
| client 0x00540920 | PhysicsNode::updatePhysics | F12 |

---------------------------------------------------------------------------------------

## 3. Corrections

1. **physics.md section 3** ("A non-root node for which a virtual predicate (vtable
   +0xcc) holds hands its force and torque to the root and skips drag and gravity") is
   wrong. +0xcc is `isSleeping`; the condition is `isSleeping() || this != root`; the two
   virtual calls are `root->getSleepiness()` / `this->setSleepiness()`; then the node's own
   speeds and accumulators are zeroed. Nothing is handed anywhere. Same in the client (F12).
   Forwarding lives in the `add...At...` functions (byte +0x91), and in practice the
   subclass nodes address the root themselves.
2. **Briefing section 3 field table**: add `+0x10` positional speed, `+0x40` positional
   friction, `+0x64` friction sample count; `+0x91` forwards `addSpeedAt*` too, is 1 by
   default and 0 only on PhysicsSpring; friction is not forwarded at all.
3. **Briefing section 4.1**: the sleeping skip applies to the root list only, and only in
   the detect pass; the resolve pass has no sleeping test, which is what lets an awake
   attacker wake a parked victim. Flat-list pass 2 is `solveImpulse` alone, ungated.
4. **Briefing section 4.5**: the torque arm is right; add that friction's arm omits the
   COM offset, that the COM offset is world-axis and zero for every vehicle, and that the
   inertia outs come back in z, y, x order.
5. physics.md section 3 "object flag 0x8" is set for every mobile node, not only for
   `hasPointPhysics`.
6. physics.md's 4-sub-step integrator is `PointPhysicsNode` only; `PhysicsNode` takes one
   semi-implicit Euler step per tick.

---------------------------------------------------------------------------------------

## 4. Open

- Callers of `addSpeedAt*` (vtbl +0x60/+0x64) were not isolated: the offsets collide with
  other interfaces. Next lead: the soldier cylinder push in `checkObjectVsObject`.
- A body resting through contact alone: with `acc = speedAdjust*30*(1+e)/2`, net
  `|acc|^2 < 2.5` needs e close to 1. Whether crates and wrecks ever sleep depends on the
  material elasticity (other track).
- `PhysicsWing` never syncing sleepiness means a wing part's response keeps detecting
  while the plane sleeps (read, not exercised).
- `ObjectSpawner::handleFrameUpdate` hold / release logic was read in the decompile only
  (`SP/r2-decomp/083138c0.c`, asm around `0x08313d9d..0x08313e1f`); the name of spawner byte
  +0x164 is not established.
- `Game::updateWorld` `0x0805d9b0` has no direct caller in lnxded.
- The `player+0x14b` input gate was read on the server only.

---------------------------------------------------------------------------------------

## 5. Notes for a JavaScript re-implementation at a fixed 30 Hz tick

```js
// per ROOT body; children own no state. Rows of M (row-vector convention) are body X,Y,Z in world.
const DT = 1/30, G = -14.73;
function addAccel(b, p, a)   { b.acc.add(a);  b.racc.add(cross(sub(sub(p, b.pos), b.com), a)); }   // com = 0 for vehicles
function addFriction(b, p, f){ const k = 1/(b.n+1);
  b.fr  = scale(add(scale(b.fr,  b.n), f), k);
  b.rfr = scale(add(scale(b.rfr, b.n), cross(sub(p, b.pos), f)), k);  b.n++; }
function tangentSpeed(b, p)  { return add(b.v, cross(b.w, sub(p, b.pos))); }                       // from the ORIGIN

function updatePhysics(b) {
  if (b.sleep >= 0 && !b.isSoldier) {
    if (len2(b.acc) >= 2.5 || len2(b.v) >= 0.25 || len2(b.w) >= 0.25) b.sleep = 100;
    else if (b.sleep > 0) b.sleep--;
  }
  if (b.sleep <= 0) { zero(b.v,b.w,b.acc,b.racc,b.fr,b.rfr); b.n = 0; return; }   // no gravity seed
  applyBoxDrag(b);                                          // physics.md s3, only if drag > 0
  if (len2(b.acc) > 1e6) b.acc = scale(b.acc, 1000/len(b.acc));
  if (len2(b.fr)  > 62500) b.fr = [0,0,0];
  b.v = add(b.v, scale(b.acc, DT));  b.v = add(b.v, scale(b.fr, DT));
  b.pos = add(b.pos, scale(b.v, DT));
  if (len2(b.racc) > 1e6) b.racc = scale(b.racc, 1000/len(b.racc));
  const Tpre = add(b.racc, b.rfr);  if (len2(b.rfr) > 40000) b.rfr = [0,0,0];
  const Tpost = add(b.racc, b.rfr);
  const I = [(DY*DY+DZ*DZ)/3, (DX*DX+DZ*DZ)/3, (DX*DX+DY*DY)/3];          // own-mesh bbox
  let dw = [0,0,0];
  for (const [i,T] of [[2,Tpre],[1,Tpost],[0,Tpost]])
    dw = add(dw, scale(proj(T, b.M[i]), DT / (b.inertiaMod[i] * I[i])));
  b.w = add(b.w, dw);
  if (len2(b.w) > 1e-6) rotateRowsAbout(b.M, normalize(b.w), DT*len(b.w));  // Rodrigues, origin fixed
  b.acc = [0, G*b.gravityMod, 0];  b.racc = [0,0,0];  b.fr = [0,0,0];  b.n = 0;
}
```
Tick: (1) controls; (2) for each vehicle: engines / wings / floats / springs call
`addAccel` on the root, springs and floats only while `root.sleep > 0`, an engine with
|throttle| >= 0.05 sets `root.sleep = 100`; (3) `updatePhysics(root)`; (4) when every body
has integrated: detect contacts for awake bodies, then for every body with pending
contacts - asleep or not - apply the positional correction now and `addAccel` /
`addFriction` for the next tick, and set `sleep = 100` when contact speed^2 > 0.1.
Impulses therefore land one tick late, by design. Spawn vehicles awake (`sleep = 100`,
`acc = 0`) and let the countdown park them; a body's first integrated tick after
creation or after waking has no gravity in it. Keep w in world axes, keep the
rotation pivot at the object origin, and do not add mass or a gyroscopic term to the
angular update: the engine has neither.
