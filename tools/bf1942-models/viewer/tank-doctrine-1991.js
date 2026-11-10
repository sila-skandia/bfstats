// What the US Army's manuals of the 1980s told tank crews, what the Soviet
// manuals behind the Iraqi defence told theirs, what the reports written
// after the Gulf War found, and what Desert Combat's own data says of each
// rule: the tank school's RULES card on a Desert Combat arena
// (features/tank-doctrine-1991). BF1918's card is `tank-doctrine-1918.js`;
// the two give the page the same exports (`CARD`, `RULES`, `rulesOn`, `FIGHT`).
//
// The rules are FM 71-1 (1988), FM 17-15, the Army Research Institute's two
// reports written from the Abrams gunnery manual FM 17-12-1 (1984, 1989),
// FM 100-2-1 (1984) for the Soviet-pattern defence, TRADOC Bulletin 3 (1976)
// on the RPG-7, and the fight the card opens with, the 2nd Armored Cavalry
// at the 73 Easting on 26 February 1991. Each says in our words what it
// asked, quotes a few words of it, and is checked against the pairing on the
// page. Every quote was checked against the scan's text.
//
// Pure: a pairing's numbers in, a verdict per rule out. The context is the
// 1918 card's (`you`, `them`, `mg`, `fieldGuns`, `foot`) and, for this war:
//
//   ownMg: { label, shots } | null       your hull's automatic gun on THEIR hull
//   air: [{ vehicle, label, weapon, kind, gun: { speed }, ttl, rof, shots }]
//                                        their aircraft's weapons on your hull
//   carriers: [the same]                 their missile carriers that are no tank
//
// and a tank's `gun` also says what it fires: `round` (the projectile's
// template), `ttl` (the seconds it lives), `mag` and `magReload`.

import { timeTo, dropAt } from './tank-ballistics.js';
import { prettyTank } from './tank-arena.js';
import { haltMeasure, n1 } from './tank-doctrine-1918.js';

const s = v => (v === 1 ? '' : 's');
const shotsAt = (t, b) => t?.shots?.[b]?.shots ?? null;
const best = shots => Math.min(...Object.values(shots ?? {}).map(v => v?.shots ?? Infinity));
const fewest = t => { const v = best(t?.shots); return Number.isFinite(v) ? v : null; };
const verdict = (status, words) => ({ status, words });
/** Metres, with the thousands marked. */
const m0 = v => Math.round(v).toLocaleString('en-US');
/** A weapon on its vehicle: "AH-64's Hellfire", but "Humvee TOW". */
const own = (label, weapon) => (String(label).toLowerCase().includes(String(weapon).toLowerCase()) ? label : `${label}'s ${weapon}`);
/** An anti-aircraft hull, by its name or its round. */
const isAA = t => /shilka|m163|zsu|vulcan/i.test(`${t?.name} ${t?.gun?.round}`);
/** Past this many hits a weapon is no answer (`tank-words.js` `NO_ANSWER`). */
const NO_ANSWER = 30;
/** Miles an hour to metres a second: Eagle 66 fired at 20 mph. */
const mph = v => v * 0.44704;

/** The distances the rules are read at: a gun duel as the school draws it,
 *  the RPG's 300 m (TRADOC Bulletin 3), and a missile shot. */
export const RANGE = { duel: 200, rpg: 300, missile: 500 };

/** A weapon as its crew says it, from its FireArms node and its round. */
export function weaponWords(node, template = '') {
  const t = `${node} ${template}`.trim();
  const table = [
    [/hellfire/i, 'Hellfire'], [/at-?2/i, 'AT-2'], [/maverick/i, 'Maverick'], [/tow/i, 'TOW'],
    [/spandrel|span_|at-?5|at4_proj/i, 'AT-5'], [/sagger|at-?3/i, 'AT-3'],
    [/hydra|s5arms|ffar/i, 'rockets'], [/snakeye|mk8\d|bomb|as-7|cbu/i, 'bombs'],
    [/avenger|a10guns|su-25guns|av8gun/i, '30 mm gun'], [/m230|chaingun/i, 'chain gun'],
    [/sabot/i, 'sabot'], [/howitzer/i, 'howitzer'], [/guns?$|cannon|gatling|vulcan|minigun/i, 'cannon'],
    [/projectile$|shell$/i, 'shell'],
  ];
  return table.find(([re]) => re.test(t))?.[1] ?? String(node).replace(/_/g, ' ');
}

