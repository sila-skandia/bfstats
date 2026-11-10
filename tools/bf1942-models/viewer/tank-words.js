// The tank school's MATCHUP in plain words (features/battle-schools,
// tank-matchup.md section 1): what to do in this pairing, written from the
// numbers, never who wins. The model browser's Compare panel was removed for
// reading a verdict off a scoreboard; this says where to aim, what to keep
// away from them, and what each tank's gun and hull make you do.
//
// Pure: two tanks in, sentences out. A tank here is
//   { name, hp, gun: { reload, traverse, per100, reach },
//     shots: { 0, 90, 180: { shots, bestShots } }    // its hull, hit by the other's gun
//     sheet: { drive, steady } | null }              // <maps>/_shared/tank-school.json

const n1 = v => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
const s = v => (v === 1 ? '' : 's');
const shotsAt = (t, b) => t?.shots?.[b]?.shots ?? null;
/** Past this many hits a gun is no answer to a face, whatever the sum says
 *  (FHSW's 23 mm against a T-VI's front: 1,714). */
export const NO_ANSWER = 30;
/** A count of shots as a sentence says it: none get through, past 30, or the number. */
export const sayShots = n => (n == null ? 'nothing gets through' : n > NO_ANSWER ? `more than ${NO_ANSWER}` : String(n));
const plain = (...ns) => ns.every(n => n != null && n <= NO_ANSWER);
/** The three faces in one sentence, for a gun that cannot answer them all. */
const faces3 = (who, f, sd, r) => `${who}: front ${sayShots(f)}, side ${sayShots(sd)}, rear ${sayShots(r)}.`;
/** Whether a gun hurts a hull from any side. */
export const hurtsAtAll = t => [0, 90, 180].some(b => shotsAt(t, b) != null);
/** Whether it is an answer from any side: some face within 30 hits. */
export const answers = t => [0, 90, 180].some(b => { const n = shotsAt(t, b); return n != null && n <= NO_ANSWER; });

/** Where to aim at `them` with `you`'s gun. */
export function aimWords(you, them) {
  const f = shotsAt(them, 0), sd = shotsAt(them, 90), r = shotsAt(them, 180);
  if (!them?.shots) return [];
  if (!hurtsAtAll(them)) return ['Your gun cannot hurt them from any side: no plate that faces you takes damage from its round. Leave them to someone who can.'];
  const out = [plain(f, sd, r) ? `Their front takes ${f} of your shot${s(f)}, their side ${sd}, their rear ${r}.` : faces3('Shots of yours to kill them', f, sd, r)];
  if (f == null || f > NO_ANSWER) out.push('Your gun is no answer to their front: get to a side it can hurt.');
  const share = them.shots[0]?.share;
  if (f != null && share != null && share < 0.6) {
    out.push(`Only ${Math.round(share * 100)}% of their front takes damage from your gun: aim at the painted plates, not the grey.`);
  }
  if (r != null && sd != null && r >= sd) out.push('Their rear is no softer than their side: going round the back buys nothing over the flank.');
  else if (r === 1) out.push('A square hit on their rear plate kills them outright.');
  if (them.shots[0].bestShots === 1 && f > 1) out.push('Their front has a one-shot spot: look for the red on it.');
  return out;
}

/** What `you` must keep away from `them`'s gun. */
export function exposureWords(you, them) {
  const f = shotsAt(you, 0), sd = shotsAt(you, 90), r = shotsAt(you, 180);
  if (!you?.shots) return [];
  if (!hurtsAtAll(you)) return ['Their gun cannot hurt you from any side: no plate of yours that faces them takes damage from its round.'];
  const out = [plain(f, sd, r) ? `Your front takes ${f} of their shot${s(f)}, your side ${sd}, your rear ${r}.` : faces3('Their shots to kill you', f, sd, r)];
  const mine = shotsAt(them, 0);    // your shots on their front
  if (mine != null && f != null && plain(mine, f)) {
    const yourTime = mine * you.gun.reload, theirTime = f * them.gun.reload;
    if (mine >= 2 * f) {
      out.push(`Do not trade from the front: you need ${mine} hits on theirs, they need ${f} on yours `
        + `(${n1(yourTime)} s of firing against ${n1(theirTime)} s). Get to their side.`);
    } else if (f >= 2 * mine) {
      out.push(`From the front you have the better of it: ${mine} hits on theirs against ${f} on yours.`);
    }
  }
  if (you.shots[0].bestShots === 1 && f > 1) out.push('Your own front has a one-shot spot: keep it out of their sight.');
  return out;
}

