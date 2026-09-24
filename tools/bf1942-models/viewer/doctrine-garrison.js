// The garrison play (INVENTION, 2026-09-24, features/bot-garrison): one bot
// hangs back on each flag the side has taken, and keeps busy at it; everyone
// else pushes. The page's default doctrine (`map.html`, `?doctrine=sai` for the
// engine's own); the runner's is still the SAI (`--doctrine garrison`).
//
// The engine's SAI splits its free bots into attackers and defenders by the
// strategy's aggression, wants at least two defenders on a defended area
// (`round(2 x max(1, present))`), and a bot none of its targets collected
// holds the area it stands in (`retainBot`), re-ordered there every 20 s:
// the base it spawned at, or the flag it has just taken. Inside an area its
// side holds, the order asks for nothing, so the bot stands and scans. On
// Bocage, whose strategies all have no defences and aggression 1, those
// retained bots and the bots sitting in the bases' flak and AA guns were
// every idle soldier (features/bot-stalemates).
//
// The garrison, over the SAI's own picture (strategic-ai.js `_distribute`
// with `opts.garrison`):
//
//  - Posts: each flag the side holds and the enemy can take gets at most one
//    bot, no more than `GARRISON.share` of the side's alive bots, the flags
//    the SAI's `_defenceNeed` rates highest first (its temperature with the
//    hostile and neutral neighbour factors). A post stands while the side
//    holds its flag. It goes to the flag's last guard when he is free again
//    (`lastPost`), else the nearest free bot on foot or in a fixed gun; a bot
//    at the wheel of a hull is left to attack. A record's `post` is set only
//    while the bot is posted.
//  - Everyone else attacks: a free bot is an attacker whatever the
//    aggression, and one the attack targets did not collect joins the
//    nearest of them instead of holding where it is.
//  - The post (`WPPost`) mans a free fixed gun within `gunReach` flag radii
//    of the flag (the one nearest the flag), walking to its door and
//    pressing Use; with none free it walks a ring of points around the flag
//    (`ringFraction` of the flag's radius), stopping at each for a few
//    seconds, when its Scout looks round. A posted bot does not Change
//    (bot-mount.js): his post seats him.
//  - A bot not on a post takes a fixed gun only for an enemy he has spotted
//    inside its range and traverse, and gets out of one once he has none
//    (`guns: 'engaged'` on his order; bot-mount.js `fixedAimable` and the
//    seated Change): the base's guns stay empty until something comes.

import { registerDoctrine, registerOrderKind } from './doctrine.js';

export const GARRISON = {
  /** Posts at most `floor(share x alive)` of the side's bots, at least one
   *  once it has three. */
  share: 1 / 3,
  minBotsForPost: 3,
  /** A fixed gun within this many flag radii of the flag is its post's. */
  gunReach: 1.75,
  /** The flag radius when the level gives none, metres. */
  flagRadiusDefault: 15.0,
  /** The patrol ring: this fraction of the flag's radius, held to 6..15 m,
   *  with this many points (an unwalkable one is left out). */
  ringFraction: 0.6,
  ringMin: 6.0,
  ringMax: 15.0,
  ringPoints: 6,
  /** Arrival radius of a patrol leg, metres. */
  legRadius: 2.0,
  /** A leg starting further than this many flag radii from the flag runs. */
  walkWithin: 2.0,
  /** Seconds stood at each ring point (uniform between the two). */
  pauseMin: 3.0,
  pauseMax: 7.0,
  /** The door: the page seats within its radius; the leg aims inside it. */
  doorRadiusMin: 2.0,
};

// ---------------------------------------------------------------------------
// The posts: which bot guards which flag
// ---------------------------------------------------------------------------

/** A bot that may hold a post: on foot, or in a fixed gun. */
function postable(sai, b) {
  const u = sai.unitOf?.(b.id) ?? null;
  return !u?.mounted || !!u?.fixed;
}

/**
 * The areas whose flag the side may guard (held, with a control point the
 * enemy can take), the most needed first: `needOf(area)` (the SAI's
 * `_defenceNeed`), else the front's first (an area with a neighbour the side
 * does not hold).
 */
export function guardedAreas(layer, side, needOf = null) {
  const enemy = side === 1 ? 2 : 1;
  const areas = layer.areas.filter(a => a.controlPoints.length && layer.ownerOf(a) === side && layer.takeableBy(a, enemy));
  const front = a => layer.neighboursOf(a).some(n => layer.ownerOf(n) !== side);
  return areas.map((a, i) => ({ a, i, need: needOf ? needOf(a) : 0, f: front(a) ? 0 : 1 }))
    .sort((x, y) => y.need - x.need || x.f - y.f || x.i - y.i).map(x => x.a);
}

/** The cap on the side's posts for `n` alive bots. */
export function postCap(n) {
  return n >= GARRISON.minBotsForPost ? Math.max(1, Math.floor(GARRISON.share * n)) : 0;
}

