# Rigid-body collisions: contact, push, friction and crash damage

What happens when a jeep drives into a parked plane: how the engine finds the
contact, how it shares the push between the two bodies, how that becomes
linear and angular motion, what friction does afterwards, and what it costs
each of them in hit points.

Researched 2026-09-19 for the map viewer, whose ground vehicles treat every
other vehicle as a fixed wall (`viewer/ground.js`, the `sweepSphere` hull
check) and whose `vehicle-damage.js` was written to the old conclusion that a
collision never costs hit points. **That conclusion was wrong** (§9).

All addresses are `bf1942_lnxded.static` unless marked *client*. The server is
the authority for the simulation and the only side that applies damage; the
client runs the same contact and response code for every vehicle (§11). A lead
reading and five research tracks read the code; the lead's and four of the
tracks were each followed by an independent verifier that re-derived the claims
from `objdump`, the client track was spot-checked against the live binary, and
the integrator was additionally run as real machine code under an emulator
against a model (§4). Anything that did not get that treatment is marked
*read* or *inferred* where it appears. Reports and verdicts:
[`features/vehicle-collision-physics/`](../../vehicle-collision-physics/README.md).
Addresses are in [symbols.json](../symbols.json) (`./xref.py list collision`).

Notation: `dt` = 1/30 s, the fixed tick ([physics.md](physics.md) §3). `g` =
−14.73. Matrices are row-vector: rows 0, 1, 2 of an absolute transformation are
the body's X, Y, Z axes in world space, row 3 the position.

---

## 1. The whole story in one paragraph

Every tick, after all bodies have integrated, each awake mobile body tests the
**vertices of its coarse collision mesh** against the **faces of nearby
bodies' collision meshes**. Each hit is reported to both objects'
`handleCollision` — which is where **damage** is computed, from the relative
speed squared, the victim's `speedMod`/`angleMod` and a material-pair table,
at most once per second per pair — and then turned into a **positional
push-out** and a **cancellation of the closing velocity**, split between the
two bodies by the inverse ratio of their **masses**. The velocity change is
not applied directly: it is posted as an acceleration *at the contact point*,
so next tick's integration turns it into linear velocity and, through the lever
arm, into spin. Rotation uses a box-shaped inertia from the mesh bounds times
`inertiaModifier`; **mass never enters rotation**. A friction pass then asks,
per touching part, for the velocity change that would stop the contact patch
sliding, clamps it to a Coulomb budget proportional to the contact normal's
**Y**, and posts that too. A parked, sleeping plane is woken by the contact and
starts moving two ticks after the touch.

---

## 2. One tick

`GameServer::simulateFrame(dt)` `0x0815c2a0`; client twin
`GameClient::simulateFrame` *client* `0x004b6cb0`.

```
1  simulatePlayersUpdate        one buffered PlayerInput per player; handleUpdate on the
                                player's vehicle tree (controls only, no forces)
2  objectManager.updateObjects  handleUpdate on everything else
3  simulatePlayersPhysics       per occupied vehicle: performMobilePhysicsUpdate 0x08147470,
                                children first, then the root -> PhysicsNode::updatePhysics
4  physicsNodeManager.update    every other registered mobile node, reverse creation order
                                (children sit ahead of their root: addPhysicsNode is a push_front)
5  rpm.resetCachedCollisionObjects(); Game::updateWorldCollision 0x0805da00:
       objectManager.updateObjectsInGrid(); rpm.reset()  (++collisionCheckedCounter);
       rpm.update(dt, NULL)      0x0825d0b0 - every body NOT driven by a player
6  rpm.resetCachedCollisionObjects(); simulatePlayersCollisions 0x0815c140:
       per occupied vehicle rpm.update(dt, vehicle), then its children
7  game logic
```

`rpm` is the `responsePhysicsManager` singleton (`0x0871dc1c`; vtable
`0x0872e2e0`: `+0x0c` addObject, `+0x14` **update**, `+0x18` reset, `+0x1c`
resetCachedCollisionObjects. The two `+0x1c` calls the corpus had recorded in
`simulateFrame` without a name are the cache reset; detection and resolution
are `+0x14`, reached through `updateWorldCollision` and the per-player pass).

So within a tick: **forces accumulate, then the root integrates, then contacts
are detected and resolved.** Engines, wings, springs and floats add their
accelerations to the root inside their own `updatePhysics`, in the same pass as
and before the root's.

`rpm.update(dt, NULL)` is two passes over its lists (`+0x0c` mesh bodies, roots
only, each walked through its `getNextToCheck` chain of collidable child parts;
`+0x14` point bodies — projectiles; static objects are in neither list):

- **detect**: `checkObjectVsObjects(dt, part)` then `checkVsTerrain(dt)`, for
  every part whose node is awake and not player-driven;
- **resolve**: `solveImpulse(node)` then `addFriction(node, …)` for every mesh
  part not player-driven — **with no sleeping test**, which is what lets an
  awake attacker move a sleeping victim. Point bodies get `solveImpulse` only.

`hasSeparatePhysicsUpdate` (node byte `+0x90`) is an **occupancy** switch, not a
network one: `GameServer::enterVehicle` → `disablePhysics` `0x08147730` sets it,
`exitVehicle` → `reenablePhysics` `0x08147680` clears it. A vehicle with a
driver leaves steps 2, 4 and 5 and is handled once per player input in steps 1,
3 and 6 by the single-object form `rpm.update(dt, vehicle)`. A player whose
input buffer is empty is simulated with an all-zero input, so an occupied
vehicle is integrated and collided every tick; only a connected-but-not-ready
client is skipped. (Game status 4 skips steps 2–6 altogether.)

