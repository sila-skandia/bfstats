import * as THREE from 'three';
import { equilibriumRootY, floatNodesOf } from './body-float.js';
import { ikTarget } from './seat-ik.js';

/**
 * The guns and the seats, and the vehicles: fire state, seat IK and poses,
 * ships, the helm, deck spawns, the seat table, bodies and the hull solver,
 * entering and leaving, placing hulls and damaging them. Split out of `test-
 * hooks.js`; installed by it under `?shots`.
 *
 * `page` is the test hooks' own bag; this part reads:
 * `bodyScene`, `bodyWorld`, `camera`, `collider`, `damageVisuals`,
 * `enterVehicle`, `exitSeat`, `exitVehicle`, `extras`, `fireStateFor`,
 * `floatHosts`, `frozenCount`, `groundHeight`, `guns`, `localPlayer`,
 * `mannedActive`, `nearEntry`, `occupiedVehicleDamage`, `recordCrashes`,
 * `scene`, `seatIkChains`, `seatSoldier`, `showDamageTier`,
 * `snapPresentation`, `soldierExposureFor`, `splashPos`, `splashTargets`,
 * `stepVehicleBodies`, `surfaceFriction`, `switchSeat`, `vehicleDamage`,
 * `vehicleInput`, `vmRoot`, `vmScene`, `wreckVehicle`.
 */
