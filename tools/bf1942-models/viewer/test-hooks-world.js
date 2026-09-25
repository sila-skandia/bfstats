import { combatAreaRect } from './combat-area.js';
import { modeNames } from './game-modes.js';
import { boardRows } from './scoreboard.js';

/**
 * The level around the player: collision queries, the map surfaces and their
 * marks, the score board, the game mode, the combat area and a blast probe.
 * Split out of `test-hooks.js`; installed by it under `?shots`.
 *
 * `page` is the test hooks' own bag; this part reads:
 * `applyVehicleHit`, `bfmap`, `collider`, `combatArea`, `combatFrame`, `comms`,
 * `extras`, `friendlyMapUnits`, `friendlyVehicleNodes`, `gameHud`,
 * `localMapTeam`, `mapGate`, `mapVehicleMarks`, `MINIMAP_TEAM_TINT`, `modeNote`,
 * `paintScoreboard`, `params`, `roomClient`, `roomJoined`, `scoreboardOpen`,
 * `scoreboardPlayers`, `scoreFromSpawn`, `scoreLayout`, `setMapGate`,
 * `referee`, `setScoreboard`, `spawnersRoot`, `splashTargets`, `vehicleDamage`.
 */
export function installWorldHooks(page) {
  // microseconds-per-query number the feature doc quotes.
  window.__collision = () => page.collider && ({
    heightfield: page.collider.heightfield && {
      dim: page.collider.heightfield.dim,
      spacing: page.collider.heightfield.spacing,
      coverage: page.collider.heightfield.coverage,
      materials: Boolean(page.collider.heightfield.materials),
    },
    waterLevel: page.collider.waterLevel,
    statics: page.collider.statics && {
      triangles: page.collider.statics.count,
      cells: page.collider.statics.cols * page.collider.statics.rows,
      cellSize: page.collider.statics.cellSize,
      entries: page.collider.statics.cellItems.length,
    },
    cost: page.collider.drainCost(),
  });
  // The collider itself, for batch timing: `__castRay` allocates a point array
  // and a result object per call, which is most of what a per-cast number
  // measures if you time it through the wrapper.
  window.__colliderRef = () => page.collider;
  window.__castRay = (from, dir, dist) => {
    const length = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const hit = page.collider?.cast(from[0], from[1], from[2],
                               dir[0] / length, dir[1] / length, dir[2] / length,
                               dist, -1);
    return hit && { t: hit.t, point: [hit.x, hit.y, hit.z], kind: hit.kind,
                    material: hit.material, owner: hit.owner };
  };
  // Every world matrix in the scene checked against a fresh recompute, for
  // the perf harness: static subtrees opt out of three's per-frame matrix
  // walk (freezeStatics), and this is the proof that nothing frozen has
  // moved since. Returns the worst absolute element difference, the object
  // it was found on, how many objects were checked and how many are frozen.
  // The map surfaces' repaint gate (features/mesh-viewer-performance, rule
  // 7), switchable so a bench can set every-frame repaints -- the page before
  // dd165c5 -- against it without a reload. No argument reads it back.
  window.__mapGate = on => {
    if (on !== undefined) page.setMapGate(on);
    return page.mapGate;
  };
  // The minimap's zoom and rotation state (bfmap.js), so a headless check can
  // step the level, settle the ease and read the span without a key event.
  window.__bfmap = page.bfmap;
  // What the map surfaces mark as friendly this frame: the side they are
  // drawn for, the on-foot teammates that get an arrow (with the heading it
  // is drawn at) and the hulls a teammate is riding. A screenshot cannot say
  // whether a missing arrow is a culled marker or an empty list; this can.
  window.__mapMarks = () => ({
    team: page.localMapTeam(),
    // The flag sprite each control point draws: the flag it flies now.
    points: page.controlPointSprites(),
    tint: page.MINIMAP_TEAM_TINT[page.localMapTeam()] || null,
    onFoot: page.friendlyMapUnits(),
    crewed: [...page.friendlyVehicleNodes()].map(node => node.name),
    // Every hull the surfaces draw this frame, with its mark and where it
    // stands: the list a wreck or an enemy-crewed hull must be missing from.
    vehicles: page.mapVehicleMarks().map(({ node, kind }) => {
      const at = node.getWorldPosition(node.position.clone());
      return { name: node.name, kind, x: Math.round(at.x), z: Math.round(at.z) };
    }),
  });
  // The radio and the message log (comms.js): its state, a key press (the
  // browser pane never delivers a real F-key), and its event entry points.
  window.__comms = {
    state: () => page.comms.state(),
    paint: (w, h) => page.comms.paint(w, h),
    press: code => page.comms.keydown(new KeyboardEvent('keydown', { code, cancelable: true })),
    receive: (id, speaker) => page.comms.receive(id, speaker),
    onKill: (victim, killer, how = null) => page.comms.onKill(victim, killer, how),
    onCapture: (flag, team) => page.comms.onCapture(flag, team),
    // The referee's own damage path, so the kill line comes from the real hook.
    killBot: (id, attackerId = null, opts = {}) => page.referee.applyDamage(id, 1e6, attackerId, null, opts),
  };
  // The round (`round-state.js`): its two counters, what each side holds, and
  // one line per player it has counted something for.
  window.__round = () => {
    const round = page.round;
    if (!round) return null;
    return {
      tickets: { ...round.tickets },
      bleeding: { ...round.bleeding },
      held: { ...round.held },
      over: round.over,
      lossPerDeath: round.lossPerDeath,
      table: { ...round.table },
      counts: [...round.counts].map(([id, row]) => ({ id, ...row })),
    };
  };
  // The score board: open/close it, and read back what it lists.
  window.__scoreboard = {
    open: (fromSpawn = false) => page.setScoreboard(true, fromSpawn),
    close: () => page.setScoreboard(false),
    get isOpen() { return page.scoreboardOpen(); },
    get fromSpawn() { return page.scoreFromSpawn; },
    ready: () => !!page.scoreLayout.data,
    rows: () => boardRows(page.scoreboardPlayers(),
                          page.roomJoined && page.roomClient ? page.roomClient.feed : [],
                          page.roomJoined ? null : page.round?.counts ?? null),
    paint: () => page.paintScoreboard(true),
  };
  // Which gameplay layer `?mode=` landed on, and what else the level ships —
  // enough for a headless check to prove the flags, spawns and vehicles it is
  // looking at belong to the mode it asked for.
  window.__gameMode = () => ({
    active: page.extras?.gameplayMode || null,
    requested: page.params.get('mode'),
    note: page.modeNote,
    available: modeNames(page.extras),
    gameTypes: Object.fromEntries(
      Object.entries(page.extras?.gameTypes || {}).map(([k, v]) => [k, v?.mode])),
    controlPoints: (page.extras?.controlPoints || []).map(
      cp => ({ name: cp.name, team: cp.team, position: cp.position })),
    soldierSpawns: (page.extras?.soldierSpawns || []).length,
    spawnTeams: (page.extras?.soldierSpawns || []).reduce((acc, s) => {
      const key = String(s.team);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    objectSpawns: (page.extras?.objectSpawns || []).length,
    tickets: page.extras?.tickets || null,
    vehicles: page.spawnersRoot
      ? page.spawnersRoot.children.map(v => v.name).sort()
      : [],
  });

  // The combat area and what it is doing to the body this frame: the rect the
  // level declared, the engine's two constants, and the live accumulator. A
  // headless check teleports out, steps frames and reads the countdown and
  // the HP down the same path a walk would take.
  //
  // The two constants are settable here for the same reason `__setAmmo` and
  // `__damage` exist: the engine's real allowance is 10 seconds, and under
  // `__renderOnce` a frame is a capped 0.1 s of sim, so reaching the damage
  // honestly costs 100 forced frames — more than SwiftShader survives in one
  // session. Overriding them exercises the identical code path on a shorter
  // clock; the engine's own values are what the module defaults to and what
  // `tests/test_combat_area.py` pins.
  const combatAreaState = () => ({
    active: page.combatArea.active,
    hasRect: page.combatArea.hasRect,
    rect: page.combatArea.rect,
    timeAllowed: page.combatArea.timeAllowed,
    damagePerSecond: page.combatArea.damagePerSecond,
    // CA-5. Null switches the painted half off; the engine's own value is 7.
    materialToGiveDamage: page.combatArea.materialToGiveDamage,
    // What the level actually paints, so a check can find a painted patch
    // rather than hunt for one: the histogram the extractor already writes.
    materialHistogram: page.extras?.terrain?.materials?.histogram ?? null,
    outsideFor: page.combatArea.outsideFor,
    frame: page.combatFrame,
    hud: {
      time: page.gameHud.vars['Outside/OutsideTime'],
      text: page.gameHud.vars['Outside/OutsideText'],
    },
  });
  window.__combatArea = (options) => {
    if (options && Number.isFinite(options.timeAllowed)) {
      page.combatArea.timeAllowed = options.timeAllowed;
    }
    if (options && Number.isFinite(options.damagePerSecond)) {
      page.combatArea.damagePerSecond = options.damagePerSecond;
    }
    // The rect is settable for the same reason the two constants are, and
    // specifically so the SEATED case can be checked: a vehicle with a
    // drivetrain writes its own `state.position` into its scene node every
    // frame, so a check cannot drive one out of the area by moving the node,
    // and flying 400 m under `__renderOnce` costs more forced frames than a
    // browser session survives. Moving the boundary instead exercises the
    // identical path on a shorter clock. `null` restores the level's own.
    if (options && 'rect' in options) {
      page.combatArea.rect = options.rect ? { ...options.rect } : combatAreaRect(page.extras);
      page.combatArea.reset();
    }
    // Same reasoning for the painted half: a check that wants to prove CA-5
    // fires would otherwise have to walk to a patch of material 7, and one
    // that wants to prove it is OFF on an unpainted level has nothing to
    // switch. `null` runs the rectangle alone; an integer names another id.
    if (options && 'materialToGiveDamage' in options) {
      const id = options.materialToGiveDamage;
      page.combatArea.materialToGiveDamage = Number.isInteger(id) ? id : null;
      page.combatArea.reset();
    }
    return combatAreaState();
  };
  // Set a blast off at an exact point, through the page's own splash path.
  //
  // The same shape as `__damage` and `__damageVehicle`: the thing a headless
  // check cannot otherwise do is place an explosion where it can do the
  // arithmetic. A fired round lands where the ballistics put it, and its
  // centre is `hitPos + 0.1 * normal` (HP-9) which nothing reports — so the
  // distance term, which is the whole point of the assertion, would have to
  // be guessed. This builds the record `effects-core.js`'s `splashSpec` builds
  // and hands it to `applyVehicleHit`, so `splashTargets()`,
  // `soldierExposureFor` and `VehicleDamageSet.applySplash` all run exactly as
  // a shell's do; only the ballistics are skipped.
  //
  // There is no damage argument, and that is the engine: how much a blast is
  // worth is `materialDamage(material2) * damageMod(material2, victim)`, out
  // of the MaterialManager tables (DMG-1). Only the geometry is passed in.
  // Defaults are a hand grenade's — material2 205, radius 10,
  // `YModOnExplosion` 1.0.
  window.__blast = (point, {
    radius = 10, material2 = 205, yMod = 1, firer = -1,
  } = {}) => {
    if (!Array.isArray(point) || point.length !== 3) return null;
    const before = page.splashTargets().filter(t => t.soldier)
      .map(t => t.armor.hitPoints);
    page.applyVehicleHit({
      splashPoint: point, splashRadius: radius,
      splashMaterial2: material2, splashYMod: yMod, firer,
    });
    const after = window.__soldiers(point);
    return after.map((row, i) => ({ ...row, lost: before[i] - row.hp }));
  };
  // A round's direct hit on a hull, by owner id, through the page's own
  // `applyVehicleHit` (the `guns.onImpact` path): what `__blast` is for a
  // splash. The tier, the crew's wash and the rest run as a real round's do;
  // only the ballistics are skipped. `from` is where it was fired, the
  // record's `origin` (`Projectile+0x134`, ledger HFD-4); without it the wash
  // has no arc.
  window.__roundHit = (owner, damage, from = null) => {
    const vehicle = page.vehicleDamage.get(owner);
    if (!vehicle) return null;
    page.applyVehicleHit({ kind: 'object', owner, damage, origin: from });
    return { hp: vehicle.hitPoints, destroyed: vehicle.destroyed };
  };
  // The world's supply readback for the local player: what the last tick's
  // depot pass reported (`world-fields.js` `supplyTick`), and the field's
  // own shape. A headless check for the airstrip rearm reads `supply` off a
  // parked, seated stretch — ammo-only depots report `gaveAmmo` on the
  // cycles they fire.
  window.__supply = () => {
    const world = page.world ?? null;   // the level's world, via the hooks bag
    const player = world ? world.players.get(page.LOCAL_PLAYER) : null;
    return {
      world: !!world,
      result: player ? { ...player.supplyResult } : null,
      seated: !!(player?.occupancy?.root),
      hasSoldier: !!player?.soldier,
      depots: world ? world.supplyField.depots.length : 0,
    };
  };
  // Every registered damageable object, with its world position and armor
  // state: the harness's stand-in for walking `page.damageVisuals`, which
  // repairs (`hand-fire.js`'s wrench sweep) and blast tests both read.
  window.__vehicles = () => [...page.damageVisuals].map(([owner, visual]) => {
    const veh = page.vehicleDamage.get(owner);
    // The node's world translation straight off its matrix (test hooks stay
    // free of a three.js import).
    const e = visual.node.matrixWorld.elements;
    return {
      owner, name: visual.node.name,
      hp: veh ? veh.hitPoints : null, max: veh ? veh.maxHitPoints : null,
      destroyed: veh ? veh.destroyed : null, wrecked: !!visual.wrecked,
      x: e[12], y: e[13], z: e[14],
    };
  });
  // Every soldier a blast can reach, and what HP-10 would give him from a
  // given point. The exposure is the thing worth reading back: it is the one
  // term in the splash product that a screenshot cannot show, and a check that
  // wants to prove a wall works needs the same number from both sides of it.
}