**Latency.** `solveImpulse` moves the position immediately, in step 5 or 6 of
tick N, and posts the velocity change into the acceleration accumulator, which
the next `updatePhysics` consumes — tick N+1. Impulses land one tick late by
design.

---

## 3. What a body is

Only the **root** object's `PhysicsNode` holds state and integrates. Every
non-root node zeroes its own speeds and accumulators each tick and copies the
root's sleepiness (`PhysicsNode::updatePhysics` `0x082543d0`; *client*
`0x00540920`). Child nodes exist so that engines, wings and springs have
somewhere to run their `updatePhysics`; they address the root directly.
(physics.md §3 used to say a "+0xcc predicate" hands a child's force to the
root. `+0xcc` is `isSleeping`; nothing is handed over.)

`PhysicsNode` (vtable `0x0872df00`, *client* `0x008f7218`, same slots):

| offset | field | | offset | field |
|---|---|---|---|---|
| `+0x10` | positional speed `v` | | `+0x64` | friction sample count |
| `+0x1c` | rotational speed `ω`, **world axes**, rad/s | | `+0x70` | centre-of-mass offset |
| `+0x28` | acceleration accumulator | | `+0x7c` | inertiaModifier x, y, z |
| `+0x34` | torque accumulator (per unit mass: `r × a`) | | `+0x90` | hasSeparatePhysicsUpdate |
| `+0x40` | positional friction accumulator | | `+0x91` | forward-to-parent byte (1 by default, 0 on springs) |
| `+0x4c` | rotational friction accumulator | | | sleepiness (see §4.3) |

Which node class an object gets is decided by template flag byte `+0x70`
(`SimpleObjectTemplate::setPhysicsNodeComponent` `0x081dd490`,
`setResponsePhysicsComponent` `0x081dd1d0`):

| `.con` | bit | node | response |
|---|---|---|---|
| (neither) | | `StaticPhysicsNode` — every adder a no-op | `StaticResponsePhysics` — never the vertex side, in no manager list |
| `hasMobilePhysics 1` | 0 | `PhysicsNode` | `ResponsePhysics` (CID `0xc42d`) |
| `hasPointPhysics 1` | 3 | `PointPhysicsNode` | `PointResponsePhysics` (`0xc42e`) — §10 |

Authored data and engine defaults (template constructor `0x081dbc70`, printed
back by `makeScript` `0x081dc190`):

| `.con` word | default | reaches |
|---|---|---|
| `ObjectTemplate.mass` | **1.0** | `setMass` — used **only** for the collision share (§6.1) and drag |
| `ObjectTemplate.inertiaModifier x/y/z` | 1/1/1 | §4.2. Authored on every vanilla aircraft, on no land or sea vehicle |
| `ObjectTemplate.drag` | 0 | physics.md §3 |
| `ObjectTemplate.centerOfMassOffset` | 0/0/0 | authored by no vehicle in any installed mod checked |
| `ObjectTemplate.hasCollisionPhysics` | 0 | template bit 1; presumed to become object flag `0x200`, without which a body is not tested at all (the derivation is unread — see Still open) |
| `ObjectTemplate.speedMod` | **0.05** | `Armor::getSpeedMod` — §9 |
| `ObjectTemplate.angleMod` | **0.0** | `Armor::getAngleMod` — §9 |
| `ObjectTemplate.damageMod` | **1.0** | `Armor::getDamageMod` — §9 |
| `ObjectTemplate.material` | | the Armor's material is the constructor's 0 regardless ([hitpoints-and-damage.md](hitpoints-and-damage.md) §1); collision materials come from the **mesh** |

`gravityModifier` is not copied by `setPhysicsNodeComponent`; engine, spring,
wing and float nodes copy none of mass, drag, inertia or centre of mass.

Vanilla numbers that matter (surveyed from the `.con` files; full tables in the
R4 report):

| | mass | inertiaModifier | speedMod | angleMod | HP |
|---|---|---|---|---|---|
| Willy, Kubelwagen | 2,500 | — | 1 | — (0) | 50 |
| M3A1, Hanomag | 15,000 | — | 2 | — | 100 |
| Sherman, PanzerIV | 25,000 | — | 1 | — | 100 |
| Tiger, T-34, M10 | 25,000 | — | 0.75 | — | 100–125 |
| fighters | 2,500 | e.g. Spitfire 0.85/0.833/0.84 | 2 | 1 | 100 |
| dive bombers | 3,000 | authored | 2 | 1 | 130 |
| B-17 | 25,000 | 0.6/0.6/0.3 | 2 | 1 | 450 |
| carriers / battleships | 25–35 million | — | — (0.05) | — | 500–600 |

---

## 4. The integrator

Verified by running lnxded's own code for the constructor, the accumulators,
`getTangentSpeed`, `rotateAboutLine` and `updatePhysics` under the Unicorn
emulator against a Python model, to float32 rounding, over random ticks and
every clamp and sleep edge (harness kept with the R2 report).

**A `PhysicsNode` takes one semi-implicit Euler step per tick.** The four
sub-steps in physics.md §3 belong to `PointPhysicsNode` only.

### 4.1 Accumulators

```
addAccelerationAtAbsolutePosition(p, a)   0x08255110   client 0x00540220
    acc  += a
    racc += (p − pos − comOffset) × a                  // SUM over callers
addFrictionAtAbsolutePosition(p, f)       0x08254e50
    fr   = (fr·n  + f) / (n+1)
    rfr  = (rfr·n + (p − pos) × f) / (n+1) ;  n += 1   // RUNNING MEAN; no COM offset in the arm
getTangentSpeed(p)                        0x08254b90   client 0x0053fe20
    = v + ω × (p − pos)                                // arm from the object ORIGIN
```

