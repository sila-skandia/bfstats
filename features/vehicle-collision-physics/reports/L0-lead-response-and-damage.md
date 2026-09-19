# L0 - lead's reading: object-vs-object response and collision damage

All addresses `bf1942_lnxded.static`. Source: Ghidra decompiles in `SP/decomp/`
and `SP/lead-decomp/`, spot-checked in objdump where marked **[objdump]**.
Everything not so marked is decompile-only and needs re-derivation.

## Claims

### C1. `ResponsePhysics::checkObjectVsObject(A, B, f4, f5)` 0x08259690 - mass share
`shareA = massB / (massA + massB)` (masses from the two ROOT objects' physics
nodes, `node->getMass()` vtable +0xa0), `shareB = -(1 - shareA)`.
If `shareA > 0.95` (const 0x86d16cc): `shareA = 1.0, shareB = 0`.
Else if `shareA < 0.05` (const 0x86c08a8): `shareA = 0, shareB = +1.0` - note
the POSITIVE sign, unlike the general case's negative `shareB`. **[objdump
0x8259908-0x82599a4 and 0x825a3be-0x825a3e5]**. Same `+1.0` when root A has no
physics node; when B (or root B) has no node `shareA = 1, shareB = 0`.
Both shares are then multiplied by the function's 5th argument (`0x18(%ebp)`).

### C2. checkObjectVsObject - per-contact flow
For each of A's collision vertices (count from `getVertexCollision(0)`; if the
count is < 4 only one vertex is tested), a segment is tested against B's
`getFaceCollision(lod)` collider (`lod = 1` if root A's `getBoundingRadius()`
< 4.0 or A's template is BFSoldier, else 0). On a hit (and not
`faceMaterial == 0x5a && A is a Projectile`):
`relSpeed = rootNodeA.getTangentSpeed(hit) - rootNodeB.getTangentSpeed(hit)`.
If `|relSpeed|^2 > 0.1`: `A->handleCollision(B, relSpeed, normal, hit - posA,
vertexMat, faceMat)`; only if that returns 1,
`B->handleCollision(A, -relSpeed, normal, hit - posB, faceMat, vertexMat)`;
only if that also returns 1 is the physical response applied. If
`|relSpeed|^2 <= 0.1` both calls are skipped and the response is applied
directly. Response: if A has a node and `shareA != 0`:
`responseA->impulseOn(hit - posA, shareA*relSpeed, normal, depth*shareA,
vertexMat, faceMat)`; if B has its own node and `shareB != 0`:
`responseB->impulseOn(hit - posB, shareB*relSpeed, normal, depth*shareB,
vertexMat, faceMat)`.

### C3. `ResponsePhysics::impulseOn(relPos, speed, normal, depth, mat1, mat2)` 0x08258900
`speedAdjust_candidate = -(speed . normal / normal . normal) * normal`
(zero if `normal . normal == 0`); `posAdjust_candidate = -depth * normal`. Each
component is merged into the accumulators (`+0x14` positional, `+0x2c` speed)
by `setAdjust` 0x0825cec0: accumulator zero -> take candidate; opposite signs
-> add; same sign -> keep whichever has the larger magnitude. Running averages
over the contact count (`+0xa4`) of normal (`+0x68`), speed (`+0x74`) and relPos
(`+0x8c`). `+0xa8/+0xac/+0xb0` = 0.5 * (material property of mat1 + of mat2)
for friction (`MaterialManager` +0x58), elasticity (+0x5c), resistance (+0x60) -
overwritten by each contact, not averaged across contacts. Low 7 bits of the
grip byte `+0xb4` reloaded from `getPermanentGrip()`. Finally copies the root
response's positional adjusts into `+0x20`.