/** A vehicle as its crew says it: `AH64` "AH-64", `Mi24D` "Mi-24". */
export function vehicleWords(template) {
  const t = String(template ?? '');
  let m;
  if ((m = /^(ah|mh|oh|uh|ch|ac|b)-?(\d+)/i.exec(t))) return `${m[1].toUpperCase()}-${m[2]}`;
  if ((m = /^mi-?(\d+)/i.exec(t))) return `Mi-${m[1]}`;
  if ((m = /^mig-?(\d+)/i.exec(t))) return `MiG-${m[1]}`;
  if ((m = /^su-?(\d+)/i.exec(t))) return `Su-${m[1]}`;
  if ((m = /^sa-?(\d+)/i.exec(t))) return `SA-${m[1]}`;
  if (/^a-?10/i.test(t)) return 'A-10';
  if ((m = /^av-?8/i.exec(t))) return 'AV-8';
  if ((m = /^f-?(\d\d)([a-e])?$/i.exec(t))) return `F-${m[1]}${(m[2] ?? '').toUpperCase()}`;
  if (/^humvee_tow$/i.test(t)) return 'Humvee TOW';
  return prettyTank(t);
}

/** Whether a hull's "main gun" is a missile: it flies flat and slowly
 *  (Desert Combat's TOW and AT-5 leave at 100 m/s with no gravity). */
export const isMissile = gun => !!gun && !(gun.gravity > 0) && gun.speed > 0 && gun.speed <= 220;

/** How far a round flies before it dies: its speed for its life. */
export const lifeReach = gun => (gun?.speed > 0 && gun?.ttl > 0 ? gun.speed * gun.ttl : null);

/** Everything of theirs that hurts your hull, the quickest first: `[{ label,
 *  hits }]`. Their hull's gun, their missile carriers, their aircraft and
 *  their soldiers' launchers, each at the fewest hits it needs. */
export function threats({ you, them, mg, air, carriers, foot }) {
  const out = [];
  const add = (label, shots) => { const k = best(shots); if (Number.isFinite(k)) out.push({ label, hits: k }); };
  add(`their ${them?.name}'s ${isMissile(them?.gun) ? weaponWords(them.gun.round ?? 'missile') : 'gun'}`, you?.shots);
  for (const w of carriers ?? []) add(`their ${own(w.label, w.weapon)}`, w.shots);
  for (const w of air ?? []) add(`their ${own(w.label, w.weapon)}`, w.shots);
  for (const w of foot ?? []) add(`their ${w.label}`, w.shots);
  if (mg) add(`their ${mg.label.replace(/^their /i, '')}`, mg.shots);
  // One row a weapon as a crew knows it: the A-10 and its B and C carry one gun.
  const seen = new Set();
  return out.filter(x => !seen.has(x.label) && seen.add(x.label)).sort((a, b) => a.hits - b.hits);
}

/**
 * The rules, in the order a crew would read them. Each: `n`, `id`, `side`
 * (`crew` for the tank's own crew, `against` for those fighting it), `name`,
 * `rule` (ours), `quote` (a few of the source's own words), `source`
 * `{ doc, date, where, url }`, `card` (the school's card that shows it), and
 * `check(ctx)`, the verdict on the pairing: `{ status: 'holds' | 'differs'
 * | 'partly' | 'not here', words }`.
 */
