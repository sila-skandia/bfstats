// Headless checks of the medic bag's and the wrench's charge (ledger SUP-34):
// the law (`viewer/pack-charge.js`), the replay's reading of it from a
// soldier's recorded torso (`replay-hud.js` `packSpans`), the HUD's two bars
// (`soldier-hud.js` `writeSoldierAmmo`) and the bots' packs (`bot-referee.js`).
// Prints one JSON object; `test_pack_charge.py` asserts on it. argv[2] is the
// repo's tools/bf1942-models directory.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2];
const url = rel => pathToFileURL(join(ROOT, rel)).href;
const { installModuleHooks, viewerDir } = await import(url('sim/env.mjs'));
installModuleHooks(viewerDir(join(ROOT, 'viewer')));

const C = await import(url('viewer/pack-charge.js'));
const { packGains, packSpans, packWorked } = await import(url('viewer/replay-hud.js'));
const { writeSoldierAmmo } = await import(url('viewer/soldier-hud.js'));
const { createBotReferee, botWeaponReady } = await import(url('viewer/bot-referee.js'));

// The two packs' blocks as the exporter writes them, from vanilla's
// `Objects/HandWeapons/{MedPack,RepairPack}/Objects.con`.
const MEDPACK = {
  roundOfFire: 10, hudAmmo: 'ATIconAndHeatBar', hud: { icon: 'Ammo/Icon_medkit_64x32.tga' },
  magazine: { size: 1800, magazines: 1, type: 1, reloadTime: 1.5, autoReload: false },
};
const REPAIRPACK = {
  roundOfFire: 10, hudAmmo: 'ATIconAndReloadBar', hud: { icon: 'Ammo/Icon_repairkit_64x32.tga' },
  magazine: { size: 3000, magazines: 1, type: 1, reloadTime: 1.1, autoReload: false },
};
const RIFLE = { roundOfFire: 1, hudAmmo: 'ATAmmoBar', magazine: { size: 5, magazines: 9, type: 0, reloadTime: 3 } };

const out = {};

// --- the law ------------------------------------------------------------------
{
  const med = C.packChargeSpec(MEDPACK);
  const wrench = C.packChargeSpec(REPAIRPACK);
  out.spec = { med, wrench, rifle: C.packChargeSpec(RIFLE) };

  // One use and one tick: the server recording's 1800 -> 1791.
  const one = new C.PackCharge(med);
  one.pull();
  one.tick();
  // A held trigger: a pull and a regain every tick, the use working or not.
  const hold = (spec, seconds, works = true, from = spec.cap) => {
    const p = new C.PackCharge(spec, from);
    let worked = 0;
    let lastWorked = null;
    for (let i = 0; i < seconds * 30; i++) {
      if (p.pull(() => works)) { worked += 1; lastWorked = (i + 1) / 30; }
      p.tick();
    }
    return { charge: p.charge, worked, lastWorked: lastWorked === null ? null : Math.round(lastWorked * 100) / 100 };
  };
  const refill = spec => {
    const p = new C.PackCharge(spec, 0);
    let ticks = 0;
    while (p.charge < spec.cap) { p.tick(); ticks += 1; }
    return ticks / 30;
  };
  const raised = new C.PackCharge(med, 0);
  raised.raise(10);
  const floor = new C.PackCharge(med, 1);
  const floorPull = floor.pull();
  out.law = {
    oneUse: one.charge,
    medHeld: hold(med, 20),
    medIdle: hold(med, 5, false),
    wrenchHeld: hold(wrench, 20),
    medRefill: refill(med),
    wrenchRefill: refill(wrench),
    raisedAfter10: raised.charge,
    floorPull, floorAfter: floor.charge,
  };
}

