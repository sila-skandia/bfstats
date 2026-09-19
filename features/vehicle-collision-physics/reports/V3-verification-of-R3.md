# V3 - adversarial verification of R3 (geometry and broadphase)

Verifier track V3, round 2026-09-19. Target: `SP/reports/R3-geometry-broadphase.md`. Binary:
`bf1942_lnxded.static`. Method: every float claim re-derived by hand from `objdump -d` WITH raw
opcode bytes (x87 stack written out instruction by instruction; R3's `r3-x87.py` tracer was NOT
used, so this is independent). Integer / pointer logic read from objdump, vtable slots from
`vt.py` (vptr-relative). Data claim re-counted with my own script (`SP/v3-sm-count.py`, uses the
repo's `bf42/stdmesh.py` + `RfaArchive`). Scratch: `SP/v3-*.asm`, `SP/v3-sm-count.{py,out,err}`,
`SP/v3-matscan.py`.

Verdict key: CONFIRMED / CORRECTED / REFUTED / NOT VERIFIABLE.

## 0. Scoreboard

| # | claim | verdict |
|---|---|---|
| 1a | pair-filter conditions and their order (F6 rules 1-10) | CONFIRMED |
| 1b | stamp dedup: only "A" is stamped, in the prologue; B tested with `==` | CONFIRMED (+ detail) |
| 1c | passive / mobile / awake rule | CONFIRMED; `getIsMobile` closed: PhysicsNode 1, PointPhysicsNode 1, StaticPhysicsNode 0 |
| 1d | collision groups: skip when `(gA & gB) != 0` | CONFIRMED |
| 1e | `rA < 0.45 && rB < 0.45` skip (part radii) | CONFIRMED |
| 1f | swept sphere: margin = `|v_root|^2 * dt * 0.25`, skip if `distSqr > sum^2` | CONFIRMED (it really is |v|^2 and dt^1) |
| 1g | grid query centre `A.pos - 0.5 d`, radius `|d|^2*0.25 + 1 + rA`, `d = v_root*dt` | CONFIRMED (+ omission) |
| 2 | direction / weight rule, 4th float = dt, 5th = 1.0 / 0.5, both directions same iteration | CONFIRMED (boundary is `<=`, i.e. ratio >= 4) |
| 3a | getVertexCollision / getFaceCollision plumbing, `lod < n ? lod : 0` | CONFIRMED |
| 3b | faces LOD 1 when root radius < 4.0 or soldier, else 0; vertices LOD 0 | CONFIRMED |
| 3c | chosen LOD stored on the SHARED StandardMeshTemplate (+0xe4) | CONFIRMED |
| 3d | no installed `.sm` has a third collision layer | CONFIRMED, on a wider sample than R3's (46,858 files, 18 mods) |
| 4 | narrow phase: one common start point, (position, direction) collider, single-sided, f1 unwritten, f2 = e <= 0, f3 = (t-1)|d|, depth = f2 | CONFIRMED |
| 5 | special materials 99 / 37 / 90 | CORRECTED - incomplete: three more test sites, two of them on the path vehicles and soldiers actually take |
| 6 | addChild removes the child from the manager; statics in no list | CONFIRMED |

No inverted comparison, swapped operand or mis-counted vtable slot found in R3. The one real defect
is the coverage gap in item 5.

---------------------------------------------------------------------------------------------

## 1. Pair filter - `ResponsePhysicsManager::checkObjectVsObjects(this, dt, A)` 0x0825d820

Args: `0x8` this, `0xc` dt (float), `0x10` A.

Prologue (CONFIRMED): `resp = A+0x64` (0x825d847; NULL -> Debug message 0x825e0ca, return);
`groupsA = resp->+0x38()` = getCollisionGroups (field +0xb8, 0x825cdf0) -> `-0x170`;
**`resp->+0x28(collisionCheckedCounter)` = setCollisionChecked at 0x825d86d, BEFORE the class test** -
so point responses are stamped too. Class test `resp->+0x64() == [0x86c2aa0] = 0xc42e` -> point path 0x825de9b.
vtable slots checked with `vt.py 0x0872e240`: +0x28 set, +0x2c getCollisionChecked, +0x38 groups,
+0x40 getNextToCheck, +0x10 getObject, +0x5c getVertexCollision, +0x60 checkObjectVsObject, +0x64 getClassID.

Which side is stamped when (CONFIRMED + detail): only the part being processed as "A" is ever
stamped, once, in this prologue. B is never stamped by the pair loop. `update(dt, obj != NULL)`
first writes `counter - 1` (0x825d0eb `mov 0x872e2d8,%eax; dec %eax; call *0x28`) and only then,
if the part's own node is awake, calls `checkObjectVsObjects` (which stamps `counter`). A sleeping
player-vehicle part therefore stays at `counter-1` = "not yet handled". Static responses:
`setCollisionChecked` 0x825f3e0 empty, `getCollisionChecked` 0x825f3f0 returns 0 - never equal to
the counter (init 1, `reset()` 0x825e1a0 = `inc`).

Mesh path, in binary order (all CONFIRMED):

1. `B == A` - 0x825d9f3 `cmp %esi,0x10(%ebp); je skip`.
2. `getRootParent(B) == rootA` - 0x825da36.
3. `passiveA` (byte `-0x17d`) and (rootB node NULL 0x825da54 | `!node->+0xe0()` 0x825da5e | `node->+0xcc()` 0x825da71).
   `passiveA` built at 0x825d925..0x825d957 / 0x825de62: `!(rootA.node && getIsMobile() && !isSleeping())`.
   `getIsMobile`: 0x824d460 PhysicsNode = 1, 0x8256af0 PointPhysicsNode = 1, 0x825eaf0 StaticPhysicsNode = 0
   (closes R3's open item). `isSleeping` 0x824d480 = `(int)[+0x94] <= 0`; static 0x825eb10 = 0.
4. `B.flags & 1` - 0x825da7e.
5. `B.resp->+0x2c() == [0x872e2d8]` -> skip, 0x825da94 `cmp; je`.
6. `test %eax,-0x170(%ebp); jne skip` 0x825daa8 - skip when the masks share ANY bit.
7. 0x825dab3 `A == rootA -> go`; 0x825dabb `B == rootB -> go`; else skip. At least one side is a root.
8. 0x825db2b: `flds 0.45; fucom st1(=rA)`; `test $0x45; jne 825de5b` = NOT(0.45 > rA) -> proceed;
   else 0x825db4b `fucompp` (0.45 vs rB), `je skip` = 0.45 > rB. Skip iff `rA < 0.45 && rB < 0.45`.
   rA = `A->+0x48()` (-0x17c), rB = `B->+0x48()` (-0x19c): PART radii. `[0x86d1798]` = 0.45.
9. Sphere test, stack written out:
   - distSqr = `distanceSqr(A.absXf+0x30, B.absXf+0x30)` 0x825db71 -> `-0x1a0` (part positions).
   - rootB = `getRootParent(queryInterface(B,0xc378))`, `nodeBr = rootB+0x60` (0x825db9c); `nodeAr` = `-0x188` = `getRootParent(A)+0x60`.
   - 0x825dbc8..0x825dbe4: `x^2+y^2+z^2` of `nodeAr->+0x38()` then `fmuls 0xc(%ebp)` (dt) then `fmuls [0x86c08ac]` (0.25).
     Same for B at 0x825dc09..0x825dc25. **|v|^2 * dt * 0.25 - speed SQUARED, dt to the first power.** 0 when the node is NULL
     (`fldz; fld st0` 0x825db9a, fix-up 0x825de43).
   - 0x825dc2b: `flds rA; faddp st,st(2)` (mA+rA); `fxch; fadds rB; faddp` = mA+rA+mB+rB; `flds distSqr; fxch; fmul st0;
     fxch; fucompp` compares st0 = distSqr with st1 = sum^2; `test $0x45; je skip` = **skip iff distSqr > sum^2**.
10. 0x825dc63 / 0x825dc72 `getVertexCollision(0)` on both; 0x825dc92 `cmp $3; jbe` and 0x825de35 `cmp $3; ja`:
    skip iff both meshes exist and both have <= 3 vertices.

Advance: 0x825dac3 `B.resp->+0x40()` (getNextToCheck) -> `->+0x10()` (getObject); NULL ends the root.

Point path 0x825de9b (CONFIRMED): always clears the vector and calls `getCollisionObjects(A, 0.0, dt)`
(0x825deea `push $0`); skips the whole candidate root when `R == A` (0x825df16); per part: skip if
`getRootParent(B) == A` (compared with A itself, 0x825df56), `(gA & gB) != 0` (0x825df6f), `B.flags & 1`;
else `A.resp->+0x60(A, B, dt, 1.0)` (0x825df8c `push $0x3f800000`). No radius test, no stamp test.

Cache (CONFIRMED): 0x825d8b7..0x825d8cc - query skipped iff `queryInterface(A,0xc378) != 0 && [+0x50] != 0 && this[0x1c] == 0`;
the query path sets `this[0x1c] = 0`; `resetCachedCollisionObjects` 0x825e190 sets it to 1. The radius passed is A's OWN radius (-0x17c).
(Not in R3, inferred: the chain walk in `update` tests each part's OWN node for sleeping - 0x825d36c..0x825d395 - so an awake child
under a skipped root would reuse another vehicle's candidate list. Edge case only.)

### `getCollisionObjects(A, radius, dt)` 0x0825d5c0 - CONFIRMED

`d = getRootParent(A)->node->+0x38() * dt` (0x825d5ff..0x825d620). Non-point: 0x825d64f..0x825d672
`dx^2+dy^2+dz^2`, `fmuls [0x86c08ac]=0.25`, `fadds [0x86ba8d4]=1.0`; 0x825d69d `fadds 0xc(%ebp)` (+radius);
centre: `d*[0x86b05e8]=0.5` then `fsubrs (%eax)` (memory form: st0 = pos - 0.5d) 0x825d6b6..; call `objectManager->+0x30(centre, r, &objectVector, pred)`.
Point: start = `pos - d` (0x825d724 `fsubrs`), second vector = d, `->+0x44(start, d, &objectVector, pred, 0)`; the symbol's second
parameter is `Vec3 const&` (direction), first `Pos3`. Predicate mask 0x2000200 (0x825d5d2).
OMISSION: root node NULL (0x825d5ed) -> Debug message only, NO query (vector stays empty after the caller's erase).

---------------------------------------------------------------------------------------------

## 2. Direction and weights - 0x0825dc9b..0x0825de21 - CONFIRMED

`rBr = rootB->+0x48()` -> -0x1a8; `rAr` = -0x178 = `rootA->+0x48()`: ROOT bounding radii. `solX` = root template `->+0xc()` == `[0x86c2b88]` = 0x9493.
- 0x825dcce B.resp class == `[0x86c2aa4]` = 0xc42f -> 0x825de11: `A.resp->+0x60(A, B, dt, 0x3f800000)`.
- 0x825dcda A static (`-0x191`) -> 0x825dd5c: `B.resp->+0x60(B, A, dt, 1.0)`.
- 0x825dce3 `flds rBr; flds rAr; fxch; fucom` (rBr vs rAr); `jne 825dd8f` = NOT(rBr > rAr).
  - rBr > rAr: `fmuls 0.25` (0.25 rBr); `fxch; fucompp` (rAr vs 0.25 rBr); `jne 825dd88` = **rAr <= 0.25 rBr** -> `solB ? B.check(B,A,1.0) : A.check(A,B,1.0)`.
    Similar size: solA -> same as the line above; solB -> `B.check(B,A,1.0)`; else 0x825dd20 **`A.check(A,B,dt,0.5)` then 0x825dd40 `B.check(B,A,dt,0.5)`**.
  - rBr <= rAr (0x825dd8f): `rBr <= 0.25 rAr` -> `solA ? A.check(A,B,1.0) : B.check(B,A,1.0)`; similar: solB -> that line; solA -> `A.check(A,B,1.0)`;
    else 0x825ddc3 **`B.check(B,A,dt,0.5)` then 0x825dddd `A.check(A,B,dt,0.5)`**.
Push order at each site is `w, dt, Y, X, X.resp` -> `X.resp->checkObjectVsObject(X, Y, dt, w)`. In the callee `0x14(%ebp)` is only ever
multiplied into `vA - vB` (0x8259a29/33/3e) and `0x18(%ebp)` only into the two shares (0x82599b2/bb): 4th = dt, 5th = weight. CONFIRMED.
Both directions run back-to-back inside ONE iteration of this pair loop (same transforms; nothing is solved in between). Nuance for R3's
summary bullets: the one-way threshold is `small <= 0.25 * large` (ratio >= 4, not > 4).

---------------------------------------------------------------------------------------------

## 3. Mesh selection

- `getVertexCollision(lod)` 0x082587e0 - CONFIRMED. Dirty (+0xd8): `obj->+0x28([0x86e6710]=0x492fe0fe, [0x86e6728]=0xd0867dfb)`; NULL ->
  `findLodCollisionMesh(queryInterface(obj,0xc378), 0x94a7, 0x94b1, 0xc4c2)` 0x82588c7; cached +0xdc. Then `n = mesh->+0x14()`;
  `n == 0` -> no set; 0x825881a `cmp %dl,%al; jbe` (n <= lod) -> `setCollisionLod(0)` else `setCollisionLod(lod)` (+0xc).
  (It calls queryComponent directly, not `world::getCollisionMesh`.)
- `getFaceCollision(lod)` 0x08258730 - CONFIRMED: first `this->+0x5c(lod)` (0x8258743), then cached +0xe0 = geometry
  (`queryComponent(IGeometry,IGeometry)` or `findLodGeometry`) `->queryInterface([0x86e6724]=0xb54616fc)`.
- LOD rule in `checkObjectVsObject` - CONFIRMED: 0x82596f5 `push $0` -> `A.resp->+0x5c(0)`; 0x8259732 `root(A)->+0x48()`;
  `flds [0x86c0304]=4.0; fucompp` (4.0 vs r); `je 825a495` = 4.0 > r -> `ecx = 1`; else `ecx = 0` unless A class == 0x9493 -> 1;
  0x825976b `B.resp->+0x58(ecx)`. Exactly 4.0 -> LOD 0. Points: 0x8257064 `push $1` -> `B.getFaceCollision(1)`.
- LOD lives on the template - CONFIRMED: `BStandardMesh` ctor 0x83b4425 `mov %esi,0x24(%edi)` stores the `StandardMeshTemplate&` that
  `createInstance` 0x83b3c6b passes (`this` template); `setCollisionLod` 0x83b510a `mov %edi,0xe4(%edx)` with `edx = [this+0x24]`;
  `getVertexCount/getVertices/getFaceCount/getFaces` 0x83b5290.. index `[tmpl+0x100][tmpl+0xe4]`; `getDistanceToGeometry` 0x83b5000
  indexes `[tmpl+0xf4][tmpl+0xe4]` at call time. `loadCollision` 0x83a6290 fills +0xf4 / +0x100 in file order (read level).
  Extra: an out-of-range index prints a Debug message and is STILL stored (0x83b51ec `jmp 83b510a`); harmless because the caller clamps.
- Same-template quirk - CONFIRMED as a consequence: `getVertexCount` 0x8259b91 and `getVertices` 0x8259be1 both run after
  `B.getFaceCollision(lod)` 0x825976b, so A == B template with lod 1 reads col1 vertices.
- "only immediates 0 and 1" - CONFIRMED by my own heuristic scan of the full disassembly (calls `*0x58/*0x5c` with the receiver loaded
  from `+0x64` or inside a ResponsePhysics method): checkObjectVsObject (0; ecx in {0,1}), shouldCheckCollision 0x82584ff/1c/38 (1,1,1) and its
  Static twin, checkObjectVsObjects (0,0), checkVsTerrain 0x825a991 / 0x825aced / 0x825b02e (0), PointResponsePhysics::checkVsTerrain 0x825778c (0),
  PointResponsePhysics::checkObjectVsObject (1). A heuristic, not a proof.
- Data - CONFIRMED and widened. My script walks EVERY `.rfa` under each installed mod (level archives included) and counts the `colCount`
  header field, cross-checked against `stdmesh.parse`: **46,858 `.sm` entries in 18 mods, 0 with three or more collision layers**
  (0 layers 22,507; 1 layer 10,812; 2 layers 13,537); every one of the layers is `0xeb97c2fa` format 5. 2 entries unreadable (bf1918), 6 truncated
  FHSW / FHSWEurope level archives would not open. R3's per-mod figures reproduce exactly for top-level archives: XPack1 157/78/58, XPack2 209/135/136,
  DesertCombat 530/345/248, FH 2372/1130/1156; vanilla 805/520/210 reproduces when `StandardMesh_001.rfa` overrides `standardMesh.rfa` by
  lower-cased name (raw per-entry count is 864/522/218 - R3's number is a de-duplicated one, which it does not say).

---------------------------------------------------------------------------------------------

## 4. Narrow phase - `ResponsePhysics::checkObjectVsObject(this, A, B, dt, w)` 0x08259690 - CONFIRMED

- relV: 0x8259a02..0x8259a21 `fsubrs -0x84` (memory form, vAy - vBy), 0x8259a18 raw `de e2` = st2 := st0 - st2 = vAx - vBx, `fsubrs -0x80`.
  **relV = v(rootA node) - v(rootB node)**, linear only; x dt -> -0x198.
- off = `(A.pos - rootA.pos) + relV*dt`: 0x8259abb..0x8259b04 (`flds (rootPos); fsubrs (APos)` = A - root; `fadds (%edi)`).
- **S = A.pos - off = rootA.pos - relV*dt**: 0x8259b0f..0x8259b53 (`fsubrs (%eax)` = A.pos - off), copied ONCE to -0x188 before the loop and
  re-copied unchanged to -0x158 for every vertex (0x8259ca2). **One common start point, not per-vertex.**
- n = `verts->+0x18()`; 0 -> return; 0x8259ba5 `cmp $3; jg` else n = 1.
- Per vertex: `v = verts->+0x1c() + 16*i`; `D = M3x3(A) * v + off` with `x' = m0 x + m4 y + m8 z` (0x8259be9..0x8259c90) -> -0x178.
- Call 0x8259d04 `faces->+0xc(faces, 0, B.absXf, &S, &D, &normal(-0x48), &pos(-0x28), &f1(-0x1a8), &f2(-0x1a4), &f3(-0x1a0), &mat(-0x19c))`;
  the bool is the literal 0. In the collider 0x83ca216 `p1 = local(position) + local(direction)`, so the 5th argument IS a direction and the
  world end point is `S + D = A.pos + RotA*v`. `mat = 1` once before the loop (0x8259b37).
- `SimpleCollisionMesh::getDistanceToGeometry` 0x083c9f70: `*f3 = 1e9` (0x83ca43b, 0x4e6e6b28); per face
  `if (mat && *mat == 0 && face[+0x1c] == 0x5a) skip` (0x83ca45d..0x83ca471); `checkFaceAndEdgeCollision(v0,v1,v2,face,p0,p1,&hit,&fa,&fb,doubleSided)`;
  0x83ca4f2 `flds *f3; fucomp st1(=fb)`, `jne` = NOT(*f3 > fb): keep the SMALLEST fb; on update `*f3 = fb`, `*f2 = fa` (0x83ca50a).
  **`0x24(%ebp)` (f1) is never referenced anywhere in the function; the caller never reads -0x1a8 either.** Outputs: `0x1c` = R*n, `0x20` = R*hit + T, `*mat = face.material`.
  BSP leaf 0x8387cc9..0x8387cf6: face kept iff `dot(p1 - p0, n) < 0` (`test $0x5,%ah; je skip`), independent of doubleSided; the direction global is
  `p1 - p0` (0x8386f0f `fsubrs (%edx)`).
- `checkFaceAndEdgeCollision` 0x08374880, stack traced: `e = dot(p1 - v0, n)` (raw `de ec`, `de ea`, `dc ea` = st(i) := st(i) - st0);
  0x837498d `fucom st5(=0)`, `je 8374e10` = e > 0 -> false. `s = dot(p0 - v0, n)`; 0x83749f8 `fucom` (0 vs s), `test $1; je` = NOT(0 < s) -> false.
  `dn = dot(n, d)`; single-sided: 0x8374a46 `fucomp` (dn vs 0), `test $1; je` = NOT(dn < 0) -> false. 0x8374a63 raw `de fa` = st2 := st2/st0 = **t = s / (-dn)**.
  Axis choice |n.y| >= 0.7 -> (x,z); else |n.z| <= 0.3 -> (y,z); else (x,y). Success 0x8374cf2: `-0x9c = t - 1`; `*fa = [-0xa0] = e` (0x8374d39);
  `*fb = sqrt(dx^2+dy^2+dz^2) * (t-1)` (0x8374d73).
  **f2 = e = signed plane distance of the segment END (<= 0); f3 = (t-1)|d| (<= 0).**
- Depth: 0x8259e52 `flds -0x1a4` -> -0x1f0 = f2; A: 0x825a0ae `flds -0x1f0; fmuls shareA` -> impulseOn arg 4; B: 0x8259f96 `fmuls shareB`.
  Soldier A and i != 0 (0x825a0eb): `u = S - pos`; 0x825a117 `|u.y + off.y|` vs `[0x86cfc28]=0.65`: below -> `u.y = 0`; else **depth := f3** (0x825a1e5). CONFIRMED.
- Contact speed `nodeAr->+0x74(pos) - nodeBr->+0x74(pos)` (0x8259dc4 `fsubrs -0x128` = A - B); gate 0x8259e45 `|vRel|^2 > 0.1` -> handlers;
  A first `(B, vRel, n, pos - A.pos, matV, mat)` 0x825a28b, must return 1 (`dec %al; jne`), then B `(A, -vRel, n, pos - B.pos, mat, matV)` 0x825a381.
- Shares re-checked: `s = mBr/(mAr+mBr)`; > 0.95 -> (1, 0); < 0.05 -> (0, **+1.0**) 0x825a3d5; else (s, -(1-s)); no nodeAr -> (0, +1.0); no nodeB/nodeBr -> (1, 0).
  New facts: `StaticPhysicsNode::getMass` 0x825e910 returns `[0x86d180c]` = 1e12, so a static face side always lands in the (1, 0) snap; and nodeAr / nodeBr are
  dereferenced without a NULL test at 0x8259d65 / 0x8259da2 (getTangentSpeed), so a NULL ROOT node on either side would fault on the first hit - those two branches are defensive only. The `nodeB == NULL` (B's own node) case is survivable and gives (1, 0).

---------------------------------------------------------------------------------------------

## 5. Special materials - CORRECTED (incomplete)

What R3 states is right:
- `SimpleObject::handleCollision` 0x081dab40 (args: self, other, speed, normal, relPos, matSelf 0x1c, matOther 0x20): 0x81dacf7 `cmpl $0x63,0x20(%ebp)` ->
  0x81db03b `game->queryInterface([0x86b1cf8] = IID_IGameServer 0x1d4c1)->+0xf4(self, 1e10, -1, -1, -1, Pos3(0,0,0), -1, false, true)`, returns 1.
  I resolved the slot: GameServer's secondary vtable has vptr 0x871b574 (offset-to-top -0xf8 at 0x871b56c); 0x871b574 + 0xf4 = 0x871b668 =
  non-virtual thunk 0x8159960 to `GameServer::giveDamage` 0x814b2e0. So 99 = `giveDamage(self, 1e10)`. 0x81dad01 / 0x81dad0b: matSelf == 0x25 or
  matOther == 0x25 -> return 1, no armor / damage path.
- 90: `checkObjectVsObject` 0x8259d12 `cmpl $0x5a,-0x19c` + 0x825a394 A class == `[0x86c2b90]` = 0x9495 -> hit ignored; collider skip at 0x83ca46d.

What R3 misses (full-binary scan for `cmp $0x63 / $0x25 / $0x5a`, `SP/v3-matscan.py`):
1. **`PlayerControlObject::handleCollision` 0x08318b00 is slot +0x58 of the PCO vtable 0x0873eec0 - this, not SimpleObject's, is what a VEHICLE runs.**
   0x8318b12 `cmp $0x63,%esi` (matOther) -> same `giveDamage(self, 1e10)` and return 1. Then, if `other`'s template class == `[0x86c2bec]` =
   0x94af `CID_ObstacleTemplate`: `other->+0x9c(other, 0, 0)` and **return 0** (no physical response, 0x8318b5c..0x8318b6a). Otherwise tail-calls
   `SimpleObject::handleCollision` (0x8318b4a).
2. **`BFSoldier::handleCollision` 0x0827d3b0** (slot +0x58 of 0x0872f040): 0x827d3c8 `cmpl $0x63,0x20(%ebp)` -> 0x827dd60 same kill. It also tests
   matOther in **192..195** (0x827d437 `cmpl $0xbf; jle`, 0x827d440 `cmpl $0xc3; jg`) together with `other.resp->getCollisionGroups() & 4`
   (c_CGLadders) and then records other / material at soldier +0x3c8 / +0x3c4 - the ladder grab. Same ObstacleTemplate test at 0x827d415.
3. **`world::isSolidMaterial(int)` 0x08257010 = `mat != 90`**, called at 0x8257404 from `PointResponsePhysics::checkObjectVsObject` 0x08257030 - the path real
   (point) projectiles take; a material-90 hit is discarded there. The `ResponsePhysics` test R3 cites only covers a Projectile-template object that has a mesh response.
4. Also in SimpleObject::handleCollision and unmentioned: 0x81dad15..0x81dad3d - `other` template class == 0x9495 (Projectile) -> return 1 before any armor work.
Within functions whose names match Physics / Collision / GameServer / Projectile / Armor / Soldier / Material / geom / SimpleObject, 0x25 is compared only in SimpleObject::handleCollision (the scan is name-filtered, so this is not a whole-binary negative).

---------------------------------------------------------------------------------------------

## 6. Manager membership - CONFIRMED

- `addObject` 0x0825cfd0 / `removeObject` 0x0825d040: `resp->+0x64()` == `[0x86c2a9c]` = 0xc42d -> list `this+0xc`; == 0xc42e -> `this+0x14`; anything else: nothing.
  `StaticResponsePhysics::getClassID` 0x825f450 returns `[0x86c2aa4]` = 0xc42f -> in no list. `StaticResponsePhysics::checkObjectVsObject` 0x825f1a0 is empty.
- `BCompositeObject<IPlayerObject>::addChild` 0x08165900: 0x8165940 `mov 0x871dc1c` (symbol `world::responsePhysicsManager`), 0x816594e `call *0x10` = removeObject(child);
  reached on every path (the NULL-node branches print and rejoin at 0x816593d). `removeChild` 0x8165d53 `call *0xc` = addObject. Same pair in
  `BCompositeObject<ICompositeObject>` (0x81949ae / 0x8194db3) and `LodObject` (0x8216dca / 0x82174e5). Manager vtable 0x0872e2e0: +0xc add, +0x10 remove,
  +0x14 update, +0x18 reset, +0x1c resetCachedCollisionObjects.
- `Game::updateWorldCollision` 0x0805da00: `objectManager->+0x6c()`, `rpm->+0x18()`, `rpm->+0x14(dt, 0)` - CONFIRMED.

## 7. Not re-derived

F12 (soldier vs soldier arithmetic), F4 chain construction beyond `shouldCheckCollision` (which I did confirm, 0x82584e0), `simulateFrame` /
`simulatePlayerCollisions` ordering beyond `updateWorldCollision`, the on-disk BSP layout and the Sherman normal measurement, the 2-D inside test in
`checkFaceAndEdgeCollision`, the face-count comparison col0 vs col1 (my counts, all archives: vanilla col0 < col1 in 228 of 238).
