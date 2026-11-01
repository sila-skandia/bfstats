// The combat area in a replay: the followed player's out-of-area warning and
// countdown, and which deaths were the area's (features/round-replay-hud,
// "The combat area"). The law is combat-area.js's, the page's own, read out
// of the server (ledger CA-2..CA-9); this file only runs it over what the
// recording has of a player, so a seek anywhere answers at once.
//
// What the engine does, per player (CA-9), every frame:
//   - the object he OCCUPIES is tested, the hull when seated (CA-7), by x and
//     z alone, inclusive edges (CA-6), against the level's rectangle, else the
//     terrain's (CA-1); inside the rectangle, the terrain material under it
//     counts as outside when it is `materialToGiveDamage`, 7 (CA-5);
//   - outside, his accumulator gains the frame's dt; inside, it is zeroed
//     (CA-3). Past the allowance (10 s, strict `>`) every frame damages the
//     object `dt x 5` and writes the allowance back (CA-2, CA-3);
//   - the client's `Outside/OutsideTime` is `allowance - trunc(accumulator)`
//     from the first whole second, else 0, so the plate is down for the
//     first second and again once the damage starts (CA-8).
//
// None of that is recorded: the accumulator (`player+0x178`) is not sent and
// no recorder writes it. It is a pure function of the positions, though, so
// it is worked out from them: the time since the last tick at which the
// object he controlled was inside. The walk goes back a server tick at a time
// (30 Hz) and no further than the allowance needs, and a frame that follows
// the last one picks up where that left off.
//
// What the recording cannot say: a remote player's position while out of the
// recording client's range (the walk stops there and counts him inside from
// it, so a client file can only under-read him), and the moments he spends
// dead or on the spawn screen, which the engine's loop may or may not step;
// the walk stops at them too, which is what a respawn on his own side's
// ground reads as anyway.

import { isDamagingMaterial, isInside, DEFAULT_TIME_ALLOWED } from './combat-area.js';
import { playerStatusAt } from './replay-chapters.js';
import { isReplicated, positionAt } from './replay-recording.js';

/** The server's frame, seconds: how finely the walk samples the positions. */
export const AREA_STEP = 1 / 30;

/** Metres from the origin past which a recorded position is no position: the
 *  largest installed world is 8192 m (FHSW's Dover Strait). */
const NO_PLACE = 100000;

/** A forward step longer than this is a jump, worked out again from scratch. */
const CARRY_MAX = 1;

/**
 * `area` is the page's level `CombatArea` (combat-area.js) or anything with
 * its `active`, `bounds`, `materialToGiveDamage` and `timeAllowed`;
 * `material(x, z)` the terrain material in the viewer's frame (world-fields.js
 * `combatMaterial`), or null for the rectangle alone. `area` may be a getter
 * and `material` should read the live world itself, as the level's world can
 * land after the replay opens.
 */
export class ReplayCombatArea {
  constructor(rec, { area = null, material = null, kills = rec.kills } = {}) {
    this.rec = rec;
    this.kills = kills;
    this.areaOf = typeof area === 'function' ? area : () => area;
    this.material = typeof material === 'function' ? material : null;
    // pid -> { t, inside }: the last tick walked and the last inside tick.
    this.carry = new Map();
    this._p = [0, 0, 0];
  }

  get area() {
    const a = this.areaOf();
    return a && a.active ? a : null;
  }

  get timeAllowed() {
    const a = this.area;
    return Number.isFinite(a?.timeAllowed) ? a.timeAllowed : DEFAULT_TIME_ALLOWED;
  }

