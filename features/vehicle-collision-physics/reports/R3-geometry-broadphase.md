# R3 - geometry and broadphase: how Refractor 1 finds contacts between two objects

Track R3, round 2026-09-19. All addresses are `bf1942_lnxded.static` unless marked. Confidence:
**verified** = read in the decompile and the sign / comparison / operand order re-derived from
`objdump` raw opcode bytes; **read** = decompile only (integer logic, pointer plumbing);
**inferred** = deduced, not read.

Tool left behind for other tracks: `SP/r3-x87.py START STOP [init-stack] [-c=calladdr,...]` - a
symbolic x87 tracer that decodes from the RAW opcode bytes (so the AT&T `fsubp/fsubrp/fdivp/fdivrp`
mnemonic swap cannot bite) and prints every store and every compare as an expression. All
"verified" float claims below came out of it plus a hand reading of the `fnstsw / test $0x45`
flags. My extra decompiles are in `SP/r3-decomp/`.

---------------------------------------------------------------------------------------------

## 1. Findings

### F1. Where the contact pass sits in the server frame  (read)

`GameServer::simulateFrame(dt)` `0x0815c2a0`, in order:
`objectManager.updateObjects` -> `simulatePlayersPhysics` -> `physicsNodeManager.update` (integration)
-> `responsePhysicsManager.resetCachedCollisionObjects()` (vtbl +0x1c) ->
`Game::updateWorldCollision(dt)` `0x0805da00` = { `objectManager.updateObjectsInGrid()` (+0x6c);
`responsePhysicsManager.reset()` (+0x18, which is just `++collisionCheckedCounter`, `0x0825e1a0`);
`responsePhysicsManager.update(dt, NULL)` (+0x14) } -> `resetCachedCollisionObjects()` again ->
`simulatePlayersCollisions(dt)` which, per player whose byte `BFPlayer+0x14b` is set, calls
`responsePhysicsManager.update(dt, vehicle)` and then `performMobileCollisionUpdate(dt, child, 0)`
`0x08147580` for every child that is not a PlayerControlObject (0xc4c2) or soldier (0x9493); that
function calls `update(dt, part)` for the part and recurses through first-child (+0x7c) /
next-sibling (`obj+0x54`).

So detection runs AFTER integration, once per 30 Hz tick, on post-move transforms. `dt` = the
tick (1/30 s). `collisionCheckedCounter` (global `0x0872e2d8`, initial value 1) advances once per
tick.

### F2. The manager's two lists, and what is static  (read)

`SimpleObjectTemplate::setResponsePhysicsComponent` `0x081dd1d0` picks the response class from the
template byte `+0x70`: bit 3 -> `PointResponsePhysics` (CID 0xc42e); else bit 0 ->
`ResponsePhysics` (CID 0xc42d); else `StaticResponsePhysics` (CID 0xc42f). The same two bits pick
`PointPhysicsNode` / `PhysicsNode` / `StaticPhysicsNode` in `setPhysicsNodeComponent`
`0x081dd490`, so bit 0 = `hasMobilePhysics`, bit 3 = `hasPointPhysics` (inferred from the class
names). It then calls `setPermanentGrip(template+0x71)`, `addToCollisionGroup(template+0x78)`
and `manager.addObject(obj)`.

`ResponsePhysicsManager::addObject` `0x0825cfd0` / `removeObject` `0x0825d040` look only at
`obj->response(+0x64)->getClassID()` (vtbl +0x64): 0xc42d -> list at manager `+0x0c`
(mesh bodies); 0xc42e -> list at `+0x14` (points = projectiles); **anything else (static) is in
no list**. A static object is therefore never iterated as "A" by the manager; it only ever shows
up as a candidate "B" out of the spatial grid. (`StaticResponsePhysics::checkObjectVsObject`
`0x0825f1a0` is an empty function, `setCollisionChecked` `0x0825f3e0` is empty and
`getCollisionChecked` `0x0825f3f0` returns 0.)

Every child object gets its own response object, but the lists hold ROOT objects only:
`BCompositeObject<>::addChild` `0x08165900` calls `manager.removeObject(child)` (vtbl +0x10 at
0x0816594e) and `removeChild` `0x08165cb0` calls `manager.addObject(child)` (+0xc at 0x08165d53);
`LodObject::addChild/removeChild` do the same. Children are reached only through the root's
"next to check" chain (F4).

### F3. `update(dt, obj)` 0x0825d0b0 - who is "A"  (read)

`obj == NULL` (world pass):
1. point list: for each response `r`, `o = r.getObject()`; needs `(o.flags & 1) == 0` and
   `(o.flags & 0x200) != 0`; `node = o+0x60`; if `!node.getHasSeparatePhysicsUpdate()` (+0xbc):
   `checkObjectVsObjects(dt, o)`, `r.checkVsTerrain(dt)`. No sleeping test for points.
2. mesh list: for each entry whose object has `(flags & 1) == 0` and `flags & 0x200`: walk
   `p = entry; while (p) { ...; p = p.getNextToCheck(); }`. For each `p` whose object again has
   bit0 clear and 0x200 set, with `node = partObject+0x60`: if `!node.getHasSeparatePhysicsUpdate()`
   **and** `!node.isSleeping()` (+0xcc; `PhysicsNode::isSleeping` `0x0824d480` = `sleepCounter(+0x94) < 1`):
   `checkObjectVsObjects(dt, part)` then `p.checkVsTerrain(dt)`.
3. point list: `solveImpulse(node)`.
4. mesh list, same chain walk: if `!hasSeparatePhysicsUpdate`: `solveImpulse(node)`,
   `addFriction(node, 0.45, 0.9, 0.45, 2.0, 0, 0)`.

