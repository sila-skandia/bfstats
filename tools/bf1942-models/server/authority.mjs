// The P3 authority: the room server's half of the damage, death, ticket and
// flag-capture law — the part nobody else runs. Citations for every number:
// the parity round's ticket item 9 (`features/bf1942-parity-round-2026-09-19`:
// "a death count (`setTicketLosePerDeath`, GameServer `0x0813d700`), a
// flag-majority timer (`setTicketLostPerMin` drains only while the other side
// holds more than half the flags)... and somewhere to put the result"), and
// `features/bf1942-engine-reference/subsystems/hitpoints-and-damage.md` for
// the Armor law itself.
//
// What this file owns:
//
// * the player's Armor at spawn, built from `_shared/loadouts.json` the same
//   way the page builds its own (`map.html`'s `soldierMaxHp`:
//   `kits[kit].maxHitpoints`, fallback 30) — one law, two constructions,
//   both from the same published sidecar;
// * the death decree: the world's own damage funnels (the combat area, crash
//   costs, the vehicle water/critical pass) all land on the player's Armor
//   during `step`; this pass is the one that notices a destroyed Armor and
//   makes it a death — the `killed` row, the ticket, the dead-until-respawn
//   latch. No client can damage anything: every Armor that dies here took
//   its damage from the server's own sim in the same tick;
// * the ticket law: one per death (`setTicketLosePerDeath`), and
//   `lossPerMin` drained once a second while the OTHER side holds more than
//   half the capturable flags (`setTicketLostPerMin`'s majority gate);
// * flag capture: a live player of the opposing team inside the flag's ring
//   for `FLAG_CAPTURE_SECONDS` un-contested flips the owner. The capture law
//   itself was never read (the parity round left it open), so
//   `FLAG_CAPTURE_RADIUS_MS = 8` and `FLAG_CAPTURE_SECONDS = 8` are authored
//   constants, named so a P5 corpus read can correct them in one place.
//
// The projectile path (the headless `GunFire` wiring and its splash) is the
// deliberate remaining gap — P3's second slice, in the feature README.
// Until it lands the only damage in a room is combat-area, water/critical
// and crash damage, which the rooms' synthetic test level exercises.

import { Armor } from '../viewer/armor.js';

/** One per death, `setTicketLosePerDeath`. */
export const LOSS_PER_DEATH = 1;

/** Metres from the flag's origin an enemy must stand (P5 verifies). */
export const FLAG_CAPTURE_RADIUS_MS = 8;

/** Fallback seconds of un-contested enemy presence to flip the owner. */
export const FLAG_CAPTURE_SECONDS = 8;

/** The page's own fallback (`SOLDIER_MAX_HP_FALLBACK`): every vanilla kit
 *  ships `maxHitpoints: 30` (`verify-r4.md` R4-25). */
const SOLDIER_MAX_HP_FALLBACK = 30;

/** The deploy screen's five classes, in its order (`map.html`'s `KITS`). */
const KITS = ['scout', 'assault', 'antitank', 'medic', 'engineer'];

/**
 * The authority for one room. `ctx`:
 *   world     the room's World
 *   loadouts  `_shared/loadouts.json` (null on a bare harness)
 *   levelDir  the level's directory name (the page's `currentDir`)
 *   ownerOf   (seatRootNode) => the world owner id of the room vehicle
 *             whose subtree that node's root is (the room's table lookup)
 *   onRow     (row) => {}  the room's event broadcaster
 */
