// What the 1917-18 tank manuals told crews, and the infantry and gunners who
// fought them, and what BF1918's own data says of each rule: the tank
// school's RULES card on a BF1918 arena (features/tank-doctrine-1918). The
// dogfight school does the same with Boelcke's rules (`dogfight-doctrine.js`).
//
// The rules are the British General Staff's and Tank Corps' pamphlets (SS
// 164, May 1917; SS 203, February 1918; SS 204, March 1918), the US Tank
// Corps' lessons of 1918, Haig's Cambrai despatch, a German division's
// report after Cambrai as the Tank Corps translated it, and the first tank
// against tank fight, at Villers-Bretonneux on 24 April 1918. Each says in
// our words what it asked, quotes a few words of it, and is checked against
// the pairing on the page.
//
// Pure: a pairing's numbers in, a verdict per rule out. `you` and `them` are
// the page's tanks (`tank-school-page.js` readTank) with `shots`, the clock
// of the OTHER's gun on this hull (`{ 0, 90, 180: { shots } }`), and
// `exposed`, the metres of hull above the gun (the band a crest cannot hide
// while the gun fires over it). The context carries what the page priced:
//
//   { you, them,
//     mg: { label, shots } | null,                       their hull's machine gun on your hull, from the front
//     fieldGuns: [{ label, speed, gravity, reload, radius, shots }],   their side's field guns on your hull
//     foot: [{ label, shots, charge, full, floor, min }] }  their soldiers' anti-tank weapons on your hull

import { timeTo } from './tank-ballistics.js';
import { arcCover } from './tank-arena.js';