/** The two guns. */
export function gunWords(you, them) {
  const out = [];
  const ry = you.gun.reload, rt = them.gun.reload;
  if (Math.abs(ry - rt) >= 0.5) {
    out.push(ry < rt
      ? `You reload in ${n1(ry)} s, they in ${n1(rt)} s: fire, then move while they are still loading.`
      : `They reload in ${n1(rt)} s, you in ${n1(ry)} s: do not stay in their sight after you fire.`);
  } else {
    out.push(`You both reload in about ${n1((ry + rt) / 2)} s.`);
  }
  const ty = you.gun.traverse, tt = them.gun.traverse;
  if (ty && tt && ty >= 1.4 * tt) out.push(`Their turret turns at ${n1(tt)} deg/s against your ${n1(ty)}: get round to their side and stay there.`);
  else if (ty && tt && tt >= 1.4 * ty) out.push(`Their turret turns at ${n1(tt)} deg/s against your ${n1(ty)}: do not try to circle them.`);
  const dy = you.gun.per100, dt = them.gun.per100;
  // 0 a hundred metres: a round that declares no gravity and flies straight.
  if (dy === 0 || dt === 0) {
    out.push(dy === 0 && dt === 0 ? 'Both your rounds fly straight: aim at them.'
      : dy === 0 ? `Your round flies straight; theirs drops about ${dt} deg per 100 m, so past 200 m you have the easier shot.`
        : `Their round flies straight; yours drops about ${dy} deg per 100 m: close the range, or hold over.`);
  } else if (dy && dt && dy !== dt) {
    out.push(dy > dt
      ? `Your shell drops about ${dy} deg per 100 m, theirs ${dt}: past 200 m they can hit you more easily than you can hit them. Close the range, or stay out of their sight.`
      : `Your shell drops about ${dy} deg per 100 m, theirs ${dt}: at range the advantage is yours.`);
  } else if (dy) {
    out.push(`Your shells fly alike: hold over about ${dy} deg for every 100 m.`);
  }
  return out;
}

/** The hulls: the peek, and how long each takes to steady. */
export function hullWords(you, them) {
  const out = [];
  const dy = you.sheet?.drive, st = you.sheet?.steady, sth = them.sheet?.steady;
  if (dy?.forward5 && dy?.back5) {
    const peek = dy.forward5 + dy.back5;
    out.push(`The peek, 5 m up and 5 m back, takes you ${n1(peek)} s; their gun reloads in ${n1(them.gun.reload)} s.`);
  }
  const hs = st?.hardStop;
  if (hs && hs.peak >= 8) {
    out.push(`After a hard stop your hull pitches ${n1(hs.peak)} deg and is still only after ${n1(hs.still)} s`
      + (Math.abs(hs.left) >= 0.5 ? `, ${n1(Math.abs(hs.left))} deg off` : '')
      + '. Coast to a stop, and re-lay before you fire.');
  }
  if (sth?.hardStop?.peak >= 8) out.push(`Their hull pitches ${n1(sth.hardStop.peak)} deg after a hard stop: their first shot after stopping is their worst.`);
  const fa = st?.fireAcross;
  if (fa && fa.peak >= 10) out.push(`A shot fired across your hull rolls it ${n1(fa.peak)} deg: give it ${n1(fa.still)} s before the next.`);
  return out;
}

