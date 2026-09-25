// The entry rule on a real level, in the headless runner (`sim/stage.mjs`
// plays the page's own vehicles: `vehicle-instance.js`, `bot-units.js`, the
// referee's seating). Berlin: the Allies (team 2) field the T34 and the T34-85,
// the Axis (team 1) the PanzerIV, Tiger and Hanomag. One recipe per run,
// printed as one JSON line. Run by `tests/test_vehicle_team.py`.
//
//   node tests/vehicle_team_harness.mjs <viewer assets dir> <recipe> [viewer modules dir]
//
// The third argument loads the bots and vehicles from another checkout's
// viewer (a before/after comparison); the default is this one's.
//
//   gate   an Allied bot drives the T34-85: an Axis bot is refused its free MG
//          seat when told to take it, and left to itself beside it never
//          weighs it; it steals the empty T34; an Allied bot takes the MG seat;
//          the T34-85 emptied is anybody's again.
//   match  a whole match, 8 a side: every mount, and every tick a hull holds
//          two sides at once.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIM = path.join(HERE, '..', 'sim');
const { viewerDir, loadViewerModules, seedMathRandom, routeConsole } = await import(path.join(SIM, 'env.mjs'));
const { realLevel } = await import(path.join(SIM, 'level.mjs'));
const { Match } = await import(path.join(SIM, 'match.mjs'));

const [assets, recipe, viewerOverride] = process.argv.slice(2);
const M = await loadViewerModules(viewerDir(viewerOverride ?? path.join(HERE, '..', 'viewer')));
routeConsole(true);

async function start(botsPerSide, seed, duration = 3600) {
  seedMathRandom(seed);
  const level = await realLevel(M, { maps: path.join(assets, 'maps'), models: path.join(assets, 'models'), map: 'berlin' });
  seedMathRandom(seed);
  const match = new Match({ M, level, botsPerSide, duration, seed, sink: null });
  match.setup();
  return match;
}

const round = v => Math.round(v * 1000) / 1000;

/** Every occupied hull whose seats hold players of more than one side. */
function mixedHulls(match) {
  const out = [];
  for (const inst of match.stage.vehicles.instances.values()) {
    const sides = new Set();
    for (const pid of inst.seats.values()) {
      const team = match.world.player(pid)?.team;
      if (team) sides.add(team);
    }
    if (sides.size > 1) out.push({ hull: inst.root.name, seats: Object.fromEntries(inst.seats) });
  }
  return out;
}

/** The nearest free seat `seat` ('driver' or a seat id) of `template` to a bot. */
function candidate(match, b, template, seat = 'driver') {
  const p = b.getPosition();
  const cands = match.stage.units.candidates().filter(c => !c.occupiedBy && c.template === template
    && (seat === 'driver' ? c.isRoot : c.seatId === seat));
  cands.sort((x, y) => Math.hypot(x.pos[0] - p[0], x.pos[2] - p[2]) - Math.hypot(y.pos[0] - p[0], y.pos[2] - p[2]));
  return cands[0] ?? null;
}

/** A frozen-free soldier placed at (x, z). */
function place(match, b, x, z) {
  const y = match.groundAt(x, z);
  match.world.player(b.playerId).soldier.spawn(x, y, z, 0);
  b.setPosition(x, y, z);
  b.route = null;
  b.onRespawn();
}