const n1 = v => (v == null || !Number.isFinite(v) ? '-' : Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
const s = v => (v === 1 ? '' : 's');
const shotsAt = (t, b) => t?.shots?.[b]?.shots ?? null;
const best = shots => Math.min(...[0, 90, 180].map(b => shots?.[b]?.shots ?? Infinity));
/** Yards to metres, for the manuals' distances. */
const yd = y => Math.round(y * 0.9144);

/** The distances the rules are read at: a gun duel (Mitchell first saw the
 *  German tank at about 300 yards, the manuals' machine guns fire at 500 and
 *  under), and a field gun firing over open sights (SS 203 section A). */
export const RANGE = { duel: 200, fieldGun: 300 };

/** Where a hull's main gun points, in words: `{ round, any, all, words }`. */
export function arcWords(t) {
  const cover = arcCover(t?.gun?.arcs ?? []);
  if (!cover) return null;
  if (cover.round) return { ...cover, words: `The ${t.name}'s gun is in a turret that turns all the way round.` };
  const guns = t.gun.arcs.length;
  if (guns > 1) {
    const both = cover.all ? `only within ${Math.round(Math.max(Math.abs(cover.all[0]), Math.abs(cover.all[1])))} deg of the nose do ${guns === 2 ? 'both' : 'all'} bear` : 'no bearing has more than one';
    return { ...cover, words: `The ${t.name} carries ${guns} guns, one to a side: between them they cover ${cover.any} deg, and ${both}.` };
  }
  const [lo, hi] = t.gun.arcs[0];
  if (Math.abs(lo + hi) <= 2) return { ...cover, words: `The ${t.name}'s gun turns only ${Math.round(hi)} deg either side of the nose: it is aimed with the tracks.` };
  const side = (a, w) => (a > 0 ? `${Math.round(a)} deg to the ${w}` : null);
  return { ...cover, words: `The ${t.name}'s gun covers ${[side(-lo, 'left'), side(hi, 'right')].filter(Boolean).join(' and ')} of the nose: aim the hull, then the gun.` };
}

/** What moving costs a shot at `R` m, and what stopping costs: the hull's
 *  speed rides on the shell (FA-23's launch, `tank-ballistics.js`), so a
 *  shot fired crossing at top speed lands `drift` m off; a hard stop leaves
 *  the hull swinging `peak` deg for `still` s. */
export function haltMeasure(you, R = RANGE.duel) {
  const top = you?.sheet?.drive?.top ?? null;
  const t = you?.gun?.speed > 0 ? timeTo(you.gun, R) : null;
  return {
    top, t, R,
    drift: top != null && t != null ? top * t : null,
    still: you?.sheet?.steady?.hardStop?.still ?? null,
    peak: you?.sheet?.steady?.hardStop?.peak ?? null,
  };
}

/** A field gun's shell crossing `R` m at a hull driving across at `top`. */
export function fieldGunLead(g, top, R = RANGE.fieldGun) {
  const t = g.speed > 0 ? timeTo({ speed: g.speed, gravity: g.gravity ?? 1 }, R) : null;
  return { t, lead: top != null && t != null ? top * t : null };
}

const verdict = (status, words) => ({ status, words });

/**
 * The rules, in the order a crew would read them. Each: `n`, `id`, `side`
 * (`crew` for the tank's own crew, `against` for those fighting it), `name`,
 * `rule` (ours), `quote` (the source's own words, a few of them), `source`
 * `{ doc, date, where, url }`, `card` (the school's card that shows it), and
 * `check(ctx)`, the verdict on the pairing: `{ status: 'holds' | 'differs'
 * | 'partly' | 'not here', words }`.
 */
export const RULES = [
  {
    n: 1, id: 'keep-moving', side: 'crew', name: 'Keep moving under the guns', card: '05',
    rule: 'While enemy guns can see you, keep moving; stop only behind cover.',
    quote: 'Tanks should keep constantly in motion unless they are covered from hostile artillery fire.',
    source: { doc: 'SS 164, Notes on the use of Tanks', date: 'May 1917', where: 'section 3 (iii)', url: 'https://web.archive.org/web/20170620125108/http://www.da.mod.uk/Portals/0/Documents/JSCSC%20Library%20Archives/First%20World%20War%20British%20Tank%20Doctrine/S.S_164.pdf' },
    check({ you, fieldGuns }) {
      const top = you?.sheet?.drive?.top;
      const g = (fieldGuns ?? []).slice().sort((a, b) => best(a.shots) - best(b.shots))[0];
      if (!g) return verdict('not here', `No field gun of theirs is on these battles; their tank guns are the guns to keep moving under.`);
      const k = best(g.shots);
      const { t, lead } = fieldGunLead(g, top);
      const len = you.lengthM;
      if (lead == null) return verdict('partly', `Their ${g.label} kills you in ${k} hit${s(k)}. How fast you can move is not measured here.`);
      return verdict('holds', `Their ${g.label} kills you in ${k} hit${s(k)}. Its shell takes ${n1(t)} s to cross ${RANGE.fieldGun} m: driving across at ${n1(top)} m/s you are ${Math.round(lead)} m on`
        + `${len ? `, ${n1(lead / len)} lengths of your hull` : ''}, so the layer must lead you. Stopped, you are the easiest shot on the field.`);
    },
  },
  {
    n: 2, id: 'halt-to-fire', side: 'crew', name: 'Stop for the shot', card: '03',
    rule: 'To hit another tank, stop for the shot: the manual said to fire on the move, and the first tank duel was won by stopping.',
    quote: 'Accurate and rapid shooting at moving targets whilst themselves in motion.',
    source: { doc: 'SS 203, Instructions for Anti-Tank Defence', date: 'February 1918', where: 'section E.2 (ii): how tanks fight tanks', url: 'https://web.archive.org/web/20170620113727/http://www.da.mod.uk/Portals/0/Documents/JSCSC%20Library%20Archives/First%20World%20War%20British%20Tank%20Doctrine/S.S_203.pdf' },
    check({ you }) {
      const h = haltMeasure(you);
      if (h.drift == null) return verdict('partly', `Your shell takes ${n1(h.t)} s to reach ${h.R} m; how fast your hull moves is not measured here.`);
      const steady = h.still != null ? ` Stopped hard, your hull swings ${n1(h.peak)} deg and is still in ${n1(h.still)} s.` : '';
      return verdict('differs', `The manual is wrong here, as Mitchell found. Your hull's speed rides on the shell: fired crossing at ${n1(h.top)} m/s, it lands ${Math.round(h.drift)} m off at ${h.R} m, `
        + `${you.lengthM ? `${n1(h.drift / you.lengthM)} tank lengths` : 'well wide'}.${steady} Stop, wait for the hull, then fire.`);
    },
  },
  {
    n: 3, id: 'bring-to-bear', side: 'crew', name: 'Turn to bring a gun to bear', card: '02',
    rule: 'Know where your guns can point, and turn the hull to put one on them.',
    quote: null,
    source: { doc: 'Mitchell\'s account of Villers-Bretonneux (Tank Warfare, 1933)', date: '24 April 1918', where: 'he dropped into a dip and turned to bring his left 6-pounder to bear', url: 'https://losthistory.net/greatwardifferent/Great_War/Tank_Battle/Tank_Battle_01.htm' },
    check({ you, them }) {
      const a = arcWords(you), b = arcWords(them);
      if (!a) return verdict('not here', 'Where your gun can point is not in this model\'s rig.');
      const turn = you?.sheet?.drive?.turnFromRest;
      return verdict('holds', `${a.words}${b ? ` ${b.words}` : ''}${turn && !a.round ? ` Your hull turns 90 deg in ${n1(turn)} s.` : ''}`);
    },
  },
  {
    n: 4, id: 'skyline', side: 'crew', name: 'Off the skyline', card: '01',
    rule: 'Never come over a crest or a skyline where field guns can see you; use the ground for cover.',
    quote: 'the importance of using local ground cover and avoiding sky lines.',
    source: { doc: 'Tank Corps Activities, A.E.F. (the US 301st Battalion\'s lessons)', date: '1918', where: 'what tank commanders must learn; and Haig\'s despatch on the field gun at Flesquieres, Cambrai, 1917', url: 'https://archive.org/details/tankcorpsactivit00unse' },
    check({ you, them }) {
      const e = you?.exposed, f = them?.exposed;
      if (e == null) return verdict('partly', 'Shells stop on the ground in this engine, so cover is real. The school draws no ground yet.');
      const share = x => (x.heightM ? ` (${Math.round(x.exposed / x.heightM * 100)}% of its height)` : '');
      return verdict('holds', `Shells stop on the ground in this engine, so a crest is real cover. To fire over one, your ${you.name} shows ${n1(e)} m of hull above its gun${share(you)}`
        + `${f != null ? `, their ${them.name} ${n1(f)} m${share(them)}` : ''}. The school draws no ground yet.`);
    },
  },
  {
    n: 5, id: 'not-alone', side: 'crew', name: 'Never alone', card: '01',
    rule: 'Fight as a section of two or three, one covering while the others move: a lone tank draws every gun.',
    quote: 'the easier it will be for the enemy to concentrate his guns',
    source: { doc: 'SS 164, Notes on the use of Tanks', date: 'May 1917', where: 'section 4 (iv); and SS 204 (March 1918), the section of three', url: 'https://web.archive.org/web/20170620105027/http://www.da.mod.uk/Portals/0/Documents/JSCSC%20Library%20Archives/First%20World%20War%20British%20Tank%20Doctrine/S.S_204.pdf' },
    check({ you, them }) {
      const k = shotsAt(them, 0), r = you?.gun?.reload;
      if (k == null || !r) return verdict('not here', 'The school fights one tank against one. Not in the school yet.');
      const alone = (k - 1) * r;
      return verdict('partly', `Your gun alone needs ${k} hit${s(k)} on their front, ${n1(alone)} s of loading between the first and the last; two of you firing, about ${n1(alone / 2)} s. The school fights one against one: not in it yet.`);
    },
  },
  {
    n: 6, id: 'spread-out', side: 'crew', name: 'Spread out', card: '05',
    rule: 'Keep your tanks a hundred yards apart, so one shell cannot hurt two.',
    quote: 'They should not normally work less than 100 yards apart.',
    source: { doc: 'SS 164, Notes on the use of Tanks', date: 'May 1917', where: 'section 5', url: 'https://web.archive.org/web/20170620125108/http://www.da.mod.uk/Portals/0/Documents/JSCSC%20Library%20Archives/First%20World%20War%20British%20Tank%20Doctrine/S.S_164.pdf' },
    check({ fieldGuns }) {
      const radius = Math.max(0, ...(fieldGuns ?? []).map(g => g.radius ?? 0));
      if (!radius) return verdict('not here', 'No field gun of theirs on these battles has a blast that reaches armour.');
      const g = fieldGuns.find(x => x.radius === radius);
      return verdict('holds', `A hundred yards (${yd(100)} m) is more than enough: their ${g.label}'s blast reaches ${radius} m and falls away to nothing there, and it reaches a tank's middle, not its plates. Tanks closer than ${2 * radius} m can share one shell.`);
    },
  },
  {
    n: 7, id: 'guns-kill-tanks', side: 'against', name: 'The field gun is the answer', card: '05',
    rule: 'Fight a tank with guns firing straight at it, over open sights, at short range, with high explosive.',
    quote: 'artillery fire forms the most effective defence against tanks.',
    source: { doc: 'SS 203, Instructions for Anti-Tank Defence', date: 'February 1918', where: 'section A.1, A.4 and A.5', url: 'https://web.archive.org/web/20170620113727/http://www.da.mod.uk/Portals/0/Documents/JSCSC%20Library%20Archives/First%20World%20War%20British%20Tank%20Doctrine/S.S_203.pdf' },
    check({ you, fieldGuns, mg }) {
      const gs = (fieldGuns ?? []).filter(g => Number.isFinite(best(g.shots)));
      if (!gs.length) return verdict('not here', 'No field gun of theirs is on these battles.');
      const list = gs.map(g => `their ${g.label} in ${best(g.shots)}`).join(', ');
      const m = mg ? best(mg.shots) : null;
      return verdict('holds', `It kills your ${you.name}: ${list} hit${gs.every(g => best(g.shots) === 1) ? '' : 's'}, blast and all.`
        + `${Number.isFinite(m) ? ` Their ${mg.label} would need ${m} hits.` : ''}`);
    },
  },
  {
    n: 8, id: 'no-rifle-fire', side: 'against', name: 'Don\'t waste bullets on it', card: '05',
    rule: 'Rifle fire does nothing to a tank. Mass machine guns on one tank inside 500 yards, at the driver\'s slit and the gun ports.',
    quote: 'rifle fire is ineffective against tanks and should not be employed.',
    source: { doc: 'SS 203, Instructions for Anti-Tank Defence', date: 'February 1918', where: 'sections B and C.3', url: 'https://web.archive.org/web/20170620113727/http://www.da.mod.uk/Portals/0/Documents/JSCSC%20Library%20Archives/First%20World%20War%20British%20Tank%20Doctrine/S.S_203.pdf' },
    check({ mg }) {
      const m = mg ? best(mg.shots) : null;
      if (!mg) return verdict('not here', 'Neither their tank nor these battles carry a machine gun to measure.');
      if (!Number.isFinite(m)) return verdict('holds', `Their ${mg.label}'s bullets do nothing to your hull from any side.`);
      return verdict('partly', `Bullets are no answer: their ${mg.label} would need ${m} hits on your hull. Massed machine guns blind no one here either: the game has no vision slits to close.`);
    },
  },
  {
    n: 9, id: 'from-the-rear', side: 'against', name: 'From the side or rear', card: '01',
    rule: 'Let the tank pass, then attack it from the side or rear, close.',
    quote: 'The tank is best attacked from the rear.',
    source: { doc: 'A German division\'s report after Cambrai, as the Tank Corps translated it', date: 'late 1917', where: 'reprinted in Browne, The Tank in Action (1920)', url: 'https://www.gutenberg.org/ebooks/79272' },
    check({ you, them }) {
      const mine = [0, 90, 180].map(b => shotsAt(you, b)), theirs = [0, 90, 180].map(b => shotsAt(them, b));
      const say = (t, f) => (f.every(v => v != null) ? `${t}: front ${f[0]}, side ${f[1]}, rear ${f[2]}` : null);
      const alike = f => f.every(v => v != null) && Math.max(...f) - Math.min(...f) <= 1;
      if (!mine.some(v => v != null)) return verdict('not here', 'Their gun cannot hurt your hull, so there is no side to choose.');
      const words = [say(`Your ${you.name} takes their hits`, mine), say(`their ${them.name} takes yours`, theirs)].filter(Boolean).join('; ');
      if (alike(mine) && alike(theirs)) return verdict('differs', `Not in this game: a WWI hull here is armoured alike all round. ${words}. Going round the back buys you nothing but their gun's arc.`);
      return verdict('partly', `${words}.`);
    },
  },
  {
    n: 10, id: 'bundled-charges', side: 'against', name: 'Bundled charges, not grenades', card: '05',
    rule: 'A single hand grenade does nothing to a tank; tie them in a bundle and throw it under the tank.',
    quote: 'Are useless singly',
    source: { doc: 'The same German division\'s report after Cambrai', date: 'late 1917', where: 'on hand grenades; reprinted in Browne, The Tank in Action (1920)', url: 'https://www.gutenberg.org/ebooks/79272' },
    check({ you, foot }) {
      const charges = (foot ?? []).filter(w => w.charge && Number.isFinite(best(w.shots)));
      if (!charges.length) return verdict('not here', 'Their soldiers carry nothing thrown that hurts your hull on these battles.');
      charges.sort((a, b) => best(a.shots) - best(b.shots));
      const top = charges[0], worst = charges[charges.length - 1];
      const fuse = top.fuse && you?.sheet?.drive?.top ? ` It bursts ${n1(top.fuse)} s after it leaves the hand; your ${you.name} drives ${Math.round(top.fuse * you.sheet.drive.top)} m in that time.` : '';
      if (top === worst || top.label === worst.label) return verdict('partly', `Their ${top.label}: ${best(top.shots)} throws to kill your ${you.name}, each going off against the hull.${fuse}`);
      return verdict('holds', `Their ${top.label} needs ${best(top.shots)} throws to kill your ${you.name}, their ${worst.label} ${best(worst.shots)}, each going off against the hull.${fuse}`);
    },
  },
  {
    n: 11, id: 'anti-tank-rifle', side: 'against', name: 'The anti-tank rifle: close or not at all', card: '05',
    rule: 'The anti-tank rifle pierces a tank at a few hundred yards, but it takes many hits; few were ever fired.',
    quote: null,
    source: { doc: 'Fuller, Tanks in the Great War, chapter XXXIV', date: '1920', where: 'on the 13 mm Mauser Tankgewehr of 1918', url: 'https://archive.org/details/tanksinthegreatw49808gut' },
    check({ you, foot }) {
      const r = (foot ?? []).find(w => !w.charge && w.full != null && Number.isFinite(best(w.shots)));
      if (!r) return verdict('not here', 'Their soldiers carry no anti-tank rifle on these battles.');
      const k = best(r.shots);
      return verdict('holds', `Their ${r.label} needs ${k} hits on your ${you.name} inside ${Math.round(r.full)} m. Past ${Math.round(r.min)} m a hit does ${Math.round(r.floor * 100)}% of the damage: about ${Math.ceil(k / r.floor)} hits. In the game, as in 1918, it is a close weapon`
        + (r.pickup ? `, and a rare one: no kit a soldier chooses carries it, only a kit the battle lays out to be picked up.` : '.'));
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

/** The first tank against tank fight, as the school tells it: Villers-
 *  Bretonneux, 24 April 1918, the arena and pairing it opens, and what the
 *  engine makes of it (`duel(ctx)`). Times and shots are the British side's
 *  own account (the 1st Battalion's war diary, Mitchell's book, the
 *  Official History); where the accounts differ it says so. */
export const VILLERS_BRETONNEUX = {
  arena: 'villers_bretonneux', yours: 'Mark4', theirs: 'A7V',
  title: 'Villers-Bretonneux, 24 April 1918',
  story: [
    'Three British Mark IVs held the Cachy line: Lieutenant Frank Mitchell\'s male, with two 6-pounders, and two females armed only with machine guns. Gassed overnight, Mitchell had four of his seven crew and a borrowed gearsman.',
    'At about 10:00 the A7V Nixe (Lieutenant Wilhelm Biltz) holed both females with its 57 mm gun. Their machine guns could not hurt it, and they withdrew.',
    'Mitchell\'s gunners fired on the move and missed: the hull pitched like a ship at sea. He dropped into a dip and turned to bring his left gun to bear, its gunner aiming with one eye swollen shut by the gas.',
    'Then he stopped. Three shots, three hits, and Nixe\'s crew got out. The other A7Vs turned away. The written rule of February 1918 had said to fire on the move.',
  ],
  sources: [
    { doc: 'Landships: the 1st Battalion on 24 April 1918 (war diary, 3rd Tank Brigade report)', url: 'https://www.sites.google.com/site/landships/home/narratives/1918/kaiserschlacht/1st-battalion-24-april-1918' },
    { doc: 'Williams-Ellis, The Tank Corps (1919), pp. 261-263', url: 'https://archive.org/details/tankcorps00clou' },
  ],
  /** The duel on this engine: `you` the Mark IV and `them` the A7V, each
   *  with its clock (its hull's shots from the other's gun), and `femaleMg`
   *  a female's machine gun on the A7V (`{ label, shots }`). */
  duel({ you, them, femaleMg }) {
    const out = [];
    const fewest = t => { const v = [0, 90, 180].map(b => shotsAt(t, b)).filter(x => x != null); return v.length ? Math.min(...v) : null; };
    const k = fewest(them), j = fewest(you);
    if (k != null) {
      out.push(k <= 3 ? `Here the Mark IV's 6-pounder needs ${k} hit${s(k)} on the A7V: Mitchell's three would do it.`
        : `Here the Mark IV's 6-pounder needs ${k} hits on the A7V: Mitchell's three would leave it about ${Math.round(them.hp * (1 - 3 / k))} of its ${them.hp} hit points. On the day, its crew got out.`);
    }
    if (j != null) out.push(`The A7V's 57 mm needs ${j} hit${s(j)} on the Mark IV.`);
    const m = femaleMg ? best(femaleMg.shots) : null;
    if (Number.isFinite(m)) out.push(`A female's machine guns would need ${m} hits on the A7V: as on the day, no answer to it.`);
    return out;
  },
};

/** The fight the card opens with, as the page asks every war's module. */
export const FIGHT = VILLERS_BRETONNEUX;

/** The card's own words on the page. */
export const CARD = {
  head: 'The rules of 1917-18',
  jump: 'The rules of 1917-18, on this pairing',
  intro: 'What the British, American and German manuals of 1917 and 1918 told tank crews, and the gunners and infantry who fought them, each rule in our words with a few of its own, and what BF1918\'s own data says of it in this pairing. Where the game and the manual part, it says so.',
  eyebrow: 'The first tank against tank fight',
  go: 'Fight it: Mark IV against A7V',
  wait: 'Pricing their field guns and their soldiers\' weapons against your tank',
};

export { n1 };
