// Barbed wire: what an `Obstacle` does to whatever touches it.
//
// `ObjectTemplate.create Obstacle` is the class every barbed-wire template in
// vanilla, XPack1 and XPack2 is made from (`stebarbwire_m1`, `stebarbwire2_m1`
// and XPack2's four `Milifence_*barb*` children), and it is the only static
// class with a collision handler of its own. The whole law is three handlers
// in the Linux server (ledger OBS-1..OBS-6,
// `features/barbed-wire-parity/README.md`):
//
//   `Obstacle::handleCollision` 0x08315e10   true for a soldier; against
//       anything else it sends itself `handleMessage(0, 0)` and returns false.
//   `PlayerControlObject::handleCollision` 0x08318b00   a vehicle touching an
//       `Obstacle` sends it `handleMessage(0, 0)` and returns 0: no response,
//       the hull rolls through.
//   `BFSoldier::handleCollision` 0x0827d3b0   a soldier touching one:
//       sets his slow flag (`+0x578`), sends the wire `handleMessage(0, 0)`,
//       and unless the wire is already in his Armor's collision list adds it
//       and calls `IGameServer::giveDamage(soldier, template.damage, -1, -1,
//       -1, his position, -1, false, true)`. Returns 0: he walks through.
//
// The message is the scrape: `Bundle::handleMessage` 0x081a74b0 forwards it to
// the wire's children, the `e_Barbwire` EffectBundle, whose own
// `handleMessage` 0x081e1460 starts its sound (`e_Barbwire.ssc`) on message 0.
//
// Every handler runs only when the contact's relative speed squared exceeds
// 0.1 (`collision-response.md` §6.2); below it the response runs and the wire
// is as solid as any static.
//
// Framework-free, so `tests/obstacle_harness.mjs` runs it under node. Its one
// import is `soldier-locomotion.js` (and that module's `parachute.js`).

/** `ObjectTemplate.damage` on an `ObstacleTemplate`: the constructor's
 *  default, `mov [ebx+0x150], 0x40a00000` at 0x08315e8a (ConsoleClass597,
 *  `damage`, is the setter). No vanilla, XPack1 or XPack2 template sets it. */
export const OBSTACLE_DAMAGE = 5.0;

// `slowDownMod` (0.4, BFSoldierTemplate +0x2f8) and the handler gate
// (`|vRel|^2 > 0.1`) are the walking body's own numbers, defined beside it.
export { SLOW_DOWN_MOD, OBSTACLE_HANDLER_SPEED_SQ } from './soldier-locomotion.js';

/** How long an object stays in an Armor's collision list: `addColObject`
 *  0x08173740 gives a new entry `1.0 - (the lifetimes still queued)` and
 *  `Armor::update` 0x08172f40 spends the head's by the tick's dt, so every
 *  entry leaves exactly this long after it went in. */
export const COL_LIST_LIFETIME = 1.0;

/** The ring's size: indices are masked `& 0xf`. A full ring drops its
 *  oldest entry. */
export const COL_LIST_SIZE = 16;

/**
 * `Armor`'s collision list (+0x54 objects, +0x94 lifetimes, +0xd4 head, +0xd8
 * tail): the objects that have hurt this body in the last second. The engine
 * keeps it so one contact held for many ticks bills its damage once a second
 * rather than once a tick.
 */
export class ColObjectList {
  constructor() {
    this.objects = new Array(COL_LIST_SIZE).fill(null);
    this.lifetimes = new Float64Array(COL_LIST_SIZE);
    this.head = 0;
    this.tail = 0;
  }

  /** `Armor::isInColList` 0x081744d0. */
  has(object) {
    for (let i = this.head; i !== this.tail; i = (i + 1) & 0xf) {
      if (this.objects[i] === object) return true;
    }
    return false;
  }

  /** `Armor::addColObject` 0x08173740. */
  add(object) {
    let left = COL_LIST_LIFETIME;
    for (let i = this.head; i !== this.tail; i = (i + 1) & 0xf) left -= this.lifetimes[i];
    if (left < 0) left = 0;
    this.objects[this.tail] = object;
    this.lifetimes[this.tail] = left;
    this.tail = (this.tail + 1) & 0xf;
    if (this.tail === this.head) this.head = (this.head + 1) & 0xf;
  }

  /** `Armor::update` 0x08172f40's list pass: the head's lifetime spent by
   *  `dt`, the remainder carried to the next entry as each one runs out. */
  update(dt) {
    let spend = dt;
    while (this.head !== this.tail) {
      const left = this.lifetimes[this.head] - spend;
      this.lifetimes[this.head] = left;
      if (left >= 0) break;
      this.objects[this.head] = null;
      this.head = (this.head + 1) & 0xf;
      spend = -left;
    }
  }

  /** `Armor::clearColObjectList` 0x081737b0. */
  clear() {
    this.objects.fill(null);
    this.head = 0;
    this.tail = 0;
  }
}

/**
 * The soldier's half of `BFSoldier::handleCollision`'s Obstacle branch, for
 * one contact: whether it bills damage, and how much. `armor` is anything
 * with `colList` (a `ColObjectList`, created on first use); `obstacle` is the
 * wire's identity; `damage` its template's `damage`. The slow flag and the
 * message are the caller's (they happen on every contact, billed or not).
 */
export function obstacleDamage(armor, obstacle, damage = OBSTACLE_DAMAGE) {
  if (!armor) return 0;
  if (!armor.colList) armor.colList = new ColObjectList();
  if (armor.colList.has(obstacle)) return 0;
  armor.colList.add(obstacle);
  return damage > 0 ? damage : 0;
}

/**
 * Where obstacle `id`'s scrape sounds from: the wire object's own origin, the
 * `e_Barbwire` child's `setPosition 0/0/0` (world frame, the glTF's). `collider`
 * is the `WorldCollider`; null when it cannot say.
 */
export function obstacleOrigin(collider, id) {
  const node = collider?.obstacleNode?.(id);
  const e = node?.matrixWorld?.elements;
  return e ? [e[12], e[13], e[14]] : null;
}

/**
 * The scrape's one-shot policy. Every contact tick messages the wire, and
 * the message restarts nothing already sounding: a wire whose scrape is
 * still playing is not started again until it has finished, so a hull
 * dragged along a fence for three seconds plays the sample through, then
 * again, rather than stacking thirty copies a second on one point (the .ssc
 * rule: never two voices of one sample at one point at one rate).
 *
 * INFERRED: the client's `ISoundObject` start on an already-playing one-shot
 * was not read (the server's `EffectBundle::handleMessage` 0x081e1460 only
 * shows that message 0 calls the sound object's vt+0x14); restart-while-
 * playing and one voice per contact tick were both ruled out by that rule.
 */
export class ScrapeVoices {
  constructor() {
    /** obstacle -> the time its current voice ends. */
    this.until = new Map();
  }

  /**
   * A message reached `obstacle` at time `now` (seconds). Returns true when a
   * new voice should start; `length` is that voice's duration in seconds.
   */
  touch(obstacle, now, length) {
    const end = this.until.get(obstacle);
    if (end !== undefined && now < end) return false;
    this.until.set(obstacle, now + Math.max(0, length || 0));
    return true;
  }

  clear() { this.until.clear(); }
}