export const RULES = [
  {
    n: 1, id: 'see-first', side: 'crew', name: 'See first, shoot first', card: '02',
    rule: 'Search with the thermal sight all the time, by day too: it sees through dust and dark, and the crew that sees first fires first.',
    quote: 'Using thermal sights during the day as well as night',
    source: { doc: 'FM 71-1, Tank and Mechanized Infantry Company Team', date: 'November 1988', where: 'chapter 1, p. 1-5', url: 'https://archive.org/details/fm-71-1-1988' },
    check({ you, them }) {
      const k = fewest(them), j = fewest(you);
      const need = (t, n) => (n > NO_ANSWER ? 'has no answer to the other hull' : `needs ${n} hit${s(n)}${n > 1 ? ` and ${n1((n - 1) * t.gun.reload)} s of loading after the first` : ''}`);
      const even = k != null && j != null
        ? ` So it comes down to who lays the gun first: your ${you.name} ${need(you, k)}, their ${them.name} ${need(them, j)}.` : '';
      return verdict('differs', `The game has no thermal sight: both crews see the same distance, as far as the level's fog lets them, and a name shows only under the crosshair.${even}`
        + ' The Institute for Defense Analyses refought 73 Easting with equal sights: it went two to one against the M1A1s.');
    },
  },
  {
    n: 2, id: 'most-dangerous', side: 'crew', name: 'Kill the most dangerous first', card: '05',
    rule: 'Of everything in view, shoot first the one that can kill you and is about to; among equals, the nearer.',
    quote: 'CAN KILL YOU, HAS SEEN YOU, and IS PREPARING TO ENGAGE YOU',
    source: { doc: 'Army Research Institute, Fire Commands for the M1 Tank (Research Product 84-11)', date: 'May 1984', where: 'p. 14, the most dangerous threat', url: 'https://archive.org/details/DTIC_ADA156801' },
    check(ctx) {
      const list = threats(ctx);
      if (!list.length) return verdict('not here', 'Nothing of theirs on these battles is priced against your hull yet.');
      const real = list.filter(x => x.hits <= NO_ANSWER), idle = list.filter(x => x.hits > NO_ANSWER);
      const say = real.slice(0, 6).map(x => `${x.label} ${x.hits}`).join(', ');
      const last = idle.length ? ` Leave ${idle[0].label} for last: it needs ${idle[0].hits > 999 ? 'thousands of' : idle[0].hits} hits.` : '';
      if (!real.length) return verdict('partly', `Nothing of theirs here kills your ${ctx.you.name} inside ${NO_ANSWER} hits.${last}`);
      return verdict(real.length > 1 ? 'holds' : 'partly', `What kills your ${ctx.you.name} on these battles, by the hits it needs: ${say}.${last}`);
    },
  },
  {
    n: 3, id: 'sabot-or-heat', side: 'crew', name: 'Sabot for tanks, HEAT for the rest', card: '02',
    rule: 'The dart is for tanks; HEAT is for light armour, bunkers and trucks. If the wrong round is loaded, fire it and load the right one next.',
    quote: 'tanks with SABOT, PCs with HEAT, troops with coax',
    source: { doc: 'Army Research Institute, M1 Tank Gunnery (Research Report 1532), written from FM 17-12-1', date: 'June 1989', where: 'pp. 38 and 54', url: 'https://archive.org/details/DTIC_ADA217416' },
    check({ you, them, ownMg }) {
      const k = fewest(them);
      if (isMissile(you?.gun)) {
        const m = ownMg ? best(ownMg.shots) : null;
        const cannon = Number.isFinite(m) ? ` and its automatic gun for the rest (${m > NO_ANSWER ? `no answer to a tank: ${m} hits` : `${m} hits on their ${them.name}`})` : '';
        return verdict('holds', `Your ${you.name} does carry two answers: the ${weaponWords(you.gun.round ?? 'missile')} for armour${k != null ? ` (${k} hit${s(k)} on their ${them.name})` : ''}${cannon}.`);
      }
      const blast = r => (r > 0 ? `, which bursts ${n1(r)} m wide` : '');
      const mine = weaponWords(you?.gun?.round ?? 'shell'), theirs = weaponWords(them?.gun?.round ?? 'shell');
      const other = isMissile(them?.gun) ? '' : ` Their ${them.name} fires one too${theirs !== mine ? `, a ${theirs}` : ''}${blast(them?.shellDamage?.radius)}.`;
      return verdict('differs', `In this game a tank carries one round. Your ${you.name} fires ${/sabot/i.test(mine) ? 'a sabot' : 'one shell'}${blast(you?.shellDamage?.radius)}, at a tank, a carrier and a truck alike`
        + `${k != null ? `: ${k} hit${s(k)} on their ${them.name}` : ''}.${other} There is no HEAT to change to, and no wrong round to fire off first.`);
    },
  },
  {
    n: 4, id: 'battlesight', side: 'crew', name: 'Lase if you can, battlesight if you cannot', card: '02',
    rule: 'With time, take the range by laser and let the computer lay the gun. With none, fire on the range already set: the dart flies so flat that one setting covers every likely range.',
    quote: 'the most common battlesight ammunition and range setting is SABOT at 1200 meters',
    source: { doc: 'Army Research Institute, M1 Tank Gunnery (Research Report 1532)', date: 'June 1989', where: 'p. 53', url: 'https://archive.org/details/DTIC_ADA217416' },
    check({ you }) {
      const g = you?.gun;
      if (!g?.speed) return verdict('not here', 'This hull\'s gun is not read.');
      const far = lifeReach(g);
      const life = far != null ? ` It is gone after ${n1(g.ttl)} s, ${m0(far)} m at most${far < 1200 ? ': 1,200 m is out of its reach' : ''}.` : '';
      if (!(g.gravity > 0)) return verdict('partly', `Your ${weaponWords(g.round ?? 'missile')} flies flat at ${Math.round(g.speed)} m/s: there is no drop to judge, only the ${n1(timeTo(g, RANGE.missile))} s it takes to cross ${RANGE.missile} m.${life}`);
      const at = R => `${n1(dropAt(g, R))} m at ${R} m`;
      return verdict('differs', `The real dart left at about 1,600 m/s and rose under a metre on its way to 1,200 m. Yours leaves at ${Math.round(g.speed)} m/s: it takes ${n1(timeTo(g, RANGE.duel))} s to cross ${RANGE.duel} m and has dropped ${at(RANGE.duel)}, ${at(600)}.`
        + ` No one setting covers that: every shot is a range guess, as it was in 1943.${life}`);
    },
  },
  {
    n: 5, id: 'fire-on-the-move', side: 'crew', name: 'Shoot on the move', card: '03',
    rule: 'Do not stop to fire: the gun is stabilised, a moving tank is hard to hit, and return fire lands where you were.',
    quote: 'will normally continue to move during an engagement',
    source: { doc: 'Army Research Institute, M1 Tank Gunnery (Research Report 1532)', date: 'June 1989', where: 'p. 57; the 1943 manual (FM 17-12, para 47c) had said it is "always necessary to stop before firing"', url: 'https://archive.org/details/DTIC_ADA217416' },
    check({ you }) {
      const h = haltMeasure(you);
      if (h.drift == null) return verdict('partly', `Nothing stabilises a gun in this engine; how fast your hull moves is not measured here.`);
      const eagle = mph(20) * h.t;
      const steady = h.still != null ? ` Stopped hard, your hull swings ${n1(h.peak)} deg and is still in ${n1(h.still)} s.` : '';
      return verdict('differs', `The game sides with the 1943 manual, not the 1991 one: nothing stabilises the gun, and your hull's speed rides on the shell. Fired crossing at ${n1(h.top)} m/s it lands ${Math.round(h.drift)} m off at ${h.R} m`
        + `${you.lengthM ? `, ${n1(h.drift / you.lengthM)} tank lengths` : ''}; at Eagle 66's 20 mph, ${Math.round(eagle)} m.${steady} Lead the shot by your own speed, or stop.`);
    },
  },
  {
    n: 6, id: 'hull-down', side: 'crew', name: 'Hull-down to shoot; a berm is not armour', card: '01',
    rule: 'Wait where only the sights show, roll up until the gun clears the ground, fire and roll back. Use a fold or a hole: earth piled in front marks the tank and stops no dart.',
    quote: 'Berms attract attention. Dig down, not up.',
    source: { doc: 'FM 17-15, Tank Platoon', date: 'the edition of 1996 (the 1987 one in force in 1991 is not online)', where: 'figure 4-5', url: 'https://archive.org/details/FM_17_15_T_P_1991' },
    check() {
      return verdict('partly', 'Half of it holds. Shells stop on the ground in this engine, so a hull behind a fold is safe and hull-down is real. But a dart stops there too: a sand berm here is armour, which in 1991 it was not. '
        + 'Eagle 66\'s second round went through one and the T-72 behind it. The school draws no ground yet.');
    },
  },
  {
    n: 7, id: 'wingman', side: 'crew', name: 'Never alone: the wingman', card: '01',
    rule: 'A tank fights as one of a pair. One group moves while another sits and covers it, and the platoon shares the targets out.',
    quote: 'wingmen move, stop, and shoot when their leaders do',
    source: { doc: 'FM 17-15, Tank Platoon', date: 'the edition of 1996', where: 'chapter 1; bounding overwatch in chapter 3', url: 'https://archive.org/details/FM_17_15_T_P_1991' },
    check({ you, them }) {
      const k = fewest(them), r = you?.gun?.reload;
      if (k == null || !r) return verdict('not here', 'The school fights one tank against one. Not in the school yet.');
      const alone = (k - 1) * r;
      if (k === 1) return verdict('partly', `Your gun needs one hit on their ${them.name}: a wingman adds a second pair of eyes, not a second round. The school fights one against one: not in it yet.`);
      if (k > NO_ANSWER) return verdict('partly', `Your gun is no answer to their ${them.name} alone or in a pair. The school fights one against one: not in it yet.`);
      return verdict('partly', `Arithmetic only: your gun alone needs ${k} hit${s(k)} on their ${them.name}, ${n1(alone)} s of loading between the first and the last; two of you firing, about ${n1(alone / 2)} s. The school fights one against one: not in it yet.`);
    },
  },
  {
    n: 8, id: 'front-and-flank', side: 'crew', name: 'Front to the enemy, shoot for the flank', card: '01',
    rule: 'Keep your thickest armour toward the gun that can hurt you, and place yourself to hit them in the side or rear.',
    quote: 'Flank shots increase kill probabilities against enemy armored vehicles',
    source: { doc: 'FM 71-1, Tank and Mechanized Infantry Company Team', date: 'November 1988', where: 'p. 4-19', url: 'https://archive.org/details/fm-71-1-1988' },
    check({ you, them }) {
      const mine = [0, 90, 180].map(b => shotsAt(you, b)), theirs = [0, 90, 180].map(b => shotsAt(them, b));
      if (!mine.some(v => v != null) && !theirs.some(v => v != null)) return verdict('not here', 'Neither gun hurts the other hull, so there is no side to choose.');
      const n = v => (v > NO_ANSWER ? `more than ${NO_ANSWER}` : v);
      const say = (t, f) => (f.every(v => v != null) ? `${t}: front ${n(f[0])}, side ${n(f[1])}, rear ${n(f[2])}` : null);
      // Alike: a face apart at most, or all of them past any answer.
      const alike = f => !f.every(v => v != null) || Math.max(...f) - Math.min(...f) < 1 || Math.min(...f) > NO_ANSWER;
      const words = [say(`Your ${you.name} takes their hits`, mine), say(`their ${them.name} takes yours`, theirs)].filter(Boolean).join('; ');
      const spot = t => Math.min(...[30, 60, 90, 120, 150].map(b => t?.shots?.[b]?.bestShots ?? Infinity));
      const weak = [[you, 'yours'], [them, 'theirs']].filter(([t]) => { const f = shotsAt(t, 90); return f != null && spot(t) < f; })
        .map(([t, whose]) => `${whose} has a place on the side that takes ${spot(t)}`);
      const aim = weak.length ? ` A gunner who picks the spot does better: ${weak.join(', and ')}.` : '';
      if (alike(mine) && alike(theirs)) {
        const abrams = [you, them].some(t => /m1a1/i.test(t?.name ?? '')) && [you, them].some(t => /t-?72/i.test(t?.name ?? ''));
        return verdict('differs', `Not in this game: ${words}. A front here is worth no more than a rear${abrams ? ', so a T-72 can win head on. In 1991 no Abrams was lost to an enemy gun' : ''}.${aim}`);
      }
      return verdict('holds', `${words}.${aim}`);
    },
  },
  {
    n: 9, id: 'reverse-slope', side: 'against', name: 'The reverse slope', card: '02',
    rule: 'A Soviet-trained defender digs in behind a crest, to shoot each tank as it comes over. Crest together, already looking, and fire first; or stay on the crest and shoot from beyond their reach.',
    quote: 'Attacking enemy forces will be silhouetted on the crest of the hill.',
    source: { doc: 'FM 100-2-1, The Soviet Army: Operations and Tactics', date: 'July 1984', where: 'pp. 6-3 and 6-4', url: 'https://archive.org/details/FM_100_2_1_T_S_A_O_T_1984' },
    check({ you, them }) {
      const a = lifeReach(you?.gun), b = lifeReach(them?.gun);
      const reach = a != null && b != null
        ? ` What it turns on is reach: your ${you.name}'s round lives ${n1(you.gun.ttl)} s, ${m0(a)} m at most, their ${them.name}'s ${n1(them.gun.ttl)} s, ${m0(b)} m.`
          + (b > a * 1.2 ? ' Here they outreach you.' : a > b * 1.2 ? ' Here you outreach them, as at Medina Ridge.' : '') : '';
      return verdict('not here', `The school fights on flat ground, with no crest to wait behind.${reach}`);
    },
  },
  {
    n: 10, id: 'missile', side: 'against', name: 'The missile outranges the gun but must sit still', card: '02',
    rule: 'A TOW reaches further than any tank gun, but its launcher must stand still and hold the sight on the target for the whole flight, about 20 seconds at full range. If one is coming at you, move.',
    quote: 'This is not a system that can "shoot and scoot."',
    source: { doc: 'FM 71-1, Tank and Mechanized Infantry Company Team', date: 'November 1988', where: 'p. 6-21: 3,750 m, about 18 seconds of flight', url: 'https://archive.org/details/fm-71-1-1988' },
    check({ you, them, carriers }) {
      const theirs = isMissile(them?.gun)
        ? { label: `${them.name}'s ${weaponWords(them.gun.round ?? 'missile')}`, gun: them.gun, ttl: them.gun.ttl, shots: you?.shots, mag: them.gun.mag, magReload: them.gun.magReload }
        : (carriers ?? []).filter(w => Number.isFinite(best(w.shots))).map(w => ({ label: own(w.label, w.weapon), gun: w.gun, ttl: w.ttl, shots: w.shots, mag: w.mag, magReload: w.reload }))
          .sort((a, b) => best(a.shots) - best(b.shots))[0];
      const mine = isMissile(you?.gun) ? { label: weaponWords(you.gun.round ?? 'missile'), gun: you.gun, ttl: you.gun.ttl, shots: them?.shots, mag: you.gun.mag, magReload: you.gun.magReload } : null;
      const m = theirs ?? mine;
      if (!m) return verdict('not here', 'Neither hull carries a missile, and no missile carrier of theirs is on these battles.');
      const k = best(m.shots), t = timeTo(m.gun, RANGE.missile), top = (theirs ? you : them)?.sheet?.drive?.top;
      const far = m.gun.speed > 0 && m.ttl > 0 ? m.gun.speed * m.ttl : null;
      const who = theirs ? `Their ${m.label}` : `Your ${m.label}`, target = theirs ? `your ${you.name}` : `their ${them.name}`;
      const dodge = top != null ? `, in which ${target} driving across at ${n1(top)} m/s is ${Math.round(top * t)} m on` : '';
      const load = m.mag && m.magReload > 1 ? ` ${m.mag} in the launcher, then ${n1(m.magReload)} s to load.` : '';
      return verdict('differs', `${who} needs ${Number.isFinite(k) ? `${k} hit${s(k)}` : 'more hits than it carries'} on ${target}.${load} Nothing guides it here: once fired it flies straight at ${Math.round(m.gun.speed)} m/s`
        + ` (on the lab server the game's own flights turned under 0.1 deg), so the launcher can drive off at once. It takes ${n1(t)} s to cross ${RANGE.missile} m${dodge}.`
        + `${far != null ? ` It lives ${n1(m.ttl)} s, ${m0(far)} m; the real TOW reached 3,750 m.` : ''}`);
    },
  },
  {
    n: 11, id: 'rpg', side: 'against', name: 'The RPG: inside 300 m, from the flank', card: '05',
    rule: 'With the launcher: hold fire to 300 m, shoot from the flank, expect to need a second round. In the tank: keep moving and show as little hull as you can.',
    quote: 'A second round will probably hit, even if the first one missed.',
    source: { doc: 'TRADOC Bulletin 3, Soviet RPG-7 Antitank Grenade Launcher', date: 'November 1976', where: 'pp. 14-17', url: 'https://archive.org/details/tradoc-bulletin-3-soviet-rpg-7-antitank-grenade-launcher-1976' },
    check({ you, foot }) {
      const w = (foot ?? []).filter(x => !x.charge && best(x.shots) <= NO_ANSWER).sort((a, b) => best(a.shots) - best(b.shots))[0];
      if (!w) return verdict('not here', 'Their soldiers carry no launcher that hurts your hull on these battles.');
      const f = [0, 90, 180].map(b => w.shots?.[b]?.shots ?? null);
      const flank = f.every(v => v != null) && f[0] > Math.min(f[1], f[2]);
      const top = you?.sheet?.drive?.top;
      const t = w.speed > 0 ? timeTo({ speed: w.speed, gravity: w.gravity ?? 1 }, RANGE.rpg) : null;
      const move = t != null && top != null ? ` It leaves at ${Math.round(w.speed)} m/s: ${n1(t)} s to ${RANGE.rpg} m, in which your ${you.name} driving across at ${n1(top)} m/s is ${Math.round(top * t)} m on${you.lengthM ? `, ${n1(top * t / you.lengthM)} lengths of your hull` : ''}. Keep moving.` : '';
      return verdict(flank ? 'holds' : 'partly', `Their ${w.label} needs ${f.every(v => v != null) ? `${f[0]} hit${s(f[0])} on your front, ${f[1]} on the side and ${f[2]} on the rear` : `${best(w.shots)} hits`}`
        + `${flank ? ': the flank is worth a round' : ''}.${move}`);
    },
  },
  {
    n: 12, id: 'air', side: 'against', name: 'Aircraft outrange armour; the ZSU is the answer', card: '05',
    rule: 'A helicopter fires from beyond any tank gun\'s reach. The gun that can reach it is the ZSU-23-4, good to 2,500 m, so the aircraft stand off and the tanks shoot the ZSU first.',
    quote: 'the crew is expected to shoot the ZSU-23/4',
    source: { doc: 'Army Research Institute, M1 Tank Gunnery (Research Report 1532)', date: 'June 1989', where: 'pp. 30-31; the ZSU\'s 2,500 m is FM 100-2-3 (1991)', url: 'https://archive.org/details/DTIC_ADA217416' },
    check({ you, them, air }) {
      const real = (air ?? []).filter(w => best(w.shots) <= NO_ANSWER);
      // The pairing's own anti-aircraft hull says how far the game's reaches.
      const aa = [you, them].find(isAA);
      const zsu = aa && lifeReach(aa.gun) != null ? ` The ${aa.name}'s rounds live ${n1(aa.gun.ttl)} s here, ${m0(lifeReach(aa.gun))} m: the real ZSU-23-4 reached 2,500 m.` : '';
      if (!real.length) return verdict('not here', `No aircraft of theirs on these battles carries a weapon that kills your ${you?.name} inside ${NO_ANSWER} hits.${zsu}`);
      const pick = test => real.filter(test).sort((a, b) => best(a.shots) - best(b.shots))[0];
      // A bomb is let go, not fired (under 30 m/s); a cluster's bomblets are bombs too.
      const dropped = w => Math.abs(w.gun.speed) < 30;
      const missile = pick(w => w.kind === 'rocket' && !dropped(w)), gun = pick(w => w.kind === 'bullet' && !dropped(w)), bomb = pick(dropped);
      const parts = [];
      if (missile) parts.push(`their ${own(missile.label, missile.weapon)} needs ${best(missile.shots)} hit${s(best(missile.shots))} and leaves at ${Math.round(missile.gun.speed)} m/s`);
      if (gun) parts.push(`their ${own(gun.label, gun.weapon)} needs ${best(gun.shots)} rounds${gun.rof ? ` and fires ${Math.round(gun.rof)} a second` : ''}`);
      if (bomb) parts.push(`a bomb from their ${bomb.label} needs ${best(bomb.shots)}`);
      const up = isAA(you) ? ' Yours is the hull that answers them.' : you?.gun?.up != null ? ` Your gun lifts ${Math.round(you.gun.up)} deg: it is no answer to them.` : '';
      return verdict('holds', `On your ${you.name}: ${parts.join('; ')}.${up}${zsu}`);
    },
  },
];

