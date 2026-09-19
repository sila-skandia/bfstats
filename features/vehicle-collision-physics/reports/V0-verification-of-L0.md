# V0 - adversarial verification of L0 (object-vs-object response and collision damage)

Binary: `bf1942_lnxded.static`. Everything below was re-derived from `objdump -d`
(x87 stack tracked line by line; raw opcode bytes checked where the AT&T
reg-destination r-sense matters: `de f1` @0x825995f, `de e2` @0x8259a18, `d8 ea`
@0x8259972, `de f5` @0x8258c63, `de e1` @0x8259548, `dc ea`/`de ec` @0x8374951/42).
Constants read with `vt.rdf` / `vt.rd32`. The decompiles were only used to map
Ghidra's stack names onto `%ebp` offsets. Scratch files: `SP/v0-*.asm`.

## Verdict table

| Claim | Verdict | One-line reason |
|---|---|---|
| C1 mass share, snaps, sign, x f5 | CONFIRMED (+ f4/f5 identified) | general `shareB = -(1-shareA)`, snapped `shareB = +1.0`; f4 = dt, f5 = 0.5 or 1.0 |
| C2 per-contact flow | CONFIRMED, with one OMISSION | soldier vertices with index > 0 replace the normal and may switch the depth output |
| C3 impulseOn / setAdjust | CONFIRMED | signs and truth table exact |
| C4 solveImpulse | CONFIRMED, wording CORRECTED | the speed impulse is ALSO gated by `posAdjust != 0`, not only the position step |
| C5 rotation / inertia pairing | CONFIRMED | row2<->I_z<->inertiaModifier.z, row1<->I_y<->.y, row0<->I_x<->.x |
| C6 SimpleObject::handleCollision | CONFIRMED | swap `(other, self, ..., matOther, matSelf)` verified; `99` path is the giveDamage thunk |
| C7 1 s collision list | CONFIRMED | the 1.0 is an `fld1` literal, not a memory constant |
| C8 ObjectVsObject damage | CONFIRMED for vehicles; soldier V formula CORRECTED (L0 had attacker/victim swapped); same-team clause MISSING |
| C9 LandOrWater | CONFIRMED | cos^3 land, cos^2 water, target is the ROOT object |
| C10 giveDamage / calcDamage | CORRECTED (minor) | `id == -1` fills id and the *damage-type* int, NOT the team |
| C11 manager update | CONFIRMED | literals 0x3ee66666/0x3f666666/0x40000000 |

---

## C1 - CONFIRMED