const recipes = {
  async gate() {
    const match = await start(4, 3);
    const axis = match.bots.filter(o => o.team === 1);
    const allies = match.bots.filter(o => o.team === 2);
    const [driver, t34Holder, friend] = allies;
    const thief = axis[0];
    // Everyone but the thief stops thinking.
    for (const b of match.bots) if (b !== thief) b.tick = () => {};
    const out = { teams: { driver: driver.team, thief: thief.team } };
    const seat = cand => ({ template: cand.template, seat: cand.seatId });
    // The Allied driver takes the T34-85, another Allied bot the T34 (one
    // seat): the only free hull seat about is the T34-85's MG.
    const t3485 = candidate(match, driver, 'T34-85');
    out.driverSeated = match.referee.enterVehicle(driver, t3485);
    out.t34HolderSeated = match.referee.enterVehicle(t34Holder, candidate(match, t34Holder, 'T34'));
    match.stage.units.invalidate?.();
    const mg = match.stage.units.candidates().find(c => c.template === 'T34-85' && !c.isRoot);
    out.mgCandidate = { ...seat(mg), occupiedBy: mg.occupiedBy, hullTeam: mg.hullTeam ?? null };
    // 1. Told to take it (the page's `__botMount`): the referee's seating.
    out.directed = match.referee.enterVehicle(thief, mg);
    out.directedSeat = thief.vehicle ? seat(thief.vehicle) : null;
    if (thief.vehicle) match.referee.leaveVehicle(thief);
    out.hullAfterDirected = Object.fromEntries(match.stage.vehicles.instanceOf(t3485.node)?.seats ?? []);
    // 2. Left to itself 9 m off the MG's door, fighting switched off so the
    //    Change behaviour decides.
    thief._urgencyFire = () => 0;
    thief._urgencyTakeCover = () => 0;
    place(match, thief, mg.entry[0] + 9, mg.entry[1]);
    const bests = new Map();
    let mounted = null, nearestToDoor = Infinity;
    const end = match.clock + 20;
    while (match.clock < end - 1e-9) {
      match.step();
      const best = thief._changeResult?.best?.cand;
      if (best) bests.set(`${best.template}:${best.seatId}`, (bests.get(`${best.template}:${best.seatId}`) ?? 0) + 1);
      const p = thief.getPosition();
      nearestToDoor = Math.min(nearestToDoor, Math.hypot(p[0] - mg.entry[0], p[2] - mg.entry[1]));
      if (thief.vehicle && !mounted) mounted = { ...seat(thief.vehicle), t: round(match.clock) };
      if (mounted) break;
    }
    out.natural = { bests: Object.fromEntries(bests), mounted, nearestToDoor: round(nearestToDoor) };
    if (thief.vehicle) match.referee.leaveVehicle(thief);
    // 3. The T34 emptied: the Axis bot steals it.
    match.referee.leaveVehicle(t34Holder);
    match.stage.units.invalidate?.();
    out.steal = match.referee.enterVehicle(thief, candidate(match, thief, 'T34'));
    out.stealSeat = thief.vehicle ? seat(thief.vehicle) : null;
    // 4. A friend takes the free MG seat of the Allied T34-85.
    match.stage.units.invalidate?.();
    out.friend = match.referee.enterVehicle(friend, candidate(match, friend, 'T34-85', mg.seatId));
    out.hullWithFriend = Object.fromEntries(match.stage.vehicles.instanceOf(t3485.node)?.seats ?? []);
    // 5. Both Allies out: nobody's hull, and the Axis may take it.
    match.referee.leaveVehicle(friend);
    match.referee.leaveVehicle(driver);
    match.referee.leaveVehicle(thief);
    match.stage.units.invalidate?.();
    const freed = match.stage.units.candidates().find(c => c.template === 'T34-85' && c.isRoot);
    out.freedHullTeam = freed.hullTeam ?? null;
    out.thiefTakesFreed = match.referee.enterVehicle(thief, freed);
    return out;
  },

  async match() {
    const seconds = Number(process.env.TEAM_MATCH_SECONDS ?? 60);
    const match = await start(8, 3, seconds);
    let mixedTicks = 0;
    const mixedHullNames = new Set();
    const mountsIntoEnemyHull = [];
    let mounts = 0;
    const referee = match.referee;
    const enter = referee.enterVehicle;
    referee.enterVehicle = (bot, cand) => {
      // The hull's crew before the bot gets in.
      const inst = match.stage.vehicles.instanceOf(cand.node);
      const crew = inst ? [...inst.seats.values()].map(pid => match.world.player(pid)?.team ?? 0) : [];
      const ok = enter(bot, cand);
      if (ok) {
        mounts++;
        if (crew.some(t => t && t !== bot.team)) {
          mountsIntoEnemyHull.push({ t: round(match.clock), bot: bot.playerId, side: bot.team, hull: cand.template, seat: cand.seatId, crew });
        }
      }
      return ok;
    };
    while (!match.ended && match.clock < seconds - 1e-9) {
      match.step();
      const mixed = mixedHulls(match);
      if (mixed.length) {
        mixedTicks++;
        for (const m of mixed) mixedHullNames.add(m.hull);
      }
    }
    return { seconds: round(match.clock), mounts, mountsIntoEnemyHull, mixedTicks, mixedHulls: [...mixedHullNames] };
  },
};

const fn = recipes[recipe];
if (!fn) throw new Error(`unknown recipe ${recipe}`);
process.stdout.write(`${JSON.stringify(await fn())}\n`);
process.exit(0);