/**
 * `opts.garrison.post` for `StrategicAI._distribute`: release the posts that
 * no longer stand (the flag lost, or the guard at the wheel of a hull), then
 * post free bots on the most needed flags still unguarded, up to the cap. A
 * standing post is kept where it is though another flag has come to need
 * one more. A posted
 * record is not free, not an attacker, assigned to the flag's area, with no
 * SAI order (the play gives it a `WPPost`).
 */
export function assignPosts({ sai, side, bots, alive }) {
  const layer = sai.layer;
  const areas = guardedAreas(layer, side, a => sai._defenceNeed(a, side));
  for (const b of bots) {
    if (b.free || !b.post) continue;
    if (!areas.includes(b.post) || !postable(sai, b)) {
      b.free = true; b.assignedTo = null; b.isAttack = true; b.lastPost = b.post; b.post = null;
    }
  }
  const cap = postCap(bots.length);
  let n = bots.filter(b => !b.free && b.post).length;
  for (const area of areas) {
    if (n >= cap) break;
    if (bots.some(b => !b.free && b.post === area)) continue;
    const fp = area.controlPoints[0].position;
    let best = null, bestD = Infinity;
    for (const b of bots) {
      if (!b.free || !postable(sai, b)) continue;
      const p = alive.get(b.id);
      if (!p) continue;
      // The flag's last guard first (a bot who has just sat down at its gun
      // is freed by the unit change and comes back here).
      const d = b.lastPost === area ? -1 : Math.hypot(p[0] - fp[0], p[2] - fp[2]);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) continue;
    best.free = false;
    best.isAttack = false;
    best.assignedTo = area;
    best.post = area;
    best.lastPost = area;
    best.waypoints = null;
    best.orderedAt = sai.time;
    n++;
  }
}

// ---------------------------------------------------------------------------
// The post order
// ---------------------------------------------------------------------------

/** The flag the post guards: its point [x, z], height and radius. */
function flagOf(area) {
  const f = area.controlPoints[0];
  const r = Number.isFinite(f.radius) && f.radius > 0 ? f.radius : GARRISON.flagRadiusDefault;
  return { centre: [f.position[0], f.position[2]], y: f.position[1], radius: r };
}

/** The patrol ring around the flag, walkable points only (the flag itself
 *  when none is). */
export function patrolRing(centre, flagRadius, isWalkable = null) {
  const r = Math.min(GARRISON.ringMax, Math.max(GARRISON.ringMin, GARRISON.ringFraction * flagRadius));
  const out = [];
  for (let i = 0; i < GARRISON.ringPoints; i++) {
    const t = (i / GARRISON.ringPoints) * Math.PI * 2;
    const p = [centre[0] + r * Math.cos(t), centre[1] + r * Math.sin(t)];
    if (!isWalkable || isWalkable(p[0], p[1])) out.push(p);
  }
  return out.length ? out : [[centre[0], centre[1]]];
}

/** The fixed gun a post mans: free, upright, a gun, its door within reach
 *  of the flag; the nearest the flag. */