// --- the replay: the charge from the recorded torso ---------------------------
{
  const med = C.packChargeSpec(MEDPACK);
  // Item 3 is the bag; state 5 is its fire, 1 its idle; item 1 a rifle.
  const rec = {
    animStates: { 1: { name: 'Ub_StandMedPack' }, 5: { name: 'Ub_FireMedPack' }, 7: { name: 'Ub_StandM1' } },
    stances: new Map([[42, [
      { t: 0, upper: 7, item: 1 },
      { t: 2, upper: 1, item: 3 },
      { t: 3, upper: 5, item: 3 },
      { t: 13, upper: 1, item: 3 },
      { t: 20, upper: 7, item: 1 },
      { t: 40, upper: 1, item: 3 },
    ]]]),
  };
  const life = { nid: 42, created: 0 };
  const spans = packSpans(rec, life, 'MedPack', 3);
  const at = (t, works) => Math.round(C.packChargeAt(med, spans, t, [], works)?.charge ?? -1);
  // His patient gained hit points from 3 s to 5 s only.
  const patient = t => t >= 3 && t < 5;
  out.replay = {
    spans: spans.map(s => [s.t0, s.t1, s.held, s.using]),
    before: at(2.5),
    afterUse: at(13),
    afterTwoSeconds: at(13, patient),
    afterRest: at(20),
    raised: at(40.05),
    refilled: Math.round(C.packChargeAt(med, spans, 13, [12])?.charge ?? -1),
  };
  // He boards a hull at 5 s mid-use and leaves at 8 s: his torso record is
  // not written while he rides, so it still says the bag is in use.
  const seatedRec = { ...rec, seats: new Map([[7, [{ t: 1, root: 42, seat: 0 }, { t: 5, root: 99, seat: 0 }, { t: 8, root: 42, seat: 0 }]]]) };
  out.seated = packSpans(seatedRec, { nid: 42, pid: 7, created: 0 }, 'MedPack', 3).map(s => [s.t0, s.t1, s.held, s.using]);
  // `packWorked`: a gain within the window, by someone in reach or himself.
  const track = p => ({ keys: [{ t: 0, p, q: [0, 0, 0, 1] }, { t: 100, p, q: [0, 0, 0, 1] }] });
  const holder = { ...track([0, 0, 0]), soldier: true };
  const near = { ...track([5, 0, 0]), soldier: true };
  const far = { ...track([40, 0, 0]), soldier: true };
  const gains = [{ t: 1, life: near }, { t: 3, life: far }, { t: 5, life: holder }];
  out.worked = { near: packWorked(gains, holder, 'MedPack', 1.1), far: packWorked(gains, holder, 'MedPack', 3),
                 self: packWorked(gains, holder, 'MedPack', 5), none: packWorked(gains, holder, 'MedPack', 8) };
  out.gains = packGains({ lives: [
    { soldier: true, hp: [{ t: 0, hp: 50 }, { t: 1, hp: 52 }, { t: 2, hp: 30 }] },
    { soldier: false, tmpl: 'Willy', hp: [{ t: 0, hp: 10 }, { t: 1, hp: 11 }] },
  ] }, 'MedPack').map(g => g.t);
}

// --- the HUD's two bars -------------------------------------------------------
{
  const med = {};
  writeSoldierAmmo(med, MEDPACK, 900, 0);
  const wrench = {};
  writeSoldierAmmo(wrench, REPAIRPACK, 2970, 0);
  const rifle = {};
  writeSoldierAmmo(rifle, RIFLE, 4, 8);
  const pick = v => Object.fromEntries(['Ammo/AmmoType', 'Ammo/PrimaryAmmo', 'Ammo/MaxPrimaryAmmo',
    'Ammo/SoldierAmmo/SoldierAmmoHasMag'].filter(k => k in v).map(k => [k, v[k]]));
  out.hud = { med: pick(med), wrench: pick(wrench), rifle: pick(rifle) };
}

// --- the bots' packs ----------------------------------------------------------
{
  // Nobody hurt: the use heals nobody, so the pull costs nothing.
  const referee = createBotReferee({ world: () => null });
  const bot = { playerId: 'b', team: 1, weaponAi: { name: 'MedPack' }, weaponData: { MedPack: MEDPACK },
                weapons: [{ name: 'MedPack' }], getPosition: () => [0, 0, 0],
                deviation: { onShot() {} }, shots: 0, onShot() { this.shots += 1; }, onShotFired() {} };
  const mag = referee.magazineOf(bot, 'MedPack');
  bot.isFiring = true;
  referee.bots = [bot];
  // A second of the trigger down with nobody to heal, then one with somebody.
  let patients = 0;
  referee.usePack = () => (patients > 0 ? [{ id: 'p', amount: 0.25 }] : []);
  for (let i = 0; i < 30; i++) referee.fireTick(1 / 30);
  const idle = mag.rounds;
  patients = 1;
  for (let i = 0; i < 30; i++) referee.fireTick(1 / 30);
  const working = mag.rounds;
  bot.isFiring = false;
  referee.clock = 0;
  mag.rounds = 1700;
  referee.magazineTick(bot, 1 / 30);
  const afterTick = mag.rounds;
  mag.rounds = 1;
  referee.magazineTick(bot, 0);
  const dryReady = botWeaponReady(bot);
  // Holstered 10 s, then held again.
  mag.rounds = 0;
  referee.clock = 10;
  referee.magazineTick(bot, 1 / 30);
  out.bot = { idle, working, reports: bot.shots, afterTick, dryReady, raised: mag.rounds, charged: Boolean(mag.charge) };
}

console.log(JSON.stringify(out));