/** Every rule's verdict on a pairing: `[{ ...rule, verdict }]`. */
export function rulesOn(ctx) {
  return RULES.map(r => {
    let v;
    try { v = r.check(ctx); } catch { v = null; }
    return { ...r, verdict: v ?? verdict('not here', 'Not measured for this pairing.') };
  });
}

/** The fight the card opens with: Eagle Troop, 2nd Armored Cavalry Regiment,
 *  at the 73 Easting on 26 February 1991, the arena and pairing it opens,
 *  and what the engine makes of it (`duel(ctx)`). Times, ranges and counts
 *  are the US Army's own history (Certain Victory) and the Institute for
 *  Defense Analyses' replication; where accounts differ the research says. */
export const FIGHT = {
  arena: 'DC_Battle_of_73_Easting', yours: 'M1A1', theirs: 'T72',
  title: 'The 73 Easting, 26 February 1991',
  story: [
    'At about 4:18 in the afternoon, in a sandstorm, Eagle Troop of the 2nd Armored Cavalry came over a low rise in a wedge of nine M1A1s, Captain H. R. McMaster\'s own tank at its point.',
    'Eight T-72s of the Tawakalna Division sat behind sand berms on the reverse slope. The eye saw 400 to 600 m through the storm; the M1A1\'s thermal sight saw 1,500 m or more, and the T-72s had none.',
    'His crew fired three rounds in seven seconds, on the move: the round already in the gun at 1,420 m, then two darts at 600 and 400 m, one of them through a berm. All eight T-72s were burning inside half a minute. The troop drove on for 23 minutes and lost nobody.',
    'The Institute for Defense Analyses refought it in simulation. In clear weather it came out about even; with thermal sights on both sides the M1A1s lost two to one.',
  ],
  sources: [
    { doc: 'Scales, Certain Victory: The US Army in the Gulf War (1993), pp. 1-4', url: 'https://archive.org/details/DTIC_ADA361975' },
    { doc: 'IDA Paper P-2770, 73 Easting Battle Replication (1992)', url: 'https://archive.org/details/DTIC_ADA257266' },
    { doc: 'McMaster, Eagle Troop at the Battle of 73 Easting (2016)', url: 'https://thestrategybridge.org/the-bridge/2016/2/26/eagle-troop-at-the-battle-of-73-easting' },
  ],
  /** The fight on this engine: `you` the M1A1 and `them` the T-72, each with
   *  its clock (its hull's shots from the other's gun). */
  duel({ you, them }) {
    const out = [];
    const k = fewest(them), j = fewest(you), g = you?.gun;
    if (k != null && j != null) {
      out.push(`Here the M1A1's dart needs ${k} hit${s(k)} on the T-72 and the T-72's round ${j} on the M1A1${k >= j ? ': an even fight at best, which on the day it was not' : ''}.`);
    }
    if (g?.reload) out.push(`Three rounds in seven seconds: your gun loads in ${n1(g.reload)} s here, so three leave in ${n1(2 * g.reload)} s.`);
    if (g?.speed > 0 && g.gravity > 0) {
      const far = lifeReach(g);
      const at = R => `at ${R} m it has flown ${n1(timeTo(g, R))} s and dropped ${n1(dropAt(g, R))} m`;
      out.push(`${far != null && far < 1420 ? `Eagle 66's first shot, at 1,420 m, cannot be made: the dart lives ${n1(g.ttl)} s, ${m0(far)} m. ` : ''}The other two can: ${at(600)}; ${at(400)}.`);
      out.push(`Fired at 20 mph across their line, the shot at 400 m lands ${Math.round(mph(20) * timeTo(g, 400))} m off: nothing here stabilises the gun.`);
    }
    return out;
  },
};

/** The card's own words on the page, and what the page prices for it. */
export const CARD = {
  head: 'The rules of 1991',
  jump: 'The rules of 1991, on this pairing',
  intro: 'What the US Army\'s manuals of the 1980s told tank crews, what the Soviet manuals behind the Iraqi defence told theirs, and what the reports written after the Gulf War found: each rule in our words with a few of its own, and what Desert Combat\'s own data says of it in this pairing. Where the game and the manual part, it says so.',
  eyebrow: 'The cavalry at the 73 Easting',
  go: 'Fight it: M1A1 against T-72',
  wait: 'Pricing their aircraft, their missile carriers and their soldiers\' weapons against your tank',
  // The page also prices their side's aircraft and missile carriers.
  air: true,
  carriers: true,
};