A child node with `+0x91` set forwards the acceleration and speed adders to its
parent; the friction adder is never forwarded.

### 4.2 The step — `updatePhysics` → `updatePositionalPhysics` `0x08253570`, `updateRotationalPhysics` `0x082539e0` (*client* `0x0053f940`, `0x005403b0`)

```
sleep bookkeeping (§4.3);  if asleep or not the root: zero everything, return (no gravity seeded)
box drag (physics.md §3)

if |acc|² > 1e6:   acc *= 1000/|acc|
if |fr|²  > 62500: fr = 0                              // dropped, not clamped
v   += acc·dt ;  v += fr·dt ;  pos += v·dt

if |racc|² > 1e6:  racc *= 1000/|racc|
Tpre  = racc + rfr
if |rfr|² > 40000: rfr = 0
Tpost = racc + rfr
(Ix, Iy, Iz) = getGeometryInertia(geom)                // 0x08253930, client 0x0053fc30
Δω  = proj(Tpre , Z)·dt / (inertiaModifier.z · Iz)     // Z uses Tpre: an over-limit rfr still acts about Z
    + proj(Tpost, Y)·dt / (inertiaModifier.y · Iy)
    + proj(Tpost, X)·dt / (inertiaModifier.x · Ix)     // X, Y, Z = rows 0, 1, 2 of the transform
ω  += Δω
if |ω|² > 1e-6: rotate the 3×3 rows about ω/|ω| by |ω|·dt   (Rodrigues; row 3 untouched)

acc = (0, g·gravityModifier, 0) ; racc = fr = rfr = 0 ; n = 0      // gravity seeds the NEXT tick
```

`getGeometryInertia` reads the object's own geometry bounding box, full extents
`DX, DY, DZ`:

```
Ix = (DY² + DZ²)/3     Iy = (DZ² + DX²)/3     Iz = (DX² + DY²)/3
```

That is four times a solid box's inertia per unit mass, and it is the only
inertia there is. **Mass never enters rotation**, there is no gyroscopic term,
`ω` lives in world axes and is not re-expressed as the body turns, and the body
turns about its **origin**, not its centre of mass. An object with no geometry
takes the fallback `Δω = (racc + rfr)·dt/0.0314`.

Consequences worth keeping in mind: a new or just-woken body gets no gravity in
its first integrated tick; the 1000 m/s² clamp applies to the *sum* of gravity,
thrust, springs and collision impulses, so one tick can change velocity by at
most 33.3 m/s.

### 4.3 Sleeping

`sleepiness` is a countdown. `isSleeping()` = `sleepiness <= 0`.
`setIsAwake()` `0x08255330` sets it to `mFramesBeforeSafeToSleep` = **100**
ticks (3.33 s); a negative value means "never wake" (the AI's
`disablePhysics`).

Each tick, on the root (soldiers excepted):

```
if      |acc|² >= 2.5  wake        // the accumulator as it stands before drag: gravity + springs + impulses
else if |v|²   >= 0.25 wake
else if |ω|²   >= 0.25 wake
else if sleepiness > 0: sleepiness -= 1
```

A free-falling body can therefore never sleep (|g| alone fails the first test);
a vehicle sleeps once its springs have cancelled gravity to within 1.58 m/s² and
it has been still for 100 ticks. A sleeping root zeroes its state every tick,
seeds no gravity and takes no drag; its springs and floats skip their force.

Other wakers: `ResponsePhysics::addFriction` when the averaged contact speed² >
0.1 (§8); `PhysicsEngine::updatePhysics` when |input| ≥ 0.05;
`handleExplosionOnObject` (unconditional); `PlayerControlObject::enter`;
`FireArms::Fire`. `solveImpulse` itself wakes nothing.

