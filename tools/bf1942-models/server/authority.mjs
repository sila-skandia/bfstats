// The P3 authority: the room server's half of the damage, death, ticket and
// flag-capture law — the part nobody else runs. Citations for every number:
// the parity round's ticket item 9 (`features/bf1942-parity-round-2026-09-19`:
// "a death count (`setTicketLosePerDeath`, GameServer `0x0813d700`)... and
// somewhere to put the result"), ledger rows TKT-4 and TKT-5
// (`features/bf1942-engine-reference/ledger.md`) for the bleed, and
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
// * the ticket law, played on the page's own round (`viewer/round-state.js`
//   `createRoundState`, which the headless runner plays too): one whole
//   ticket per death (`setTicketLosePerDeath`), and the bleed of ledger TKT-4,
//   read from `GameServer::gameStatusPlaying` 0x08150df0. A side loses one
//   whole ticket every `60 / (rate * maxPlayers / 16)` seconds while the
//   ENEMY's summed `areaValue` over the control points it holds is greater
//   than 99. Every control point counts, the uncapturable bases included
//   (Battle of Britain's Axis airfield weighs 50), and so does a point that
//   owns no spawns and so has no flag (its `Allied_Base`, team 2, 150: the
//   Axis bleeds from the first frame). The countdown is written back to a
//   whole interval on every frame the gate is shut (team 1 0x08152100,
//   team 2 0x0815218c), so each bleed's first ticket comes a whole interval
//   after it starts. TKT-5's two end-of-round rules, for a side left with no
//   spawn groups, are not built here or on the page;
// * flag capture: a live player of the opposing team inside the flag's ring
//   for `FLAG_CAPTURE_SECONDS` un-contested flips the owner. The capture law
//   itself was never read (the parity round left it open), so
//   `FLAG_CAPTURE_RADIUS_MS = 8` and `FLAG_CAPTURE_SECONDS = 8` are authored
//   constants, named so a P5 corpus read can correct them in one place.
//
// * the end of the round and the restart (ledger ROUND-1..ROUND-9, ROUND-11,
//   HP-20): the round decides itself on the page's own law (`round-state.js`
//   `tick`), and on the tick it turns to EndGame the room clears the world
//   (`GameServer::clearWorld` 0x081578f0: every living player killed, every
//   root PlayerControlObject destroyed) and sends the result; ten seconds
//   later (`restartIn`) it restarts the map the way `restartMap` 0x08157cb0
//   does for the parts a room holds: the tickets and the score made again,
//   every control point back to its level team, the CTF flags home, the hulls
//   back on their pads. A human spawns only while the round plays
//   (`GameServer::spawnPlayer` 0x0814c990, ROUND-11).
//
// The projectile path (the headless `GunFire` wiring and its splash) is the
// deliberate remaining gap — P3's second slice, in the feature README.
// Until it lands the only damage in a room is combat-area, water/critical
// and crash damage, which the rooms' synthetic test level exercises.

import { Armor } from '../viewer/armor.js';
import { createCtf } from '../viewer/ctf.js';
import { createRoundState, GAME_PLAY_MODE, gamePlayModeOf, TICKET_BASE_PLAYERS }
  from '../viewer/round-state.js';

/** The game play modes in which `spawnPlayer` asks the side's tickets
 *  (`[+0x10]` 2, 4 and 5 at 0x0814ca0a..0x0814ca22, ROUND-11). */