`this=0x8, A=0xc, B=0x10, f4=0x14, f5=0x18`.
`-0x1c8` = rootA.queryComponent(0xc422), `-0x1cc` = rootB.queryComponent(0xc422),
`-0x1d0` = B.queryComponent(0xc422) (B's own node).

- 0x8259919 `rootNodeB->getMass()` -> `-0x1d4`; 0x8259930 `rootNodeA->getMass()` -> `-0x1dc`;
  0x8259947 rootNodeB mass again. 0x825994d-0x825995f: `flds -0x1d4; fxch; fadds -0x1dc; fld1; fxch st2; fdivp %st,%st(1)`
  (bytes `de f1` = Intel FDIVRP: st1 = st0/st1) => **shareA = massB / (massA + massB)**, 1.0 left on the stack.
- 0x8259972 `fsubr %st(2),%st` (`d8 ea`: st0 = st2 - st0 = 1 - shareA), stored `-0x1d8`;
  0x8259980 `xorb $0x80,-0x1d5(%ebp)` flips the sign bit of that float => **shareB = -(1 - shareA)**.
- 0x8259987 `fucompp` (st0 = shareA vs st1 = [0x86d16cc] = 0.95), `test $0x45; jne 825a3be`:
  falls through only when shareA > 0.95 -> `fstps -0x1d4` stores the leftover 1.0, `movl $0,-0x1d8` => (1, 0).
- 0x825a3be: `flds 0x86c08a8` (0.05); `flds -0x1d4`; `fxch`; `fucompp` (0.05 vs shareA); `jne 825a3ea`
  = NOT(0.05 > shareA) -> keep general values. Otherwise `fldz; fxch; fstps -0x1d8` (stores the leftover **+1.0**),
  `fstps -0x1d4` (0) => **(shareA, shareB) = (0, +1.0). The positive sign is real.**
- 0x825a415 (rootNodeA == NULL): `-0x1d4 = 0`, `fld1 ... fstps -0x1d8` => (0, +1.0).
  0x825a3f1 (B's node or rootNodeB NULL): (1.0, 0), B speeds zeroed.
- 0x82599a4-0x82599d2: both multiplied by `0x18(%ebp)`; every path joins there.

Consequence (inferred, see C3 signs): in the two `+1.0` cases B receives A's response direction
(pushed along +n, toward A) - opposite to the general branch. Needs massB < massA/19 with the light
object owning the faces, or a root A without a node; rare, but it is what the binary does.

**f4 and f5** (call sites in `checkObjectVsObjects` 0x0825d820; `0xc(%ebp)` there is its `float dt`):
every call pushes `dt` as the 4th float (0x825dd29/0x825dd47/0x825ddc8/0x825ddea `mov 0xc(%ebp)`), and a
literal 5th float: `push $0x3f000000` (0.5) at 0x825dd31, 0x825dd42, 0x825ddce, 0x825dde5, or
`push $0x3f800000` (1.0) at 0x825dd61, 0x825dd7d, 0x825de1c. Inside 0x08259690 f4 only scales
`(vA - vB)` into a per-tick relative displacement (0x8259a29-0x8259a3e). Selection, with
rA = root(obj).getBoundingRadius (`-0x178`), rO = root(other) radius (`-0x1a8`), k = [0x86c08ac] = 0.25:
- other's response class == 0xc42f (StaticResponsePhysics; tested first, 0x825dcce): `obj.resp->check(obj, other, dt, 1.0)` only (0x825de11).
- obj's response class == 0xc42f (`-0x191`, 0x825dcda): `other.resp->check(other, obj, dt, 1.0)` only (0x825dd5c).
- radii within a factor 4 (`min > 0.25*max`, 0x825dcf1-0x825dd0d / 0x825dd93-0x825ddb0) and neither root is a
  BFSoldier: **both directions, each with 0.5**. If one is a soldier, the soldier is the vertex owner, 1.0.
- otherwise the smaller-radius object is the vertex owner ("A"), 1.0 (soldier still forced to be A).
So f5 is a "this test's weight": 0.5 when the pair is tested both ways, 1.0 when tested one way.

## C2 - CONFIRMED, one omission

- lod: 0x8259735 `flds 0x86c0304` (4.0) `fucompp; je` => 4.0 > rootA radius -> lod 1; else A class == 0x9493 -> 1; else 0.
- count: `getVertexCollision(0)` 0x82596f8, `->+0x18` count; 0x8259ba5 `cmp $3; jg` else count = 1.
- `getDistanceToGeometry` (collider vtable +0xc, 0x8259d04) args: (collider, 0, B.absTransform, &origin `-0x158`,
  &vec `-0x178`, &normal `-0x48`, &hit `-0x28`, &f1 `-0x1a8`, &f2 `-0x1a4`, &f3 `-0x1a0`, &faceMat `-0x19c`).
  The segment is NOT the vertex's own sweep: origin = `posRootA - (vA - vB)*dt` (0x8259b0f-0x8259b86) and
  vec = `R_A*v + (posA - posRootA) + (vA - vB)*dt` (0x8259be9-0x8259c90), i.e. from root A's previous position
  (in B's frame) to the vertex's current position.
- 0x8259d12 `cmpl $0x5a` + 0x825a394 class == [0x86c2b90] = 0x9495 -> skip. vertexMat = u16 at vertex+0xc.
- relSpeed = rootNodeA.getTangentSpeed(hit) - rootNodeB.getTangentSpeed(hit): 0x8259d76 / 0x8259db3,
  `fsubrs -0x128` on B's value (memory form: A - B).
- 0x8259e3d: `flds 0x86b1ca0` (0.1); `fxch`; `fucompp`; `je 825a1f6` => **|relSpeed|^2 > 0.1** -> calls.
- 0x825a28b `A->+0x58(B, &relSpeed, &normal, &(hit-posA), vertexMat, faceMat)`; `dec %al; jne skip`.
  0x825a381 `B->+0x58(A, &(-relSpeed), &normal (same, not negated), &(hit-posB), faceMat, vertexMat)`; `dec %al; jne skip`;
  then `jmp 8259e52` (response). Else-branch falls straight into 0x8259e52.
- impulseOn arg order (0x8259fd4 for B, 0x825a0e0 for A): `(this, &relPos, &speed, &normal, float depth, vertexMat, faceMat)`
  - same material order for both. A: gate `A->+0x60 != 0 && shareA != 0`, speed = shareA*relSpeed, depth*shareA.
  B: gate `-0x1d0 != 0 && shareB != 0`, speed = shareB*relSpeed, depth*shareB.
- **Depth selection.** Ghidra's `fStack_1a8` = `-0x1a4(%ebp)` = f2, `fStack_1a4` = `-0x1a0(%ebp)` = f3
  (Ghidra names are off by 4 from %ebp). 0x8259e52 `flds -0x1a4` => depth = f2 always, EXCEPT:
- **OMITTED by L0 (0x825a0eb-0x825a1f1):** if A is a BFSoldier and the vertex index != 0:
  `d = originPrevRoot(-0x188..) - hit`; normal := (d.x, d.y, d.z); if `|d.y + vec0.y(-0x194)| < 0.65` ([0x86cfc28])
  then normal.y := 0 (depth stays f2) else depth := f3 (0x825a1e5). The normal is then normalised
  (zeroed if its length^2 < 1.19e-7). So soldier side vertices push horizontally away from the contact.
- What the floats are (read in `GridCollisionLeaf::checkCollisions` 0x083c01e0 and `checkFaceAndEdgeCollision`
  0x08374880, not fully traced): f1 = vec . faceNormal (0x83c0652-0x83c0670, never read by the caller);
  f2 = `(segmentEnd - faceV0) . faceNormal` (0x8374935-0x8374991), and a hit requires it NOT > 0
  (`je 8374e10` -> return 0), so **"depth" is a signed, non-positive distance**; f3 = |segment| * (t - 1)-style
  value along the segment (0x8374d51-0x8374d75). With depth <= 0, `-depth*n` pushes A out along +n.

## C3 - CONFIRMED

- 0x825891d-0x8258942: `-speed` built (fchs / xor 0x80000000). 0x8258945-0x8258962 n.n; `fucom %st(4)` vs 0,
  `jne 8258c47`. 0x8258c47-0x8258c63: `-(speed.n)`, `fdivp %st,%st(5)` (`de f5`: st5 = st0/st5) => k = -(s.n)/(n.n);
  candidate = k*n. n.n == 0 -> candidate 0 (0x8258976-0x825897e).
- 0x8258981 `flds 0x18(%ebp); fchs` then three multiplies => posCandidate = -depth*n. Accumulators `+0x14..` (pos),
  `+0x2c..` (speed), one `setAdjust` per component.
- `setAdjust(float& acc, float cand)` 0x0825cec0, exact table: acc == 0 -> acc = cand (0x825ced7->0x825cf27);
  acc > 0 & cand > 0 -> max (0x825cef1-0x825cefc); acc > 0 & cand <= 0 -> acc + cand (0x825cf04);
  acc < 0 & cand < 0 -> min, i.e. larger magnitude (0x825cf1b-0x825cf21 -> 0x825cef7); acc < 0 & cand >= 0 -> acc + cand (0x825cf23).
- Running averages `(avg*N + x)/(N+1)` for normal +0x68, relPos +0x8c, speed +0x74; `+0xa4 = N+1` (0x8258b4b).
- `+0xa8/+0xac/+0xb0 = ([mm +0x58|+0x5c|+0x60](mat1) + same(mat2)) * [0x86b05e8]=0.5`, plain overwrite.
- grip: `[+0xb4] = ([+0xb4] & 0x80) | getPermanentGrip()`; getPermanentGrip returns the whole byte +0xb5.
- root copy: `getRootResponse()` (+0x80) non-null and != this -> `root->getPositionalAdjusts()` (+0x7c = this+0x14) copied to +0x20.

## C4 - CONFIRMED; wording correction

- Factor (0x82590c8-0x8259122, and 0x8258eaa-0x8258f07 for a child): `speedAdjust * [0x8716b5c g_simulationFps = 30.0]
  * (1 + [this+0xac]) * [0x86b05e8 = 0.5]`. Call `*0x68(%eax)` on the node; `vt.py 0x0872df00` row +0x068 =
  `PhysicsNode::addAccelerationAtAbsolutePosition`. Args (node, &(node.getAbsolutePosition() + [this+0x8c]), &accel).
- **Correction to L0's reading:** in BOTH the root path (0x8258ff1-0x8259021 `je 82594c6`) and the child path
  (0x8258dd9-0x8258e09 `je 8258fb2`) an all-zero positional adjust jumps straight to the zeroing block, skipping the
  acceleration as well. So: `if (posAdjust != 0) { pos += posAdjust; [soldier/projectile extras]; addAcceleration(...) }`.
- Child part: position += on `root->+0x60` (0x8258e4e), acceleration applied to that root node (0x8258f75) but the
  application point is `paramNode.getAbsolutePosition() + avgContactRelPos` (0x8258f21 uses 0xc(%ebp)).
- Spring (class [0x86c2b54] = 0x9481, 0x82594f0): `d = posAdjust.n - rootCopy.n` (0x8259548 `de e1`: st1 = st0 - st1),
  clamp: `0 > d` -> 0 (0x825954c-0x8259553), `d > 1` -> 1 (0x825955f-0x8259566); `paramNode.pos += d*n` if non-zero; no speed change.
- Projectile: pitch `+10 * clamp(n.row2, -1, 1)`, roll `-10 * clamp(n.row0, -1, 1)` ([0x86b9314] = 10, [0x86b05ec] = -1;
  `fchs` at 0x8259342); `roll`/`pitch` -> `rotateAboutLine` -> `rotateZDeg`, so degrees. Avg contact pos zeroed
  for soldier and projectile from the static zero vector 0x87dbf10.
- Zeroing at 0x8258f86: +0x14.., +0x20.., +0x2c...

## C5 - CONFIRMED

- 0x08255110: parent (`+0x18`) non-null and byte +0x91 -> forward to `parent->+0x68`. Else `+0x28 += a`;
  `R = pos - nodePos - [+0x70]`; cross product operands checked (`de e2`, `de e1`, and `fsubrp` = Intel FSUBP at 0x82551f0):
  `(Ry*az - Rz*ay, Rz*ax - Rx*az, Rx*ay - Ry*ax)` = R x a, added to +0x34.
- `getGeometryInertia(geom, p1, p2, p3)` 0x08253930: box = `geom->+0x1c` (getBoundingBox), D = box[0xc..] - box[0..];
  first store goes through `mov 0x14(%ebp),%eax` (p3) = (DY^2+DZ^2)/3 = I_x; then p2 (0x10) = (DZ^2+DX^2)/3 = I_y;
  then p1 (0xc) = (DX^2+DY^2)/3 = I_z. [0x86d1390] = 0.33333334. **The out-params are in z, y, x order.**
- Call site 0x8253e80-0x8253e96 pushes `&-0x184, &-0x180, &-0x17c, geom` => `-0x17c` = I_z, `-0x180` = I_y, `-0x184` = I_x.
  Axis blocks: row `mat+0x20` with `[node+0x84]*[-0x17c]` (0x8253fa2-0x8253fba); row `mat+0x10` with `[+0x80]*[-0x180]`
  (0x825407f-0x8254097); row `mat+0x00` with `[+0x7c]*[-0x184]` (0x8254160-0x8254176). `fdivp %st,%st(2)` reversed =>
  scale = dt / (inertiaModifier_k * I_k). L0's pairing is right. Projection is `axis*(T.axis)/(axis.axis)`.
- T = [+0x4c] + [+0x34]. Extra guards L0 did not list: torque clamped to length 1000 when |T|^2 > 1e6 (0x8253b00-0x8253b2f),
  rot friction zeroed when |f|^2 > 40000, non-finite inputs zeroed. Fallback (no geometry, or object flag byte +7 & 0x4):
  `dOmega = T * (dt / [0x86d1398] = 0.0314)` (0x8253c46-0x8253c4f), zeroed if |dOmega|^2 > 1e6. No mass anywhere.

## C6 - CONFIRMED

- Params: self 0x8, other 0xc, speed 0x10, normal 0x14, relPos 0x18, matSelf 0x1c, matOther 0x20 (from C2: A gets
  (vertexMat, faceMat), B gets (faceMat, vertexMat)).
- 0x81daeca-0x81daeee pushes `matSelf(0x1c)` last, then `matOther(0x20)`, relPos, normal, speed, `self(0x8)`, `other(0xc)`, game
  => **`game->+0x34(other, self, speed, normal, relPos, matOther, matSelf)`**. Projectile self (0x81daf09): `+0x30` unswapped.
  `GameServer::handleCollision` 0x08156020 is a tail-jump: arg1 != NULL -> `handleCollisionObjectVsObject` with the same
  args, else `handleCollisionLandOrWater`. So in 0x081551c0 **obj1 (0xc) = the OTHER object = "attacker", obj2 (0x10) = self =
  "victim"**, mat1 (0x20) = attacker's contact material, mat2 (0x24) = victim's. L0's labels are correct.
  Terrain passes other = NULL (`push $0x0` at 0x825acea in checkVsTerrain).
- `matOther == 99`: `game->queryInterface([0x86b1cf8] = 0x1d4c1)->+0xf4(self, 1e10 (0x501502f9), -1,-1,-1, (0,0,0), -1, 0, 1)`;
  that slot in GameServer's secondary vtable (header 0x871b56c) is the non-virtual thunk 0x08159960 to `GameServer::giveDamage`.
- 0x25 checks, projectile `other` -> return 1, Armor walk with `queryComponent(0xc4a4,0xc4a4)`, `+0xe8` collision (sets +0x129),
  `+0x60` setLastHitMaterialIndex(matOther), `+0x12c` isInColList, `+0x120` addColObject, `+0xc8` isDestroyed -> self+0x100,
  `+0xf8` setLastCollisionHeight(pos.y): all as claimed (0x81dae38-0x81dae9e). Return-0 path at 0x81dafbb-0x81dafc5 exists
  (root held by an ObjectSpawner whose root is `other`'s root).
- PCO 0x08318b00: 99 -> same giveDamage thunk, returns 1 without calling the base; other's class == [0x86c2bec] = 0x94af
  (= `ObstacleTemplate::getClassID`) -> `other->+0x9c(0,0)` (= handleMessage) and return 0.

## C7 - CONFIRMED

- addColObject 0x08173740: `fld1` (literal, no memory constant); loop `fsubs 0x94(%ecx,%eax,4)` head..tail; `fldz; fucom; jne`
  => timer = max(0, 1.0 - sum). Stored at +0x94+4*tail, object at +0x54+4*tail, tail = (tail+1)&15; if tail == head, head++
  (so 15 live entries; a 16th drops the oldest).
- Armor::update 0x8172fed-0x817303f: `timer[head] -= dt`; only when `0 > timer` pop head and carry `-timer` into the next; every
  path through update reaches this block (0x8172fd3/0x8172fe0 branches rejoin at 0x8172fed; the only route to the single
  `ret` 0x81730a0 is via 0x8173043, which is entered only from this block).

## C8 - vehicles CONFIRMED; soldier branch CORRECTED

Verified product (0x8155752-0x815576a): `[-0x1f0] * [-0x1e4] * [-0x1f4] * [-0x1ec] * [-0x1e8]` =
`attackerArmor.getDamageMod()` (+0x3c on the Armor found from **obj1/attacker**, 0x8155680-0x81556ea; `fld1` if none, 0x8155ce9)
x angleFactor x `victimArmor.getSpeedMod()` (+0x4c on `-0x1b8`, the Armor found from **obj2/victim**) x V^2
x `mm->+0x4c(mat1, mat2)` x `mm->+0x54(mat1)`.
- angleFactor (0x81555b9-0x8155640): x = clamp(c*[0x86c08bc]=pi/2, -1000, +1000); `sinf`; victim `getAngleMod` (+0x44);
  `fsubrs 1.0` (memory form: 1 - am) => `am + (1 - am)*sin(c*pi/2)`.
- `MaterialManager::getDamageMod(a, b)` 0x08175040: `getCell(matPtr(a)->+0x4, matPtr(b)->+0x0)`; `getCreateCell()` keys the same
  table as (attGroup this+0x1c, defGroup this+0x18), so **first argument = attacker material, second = defender**.
  Pushed as (0x20 = matAttacker, 0x24 = matVictim).
- 0x815585a: `fld1; fxch; fucom; je` => damage > 1.0 strictly; giveDamage via `*0x15c` on `this`'s vtable with
  (victimArmor->getObject(), dmg, id, team, -1, (0,0,0), mat2 = matVictim, 1, 1).
- id/team: root1's IPlayerControlObject (0xc4c5; sub-vtable +0xc getOccupingPlayer, +0x18 getLastOccupidePlayer,
  +0x1c getLastOccupideTime, +0x74 getTeam). No occupant: last id kept only if `2.0 > mWorldTime - lastTime` (0x8155fa6-0x8155fd3).
- **Missing from L0 - same-team clause (0x81555ad-0x8155ed1):** if `victimRootPCO->getTeam() == attacker player's team` and both
  objects have nodes, both positional speeds are projected on the `speed` direction; if |victim proj| > |attacker proj| the
  attacker id and team are reset to -1 (the friendly victim drove into the "attacker": no TK attribution). Any victim type.
  (The victim root is dereferenced without a NULL check at 0x81555a4 - it is assumed to be a PCO.)

**Soldier victim (obj2 class 0x9493), exact form:**
```
if (8.0 > |speed|) return                                   // 0x8155a10-0x8155a25, [0x86c08c0]
if (attacker.+0x60 && victim.+0x60):                        // else V' = |speed| (attacker node NULL)
    pa = |proj_speedDir(attackerNode.positionalSpeed)|      // -0x1cc
    pv = |proj_speedDir(victimNode.positionalSpeed)|        // -0x1c8
    V' = pa + max(pv - 8.0, 0)                              // 0x8155ba8-0x8155bdf (double 8.0 @0x86c0b88)
h  = victimArmor.getLastCollisionHeight() - victim.y - 1.0  // 0x815591b-0x8155925
af = angleFactor
if (h >= 1): af = (h >= 2) ? 1 : af + (1 - af)*(h - 1)      // 0x81559ca-0x8155a06, [0x86c08c4] = 2.0
h' = (h >= 1) ? h : 1
k  = max(h' * kitDamping, 1)                                // getDamageDampingFromActiveKitParts, 0x815593a-0x815594d
if (V' > 30) af = 1                                         // [0x86b01b4]
else if (V' > 10) af = af + (1 - af)*(V' - 10)/20           // [0x86b9314], [0x86c0314]
damage = af * speedMod * V'^2 * getDamageMod(m1,m2) * getDamageForMaterial(m1) * k^2   // 0x815596a-0x8155984
```
L0's tentative V had the roles reversed: the 8 m/s allowance is subtracted from the **victim (soldier)** projection, the
**attacker's** projection counts in full. The 8.0 floor tests the raw |speed|. **The soldier product has no
attackerArmor.getDamageMod factor** (it starts at `flds -0x1e4`, not `-0x1f0`). Same `> 1.0` gate and giveDamage call.

## C9 - CONFIRMED

- soldier: 0x8155189 `fsubs 8.0; fldz; fucomp` -> return if 0 > V-8; V := V-8 (used for V^2, the 10/30 tests and the effect).
- land (mat1 != 1): 0x8154a93-0x8154ab2 c*c*c; product `c^3 * speedMod*V^2 * getDamageMod(0x20,0x24) * getDamageForMaterial(0x20)`
  (0x8154c4f-0x8154c65), `> 1.0`, `giveDamage(ROOT(-0x184), dmg, -1,-1,-1, self.pos + relPos, matOther, 0, 1)`.
- water (0x8154e4f): c^2; needs `armor->+0x54` getDamageFromWater; no gate; pos (0,0,0), mat = 0x20 (= 1), bools (0, 1); target ROOT.
- soldier variants apply the identical h / k / 10-30 lerps to the c^3 or c^2 factor and multiply by k^2. No vehicle exclusion exists.

## C10 - CORRECTED (minor)

- `+0x58 == 1` gate, Armor walk, `calcDamage(obj, dmg, team, false)` then `_giveDamage`: confirmed.
- **Wrong in L0:** when id == -1 (0x814b4ef) the code sets `id = armor->+0x78` (getLastHitPlayer) and the THIRD int
  `0x1c(%ebp) = armor->+0x88` (getLastHitDamageType). `0x18(%ebp)` (team) is not touched, so terrain damage keeps team -1.
- calcDamage 0x0814b520: `(unsigned)(team-1) > 1` -> unchanged (only teams 1/2 scale); victim root PCO `getTeam() == team` ->
  x [this+0x2c8] if the root is a soldier else x [this+0x2cc]; bool variant +0x2d0/+0x2d4. If `this+0x2ec` is set and the
  victim belongs to the local player the result is 0.

## C11 - CONFIRMED

`push 0, 0, 0x40000000, 0x3ee66666, 0x3f666666, 0x3ee66666, node, resp` at 0x825d11d and 0x825d599 =>
`addFriction(node, 0.45, 0.9, 0.45, 2.0, 0, 0)`. Flat list pass 2 (0x825d4d2-0x825d4e4): solveImpulse only. Root chains:
hasSeparatePhysicsUpdate -> skip, else solveImpulse + addFriction. Flags: bit 0 set or 0x200 clear -> skip. Note pass 1 checks
`isSleeping` only for the root-list chains (0x825d38c), not for the flat list.

## Notes for the implementer
1. "depth" handed to impulseOn is signed (<= 0); `posAdjust = -depth*n` is therefore along +n for A.
2. Apply the speed impulse only when the merged positional adjust is non-zero.
3. Pair weight: 0.5 when radii are within 4x (both directions run), else 1.0 with the smaller object as vertex owner.
4. Soldier collision damage: V' = attackerProj + max(victimProj - 8, 0); no attacker-armour damage modifier.