**A jeep rams a sleeping plane.** Tick N, step 6: the jeep detects the contact
and `impulseOn` loads both responses; only the jeep is resolved. Tick N+1, step
4: the plane is still asleep. Step 5, resolve pass: the plane gets
`solveImpulse` (position corrected, impulse posted) and `addFriction`, which
wakes it. Tick N+2, step 4: the plane integrates. Two ticks from touch to
motion; one if it was already awake. The first impulse is not lost: the
sleeping root is zeroed in step 4, *before* step 5 posts into it, and the wake
comes in the same visit (emulated on the server's own code by the verifier).
It **is** lost when the wake test fails — a contact slower than √0.1 = 0.32 m/s
— or while a spawner holds the object: then only the positional push-out
moves a sleeping vehicle.

---

## 5. Finding contacts

### 5.1 Broadphase — `getCollisionObjects(A, radius, dt)` `0x0825d5c0`

```
d = rootNode.getPositionalSpeed() · dt
candidates = grid sphere query at  A.pos − 0.5·d,  radius  |d|²·0.25 + 1.0 + rA
             restricted to ROOT objects with flags 0x2000200
```

(`|d|²`, not `|d|` — dimensionally odd, and what the code does.) The root
queries once per tick and its child parts reuse the list.

### 5.2 Pair filter — `checkObjectVsObjects(dt, A)` `0x0825d820`, *client* `0x00579820`

A is stamped with the tick's `collisionCheckedCounter`. For every candidate
root R and every part B in {R, R's collidable children}, the pair is skipped
when any of these holds:

1. same root (parts of one vehicle never collide with each other);
2. neither side is a mobile, awake body;
3. `B.flags & 1`;
4. **B already carries this tick's stamp** — B was processed as "A" earlier, so
   the pair was handled from the other side. This is the only de-duplication;
5. the two responses share a collision-group bit (`c_CGLandscape` 1,
   `c_CGStaticObjects` 2, `c_CGLadders` 4, `c_CGProjectiles` 8 — no vehicle or
   vehicle part is in any group, so this never filters a vehicle pair);
6. neither part is a root object (child part vs child part is never tested);
7. both part radii < 0.45;
8. bounding spheres, swept: `dist² > (rA + |vA|²·dt/4 + rB + |vB|²·dt/4)²`, with
   part positions and radii but **root** speeds;
9. both vertex sets have fewer than 4 vertices.

A collidable part (`shouldCheckCollision` `0x082584e0`) has object flag `0x200`,
a geometry, a non-empty vertex set and a face collider.

### 5.3 Who is the vertex side

```
B static:                                  A's vertices vs B's faces, weight 1.0
A static:                                  B's vertices vs A's faces, weight 1.0
root radii differ by more than 4× (or one is a soldier):
                                           the smaller (or the soldier) is the vertex side, weight 1.0
otherwise:                                 BOTH directions, weight 0.5 each
```

A jeep and a fighter are within 4×, so **both directions run in the same tick
and each contributes half**. The weight is the 5th argument of
`checkObjectVsObject` and multiplies both shares (§6.1); the 4th is `dt`.

### 5.4 Which meshes

A StandardMesh's collision layers load in file order into two parallel vectors
on the mesh template (`loadCollision` `0x083a6290`), so **`.sm` collision index
i is engine collision LOD i**. `getVertexCollision(lod)` `0x082587e0` and
`getFaceCollision(lod)` `0x08258730` select a layer (clamped to 0 when the file
has fewer).

- **Vertices always come from col0** — the coarse hull (Willy 16 vertices,
  Sherman hull 14).
- **Faces come from col1** when the *vertex side's* root bounding radius is
  < 4.0 m or it is a soldier; otherwise col0. Projectiles always ask for col1.
- Nothing on the server ever asks for a third layer, and no installed `.sm` has
  one (vanilla: 805 files with no collision, 520 with one layer, 210 with two).
  The "col0 projectile / col1 vehicle / col2 soldier" description in community
  tools does not describe BF1942.

The selected layer is stored on the **shared mesh template**, not the instance,
so two instances of one mesh colliding at LOD 1 also read A's vertices from
col1. A quirk to know about, not one to port.

A collision vertex is 16 bytes: xyz and a **u16 material** at `+0xc` (the "4th
float" of our reader). A face carries a u16 material too. The rest of each
layer's block, which `stdmesh.py` skips, is a serialised BSP with per-face
normals, `n = normalize((v2 − v0) × (v1 − v0))`.

### 5.5 Narrow phase — `ResponsePhysics::checkObjectVsObject(A, B, dt, w)` `0x08259690`, *client* `0x00574e30`

```
relV = rootNodeA.v − rootNodeB.v                     // linear only
S    = rootA.pos − relV·dt                           // one start point for the whole part
n    = vertex count;  if n < 4: n = 1                // a 3-vertex wheel is a single probe
for each vertex i:
    E   = A.pos + RotA · vertex_i                    // the vertex's CURRENT world position
    hit = facesB.getDistanceToGeometry(single-sided, B.transform, S, E − S, …)
```

So the probe is **a ray from where A's root origin was one tick ago (in B's
moving frame) to the vertex's present position** — an inside/outside test from
the body's centre outward, not the vertex's own path. The collider
(`SimpleCollisionMesh::getDistanceToGeometry` `0x083c9f70`) culls back faces,
walks the BSP, and returns the first face crossed from the start: world normal,
world hit position, the face's material, and two floats that are both ≤ 0 —
`f2` the end point's signed distance to the face plane (the **penetration
depth** used), `f3` minus the distance from the hit to the end along the ray.

Soldier vs soldier is a separate branch: when the two origins are within 1.0 m
(and their bounding boxes overlap vertically) they are pushed apart
horizontally to 1.0 m, the push split by their speeds along the separation
(read in the decompile only; signs not re-derived).

---

## 6. The response

### 6.1 Shares

```
s = massB / (massA + massB)                          // ROOT nodes' masses
s > 0.95:   shareA = 1      shareB = 0
s < 0.05:   shareA = 0      shareB = +1.0            // sic
else:       shareA = s      shareB = −(1 − s)
both × w                                             // §5.3
no node on A's root:  shareA = 0, shareB = +1.0 ;  no node on B:  shareA = 1, shareB = 0
```

A jeep against a Sherman: `s = 25000/27500 = 0.909` — the jeep takes 91 % of the
correction. A jeep against a carrier: snapped, the ship is immovable. A static
object's node reports a mass of 1e12, so against a building or a wreck the
same snap gives A everything.

**The `+1.0` is an engine slip.** With `impulseOn`'s conventions a negative
`shareB` pushes B away from A, which is right; the low snap writes `+1.0`
(`fldz; fxch; fstps` at `0x0825a3d5`), pushing a much lighter B *toward* a
vertex-side body more than 19× its mass. It rarely shows, because with such a
size difference the light body is normally the vertex side and gets
`shareA = 1` with the correct sign. Port `−1.0` unless bug parity is the goal.

### 6.2 Per hit

```
vRel = rootNodeA.getTangentSpeed(hit) − rootNodeB.getTangentSpeed(hit)
if |vRel|² > 0.1:
    if !A.handleCollision(B,  vRel, n, hit − A.pos, matVertex, matFace): skip response
    if !B.handleCollision(A, −vRel, n, hit − B.pos, matFace, matVertex): skip response
A.response.impulseOn(hit − A.pos, shareA·vRel, n, shareA·depth, matVertex, matFace)   // if A has a node, share ≠ 0
B.response.impulseOn(hit − B.pos, shareB·vRel, n, shareB·depth, matVertex, matFace)   // likewise
```

Below the 0.1 threshold the handlers are not called and the response always
runs: a resting contact costs no `handleCollision`. `handleCollision` is where
damage happens (§9); it returns 0 only in special cases (a spawner-held object
touching its holder; a vehicle or soldier touching an `ObstacleTemplate`, which
is messaged instead).

### 6.3 `impulseOn(relPos, speed, n, depth, mat1, mat2)` `0x08258900`, *client* `0x00574bb0`

```
speedAdjust ⊕= −(speed·n / n·n) · n                  // cancel the closing speed along the normal
posAdjust   ⊕= −depth · n                            // depth ≤ 0: push out along the normal
running means over this tick's contacts: normal (+0x68), speed (+0x74), relPos (+0x8c); count +0xa4
friction (+0xa8), elasticity (+0xac), resistance (+0xb0) = ½(value(mat1) + value(mat2))   // last contact wins
```

`⊕` is `setAdjust` `0x0825cec0` (*client* `0x005745b0`), per axis: empty → take
it; opposite signs → add; same sign → keep the larger magnitude. Many vertices
hitting one face therefore do not stack; opposing contacts cancel.

### 6.4 `solveImpulse(node)` `0x08258d30`, *client* `0x005765d0`

Only when `posAdjust ≠ 0`:

```
wheel (SpringTemplate): node.pos += clamp(posAdjust·n̄ − rootCopy·n̄, 0, 1) · n̄    // suspension only, no velocity
otherwise, on the ROOT's node (a child part's contact is applied to its root):
    pos += posAdjust
    addAccelerationAtAbsolutePosition(part.pos + avgContactRelPos,
                                      speedAdjust · 30 · (1 + elasticity) · 0.5)
then posAdjust = speedAdjust = 0
```

Integrated next tick, that acceleration is a velocity change of
`speedAdjust·(1 + e)/2`. Every vehicle and terrain material has elasticity 0
(§8), so **a contact removes half of the body's share of the closing velocity
per tick** and bodies do not bounce; the positional push-out, which is
immediate, does the rest. (Inferred, not read: for two similar-size bodies the
two test directions each carry weight 0.5 and `setAdjust` keeps the larger of
two same-sign contributions rather than adding them, so the velocity change is
a quarter of the share, not half.) Applied at the averaged
contact point, the same acceleration produces the torque `r × a` — a jeep
clipping a plane's wingtip spins it, scaled by §4.2's box inertia and
`inertiaModifier`, not by mass.

Projectiles that are mesh bodies are additionally pitched and rolled toward the
contact normal by up to 10° (that is how a bomb lies down).

---

## 7. Terrain — `checkVsTerrain` `0x0825a960`, *client* `0x00575cd0`

Skipped for responses in `c_CGLandscape`. The part's own **col0 vertices**
(one vertex if it has ≤ 3, five for a soldier; parts with more than 10 first
take a bounding-box early-out) are dropped onto the heightfield:

```
depth = vertex.y − terrainHeight(x, z)               // vertical; contact when ≤ 0
C     = (x, terrainHeight, z) ;  N = terrain normal
speed = rootNode.getTangentSpeed(C)
if |speed|² > 0.1: handleCollision(NULL, speed, N, C − pos, vertexMaterial, terrainMaterial)   // result ignored
impulseOn(C − pos, speed, N, depth, vertexMaterial, terrainMaterial)                           // always; implicit share 1
```

The push-out is `|depth|` along the sloped normal. Water produces no impulse:
the lowest tested vertex below the water level sets `underWater` on the part's
node (25× drag, physics.md §3) and sends a `handleCollision` with material 1
every tick.

---

## 8. Friction — `ResponsePhysics::addFriction` `0x0825b6e0`, *client* `0x00576c50`

Runs for every mesh part after `solveImpulse`, on the contact averages left by
`impulseOn` — terrain and object contacts alike. **The six float arguments the
manager pushes (0.45, 0.9, 0.45, 2.0, 0, 0) are never read.** There is no force
and no mass in this solver either: each touching part asks for a velocity
change and the root receives it.

```
authored grip has DummyGrip and EngineGrip (0x24): spin the wheel visually from the engine, return - no friction,
                                                   no sample in the mean (68 vanilla wheel springs)
no contact this tick, or authored grip 0:          clear the latch, return

μ = friction (+0xa8);  N = averaged normal (a mean of unit normals, not re-normalised);  g/30 = one tick of gravity
limKinetic = μ · N.y · 1.5·9.82/30          // = μ·N.y·|g|·dt; 1.5 × 9.82 = 14.73 is hard-coded, not read from getGravity()
limStatic  = 1.5 × limKinetic
V  = avgContactSpeed − surfaceSpeed ;  V.y += g/30        // next tick's gravity, so a held body does not creep
Vt = V − N·(V·N)/(N·N)

resistance > 0:   root.addAccelerationAtRelativePosition(0, −resistance · Vt)          // SUMS over parts

wanted velocity change dV, by live grip (physics.md §6):
    EngineGrip    dV = T − Vt,  T = the engine's surface speed along the wheel's forward axis, tangent to N
    RollGrip      dV = −(the component of Vt along the wheel's own axle)
    ContactGrip   dV = −Vt                                                             // every non-wheel part

latched static (bit 0x80):  |dV| > limStatic → latch breaks, F = dV scaled to limKinetic;  else F = dV in full
not latched:                |dV| > limKinetic → F = dV scaled to limKinetic;               else latch sets
root.addFrictionAtAbsolutePosition(part.pos + avgContactRelPos, F · 30)                // MEAN over parts

if |avgContactSpeed|² > 0.1 and root.sleepiness ≥ 0: root.setIsAwake()
clear the contact averages and the surface speed
```

What follows from it:

- **The power slide** (physics.md's open item): the clamp acts on the whole
  vector, a friction circle. A spinning driven wheel spends its budget
  longitudinally and has no lateral grip left; a rolling front wheel only ever
  asks for lateral correction and keeps its grip. There is no slip-angle curve
  anywhere.
- Because the friction accumulator is a mean over touching parts, a whole
  vehicle's maximum Coulomb deceleration is `μ·g·N.y` however many wheels
  touch.
- **The budget scales with the contact normal's Y, not with any normal force.**
  A side-on ram has `N.y ≈ 0`: the contact contributes no Coulomb friction at
  all (and, as a zero sample in the mean, *dilutes* the wheels' friction for
  that tick). Friction between two objects exists only for roughly horizontal
  contact faces — something standing on something.
- Object contacts feed the share-scaled **relative** velocity, so a light body
  standing on a heavy moving one is carried along. `setSurfacePositionalSpeed`
  is written only by `BFSoldier`.
- An empty aircraft's wheels are `c_PGFRollGripWhenOccupied`, rewritten every
  tick to ContactGrip while empty (physics.md §6). A parked plane stands on
  three static-latched contacts, and a ram has to break `1.5·μ·g·N.y` to slide
  it; an occupied one rolls freely along its wheels.

Material friction and resistance are authored only for the 16 terrain
materials (0 default 1.0/0.02, 1 water 0.1/0.1, grass 0.8/0.06–0.08, mud 0.5/0.1,
rock 0.6/0.01, paved road 1.1/0.01 …) plus grenades and stairs; every vehicle
and building material takes the `Material` defaults **friction 1.0, elasticity
0, resistance 0.01**. An *undefined* id falls back to material 0 instead, and
vanilla never defines 16–38: a Willy's wheels are material 37, so they carry
material 0's resistance 0.02. A jeep hull (45) on dry grass: μ = 0.9, resistance
0.035; its wheels: 0.04; vehicle hull on vehicle hull: μ = 1.0, resistance 0.01.

---

## 9. Crash damage

**A collision costs hit points — for vehicles, against other objects and
against the ground.** The 2026-09-17 round concluded the opposite, and the
2026-09-18 fall-damage correction fixed it for soldiers only while
misidentifying the receiver of the `*0x15c` call as `BFSoldier::handleDamage`.
The receiver is the **GameServer** (`mov 0x8(%ebp),%edx; mov (%edx),%ebx; call
*0x15c(%ebx)` at `0x08155875`–`0x081558d6`), and slot `+0x15c` of its vtable
(`0x0871b0e0`) is `GameServer::giveDamage(IObject*, float, int, int, int, Pos3,
int, bool, bool)` `0x0814b2e0`. It damages whatever object it is handed.

### 9.1 The path

`SimpleObject::handleCollision(self, other, speed, normal, relPos, matSelf,
matOther)` `0x081dab40` (`PlayerControlObject::handleCollision` `0x08318b00`
and `BFSoldier::handleCollision` `0x0827d3b0` wrap it):

- `matOther == 99` → `giveDamage(self, 1e10, …)`: the kill material (275 vanilla
  faces, the insides of closed buildings).
- either material `== 37` → no damage dispatch at all (119 vanilla faces: some
  wheels and track wheels). Physical response only.
- `other` is a projectile → return 1; the projectile's own handler does the
  damage.
- (`BFSoldier::handleCollision` also tests face materials 192–195 with
  collision group `c_CGLadders`: the ladder grab.)
- find self's nearest Armor up the parent chain; none → nothing. Otherwise
  `armor.collision()`, `armor.setLastHitMaterialIndex(matOther)`, and **only if
  `!armor.isInColList(other)`**:
  `game->handleCollision(other, self, speed, normal, relPos, matOther, matSelf)`
  (note the swap: the *other* object is the attacker), then
  `armor.addColObject(other)`.

`GameServer::handleCollision` `0x08156020` forwards to
`handleCollisionObjectVsObject` `0x081551c0` or, when `other == NULL`, to
`handleCollisionLandOrWater` `0x08154960`.

### 9.2 The rate limiter

`Armor::addColObject` `0x08173740` / `isInColList` `0x081744d0`: a 16-slot ring
of object pointers (`+0x54`) with delta timers (`+0x94`, head `+0xd4`, tail
`+0xd8`). A new entry expires **1.0 s** after insertion; `Armor::update(dt)`
`0x08172f40` counts the head down and pops it. So **one Armor takes collision
damage from one given other object — or from the terrain, which is the entry
`NULL` — at most once per second**, however many vertices touch and however
many ticks the contact lasts.

### 9.3 Object against object

```
c  = |unit(speed) · unit(normal)|            V = |speed|     (speed = the relative contact velocity of §6.2)
victim's nearest Armor missing or destroyed → collision effect only

angleFactor = angleMod + (1 − angleMod) · sin(c · π/2)                    // victim's Armor
damage = attackerArmor.damageMod (1.0 if it has none)
       × angleFactor
       × victimArmor.speedMod × V²
       × getDamageMod(matAttacker, matVictim)                            // the pair table, §9.4
       × getDamageForMaterial(matAttacker)

play getEffectTemplate(matAttacker, matVictim, c) at the contact
if damage > 1.0:  giveDamage(victimArmor.getObject(), damage, attackerPlayer, attackerTeam, …)
```

Both objects are victims of the same contact, each through its own
`handleCollision`, each with its own `speedMod` and `angleMod` and the *other's*
material as attacker. **Mass does not appear**: a Sherman and a Willy hitting
the same plane at the same speed do the same damage. The kill is credited to the
attacking vehicle's driver, or to its last driver if he left less than 2.0 s
ago; when the victim is on the attacker's team and was the faster of the two
along the contact direction, the attribution is dropped.

`angleMod` is why aircraft are fragile: with `angleMod 1` the angle factor is
always 1, so a glancing scrape costs a plane as much as a head-on hit, while a
land vehicle (`angleMod 0`) scales by `sin(c·π/2)` and loses almost nothing to
a shallow graze. Carriers and battleships author no `speedMod` and keep the
0.05 default.

A **soldier victim** takes a separate branch (run over by a vehicle):

```
if |speed| < 8: return
V' = |attacker's speed along the contact direction| + max(|soldier's| − 8, 0)
h  = lastCollisionHeight − y − 1
af = angleFactor;  h ≥ 1: af → 1 linearly as h goes 1 → 2;  V' > 10: af → 1 linearly as V' goes 10 → 30
k  = max((h ≥ 1 ? h : 1) · kitDamping, 1)
damage = af × speedMod × V'² × getDamageMod × getDamageForMaterial × k²      // no attacker damageMod
```

### 9.4 Materials

**Each side of a contact brings its own material**: the vertex side the u16 on
the collision *vertex* that hit, the face side the material of the *face* that
was hit. In every vanilla `.sm` a layer's vertex materials are a subset of its
face materials. Only the root of a vehicle carries an Armor, so every part's
contact resolves to the root's hit points.

`Bf1942/Game/materialManagerDefine.con` and `materialManagerSettings.con`
(inside `Archives/bf1942/Game.rfa` - a shallow `Archives/*.rfa` glob, which
`surveys/con_properties.py`'s template uses, misses them). The engine opens the
Settings file by name; its first line runs the Define file and 49 `run` lines at
its tail override the inline cells, so **run order is load-bearing** (the
inline terrain-vs-60 cell says 5; `PlaneArmor.con` overrides it to 0.01).
XPack1, XPack2, DesertCombat and FH ship their own.

```
MaterialManager.material <id>          materialDamage / materialFriction / materialElasticity / materialResistance
MaterialManager.attGroup <a> ; MaterialManager.defGroup <d> ; MaterialManager.damageMod <f> ; setEffectTemplate <name>
```

158 materials load in vanilla and 5,153 (attacker, defender) cells.
`getDamageMod(att, def)` `0x08175040` keys the table by the attacker material's
**attGroup** and the defender's **defGroup** - equal to the ids except for
materials 120 and 166 - and never creates a cell. **A pair with no cell returns
`defaultDamageMod` = 0.0** (`MaterialManager` constructor `0x081747f0`;
`speedDamageMod` 0.1 sits beside it; neither has a console word, so no mod can
change them): untabulated pairs do no collision damage. A cell that a script
creates only to hang an effect on starts at damageMod **1.0**, not 0 (vanilla
has none). An undefined material id falls back to material 0.

| | |
|---|---|
| vehicle materials | Willy 45 throughout; Sherman 50/51/52; Spitfire 60/61/63, plus 90 on a third of its col1 faces (none on col0); wheels 37, 38, 178 |
| `materialDamage` | 1.0 for every armour material; **30.0 for all 16 terrain materials** |
| hull vs hull | (45 or 50/51/52) <-> (60/61/63), and 45 <-> 50/51/52: **0.1** both ways, effect `e_collision_metal`. (61,52) and (63,52) have no cell |
| material 90 | 19 cells as attacker (0.1), effectively none as defender: **whoever owns a 90 face takes nothing, whoever hits it still pays.** Also invisible to projectiles (§5.5). 3,392 vanilla faces: buildings, crates, plane and ship hulls |
| terrain -> vehicle | -> 45 and -> 50/51/52: **0.01** (water -> 45: 0.5); -> 60: 0.01; -> 61 and -> 63: **0.1** (rock: 0.5); -> 90, -> 178: no cell |
| vehicle -> terrain | no cells |

### 9.5 Against the ground, and water

`handleCollisionLandOrWater`, `other == NULL`, `speed` = the root's tangent
speed at the contact:

```
land:   damage = c³ × speedMod × V² × getDamageMod(matTerrain, matSelf) × getDamageForMaterial(matTerrain)
        applied if > 1.0
water:  (matOther == 1)  the same with c², only if the Armor has damageFromWater, no > 1.0 gate
soldier: V −= 8 first (return if negative), then the h / k / af terms of §9.3
```

`c³` makes a belly landing cheap and a nose-in crash expensive: at 40 m/s a
10° descent has c = 0.17, c³ = 0.005; straight down c³ = 1. This is the crash
the old README called "not in the engine".

### 9.6 What it comes to

Recomputed independently by the verifier from its own extraction of the data.

| at 15 m/s, square on | the parked one takes | the moving one takes |
|---|---|---|
| Willy -> Spitfire (2,500 kg each; shares 0.5 / -0.5) | 2 x 225 x 0.1 = **45** of 100 (0 on a material-90 face) | 1 x 225 x 0.1 = **22.5** of 50, on any face |
| Willy -> Sherman (share 0.909 to the jeep) | **22.5** of 100 | **22.5** of 50 |
| Sherman -> Spitfire (share 0.909 to the plane) | **45** of 100 | **22.5** of 100 |

The rammer is never free, and **mass is nowhere in it**: the jeep loses as much
as the tank it hits. Two rams a second apart leave the Spitfire at 10 HP,
below its `criticalDamage 20`, and burning. Contacts through a wheel (material
37) cost neither side. The `> 1.0` gate, square on: 2.2 m/s for an aircraft,
3.2 m/s for a Willy or a Sherman, 14 m/s for a ship (`speedMod` 0.05).

A Spitfire into flat ground at 40 m/s, 30 deg below the horizon: c = 0.5, c^3 =
0.125, `speedMod` 2, V^2 = 1600, terrain damage 30. A material-60 vertex takes
0.125 x 2 x 1600 x 0.01 x 30 = **120**; a 61 or 63 vertex, 0.1 instead of 0.01,
**1,200** (rock: 6,000); a wheel or a 90 vertex, 0. Against 100 HP that is fatal
on any hull vertex, and 61/63 are 12 of the fuselage's 16 col0 vertices. A
Willy coming down on its **hull** at 10 m/s takes 1 x 1 x 100 x 0.01 x 30 = 30
of its 50; coming down on its wheels (material 37) it takes nothing, which is
why a jeep survives a jump it lands.

### 9.7 After `giveDamage`

`giveDamage` acts only while the game is in its playing state, resolves the
target's nearest Armor, applies `calcDamage` `0x0814b520` — nothing but the
friendly-fire factors, and only when the attacker's team equals the victim's —
and hands over to `_giveDamage` → `handleDamage` → `Armor::damage`
([hitpoints-and-damage.md](hitpoints-and-damage.md) §4).

---

## 10. Point bodies

Projectiles, grenades and bombs (`ProjectileTemplate`'s constructor sets
`hasPointPhysics`; 13 vanilla scripts turn it off, starting with `ExpPack`)
have a `PointResponsePhysics`: `impulseOn`, `addFriction` and `reset` are
empty. Detection sweeps the segment `pos − v·dt → pos` against the terrain and
against each candidate's **col1** faces (skipping material 90:
`isSolidMaterial` `0x08257010`), keeps one record, and `solveImpulse`
just calls the projectile's own `handleCollision`. **The engine applies no
physical response to a point body and none to what it hits** — a shell does not
shove a jeep; bounce, stick or detonate is the projectile's own business
([projectiles-and-impacts.md](projectiles-and-impacts.md)).

---

## 11. Client and server

The client's `ResponsePhysicsManager`, `ResponsePhysics` and `PhysicsNode`
vtables match the server's slot for slot, and every constant checked is
identical (0.45/0.9/2.0, 0.01/4.0/0.9/0.65/0.95/0.05, 30/0.5/±10, 1/3, 1e6/1000).
The manager-wide sweep and the per-player single-object update both run on the
client for **every** player with no local/remote branch: remote vehicles are
simulated bodies, not interpolated ghosts.

The client does not appear to compute collision damage: `Armor::damage`,
`getDamageMod`, `getSpeedMod`, `addColObject`, `isInColList` and `collision`
have no code callers, and the damage arithmetic is not found in its `.text`.
Hit points arrive from the server. The client's own `handleCollision` override
was not located; this stays `inferred`.

---

## 12. Quirks, for anyone choosing between fidelity and sanity

| | |
|---|---|
| low-snap `shareB = +1.0` | §6.1 — wrong sign; port −1.0 |
| broadphase and sphere margins use `|v|²` | §5.1, §5.2 — m²/s² added to metres |
| collision LOD stored on the shared mesh template | §5.4 |
| friction budget ∝ `N.y`, not normal force | §8 — no friction in a side-on ram |
| a zero friction sample dilutes the mean | §8 |
| Z-axis torque uses the rotational friction before its 40000 limit | §4.2 |
| turns about the origin; `ω` in world axes; no gyroscopic term | §4.2 |
| first tick after waking has no gravity | §4.2 |
| half of the closing speed removed per tick, e = 0 everywhere | §6.4 |
| one damage event per pair per second; terrain is one "pair" | §9.2 |
| untabulated material pairs do zero damage; material 90 is a hole | §9.4 |
| `addFriction`'s six float arguments are dead | §8 |

---

## Still open

| | |
|---|---|
| The client's `SimpleObject::handleCollision` and `Game::handleCollision` override | next lead: the client `PlayerControlObject` vtable's `+0x58`; lnxded's tail-calls the base directly |
| Where `getSpeedDamageMod()` (default 0.1) is consumed | not in either collision handler |
| What gives projectiles and soldiers their collision-group bit | writers of template `+0x78` |
| How object flag `0x200` derives from `hasCollisionPhysics` | the ConsoleClass handlers at `0x081b8625`–`0x081b8969` |
| Which collision LOD is current when `ObjectManager::intersectLine` runs (bullets) | the shared-template LOD state, §5.4 |
| The soldier-vs-soldier push: signs not re-derived | `checkObjectVsObject` `0x082597xx` |
| Callers of `addSpeedAtAbsolutePosition` / `…RelativePosition` | slot offsets collide with other interfaces |
| Whether a body resting on contact alone (crate, wreck) ever sleeps | needs `|acc|² < 2.5` with e = 0 |
| The `+1.0` snapped share in play | a very heavy vertex-side body against a light one of similar radius |