`obj != NULL` (player-simulated vehicle part): needs bit0 clear, 0x200 set, node non-null. First
`resp.setCollisionChecked(counter - 1)`, then if `!node.isSleeping()`: `checkObjectVsObjects`,
`checkVsTerrain`; then always `solveImpulse` + `addFriction(same constants)`.

Object flags: `0x200` = has collision physics (it is the flag the grid predicate and
`shouldCheckCollision` test); `0x1` = unknown "inactive" bit (such an object also reports
bounding radius 0, `0x08165630`); `0x2000000` = object is registered in the spatial grid
(`updateObjectsInGrid` `0x0819d050` adds/removes on it) (inferred names).

### F4. The "next to check" chain = the collidable parts of one vehicle  (read)

`ResponsePhysics::getNextToCheck` `0x08258600`: on a root (object `+0x50` parent == 0) with the
dirty byte `+0xd1` set it rebuilds a singly linked list through `+0xd4`: clears the global
`tmpResponseList`, sets `LodObject::m_forceHighestLod = 1`, calls
`addToTmpResponseList(firstChild)` `0x08258570` and links root -> list[0] -> list[1] ... -> NULL.
`addToTmpResponseList(o)`: if `o` has a response and `response.shouldCheckCollision()` push it;
then recurse into `o+0x54` (next sibling) and into `o.getFirstChild()` (+0x7c) - a pre-order walk
of the whole child tree.

`shouldCheckCollision` `0x082584e0` = object flag 0x200 set AND object has a geometry (`+0x5c`)
AND `getVertexCollision(1)` non-null with vertex count != 0 AND `getFaceCollision(1)` non-null.
`PointResponsePhysics` returns 1 / chain NULL. `StaticResponsePhysics` has the identical chain
code (`0x0825ee70`, `0x0825ed50`), so static multi-part objects (buildings with child meshes)
expose their parts the same way when they are "B".

`setDirtyNextToCheck` `0x08258450` marks and unlinks the chain; `getSimpleNextToCheck` just returns
`+0xd4`.

### F5. Broadphase: `getCollisionObjects(A, radius, dt)` 0x0825d5c0  (verified)

```
rootNode = getRootParent(A)->physicsNode            // +0x60
d        = rootNode.getPositionalSpeed() * dt        // metres moved this tick
if A.response is PointResponsePhysics (0xc42e):
    objectManager.getObjectsFromGrid(start = A.pos - d, dir = d, objectVector, pred, 0)   // +0x44, line
else:
    centre = A.getAbsolutePosition() - 0.5 * d
    r      = dot(d,d) * 0.25 + 1.0 + radius          // NOTE |d|^2, not |d|   (0x0825d66c..0x0825d6c4)
    objectManager.getObjectsFromGrid(centre, r, objectVector, pred)                          // +0x30, sphere
pred = ObjectFlagPredicator(0x2000200): (obj.flags & 0x2000200) == 0x2000200
```
Constants: 0.25 `0x086c08ac`, 1.0 `0x086ba8d4`, 0.5 `0x086b05e8`. `radius` is A's own
`getBoundingRadius()` for a mesh body and 0 for a point. The sphere query
(`ObjectManager::getObjectsFromGrid` `0x0819dc40`) asks both of the manager's grids (`+0x10`, `+0x8`)
and, because the predicate carries 0x2000000, returns grid-registered ROOT objects only (child
expansion is skipped). Result lands in the global `world::objectVector` `0x0879cfc0`.

Caching (`checkObjectVsObjects` 0x0825d8bf..0x0825d925, read): the query is skipped and the previous
`objectVector` reused when A is a composite child (`A+0x50 != 0`) and the manager byte `+0x1c` is 0.
The query clears that byte; `resetCachedCollisionObjects` `0x0825e190` sets it. So inside one
vehicle the root queries once (with the root's composite radius) and its children reuse the list.

`getBoundingRadius` (`BCompositeObject<>::getBoundingRadius` `0x08165630`, read): 0 if flag bit0;
else cached at `+0xb4`; when dirty (flag 0x80000) = max(own geometry radius (geometry vtbl +0x20),
max over children of |child relative position| + child.getBoundingRadius()).

### F6. The pair loop: `checkObjectVsObjects(dt, A)` 0x0825d820  (verified where marked)

Prologue: `resp = A+0x64`; `groupsA = resp.getCollisionGroups()` (+0x38, field `+0xb8`);
`resp.setCollisionChecked(collisionCheckedCounter)` (+0x28, field `+0xbc`).

**Point A** (class 0xc42e): clear vector, `getCollisionObjects(A, 0, dt)`, then for every candidate
root R != A, for every part B in { R, chain(R) }: skip if `getRootParent(B) == A`; if
`(groupsA & groupsB) == 0` and `(B.flags & 1) == 0` -> `A.resp.checkObjectVsObject(A, B, dt, 1.0)`.
No radius test, no dedup.

**Mesh A**: `rootA = getRootParent(A)`, `rAr = rootA.getBoundingRadius()`, `rA = A.getBoundingRadius()`.
`passiveA = !(rootA.node && rootA.node.getIsMobile() (+0xe0) && !rootA.node.isSleeping())`.
For every candidate root R, for every part B in { R, chain(R) } (B advanced with
`B.resp.getNextToCheck()` -> `getObject()`), in this order, skip the pair if any of:

1. `B == A`;
2. `getRootParent(B) == rootA` (parts of one vehicle never collide with each other);
3. `passiveA` and rootB's node is missing / not mobile / sleeping (at least one side must be a
   mobile, awake body);
4. `B.flags & 1`;
5. `B.resp.getCollisionChecked() == collisionCheckedCounter` (0x0825da94, `je` skip) - B was
   already processed as "A" this tick, so the pair was already handled from the other side.
   This is the only dedup; each unordered pair is visited once, by whichever part runs first;
