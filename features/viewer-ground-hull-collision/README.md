# Hull collision for ground vehicles: a plan, not a build

Written by wave-2 stream D (`w2d-drive`) alongside items 15–17 of the
2026-09-19 parity round. **Nothing here is implemented.** It exists so that
whoever picks the work up starts from what `viewer/ground.js` already has
rather than from `collision-response.md` cold.

Sources: [`subsystems/collision-response.md`](../bf1942-engine-reference/subsystems/collision-response.md)
(sections 3–8 and 12) and [`vehicle-collision-physics/README.md`](../vehicle-collision-physics/README.md).
That round's own ordering — crash damage first, then bodies, then the probe —
is the right one for the *whole* feature; this document is only the
ground-vehicle half of its step 2 and step 3, which is the part
`GroundVehicle` and `TrackedVehicle` own.

---

## 1. What the viewer already has

**A swept sphere against the static index.** `WorldCollider.sweepSphere(ox,
oy, oz, dx, dy, dz, maxDist, radius, skipOwner)` (`viewer/collision.js:804`,
over `StaticIndex.sweepSphere` at `:396`) returns `{t, nx, ny, nz, material,
owner, triangle}` for the first triangle a sphere of `radius` touches along a
ray. Both vehicle classes call it once per sub-step on the hull's own
displacement, back off to `t - 0.02`, and cancel the inbound normal component
of velocity (`ground.js`, the `if (this.collider && this._hullRadius > 0)`
block in each `#step`).

**A real triangle index with per-triangle materials and owners.** The scene
glb's `extras.collision` nodes are packed into a uniform XZ grid
(`buildStatics`, `viewer/collision.js:621`) carrying `materials`
(`Uint16Array`, one per triangle, from `geometry.userData.defenseMaterial`)
and `owners` (which node each triangle came from, with
`statics.ownerOf(node)` giving a vehicle its own id so it can skip itself).
Wake is 20,911 triangles, Bocage 21,661.

**A heightfield with per-sample terrain materials**, and as of this round a
`surfaceFriction(x, z)` join from those ids to `materialFriction`
(`map.html`). The per-*triangle* material is already on the sweep hit and is
already used for projectile impact effects.

**What it does not have.** Every parked vehicle is *in* the static index, so
it is a wall: infinite mass, no velocity, no damage, and the hit normal is
the triangle's rather than a contact between two bodies. There is no second
body to push.

## 2. What the engine does, in the four facts that matter here

From `collision-response.md`:

- **Contacts are vertices against faces** (§5.3–5.5). The *smaller* body
  supplies col0 **vertices**; the larger supplies col0 or col1 **faces**. For
  bodies of similar size both directions run, each at weight 0.5. A body with
  three or fewer col0 vertices contributes one; a soldier five; more than ten
  take a bounding-box early-out first. There is no sphere anywhere in it.
- **The push is a mass split, applied as an acceleration at the contact
  point** (§6.1, §6.4). `s = massB / (massA + massB)`, snapped all-or-nothing
  past 95/5 %, a static object reporting mass 1e12. The positional correction
  (`posAdjust`) is applied immediately; the velocity change is
  `speedAdjust * 30 * (1 + e) / 2` posted through
  `addAccelerationAtAbsolutePosition` and integrated **a tick later**. Every
  vehicle and terrain material has elasticity 0, so a contact removes half a
  body's share of the closing velocity per tick and nothing bounces.
- **Because it is applied at the contact point, it spins the body**, scaled
  by the box inertia of §4.2 and `inertiaModifier`, not by mass.
- **Accumulation is `setAdjust`, not addition** (§6.3): per axis, an empty
  slot takes the value, opposite signs add, same signs keep the larger
  magnitude. Many vertices on one face therefore do not stack, and opposing
  contacts cancel.

## 3. The smallest faithful first step

Not "port §5". The first step that changes what a player sees, and that
`ground.js` can carry without a second physics engine:

**Make the sweep's owner mean something.**

`sweepSphere` already returns `owner`, and `statics.ownerOf(node)` already
maps a vehicle root to its own id. Today the owner is used only to skip
self-collision. The step is:

1. Keep a registry of *live* vehicles by owner id — the page already builds
   one per drivable root (`vehicleDamage.byOwner`, which `window.__vehicles()`
   reads). Give it the driving vehicle's own object when one is seated.
2. On a hit whose `owner` resolves to a live vehicle rather than to scenery,
   stop treating the hit as a wall. Compute
   `s = otherMass / (thisMass + otherMass)` with the §6.1 snap, apply
   `s * closingSpeedAlongNormal` to this hull and `-(1 - s) *` the same to the
   other, at the contact point rather than at the centre of mass, and post
   both as accelerations consumed on the next sub-step.
3. Anything whose owner is not a live vehicle keeps today's behaviour —
   mass 1e12, `s = 1`, the hull takes the whole correction. That is exactly
   what §6.1 says a static object does, so the existing path becomes a
   special case of the new one rather than a branch beside it.

That is a dozen lines in each `#step` plus a registry lookup, it uses only
values already on the hit, and it turns "the jeep is stopped by the parked
plane" into "the jeep pushes the plane and slows down" — the ask that started
the collision round.

**What it deliberately does not do**, and why each is a later step:

| deferred | why |
|---|---|
| vertex-versus-face contacts (§5) | the sphere's contact point and normal are close enough to drive the mass split; replacing the probe changes *where* contacts are found, which is a separate, much larger change and needs the col0 vertex data plumbed through the glb |
| the one-tick velocity latency | today's sweep is resolved inside the sub-step; posting the velocity change a tick later is behaviour players have felt for twenty years (§12) and worth matching, but only once there are two bodies to be late about |
| `setAdjust`'s keep-the-larger accumulation | only matters with multiple contacts per tick, which the single sphere sweep cannot produce |
| the sleep counter (§4.3) | a parked vehicle that is in the static index is already, in effect, asleep; it becomes necessary at the same moment step 2 above does |
| crash damage (§9) | owned by `w2b`/`vehicle-damage.js` and by the collision round's own step 1. It needs `speedMod`, `angleMod` and the per-vertex collision material, none of which the extractor emits yet |

## 4. Two things to get right that are easy to get wrong

- **The `+1.0` share is an engine bug** (§6.1): below the 5 % snap the engine
  writes `+1.0` where the sign convention wants `-1.0`, pushing a much
  lighter body *toward* the heavier one. Port `-1.0`. It shows almost never,
  because a body that light is normally the vertex side and takes
  `shareA = 1` with the right sign.
- **Friction between two hulls barely exists** (§8). The Coulomb budget
  scales with the averaged contact normal's **y**, so a side-on ram
  contributes no friction at all — and, being a zero sample in the mean, it
  *dilutes* the wheels' friction for that tick. A vehicle-versus-vehicle
  contact should feed `ground.js`'s per-wheel friction the same way: as a
  sample with `N.y ≈ 0`, not as extra grip. `ground.js` already reads its
  coefficient per contact (PHY-2, item 16), so the hook exists.

## 5. What the extractor would need

Only for the later steps, listed so nobody plans around data that is not
there:

- **Per-vertex collision materials.** `stdmesh.py` reads the face material
  byte and discards the vertex `u16`. The vertex side of a contact pair needs
  it, and so does crash damage.
- **`inertiaModifier`**, for §4.2's box inertia. `ground.js` currently
  estimates a box from the wheel layout and a guessed hull height.
- **`speedMod` / `angleMod`** on the PCO, for §9.

`mass` is already carried (`extras.physics.mass`, read by both vehicle
classes), and so is `drag`.