/** The one line at the top: the most important thing in this pairing. */
export function headline(you, them) {
  if (!hurtsAtAll(them) && !hurtsAtAll(you)) return 'Neither gun can hurt the other: this is not a fight.';
  if (!answers(them) && !answers(you)) return 'Neither gun is an answer to the other: this is not a fight.';
  if (!hurtsAtAll(them)) return 'Your gun cannot hurt them, and theirs can hurt you: do not take this fight.';
  if (!answers(them)) return `Your gun barely scratches them (more than ${NO_ANSWER} hits from every side): do not take this fight.`;
  if (!hurtsAtAll(you)) return 'Their gun cannot hurt you: take your time and find the face yours gets through.';
  if (!answers(you)) return `Their gun barely scratches you (more than ${NO_ANSWER} hits from every side): take your time and find the face yours gets through.`;
  const mine = shotsAt(them, 0), theirs = shotsAt(you, 0);
  const ty = you.gun.traverse, tt = them.gun.traverse;
  if ((mine == null || mine > NO_ANSWER) && theirs != null) return 'Your gun is no answer to their front: get to a side it can hurt.';
  if (mine != null && theirs != null && mine >= 2 * theirs) {
    return ty >= 1.4 * tt ? 'Get off their front, and use your faster turret to stay on their side.' : 'Get off their front: you lose a straight trade.';
  }
  if (mine != null && theirs != null && theirs >= 2 * mine) return 'Make them fight you from the front: the straight trade is yours.';
  if (ty && tt && ty >= 1.4 * tt) return 'Your turret is faster: fight close and get round to their side.';
  if (ty && tt && tt >= 1.4 * ty) return 'Their turret is faster: keep your distance and fire from cover.';
  return 'An even pairing: the first square hit on a side decides it.';
}

/** All of it: `{ headline, aim, exposed, guns, hulls }`. */
export function matchupWords(you, them) {
  return {
    headline: headline(you, them),
    aim: aimWords(you, them),
    exposed: exposureWords(you, them),
    guns: gunWords(you, them),
    hulls: hullWords(you, them),
  };
}

// --- steadiness, in what it does to a shot ---------------------------------------

/** How far off a shot lands at `range` metres when the gun is tilted `deg`
 *  degrees from where it was laid: the hull carries the gun with it. */
export function missAt(deg, range = 200) {
  return range * Math.tan(Math.abs(deg) * Math.PI / 180);
}

/** When a trace (degrees, `hz` samples a second) is last more than `tol`
 *  degrees from where it comes to rest: from then on the gun stays within
 *  it, and a re-aim holds. 0 if it never left. (A hull can come to rest
 *  tilted, the Tiger 1.5 degrees low after a hard stop: that is the rest,
 *  not a swing, and `steadyWords` says it on its own.) */
export function steadyAfter(values, hz, tol = 1) {
  const rest = values[values.length - 1] ?? 0;
  let last = -1;
  values.forEach((v, i) => { if (Math.abs(v - rest) > tol) last = i; });
  return last < 0 ? 0 : (last + 1) / hz;
}

/** What a scenario's trace means for one tank's next shot, in a sentence or
 *  two: the worst miss it throws at 200 m, and when it is steady to fire. */
export function steadyWords(name, trace, summary = null, { range = 200, reload = null } = {}) {
  if (!trace?.values?.length) return [];
  const peak = Math.max(...trace.values.map(Math.abs));
  const after = steadyAfter(trace.values, trace.hz, 1);
  const out = [];
  if (peak <= 1) {
    out.push(`${name}: never more than ${n1(peak)} deg off. Fire when you like.`);
  } else {
    out.push(`${name}: at worst ${n1(peak)} deg off, which throws a shot ${Math.round(missAt(peak, range))} m wide of a target ${range} m away. `
      + `It has stopped swinging (within 1 deg) after ${n1(after)} s.`);
  }
  if (reload && peak > 1) {
    out.push(after <= reload
      ? `It has settled before the next round is loaded (${n1(reload)} s).`
      : `It is still swinging when the next round is loaded (${n1(reload)} s): wait, or the shot goes wide.`);
  }
  const left = summary?.left;
  if (left != null && Math.abs(left) >= 0.5) {
    out.push(`It comes to rest ${n1(Math.abs(left))} deg ${left < 0 ? 'low' : 'high'}: ${Math.round(missAt(left, range))} m at ${range} m until you re-aim.`);
  }
  return out;
}

/**
 * A soldier's anti-tank weapon against a tank, at R m (the ON FOOT panel):
 * `w` is `{ name, reach, aim: { elevation, t }, drop, spread: { still,
 * moving, declared }, stillM, movingM, charge, falloff }` (`tank-launchers.js`;
 * `charge` `{ fuse, radius }` for a thrown charge that bursts on its fuse,
 * `falloff` `{ factor, full, min, floor }` for a round that has lost damage
 * by R), `target` is
 * `{ name, heightM, lengthM, top, shots }` with `top` its top speed (m/s, or
 * null) and `shots` its clock (`{ 0, 90, 180: { shots, share } }`).
 */
