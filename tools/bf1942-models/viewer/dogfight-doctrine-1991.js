// The jet age's rules of air fighting, and what Desert Combat's own data
// says of each: the dogfight school's Rules card on a Desert Combat arena
// (features/dogfight-doctrine-1991). On any other tree the card is
// Boelcke's eight (`dogfight-doctrine.js`); the tank school does the same
// for its two wars (`tank-doctrine-1918.js`, `tank-doctrine-1991.js`).
//
// The rules are Blesse's No Guts, No Glory (1955), Boyd's Aerial Attack
// Study (1964), the USAF's F-16 fundamentals manual (AFTTP 3-3 Volume 5,
// 1999) and Shaw's Fighter Combat (1985, paraphrased only: it is in
// copyright). Boyd wrote for a gun and a missile that had to be fired from
// astern, which is what Desert Combat's jets carry: its AIM-9 has no seeker.
// Each rule says in our words what it asks, quotes a few words of its
// source, and is checked against the two jets on stage. Every quote was
// checked against the scan's text.
//
// Pure: two jets in, a verdict per rule out. A jet is `jetOf(node, name,
// law)`: its hit points and weapons read off its model's own extras, and
// `law`, what the page's flight law does with the airframe
// (`dogfight-airframe.js` `measureAirframe`), or null where not measured.

/** A missile's speed (m/s) at seconds after launch, as the lab server's
 *  recordings of the real game flew it (features/desert-combat-parity,
 *  lab-ground-truth.md, "Rounds in flight": 60 AIM-9 and 23 AA-10 flights).
 *  Neither turned more than 0.13 degrees: they are not guided. */
export const LAB_FLIGHT = {
  aim9: [[0, 498.8], [0.5, 222.9], [1, 153.9], [2, 109.5], [3, 95.3], [5, 87.4]],
  aa10: [[0, 508.0], [0.5, 183.8], [1, 119.3], [2, 83.8]],
};
/** The fuse that makes them anti-aircraft weapons: the round bursts this
 *  near an aircraft (m), read from the mod's own scripts
 *  (`explodeNearEnemyDistance`; features/dogfight-doctrine, "Research notes"). */
export const FUSE = { aim9: 7, aa10: 7 };

/** Metres flown `t` s after launch on a lab curve (straight between samples). */
export function flown(curve, t) {
  let d = 0;
  for (let i = 1; i < curve.length && curve[i - 1][0] < t; i++) {
    const [t0, v0] = curve[i - 1], [t1, v1] = curve[i];
    const end = Math.min(t, t1);
    const vEnd = v0 + (v1 - v0) * (end - t0) / (t1 - t0);
    d += (v0 + vEnd) / 2 * (end - t0);
  }
  return d;
}
/** A missile's speed `t` s after launch on a lab curve; its last speed past the end. */
export function speedAt(curve, t) {
  for (let i = 1; i < curve.length; i++) {
    const [t0, v0] = curve[i - 1], [t1, v1] = curve[i];
    if (t <= t1) return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
  }
  return curve[curve.length - 1][1];
}

const n0 = v => Math.round(v).toLocaleString('en-US');
const n1 = v => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
const verdict = (status, words) => ({ status, words });

/** A missile as its pilot says it, and the lab curve that is its. */
function missileKind(template) {
  const t = String(template ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/aim9/.test(t)) return { label: 'AIM-9', key: 'aim9' };
  if (/aa10/.test(t)) return { label: 'AA-10', key: 'aa10' };
  if (/magic/.test(t)) return { label: 'Magic', key: null };
  if (/maverick/.test(t)) return { label: 'Maverick', key: null };
  if (/hydra|ffar|s5/.test(t)) return { label: 'rockets', key: null };
  return { label: String(template ?? 'missile'), key: null };
}

