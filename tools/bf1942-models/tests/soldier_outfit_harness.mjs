// Drives the outfit resolution outside a browser and prints one JSON blob:
// `kit-loadout.js` (which soldier template a side wears on a level, which kit
// a bot draws), `kit-graft.js` `outfitCandidates` (which pose glb the drawn
// body tries), and `soldier-dress.js` (the kit's parts on the figure's bones,
// the weapon subtree a death stows). `tests/test_soldier_outfit.py` copies the
// modules in under their own names, so the files under test are the page's.
//
// The rows are the published tree's own (`maps/_shared/loadouts.json`,
// `models/kits.json`), verbatim for the two levels and four kits used.

import { createKitLoadout } from './kit-loadout.js';
import { outfitCandidates, SLOT_ROTATION } from './kit-graft.js';
import { createSoldierDress, undress, weaponNodeOf, wornSlots } from './soldier-dress.js';

const results = {};

const LOADOUTS = {
  levels: {
    el_alamein: {
      1: { soldier: 'GermanDesertSoldier', slots: { 0: 'German_Scout_Desert', 1: 'German_Assault_Desert', 2: 'German_AT_Desert', 3: 'German_Medic_Desert', 4: 'German_Engineer_Desert' } },
      2: { soldier: 'BritishSoldier', slots: { 0: 'GB_Scout', 1: 'GB_Assault', 2: 'GB_AT', 3: 'GB_Medic', 4: 'GB_Engineer' } },
    },
    wake: {
      1: { soldier: 'JapaneseSoldier', slots: { 0: 'Jap_Scout', 1: 'Jap_Assault', 2: 'Jap_AT', 3: 'Jap_Medic', 4: 'Jap_Engineer' } },
      2: { soldier: 'USMarineSoldier', slots: { 0: 'USMarine_Scout', 1: 'UsMarine_Assault', 2: 'UsMarine_AT', 3: 'USMarine_Medic', 4: 'USMarine_Engineer' } },
    },
  },
  kits: {
    GB_Assault: { nation: 'British', class: 'Assault', primary: 'Bar1918', items: ['Bar1918', 'Colt', 'KnifeAllies', 'GrenadeAllies'] },
    German_Assault_Desert: { nation: 'German', class: 'Assault', primary: 'Sg44', items: ['Sg44', 'WalterP38', 'KnifeAxis', 'GrenadeAxis'] },
    Jap_AT: { nation: 'Japanese', class: 'Anti-tank', primary: 'Panzershreck', items: ['Panzershreck', 'WalterP38', 'KnifeAxis', 'GrenadeAxis'] },
    USMarine_Scout: { nation: 'US Marines', class: 'Scout', primary: 'No4Sniper', items: ['No4Sniper', 'Colt', 'KnifeAllies', 'Binoculars', 'GrenadeAllies'] },
  },
  aiWeapons: {},
};
const worn = (slot, bone, template) => ({ template, slot, bone, position: [0, 0, 0], rotation: [0, 0, 0], glb: `${template}.kit.glb` });
const KITS = {
  kits: [
    { template: 'GB_Assault', worn: [worn('head', 'A', 'Brit_helmet'), worn('back', 'backpack', 'brit_Assault_BackPack'), worn('hip', 'HipPack', 'British_hippack')] },
    { template: 'German_Assault_Desert', worn: [worn('head', 'A', 'Germ_DesertHelmet'), worn('hip', 'HipPack', 'German_hippack')] },
    { template: 'Jap_AT', worn: [worn('head', 'A', 'Jap_Helmet'), worn('hip', 'HipPack', 'Jap_Hip_Pack')] },
  ],
};
// A mod tree that ships only its own kit: a vanilla kit falls through to
// vanilla's manifest and parts.
const MOD_KITS = { kits: [{ template: 'USMarine_Scout', worn: [worn('head', 'A', 'US_Scout_Helm'), worn('back', 'backpack', 'Radio')] }] };

const fetched = [];
globalThis.fetch = async url => {
  fetched.push(String(url));
  const body = /loadouts\.json/.test(url) ? LOADOUTS
    : /mods\/xp\/kits\.json/.test(url) ? MOD_KITS
    : /kits\.json/.test(url) ? KITS : null;
  return { ok: !!body, json: async () => body };
};

// --- which soldier a side wears, and which kit a bot draws ------------------

const page = {
  bust: () => '', currentDir: 'el_alamein', deployKit: 'assault', deployTeamId: 2,
  KITS: ['scout', 'assault', 'antitank', 'medic', 'engineer'], MAPS_BASE: 'maps',
  params: new URLSearchParams(), SOLDIER_MAX_HP_FALLBACK: 100, spawnLayout: {},
  teamNation: team => (team === 1 ? 'ger' : 'us'),
};
const loadout = createKitLoadout(page);
await loadout.loadoutsLoad;
results.soldiers = {};
for (const level of ['el_alamein', 'wake', 'no_such_level']) {
  page.currentDir = level;
  results.soldiers[level] = { 1: loadout.soldierTemplateFor({ team: 1 }), 2: loadout.soldierTemplateFor({ team: 2 }) };
}
page.currentDir = 'el_alamein';
const drawn = new Set();
const realRandom = Math.random;
for (let i = 0; i < 5; i++) {
  Math.random = () => i / 5;
  const kit = loadout.botKitFor(2, i);
  if (kit) drawn.add(`${kit.name}:${kit.primary}`);
}
Math.random = realRandom;
results.alliedKits = [...drawn].sort();