export function launcherWords(w, target, R) {
  const out = [];
  const reach = Math.round(w.reach.range);
  const ends = w.reach.fuse ? 'its fuse runs out' : 'it lands';
  // A thrown charge leaves the hand, not a tube.
  const up = e => (w.charge ? `thrown ${n1(e)} deg up` : `with the tube ${n1(e)} deg up`);
  if (w.aim.elevation == null) {
    out.push(`The ${w.name} cannot reach ${R} m: ${ends} ${reach} m out at most, ${up(w.reach.elevation)}. Get within ${reach} m.`);
  } else {
    const e = w.aim.elevation, h = target.heightM;
    if (w.drop < 0) out.push(`Aim straight at them: the round climbs on its launch and barely falls, ${n1(-w.drop)} m above the line by ${R} m.`);
    else if (w.drop < h * 0.5) out.push(`Aim straight at them: by ${R} m the round falls ${n1(w.drop)} m, less than half their height.`);
    else if (w.charge) out.push(`At ${R} m throw it ${n1(e)} deg above them: it falls ${n1(w.drop)} m on the way. It goes ${reach} m at most.`);
    else out.push(`At ${R} m point the tube ${n1(e)} deg above them: the round falls ${n1(w.drop)} m on the way, ${n1(w.drop / h)} times their height. It goes ${reach} m at most.`);
    const t = w.aim.t;
    if (target.top) {
      const lead = target.top * t, lengths = target.lengthM ? lead / target.lengthM : null;
      out.push(`It takes ${n1(t)} s to get there. Crossing at ${n1(target.top)} m/s, the ${target.name} moves ${n1(lead)} m in that time`
        + `${lengths != null && lengths >= 0.5 ? `, ${n1(lengths)} tank length${n1(lengths) === '1' ? '' : 's'}` : ''}: aim that far ahead, or wait until it stops or drives straight at you.`);
    } else {
      out.push(`It takes ${n1(t)} s to get there: lead a moving tank by its speed times that.`);
    }
  }
  if (w.falloff) {
    out.push(`Past ${Math.round(w.falloff.full)} m its round loses damage: at ${R} m it does ${Math.round(w.falloff.factor * 100)}% of a close hit, `
      + `and ${Math.round(w.falloff.floor * 100)}% from ${Math.round(w.falloff.min)} m. Get inside ${Math.round(w.falloff.full)} m.`);
  }
  if (w.charge) {
    const gone = target.top ? target.top * w.charge.fuse : null;
    out.push(`A charge, not a round: it goes off on its fuse, ${n1(w.charge.fuse)} s after it leaves your hand, wherever it lies then, and its blast reaches ${Math.round(w.charge.radius)} m, falling away to nothing at the edge.`
      + (gone ? ` In ${n1(w.charge.fuse)} s the ${target.name} can drive ${Math.round(gone)} m: throw it at a tank that has stopped, or onto the ground it is driving over.` : ''));
  }
  if (!w.spread.declared || w.spread.still === 0) {
    out.push(w.charge ? 'No spread: it goes exactly where you throw it. A miss is the throw or the lead, never luck.'
      : 'No spread: the game sends the round exactly where the tube points. A miss is the drop or the lead, never luck.');
  } else {
    out.push(`Standing still it strays up to ${n1(w.stillM)} m from where you point at ${R} m, on each axis; walking, up to ${n1(w.movingM)} m. Stop before you fire.`);
  }
  const f = shotsAt(target, 0), sd = shotsAt(target, 90), r = shotsAt(target, 180);
  if (![f, sd, r].some(v => v != null)) out.push(`Its warhead cannot hurt the ${target.name} from any side.`);
  else if (w.charge && plain(f, sd, r)) out.push(`Throws to kill, each going off against the hull: front ${f}, side ${sd}, rear ${r}.`);
  else if (plain(f, sd, r)) out.push(`Hits to kill on a plate it gets through: front ${f}, side ${sd}, rear ${r}.`);
  else out.push(faces3('Hits to kill', f, sd, r));
  return out;
}