export function installVehicleHooks(page) {
  window.__getFire = () => ({
    groups: page.localPlayer.vehicleGuns.map(group => ({
      name: group.node.name,
      input: group.stats.input,
      roundOfFire: group.stats.roundOfFire,
      velocity: group.stats.velocity,
      tracerInterval: group.stats.tracer?.interval ?? null,
      firing: group.firing,
      shots: group.shots,
      muzzles: group.muzzles.map(node => {
        node.updateWorldMatrix(true, false);
        return {
          name: node.name,
          world: node.getWorldPosition(new THREE.Vector3()).toArray(),
        };
      }),
      flashes: group.emitters.map(emitter => ({
        name: emitter.node.name,
        muzzle: emitter.muzzle?.name ?? null,
        visible: emitter.node.visible,
        additive: [emitter.node.material].flat()
          .every(m => m.blending === THREE.AdditiveBlending),
      })),
    })),
    tracers: page.guns.tracers.map(tracer => ({
      position: tracer.mesh.position.toArray(),
      velocity: tracer.velocity.toArray(),
      bright: tracer.bright,
      age: tracer.age,
      ttl: tracer.ttl,
      // What the width floor settled on this frame, against the streak's own
      // length scale: equal means the real mesh was already wide enough.
      scale: tracer.mesh.scale.toArray(),
      lengthScale: tracer.lengthScale,
      parent: tracer.mesh.parent === page.scene ? 'scene' : (tracer.mesh.parent?.name ?? null),
    })),
    // Where rounds stopped, newest first, each carrying the surface it struck
    // and the EffectBundle the MaterialManager names for that pairing. The
    // selection is assertable even though the drawing is a stand-in.
    hits: page.guns.hits,
    impacts: page.guns.impacts.length,
    projectiles: page.guns.projectiles.length,
    // HP-9d, for a headless check: a **fuse** round is one the engine gives an
    // end-of-life explosion but no impact explosion, and `resting` says it has
    // met a surface and is running its fuse down where it landed rather than
    // having detonated there.
    inFlight: page.guns.projectiles.map(shot => ({
      gun: shot.group.node.name,
      age: shot.age,
      ttl: shot.ttl,
      fuse: shot.fuse,
      resting: shot.resting,
      position: shot.mesh.position.toArray(),
      // COL-2, and the three numbers a bounce check needs: where it is going,
      // how many contacts it has resolved, and which material pair it is
      // resolving them against. A rest position alone cannot tell a round
      // that skidded from one that was teleported.
      velocity: shot.velocity.toArray(),
      contacts: shot.body?.contacts ?? 0,
      contactMaterial: shot.body?.material ?? null,
      surface: shot.body?.contact?.material ?? null,
      pair: shot.body?.contact
        ? shot.body.pairWith(shot.body.contact.material) : null,
    })),
    pooled: page.guns.tracerPool.length,
    // Baked streaks recycle into their own group's pool, not the shared
    // cylinder pool, so a leak there is invisible to `pooled` alone.
    meshPooled: page.localPlayer.vehicleGuns.reduce((n, g) => n + g.tracerMeshPool.length, 0),
  });
  // Seat/manned-gun state for headless checks (P2,
  // features/bf1942-3d-models/seats-and-manned-guns.md): which seat is
  // active, its turret's own angles, and the active seat's own FireArms
  // (ammo/heat/mags) -- `__getFire`/`vehicleGuns` above never see these, since
  // a gun/seat occupancy's own FireArms live in `mannedGuns`, not there.
  Object.defineProperty(window, '__occupancy', {
    get: () => page.localPlayer.occupancy && {
      rootId: page.localPlayer.occupancy.rootId,
      rootKind: page.localPlayer.occupancy.rootKind,
      order: page.localPlayer.occupancy.order,
      activeSeatId: page.localPlayer.occupancy.activeSeatId,
      activeKind: page.localPlayer.occupancy.seatKind(page.localPlayer.occupancy.activeSeatId),
      mannedActive: page.mannedActive(),
      turretAxes: page.localPlayer.occupancy.turret?.axes.map(a => ({ axis: a.axisName, angle: a.angle })) ?? null,
      fireArms: page.localPlayer.occupancy.activeFireArmsNodes().map(n => {
        const s = page.fireStateFor(n);
        return {
          name: n.name, ammo: s.unlimited ? -1 : s.ammo, magsLeft: s.magsLeft,
          heat: s.heat, hasHeat: s.hasHeat, canFire: s.canFire,
        };
      }),
    },
  });
  // Lay the active seat's gun, for a check that has to put a round exactly
  // where it wants it: each named aim axis (`yaw`, `pitch`) goes to that many
  // degrees from its rest pose (the servo's `+0x104`) and stops there, as if
  // the servo had arrived. Returns every axis's angle afterwards.
  window.__aimSeat = (angles = {}) => {
    const rig = page.localPlayer.occupancy?.turret;
    if (!rig) return null;
    for (const axis of rig.axes) {
      const want = Number(angles[axis.axisName]);
      if (!Number.isFinite(want)) continue;
      axis.angle = want;
      axis.speed = 0;
      axis.setInput(0);
    }
    rig.apply();
    return rig.axes.map(a => ({ axis: a.axisName, angle: a.angle }));
  };
  window.__nearEntry = () => page.nearEntry
    && { control: page.nearEntry.control, seatId: page.nearEntry.seatId };
  // The seated occupant and the arms the IK is driving this frame: which bone
  // is pinned to which node, and how far it actually is from where the
  // declared offset puts it. A headless check has no other way to tell a hand
  // that is on the wheel from one that is merely near it.
  window.__seatIk = () => {
    const v = new THREE.Vector3();
    const want = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    return page.seatIkChains.map(chain => {
      chain.target.updateWorldMatrix(true, false);
      chain.target.matrixWorld.decompose(want, q, s);
      const t = ikTarget(chain.entry, [want.x, want.y, want.z],
                         [q.x, q.y, q.z, q.w]);
      chain.end.getWorldPosition(v);
      return {
        bone: chain.bone, node: chain.node.name, target: chain.target.name,
        want: t.position.map(n => +n.toFixed(4)),
        got: [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)],
        error: +Math.hypot(t.position[0] - v.x, t.position[1] - v.y,
                           t.position[2] - v.z).toFixed(5),
      };
    });
  };
  // The seated soldier itself, for the same reason.
  window.__seatSoldier = () => (page.seatSoldier ? {
    visible: page.seatSoldier.visible,
    firstPerson: !!page.view?.firstPerson,
  } : null);
  window.__switchSeat = page.switchSeat;
  // Group-index bookkeeping, independent of `occupancy` (which reads null the
  // instant a seat is vacated) so a headless enter/exit cycle can check the
  // *count* left behind afterwards, not just while still seated: a group
  // `releaseGuns()` failed to splice out of `guns.groups` would otherwise be
  // invisible until a second entry's own `collect()` piled a duplicate on top
  // of it — this is `guns.groups.length` itself, so a leak shows up as soon
  // as the first exit leaves it above 0 with nobody occupying anything.
  window.__gunGroups = () => ({
    vehicle: page.localPlayer.vehicleGuns.length, manned: page.localPlayer.mannedGuns.length, total: page.guns.groups.length,
  });
  window.__hudVars = () => (window.__hud && window.__hud.vars) || null;
  // Turning, for the screenshot harness. It calls the same `lookDelta` a
  // pointer-lock `pointermove` calls, so it exercises the real routing rather
  // than writing yaw behind it — headless Chromium does not reliably grant
  // pointer lock, and without this a harness can only ever walk one way.
  //
  // Named `__lookDelta` and not `__look`: `window.__look` is already the
  // free-fly `look` object above, and an assignment here would silently take it
  // away from every check that steers the free camera by writing yaw into it.

  window.__soldiers = (blast) => {
    const from = Array.isArray(blast) && blast.length === 3 ? blast : null;
    return page.splashTargets().filter(t => t.soldier).map(t => ({
      player: !t.node,
      pose: t.pose,
      hp: Math.round(t.armor.hitPoints * 1000) / 1000,
      max: t.armor.maxHitPoints,
      destroyed: t.armor.destroyed,
      visible: t.node ? t.node.visible : true,
      origin: [Math.round(t.x * 100) / 100, Math.round(t.y * 100) / 100,
               Math.round(t.z * 100) / 100],
      exposure: from ? page.soldierExposureFor(t, from) : null,
    }));
  };
  // Every floating hull, where it is and where the closed form says it should
  // be: the one readout that says whether a ship is at its own draft. A check
  // asserting the fleet's eight predicted `y` values needs the target beside
  // the measurement, or it is asserting the viewer against itself.
  window.__ships = () => page.floatHosts.map(host => {
    const floats = floatNodesOf(host.node);
    host.node.updateWorldMatrix(true, false);
    return {
      control: host.node.userData?.control ?? host.node.name,
      y: +host.node.matrixWorld.elements[13].toFixed(4),
      target: +equilibriumRootY(floats, page.collider?.waterLevel ?? page.extras?.waterLevel)
        .toFixed(4),
      authoredY: +host.authored[1].toFixed(4),
      nodes: floats.length,
      hullHeight: floats[0]?.hullHeight ?? null,
      relY: +(floats[0]?.offsetY ?? 0).toFixed(3),
      maxLift: floats[0]?.floatMaxLift ?? null,
      minLift: floats[0]?.floatMinLift ?? null,
      x: +host.node.matrixWorld.elements[12].toFixed(3),
      z: +host.node.matrixWorld.elements[14].toFixed(3),
      sinking: !!host.sinking,
    };
  });
  // The helm of whatever ship is occupied: the state that decides how fast she
  // goes and whether she is stuck. `throttle` is the pedal, `revs` is
  // `PhysicsEngine+0xa0` — the value the thrust law actually reads.
  window.__helm = () => {
    if (!page.localPlayer.aircraft || !('revs' in page.localPlayer.aircraft)) return null;
    const s = page.localPlayer.aircraft.state;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.orientation);
    return {
      throttle: +s.throttle.toFixed(4), revs: +page.localPlayer.aircraft.revs.toFixed(4),
      load: +page.localPlayer.aircraft.load.toFixed(4),
      speed: +s.velocity.length().toFixed(4),
      along: +s.velocity.dot(fwd).toFixed(4),
      heading: +(Math.atan2(fwd.x, fwd.z) * 180 / Math.PI).toFixed(3),
      yawRate: +(s.angularVelocity.y * 180 / Math.PI).toFixed(4),
      x: +s.position.x.toFixed(3), y: +s.position.y.toFixed(3),
      z: +s.position.z.toFixed(3),
      keel: +page.localPlayer.aircraft.keel.toFixed(3), underWater: +page.localPlayer.aircraft.underWater().toFixed(3),
      aground: !!page.localPlayer.aircraft.aground,
      // The RAW bed under her origin. `Ship.groundHeight` now answers the
      // footprint's floor (a synthetic number the clamp reads), so a trace that
      // wants "what is under her" has to ask `bedHeight`.
      seaBed: +(page.localPlayer.aircraft.bedHeight
        ? page.localPlayer.aircraft.bedHeight(s.position.x, s.position.z)
        : page.localPlayer.aircraft.groundHeight(s.position.x, s.position.z)).toFixed(3),
      // The deepest part of her hull that is still under the bed, which after
      // `pushOutOfBed` should be zero on any grounded hull.
      buried: +((page.localPlayer.aircraft.deepestContact?.()?.depth) ?? 0).toFixed(4),
      size: page.localPlayer.aircraft.spec.size.map(n => +n.toFixed(3)),
      inertia: [page.localPlayer.aircraft.inertia.x, page.localPlayer.aircraft.inertia.y, page.localPlayer.aircraft.inertia.z],
      staticContacts: page.bodyWorld?.staticContacts ?? null,
    };
  };
  // The level's deck spawns as the page now holds them: `rebaseDeckSpawns` has
  // moved each one with its hull, and `deckBake` is the extractor's own value
  // beside it. Both, because the whole question is whether the point sits over
  // its ship.
  window.__deckSpawns = () => (page.extras?.vehicleSoldierSpawns || []).map(s => ({
    vehicle: s.vehicle, name: s.name, pad: s.pad, group: s.group, team: s.team,
    position: s.position, bake: s.deckBake ?? null,
  }));
  // Every seat of whatever is occupied, not just the active one: what each is
  // classified as and what it is wired to. `__occupancy` above reports the
  // active seat; this reports the row the number keys walk, which is what a
  // check of seat cycling has to name -- a gun count that changes says
  // something moved, not which seat it moved to.
  window.__seatTable = () => page.localPlayer.occupancy && ({
    control: page.localPlayer.occupancy.root?.userData?.control ?? null,
    rootKind: page.localPlayer.occupancy.rootKind,
    drive: page.localPlayer.occupancy.drive ? page.localPlayer.occupancy.drive.constructor.name : null,
    active: page.localPlayer.occupancy.order.indexOf(page.localPlayer.occupancy.activeSeatId),
    seats: page.localPlayer.occupancy.order.map((id, index) => ({
      index, kind: page.localPlayer.occupancy.seatKind(id),
      node: page.localPlayer.occupancy.seatInfo(id)?.node?.name ?? null,
      fireArms: page.localPlayer.occupancy.seatInfo(id)?.fireArms.length ?? 0,
      engine: page.localPlayer.occupancy.seatInfo(id)?.engineType ?? null,
      axes: Object.keys(page.localPlayer.occupancy.seatInfo(id)?.axes || {}),
    })),
  });
  // Every damageable thing in the level and what it is currently showing, for a
  // headless check: shoot a tank, step frames, read the tier back.
  // Every hull the wreck path is tracking: is it still coming down, did the
  // crash happen, is the wreck model parented, and did a load fail. The state
  // the world cannot show once the intact mesh is sitting on the ground.
  window.__wrecks = () => page.wreckState();
  window.__vehicles = () => [...page.vehicleDamage.byOwner.entries()].map(([owner, v]) => ({
    owner, name: v.name, hp: Math.round(v.hitPoints * 100) / 100,
    max: v.maxHitPoints, critical: v.critical, destroyed: v.destroyed,
    criticalDamage: v.criticalDamage,
    // Where it stands, which is also the point a blast measures its distance
    // to (HP-9: the transform origin, not a bounding box). A check that wants
    // to stand a man beside one, or to know which neighbour a shell should
    // have caught, needs this and has had to guess at it until now.
    pos: page.damageVisuals.get(owner)?.node
      ? page.damageVisuals.get(owner).node.getWorldPosition(page.splashPos).toArray()
        .map(n => Math.round(n * 100) / 100)
      : null,
    tier: v.shown ? { threshold: v.shown.threshold, names: v.shown.names } : null,
    running: page.damageVisuals.get(owner)?.handles.length ?? 0,
    tiers: v.effects.map(e => ({ hp: e.hp, effect: e.effect })),
  }));
  // The land vehicle the player is currently driving, for a headless drive.
  // Reading its state is not enough to *test* one: the renderer manages a
  // couple of frames a second on a real level under SwiftShader, which pins
  // `dt` at the page's 0.1 s clamp and makes a real-time drive meaningless.
  // So this also hands back the two calls `frame()` makes — the same object,
  // the same level collider, the same material map — and a check can step
  // them synchronously at whatever rate it wants.
  window.__drive = () => (page.localPlayer.car ? {
    state: () => ({
      speed: page.localPlayer.car.state.velocity.length(),
      along: page.localPlayer.car.state.velocity.dot(
        new THREE.Vector3(0, 0, -1).applyQuaternion(page.localPlayer.car.state.orientation)),
      position: { ...page.localPlayer.car.state.position },
      velocity: { ...page.localPlayer.car.state.velocity },
      grounded: page.localPlayer.car.state.grounded,
      // Attitude, in degrees: a deck trace has to see the hull pitch up an
      // incline and level off on the pad, and reading that off the orientation
      // quaternion outside the page is needless work.
      pitch: THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1,
        new THREE.Vector3(0, 0, -1).applyQuaternion(page.localPlayer.car.state.orientation).y)))),
      roll: THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1,
        new THREE.Vector3(1, 0, 0).applyQuaternion(page.localPlayer.car.state.orientation).y)))),
      gear: page.localPlayer.car.gear ?? null,
      revs: page.localPlayer.car.revs ?? null,
      wheels: page.localPlayer.car.wheels.map(w => ({
        compression: w.compression, load: w.load,
        friction: w.friction, latched: w.staticGrip, driven: w.driven,
      })),
      // This tick's resolved hull contacts (`body-statics.js` found them, the
      // solver pushed them, `DrivenBody.noteContact` handed them over). The
      // only observable that says "the building answered as a body" rather
      // than "the sweep stopped me", and `normalY` is the whole of why a
      // side-on one brings no friction.
      hullSolved: page.localPlayer.car.hullSolved,
      hullContacts: page.localPlayer.car.hullContacts.map(c => ({
        normalY: c.normalY, friction: c.friction, count: c.count,
        at: [c.x, c.y, c.z],
      })),
    }),
    setInput: (name, value) => page.localPlayer.car.setInput(name, value),
    integrate: dt => page.localPlayer.car.integrate(dt),
    // Stand it somewhere exact, stopped and pointing at a heading — the same
    // job `__teleport` does for the soldier, and needed for the same reason.
    // A measured top speed or brake distance is only a measurement if the
    // run had room: every land spawn on Wake is a few tens of metres from a
    // building or the sea, so a 40-second full-throttle run from one reads
    // the collision sweep rather than the drivetrain. Drops it a little clear
    // of the ground and lets the springs take it, exactly as a spawn does.
    place: (x, y, z, yaw = 0) => {
      page.localPlayer.car.state.position.set(x, y, z);
      page.localPlayer.car.state.velocity.set(0, 0, 0);
      page.localPlayer.car.state.angularVelocity.set(0, 0, 0);
      page.localPlayer.car.state.orientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      return { ...page.localPlayer.car.state.position };
    },
    // Where the level's heightfield and material map put the ground under a
    // world (x, z): the two functions the drivetrain itself is handed. `fromY`
    // is the drivable-deck reference the wheels pass (their axle plus the step
    // they can mount), so a trace can read the deck a vehicle is riding and the
    // terrain under it separately.
    ground: (x, z, fromY) => ({
      height: page.groundHeight(x, z, fromY),
      friction: page.surfaceFriction(x, z, fromY),
      deck: page.collider?.deckHeight ? page.collider.deckHeight(x, z, fromY) : null,
    }),
    // What the hull sweep meets on a move, and the triangle it meets — the
    // question "why did the tank stop here" has no other answer from outside
    // the page, and a deck that reads as a wall is exactly that question.
    // `deckStepTop`/`deckFloorCos` are the gate; omit them for the ungated view.
    sweep: (dx, dy, dz, dist, deckStepTop = -Infinity, deckFloorCos = 2) => {
      if (!page.collider) return null;
      const len = Math.hypot(dx, dy, dz) || 1;
      const s = page.localPlayer.car.state.position;
      const hit = page.collider.sweepSphere(s.x, s.y, s.z, dx / len, dy / len, dz / len,
        dist, page.localPlayer.car._hullRadius, page.localPlayer.car._collisionOwner, true, deckStepTop, deckFloorCos);
      if (!hit) return null;
      const tris = page.collider.statics?.tris;
      const j = hit.triangle * 9;
      return {
        t: hit.t, owner: hit.owner, triangle: hit.triangle,
        drivable: page.collider.statics?.drivable?.[hit.triangle] === 1,
        name: page.collider.statics?.ownerNodes?.[hit.owner]?.name ?? null,
        point: [hit.px, hit.py, hit.pz],
        normal: [hit.nx, hit.ny, hit.nz],
        vertices: tris && hit.triangle >= 0
          ? [[tris[j], tris[j + 1], tris[j + 2]],
             [tris[j + 3], tris[j + 4], tris[j + 5]],
             [tris[j + 6], tris[j + 7], tris[j + 8]]]
          : null,
        radius: page.localPlayer.car._hullRadius,
      };
    },
  } : null);
  // HP-15, for a headless check: what the occupied hull's damage state is
  // letting through this frame, and what the aim rig is actually scaling by.
  window.__inputGate = () => ({
    blocked: page.vehicleInput.blocked,
    rotationalScale: page.vehicleInput.rotationalScale,
    turretInputScale: page.localPlayer.occupancy?.turret?.inputScale ?? null,
    occupied: page.occupiedVehicleDamage()
      ? { hp: page.occupiedVehicleDamage().hitPoints,
          critical: page.occupiedVehicleDamage().critical,
          destroyed: page.occupiedVehicleDamage().destroyed }
      : null,
  });
  // Hurt one by owner id without having to hit it with a round — the same
  // generic entry point `window.__damage(n)` is for the soldier. Negative heals,
  // the way `SimpleObject::handleDamage` dispatches on the sign of its argument
  // (ledger HP-7).
  // The rigid-body world: one row per simulated vehicle, and a way to step it
  // in a hidden tab the way `__renderOnce` steps everything else.
  window.__bodies = () => (page.bodyWorld ? [...page.bodyWorld.entries.values()].map(e => {
    const b = e.parked ? e.parked.body : e.driven;
    return {
      owner: e.owner, name: page.bodyScene.get(e.owner)?.node?.name, driven: !!e.driven,
      pos: [...b.pos], v: [...b.v], w: [...b.w], sleepiness: b.sleepiness ?? null,
      moved: !!page.bodyScene.get(e.owner)?.moved, hp: page.vehicleDamage.get(e.owner)?.hitPoints ?? null,
    };
  }) : null);
  // Turn the hull-vs-static path off and on, which is the only honest A/B for
  // it: `false` takes the static contacts out of the solver AND puts the drive
  // model back on its own swept sphere, exactly the pair of behaviours that
  // used to be the only one. Called with no argument it just reports.
  window.__hullSolver = on => {
    if (!page.bodyWorld) return null;
    if (on !== undefined) {
      page.bodyWorld.statics = on && page.collider?.statics ? page.collider.staticProbe() : null;
      const driven = page.localPlayer.car || page.localPlayer.aircraft;
      if (driven && 'hullSolved' in driven) driven.hullSolved = !!page.bodyWorld.statics;
    }
    return { solver: !!page.bodyWorld.statics, sweep: !((page.localPlayer.car || page.localPlayer.aircraft)?.hullSolved) };
  };
  // Static-world contacts the last body tick found, for any driven vehicle —
  // the one number that says the hull met the level, for an aircraft as well
  // as a car (an aircraft's drive model has no friction mean to hand them to,
  // so `__drive().hullContacts` cannot answer for it).
  window.__staticContacts = () => page.bodyWorld?.staticContacts ?? null;
  window.__stepBodies = dt => page.stepVehicleBodies(dt);
  // One whole simulation tick for a headless drive: the drive model, then the
  // rigid-body world, in `world.js`'s own order (forces and integration, then
  // contacts detected and resolved — spec section 2). `__drive().integrate`
  // alone steps half of it, and since a driven hull's collisions with the
  // static world moved into the solver that half no longer includes hitting a
  // building. Returns the body world's tick count so a trace can prove the
  // second half actually ran.
  window.__stepSim = (ticks = 1, dt = 1 / 30) => {
    for (let i = 0; i < ticks; i++) {
      (page.localPlayer.car || page.localPlayer.aircraft)?.integrate(dt);
      page.bodyWorld?.tick();
    }
    (page.localPlayer.car || page.localPlayer.aircraft)?.applyTransform();
    return page.bodyWorld?.ticks ?? 0;
  };
  window.__crashLog = () => page.recordCrashes();
  // The aircraft under the player, for a stepped test: inputs, state, a pose.
  window.__plane = () => (page.localPlayer.aircraft ? {
    setInput: (name, value) => page.localPlayer.aircraft.setInput(name, value),
    state: () => ({ position: { ...page.localPlayer.aircraft.state.position }, velocity: { ...page.localPlayer.aircraft.state.velocity },
      grounded: page.localPlayer.aircraft.state.grounded, throttle: page.localPlayer.aircraft.state.throttle }),
    place: (x, y, z, vx, vy, vz) => {
      page.localPlayer.aircraft.state.position.set(x, y, z);
      page.localPlayer.aircraft.state.velocity.set(vx, vy, vz);
      page.localPlayer.aircraft.applyTransform();
      page.snapPresentation();
    },
    // Nose along a heading, for a pass flown from a script (quaternion xyzw).
    orient: (x, y, z, w) => {
      page.localPlayer.aircraft.state.orientation.set(x, y, z, w);
      page.localPlayer.aircraft.state.angularVelocity?.set?.(0, 0, 0);
      page.localPlayer.aircraft.applyTransform();
      page.snapPresentation();
    },
    integrate: dt => page.localPlayer.aircraft.integrate(dt),
  } : null);
  // The E key. Not the same thing as `__setOnFoot(false)`: the debug toggle
  // calls `Vehicle.reset()`, which teleports the hull back to its spawn pose,
  // while stepping out leaves it standing where its driver left it. A check on
  // anything that depends on where a driven vehicle ENDED UP has to use this.
  window.__exitVehicle = () => {
    if (!(page.localPlayer.aircraft || page.localPlayer.car) || !page.localPlayer.occupancy) return false;
    page.exitVehicle();
    return !page.localPlayer.occupancy;
  };
  window.__wakeBody = owner => { const e = page.bodyWorld?.get(owner); e?.parked?.body.wake(); return !!e?.parked; };
  // Climb into a placed vehicle by owner id, and put the driven one somewhere
  // facing something: what a ramming test needs and a keyboard cannot give.
  window.__enterOwner = owner => {
    const node = page.damageVisuals.get(owner)?.node;
    if (!node) return false;
    page.enterVehicle({ vehicle: node, seatId: null });
    return !!(page.localPlayer.car || page.localPlayer.aircraft);
  };
  // Into a given seat of a given hull through the page's own `enterVehicle`
  // (the E key's path): `node` a hull root, `seatId` one of its seats (null:
  // the root seat). A seat someone holds refuses, as the E key does.
  window.__enterSeat = (node, seatId = null) => {
    if (!node) return false;
    page.enterVehicle({ vehicle: node, seatId });
    return page.localPlayer.occupancy?.root === node
      && (seatId == null || page.localPlayer.occupancy.seatId === seatId);
  };
  // E from whatever seat the player holds, through the page's own exit.
  window.__exitSeat = () => {
    if (!page.localPlayer.occupancy) return false;
    page.exitSeat();
    return !page.localPlayer.occupancy;
  };
  // The hull the local player rides, as its instance sees it: who holds
  // which seat, and the one drive's state.
  window.__hull = () => {
    const seat = page.localPlayer.occupancy;
    if (!seat) return null;
    const s = seat.drive?.state;
    return {
      template: seat.root.userData?.control ?? seat.root.name, seat: seat.seatId,
      seats: Object.fromEntries(seat.instance.seats),
      drive: seat.drive ? seat.drive.constructor.name : null,
      pos: s ? [s.position.x, s.position.y, s.position.z] : null,
      speed: s ? Math.hypot(s.velocity.x, s.velocity.z) : null,
      // The root's world frame, the one a hit hull's wash is measured in
      // (ledger HFD-11): its origin, and its nose (-z) and right (+x).
      axes: (() => {
        const q = seat.root.getWorldQuaternion(new THREE.Quaternion());
        return {
          origin: seat.root.getWorldPosition(new THREE.Vector3()).toArray(),
          forward: new THREE.Vector3(0, 0, -1).applyQuaternion(q).toArray(),
          right: new THREE.Vector3(1, 0, 0).applyQuaternion(q).toArray(),
        };
      })(),
      guns: [...seat.groups.driven, ...seat.groups.manned]
        .map(g => ({ name: g.node.name, firing: g.firing, shots: g.shots })),
    };
  };
  // The occupied vehicle's interior, settled: true once it is grafted, false
  // for a vehicle that has none. A check counting what an entry costs the GPU
  // has to sample after this, or the glb lands in whichever cycle it likes.
  window.__cockpitReady = () =>
    ((page.localPlayer.aircraft || page.localPlayer.car)?.cockpitReady ?? Promise.resolve(null)).then(Boolean);
  // The same for a ship, and it needs its own: a hull is placed at her DRAFT
  // rather than on the ground, and the yaw is what a beaching run needs (thrust
  // runs along the hull's forward axis, so a test that cannot point her cannot
  // aim her at a shore).
  window.__placeShip = (x, z, yaw, speed = 0) => {
    if (!page.localPlayer.aircraft || !('revs' in page.localPlayer.aircraft)) return null;
    const s = page.localPlayer.aircraft.state;
    const floats = floatNodesOf(page.localPlayer.aircraft.node);
    const water = page.collider?.waterLevel ?? page.extras?.waterLevel;
    const y = floats.length && Number.isFinite(water)
      ? equilibriumRootY(floats, water) : s.position.y;
    s.position.set(x, Number.isFinite(y) ? y : s.position.y, z);
    s.orientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.orientation);
    s.velocity.copy(fwd).multiplyScalar(speed);
    s.angularVelocity.set(0, 0, 0);
    page.localPlayer.aircraft.revs = 0;
    page.localPlayer.aircraft.load = 0;
    page.localPlayer.aircraft.loadCount = 0;
    page.localPlayer.aircraft.applyTransform();
    page.snapPresentation();
    return window.__helm();
  };
  window.__placeCar = (x, z, yaw, speed = 0) => {
    if (!page.localPlayer.car) return null;
    const s = page.localPlayer.car.state;
    s.position.set(x, page.groundHeight(x, z) + 0.6, z);
    s.orientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.orientation);
    s.velocity.copy(fwd).multiplyScalar(speed);
    s.angularVelocity.set(0, 0, 0);
    page.localPlayer.car.applyTransform();
    page.snapPresentation();
    return { forward: [fwd.x, fwd.y, fwd.z] };
  };
  window.__damageVehicle = (owner, amount) => {
    const vehicle = page.vehicleDamage.get(owner);
    if (!vehicle) return null;
    if (amount > 0) vehicle.damage(amount);
    else vehicle.heal(-amount);
    const result = vehicle.update(0);
    if (result.changed) page.showDamageTier(vehicle, result.tier);
    if (result.died) page.wreckVehicle(vehicle);
    return { hp: vehicle.hitPoints, destroyed: vehicle.destroyed,
             tier: vehicle.shown };
  };
  window.__matrixDrift = () => {
    const local = new THREE.Matrix4();
    const expect = new THREE.Matrix4();
    let worst = 0, checked = 0, worstName = null;
    const walk = (obj, parentWorld) => {
      if (obj.matrixAutoUpdate) local.compose(obj.position, obj.quaternion, obj.scale);
      else local.copy(obj.matrix);
      if (obj === page.vmRoot) expect.copy(page.camera.matrixWorld);
      else if (parentWorld) expect.multiplyMatrices(parentWorld, local);
      else expect.copy(local);
      const a = expect.elements, b = obj.matrixWorld.elements;
      for (let i = 0; i < 16; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > worst) { worst = d; worstName = obj.name || obj.type; }
      }
      checked++;
      const here = expect.clone();
      for (const child of obj.children) walk(child, here);
    };
    walk(page.scene, null);
    walk(page.vmScene, null);
    return { worst, checked, worstName, frozen: page.frozenCount };
  };
}