// --- which pose glb the drawn body tries -------------------------------------

results.candidates = outfitCandidates({ levelSoldier: 'GermanDesertSoldier', fallbackSoldier: 'GermanSoldier',
                                        primary: 'Sg44', pistol: 'Colt' });
results.candidatesSame = outfitCandidates({ levelSoldier: 'USMarineSoldier', fallbackSoldier: 'USMarineSoldier',
                                            primary: 'Colt', pistol: 'Colt' });
results.candidatesNoLevel = outfitCandidates({ levelSoldier: null, fallbackSoldier: 'GermanSoldier', primary: 'K98' });

// --- the parts on the bones ---------------------------------------------------

/** Enough of `Object3D` for the dresser. */
class Node {
  constructor(name = '', { mesh = false } = {}) {
    this.name = name; this.children = []; this.parent = null; this.userData = {};
    this.isMesh = mesh; this.material = mesh ? { disposed: false, dispose() { this.disposed = true; } } : null;
    this.quaternion = { set: (...q) => { this.q = q; } };
    this.position = { set: (...p) => { this.p = p; } };
  }
  add(child) { child.parent = this; this.children.push(child); return this; }
  removeFromParent() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  traverse(fn) { fn(this); for (const c of [...this.children]) c.traverse(fn); }
  clone() {
    const out = new Node(this.name, { mesh: this.isMesh });
    out.material = this.material;           // shared, like a three.js clone
    for (const c of this.children) out.add(c.clone());
    return out;
  }
}
/** The figure: a pose glb's bones as the loader names them. */
function figure() {
  const root = new Node('BritishSoldier_holding_Thompson');
  const head = new Node('Bip01_Head');
  head.add(new Node('A'));
  const hand = new Node('Bip01_R_Hand');
  hand.add(new Node('Thompson'));                    // the skeleton's own bone
  const grip = new Node('Thompson_grip');
  const weapon = new Node('Thompson_1');             // the loader's unique name
  weapon.add(new Node('ThompsonComplex', { mesh: true }));
  weapon.add(new Node('ThompsonFlerp', { mesh: true }));
  grip.add(weapon);
  hand.add(grip);
  root.add(new Node('Bip01').add(new Node('Spine_Root').add(head).add(hand)
    .add(new Node('backpack')).add(new Node('HipPack'))));
  return root;
}
const loads = [];
const loader = {
  loadAsync: async url => {
    loads.push(url);
    if (/^models\/mods\/xp\//.test(url) && !/US_Scout_Helm|Radio/.test(url)) throw new Error('404');
    const part = new Node(url.split('/').pop().replace('.kit.glb', ''));
    part.add(new Node('mesh', { mesh: true }));
    return { scene: part };
  },
};
const shaded = [];
const dress = createSoldierDress({
  loader, bases: () => ['models'], bust: () => '',
  shade: node => { shaded.push(node.name); node.traverse(o => { if (o.isMesh) o.material = { own: true, disposed: false, dispose() { this.disposed = true; } }; }); },
});

const body = figure();
results.hung = await dress.dress(body, 'gb_assault');           // any case
results.worn = wornSlots(body);
const parent = slot => { let at = null; body.traverse(o => { if (o.userData.kitSlot === slot) at = o.parent.name; }); return at; };
results.bones = { head: parent('head'), back: parent('back'), hip: parent('hip') };
let helmet = null;
body.traverse(o => { if (o.userData.kitSlot === 'head') helmet = o; });
results.headRotation = helmet.q;
results.slotRotation = SLOT_ROTATION.head;
results.shaded = shaded.length;
const own = helmet.userData.ownMaterials;
results.weapon = weaponNodeOf(body, 'Thompson')?.name ?? null;
results.weaponMissing = weaponNodeOf(body, 'No4') ?? null;
results.undressed = undress(body);
results.afterUndress = wornSlots(body);
results.ownDisposed = own.every(m => m.disposed);

// A figure gone before its parts arrive is not dressed after the fact.
const late = figure();
results.lateHung = await dress.dress(late, 'Jap_AT', () => false);
results.unknownKit = await dress.dress(figure(), 'No_Such_Kit');

// A mod tree: its own kit from its own manifest, a vanilla part it does not
// ship from vanilla's tree.
const modDress = createSoldierDress({ loader, bases: () => ['models/mods/xp', 'models'], bust: () => '' });
const marine = figure();
results.modHung = await modDress.dress(marine, 'USMarine_Scout');
results.modWorn = wornSlots(marine);
const vanillaInMod = figure();
results.vanillaKitInMod = await modDress.dress(vanillaInMod, 'German_Assault_Desert');
results.partUrls = loads.filter(u => /US_Scout_Helm|Germ_DesertHelmet/.test(u));

console.log(JSON.stringify(results));
