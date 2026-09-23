// The first play: squad follow (features/bot-doctrines/README.md).
//
// INVENTION, the whole module: a doctrine, not the engine. The engine's SAI
// orders every bot on its own; this play groups a side's bots in fours, lets
// the SAI order one leader per squad, and sends the other three after him.
//
//  * Squads: the side's bots in registration order, in fours (the last one
//    may be short). Fixed for the match.
//  * The leader: a member who drives a hull leads (the hull is the squad's);
//    else the leader stays while he lives; else the first alive member.
//    Leaders go to the SAI (`sai.sidePass` with the leaders alone; the
//    areas were counted with every bot in `beginPass`) and hold its order.
//  * A follower holds a `WPFollow` (doctrine.js `closeToOrder`, the engine's
//    `WPCloseTo` law) on a slot 8 m behind and beside the leader, the
//    leader's heading taken from him to his order's point. A slot off the
//    infantry map falls back to the leader himself.
//  * The squad's hull: the one the leader sits in. A follower on foot within
//    `boardRange` of it is given a free seat (the driver's first) with a
//    `WPBoard`, which walks him to the door and presses Use there. Aboard, he
//    holds a `WPFollow` on the leader (the hull), which asks nothing.
//  * A follower in a seat of some other hull nobody drives, more than
//    `regroupDistance` from the leader, gets out (`WPLeave`) and rejoins: a
//    gunner of a parked hull otherwise sits out the match. A rider of a
//    driven hull stays (a convoy), and nobody leaves an aircraft (the
//    viewer's soldier has no parachute).
//  * A hull cannot be followed on foot: while the leader is mounted, a
//    follower on foot who is not boarding it (no free seat for him, or more
//    than `boardRange` off) goes to the SAI as the leaders do, and comes
//    back when the leader is on foot again or a seat is his. So does every
//    follower not aboard while the leader flies. (Chasing a driven hull on
//    foot, the goal ran away and the page's 12 s no-progress redeploy sent
//    the follower back to the spawn over and over: 50 redeploys a match on
//    El Alamein.)
//  * Regroup: while a follower on foot is more than `regroupDistance` from
//    the leader (and less than `strayDistance`: a fresh respawn across the
//    map is not waited for), a follower at the wheel of his own hull is
//    more than `regroupDistance` behind (at any distance: he closes 100 m
//    in seconds), or a follower is walking to the squad's hull,
//    the leader holds where he is (`WPHold`) for at most `holdMax` seconds,
//    then carries on for at least `holdCooldown` before holding again.
//  * A bot handed from the SAI to a follower's role is released in the SAI
//    (`botChangedUnit`: its assignment dropped), so it does not come back
//    with a stale order when it leads again.

import { registerDoctrine, closeToOrder, boardOrder, leaveOrder } from './doctrine.js';

export const SQUAD = {
  size: 4,
  /** (side, back) metres in the leader's frame, right positive: two beside
   *  and behind, the third behind them. */
  slots: [[-4, 8], [4, 8], [0, 12]],
  regroupDistance: 25,
  strayDistance: 100,
  holdMax: 15,
  holdCooldown: 20,
  boardRange: 60,
};

class SquadDoctrine {
  constructor({ side, sai, command }) {
    this.name = 'squad';
    this.side = side;
    this.sai = sai;
    this.command = command;
    /** [{ members: [id], leader, holdSince, holdUntilCooldown, hold }]. */
    this.squads = null;
    this.bySquad = new Map();
    /** Who the SAI ordered last pass. */
    this.managed = new Set();
    this.lastPos = new Map();
    this.counts = {
      passes: 0, holds: 0, holdSeconds: 0, boardOrders: 0, boardings: 0, leaderChanges: 0, leaveOrders: 0,
      followerDistanceSum: 0, followerSamples: 0, withinRegroup: 0, sharedHullPasses: 0, hullPasses: 0,
      freeAgentPasses: 0,
    };
    this.lastPassAt = null;
    /** Followers aboard the squad's hull at the last pass. */
    this.aboard = new Set();
  }

  _form(roster) {
    this.squads = [];
    for (let i = 0; i < roster.length; i += SQUAD.size) {
      const squad = { index: this.squads.length, members: roster.slice(i, i + SQUAD.size), leader: null,
                      hold: null, holdSince: null, cooldownUntil: -Infinity, heading: [0, 1] };
      this.squads.push(squad);
      for (const id of squad.members) this.bySquad.set(id, squad);
    }
  }

  botDied(id) {
    const squad = this.bySquad.get(id);
    if (squad && squad.leader === id) squad.leader = null;
  }