6. `(groupsA & groupsB) != 0` (0x0825daa8 `test`/`jne` skip) - members of a common group ignore
   each other;
7. NOT (`A == rootA` OR `B == rootB`) (0x0825dab3..0x0825dac1) - child-part vs child-part is never
   tested; at least one side must be a root object;
8. `rA < 0.45 && rB < 0.45` (0x0825db2b..0x0825db52, constant `0x086d1798` = 0.45), `rB = B.getBoundingRadius()`;
9. bounding-sphere test (0x0825db71..0x0825dc50), verified:
   ```
   distSqr = |A.absTransform.pos - B.absTransform.pos|^2           // part positions (+0x30 of the Mat4)
   mA = |rootA.node.getPositionalSpeed()|^2 * dt * 0.25            // 0 without a node
   mB = |rootB.node.getPositionalSpeed()|^2 * dt * 0.25
   skip if distSqr > (rA + mA + rB + mB)^2
   ```
   The margin is speed SQUARED times dt times 0.25 (units m^2/s - dimensionally odd, but that is
   the code): 10 m/s -> 0.83 m, 30 m/s -> 7.5 m per body;
10. both `A.resp.getVertexCollision(0)` and `B.resp.getVertexCollision(0)` exist and both have
    fewer than 4 vertices (0x0825dc92 `cmp $3; jbe`, 0x0825de35 `cmp $3; ja`).

Then the direction is chosen (0x0825dcc8..0x0825de21, verified by hand). `rAr`/`rBr` are the ROOT
bounding radii, `solA`/`solB` = root template class == 0x9493:

```
if B.resp is Static (0xc42f):        A.check(A, B, dt, 1.0)
else if A.resp is Static:            B.check(B, A, dt, 1.0)
else if rBr > rAr:
    if rAr <= 0.25*rBr or solA:      solB ? B.check(B,A,dt,1.0) : A.check(A,B,dt,1.0)
    else (similar size):             solB ? B.check(B,A,dt,1.0)
                                          : { A.check(A,B,dt,0.5); B.check(B,A,dt,0.5) }
else (rBr <= rAr):
    if rBr <= 0.25*rAr or solB:      solA ? A.check(A,B,dt,1.0) : B.check(B,A,dt,1.0)
    else (similar size):             solA ? A.check(A,B,dt,1.0)
                                          : { B.check(B,A,dt,0.5); A.check(A,B,dt,0.5) }
```
`X.check(X, Y, dt, w)` = `X.resp->checkObjectVsObject(X, Y, dt, w)` (vtbl +0x60): **X's collision
vertices against Y's faces**. So:
- the smaller body (root radius ratio > 4) or the soldier is the vertex side, single direction, weight 1.0;
- two non-soldier bodies within a factor 4 of each other are tested in BOTH directions, each with
  weight 0.5 (a jeep against a parked plane is this case);
- a static is always the face side.
This answers the two floats of `checkObjectVsObject`: **param_4 = dt, param_5 = direction
weight (1.0 one-way, 0.5 each when two-way)**; the weight multiplies both impulse shares.

Static "A": only reachable when a static-response child sits in a mobile root's chain; the roles
are then swapped (`B.check(B, A)`), and a static's own `checkObjectVsObject` is empty. A static is
never the vertex side.

Sleeping: a sleeping body is never "A" in the world pass (F3) and is not stamped, so an awake
body that reaches it tests the pair; two sleeping / static bodies are skipped by rule 3.

Player-simulated vehicles (`hasSeparatePhysicsUpdate`) are skipped as "A" in the world pass but are
found as "B" by everything else; in their own later `update(dt, part)` rule 5 then hides every
body already processed in the world pass, leaving only sleeping bodies, statics and other
not-yet-processed player vehicles. Note that path iterates the vehicle's child tree directly
(`performMobileCollisionUpdate`) instead of the `getNextToCheck` chain.

### F7. Collision groups  (read; data measured)

`addToCollisionGroup(mask)` ORs into `+0xb8`, `removeFromCollisionGroup` clears, filter = rule 6 /
the point rule above: any shared bit -> no test. Script constants registered at
0x0829943a..0x082994d3: `c_CGLandscape`=1, `c_CGStaticObjects`=2, `c_CGLadders`=4,
`c_CGProjectiles`=8. Vanilla bf1942 uses `ObjectTemplate.addToCollisionGroup` 47 times, only
`c_CGProjectiles` (29: fences, barbed wire, palms, pipe racks, camo net, ladders) and
`c_CGLadders` (18); XPack1 6, XPack2 16, same two values. No vehicle or vehicle part is in any
group, so groups never filter a vehicle-vehicle pair. (Where projectiles/soldiers get their own
bit is engine-side and unread - open.)

### F8. Which collision mesh: LOD rules and the .sm index  (verified for the binary; data measured)

