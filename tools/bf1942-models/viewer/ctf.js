/**
 * Capture the Flag: the flag bases, the flags, who carries them and the
 * scores a round of them pays, read out of the Linux server
 * (`bf1942_lnxded.static`; ledger CTF-1..CTF-8, features/ctf-mode).
 *
 * A CTF level's root `Ctf.con` places, on a host, one `FlagBase` per side
 * (`object.create UKbase`, `GEbase`, `redBase`, ...). The base's template
 * (`Objects/Items/Flag/Objects.con`, or the level's own) names its team, the
 * `Flag` it raises (`flagTemplate`), a radius and where the flag hangs
 * (`setFlagLocation 0/7.6/0`); the flag's names its team, its own radius and
 * `TimeToReSpawn` (30 on every shipped flag). `scene.json.modes.Ctf.flagBases`
 * carries both, resolved by `bf42/ctf.py` `flag_bases`.
 *
 * What the server does with them, per frame:
 *
 *  - `FlagBase::handleUpdate` (0x08292b30). While its own flag is home, a
 *    player of the base's team who carries a flag (`BFPlayer+0x13c`) and
 *    stands on foot within the base's radius drops it there: the drop of a
 *    live carrier is a capture (`Flag::handleDrop` 0x08291df0 pays
 *    `FlagCapture` and sends the flag back to its own base). Then the nearest
 *    soldier of the OTHER team within the radius picks the home flag up
 *    (`Flag::handlePickup` 0x08291d70: the flag leaves home, the player is a
 *    carrier, an `Attack` is paid). A carrier whose own flag is away cannot
 *    capture; he waits at his base, or it is returned.
 *  - `Flag::handleUpdate` (0x08291a90), for a flag away from home. Carried,
 *    it only keeps its `TimeToReSpawn` countdown full. Lying on the ground,
 *    the countdown runs, and at zero the flag goes home by itself (no
 *    score). Before that, the nearest live soldier of the flag's OWN team
 *    within the flag's radius returns it (`Defence` paid), and failing one,
 *    the nearest live enemy soldier picks it up (`Attack`).
 *  - A carrier who dies drops the flag where he fell: at the terrain height
 *    there plus 1.5 m, on the ground's slope (`Flag::handleDrop`, the dead
 *    branch).
 *
 * "Soldier" is the controlled object's class (`0x9493`, `BFSoldier`): a
 * player in a vehicle neither picks up, returns nor captures, and a carrier
 * who climbs into one keeps the flag. The engine picks the nearest thief at a
 * base before it asks whether he lives (CTF-3), so a dead body nearest the
 * pole blocks a live thief for that frame; this offers living soldiers only.
 *
 * The law runs wherever the round is owned: the page's own round, or a room's
 * authority (`server/authority.mjs`), whose clients replay its events through
 * `applyEvent` rather than running the law themselves.
 *
 * The client's side of it (0x006e4290): each pick-up, capture and return is a
 * game-information line in the actor's team colour (`<name> [axis]: stole the
 * flag`, the lexicon's `STOLE_THE_FLAG`, `CAPTURED_THE_FLAG`,
 * `RETURNED_THE_FLAG`) and a `Bf1942/Game/CTF.ssc` patch by the actor's team:
 * 0/1 stolen, 2/3 captured, 4/5 returned, Axis first. A drop is a line only
 * when the carrier died (`DROPPED_THE_FLAG`), and never a voice.
 *
 * Pure: no `three`, no DOM, no page. `tests/ctf_harness.mjs` drives it.
 */

import { SCORE_MSG } from './round-state.js';

/** What every shipped `Flag` template sets, for a base the data leaves bare. */
export const FLAG_DEFAULTS = Object.freeze({
  radius: 5, timeToRespawn: 30, location: [0, 7.6, 0],
});

/** A dropped flag rests this far above the terrain (`fadd 1.5`, 0x08291e97). */
export const DROP_HEIGHT = 1.5;

/** The `CTF.ssc` patch an event plays, by the actor's team (0x006e4290's
 *  switch, cases 0..5; 6 and 7, the drops, play nothing). */
