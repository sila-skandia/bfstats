# Articulated hull collision (landing-craft ramps, turrets)

## The bug (2026-09-26)

On Wake, bots beached a Daihatsu, lowered the ramp and got out, then stood
pinned in the well deck at the ramp's hinge. The collider bakes every hull's
collision triangles once, in the pose the level loaded them in, and a hull
that moves is re-asked as one rigid body (`WorldCollider.setMovedOwner`).
`DaihatsuLanding1/2` and `Lcvp_Ramp` carry their own collision meshes under
their rig nodes, so the raised ramp's triangles stayed standing across the bow
as an invisible wall while the drawn ramp lay on the beach, and nothing was
there to walk down.

## The fix

- `static-index.js buildCollisionIndex` tags each collision triangle with its
  articulated sub-part: the nearest ancestor below the owner whose rig axes are
  all position servos (`isArticulated`; a `rate` axis such as an engine or a
  wheel's roll never stands still and is left in the hull). Each sub-part keeps
  the owner's and its own world matrix at the bake.
- `WorldCollider.setMovedOwner` (every body tick for a driven hull) compares
  each sub-part's swing inside the hull, `inv(On) * Sn`, with the bake's. A
  swung part is flagged active (`CollisionIndex._subActive`), dropped from the
  owner's rigid pass and from the index's own passes, and given its own entry
  in `moved` (`sub:<id>`) with `fwd = hullFwd * Ob * inv(On) * Sn * inv(Sb)`.
  Every query loop over `moved` asks it with `onlySub` and reports the hit as
  the owner's, so damage, `skipOwner` and hit attribution are unchanged.
- A part back in its baked pose retires its entry; `clearMovedOwner` retires
  all of the owner's.

Turrets and gun elevations are articulated by the same test, so rounds now
meet a traversed turret where it is drawn.

## Limits

- Only a hull that has been moved (driven, shoved, beached) updates its parts:
  a parked hull whose ramp is lowered without the hull ever moving keeps the
  baked ramp. No path does that today.
- The headless sim (`sim/run.mjs`) does not pose rig nodes, so it does not
  exercise this; `tests/collision_harness.mjs` (`articulated`) does.

## Tests

`python3 -m unittest tests.test_collision` (`test_a_lowered_ramp_moves_its_collision_with_it`).