/**
 * A jet as the card reads it, from its model's node (`traverse` over nodes
 * with the glb's extras in `userData`): `{ name, hp, gun: { speed, rate,
 * rounds, seconds, life, blast }, missile: { label, key, speed, life, blast,
 * rack, racks }, law }`. `gun` is the cannon on the fire key, `missile` the
 * first rocket on the other; either is null on a plane without one.
 */
export function jetOf(node, name, law = null) {
  let hp = null, gun = null, missile = null;
  node?.traverse?.(n => {
    const d = n.userData ?? {};
    if (hp == null && d.armor?.hitpoints) hp = Number(d.armor.hitpoints);
    const fa = d.fireArms, pr = fa?.projectile;
    if (!pr) return;
    if (!gun && pr.kind === 'bullet' && fa.input === 'c_PIFire' && Number(fa.velocity) > 300) {
      const rate = Number(fa.roundOfFire) || null, rounds = Number(fa.magSize) || null;
      gun = { speed: Number(fa.velocity), rate, rounds, seconds: rate && rounds ? rounds / rate : null,
        life: Number(pr.timeToLive) || null, blast: Number(pr.damage?.radius) || 0 };
    }
    if (!missile && pr.kind === 'rocket') {
      missile = { ...missileKind(pr.template), speed: Number(fa.velocity) || null, life: Number(pr.timeToLive) || null,
        blast: Number(pr.damage?.radius) || 0, rack: Number(fa.magSize) || null, racks: Number(fa.numOfMag) || null };
    }
  });
  return { name, hp, gun, missile, law };
}

/** A full pull's rate at `speed` on a measured airframe (`law.pull`). */
const pullAt = (law, speed) => law?.pull?.find(p => p.speed === speed) ?? null;
/** The speed both jets are compared at in a turn: the middle of the measure's three. */
const TURN_AT = 100;

/**
 * The rules, in the order a pilot meets them. Each: `n`, `id`, `name`,
 * `plain` (ours), `quote` (a few of the source's own words, or null),
 * `source` `{ doc, date, url }`, `boelcke` (the rule of 1916 it carries on,
 * or null for a new one), `lesson` (`[lesson id, demo id]`, the school's
 * fight that shows it, or null), and `check(ctx)`, the verdict on the two
 * jets on stage: `{ status: 'holds' | 'differs' | 'partly' | 'not here',
 * words }`.
 */
