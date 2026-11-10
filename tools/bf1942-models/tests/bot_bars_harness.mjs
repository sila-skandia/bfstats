// Pins the strategy template chosen by the flags in play (`sim/botgen.mjs
// templateFor`) and a mod's own bar (`sim/judge.mjs aliveLevels`,
// `chooseBar`; `sim/botbatch.mjs verdictWithBar`), features/bot-map-generation
// section 19. Run by `tests/test_bot_bars.py`. One JSON object on stdout.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const imp = rel => import(pathToFileURL(path.join(HERE, '..', rel)).href);
const gen = await imp('sim/botgen.mjs');
const jud = await imp('sim/judge.mjs');
const batch = await imp('sim/botbatch.mjs');
const lint = await imp('sim/botlint.mjs');
const det = await imp('sim/detect.mjs');
const out = {};

// --- the template by the flags in play -----------------------------------------
const flag = (name, o = {}) => ({ name, x: 0, y: 0, z: 0, radius: 10, team: 0, fixed: false, ...o });
const area = (f, o = {}) => ({ name: f.name, flag: f, unreachable: false, ...o });
const bases = [area(flag('AxisBase', { team: 1, fixed: true })), area(flag('AlliedBase', { team: 2, fixed: true }))];
const caps = n => Array.from({ length: n }, (_, i) => area(flag(`F${i}`)));
out.three = gen.templateFor([...bases, ...caps(3)]);
out.four = gen.templateFor([...bases, ...caps(4)]);
// The_Maze: five capturable, two taken out by the route probe.
out.mazeLike = gen.templateFor([...bases, ...caps(3), area(flag('3'), { unreachable: true }), area(flag('4'), { unreachable: true })]);
// Inshallah_Valley: five flags, no fixed base, all in play.
out.noBases = gen.templateFor(caps(5));
out.few = gen.readTemplate(gen.TEMPLATE_FEW);
out.many = gen.readTemplate(gen.TEMPLATE_MANY);
out.FEW_FLAGS = gen.FEW_FLAGS;

// --- a mod's own bar ---------------------------------------------------------------
// Rows of three levels at two sizes: `dead` has a side that never kills in one seed.
const row = (level, size, seed, o = {}) => ({ level, botsPerSide: size, seed, enemyKills: { 1: 3, 2: 4 }, ticketsBled: { 1: 5, 2: 6 }, botErrors: 0,
                                              capturesTotal: 2, captures: { 1: 1, 2: 1 }, flagsNeverChanged: [], capturable: 3, ...o });
const rows = [];
for (const level of ['a', 'b', 'dead']) for (const size of [8, 16]) for (const seed of [1, 2]) {
  rows.push(row(level, size, seed, { idleShare: { a: 0.6, b: 0.7, dead: 0.65 }[level],
                                     ...(level === 'dead' && size === 16 && seed === 2 ? { enemyKills: { 1: 0, 2: 2 } } : {}) }));
}
out.alive = jud.aliveLevels(rows);
const bar = (levelsAlive, mod = 'desertcombat') => ({ ...jud.buildBaseline(rows.filter(r => levelsAlive.includes(r.level)), `${mod}'s own`), mod, levelsAlive });
// DICE's bots idle less than the mod's: a level idling like the mod's own passes its bar and fails DICE's.
const dice = { ...jud.buildBaseline(rows.map(r => ({ ...r, idleShare: 0.3 })), "DICE's"), note: "DICE's" };
const pick = b => ({ against: b.against, why: b.why, note: b.baseline.note });
out.ownThree = pick(jud.chooseBar({ mod: 'DesertCombat', dice, own: bar(['a', 'b', 'c']) }));
out.ownTwo = pick(jud.chooseBar({ mod: 'DesertCombat', dice, own: bar(['a', 'b']) }));
out.vanilla = pick(jud.chooseBar({ mod: 'bf1942', dice, own: bar(['a', 'b', 'c']) }));
out.noOwn = pick(jud.chooseBar({ mod: 'fh', dice, own: null }));
const level = rows.filter(r => r.level === 'a').map(r => ({ ...r, level: 'x' }));
const strip = v => ({ against: v.bar.against, why: v.bar.why, verdict: v.verdict, outcome: v.outcome, againstDice: v.againstDice ? v.againstDice.outcome : null,
                      againstOwnMod: v.againstOwnMod ? v.againstOwnMod.outcome : null });
