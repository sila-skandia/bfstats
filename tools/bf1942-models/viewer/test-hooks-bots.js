import { findPath, gridAt } from './nav-grid.js';

/**
 * The bots: their controllers, vehicle candidates, mounts, the nav map and a
 * probe of it, and the per-bot AI state. Split out of `test-hooks.js`;
 * installed by it under `?shots`.
 *
 * `page` is the test hooks' own bag; this part reads:
 * `botBodies`, `botUnits`, `collectEntryPoints`, `entryPoints`, `referee`,
 * `vehicleSpawnActive`, `world`.
 */
export function installBotHooks(page) {
  window.__botCtl = id => page.referee.bots.find(b => b.playerId === id) ?? null;
  window.__botVehicleDebug = () => {
    if (!page.entryPoints) page.collectEntryPoints();
    const roots = [...new Set((page.entryPoints ?? []).map(e => e.vehicle))];
    return {
      aiLoaded: page.botUnits.ai?.size ?? null, entries: page.entryPoints?.length ?? null, roots: roots.length,
      sample: roots.slice(0, 12).map(n => ({ name: n.name, template: n.userData?.template ?? null, control: n.userData?.control ?? null,
        kind: page.botUnits.kindOf(n), active: page.vehicleSpawnActive(n), ai: page.botUnits.aiOf(n)?.name ?? null })),
    };
  };
  window.__botVehicles = () => page.botUnits.candidates().map(c => ({ template: c.template, seat: c.seatId, root: c.isRoot, kind: c.kind, pos: c.pos.map(v => +v.toFixed(0)), entry: c.entry.map(v => +v.toFixed(0)), r: c.entryRadius, health: c.health, maxSpeed: c.maxSpeed, occupiedBy: c.occupiedBy, driver: c.driver, upright: c.upright, strengths: c.strengths, value: c.value }));
  window.__botMount = (id, template = null, seat = 'driver') => {
    const bot = page.referee.bots.find(b => b.playerId === id);
    const cands = page.botUnits.candidates().filter(c => !c.occupiedBy && (!template || c.template === template)
      && (seat === 'any' || (seat === 'driver' ? c.isRoot : c.seatId === seat)));
    if (!bot || !cands.length) return false;
    const p = bot.getPosition();
    cands.sort((a, b) => Math.hypot(a.pos[0] - p[0], a.pos[2] - p[2]) - Math.hypot(b.pos[0] - p[0], b.pos[2] - p[2]));
    return page.referee.enterVehicle(bot, cands[0]);
  };
  window.__botDismount = id => { const bot = page.referee.bots.find(b => b.playerId === id); if (bot?.vehicle) page.referee.leaveVehicle(bot); return !bot?.vehicle; };
  // The bots' bodies on the page: each live bot's drawn family and seat, and
  // every corpse still down (`bot-visuals.js`), so a headless check can tell a
  // death that played from one that was hidden.
  window.__botBodies = () => page.botBodies.debug();
  // A player's hit capsules this frame (`skeleton-hit.js`), as the referee
  // resolves rounds against them: null where nobody is drawn.
  window.__capsules = id => page.referee.capsulesOf(id);
  window.__navMap = () => page.referee.navGrid;
  /** Every bot map's size: the infantry map, the land vehicles' and each
   *  water map built so far; `build` builds the vehicle map and the Boat and
   *  LandingCraft maps first, as a bot taking a hull would. */
  window.__botNavMaps = (build = false) => {
    const u = page.botUnits;
    if (build) { u.vehicleNav(); u.waterNav('Boat'); u.waterNav('LandingCraft'); }
    const size = nav => (nav ? { worldSize: nav.worldSize, width: nav.width, cellSize: nav.cellSize } : null);
    return {
      infantry: size(page.referee.navGrid),
      vehicle: size(u.navVehicle),
      water: Object.fromEntries([...u.navWater].map(([name, nav]) => [name, size(nav)])),
      candidatesAt: u.candidateCache.at,
    };
  };
  window.__navProbe = (fx, fz, tx, tz) => {
    if (!page.referee.navGrid) return null;
    const path = findPath(page.referee.navGrid, fx, fz, tx, tz);
    return {
      startCell: gridAt(page.referee.navGrid, fx, fz),
      endCell: gridAt(page.referee.navGrid, tx, tz),
      pathLen: path ? path.length : null,
      path,
      width: page.referee.navGrid.width,
      height: page.referee.navGrid.height,
      cellSize: page.referee.navGrid.cellSize,
    };
  };
  window.__bots = () => page.referee.bots.map(b => ({
    id: b.playerId, name: b.name,
    pos: b.getPosition(), yaw: b.yaw,
    behaviour: b.currentBehaviour, forward: b.moveForward, strafe: b.moveStrafe,
    firing: b.isFiring, target: b.firingTarget,
    objective: b.objective?.name ?? null,
    waypoint: b.waypoint,
    goal: b.objectiveGoal,
    goalReached: b.goalReached,
    routePoints: b.route?.points?.length ?? 0,
    routeIndex: b.route?.index ?? 0,
    routeCoarse: b.route?.coarse?.length ?? 0,
    routeFailed: b.route?.failed ?? null,
    steer: b._dbgSteer ?? null,
    obstacles: b.obstacles?.length ?? 0,
    stalledTicks: b._stalledTicks ?? 0,
    pathFailures: b._pathFailures ?? 0,
    urgency: Object.fromEntries(Object.entries(b.urgency ?? {}).map(([k, v]) => [k, +v.toFixed(3)])),
    order: b.waypoints ? { area: b.waypoints.area?.name ?? null, radius: b.waypoints.radius } : null,
    kit: b.kit ?? null,
    weapon: b.weaponAi?.name ?? null,
    memory: b.senses?.memory?.size ?? 0,
    candidates: b.senses?.lastCandidates ?? 0,
    heal: b._medicResult?.targetId ?? null,
    vehicle: b.vehicle?.template ?? null,
    change: b._changeResult?.best ? { id: b._changeResult.best.cand?.template, seat: b._changeResult.best.cand?.seatId ?? null, u: +b._changeResult.best.u.toFixed(2), d: +b._changeResult.best.dist.toFixed(1), teleport: !!b._changeResult.teleport, bail: !!b._changeResult.bail } : null,
    attackPhase: b._attackPhase ?? null,
    attack: b._attackDbg ?? null,
    enemyTypes: b.enemyTables ? Object.fromEntries(Object.entries(b.enemyTables.types).filter(([, v]) => v > 0).map(([k, v]) => [k, +v.toFixed(2)])) : null,
    steerAngle: b._dbgSteerAngle ?? null,
    ammo: b.weaponAi?.ammo ?? null, reload: +((b._mags?.get(b.weaponAi?.name)?.reloadLeft) ?? 0).toFixed(2),
    aimDev: +(b.aimDeviation ?? 0).toFixed(2), rof: page.referee.weaponDataOf(b)?.roundOfFire ?? null,
    senseSub: b.senses?.substate ?? 0,
    plan: (b.currentPlan ?? []).map(a => `${a.type}${a.done ? '*' : ''}`),
    heard: b.senses?.heard?.size ?? 0,
    strategy: page.referee.strategy ? (page.referee.strategy.sides[b.team]?.active?.strategy?.name ?? null) : null,
    speed: +((page.world?.player(b.playerId)?.soldier?.speed ?? 0)).toFixed(2),
    team: b.team,
    hp: page.world?.armorOf(b.playerId)?.hitPoints ?? null,
    dead: !!page.world?.armorOf(b.playerId)?.destroyed,
    respawnIn: +((b._respawnIn ?? 0)).toFixed(2),
    lookX: b.lookX, lookY: b.lookY,
    blockedSpawn: page.world?.player(b.playerId)?.spawn?.blockedReason ?? null,
    rigFamilies: Object.keys(page.botBodies.botVisuals.get(b.playerId)?.rig?.families ?? {}),
    clipFamily: page.botBodies.botVisuals.get(b.playerId)?.want ?? null,
    mixerTime: +(page.botBodies.botVisuals.get(b.playerId)?.rig?.mixer?.time ?? 0).toFixed(2),
    lastInput: page.world?.player(b.playerId)?.last?.input ?? null,
    lookApplied: page.world?.player(b.playerId)?.lookApplied ?? null,
    soldier: page.world?.player(b.playerId)?.soldier
      ? {
          pos: [page.world.player(b.playerId).soldier.x, page.world.player(b.playerId).soldier.y,
                page.world.player(b.playerId).soldier.z],
          gait: page.world.player(b.playerId).soldier.gait,
          grounded: page.world.player(b.playerId).soldier.grounded,
          v: page.world.player(b.playerId).soldier.body?.velocity ?? null,
        }
      : null,
  }));
  // Free-fly heading. Setting `camera.rotation` directly is pointless here —
  // `applyLook` rewrites it from `look` on every frame — so a headless check
  // that wants to face the camera somewhere has to move this instead.
}