export const RULES = [
  {
    n: 1, id: 'commit', name: 'Go in to win', boelcke: 2, lesson: ['boom-and-zoom', 'ninja'],
    plain: 'An attack flown half-heartedly is worse than none. Commit, close and finish.',
    quote: 'When in doubt - attack!',
    source: { doc: 'Blesse, No Guts, No Glory (USAF Fighter Weapons School), basic principles of offense, no. 22', date: '1955', url: 'https://web.archive.org/web/20060309151515/http://www.simhq.com/_air/PDF/NGNG.pdf' },
    check({ you }) {
      const g = you?.gun, m = you?.missile;
      if (!g?.seconds) return verdict('partly', 'This plane\'s cannon is not read, so what a pass can spend is not known here.');
      const load = m?.rack ? ` and ${m.rack * (m.racks ?? 1)} ${m.label}s` : '';
      return verdict('holds', `Your ${you.name} carries ${n0(g.rounds)} rounds, ${n1(g.seconds)} s of fire at ${n0(g.rate)} a second${load}: enough to finish every pass of a fight, and nothing is gained by saving it.`);
    },
  },
  {
    n: 2, id: 'energy', name: 'Speed is life', boelcke: 1, lesson: ['up-and-over', 'counter'],
    plain: 'Height and speed are one account. Do not spend it without buying position.',
    quote: 'trade altitude for airspeed',
    source: { doc: 'Boyd, Aerial Attack Study (USAF, report 50-10-6C), part II', date: 'revised 1964', url: 'https://everyspec.com/USAF/USAF-General/Aerial_Attack_Study_50-10-6C_1964_Boyd_56437/' },
    check({ you }) {
      const up = you?.law?.up;
      if (!up) return verdict('partly', 'The wings stop lifting at 1,000 m in this engine, so there is little height to bank. What this airframe does going up is not measured here.');
      if (up.stalls) return verdict('holds', `Standing on its tail from level speed your ${you.name} is out of speed in ${n1(up.at)} s, ${n0(up.gained)} m up: height is bought with speed, as Boyd has it.`);
      return verdict('differs', `Height is nearly free here. Standing on its tail from level speed your ${you.name} still makes ${n0(up.speed)} m/s after 10 s and is ${n0(up.gained)} m higher; a propeller fighter on the same law is out of speed in about ten. `
        + 'And the wings stop lifting at 1,000 m, so there is no height to bank above that. What is left of the rule is speed for the turn (rule 4).');
    },
  },
  {
    n: 3, id: 'sight', name: 'Lose sight, lose the fight', boelcke: 4, lesson: ['falling-leaf', 'counter'],
    plain: 'Keep your eyes on them through every turn. The one you do not see kills you.',
    quote: 'Keep it up, keep sight and never give up!',
    source: { doc: 'USAF, AFTTP 3-3 Volume 5, Combat Aircraft Fundamentals: F-16, para 4.3.10.5.7.4', date: 'April 1999', url: 'https://archive.org/details/vol-05_202208' },
    check({ you, them }) {
      const a = you?.law?.level, b = them?.law?.level;
      const close = a && b ? ` Head on at your level speeds you close at ${n0(a + b)} m/s: a jet 1,000 m off is on you in ${n1(1000 / (a + b))} s.` : '';
      return verdict('holds', `No enemy plane is ever on the minimap here, and a name shows only while you aim at it. There is no radar and no warning: eyes are all there is.${close}`);
    },
  },
  {
    n: 4, id: 'corner', name: 'Know your best turning speed', boelcke: null, lesson: ['the-circle', 'circle'],
    plain: 'A real jet has one speed band where it turns tightest and fastest. Above it the turn is wide; below it the jet cannot pull.',
    quote: 'the F-16 does not have a true corner velocity',
    source: { doc: 'USAF, AFTTP 3-3 Volume 5, para 4.3.4 (its fly-by-wire F-16 has a "corner plateau", 330 to 440 knots)', date: 'April 1999', url: 'https://archive.org/details/vol-05_202208' },
    check({ you }) {
      const p = you?.law?.pull;
      if (!p?.length) return verdict('partly', 'This engine has no g limit and no blackout, so nothing sets a corner speed. What a full pull does on this airframe is not measured here.');
      const rising = p.every((x, i) => i === 0 || x.rate > p[i - 1].rate);
      const say = p.map(x => `${n0(x.rate)} deg/s at ${x.speed} m/s`).join(', ');
      const radii = p.map(x => x.radius).filter(Boolean);
      const circle = radii.length ? ` The circle it flies stays ${Math.min(...radii)} to ${Math.max(...radii)} m in radius whatever the speed.` : '';
      if (rising) return verdict('differs', `No corner speed here: there is no g limit and no blackout. A full pull brings your ${you.name}'s nose round ${say}. The faster you fly, the faster you turn; slowing down to turn tighter buys nothing.${circle}`);
      return verdict('partly', `There is no g limit and no blackout here. A full pull brings your ${you.name}'s nose round ${say}.${circle}`);
    },
  },
  {
    n: 5, id: 'circles', name: 'One circle or two', boelcke: null, lesson: ['scissors', 'move'],
    plain: 'At a head-on pass choose the turn your jet wins: the same way as them (two circles) if you turn faster, across them (one circle) if you turn tighter.',
    quote: null,
    source: { doc: 'Shaw, Fighter Combat: Tactics and Maneuvering, chapter 2 (nose-to-nose and nose-to-tail turns); AFTTP 3-3 Volume 5, para 4.3.11.1.7', date: '1985', url: 'https://archive.org/details/fighter-combat-tactics-and-maneuvering-pdfdrive' },
    check({ you, them }) {
      const a = pullAt(you?.law, TURN_AT), b = pullAt(them?.law, TURN_AT);
      if (!a || !b || !a.radius || !b.radius) return verdict('partly', 'Both turns are open here; which is yours against this plane is not measured.');
      const mine = `your ${you.name} pulls ${n0(a.rate)} deg/s on a ${a.radius} m circle`, theirs = `their ${them.name} ${n0(b.rate)} on ${b.radius} m`;
      const rate = a.rate > b.rate * 1.05 ? 1 : b.rate > a.rate * 1.05 ? -1 : 0;
      // At one speed the faster rate is the smaller circle; the faster jet
      // carries more speed into a two-circle fight, and rate rises with it.
      const quick = (you.law.level ?? 0) > (them.law.level ?? 0) * 1.05 ? 1 : (them.law.level ?? 0) > (you.law.level ?? 0) * 1.05 ? -1 : 0;
      const word = rate > 0 && quick >= 0 ? 'Either turn is yours.'
        : rate > 0 ? 'Turn across them (one circle), where the tighter circle wins; in two circles their speed buys them rate.'
        : rate < 0 && quick > 0 ? 'Turn the same way as them (two circles) and keep your speed up: rate rises with it. Across them, their tighter circle wins.'
        : rate < 0 ? 'Neither turn is yours: do not turn with them (rule 11).' : 'Nothing to choose between you in the turn: the pass decides nothing.';
      return verdict(rate === 0 ? 'partly' : 'holds', `At ${TURN_AT} m/s ${mine}, ${theirs}. ${word}`);
    },
  },
  {
    n: 6, id: 'pursuit', name: 'Lead to shoot, lag to stay', boelcke: 5, lesson: ['on-his-tail', 'move'],
    plain: 'Nose ahead of them closes and sets up the gun; nose behind them holds your place on their tail. Arrive in the cone behind them that the weapon needs.',
    quote: 'an angular velocity cone or a cone of maximum performance',
    source: { doc: 'Boyd, Aerial Attack Study, part II, the mechanics of the pursuit curve', date: 'revised 1964', url: 'https://everyspec.com/USAF/USAF-General/Aerial_Attack_Study_50-10-6C_1964_Boyd_56437/' },
    check({ you, them }) {
      const g = you?.gun, v = them?.law?.level ?? TURN_AT;
      if (!g?.speed) return verdict('partly', 'Nothing here fires over the shoulder, so the shot is from astern with the lead on. This plane\'s cannon is not read.');
      const R = 300, t = R / g.speed;
      return verdict('holds', `In full, and more than in 1991: nothing here fires over the shoulder or head on with a seeker, so every shot is from the cone behind them, with the lead on. At ${R} m your round takes ${n1(t)} s, in which a jet crossing at ${n0(v)} m/s moves ${n0(v * t)} m: nose ahead to shoot, nose behind to stay.`);
    },
  },
  {
    n: 7, id: 'yo-yo', name: 'Do not overshoot: go up', boelcke: null, lesson: null,
    plain: 'If you cannot stay inside their turn, roll away and pull up, then come back down behind them (the high yo-yo). If you cannot close, dive inside the turn first (the low yo-yo).',
    quote: 'zoom or yo-yo off the target to prevent overshoot',
    source: { doc: 'Boyd, Aerial Attack Study, part II, the high-speed yo-yo', date: 'revised 1964', url: 'https://everyspec.com/USAF/USAF-General/Aerial_Attack_Study_50-10-6C_1964_Boyd_56437/' },
    check({ you }) {
      const up = you?.law?.up;
      const free = up && !up.stalls ? ` Going up costs your ${you.name} little here (rule 2), so the high yo-yo is always open; the low one buys speed, and speed is turn rate (rule 4).` : '';
      return verdict('not here', `Neither yo-yo is a lesson yet: the school's pilots do not fly them.${free}`);
    },
  },
  {
    n: 8, id: 'envelope', name: 'Shoot only a shot that counts', boelcke: 3, lesson: ['gunnery', null],
    plain: 'Get inside the weapon\'s envelope, then fire. For the gun that still means close.',
    quote: 'Maneuver the aircraft into weapons parameters to employ ordnance.',
    source: { doc: 'USAF, AFTTP 3-3 Volume 5, para 4.3.1.2.1', date: 'April 1999', url: 'https://archive.org/details/vol-05_202208' },
    check({ you, them }) {
      const m = you?.missile, g = you?.gun;
      const cannon = g?.speed ? ` Your cannon's round flies ${n0(g.speed)} m/s${g.blast ? ` and bursts ${n1(g.blast)} m wide, so a near miss still hurts` : ''}.` : '';
      const curve = m?.key ? LAB_FLIGHT[m.key] : null;
      if (!m) return verdict('partly', `Your ${you?.name} carries no air-to-air missile here: the envelope is the gun's.${cannon}`);
      if (!curve) return verdict('differs', `Your ${m.label} has no seeker here: it flies where the nose pointed. It leaves at ${n0(m.speed ?? 0)} m/s; how drag slows it was not flown on the lab server.${cannon}`);
      const run = them?.law?.level ?? TURN_AT;
      // Where the missile is no faster than the jet it chases.
      let even = null;
      for (let t = 0.1; t <= curve[curve.length - 1][0]; t += 0.1) if (speedAt(curve, t) <= run) { even = t; break; }
      const fuse = FUSE[m.key] ? ` and bursts within ${FUSE[m.key]} m of an aircraft` : '';
      return verdict('differs', `Your ${m.label} has no seeker here: it flies straight${fuse}. It leaves at ${n0(curve[0][1])} m/s and drag has it down to ${n0(speedAt(curve, 1))} after one second and ${n0(speedAt(curve, 2))} after two: `
        + `${n0(flown(curve, 1))} m in the first second, ${n0(flown(curve, 2))} in two (the real game's own flights, from the lab server).`
        + `${even != null ? ` After ${n1(even)} s it is slower than their ${them.name} flying level: from behind, past about ${n0(Math.round(flown(curve, even) / 50) * 50)} m it never arrives.` : ''}`
        + ` It is a second cannon with a wide burst: fire it close, with the lead on.${cannon}`);
    },
  },
  {
    n: 9, id: 'defend', name: 'Attacked: turn into it', boelcke: 6, lesson: ['break-turn', 'counter'],
    plain: 'Turn toward the attacker to spoil the shot and force an overshoot: hard, but not flat out. Under the gun, jink out of their plane.',
    quote: 'turn into the plane of the attack',
    source: { doc: 'Boyd, Aerial Attack Study, part II, the defensive turn; the jink is AFTTP 3-3 Volume 5, para 4.3.10.5', date: 'revised 1964', url: 'https://everyspec.com/USAF/USAF-General/Aerial_Attack_Study_50-10-6C_1964_Boyd_56437/' },
    check({ you, them }) {
      const a = pullAt(you?.law, TURN_AT);
      const turn = a ? ` Your ${you.name} comes round ${n0(a.rate)} deg/s at ${TURN_AT} m/s.` : '';
      const m = them?.missile;
      const missile = m ? ` Their ${m.label} needs no defence of its own: it has no seeker to break${FUSE[m.key] ? `, only a ${FUSE[m.key]} m burst to stay out of` : ''}. The turn that beats the gun beats it.` : '';
      return verdict('holds', `Every weapon here needs lead, and a turn into them takes it away.${turn}${missile}`);
    },
  },
  {
    n: 10, id: 'pair', name: 'Fight as a pair: one engaged, one free', boelcke: 8, lesson: ['the-pair', 'counter'],
    plain: 'One of you presses the bandit. The other stays out of the turn, watches both tails, and takes the shot when it opens.',
    quote: 'there can only be ONE actively engaged fighter at a time',
    source: { doc: 'USAF, AFTTP 3-3 Volume 5, para 4.4.5', date: 'April 1999', url: 'https://archive.org/details/vol-05_202208' },
    check({ you }) {
      const m = you?.missile;
      const fuse = m && FUSE[m.key] ? ` One reason is this engine's own: the ${m.label}'s fuse tests no side, so a friend crossing its path sets it off. The free fighter stays out of the engaged one's line of fire.` : '';
      return verdict('holds', `The school flies the pair on any airframe: a wingman on your beam keeps a hunter off your tail.${fuse}`);
    },
  },
  {
    n: 11, id: 'plan', name: 'Fly your jet\'s fight, not theirs', boelcke: 1, lesson: ['boom-and-zoom', 'counter'],
    plain: 'A jet with thrust fights for energy and uses the vertical; a jet that turns fights for angles. Decide before the merge.',
    quote: 'Know the performance data on all aircraft you are apt to be fighting.',
    source: { doc: 'Blesse, No Guts, No Glory, basic principles of offense, no. 14; the angles fight and the energy fight are Shaw, Fighter Combat (1985), chapters 3 and 4', date: '1955', url: 'https://web.archive.org/web/20060309151515/http://www.simhq.com/_air/PDF/NGNG.pdf' },
    check({ you, them }) {
      const a = you?.law, b = them?.law, pa = pullAt(a, TURN_AT), pb = pullAt(b, TURN_AT);
      if (!a || !b || !pa || !pb) return verdict('partly', 'Which fight is yours against this plane is not measured here.');
      const fast = a.level > b.level * 1.05 ? 1 : b.level > a.level * 1.05 ? -1 : 0;
      const turn = pa.rate > pb.rate * 1.05 ? 1 : pb.rate > pa.rate * 1.05 ? -1 : 0;
      const facts = `Level at 300 m your ${you.name} makes ${n0(a.level)} m/s and their ${them.name} ${n0(b.level)}; at ${TURN_AT} m/s you pull ${n0(pa.rate)} deg/s and they pull ${n0(pb.rate)}.`;
      const plan = fast > 0 && turn > 0 ? 'Both are yours: any fight you choose.'
        : fast > 0 ? 'You are the faster jet and the worse turner: pass, extend, come back. Never turn with them.'
        : turn > 0 ? 'You out-turn them and cannot outrun them: fight for angles and stay in the turn. Running hands them your tail.'
        : fast < 0 && turn < 0 ? 'They have you in both: do not stay alone with them. This is the fight for a pair (rule 10).'
        : fast < 0 ? 'They are faster and you turn no better: you cannot leave, so meet every pass head on.'
        : turn < 0 ? 'They out-turn you and you are no faster: do not turn with them.' : 'Nothing to choose between the two jets: the pilot decides it.';
      return verdict(fast === 0 && turn === 0 ? 'partly' : 'holds', `${facts} ${plan}`);
    },
  },
  {
    n: 12, id: 'leave', name: 'Leave on your own terms', boelcke: 7, lesson: ['out-of-the-lock', 'dip'],
    plain: 'Fuel, ammunition and the next bandit decide when the fight is over. If it is a stalemate, go.',
    quote: 'continue to fight or break off the engagement',
    source: { doc: 'Boyd, Aerial Attack Study, part II, flight tactics', date: 'revised 1964', url: 'https://everyspec.com/USAF/USAF-General/Aerial_Attack_Study_50-10-6C_1964_Boyd_56437/' },
    check({ you, them }) {
      const a = you?.law?.level, b = them?.law?.level, g = you?.gun;
      const ammo = g?.seconds ? ` What runs out is the cannon: ${n1(g.seconds)} s of fire, and no second magazine in the air.` : '';
      if (!a || !b) return verdict('partly', `There is no fuel to run out here.${ammo}`);
      const d = a - b;
      const run = d > a * 0.05 ? `Level, you are ${n0(d)} m/s the faster: you can leave when you choose, and they cannot.`
        : d < -a * 0.05 ? `Level, they are ${n0(-d)} m/s the faster: you cannot leave them behind. Go only when they are pointing the other way.`
        : 'Level, neither of you outruns the other: leave only when they are pointing the other way.';
      return verdict('partly', `There is no fuel to run out here, so that clock is gone.${ammo} ${run}`);
    },
  },
];