### C4. `ResponsePhysics::solveImpulse(node)` 0x08258d30
- Object's template is SpringTemplate (0x9481): `d = clamp(posAdjust . avgNormal
  - rootPosAdjustCopy . avgNormal, 0, 1)`; node position += `d * avgNormal`.
  No speed change.
- Object is its own root: if posAdjust != 0: node position += posAdjust; then
  (BFSoldier: avg contact pos zeroed; Projectile: transformation pitched by
  `10 * clamp(avgNormal . row2, -1, 1)` and rolled by `-10 * clamp(avgNormal .
  row0, -1, 1)` degrees, avg contact pos zeroed); then
  `node->addAccelerationAtAbsolutePosition(nodePos + avgContactRelPos,
  speedAdjust * g_simulationFps * (1 + elasticity) * 0.5)`.
- Object is a child part: same two steps but applied to the ROOT object's
  physics node (`root->+0x60`).
- Then positional adjust, root copy and speed adjust are zeroed.

### C5. Rotation has no mass term
`PhysicsNode::addAccelerationAtAbsolutePosition` 0x08255110: if the node has a
parent and byte `+0x91` is set, forward to the parent; else `accel(+0x28) += a`,
`torque(+0x34) += (p - nodePos - comOffset(+0x70)) x a`.
`updateRotationalPhysics` 0x082539e0: `T = torque + rotFriction(+0x4c)`;
`dOmega = sum over body axes k of axis_k * (T . axis_k) * dt /
(inertiaModifier_k * I_k)` with `getGeometryInertia` 0x08253930:
`I_x = (DY^2 + DZ^2)/3, I_y = (DZ^2 + DX^2)/3, I_z = (DX^2 + DY^2)/3` from the
geometry's bounding box (full extents). Fallback when there is no geometry or
object flag byte +7 bit 0x4 is set: `dOmega = T * dt / 0.0314`.

### C6. `SimpleObject::handleCollision(self, other, speed, normal, relPos, matSelf, matOther)` 0x081dab40
`matOther == 99`: `gameServer->giveDamage(self, 1e10, ...)`, return 1. Either
material `== 0x25`: nothing, return 1. `other` is a Projectile: return 1
immediately. Otherwise find self's nearest Armor up the parent chain. No Armor:
only a Projectile self dispatches (`game +0x30`). With Armor: (spawner-held
self-collision case returns 0); `armor->collision()` (sets byte +0x129),
`armor->setLastHitMaterialIndex(matOther)`; if `!armor->isInColList(other)`:
`game->handleCollision(other, self, speed, normal, relPos, matOther, matSelf)`
(vtable +0x34; Projectile self uses +0x30 with unswapped args) then
`armor->addColObject(other)`; if `armor->isDestroyed()` set self byte +0x100;
`armor->setLastCollisionHeight(self.pos.y)`. Returns 1.
`PlayerControlObject::handleCollision` 0x08318b00 adds: `matOther == 99` kill;
`other` is an ObstacleTemplate (0x94af) -> `other->handleMessage(0,0)`, return 0.

### C7. The collision list is a 1-second rate limiter
`Armor::addColObject` 0x08173740 / `isInColList` 0x081744d0 /
`clearColObjectList` 0x081737b0: a 16-slot ring (objects at `+0x54`, delta
timers at `+0x94`, head `+0xd4`, tail `+0xd8`). A new entry's timer is
`max(0, 1.0 - sum of timers already queued)`, i.e. it expires 1.0 s after
insertion. `Armor::update(dt)` 0x08172f40 subtracts dt from the head timer and
pops entries as they go negative, carrying the remainder. So one Armor takes
collision damage from one given other object (or from terrain, `other = NULL`)
at most once per second.

### C8. `GameServer::handleCollisionObjectVsObject(this, attacker, victim, speed, normal, relPos, matAttacker, matVictim)` 0x081551c0
`c = |unit(speed) . unit(normal)|`, `V = |speed|`. Victim's nearest Armor; none
or `isDestroyed()` -> only `playCollisionEffect` (if
`getEffectTemplate(matAttacker, matVictim, c)` non-null) and return. Same root
-> return. Non-soldier victim:
`damage = attackerArmorDamageMod * angleFactor * speedMod * V^2 *
getDamageMod(matAttacker, matVictim) * getDamageForMaterial(matAttacker)` with
`angleFactor = angleMod + (1 - angleMod) * sin(min(c * pi/2, 1000))`,
`speedMod`/`angleMod` from the VICTIM's Armor (+0x4c / +0x44),
`attackerArmorDamageMod` = attacker's nearest Armor `getDamageMod()` (+0x3c) or
1.0 if it has none. Effect is played, then if `damage > 1.0` **[objdump
0x815585a-0x8155867]**: `this->giveDamage(victimArmor->getObject(), damage,
attackerPlayerId, attackerTeam, -1, (0,0,0), matVictim, 1, 1)` via GameServer
vtable +0x15c = 0x0814b2e0 **[objdump 0x8155870-0x81558d6: receiver is
`0x8(%ebp)` = this]**. Attacker id/team: the attacker root's
PlayerControlObject's player, or its last driver if he left < 2.0 s of world
time ago.
Soldier victim (0x9493): return if `V < 8.0`; V is replaced by
`|victim speed along speed dir| + max(|attacker speed along speed dir| - 8, 0)`
style projections (exact form to be verified); fall-height factor
`h = lastCollisionHeight - y - 1`; `k = max(h' * kitDamping, 1)` with `h' = h`
if `h >= 1` else 1; angleFactor forced toward 1 as `h` goes 1 -> 2 and as V goes
10 -> 30; `damage = angleFactor * speedMod * V^2 * DamageMod * Damage * k^2`.

### C9. `GameServer::handleCollisionLandOrWater` 0x08154960 (other == NULL)
Soldier victim: `V -= 8.0`, return if negative. `matOther == 1` (water branch):
factor `c^2`, damage only if `armor->getDamageFromWater()` (+0x54), no `> 1.0`
gate, `giveDamage(root, dmg, -1,-1,-1, (0,0,0), 1, 0, 1)`. Otherwise factor
`c^3`: `damage = c^3 * speedMod * V^2 * getDamageMod(matOther, matSelf) *
getDamageForMaterial(matOther)` (soldiers additionally `* k^2` and the same
angle-factor lerps as C8), applied if `> 1.0` with the hit position and
`matOther`. **Vehicles are not excluded: a vehicle hitting terrain takes this
damage.**

### C10. `GameServer::giveDamage` 0x0814b2e0 / `calcDamage` 0x0814b520
giveDamage acts only when GameServer `+0x58 == 1`; resolves the target's Armor,
fills attacker id/team from the Armor's last hit when id == -1, then
`_giveDamage(obj, calcDamage(obj, dmg, team, false), ...)`. `calcDamage` only
applies friendly-fire factors (GameServer +0x2c8 soldier, +0x2cc vehicle; +0x2d0
/ +0x2d4 for the splash variant) when the attacker's team equals the victim
PCO's team; otherwise the damage is unchanged.

### C11. `ResponsePhysicsManager::update(dt, obj)` 0x0825d0b0
Literal friction arguments: `addFriction(node, 0.45, 0.9, 0.45, 2.0, 0, 0)`;
flat list entries get `solveImpulse` only, root-list chains get `solveImpulse`
+ `addFriction`. Objects are skipped when flags bit 0 is set or bit 0x200 is
clear; nodes with `getHasSeparatePhysicsUpdate()` are skipped in the
all-objects mode and handled by the single-object mode.
