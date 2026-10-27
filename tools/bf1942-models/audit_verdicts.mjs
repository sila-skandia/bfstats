// Verdicts of the behaviour audit (`audit_behaviour.mjs`), kept apart from the
// harness so a node test can pin them without a browser.
//
// Steering (`testGround`). Every turn here is measured to the right: `rightTurn(a, b)` is the angle the
// nose went from frame `a` to frame `b`, positive when it swung towards `a`'s
// right vector. The hull's own yaw rate before D is pressed is measured the same
// way and taken off what follows, so a hull still swinging from a knock (a horse
// that struck something 3.5 s off its pad, fell from 11.3 to 0.4 m/s and slewed
// left with no key down) does not read as one whose D steers left.

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp1 = x => Math.max(-1, Math.min(1, x));

/** Signed angle in radians the nose turned to the right from axes `a` to `b`. */
export function rightTurn(a, b) {
  return Math.asin(clamp1(dot3(b.forward, a.right)));
}

/** Yaw rate (rad/s, positive right) at or above which a hull is still slewing
 *  and the press of D waits for it to settle. */
export const SETTLE_RATE = 0.2;

/**
 * The verdict on a D press.
 *
 *  preRate   yaw rate to the right before D (rad/s), from two frames 0.5 s apart
 *  turnA     right turn over the first `dtA` seconds of D (rad)
 *  dtA       seconds between the press and `turnA`'s frame
 *  turned    absolute heading change over the whole hold (rad)
 *  speed     ground speed at the end of the hold (m/s)
 *
 * Returns { verdict: 'ok'|'reversed'|'no-steer'|'unsettled'|'slow', induced }.
 * `induced` is the right turn D added to what the hull was already doing.
 */
export function steerVerdict({ preRate = 0, turnA, dtA = 1, turned, speed }) {
  const induced = turnA - preRate * dtA;
  if (!(speed > 1.5 || turned > 0.05)) return { verdict: 'slow', induced };
  if (speed > 3 && Math.abs(turnA) > 0.1 && induced < -0.15) {
    // A hull still slewing hard left when D went down: the left swing can
    // outlast the press however the steering works, so the press proves
    // nothing either way. Reported for a rerun, not as a reversed steer.
    if (preRate <= -SETTLE_RATE) return { verdict: 'unsettled', induced };
    return { verdict: 'reversed', induced };
  }
  if (speed > 3 && turned < 0.02) return { verdict: 'no-steer', induced };
  return { verdict: 'ok', induced };
}

/**
 * Why an aim axis cannot move by its own data, or null (`testSeatsAndGuns`;
 * a row of `__aimSeat`). The servo is GUN-2b's (`turret-rig.js` `step`): with
 * no `maxSpeed` and no continuous rotation the input buys no rate, an
 * `automaticReset` axis ramps to `input * max` and so stays home when `max` is
 * 0, and a range that does not wrap (`free` is both bounds 0) clamps to its
 * bounds. A carrier's elevator seat declares `setInputToPitch` on a camera
 * rotator whose pitch `setMaxSpeed` is 0.
 */
export function heldByData(a) {
  if (!a || a.maxSpeed === undefined) return null;
  if (a.automaticReset) return a.max ? null : 'automaticReset towards a max of 0';
  if (!a.maxSpeed && !a.continuous) return 'maxSpeed 0 and no continuous rotation';
  if (!a.free && a.min === a.max) return `range ${a.min}..${a.max}`;
  return null;
}

/**
 * The deploy seat's sequence as its own check (FHX-24; `testSeatsAndGuns`):
 * `deploy` is `{ stoodAt, hullDiedAt, testerDiedAt, seatedAtDeath }`, the
 * seconds after the trigger each happened, or null. The round's spawner
 * stands its object (the static gun, `spawnObject` 0x083140a0); the killer
 * charge destroys the hull it was thrown from (`startEndEffect` 0x0831f590);
 * a tester seated when it bursts dies with it (`GameServer::_giveDamage`
 * 0x0814b870 walks the hull's seats on the lethal call, AI-76). Returns the
 * findings, each `{ cause_key, severity, evidence }`: the major faults, or
 * the one info row saying the sequence ran.
 *
 * `deploy.owedDeath` (absent: true, the FHX-24 family) says whether a killer
 * dropped from the seat is lethal to the hull by the material table
 * (`round-spawners.js` `deployRole`, FHX-30). A towing tractor's is not: its
 * Fire unhitches the gun (the deploy round stands it, a depot round kills the
 * towed dummy) and its re-hook killer only takes a towed gun within 8 m, so
 * the tractor lives and drives on. A hull owed no death that dies anyway is
 * the major then.
 */