/** Every rule's verdict on the two jets: `[{ ...rule, verdict }]`. */
export function rulesOn(ctx) {
  return RULES.map(r => {
    let v;
    try { v = r.check(ctx); } catch { v = null; }
    return { ...r, verdict: v ?? verdict('not here', 'Not measured for these planes.') };
  });
}

/** The fight the card opens with: Rodriguez's F-15C against a MiG-29 on
 *  19 January 1991, the one turning fight of the Gulf War, the pairing and
 *  the lesson it opens, and what the engine makes of it (`words(ctx)`).
 *  The account is the National Air and Space Museum's; where sources
 *  differ (the height the MiG rolled at) the research says. */
export const FIGHT = {
  yours: 'F-15C', theirs: 'Mig29', lesson: ['the-circle', 'circle'],
  eyebrow: 'The one turning fight of the Gulf War',
  title: 'Rodriguez and the MiG-29, 19 January 1991',
  go: 'Fly it: F-15C against MiG-29',
  story: [
    'Captain Cesar Rodriguez and Captain Craig Underhill, in two F-15Cs of the 58th Tactical Fighter Squadron, met two MiG-29s head on. Underhill\'s radar missile took the first.',
    'The second could not be told friend from foe, so Rodriguez closed to see it. The two merged and both turned left, into a descending spiral from about 8,000 ft.',
    'His Sidewinder would not lock against the hot desert. He closed to about 1,500 ft, inside gun range, and still had no firing position.',
    'Near the ground the MiG rolled on its back and pulled through, and flew into the desert. No weapon had been fired at it.',
  ],
  sources: [
    { doc: 'Hankins, "That Little Extra Spark": Cesar Rodriguez and the F-15 Eagle (National Air and Space Museum, 2025)', url: 'https://airandspace.si.edu/stories/editorial/cesar-rico-rodriguez-and-f-15-eagle' },
    { doc: 'Lee, Coalition Air-to-Air Victories in Desert Storm', url: 'https://rjlee.org/air/ds-aakill/By%20Engagement/' },
  ],
  /** The fight on this engine, for the F-15C (`you`) against the MiG-29. */
  words({ you, them }) {
    const out = [];
    const a = you?.law, b = them?.law, pa = pullAt(a, TURN_AT), pb = pullAt(b, TURN_AT);
    if (a && b && pa && pb) {
      const better = b.level > a.level && pb.rate > pa.rate;
      out.push(`Here the F-15C makes ${n0(a.level)} m/s level and pulls ${n0(pa.rate)} deg/s at ${TURN_AT} m/s; the MiG-29 ${n0(b.level)} and ${n0(pb.rate)}${better ? ': on this flight law the MiG is the better jet in both, which is not how the day went' : ''}.`);
      if (pb.radius) out.push(`The MiG's last move, a half loop downward, needs about ${n0(2 * pb.radius)} m of height at ${TURN_AT} m/s here. Rodriguez's fight began at 2,400 m; this engine's wings stop lifting at 1,000 m, so the whole fight is flown where his ended.`);
    }
    if (you?.missile?.key) out.push(`The missile that would not lock has no seeker to lock here: it is fired like the gun (rule 8).`);
    return out;
  },
};

/** The card's own words in the school's list. */
export const CARD = {
  rail: 'The jet age\'s rules: Blesse, Boyd and the F-16 manual, on Desert Combat\'s jets',
  head: 'THE JET AGE\'S RULES · 1955-99',
  sub: 'What Blesse, Boyd and the USAF\'s F-16 manual told fighter pilots, and what Desert Combat\'s own data says of each rule on the two jets on stage. Flight numbers are this page\'s flight law, measured on those two.',
};