Binary:
- `BStandardMeshTemplate<>::loadCollision` `0x083a6290`: reads `colCount`, resizes TWO parallel
  vectors on the mesh TEMPLATE - `+0xf4` `IVectorCollider` (face colliders) and `+0x100`
  `ICollisionMesh` (vertex views) - and fills slot `i` from the i-th block in file order
  (block = u32 size, u32 class id, then the class's `load`). No reordering: **file col index i ==
  engine "collision LOD" i**.
- `BStandardMesh<>::setCollisionLod(i)` `0x083b50e0` stores `i` at **template `+0xe4`**;
  `getVertexCount/getVertices/getFaceCount/getFaces` `0x083b5290..` and `getDistanceToGeometry`
  `0x083b4fd0` index the two vectors with `template+0xe4` at call time. The current LOD is
  therefore **shared mutable state on the template**, shared by every instance of that mesh.
- `ResponsePhysics::getVertexCollision(lod)` `0x082587e0`: mesh = `obj.queryComponent(IID_IGeometry
  0x492fe0fe, IID_ICollisionMesh 0xd0867dfb)`, else `findLodCollisionMesh(obj, 0x94a7 LodObjectTemplate,
  0x94b1 DistCompareLodSelector, 0xc4c2)` `0x0818d910` (highest LOD child's geometry); cached at
  `+0xdc` (dirty byte `+0xd8`). Then `n = mesh.getNumCollisionLods()`; if `n != 0`:
  `mesh.setCollisionLod(lod < n ? lod : 0)`. Returns the mesh.
- `ResponsePhysics::getFaceCollision(lod)` `0x08258730`: FIRST calls `this->getVertexCollision(lod)`
  (that is what selects the LOD), then returns the geometry's `IVectorCollider` (IID 0xb54616fc),
  cached at `+0xe0` (dirty `+0xd9`). `setDirtyCollisionLodCache` `0x08258710` sets both dirty bytes.
  `StaticResponsePhysics` is identical; `PointResponsePhysics::getFaceCollision/getVertexCollision`
  (`0x08256e20`, `0x08256ea0`) ignore the lod and set nothing.
- A whole-binary scan for calls through response vtbl +0x58/+0x5c finds only the immediates 0 and 1.
  Users: `ResponsePhysics::checkObjectVsObject` (vertex 0; face 0 or 1), `checkVsTerrain` (0),
  `shouldCheckCollision` (1, 1), `checkObjectVsObjects` (vertex 0, 0),
  `PointResponsePhysics::checkObjectVsObject` (`B.getFaceCollision(1)`, 0x08257067).
  **Nothing on the server ever asks for LOD 2.**

Rule in `ResponsePhysics::checkObjectVsObject(A, B, dt, w)` (0x082596f8, 0x08259732..0x0825976b, verified):
```
vertsA = A.resp.getVertexCollision(0)                    // A's col0
lod    = (getRootParent(A).getBoundingRadius() < 4.0 || A.template is BFSoldier 0x9493) ? 1 : 0   // 4.0 @0x086c0304
facesB = B.resp.getFaceCollision(lod)                    // B's col[lod], col0 if B has < 2 layers
```
Projectiles (point response) always ask the target for LOD 1.

Game data (measured with the repo reader logic, every `.sm` in the mod's top-level archives):
layers per file - bf1942: 0:805, 1:520, 2:210; XPack1 0:157 1:78 2:58; XPack2 0:209 1:135 2:136;
DesertCombat 0:530 1:345 2:248; FH 0:2372 1:1130 2:1156. **No installed .sm has a third collision
layer.** Where there are two, col0 has fewer faces than col1 in 203 of 210 vanilla files
(Sherman hull: col0 14 verts / 24 faces, col1 28 verts / 46 faces). All layers are
`CID_SimpleCollisionMesh` 0xeb97c2fa, format 5 (agrees with ledger SM-9).

So, read from binary + data: **col0 = the coarse hull: the source of a body's collision vertices
and the face mesh hit by large bodies (root radius >= 4 m); col1 = the fine mesh: hit by
projectiles, soldiers and small bodies (root radius < 4 m).** The community "col0 projectile /
col1 vehicle / col2 soldier" three-mesh description does not match BF1942: the index order is
the other way round for 0/1 and col2 does not exist in the data nor in any server call. (lore,
not binary: that naming probably comes from later Refractor 2 tools.)

Quirk (inferred from the two reads above): because the LOD lives on the template and
`getVertices()` is evaluated inside the vertex loop after `B.getFaceCollision(lod)` ran, two
instances of the SAME mesh template colliding with `lod == 1` make A's vertex set col1 too. With
different templates A's vertices are col0. Line tests that go straight to `IVectorCollider`
(`ObjectManager::intersectLine` `0x0819e840` does not touch `ICollisionMesh`) use whatever LOD was
set last - open, not my track.

### F9. Narrow phase, caller side: `ResponsePhysics::checkObjectVsObject(A, B, dt, w)` 0x08259690

Early outs (read): A soldier & B projectile -> return; A soldier & B soldier -> cylinder push
(F12); `vertsA == NULL` or `facesB == NULL` -> return.

Nodes (read): `nodeAr` = rootA.queryComponent(0xc422), `nodeBr` = rootB's, `nodeB` = B's own
(0x0825982d), `nodeA` = `A+0x60`.

Shares (verified, 0x08259914..0x082599cc and 0x0825a3be..0x0825a47d; raw opcodes `de f1` = st1 := st0/st1,
`d8 ea` = st0 := st2 - st0):
```
no nodeAr:                 vA = 0,  shareA = 0,   shareB = +1.0
no nodeB or no nodeBr:     vB = 0,  shareA = 1.0, shareB = 0
else  s = massBr / (massAr + massBr)                    // getMass = node vtbl +0xa0, ROOT nodes
      s >  0.95 (0x086d16cc):  shareA = 1.0, shareB = 0
      s <  0.05 (0x086c08a8):  shareA = 0,   shareB = +1.0      <-- POSITIVE (fldz/fxch/fstps at 0x0825a3d5)
      otherwise:               shareA = s,   shareB = -(1 - s)  <-- negative (xorb $0x80 at 0x08259980)
shareA *= w;  shareB *= w
```
The briefing asked for the sign of the snapped `shareB`: it is **+1.0**, while the unsnapped value
is negative. With `impulseOn`'s convention (adjust = -depth * n, speedAdjust = -(v.n) n) the
negative share is the physically right one (pushes B along -n, away from A), so +1.0 pushes a
much lighter B the WRONG way (toward A). It looks like an engine slip. It only fires when the
vertex side is > 19x heavier than the face side; in the common similar-size case the opposite
direction test (light body as vertex side, `shareA = 1.0`) applies the correct push in the same
tick. For the re-implementation use -1.0 unless bug parity is wanted.

Sweep (verified, 0x08259a02..0x08259b68):
```
relV  = nodeAr.getPositionalSpeed() - nodeBr.getPositionalSpeed()      // linear only, ROOT nodes
off   = (A.pos - rootA.pos) + relV * dt
S     = A.pos - off            = rootA.pos - relV * dt                  // segment start, world
n     = vertsA.getVertexCount();  if (n == 0) return;  if (n < 4) n = 1 // 0x08259ba5 cmp $3 / jg
for i in 0..n-1:
    v   = vertsA.getVertices()[i]            // 16-byte record: f32 x,y,z ; u16 material @+0xc ; u16 pad
    D   = RotA * v.xyz + off                 // A.getAbsoluteTransformation() 3x3, x' = m0 x + m4 y + m8 z
    hit = facesB->getDistanceToGeometry(false, B.getAbsoluteTransformation(), S, D,
                                        &normal, &pos, &f1, &f2, &f3, &mat)       // vtbl +0xc
```
`S + D = A.pos + RotA*v` = the vertex's CURRENT world position. So the "swept segment" is **a ray
from where A's ROOT origin was one tick ago (in B's moving frame) to the vertex's current world
position** - a centre-to-vertex inside/outside probe, not a vertex path. `getDistanceToGeometry`'s
4th/5th arguments are (position, direction), not two endpoints.

Per hit (verified unless noted):
- `mat == 0x5a (90)` and A's template is Projectile 0x9495 -> ignore the hit (0x08259d12 / 0x0825a394).
  `mat` is initialised to 1 once BEFORE the loop (0x08259b37) and is in/out: see F10.
- `matV = u16 at vertex+0xc`; `vRel = nodeAr.getTangentSpeed(pos) - nodeBr.getTangentSpeed(pos)`
  (`fsubrs`, A minus B, 0x08259dc4).
- if `|vRel|^2 > 0.1` (0x086b1ca0; `je` taken on st0 > const at 0x08259e4c): call
  `A.handleCollision(B, vRel, normal, pos - A.pos, matV, mat)`; if it returns 1 call
  `B.handleCollision(A, -vRel, normal, pos - B.pos, mat, matV)`; both must return 1 or the
  response below is skipped. At or below 0.1 no handler is called and the response always runs.
- `depth = f2`. Soldier A and `i != 0` (0x0825a0eb..0x0825a1f1): `u = S - pos`; if
  `|A.pos.y - pos.y| < 0.65` (0x086cfc28; the code tests `|u.y + off.y|`) `u.y = 0`, else
  `depth = f3`; `normal = normalize(u)` (left unnormalised if |u|^2 is within 1.19e-7 of 1, zero
  if |u|^2 < 1.19e-7). Soldier vertex 0 keeps the face normal and f2.
- if `nodeA` and `shareA != 0`: `A.resp.impulseOn(pos - A.pos, shareA*vRel, normal, depth*shareA, matV, mat)`;
  if `nodeB` and `shareB != 0`: `B.resp.impulseOn(pos - B.pos, shareB*vRel, normal, depth*shareB, matV, mat)`
  (same normal, same material order for both).

`SimpleObject::handleCollision(self, other, speed, normal, relPos, matSelf, matOther)` `0x081dab40`
(read): `matOther == 99` -> `game.query(0x1d4c1)->vtbl+0xf4(self, 1e10 (0x501502f9), -1, ...)` = an
instant kill, still returns 1; else if `matSelf == 37 || matOther == 37` -> no armor / damage
dispatch at all, returns 1 (physical response only); else the armor path of briefing item 6.
Data: vanilla collision faces - material 99 on 275 faces (interiors of closed houses, barracks,
citymesh), 37 on 119 faces (HoHa / BlackMedal wheels and track wheels), 90 on 2,812 faces (ship
hulls, bridges, huts, repair dock); 37 and 99 have no entry in `materialManagerdefine.con`.

### F10. The face collider: `SimpleCollisionMesh::getDistanceToGeometry` 0x083c9f70 (IVectorCollider vtbl +0xc)

Signature (symbol): `(bool doubleSided, Mat4 const& xf, Vec3 const& position, Vec3 const& direction,
Vec3& normalOut, Vec3& positionOut, float& f1, float& f2, float& f3, int* material) const`.
`BStandardMesh<>::getDistanceToGeometry` `0x083b4fd0` forwards to `template.colliders[template+0xe4]`,
setting the globals `geom::g_scaled/g_scale` from the instance scale (`+0x50..`) when byte `+0xac` is set.

Steps (read; comparisons verified):
1. local start `p0 = R^T (position - xf.translation)`, local `d = R^T direction`, `p1 = p0 + d`
   (both divided component-wise by `g_scale` when scaled).
2. reject unless the AABB of {p0, p1} overlaps the mesh AABB (`this+0x10` min, `+0x1c` max, built
   at load from the vertices).
3. `Bsp::getCollidingFaces(faces, p0, p1)` `0x08386ef0` -> `BspNode::getCollidingFaces` `0x08387b40`:
   inner node = plane point `+0x8`, plane normal `+0x14`, children `+0x20` (front) / `+0x24` (back);
   descend into the side(s) holding p0 and p1; leaf (`+0` = face count, `+4` = Face* list): take
   each face not yet stamped with `globalCheckCounter` (Face `+0xc`) whose `dot(p1 - p0, n) < 0`
   (back faces are culled here regardless of `doubleSided`).
4. for each candidate, unless `material && *material == 0 && face.material == 90` (0x083ca460..0x083ca471):
   `checkFaceAndEdgeCollision(v0, v1, v2, face.n, p0, p1, hit, fa, fb, doubleSided)`; keep the
   face with the **smallest fb** (`*f3` starts at 1e9; update when `*f3 > fb`, 0x083ca4fb) = the
   first face crossed from the start. On update `*f2 = fa`, `*f3 = fb`.
5. outputs: `normalOut = R * face.n`, `positionOut = R * hit + translation` (both multiplied by
   `g_scale` first when scaled), `*material = face.material`. **`f1` is never written.**

Face record in memory (`BspNode::Face`, 32 bytes): `+0` normal f32x3, `+0xc` visit stamp,
`+0x10/+0x14/+0x18` vertex indices (u32), `+0x1c` material (u32). Vertices `this+0x34` (16-byte
records), file faces `this+0x40` (8 bytes: u16 i0,i1,i2, u16 material), BSP `this+0x4c`.
File layout per block (`SimpleCollisionMesh::load` `0x083c9e00`, `Bsp::load` `0x08386d70`,
`BspNode::load` `0x08387270`): u32 5; vertex vector; face vector; u32 faceRefCount; u32 nodeCount;
u32 bspFaceCount; bspFaceCount x 32-byte Face records (normal stored in the file); then the node
tree recursively: 24 bytes plane (point, normal), u32 faceCount, faceCount x u32 face index,
bool hasFront [+node], bool hasBack [+node].
Measured on the five Sherman hull/hatch layers (152 faces): the stored normal is always
`-normalize((v1-v0) x (v2-v0))`, i.e. `n = normalize((v2 - v0) x (v1 - v0))`.

The material-90 in/out quirk: the caller passes `mat = 1` for the first vertex, and afterwards the
material of the last hit; once a hit returns material 0, faces of material 90 are invisible to the
remaining vertices of that call.

### F11. `geom::checkFaceAndEdgeCollision` 0x08374880  (verified)

`(v0, v1, v2, n, p0, p1, Vec3& hit, float& fa, float& fb, bool doubleSided)`:
```
d = p1 - p0;                      if d == (0,0,0) return false
e = dot(p1 - v0, n);              if e > 0  return false     // END must be on/behind the plane   (0x0837498d..0x0837499a)
s = dot(p0 - v0, n);              if !(s > 0) return false   // START strictly in front           (0x083749f8..0x083749ff)
dn = dot(n, d);                   if !doubleSided && !(dn < 0) return false                       (0x08374a46)
t = s / (-dn)                                                // opcode de fa: st2 := st2/st0
projection: |n.y| >= 0.7 (0x086c08b0) -> use (x,z);  else |n.z| <= 0.3 (0x086c030c) -> use (y,z);  else (x,y)
hit = p0 + t*d;  2-D same-side test of hit against edges v0v1, v1v2, v2v0 (either winding, zero counts as inside)
fa = e                            // signed plane distance of the segment END: <= 0, |fa| = penetration along the normal
fb = (t - 1) * |d|                // <= 0: minus the distance from the hit point to the segment END, along the segment
```
So both "depth-like" floats are **non-positive**. `f2 = fa` is the default penetration depth
(`impulseOn` moves by `-depth * n`, i.e. `+|e| n`, out of B's face); `f3 = fb` is the along-ray
penetration, used for a soldier's vertices 1..n-1 when the hit is >= 0.65 m above/below the
soldier origin, together with the recomputed normal.

`checkFaceAndEdgeCollisionDoubleSided` `0x08374e40` = the same with `doubleSided = 1`; **no caller
in the server**. `checkSweptSphereToSweptSphereCollision` `0x08375610` = `getClosestDistanceBetweenLines(...)`
then `dist <= r1 + r2`; **no caller in the server**; `checkSphereAndEdgeCollision` `0x08374e90`
likewise. Callers of `checkFaceAndEdgeCollision`: `SimpleCollisionMesh::getDistanceToGeometry`,
`GridCollisionLeaf::checkCollisions` `0x083c01e0`, `PortalMesh::getFirstPortalIntersection`, the
DoubleSided wrapper.

### F12. Soldier vs soldier  (read, signs not re-derived)

Both templates 0x9493: vertical overlap test from the geometry bounding box (`bbox[1]` min y,
`bbox[4]` max y); `d = posB - posA`; return if `|d|^2 > 1.0`; `n = |d| >= 0.01 ? d/|d| : (0,0,1)`;
`push = n * (1 - |d|)` with `push.y = 0`. Both free (`+0x50 == 0`): `sA = max(|vA.push|, 0.9|push|)`,
same for B, `wA = sA/(sA+sB)`, `posA -= push*wA`, `posB += push*(1-wA)`. If only B is attached to
a vehicle `posA -= push`; if only A is attached `posB += push`; both attached -> nothing. Positions
are written straight to the nodes (`setAbsolutePosition` +0x30); no impulse, no handleCollision.

### F13. Other collision-mesh classes  (read)

`nm`: `SimpleCollisionMesh` (vtbl `0x08747fc0`, BSP), `GridCollisionMesh` (vtbl `0x08747e20`; a 2-D
grid `+0x28` cells per side over bounds `+0xc..+0x14`, per-cell u16 leaf lists, leaves of 0x40 bytes
tested by `GridCollisionLeaf::checkCollisions`), `SkeletonCollisionMesh` (capsule / cylinder /
ellipsoid per bone, `checkCapsuleCollision` `0x083ae510` etc.), `TreeMesh`, `AnimatedMesh`. No
shipped `.sm` layer or tree collider is a `GridCollisionMesh` (ledger SM-9: 24,532/24,532 layers
and TM-1: 275/275 tree colliders are `CID_SimpleCollisionMesh`), so vehicle work needs only F10/F11.
`ICollisionMesh` (secondary vtable): +0xc setCollisionLod, +0x10 getCollisionLod, +0x14
getNumCollisionLods, +0x18 getVertexCount, +0x1c getVertices, +0x20 getFaceCount, +0x24 getFaces
(`SimpleCollisionMesh` itself answers 0 LODs).

---------------------------------------------------------------------------------------------

## 2. Symbol table

| address | name | note |
|---|---|---|
| 0x0815c2a0 | GameServer::simulateFrame | frame order, F1 |
| 0x0805da00 | Game::updateWorldCollision | grid refresh, counter++, world pass |
| 0x0815c0a0 | GameServer::simulatePlayerCollisions | per-player vehicle pass |
| 0x08147580 | bf::performMobileCollisionUpdate | recursive `update(dt, part)` over children |
| 0x0825cfd0 / 0x0825d040 | ResponsePhysicsManager::addObject / removeObject | list by response CID: 0xc42d -> +0xc, 0xc42e -> +0x14, static -> none |
| 0x0825d0b0 | ResponsePhysicsManager::update | F3 |
| 0x0825d5c0 | world::getCollisionObjects(obj, radius, dt) | grid query, F5 |
| 0x0825d820 | ResponsePhysicsManager::checkObjectVsObjects | pair loop, F6 |
| 0x0825e190 | ...::resetCachedCollisionObjects | sets manager byte +0x1c |
| 0x0825e1a0 | ...::reset | `++collisionCheckedCounter` |
| 0x0872e2d8 | world::collisionCheckedCounter | per-tick stamp, init 1 |
| 0x0879cfc0 | world::objectVector | global candidate vector |
| 0x0819dc40 / 0x0819df80 | ObjectManager::getObjectsFromGrid (sphere / line) | vtbl +0x30 / +0x44 |
| 0x0818dc60 | ObjectFlagPredicator::predicate | `(flags & mask) == mask` |
| 0x08165630 | BCompositeObject<>::getBoundingRadius | composite radius, cached +0xb4 |
| 0x081dd1d0 | SimpleObjectTemplate::setResponsePhysicsComponent | picks Point / mobile / Static |
| 0x08165900 / 0x08165cb0 | BCompositeObject<IPlayerObject>::addChild / removeChild | child leaves / rejoins the manager list |
| 0x082584e0 | ResponsePhysics::shouldCheckCollision | part eligibility |
| 0x08258600 / 0x08258570 | getNextToCheck / addToTmpResponseList | chain build |
| 0x08258450 / 0x082584a0 / 0x082584c0 / 0x08258560 | setDirtyNextToCheck / resetNextToCheck / setNextToCheck / getSimpleNextToCheck | fields +0xd1, +0xd4 |
| 0x0825cd80 / 0x0825cda0 | set/getCollisionChecked | field +0xbc |
| 0x0825cdb0 / 0x0825cdd0 / 0x0825cdf0 | addTo/removeFrom/getCollisionGroup(s) | field +0xb8 |
| 0x08258730 / 0x082587e0 / 0x08258710 | getFaceCollision / getVertexCollision / setDirtyCollisionLodCache | caches +0xe0 / +0xdc, dirty +0xd9 / +0xd8 |
| 0x0818d5b0 / 0x0818d910 | world::getCollisionMesh / findLodCollisionMesh | geometry -> ICollisionMesh, LodObject fallback |
| 0x08259690 | ResponsePhysics::checkObjectVsObject(A,B,dt,w) | F9 |
| 0x08257030 | PointResponsePhysics::checkObjectVsObject | projectile line vs `B.getFaceCollision(1)` |
| 0x0825f1a0 | StaticResponsePhysics::checkObjectVsObject | empty |
| 0x083a6290 | BStandardMeshTemplate<>::loadCollision | col blocks -> template +0xf4 / +0x100 |
| 0x083b50e0 / 0x083b5230 / 0x083b5260 | BStandardMesh<>::set/getCollisionLod, getNumCollisionLods | LOD index at TEMPLATE +0xe4 |
| 0x083b4fd0 | BStandardMesh<>::getDistanceToGeometry | forwards to colliders[LOD], sets g_scale |
| 0x083c9f70 | SimpleCollisionMesh::getDistanceToGeometry | F10 |
| 0x083c9e00 / 0x08386d70 / 0x08387270 | SimpleCollisionMesh::load / Bsp::load / BspNode::load | file layout |
| 0x08386ef0 / 0x08387b40 | Bsp / BspNode::getCollidingFaces | BSP segment walk + back-face cull |
| 0x08374880 | geom::checkFaceAndEdgeCollision | F11 |
| 0x08374e40 / 0x08375610 / 0x08374e90 | ...DoubleSided / checkSweptSphereToSweptSphere / checkSphereAndEdge | no server callers |
| 0x083c14f0 / 0x083c01e0 | GridCollisionMesh::getDistanceToGeometry / GridCollisionLeaf::checkCollisions | unused by shipped data |
| 0x081dab40 | SimpleObject::handleCollision | materials 99 (kill) and 37 (no damage) |
| IIDs | 0xd0867dfb ICollisionMesh, 0xb54616fc IVectorCollider, 0x492fe0fe IGeometry | |
| CIDs | 0xc42d ResponsePhysics, 0xc42e PointResponsePhysics, 0xc42f StaticResponsePhysics, 0xeb97c2fa SimpleCollisionMesh, 0x62fcc2fe GridCollisionMesh, 0x94a7 LodObjectTemplate, 0x94b1 DistCompareLodSelector | |

---------------------------------------------------------------------------------------------

## 3. Corrections to the briefing / corpus

1. Briefing 4.1: the manager lists are `+0x0c` = mesh bodies (CID 0xc42d), walked through
   `getNextToCheck`, and `+0x14` = POINT responses (0xc42e), flat. Sleeping is only tested for the
   mesh list; statics are in neither list.
2. Briefing 4.2 "A's collision vertices are swept as segments": the segment is not the vertex's
   path. It runs from rootA's origin displaced by `-relV*dt` to the vertex's current position; the
   collider takes (position, direction). `relV` is the difference of the ROOT nodes' linear speeds.
3. Briefing 4.2, share sign: snapped low -> `shareA = 0, shareB = +1.0`; snapped high ->
   `shareA = 1, shareB = 0`; unsnapped `shareB = -(1 - shareA)`. The +1.0 is inconsistent with the
   unsnapped sign (F9). Also: both handlers must return 1 only when `|vRel|^2 > 0.1`; below that the
   handlers are not called and the response still runs.
4. `checkObjectVsObject` floats: param_4 = dt, param_5 = direction weight 1.0 / 0.5 (F6).
5. The two depth floats are both <= 0: f2 = signed plane distance of the segment end, f3 =
   -(distance hit -> end along the segment); f1 is never written by `SimpleCollisionMesh`.
6. `stdmesh.py`: the per-face `material_id, flags` byte pair is one u16 material to the engine
   (`buildBsp`/`giveVerticesMaterial` read `puVar[3]` as a ushort; all 69,649 vanilla faces are
   < 256 so the split is harmless); the 4th vertex "float" is u16 material + u16 pad (SM-6 agrees).
   The rest of each block after the face array is the serialised BSP described in F10, including
   per-face normals - the reader currently skips it.
7. No "col2": corpus / lore text that describes three collision meshes (projectile / vehicle /
   soldier) does not apply to BF1942 (F8).

---------------------------------------------------------------------------------------------

## 4. Open, with the best next lead

- Which code gives projectiles / soldiers their collision-group bit (so fences in
  `c_CGProjectiles` let bullets through): look for writers of template `+0x78` or
  `addToCollisionGroup` calls in `ProjectileTemplate` / `BFSoldierTemplate` constructors.
- Template `+0x70` bit 1 / bit 2 (presumably hasCollisionPhysics / hasResponsePhysics) and how object
  flag 0x200 is derived: the ConsoleClass handlers registered at 0x081b8625..0x081b8969.
- The LOD-on-template state as seen by `ObjectManager::intersectLine` / `raycast` (bullets, line of
  sight): which LOD is current when they run. `raycast` `0x081a1000` calls `world::getCollisionMesh`
  and may set it; `intersectLine` does not.
- The `+1.0` snapped share: confirm in game (very heavy vertex-side body against a light,
  similar-radius body) or on the client build.
- `getIsMobile` (+0xe0) exact definition; what `setDirtyNextToCheck` callers are (child add/remove).
- F12 signs were not re-derived in objdump.

---------------------------------------------------------------------------------------------

## 5. Implementation notes (JavaScript, fixed 30 Hz, dt = 1/30)

1. Per tick, after integrating every body: `stamp++`. Process awake mobile bodies; for each, A =
   root first, then each collidable child part (pre-order). Set `A.stamp = stamp` before its pairs.
2. Candidates: sphere at `A.pos - 0.5*v*dt`, radius `|v*dt|^2*0.25 + 1 + rA` (root query reused for
   the children). A simple loop over all roots is fine for a viewer; keep the per-pair sphere test:
   `dist^2 <= (rA + |vA|^2*dt/4 + rB + |vB|^2*dt/4)^2`, radii = part radii, speeds = root speeds,
   and require `max(rA, rB) >= 0.45`.
3. Pair filters: different roots; at least one of the two parts is a root; `B.stamp != stamp`;
   at least one side mobile and awake; skip if both vertex sets have < 4 vertices; group masks
   disjoint (always true for vehicles).
4. Direction: static -> always face side; else by ROOT radius: ratio > 4 (or soldier) -> smaller is
   the vertex side with w = 1; otherwise both directions with w = 0.5 each.
5. Meshes: vertex side = col0 of the part's `.sm`; face side = col1 when the vertex side's root
   radius < 4 m or it is a soldier (col0 if the file has one layer), else col0. Build per layer:
   vertices (xyz + u16 material), faces with `n = normalize((v2-v0) x (v1-v0))` (or read the stored
   normals from the BSP block), AABB. A BSP is optional at these sizes (tens of faces); just
   pre-cull with `dot(d, n) < 0` and the segment AABB.
6. Per vertex i (only i = 0 when the layer has < 4 vertices): `S = rootA.pos - relV*dt`,
   `E = A.pos + RotA*v_i`; transform both into B's local frame (divide by B's scale if any); run
   F11 on every face, keep the smallest `fb`; world normal = `RotB*n`, world hit = `RotB*hit + posB`,
   `depth = e` (<= 0). `relV` uses root linear velocities; the contact speed uses the root nodes'
   tangent speeds at the hit.
7. Feed the response exactly as F9: share by ROOT masses with the 0.95 / 0.05 snaps, times w;
   `impulseOn(hit - part.pos, share*vRel, normal, share*depth, matVertex, matFace)` with
   `shareB = -(1 - s)` (and -1, not the binary's +1, for the low snap unless bug parity is wanted).
   Damage / handler gate: `|vRel|^2 > 0.1`; face material 99 = kill, 37 on either side = no damage,
   90 = ignored by projectiles only.
8. Determinism notes: processing order decides which side of a pair does the visiting (rule 5 of
   F6), and the two-way 0.5/0.5 split makes the result order-independent for similar-size bodies;
   keep root-before-children order and a stable body order.