export function deployVerdict(deploy, untestedSeats = []) {
  const d = deploy ?? {};
  const owed = d.owedDeath !== false;
  const said = `stood at ${d.stoodAt ?? '-'} s, hull destroyed at ${d.hullDiedAt ?? '-'} s, `
    + `tester died at ${d.testerDiedAt ?? '-'} s`
    + (d.killerHp != null ? `; killer ${d.killerHp} hp on a ${d.hp ?? '-'} hp hull` : '');
  const out = [];
  if (d.stoodAt == null) {
    out.push({ cause_key: 'veh.deploy-nothing-stood', severity: 'major',
      evidence: `the deploy round's spawner stood nothing (${said})` });
  }
  if (!owed) {
    if (d.hullDiedAt != null) {
      out.push({ cause_key: 'veh.deploy-hull-destroyed', severity: 'major',
        evidence: `no killer the seat drops is lethal to the hull, and it died (${said})` });
    }
  } else if (d.hullDiedAt == null) {
    out.push({ cause_key: 'veh.deploy-hull-survived', severity: 'major',
      evidence: `the killer charge never destroyed the hull it was thrown from (${said})` });
  } else if (d.seatedAtDeath && d.testerDiedAt == null) {
    out.push({ cause_key: 'veh.deploy-crew-survived', severity: 'major',
      evidence: `the hull was destroyed with the tester seated and he lived (AI-76; ${said})` });
  }
  if (!out.length) {
    out.push({ cause_key: 'veh.deploy-sequence', severity: 'info', retail_faithful: true,
      evidence: `${said}${untestedSeats.length ? `; seats ${untestedSeats.join(', ')} not tested: the hull is gone` : ''}` });
  }
  return out;
}

// Kits (`testWeapon`). The weld check measures where the weapon sits in each
// hand bone's frame while the trigger is held, against where it sat at rest.

/**
 * What the arms rig says about its own families, from the extras the page
 * mounted (`hw.clips`, `hw.data`): the same document the extractor wrote, read
 * through the page so a rig the mod inherits from its parent's tree is read
 * too (a lookup by the tree's own path missed every one of those, and their
 * thrown weapons were then fired, zoomed and reloaded like rifles).
 *
 *  thrower       the weapon has a `throw` block (`FireArms` `fireDelay` /
 *                `hideDuringFireTime`), or its fire state returns to a raise:
 *                the item leaves the hand by design
 *  fireLoop      the fire clip loops
 *  fireAbsent    fire states exist and none names a 1p clip the install has
 *  reloadAbsent  the reload family names no 1p clip: the state machine has no
 *                reload state with one, or the clip is in no archive
 */
export function rigFamilies(clips, weaponStats) {
  if (!clips && !weaponStats) return null;
  const all = clips ?? {};
  const fires = Object.entries(all).filter(([k]) => /^fire\d*$/.test(k));
  const live = fires.filter(([, v]) => v && v.upperClip);
  const fire = all.fire && all.fire.upperClip ? all.fire : (live[0]?.[1] ?? null);
  const reloads = Object.entries(all).filter(([k]) => /^reload\d*$/.test(k));
  return {
    fireLoop: !!fire?.loop,
    thrower: !!weaponStats?.throw || /raiseweapon/i.test(fire?.returnTo ?? ''),
    fireAbsent: fires.length > 0 && live.length === 0,
    reloadAbsent: !reloads.some(([, v]) => v && v.upperClip),
    hasFire: !!fire,
  };
}

const angleBetween = (a, b) => {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
};

/**
 * Largest departure from `rest` over the samples, as the better of the hands:
 * `{ pos_m, rot_rad, hand, samples }`, or null when the rig has no hand bones.
 * A sample of another weapon (`id`: the welded node; a one-shot launcher's
 * `changeWeaponWhenNoAmmo` raises the next item mid-burst) is not this
 * weapon's weld and is left out; `samples` counts the ones read.
 */