export function ctfPatch(kind, team) {
  const side = team === 1 ? 0 : 1;
  if (kind === 'stole') return 0 + side;
  if (kind === 'captured') return 2 + side;
  if (kind === 'returned') return 4 + side;
  return null;
}

/** The lexicon key of an event's game-information line. */
export const CTF_LINE_KEYS = Object.freeze({
  stole: 'STOLE_THE_FLAG', captured: 'CAPTURED_THE_FLAG',
  returned: 'RETURNED_THE_FLAG', dropped: 'DROPPED_THE_FLAG',
});

const ENGLISH = Object.freeze({
  STOLE_THE_FLAG: 'stole the flag', CAPTURED_THE_FLAG: 'captured the flag',
  RETURNED_THE_FLAG: 'returned the flag', DROPPED_THE_FLAG: 'dropped the flag',
  TEAM_CHAT_AXIS: 'axis', TEAM_CHAT_ALLIES: 'allies',
});

/** The information line: the actor's name, his team's chat word in
 *  brackets, then the verb -- the pieces 0x006e4290 concatenates, `" ["`,
 *  `TEAM_CHAT_AXIS`/`TEAM_CHAT_ALLIES` and `"]: "`, around the name. */
export function ctfLine(kind, name, team, strings = null) {
  const key = CTF_LINE_KEYS[kind];
  if (!key) return '';
  const verb = strings?.[key] ?? ENGLISH[key];
  const word = team === 1 ? (strings?.TEAM_CHAT_AXIS ?? ENGLISH.TEAM_CHAT_AXIS)
    : (strings?.TEAM_CHAT_ALLIES ?? ENGLISH.TEAM_CHAT_ALLIES);
  return `${name} [${word}]: ${verb}`;
}

