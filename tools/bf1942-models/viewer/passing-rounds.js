// The sound of a round nobody draws: a bot's bullet, which the referee
// resolves as an instant ray (`bot-referee.js` `resolveShot`).
//
// In the game a round is an object of its own, and every object starts every
// patch of its sound script when it is made (ledger SND-19). A bullet's script
// is its passing crack: vanilla's `Objects/Common/Sounds/Projectile_High.ssc`
// (FH and FHSW load the same shape, `bulletair1..7`) gates seven one-shots on
// `Volume <- Distance` (full inside 10 m) and `Volume <- Time` (open from
// 75 ms), with `randomPlay 1`, and its `trigger Volume` lines decide when one
// may sound (ledger SND-37). The patch reads `Distance` from where the round
// is, every update, so what a listener hears depends on where the round goes
// past him. Rounds the page flies (a vehicle's gun, a replay, another player)
// already carry their script (`round-launch.js` `playSound`); this gives a
// bot's ray the same: a point that flies down the ray at the weapon's muzzle
// speed, for as long as the round would, followed by the round's own script
// in `EffectAudio`.
//
// Not modelled: the ray does not meet the world, so a round into a hill flies
// on through it to its time to live or the body it met.

const GRAVITY = 9.81;

/**
 * Closest approach of the segment `origin + dir * s`, `s` in `[0, length]`,
 * to `p`, ignoring the drop: a bullet's is centimetres over the 10 m that
 * matter here.
 */
function closestApproach(origin, dir, length, p) {
  const vx = p.x - origin[0], vy = p.y - origin[1], vz = p.z - origin[2];
  const s = Math.max(0, Math.min(length, vx * dir[0] + vy * dir[1] + vz * dir[2]));
  return Math.hypot(vx - dir[0] * s, vy - dir[1] * s, vz - dir[2] * s);
}

export class PassingRounds {
  /**
   * @param {object} opts
   * @param {object} opts.effectAudio  the page's `EffectAudio`
   * @param {() => {x:number,y:number,z:number}|null} opts.listener  where the
   *   ear is now, to skip rounds that never come near it
   */
  constructor({ effectAudio, listener = () => null }) {
    this.effectAudio = effectAudio;
    this.listener = listener;
    this.live = [];
    this.flown = 0;
    this.skipped = 0;
  }

  /**
   * A round of `template` leaves `origin` along the unit `dir` at `speed`
   * m/s and flies `length` m (to the body it met, or for its time to live),
   * dropping at `gravity` times g. Returns whether its script was started.
   */
  fly(template, origin, dir, speed, length, gravity = 0) {
    const audio = this.effectAudio;
    if (!audio || !template || !(speed > 0) || !(length > 0) || !audio.has(template)) return false;
    // A round whose line never comes within reach of any of its script's
    // layers costs nothing: the script says how far it can be heard.
    const ear = this.listener?.();
    const reach = audio.reachOf?.(template);
    if (ear && Number.isFinite(reach) && closestApproach(origin, dir, length, ear) > reach) {
      this.skipped += 1;
      return false;
    }
    const round = {
      origin: [origin[0], origin[1], origin[2]],
      dir: [dir[0], dir[1], dir[2]],
      speed,
      drop: 0.5 * GRAVITY * (gravity || 0),
      end: length / speed,
      age: 0,
      token: Symbol(template),
      at: [origin[0], origin[1], origin[2]],
    };
    const follow = () => {
      const t = Math.min(round.age, round.end);
      const s = round.speed * t;
      round.at[0] = round.origin[0] + round.dir[0] * s;
      round.at[1] = round.origin[1] + round.dir[1] * s - round.drop * t * t;
      round.at[2] = round.origin[2] + round.dir[2] * s;
      return round.at;
    };
    round.follow = follow;
    audio.play(template, follow(), { follow, token: round.token });
    this.live.push(round);
    this.flown += 1;
    return true;
  }

  /** One frame, before `EffectAudio.update`: age every round and let go of
   *  the ones that have landed. */
  tick(dt) {
    const step = Math.max(0, dt || 0);
    let keep = 0;
    for (const round of this.live) {
      round.age += step;
      if (round.age > round.end) {
        this.effectAudio?.finish?.(round.token);
        continue;
      }
      this.live[keep++] = round;
    }
    this.live.length = keep;
  }

  /** A level change: every round in flight is gone. */
  clear() {
    for (const round of this.live) this.effectAudio?.finish?.(round.token);
    this.live.length = 0;
  }
}