const SPAWN_NEEDS_TICKETS = new Set([GAME_PLAY_MODE.conquest, GAME_PLAY_MODE.coop,
                                     GAME_PLAY_MODE.objective]);

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
 *   onClearWorld  () => {}  the room's half of `clearWorld` once the round
 *                 has ended: everyone out of the seats, every hull destroyed
 *   onRestart     () => {}  the room's half of `restartMap`: the hulls back
 *                 on their pads (the round, flags and CTF are this file's)
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

  /** Each flag's team as the level starts it: what `ControlPoint::reset`
   *  loads back at a restart (its template team, `+0x1e0`, SPAWNGRP-3). */
  const flagStart = (world.flags ?? []).map(flag => flag.team);

  /** The round's end has been played (the result sent, the world cleared):
   *  the edge into EndGame happens once a round. */
  let ended = false;

  /** A team's count as `world.tickets` holds it: the room's own copy of the
   *  level's tickets, which the round below starts from and writes every
   *  change back to, and which the handshake and the wire rows read. The
   *  published sidecars use `team1`/`team2`; the harness's old descriptor
   *  used bare `1`/`2` — either answers. */
  const ticketsOf = team => {
    const t = world.tickets;
    if (!t) return 0;
    return t[`team${team}`] ?? t[team] ?? 0;
  };

  /** The room's round: the page's own (`round-state.js`), so a room spends
   *  and bleeds by the code the page and the headless runner run. Its counts
   *  start as the room's and every change is written back to `world.tickets`
   *  (`spendTicket`, `bleed`), which the handshake and the rows read.
   *
   *  The room's tickets are already scaled for its slots (`level-data.mjs`
   *  `scaleTickets`: the counts, and `lossPerMin` times maxPlayers / 16), so
   *  the round takes them as a 16-slot server's, which scales nothing again:
   *  a ticket every `60 / lossPerMin` s is the engine's `60 / (rate *
   *  maxPlayers / 16)`. The counts are handed over bare, because the object's
   *  own `maxPlayers` (a mode script's `game.maxNrOfPlayers`, Kasserine Pass
   *  co-op's 18) has already scaled the start once. */
  const round = createRoundState({
    tickets: { team1: ticketsOf(1), team2: ticketsOf(2) },
    rates: world.tickets?.lossPerMin ?? null,
    maxPlayers: TICKET_BASE_PLAYERS,
    // The layer's mode decides which rules end the round and whether the
    // bleed runs at all (CTF has none, `round-state.js` `ticketsDecide`).
    mode: world.extras?.gameplayMode ?? '',
  });

  /** A CTF layer's flags (`viewer/ctf.js`, ledger CTF-1..CTF-8), the law the
   *  room owns for every client: null on any other layer. Each event goes
   *  out as a `ctf` row, which the page's `ctf-page.js` `onRow` plays. */
  const ctf = gamePlayModeOf(world.extras?.gameplayMode) === GAME_PLAY_MODE.ctf
    && Array.isArray(world.extras?.flagBases) && world.extras.flagBases.length
    ? createCtf({ bases: world.extras.flagBases, round,
                  groundHeight: (x, z) => world.groundHeight?.(x, z) })
    : null;

  /** The control points as the round weighs them, `{ team, areaValue }`, the
   *  headless runner's join (`sim/match.mjs` `weighedPoints`): every point of
   *  the level with its `areaValue`, owned by the world flag of the same name,
   *  read live, so a capture moves the weight in the tick it lands. A point
   *  that owns no spawns is no flag (`spawn-flags.js`) and keeps its level
   *  team, as Battle of Britain's `Allied_Base` does. The fleet's ship flags
   *  are no control points and weigh nothing. */
  const points = (() => {
    const flags = new Map((world.flags ?? [])
      .filter(f => !f.standalone && f.controlPointName)
      .map(f => [f.controlPointName, f]));
    return (world.extras?.controlPoints ?? []).map(({ name, team, areaValue }) => {
      const flag = flags.get(name);
      return flag
        ? { name, get team() { return flag.team; }, areaValue }
        : { name, team, areaValue };
    });
  })();

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

  return {
    KITS,
    dead,
    /** The round (`round-state.js`): the counts, the weight each side held
     *  on the last tick, which side is bleeding and its countdown. */
    round,

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

    /** Whether a human of `team` may spawn now (`GameServer::spawnPlayer`
     *  0x0814c990, ROUND-11): only while the round plays (`[+0x58] == 1`, a
     *  bot alone is spared that test), and in Conquest, Co-op and
     *  ObjectiveMode only while his side has a ticket left (`TeamScore+0x48`
     *  above 0). */
    maySpawn(team) {
      if (round.status !== 'playing') return false;
      const mode = gamePlayModeOf(world.extras?.gameplayMode);
      if (world.tickets && SPAWN_NEEDS_TICKETS.has(mode) && !(round.tickets[team] > 0)) return false;
      return true;
    },

    /** The round as a client joining now must draw it (the HELLO): playing,
     *  or ended with its result and the restart's countdown. */
    roundState() {
      return round.status === 'playing'
        ? { status: 'playing', roundsWon: { ...round.roundsWon } }
        : { status: 'endGame', ...resultRow() };
    },

    /** One world step's worth of the authority: deaths first (every damage
     *  funnel lands on Armors during `step`), then the flags, then the bleed
     *  over the owners the captures just left (the page's and the runner's
     *  order: `captureTick`, then `round.tick`). `step` is the world's
     *  report, `dt` the room's tick. */
    afterStep(step, dt) {
      decreeDeaths(step);
      captureFlags(dt);
      ctfTick(dt);
      bleed(dt);
      roundTick();
    },

    /** The CTF law's state (null off a CTF layer), for a check. */
    ctf,
  };

  /** One tick of the CTF law over the room's players: a slot under the
   *  death decree is dead, a seated one is not on foot (CTF-2..CTF-4). */
  function ctfTick(dt) {
    if (!ctf || !(dt > 0) || round.status !== 'playing') return;
    const players = [];
    for (const [slot, player] of world.players) {
      if (player?.team !== 1 && player?.team !== 2) continue;
      let position = null;
      if (player.occupancy?.root && player.vehicle) {
        const s = player.vehicle.state.position;
        position = [s.x, s.y, s.z];
      } else if (player.soldier) {
        position = [player.soldier.x, player.soldier.y, player.soldier.z];
      }
      if (!position) continue;
      players.push({ id: slot, team: player.team, position,
                     alive: !dead.has(slot) && !player.armor?.destroyed,
                     onFoot: !player.occupancy?.root });
    }
    for (const event of ctf.tick(dt, players)) {
      onRow({ type: 'ctf', kind: event.kind, flag: event.flag, player: event.player,
              team: event.team, position: event.position });
    }
  }

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
        // The damage pass reports the DamageableVehicle, which knows its owner.
        const victim = ownerToPlayer(change.vehicle?.owner ?? change.vehicle);
        if (victim != null && !killers.has(victim)) killers.set(victim, null);
      }
      // The general pass: a player with a destroyed Armor is dead, once.
      for (const [slot, player] of world.players) {
        if (!player?.armor?.destroyed || dead.has(slot)) continue;
        dead.add(slot);
        const other = killers.get(slot) ?? player.armor.lastHit ?? null;
        if (bookDeath(slot, player.team, other)) {
          onRow({ type: 'ticket', team: player.team,
                  count: ticketsOf(player.team), reason: 'death' });
        }
        const row = { type: 'killed', slot };
        if (other != null) row.other = other;
        onRow(row);
      }
  }

  /** A death on the round's own books (`round-state.js` `kill`/`suicide`):
   *  the dead man's tally and his killer's, the side's `LOSS_PER_DEATH`
   *  ticket while the round plays (ROUND-7: nothing is paid or spent once it
   *  has ended). `other` is the killing slot, if a player did it. Returns
   *  whether a ticket went. */
  function bookDeath(slot, team, other) {
    const before = round.tickets[team];
    const killer = other != null && other !== slot ? world.players.get(other) : null;
    if (killer) {
      round.kill({ killer: other, killerTeam: killer.team ?? 0, victim: slot, victimTeam: team });
    } else {
      round.suicide({ player: slot, team });
    }
    if (!world.tickets || round.tickets[team] === before) return false;
    writeTickets(team);
    return true;
  }

  // --- the round's end and the restart ---------------------------------------

  /** After the bleed has had its say (`round.tick` decides the round): the
   *  first EndGame tick plays the end (`gameStatusFirstEndGame` 0x08152a60:
   *  `clearWorld`, then the medals), and when the restart's countdown is out
   *  the map restarts (`gameStatusEndGame` 0x08152ca0, ROUND-9). */
  function roundTick() {
    if (round.status !== 'endGame') return;
    if (!ended) {
      ended = true;
      onRow({ type: 'roundEnd', ...resultRow() });
      clearWorld();
    }
    if (round.restartDue()) restartRound();
  }

  /** The round's result as the rows carry it: the winner (0 a draw), the
   *  victory type, why it ended, the seconds to the restart, the rounds each
   *  side has won and `giveMedal`'s three by score (`round.medals`), each
   *  named by slot. */
  function resultRow() {
    const roster = [...world.players].map(([slot, p]) => ({ id: slot, team: p?.team ?? 0 }));
    return {
      winner: round.winner, victoryType: round.victoryType, reason: round.endReason,
      restartIn: round.restartIn, roundsWon: { ...round.roundsWon },
      medals: round.medals(roster).map(m => ({ slot: m.playerId, team: m.team,
                                               medal: m.medal, score: m.score })),
    };
  }

  /** `GameServer::clearWorld` 0x081578f0 on the room's players: every living
   *  one is killed (`killPlayer`), out of his seat first, and nothing is
   *  paid or spent for it (the round has ended, ROUND-7). The room destroys
   *  the hulls (`onClearWorld`). */
  function clearWorld() {
    ctx.onClearWorld?.();
    for (const [slot, player] of world.players) {
      if (dead.has(slot)) continue;
      dead.add(slot);
      if (player?.armor && !player.armor.destroyed) player.armor.applyDamage(player.armor.hitPoints + 1);
      onRow({ type: 'killed', slot, cleared: true });
    }
  }

  /** `GameServer::restartMap` 0x08157cb0 for what the authority holds: the
   *  round made again (`round.restart`: the tickets, the score, the rounds
   *  won kept), every control point back on its level team with its capture
   *  clock cleared (`ControlPoint::reset`), the CTF flags home; the room puts
   *  the hulls back on their pads (`onRestart`, `ObjectSpawner::reset`). The
   *  players stay dead until each deploys, from the spawn screen the restart
   *  opens. */
  function restartRound() {
    for (const [index, flag] of (world.flags ?? []).entries()) {
      if (Number.isInteger(flagStart[index])) flag.team = flagStart[index];
    }
    capture.clear();
    ctf?.reset();
    round.restart();
    ended = false;
    for (const team of [1, 2]) if (world.tickets) writeTickets(team);
    ctx.onRestart?.();
    onRow({
      type: 'restart',
      tickets: world.tickets ? { team1: ticketsOf(1), team2: ticketsOf(2) } : null,
      flags: (world.flags ?? []).map(flag => ({ team: flag.team })),
      roundsWon: { ...round.roundsWon },
      ctf: ctf?.snapshot() ?? null,
    });
  }

  /** One tick of the capture law, at the room's tick cadence. */
  function captureFlags(dt) {
    const flags = world.flags ?? [];
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
  }

  /** One tick of the bleed (the header's TKT-4 rule): the round's own `tick`
   *  over the room's control points, which spends whole tickets, and a
   *  `ticket` row for each side it cost, carrying the fresh count however
   *  many the tick took. */
  function bleed(dt) {
    // A layer with no tickets has nothing to bleed or decide while it plays;
    // once the round has ended the tick is also the restart's countdown.
    if (!world.tickets && round.status === 'playing') return;
    const lost = round.tick(dt, points);
    if (!world.tickets) return;
    for (const team of [1, 2]) {
      if (!lost[team]) continue;
      writeTickets(team);
      onRow({ type: 'ticket', team, count: ticketsOf(team), reason: 'bleed' });
    }
  }

  // --- the law's helpers ----------------------------------------------------

  function captureSeconds(flag) {
    return Number.isFinite(flag.timeToGetControl) && flag.timeToGetControl > 0
      ? flag.timeToGetControl : FLAG_CAPTURE_SECONDS;
  }

  /** The round's count for `team`, written into the world's tickets object:
   *  a copy per room (`level-data.mjs`), and the one the handshake sends and
   *  the rows read. Both key spellings, so a harness descriptor's legacy
   *  `1`/`2` shape stays coherent. */
  function writeTickets(team) {
    const t = world.tickets;
    const legacy = `${team}`;
    t[`team${team}`] = round.tickets[team];
    if (legacy in t) t[legacy] = round.tickets[team];
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