export function createAuthority(ctx) {
  const { world, loadouts, levelDir, onRow } = ctx;

  /** Slots under the death decree: dead until their spawn action revives
   *  them. The room stops forwarding their input while they are in the set
   *  (the world idles the body). */
  const dead = new Set();

  /** flag index -> {team, ticks} — an enemy inside the ring, accumulating.
   *  Contested (both teams present) freezes; an empty|defended ring resets. */
  const capture = new Map();
  let bleedAccumulator = 0;

  /** The Armor a player of `team` spawning with the deploy screen's kit
   *  gets — the page's own `soldierMaxHp` law over the same sidecar.
   *  `kitName` is the spawn row's `kit`; a kit the file does not know (or
   *  no kit at all) falls back to the level's slot-0 class for the team,
   *  exactly the way a deploy before the screen's choice lands does. */
  function armorFor(team, kitName) {
    let max = SOLDIER_MAX_HP_FALLBACK;
    if (loadouts?.kits) {
      const side = loadouts?.levels?.[levelDir]?.[team];
      const known = kitName && loadouts.kits[kitName] ? kitName : null;
      const slot = known ? Math.max(0, KITS.indexOf(known)) : 0;
      const kit = known
        ?? side?.slots?.[String(slot)]
        ?? Object.values(side?.slots || {})[0];
      const hp = kit && loadouts.kits[kit]?.maxHitpoints;
      if (Number.isFinite(hp)) max = hp;
    }
    return new Armor(max);
  }

  /** The current ticket count of a team (the room's world owns the raw
   *  object; the wire rows carry these numbers). The published sidecars
   *  use `team1`/`team2`; the harness's old descriptor used bare `1`/`2` —
   *  either answers. */
  const ticketsOf = team => {
    const t = world.tickets;
    if (!t) return 0;
    return t[`team${team}`] ?? t[team] ?? 0;
  };

  return {
    KITS,
    dead,

    /** The room's spawn path calls this before `world.spawnPlayer`: the
     *  fresh Armor on the kit's max, and the death decree lifted. */
    revive(slot, team, kitName) {
      dead.delete(slot);
      const armor = armorFor(team, kitName);
      world.setPlayerArmor(slot, armor);
      return armor;
    },

    /** Whether a slot may send input: the dead do not. The room checks this
     *  before forwarding `MSG_INPUT` (the world would otherwise keep
     *  stepping the corpse — the page's own loop stops at `soldierDead`). */
    mayInput(slot) {
      return !dead.has(slot);
    },

    /** One world step's worth of the authority: deaths first (every damage
     *  funnel lands on Armors during `step`), then the flags and the bleed
     *  on their own accumulators. `step` is the world's report, `dt` the
     *  room's tick. */
    afterStep(step, dt) {
      decreeDeaths(step);
      flagsAndBleed(dt);
    },
  };

  /** The deaths a step produced (see afterStep). */
  function decreeDeaths(step) {
      // Attribution for this tick's kills, before the general pass: the
      // crash report names the other object's owner; a vehicle that died
      // (water/critical) takes its occupants with it.
      const killers = new Map();
      for (const crash of step?.crashes ?? []) {
        if (!crash.kill) continue;
        const victim = ownerToPlayer(crash.owner);
        const killer = ownerToPlayer(crash.other);
        if (victim != null) killers.set(victim, killer);
      }
      for (const change of step?.damage ?? []) {
        if (!change.died) continue;
        const victim = ownerToPlayer(change.vehicle);
        if (victim != null && !killers.has(victim)) killers.set(victim, null);
      }
      // The general pass: a player with a destroyed Armor is dead, once.
      for (const [slot, player] of world.players) {
        if (!player?.armor?.destroyed || dead.has(slot)) continue;
        dead.add(slot);
        if (spendTicket(player.team, LOSS_PER_DEATH)) {
          onRow({ type: 'ticket', team: player.team,
                  count: ticketsOf(player.team), reason: 'death' });
        }
        const row = { type: 'killed', slot };
        const other = killers.get(slot) ?? player.armor.lastHit ?? null;
        if (other != null) row.other = other;
        onRow(row);
      }
  }

  /** One call's worth of the flags-and-bleed law, at the room's tick
   *  cadence; the engine's own clock is per-second, accumulated here. */
  function flagsAndBleed(dt) {
    const flags = world.flags ?? [];
    if (!flags.length) return;

    // Capture first: owner changes move the majority this same loop.
    for (const [index, flag] of flags.entries()) {
        if (flag.uncapturable || !flag.position) continue;
        let progress = capture.get(index);
        const inside = ringPopulation(flag);
        if (inside.contest) {
          if (progress && progress.status !== 'contested') {
            progress.status = 'contested';
            onRow({ type: 'captureContested', flag: index, name: flag.name });
          }
          if (progress) { progress.team = 0; progress.ticks = 0; }
          continue;
        }
        if (inside.team !== 0 && inside.team !== flag.team) {
          if (!progress) { progress = { team: 0, ticks: 0 }; capture.set(index, progress); }
          if (progress.team !== inside.team) {
            progress.team = inside.team;
            progress.ticks = 0;
            progress.status = 'capturing';
            onRow({ type: 'capturing', flag: index, team: inside.team,
                    name: flag.name, duration: captureSeconds(flag) });
          } else if (progress.status === 'contested') {
            progress.status = 'capturing';
            onRow({ type: 'capturing', flag: index, team: inside.team,
                    name: flag.name, duration: captureSeconds(flag) });
          }
          progress.ticks += dt;
          if (progress.ticks >= captureSeconds(flag)) {
            flag.team = inside.team;
            capture.delete(index);
            onRow({ type: 'captured', flag: index, team: inside.team, name: flag.name });
          }
        } else if (progress) {
          if (progress.ticks || progress.status === 'contested') {
            onRow({ type: 'captureCancelled', flag: index, name: flag.name });
          }
          capture.delete(index);
        }
      }

      // The bleed: `lossPerMin` drains once a second while the other side
      // holds more than half the capturable flags (the fleet's uncapturable
      // points are the engine's `unableToChangeTeam` — never counted).
      const lossPerMin = world.tickets?.lossPerMin;
      if (!lossPerMin) return;
      bleedAccumulator += dt;
      if (bleedAccumulator < 1) return;
      bleedAccumulator = 0;
      const capturable = flags.filter(f => !f.uncapturable).length;
      if (capturable === 0) return;
      for (const victim of [1, 2]) {
        const owner = victim === 1 ? 2 : 1;
        const owned = flags.filter(f => f.team === owner).length;
        if (owned * 2 <= capturable) continue;   // no strict majority, no bleed
        const perSecond = lossPerMin[`team${victim}`] / 60;
        if (!(perSecond > 0)) continue;
        if (spendTicket(victim, perSecond)) {
          onRow({ type: 'ticket', team: victim,
                  count: ticketsOf(victim), reason: 'flag_majority' });
        }
      }
  }

  // --- the law's helpers ----------------------------------------------------

  function captureSeconds(flag) {
    return Number.isFinite(flag.timeToGetControl) && flag.timeToGetControl > 0
      ? flag.timeToGetControl : FLAG_CAPTURE_SECONDS;
  }

  /** One ticket down for `team`; false when it was already at 0. The
   *  world owns the tickets object, raw from scene.json — counts mutate in
   *  place (both key spellings, so a harness descriptor's legacy `1`/`2`
   *  shape stays coherent) and the wire rows carry the fresh numbers. */
  function spendTicket(team, amount) {
    const t = world.tickets;
    if (!t) return false;
    const key = `team${team}`;
    const legacy = `${team}`;
    const now = t[key] ?? t[legacy] ?? null;
    if (now == null || !Number.isFinite(now)) return false;
    const next = Math.max(0, now - amount);
    if (next === now) return false;
    t[key] = next;
    if (legacy in t) t[legacy] = next;
    return true;
  }

  /** The live (~= not dead) players standing inside a flag's ring. The
   *  engine's contest rule is the simple one: both teams present freezes. */
  function ringPopulation(flag) {
    let axis = 0;
    let allies = 0;
    const fx = flag.position[0];
    const fz = flag.position[2];
    const radius = Number.isFinite(flag.radius) && flag.radius > 0
      ? flag.radius : FLAG_CAPTURE_RADIUS_MS;
    const r2 = radius * radius;
    for (const [slot, player] of world.players) {
      if (dead.has(slot)) continue;
      if (player.armor?.destroyed) continue;
      let x = NaN, z = NaN;
      if (player.occupancy?.root && player.vehicle) {
        const s = player.vehicle.state.position;
        x = s.x; z = s.z;
      } else if (player.soldier) {
        x = player.soldier.x; z = player.soldier.z;
      }
      if (!Number.isFinite(x)) continue;
      const dx = x - fx;
      const dz = z - fz;
      if (dx * dx + dz * dz > r2) continue;
      if (player.team === 1) axis += 1;
      else if (player.team === 2) allies += 1;
    }
    const contest = axis > 0 && allies > 0;
    const team = axis > 0 ? 1 : allies > 0 ? 2 : 0;
    return { team: contest ? 0 : team, contest };
  }

  /** A room vehicle entry's owner id -> the slot occupying or driving it
   *  (the crash/water reports arrive owner-keyed). The room wires `ownerOf`
   *  with its own table so the lookup is one map hop, not a scan. */
  function ownerToPlayer(owner) {
    if (ctx.ownerOf && owner != null) {
      for (const [slot, player] of world.players) {
        if (!player.occupancy?.root) continue;
        if (ctx.ownerOf(player.occupancy.root) === owner) return slot;
      }
    }
    return null;
  }
}