  orders(view) {
    const { side, sai, time } = view;
    if (!this.squads) this._form(view.roster);
    this.lastPassAt = time;
    this.counts.passes++;
    const bots = new Map(view.bots.map(b => [b.id, b]));
    const cands = view.vehicles;
    const out = new Map();
    const managed = new Set();
    const plans = [];

    for (const squad of this.squads) {
      const alive = squad.members.filter(id => bots.has(id));
      if (!alive.length) { squad.leader = null; squad.hold = null; continue; }
      // The leader: a member at the wheel, else the one who leads, else the first alive.
      const driver = alive.find(id => bots.get(id).seat?.drives && id === squad.leader)
        ?? alive.find(id => bots.get(id).seat?.drives) ?? null;
      const before = squad.leader;
      squad.leader = driver ?? (alive.includes(squad.leader) ? squad.leader : alive[0]);
      if (before !== null && before !== squad.leader) this.counts.leaderChanges++;
      const leader = bots.get(squad.leader);
      const hull = leader.seat?.vehicleId ?? null;
      const air = leader.seat?.kind === 'air' || !!leader.unit?.air;
      managed.add(squad.leader);
      const followers = alive.filter(id => id !== squad.leader);
      const plan = { squad, leader, hull, air, followers: [] };
      // Seats a follower on foot could still take: the hull's free ones.
      let seatsLeft = hull === null ? 0 : cands.filter(c => c.vehicleId === hull && !c.occupiedBy).length;
      const lp = view.alive.get(squad.leader);
      for (const id of followers) {
        const b = bots.get(id);
        const aboard = hull !== null && b.seat?.vehicleId === hull;
        if (hull !== null && !aboard && !b.seat) {
          const d = Math.hypot(b.position[0] - lp[0], b.position[2] - lp[2]);
          const boards = !air && seatsLeft > 0 && d <= SQUAD.boardRange;
          if (!boards) { managed.add(id); this.counts.freeAgentPasses++; continue; }
          seatsLeft--;
        }
        if (air && !aboard) { managed.add(id); this.counts.freeAgentPasses++; continue; }
        plan.followers.push({ b, aboard, slot: squad.members.filter(m => m !== squad.leader).indexOf(id) });
      }
      plans.push(plan);
    }

    // A bot that leaves the SAI's hands is released there.
    for (const id of this.managed) if (!managed.has(id) && bots.has(id)) sai.botChangedUnit(id);
    this.managed = managed;
    const subset = new Map();
    for (const id of managed) subset.set(id, view.alive.get(id));
    sai.sidePass(side, subset);
    for (const id of managed) out.set(id, sai.waypointsOf(id));

    const aboard = new Set();
    for (const plan of plans) {
      for (const f of plan.followers) {
        if (!f.aboard) continue;
        aboard.add(f.b.id);
        // A follower in the squad's hull who was not at the last pass boarded.
        if (!this.aboard.has(f.b.id)) this.counts.boardings++;
      }
      this._squadOrders(plan, view, cands, out);
    }
    this.aboard = aboard;
    for (const b of view.bots) this.lastPos.set(b.id, b.position);
    return out;
  }

  _squadOrders({ squad, leader, hull, followers }, view, cands, out) {
    const leaderOrder = out.get(leader.id) ?? null;
    const alive = view.alive;
    const leaderId = leader.id;
    const leaderRadius = leader.unit?.radius ?? 1.0;
    squad.heading = this._heading(leader, leaderOrder);
    // Free seats of the squad's hull, the driver's first.
    const free = hull === null ? [] : cands.filter(c => c.vehicleId === hull && !c.occupiedBy)
      .sort((a, b) => (b.isRoot ? 1 : 0) - (a.isRoot ? 1 : 0));
    const boarding = [];
    let stray = false;
    if (hull !== null) this.counts.hullPasses++;
    if (hull !== null && followers.some(f => f.aboard)) this.counts.sharedHullPasses++;
    for (const f of followers) {
      const b = f.b;
      const lp = alive.get(leaderId);
      const d = Math.hypot(b.position[0] - lp[0], b.position[2] - lp[2]);
      if (!f.aboard && !b.seat) {
        this.counts.followerDistanceSum += d;
        this.counts.followerSamples++;
        if (d <= SQUAD.regroupDistance) this.counts.withinRegroup++;
      }
      // Board the squad's hull when it has a seat and he is on foot near it.
      if (!b.seat && free.length && d <= SQUAD.boardRange) {
        const held = b.order?.kind === 'WPBoard' ? free.find(c => c.id === b.order.candId) : null;
        const seat = held ?? free[0];
        free.splice(free.indexOf(seat), 1);
        const order = held ? b.order : boardOrder(seat, () => this.command.candidatesOf() ?? [], leaderOrder);
        if (!held) this.counts.boardOrders++;
        out.set(b.id, order);
        boarding.push(b.id);
        continue;
      }
      // Sitting in someone else's parked hull away from the squad: out.
      if (b.seat && !b.seat.drives && !b.seat.driver && !f.aboard && b.seat.kind !== 'air' && d > SQUAD.regroupDistance) {
        if (b.order?.kind !== 'WPLeave') this.counts.leaveOrders++;
        out.set(b.id, b.order?.kind === 'WPLeave' ? b.order : leaveOrder(b.position, leaderOrder));
        continue;
      }
      if (d > SQUAD.regroupDistance && ((!b.seat && d < SQUAD.strayDistance) || b.seat?.drives)) stray = true;
      out.set(b.id, this._follow(b, f, squad, leaderRadius, leaderOrder, view));
    }
    // The leader holds while his squad catches up or climbs in.
    const wantHold = (stray || boarding.length > 0) && !leader.unit?.air;
    if (squad.hold && (!wantHold || view.time - squad.holdSince >= SQUAD.holdMax)) {
      this.counts.holdSeconds += view.time - squad.holdSince;
      squad.hold = null;
      squad.cooldownUntil = view.time + SQUAD.holdCooldown;
    }
    if (!squad.hold && wantHold && view.time >= squad.cooldownUntil) {
      const p = [...alive.get(leaderId)];
      squad.hold = closeToOrder({ kind: 'WPHold', goalOf: () => p, targetRadius: leaderRadius, leaderId, inherit: leaderOrder });
      squad.holdSince = view.time;
      this.counts.holds++;
    }
    if (squad.hold) out.set(leaderId, squad.hold);
  }