function dist(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** A base as the data carries it, with every default filled in. */
export function normaliseBase(entry, index = 0) {
  const flag = entry?.flag ?? {};
  const loc = Array.isArray(entry?.flagLocation) && entry.flagLocation.length === 3
    ? entry.flagLocation.map(Number) : FLAG_DEFAULTS.location.slice();
  const team = entry?.team === 1 || entry?.team === 2 ? entry.team : 0;
  return {
    index,
    name: entry?.name ?? `base${index}`,
    template: entry?.template ?? null,
    team,
    position: (entry?.position ?? [0, 0, 0]).map(Number),
    rotation: (entry?.rotation ?? [0, 0, 0]).map(Number),
    radius: Number(entry?.radius) > 0 ? Number(entry.radius) : FLAG_DEFAULTS.radius,
    flagLocation: loc,
    flag: {
      template: flag.template ?? null,
      // The base hands its own team to the flag it raises (vt+0x108 with
      // `+0x150`, 0x08292e8c), whatever the flag template says.
      team,
      radius: Number(flag.radius) > 0 ? Number(flag.radius) : FLAG_DEFAULTS.radius,
      timeToRespawn: Number.isFinite(Number(flag.timeToRespawn))
        ? Number(flag.timeToRespawn) : FLAG_DEFAULTS.timeToRespawn,
      nation: flag.nation ?? null,
      geometry: flag.geometry ?? null,
    },
  };
}

/**
 * The live CTF state of one round.
 *
 * `bases` is `scene.json.modes.Ctf.flagBases`. `round` (optional) is the
 * page's `round-state.js` round, paid through its `flagScore`.
 * `groundHeight(x, z)` answers the terrain height for a drop; without it a
 * dropped flag rests at the carrier's feet plus 1.5.
 *
 * `tick(dt, players)` takes every player this frame as `{ id, team, alive,
 * onFoot, position: [x, y, z], name }` and returns the events it caused, in
 * order: `{ kind: 'stole' | 'captured' | 'returned' | 'dropped' | 'home',
 * flag, player, team, name }`. `team` is the ACTOR's team (the thief's, the
 * capturer's, the returner's, the dead carrier's); `flag` is the flag's index,
 * which is its base's.
 */
export function createCtf({ bases = [], round = null, groundHeight = null } = {}) {
  const list = (bases ?? []).map(normaliseBase)
    .filter(base => base.team === 1 || base.team === 2);
  const flags = list.map(base => ({
    index: base.index,
    base,
    team: base.team,
    home: true,
    carrier: null,
    carrierTeam: 0,
    position: homePosition(base),
    respawnIn: base.flag.timeToRespawn,
  }));
  const ctf = { bases: list, flags, events: [] };

  function homePosition(base) {
    return [base.position[0] + base.flagLocation[0],
            base.position[1] + base.flagLocation[1],
            base.position[2] + base.flagLocation[2]];
  }

  const soldier = p => p && p.alive && p.onFoot !== false && Array.isArray(p.position);

  /** The flag a player carries, or null. */
  function carriedBy(playerId) {
    return flags.find(f => f.carrier != null && f.carrier === playerId) ?? null;
  }

  function emit(events, kind, flag, player) {
    const event = {
      kind, flag: flag.index, flagTeam: flag.team,
      player: player?.id ?? null, team: player?.team ?? 0, name: player?.name ?? '',
      // Where the flag is once the event has happened: home, or where a dead
      // carrier let it fall. A room's clients place it from this.
      position: flag.position.slice(),
    };
    events.push(event);
    return event;
  }

  function score(player, msg) {
    if (!round || player?.id == null) return;
    round.flagScore?.({ player: player.id, team: player.team, msg });
  }

  /** `Flag::reSpawn` via `FlagBase::reSpawnFlag`: home, full countdown. */
  function sendHome(flag) {
    flag.home = true;
    flag.carrier = null;
    flag.carrierTeam = 0;
    flag.position = homePosition(flag.base);
    flag.respawnIn = flag.base.flag.timeToRespawn;
  }

  function pickUp(flag, player, events) {
    flag.home = false;
    flag.carrier = player.id;
    flag.carrierTeam = player.team;
    flag.position = player.position.slice();
    flag.respawnIn = flag.base.flag.timeToRespawn;
    emit(events, 'stole', flag, player);
    score(player, SCORE_MSG.attack);
  }

  function nearest(players, test, from, radius) {
    let best = null, bestD = radius;
    for (const p of players) {
      if (!test(p)) continue;
      const d = dist(p.position, from);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /** A carrier left the game or died: the flag falls where he was. */
  function drop(flag, at, player, events, dead = true) {
    const pos = (at ?? flag.position).slice();
    if (typeof groundHeight === 'function') {
      const h = Number(groundHeight(pos[0], pos[2]));
      if (Number.isFinite(h)) pos[1] = h;
    }
    pos[1] += DROP_HEIGHT;
    flag.carrier = null;
    flag.carrierTeam = 0;
    flag.position = pos;
    flag.respawnIn = flag.base.flag.timeToRespawn;
    if (dead) emit(events, 'dropped', flag, player);
  }

  function tick(dt, players = []) {
    const events = [];
    const byId = new Map(players.map(p => [p.id, p]));

    // A carrier gone or dead lets go first: `BFPlayer` death runs before the
    // objects' own updates, and the drop is the dead branch of handleDrop.
    for (const flag of flags) {
      if (flag.carrier == null) continue;
      const p = byId.get(flag.carrier);
      if (!p || !p.alive) {
        drop(flag, p?.position ?? flag.position, p ?? { id: flag.carrier, team: flag.carrierTeam, name: '' }, events);
      } else {
        flag.position = p.position.slice();
      }
    }

    // The bases, in the order the level places them.
    for (const flag of flags) {
      const base = flag.base;
      if (!flag.home) continue;
      // A carrier of the base's team, on foot, inside the radius: a capture.
      for (const p of players) {
        if (p.team !== base.team || !soldier(p)) continue;
        const carried = carriedBy(p.id);
        if (!carried || dist(p.position, base.position) >= base.radius) continue;
        const event = emit(events, 'captured', carried, p);
        score(p, SCORE_MSG.flagCapture);
        sendHome(carried);
        event.position = carried.position.slice();
      }
      // The nearest enemy soldier inside the radius takes the flag.
      const thief = nearest(players, p => p.team !== base.team && (p.team === 1 || p.team === 2)
        && soldier(p) && !carriedBy(p.id), base.position, base.radius);
      if (thief) pickUp(flag, thief, events);
    }

    // The flags away from home.
    for (const flag of flags) {
      if (flag.home) continue;
      if (flag.carrier != null) {
        flag.respawnIn = flag.base.flag.timeToRespawn;
        continue;
      }
      flag.respawnIn -= dt;
      if (flag.respawnIn < 0) {
        sendHome(flag);
        emit(events, 'home', flag, null);
        continue;
      }
      const radius = flag.base.flag.radius;
      const own = nearest(players, p => p.team === flag.team && soldier(p), flag.position, radius);
      if (own) {
        const event = emit(events, 'returned', flag, own);
        score(own, SCORE_MSG.defence);
        sendHome(flag);
        event.position = flag.position.slice();
        continue;
      }
      const thief = nearest(players, p => p.team !== flag.team && (p.team === 1 || p.team === 2)
        && soldier(p) && !carriedBy(p.id), flag.position, radius);
      if (thief) pickUp(flag, thief, events);
    }
    ctf.events = events;
    return events;
  }

  /** `restartMap`: every flag home. */
  function reset() {
    for (const flag of flags) sendHome(flag);
    ctf.events = [];
  }

  /**
   * One event of a law run elsewhere (a room's authority), applied to this
   * copy: who carries what and where a dropped flag lies. Pays nothing; the
   * authority's round has paid it already. Returns the flag, or null for an
   * event this copy cannot place.
   */
  function applyEvent(event) {
    const flag = flags.find(f => f.index === event?.flag) ?? null;
    if (!flag) return null;
    if (event.kind === 'stole') {
      flag.home = false;
      flag.carrier = event.player;
      flag.carrierTeam = event.team;
      flag.respawnIn = flag.base.flag.timeToRespawn;
    } else if (event.kind === 'dropped') {
      flag.home = false;
      flag.carrier = null;
      flag.carrierTeam = 0;
      if (Array.isArray(event.position)) flag.position = event.position.map(Number);
      flag.respawnIn = flag.base.flag.timeToRespawn;
    } else if (event.kind === 'captured' || event.kind === 'returned' || event.kind === 'home') {
      sendHome(flag);
    } else {
      return null;
    }
    return flag;
  }

  /** Every flag as it stands, for a client joining a room mid-round (the
   *  room's HELLO): `[{ flag, home, carrier, carrierTeam, position,
   *  respawnIn }]`. */
  function snapshot() {
    return flags.map(f => ({ flag: f.index, home: f.home, carrier: f.carrier,
                             carrierTeam: f.carrierTeam, position: f.position.slice(),
                             respawnIn: f.respawnIn }));
  }

  /** A `snapshot` applied to this copy: the flags where the room's law has
   *  them when this client joined. A row for no flag of this copy is skipped. */
  function restore(rows) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const flag = flags.find(f => f.index === row?.flag);
      if (!flag) continue;
      if (row.home) { sendHome(flag); continue; }
      flag.home = false;
      flag.carrier = row.carrier ?? null;
      flag.carrierTeam = flag.carrier != null ? (row.carrierTeam ?? 0) : 0;
      if (Array.isArray(row.position)) flag.position = row.position.map(Number);
      flag.respawnIn = Number.isFinite(row.respawnIn) ? row.respawnIn : flag.base.flag.timeToRespawn;
    }
  }

  /** A carried flag follows its carrier between law ticks (a room's client
   *  has no law tick at all): `positionOf(id)` answers `[x, y, z]` or null. */
  function follow(positionOf) {
    for (const flag of flags) {
      if (flag.carrier == null) continue;
      const at = positionOf(flag.carrier);
      if (Array.isArray(at)) flag.position = at.slice();
    }
  }

  /** The flag a team raised, by its base's team. */
  function flagOf(team) {
    return flags.find(f => f.team === team) ?? null;
  }

  Object.assign(ctf, { tick, reset, carriedBy, flagOf, homePosition, applyEvent, follow,
                       snapshot, restore });
  return ctf;
}
