// The tank school's MATCHUP in plain words (features/battle-schools,
// tank-matchup.md section 1): what to do in this pairing, written from the
// numbers, never who wins. The model browser's Compare panel was removed for
// reading a verdict off a scoreboard; this says where to aim, what to keep
// away from them, and what each tank's gun and hull make you do.
//
// Pure: two tanks in, sentences out. A tank here is
//   { name, hp, gun: { reload, traverse, per100, reach },
//     shots: { 0, 90, 180: { shots, bestShots } }    // its hull, hit by the other's gun
//     sheet: { drive, steady } | null }              // tank-school/<mod>.json

const n1 = v => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
const s = v => (v === 1 ? '' : 's');
const shotsAt = (t, b) => t?.shots?.[b]?.shots ?? null;

/** Where to aim at `them` with `you`'s gun. */
export function aimWords(you, them) {
  const f = shotsAt(them, 0), sd = shotsAt(them, 90), r = shotsAt(them, 180);
  if (f == null) return [];
  const out = [`Their front takes ${f} of your shot${s(f)}, their side ${sd}, their rear ${r}.`];
  if (r != null && sd != null && r >= sd) out.push('Their rear is no softer than their side: going round the back buys nothing over the flank.');
  else if (r === 1) out.push('A square hit on their rear plate kills them outright.');
  if (them.shots[0].bestShots === 1 && f > 1) out.push('Their front has a one-shot spot: look for the red on it.');
  return out;
}

/** What `you` must keep away from `them`'s gun. */
export function exposureWords(you, them) {
  const f = shotsAt(you, 0), sd = shotsAt(you, 90), r = shotsAt(you, 180);
  if (f == null) return [];
  const out = [`Your front takes ${f} of their shot${s(f)}, your side ${sd}, your rear ${r}.`];
  const mine = shotsAt(them, 0);    // your shots on their front
  if (mine != null) {
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
  if (dy && dt && dy !== dt) {
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
  const mine = shotsAt(them, 0), theirs = shotsAt(you, 0);
  const ty = you.gun.traverse, tt = them.gun.traverse;
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