  /** The follower's order: the one he holds when it is still on this leader
   *  and slot (its own tick re-goals it), else a new `WPFollow`. The goal is
   *  read live: the leader's position now, the squad's heading of the last
   *  pass. */
  _follow(b, f, squad, leaderRadius, leaderOrder, view) {
    const cur = b.order;
    const leaderId = squad.leader;
    const slot = f.aboard ? null : SQUAD.slots[f.slot % SQUAD.slots.length];
    const key = slot ? slot.join(',') : 'aboard';
    if (cur?.kind === 'WPFollow' && cur.leaderId === leaderId && cur.slot === key && cur.area === (leaderOrder?.area ?? null)) return cur;
    const walkable = view.isWalkable;
    const command = this.command;
    const goalOf = () => {
      const lp = command.alive.get(leaderId);
      if (!lp) return null;
      if (!slot) return lp;
      const [hx, hz] = squad.heading;
      // Right of the heading (hx, hz) is (hz, -hx) in the viewer's x/z.
      const x = lp[0] + slot[0] * hz - slot[1] * hx;
      const z = lp[2] - slot[0] * hx - slot[1] * hz;
      if (walkable && !walkable(x, z)) return lp;
      return [x, lp[1], z];
    };
    return closeToOrder({ kind: 'WPFollow', goalOf, targetRadius: leaderRadius, leaderId, slot: key, inherit: leaderOrder });
  }

  /** The leader's heading at the pass: toward his order's point, else his
   *  last move, else +z. */
  _heading(leader, order) {
    const p = leader.position;
    let dx = 0, dz = 0;
    if (order?.point) { dx = order.point[0] - p[0]; dz = order.point[1] - p[2]; }
    if (Math.hypot(dx, dz) < 1) {
      const q = this.lastPos.get(leader.id);
      if (q) { dx = p[0] - q[0]; dz = p[2] - q[2]; }
    }
    const n = Math.hypot(dx, dz);
    return n > 1e-6 ? [dx / n, dz / n] : [0, 1];
  }

  stats() {
    const c = this.counts;
    let open = 0;
    for (const s of this.squads ?? []) if (s.hold && this.lastPassAt !== null) open += this.lastPassAt - s.holdSince;
    return {
      squads: this.squads?.length ?? 0,
      holds: c.holds,
      holdSeconds: Math.round((c.holdSeconds + open) * 100) / 100,
      boardOrders: c.boardOrders,
      boardings: c.boardings,
      leaveOrders: c.leaveOrders,
      leaderChanges: c.leaderChanges,
      meanFollowerDistance: c.followerSamples ? Math.round(c.followerDistanceSum / c.followerSamples * 100) / 100 : null,
      withinRegroupShare: c.followerSamples ? Math.round(c.withinRegroup / c.followerSamples * 1e4) / 1e4 : null,
      sharedHullShare: c.hullPasses ? Math.round(c.sharedHullPasses / c.hullPasses * 1e4) / 1e4 : null,
      freeAgentPasses: c.freeAgentPasses,
    };
  }
}

registerDoctrine('squad', (ctx) => new SquadDoctrine(ctx));
