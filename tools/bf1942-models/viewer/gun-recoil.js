// `fireingForce` (sic): the shove a round gives the hull its gun is bolted to.
//
// Fire a Sherman's cannon across the hull and the tank slides and rolls the
// other way. That is one `.con` word and one call, read out of the binary as
// ledger FA-1 and re-read in full on 2026-10-18 (`FireArms::Fire` lnxded
// `0x0828a090`, the block at `0x0828a43f`):
//
//     root = getRootParent(fireArms)         // the hull, not the turret
//     node = root->physicsNode               // root + 0x60
//     node->setIsAwake()                     // vtable +0xd4
//     M = fireArms->getAbsoluteTransformation()   // vtable +0x40
//     a = -(M.row2) * fireingForce           // row 2 is the gun's forward
//     p = fireArms->getAbsolutePosition()    // vtable +0x38
//     node->addAccelerationAtAbsolutePosition(p, a)   // vtable +0x68
//
// Three things about it are easy to get wrong, and all three are what make it
// feel like the real game:
//
//   - It is an ACCELERATION, not a force or an impulse: mass-independent, and
//     spent over exactly one 30 Hz tick by `updatePhysics`, because the
//     accumulator is re-seeded every tick (`rigid-body.js` `step`). A Sherman's
//     110 is 110/30 = 3.67 m/s of hull velocity change per shot, before the
//     torque arm takes its share.
//   - It goes in AT THE GUN, not at the centre of mass, so
//     `addAccelerationAt`'s `(p - com) x a` arm turns most of a side-on shot
//     into roll and yaw. That is why the tank leans rather than just skidding.
//   - It is posted ONCE PER TRIGGER PULL, outside the barrel loop. A gun that
//     fires four barrels in one salvo pushes once, not four times.
//
// Framework-free (plain arrays and a `Matrix4.elements` view) so
// `tests/gun_recoil_harness.mjs` runs it under node with no three.js.

/**
 * The gun's own recoil push, in world space, or null when there is none.
 *
 * `elements` is a column-major 4x4 as `THREE.Matrix4.elements` holds it, so
 * column 2 (`[8..10]`) is the node's +Z axis and column 3 (`[12..14]`) its
 * translation. The exporter mirrors Refractor's +Z forward onto glTF's -Z
 * (`gunfire.js` fires rounds down `(0, 0, -1)`), so the engine's
 * `-forward * fireingForce` is `+Z * fireingForce` here: backwards out of the
 * barrel, which is the direction a recoiling gun actually shoves.
 *
 * The axis is normalised, so a gun node carrying a scale still pushes with the
 * force the template authored rather than the force times its scale.
 *
 * `out` is mutated and returned: `{ px, py, pz, ax, ay, az }`, the position to
 * push at and the acceleration to push with, in m/s^2.
 */
export function fireingPush(elements, force, out) {
  if (!(force > 0) || !elements) return null;
  const x = elements[8], y = elements[9], z = elements[10];
  const len = Math.hypot(x, y, z);
  if (!(len > 0)) return null;
  const k = force / len;
  out.ax = x * k; out.ay = y * k; out.az = z * k;
  out.px = elements[12]; out.py = elements[13]; out.pz = elements[14];
  return out;
}

/** A fresh `out` for `fireingPush`. One per caller; the module keeps none. */
export function pushSlot() {
  return { px: 0, py: 0, pz: 0, ax: 0, ay: 0, az: 0 };
}