export function postGun(cands, post) {
  const reach = GARRISON.gunReach * post.flag.radius;
  let best = null, bestD = Infinity;
  for (const c of cands) {
    if (c.kind !== 'gun' || c.occupiedBy || c.upright === false) continue;
    const e = c.entry ?? [c.pos[0], c.pos[2]];
    const d = Math.hypot(e[0] - post.flag.centre[0], e[1] - post.flag.centre[1]);
    if (d <= reach && d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/**
 * One leg of a post: the phase (`patrol`, `board`, `man`), its goal and the
 * order contract (doctrine.js header). A new object each leg (a bot re-plans
 * its move only for a new order); `post` is the state the legs share.
 * `patrol` and `board` ask to move at full strength until the goal is
 * reached (the `WPMoveTo` law's d^2 / 4R^2 fades near a goal this small,
 * under Scout's, and the bot stood short of it), then for nothing; `man`
 * asks for nothing. A patrol leg on the ring walks (`gait`, bot-plans.js
 * `planMoveTo`); one from further off than `walkWithin` runs.
 */
export function postLeg(post, phase, { point, radius = GARRISON.legRadius, leg = 0, gunId = null, from = null } = {}) {
  const far = from && Math.hypot(from[0] - post.flag.centre[0], from[2] - post.flag.centre[1])
    > GARRISON.walkWithin * post.flag.radius;
  const order = {
    kind: 'WPPost', post, phase, leg, gunId,
    area: post.area,
    inside: post.inside,
    owned: post.owned,
    point: [point[0], point[1]],
    radius,
    gait: phase === 'patrol' && !far ? 'walk' : undefined,
    pauseUntil: null,
    arrived: phase === 'man',
    urgency(x, z) {
      if (phase === 'man' || this.arrived) { this.arrived = true; return 0; }
      const d2 = (x - this.point[0]) ** 2 + (z - this.point[1]) ** 2;
      if (d2 < radius * radius) { this.arrived = true; return 0; }
      return 1;
    },
  };
  return order;
}

/** A new post on `area` for `side`, starting at the ring point nearest `from`. */
export function postOrder({ area, side, layer, isWalkable = null, random = Math.random, from = null }) {
  const flag = flagOf(area);
  const post = {
    area, side, flag,
    ring: patrolRing(flag.centre, flag.radius, isWalkable),
    inside: (x, z) => layer.isInside(area, x, z),
    owned: () => layer.ownerOf(area) === side,
    random,
  };
  let leg = 0;
  if (from) {
    let bestD = Infinity;
    post.ring.forEach((p, i) => {
      const d = Math.hypot(p[0] - from[0], p[1] - from[2]);
      if (d < bestD) { bestD = d; leg = i; }
    });
  }
  return postLeg(post, 'patrol', { point: post.ring[leg], leg, from });
}

/**
 * The post's tick: sitting in a gun by the flag, man it; on foot with a free
 * gun by the flag, walk to its door and press Use there; else patrol the
 * ring, standing a few seconds at each point. A returned object is the next
 * leg.
 */
function postTick(order, { id, position, command, candidates, actuators }) {
  const post = order.post;
  const now = command?.sai?.time ?? 0;
  const cands = candidates();
  const seat = cands.find(c => c.occupiedBy === id) ?? null;
  if (seat) {
    if (seat.kind !== 'gun') return null;
    const e = seat.entry ?? [seat.pos[0], seat.pos[2]];
    if (Math.hypot(e[0] - post.flag.centre[0], e[1] - post.flag.centre[1]) > GARRISON.gunReach * post.flag.radius) {
      // Posted from a gun somewhere else (the base's flak): out, and over.
      actuators?.exit?.(id);
      return null;
    }
    if (order.phase === 'man' && order.gunId === seat.id) return null;
    return postLeg(post, 'man', { point: [position[0], position[2]], radius: GARRISON.legRadius, gunId: seat.id });
  }
  const gun = postGun(cands, post);
  if (gun) {
    const e = gun.entry ?? [gun.pos[0], gun.pos[2]];
    const door = Math.max(gun.entryRadius ?? 4, GARRISON.doorRadiusMin);
    if (order.phase !== 'board' || order.gunId !== gun.id) {
      return postLeg(post, 'board', { point: e, radius: Math.max(1.0, door - 0.5), gunId: gun.id, from: position });
    }
    if (Math.hypot(e[0] - position[0], e[1] - position[2]) <= door) actuators?.enter?.(id, gun.id);
    return null;
  }
  if (order.phase !== 'patrol') {
    let leg = 0, bestD = Infinity;
    post.ring.forEach((p, i) => {
      const d = Math.hypot(p[0] - position[0], p[1] - position[2]);
      if (d < bestD) { bestD = d; leg = i; }
    });
    return postLeg(post, 'patrol', { point: post.ring[leg], leg, from: position });
  }
  if (!order.arrived) return null;
  if (order.pauseUntil === null) {
    order.pauseUntil = now + GARRISON.pauseMin + post.random() * (GARRISON.pauseMax - GARRISON.pauseMin);
    return null;
  }
  if (now < order.pauseUntil) return null;
  const next = (order.leg + 1) % post.ring.length;
  return postLeg(post, 'patrol', { point: post.ring[next], leg: next, from: position });
}

registerOrderKind('WPPost', { tick: postTick });

// ---------------------------------------------------------------------------
// The doctrine
// ---------------------------------------------------------------------------

registerDoctrine('garrison', ({ side, sai, layer, random, command }) => {
  // `posts`: posts handed out; `manning` / `patrolling`: at each pass, the
  // side's posts in a gun and on their ring.
  const counts = { posts: 0, manning: 0, patrolling: 0 };
  const opts = { garrison: { post: assignPosts } };
  return {
    name: 'garrison',
    orders(view) {
      sai.sidePass(side, view.alive, opts);
      const out = new Map();
      for (const b of sai.bots.values()) {
        if (b.side !== side) continue;
        if (!b.free && b.post) {
          const cur = command.waypointsOf(b.id);
          if (cur?.kind === 'WPPost' && cur.post.area === b.post) { out.set(b.id, cur); continue; }
          counts.posts++;
          out.set(b.id, postOrder({ area: b.post, side, layer, isWalkable: view.isWalkable, random,
                                    from: view.alive.get(b.id) ?? null }));
          continue;
        }
        const o = b.waypoints;
        if (o) o.guns = 'engaged';
        out.set(b.id, o);
      }
      for (const [id, o] of command.orders) {
        if (o?.kind !== 'WPPost' || command.roster.get(id) !== side) continue;
        if (o.phase === 'man') counts.manning++;
        else if (o.phase === 'patrol') counts.patrolling++;
      }
      return out;
    },
    stats() { return { ...counts }; },
  };
});