  /** Is the object `pid` controls at `t` outside? true, false, or null when
   *  the recording has no place for it (dead, spawning, out of range). */
  outsideAt(pid, t) {
    const area = this.area;
    if (!area) return false;
    const status = playerStatusAt(this.rec, pid, t, this.kills);
    if (status.state !== 'foot' && status.state !== 'vehicle') return null;
    const life = status.life;
    if (!life || !isReplicated(life, t)) return null;
    const p = positionAt(life, t, this._p);
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[2])) return null;
    // A pose the server never set: a parked gun's first samples can read
    // (0, 198870, -3.4e12) (AA_Allies, replay_1791148138 at 373 s), which is
    // no place at all, not a man 3 billion km out of bounds.
    if (Math.abs(p[0]) > NO_PLACE || Math.abs(p[2]) > NO_PLACE) return null;
    // The recording's frame is BF1942's; the area is in the viewer's, z negated.
    const x = p[0];
    const z = -p[2];
    if (!isInside(area.bounds, x, z)) return true;
    const id = this.material ? this.material(x, z) : null;
    return isDamagingMaterial(id, area.materialToGiveDamage);
  }

  /** Seconds `pid` had been outside at `t`: since the last tick he was
   *  inside, or `Infinity` once that is past the allowance (the engine then
   *  holds the accumulator at the allowance and damages every frame). 0 when
   *  he is inside or the recording has no place for him. */
  secondsOutside(pid, t) {
    const now = this.outsideAt(pid, t);
    if (now !== true) {
      this.carry.set(pid, { t, inside: t });
      return 0;
    }
    const limit = this.timeAllowed + 2 * AREA_STEP;
    const held = this.carry.get(pid);
    let inside = null;
    if (held && t >= held.t && t - held.t <= CARRY_MAX) {
      // On from the last frame: only the ticks between them are new.
      inside = held.inside;
      for (let s = held.t + AREA_STEP; s < t; s += AREA_STEP) {
        if (this.outsideAt(pid, s) !== true) inside = s;
      }
    } else {
      inside = -Infinity;
      for (let s = t - AREA_STEP; s >= t - limit; s -= AREA_STEP) {
        if (this.outsideAt(pid, s) !== true) { inside = s; break; }
      }
    }
    this.carry.set(pid, { t, inside });
    const out = t - inside;
    return out > limit ? Infinity : out;
  }

  /**
   * What `pid`'s HUD and client hold at `t` (combat-area.js `step`'s record,
   * the fields the HUD reads): `{ outsideFor, countdown, damaging }`,
   * `outsideFor` the engine's accumulator (clamped to the allowance once the
   * damage starts, CA-3) and `countdown` the client's `Outside/OutsideTime`
   * (CA-8).
   */
  readout(pid, t) {
    const allowance = this.timeAllowed;
    const seconds = this.secondsOutside(pid, t);
    if (!(seconds > 0)) return { outsideFor: 0, countdown: 0, damaging: false };
    if (seconds > allowance) return { outsideFor: allowance, countdown: 0, damaging: true };
    const whole = Math.trunc(seconds);
    return { outsideFor: seconds, countdown: whole > 0 ? Math.max(0, allowance - whole) : 0, damaging: false };
  }

  /**
   * The deaths the area caused: every death no killer is named for (the kill
   * log's "is no more", score 4 or 5) that came while its victim was past the
   * allowance, out of `kills` (replay-chapters.js `killsOf`). Each is
   * `{ kill, outsideFor }`, `outsideFor` how long he had been out, seconds,
   * walked back as far as the recording has him (the area's own clamp stops
   * the engine knowing, not us).
   */
  desertions(kills = this.kills) {
    const out = [];
    if (!this.area) return out;
    for (const k of kills ?? []) {
      if (k.killer !== null && k.killer !== undefined && k.killer !== k.victim) continue;
      if (k.victim === null || k.victim === undefined) continue;
      // Just before the death: from it on he is dead and placed nowhere.
      const t = k.t - AREA_STEP;
      this.carry.delete(k.victim);
      if (this.secondsOutside(k.victim, t) !== Infinity) continue;
      let from = t - this.timeAllowed;
      // How long, for the log's line: back until he was in (ten minutes at most).
      while (from > t - 600 && this.outsideAt(k.victim, from - 1) === true) from -= 1;
      while (from > t - 600 && this.outsideAt(k.victim, from - AREA_STEP) === true) from -= AREA_STEP;
      out.push({ kill: k, outsideFor: t - from });
    }
    this.carry.clear();
    return out;
  }
}