export function weldDeviation(rest, samples) {
  if (!rest) return null;
  const own = samples.filter(smp => smp && (rest.id == null || smp.id === rest.id));
  let best = null;
  for (const hand of ['L', 'R']) {
    if (!rest[hand]) continue;
    let pos = 0, rot = 0;
    for (const smp of own) {
      if (!smp[hand]) continue;
      const a = rest[hand].p, b = smp[hand].p;
      pos = Math.max(pos, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      rot = Math.max(rot, angleBetween(rest[hand].q, smp[hand].q));
    }
    if (!best || pos < best.pos_m) best = { pos_m: pos, rot_rad: rot, hand };
  }
  return best && { pos_m: +best.pos_m.toFixed(3), rot_rad: +best.rot_rad.toFixed(2), hand: best.hand,
    samples: own.length };
}

/**
 * The weld verdict: null when the weapon stayed in the hands, else the
 * finding's evidence fields. `authored` is how far the rig's own fire clips
 * move the weapon's grip wrapper off its rest weld, `{ pos_m, rot_rad }`
 * (`extract_viewmodel.py` writes the weapon clip's main-bone motion there,
 * `gripAnimated`): a slide the retail clip authors (the PTRS's
 * `PTRSFire.baf` runs the rifle 10 cm back through the hand) is the game's,
 * and only motion past it is the page's. `tol` is the `{ pos_m, rot_rad }`
 * slack on top.
 */
export function weldVerdict(dev, authored, tol) {
  if (!dev) return null;
  const pos = (authored?.pos_m ?? 0) + tol.pos_m;
  const rot = (authored?.rot_rad ?? 0) + tol.rot_rad;
  if (dev.pos_m <= pos && dev.rot_rad <= rot) return null;
  return { pos_m: dev.pos_m, rot_rad: dev.rot_rad, hand: dev.hand,
    authored: authored && (authored.pos_m > 0 || authored.rot_rad > 0) ? authored : null };
}

/**
 * Why a hull stands off its pad when the level data, not the page, put it
 * there. `spawnObject` (0x083140a0) stands the object at the spawner's pose
 * with no ground query (ledger SPAWN-28): a spawner the level buried has its
 * hull lifted out by its mobile parts' terrain contacts, a hop that lands
 * beside the pad (recorded in the server lab); one the level stood in the air
 * with nothing under it drops its hull straight down onto the ground.
 * `padY`/`padGround` are the spawner's height and the ground under it,
 * `hullY`/`hullGround` the hull's and the ground under the hull, `dh`/`dy`
 * the hull's offset from the pad. Returns 'under-ground', 'over-ground' or
 * null (the page moved it: a fault).
 */
export function padGroundVerdict({ padY, padGround, hullY, hullGround, dh, dy }) {
  if (![padY, padGround, hullY, hullGround, dh, dy].every(Number.isFinite)) return null;
  const onGround = hullY - hullGround <= 4 && hullY - hullGround >= -1;
  if (!onGround || dh > 15) return null;
  if (padY < padGround - 0.3) return 'under-ground';
  if (dh <= 1.5 && dy < 0 && padY > padGround + 1) return 'over-ground';
  return null;
}

/**
 * Whether a parked hull's wheels let it roll away: every wheel `c_PGFRollGrip`
 * (flag 2) with no `RollGripWhenOccupied` bit (8), no engine (4), contact (1)
 * or static-friction (0x80) grip among them. `PhysicsSpring::updatePhysics`
 * turns only a flag-8 wheel into ContactGrip while the seat is empty, and
 * RollGrip asks back only the speed along the wheel's axle (AIRGND-2), so such
 * a hull rolls down a slope from its pad in retail as on the page (FHSW's NKL26
 * aerosan on its four ski Springs). `grips` is the hull's own wheels' flags.
 */
export function rollsFreely(grips) {
  if (!Array.isArray(grips) || !grips.length) return false;
  return grips.every(g => (g & 2) && !(g & (1 | 4 | 8 | 0x80)));
}