out.withOwn = strip(batch.verdictWithBar('x', level, { mod: 'DesertCombat', dice, own: bar(['a', 'b', 'c']) }));
out.withThin = strip(batch.verdictWithBar('x', level, { mod: 'DesertCombat', dice, own: bar(['a']) }));
// A level with a side that never kills is no-fight under either bar.
const deadLevel = rows.filter(r => r.level === 'dead').map(r => ({ ...r, level: 'y' }));
out.deadOwn = strip(batch.verdictWithBar('y', deadLevel, { mod: 'DesertCombat', dice, own: bar(['a', 'b', 'c']) }));
out.files = { dice: path.basename(batch.baselineFileFor(true)), mod: path.basename(batch.baselineFileFor(true, 'DesertCombat')),
              vanilla: path.basename(batch.baselineFileFor(true, 'bf1942')), foot: path.basename(batch.baselineFileFor(false, 'fh')) };

// --- the stand-in weapon -------------------------------------------------------------
// A level with no row in loadouts.json, one with a row for one side, and one whose kit names no weapon the bots know.
const loadouts = {
  kits: { Rifle: { items: ['K98'] }, Empty: { items: ['Binoculars'] } }, aiWeapons: { K98: { range: 300 } },
  levels: { full: { 1: { slots: ['Rifle'] }, 2: { slots: { a: 'Rifle' } } }, half: { 1: { slots: ['Rifle'] } }, unarmed: { 1: { slots: ['Empty'] }, 2: { slots: ['Rifle'] } } },
};
out.kits = Object.fromEntries(['full', 'half', 'unarmed', 'absent', 'FULL'].map(l => [l, lint.kitsDealt(loadouts, l)]));
out.kitsNoFile = lint.kitsDealt(null, 'full');
const hd = { level: 't', seed: 1, botsPerSide: 2, duration: 60, tickHz: 30, traceEvery: 30, tickets: { 1: 100, 2: 100 }, flags: [],
             bots: [{ id: 'b0', side: 1, kit: 'Rifle' }, { id: 'b1', side: 2, kit: null }, { id: 'b2', side: 1, kit: null }, { id: 'b3', side: 2, kit: 'Rifle' }] };
const dd = det.newDetector(hd);
for (let t = 0; t <= 10; t++) for (const b of hd.bots) det.feed(dd, { k: 'tick', t, bot: b.id, alive: true, pos: [t, 0, 0], beh: 'MoveTo', ctl: [1, 0, 0, 0, 0], area: null, target: null });
out.botsWithoutKit = det.finish(dd, null, 10).botsWithoutKit;
out.refusal = batch.noKitRefusal('t', [{ botsWithoutKit: 0 }, { botsWithoutKit: 2 }, {}]);
out.noRefusal = batch.noKitRefusal('t', [{ botsWithoutKit: 0 }, {}]);

// --- the doctrine -------------------------------------------------------------------
out.doctrineOf = [det.doctrineOf({}), det.doctrineOf({ doctrine: { 1: 'garrison', 2: 'garrison' } }), det.doctrineOf({ doctrine: { 1: 'sai', 2: 'garrison' } })];
out.defaultDoctrine = batch.DEFAULT_DOCTRINE;
out.mismatch = {
  same: batch.doctrineMismatch('garrison', { doctrine: 'garrison' }, [{ doctrine: 'garrison' }]),
  oldBar: batch.doctrineMismatch('garrison', { note: 'from before the field' }, []),
  oldRows: batch.doctrineMismatch('garrison', { doctrine: 'garrison' }, [{ doctrine: 'garrison' }, {}]),
  saiOnPurpose: batch.doctrineMismatch('sai', { note: 'old' }, [{}]),
};
const accepted = { level: 'x', verdict: 'fail', outcome: 'better-than-nothing', sizes: { 8: { failed: ['idleShare'] } }, accepted: { reason: 'r', failed: ['8:idleShare'] } };
out.carrySameDoctrine = !!batch.carryAccepted({ ...accepted, accepted: undefined, doctrine: 'garrison' }, { ...accepted, doctrine: 'garrison' }).accepted;
out.carryOtherDoctrine = batch.carryAccepted({ ...accepted, accepted: undefined, doctrine: 'garrison' }, accepted).acceptanceWithdrawn?.because ?? null;

console.log(JSON.stringify(out));
