// The dogfight school's own page (`dogfight.html`, features/dogfight-school,
// "The school's own page"): the theatre first, with no level behind it.
//
// The Range's school borrows its planes from the battle it stands on; this
// page has none, so it loads the models itself (`plane-models.js`) for the
// arena chosen in its sidebar (`dogfight-arena.js`): the lessons are flown on
// the arena's best fighter, as the Range flies them, and drawn as your plane
// and the ace's. FLY IT and the ring courses put you in that arena, in your
// plane; Esc goes back to the front end's Range tab.
//
// `?arena=<battle>` picks the arena, `?lesson=<id>` opens a lesson; both are
// otherwise this browser's last (`localStorage`), and the plane is the one
// the Range's school remembers too.
//
// `?mod=<id>` is the game or mod the school is on (else the one the viewer's
// pages last picked): its arenas are its own battles, its planes its own
// models, and its recorded fights the ones listed first. A mod with no
// battle that has fighters on both sides keeps vanilla's arenas for the
// lessons, and says so. The pill in the header changes it, and reloads.

import { Aircraft } from './aircraft.js';
import { createDogfightTheatre } from './dogfight-theatre.js';
import { fighterRank, jetName, lessonById, lessonsFor, setLessonMod } from './dogfight-lessons.js';
import { arenasFrom, arenasFromTeams, planeIn, aceAgainst, arenaUrl } from './dogfight-arena.js';
import { loadPlaneModel, airframeRoot, planeVisual } from './plane-models.js';
import { VIEWER_ROOT } from './viewer-root.js';
import { loadMods, stored as storedMod, remember, trees, VANILLA } from './mods.js';
import * as jetAge from './dogfight-doctrine-1991.js';
import { measureAirframe } from './dogfight-airframe.js';
import { findTwoSeater, gunnersOf } from './dogfight-gunner-seats.js';

const params = new URLSearchParams(location.search);
const ARENA_KEY_VANILLA = 'dogfight-school:arena';
/** The Range's school remembers your plane under the same name. */
const PLANE_KEY = 'dogfight-school:plane';
const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private window */ } };

/** A template as a pilot says it: `BF109` "Bf 109", `Yak9` "Yak 9", `Mig29` "MiG-29". */
const pretty = t => jetName(t) ?? String(t ?? '').replace(/^BF(\d)/, 'Bf $1').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').replace(/_/g, ' ');

const wait = document.querySelector('.dsp-wait');
const say = text => { wait.querySelector('span').textContent = text; };

async function json(rel) {
  const res = await fetch(new URL(rel, VIEWER_ROOT));
  if (!res.ok) throw new Error(`${rel}: ${res.status}`);
  return res.json();
}

/** The games and mods the school can be on: a tree of their own with models
 *  and levels extracted (a view such as Community Maps is its tree's). */
const allMods = await loadMods();
const offered = trees(allMods).filter(m => m.id === VANILLA.id || (Number(m.counts?.models) > 0 && Number(m.counts?.maps) > 0));
/** A link to one fight with no `?mod=` is on that fight's mod. */
async function fightMod(id) {
  if (!id) return null;
  try { return (await json('replays/dogfights/index.json')).find(r => r.id === id)?.mod ?? VANILLA.id; } catch { return null; }
}
const wantMod = String(params.get('mod') || await fightMod(params.get('fight')) || storedMod() || VANILLA.id).toLowerCase();
const mod = offered.find(m => m.id === wantMod) ?? offered.find(m => m.id === VANILLA.id) ?? VANILLA;
const vanillaMod = offered.find(m => m.id === VANILLA.id) ?? VANILLA;

/** A tree's arenas, from its own catalogue over its own levels. */
async function arenasOf(m) {
  const [rows, levels, teams] = await Promise.all([json(`${m.paths.models}/models.json`), json(`${m.paths.maps}/maps.json`),
    // Each level's aircraft by team, where the tree has the index: a mod
    // whose sides change from level to level (BF1918) pairs only by it.
    json(`${m.paths.maps}/dogfight-arenas.json`).catch(() => null)]);
  const names = levels.map(l => l.name);
  const byTeams = teams ? arenasFromTeams(teams, names) : [];
  return byTeams.length ? byTeams : arenasFrom(rows, names);
}
/** A tree's collision meshes (`_shared/collision-meshes.json`), read once:
 *  an airframe built with them takes the header box the engine reads its
 *  drag and inertia from (COL-14), which is the box the plane flies on in
 *  the arena. Without them it would take the drawn mesh's, and on Desert
 *  Combat the two differ: the lesson's F-16 was not the one you then flew. */
const collisions = new Map();
function collisionOf(m) {
  const id = m?.id ?? VANILLA.id;
  if (!collisions.has(id)) collisions.set(id, json(`${(m ?? vanillaMod).paths.maps}/_shared/collision-meshes.json`).catch(() => null));
  return collisions.get(id);
}
say(`Reading ${mod.name || mod.short}'s battles`);
let arenas = await arenasOf(mod).catch(error => { console.warn(`dogfight school: ${mod.id} arenas`, error); return []; });
/** The tree the arenas (and so the lessons' planes and FLY IT) come from. */
let arenaMod = mod;
if (!arenas.length && mod.id !== VANILLA.id) {
  arenas = await arenasOf(vanillaMod);
  arenaMod = vanillaMod;
}
if (!arenas.length) {
  say('No arena: no battle here has fighters on both sides');
  throw new Error('dogfight school: no arenas');
}
const modId = m => (m.id === VANILLA.id ? null : m.id);
/** The arena tree's collision meshes, in hand before a plane is built. */
const collisionMeshes = await collisionOf(arenaMod);
// The tree's own lessons (`dogfight-lessons.js` `MOD_LESSONS`: GCMOD's), and
// the craft each names for its sides, loaded once: a lesson flies and is
// drawn on its own X-Wing and TIE, whatever plane is picked.
setLessonMod(arenaMod.id);
const crafts = new Map();
await Promise.all([...new Set(lessonsFor(arenaMod.id).flatMap(l => [l.ace?.craft, l.you?.craft]).filter(Boolean))]
  .map(async name => {
    try {
      const root = airframeRoot(await loadPlaneModel(name, modId(arenaMod)));
      if (root) crafts.set(name.toLowerCase(), root);
    } catch (error) { console.warn(`dogfight school: craft ${name}`, error); }
  }));
const craftOf = name => (name ? crafts.get(String(name).toLowerCase()) ?? null : null);
const frame = { cockpit: false, collisionMeshes };
/** The arena is remembered per mod; vanilla keeps the key it always had. */
const ARENA_KEY = arenaMod.id === VANILLA.id ? ARENA_KEY_VANILLA : `${ARENA_KEY_VANILLA}:${arenaMod.id}`;
const want = (params.get('arena') ?? stored(ARENA_KEY) ?? '').toLowerCase();
let arena = arenas.find(a => a.map.toLowerCase() === want) ?? arenas[0];
let choice = stored(PLANE_KEY);

/** The planes of the arena as the theatre lists them. */
const planes = () => arena.planes.map(p => ({ template: p.template, name: pretty(p.template), fighter: p.fighter }));
const mine = () => planeIn(arena, choice);

/** The models the theatre draws and flies: yours and the ace's, each on its
 *  own airframe, with its own gunners (a Stuka's rear gunner fires back in
 *  every lesson, `gunnersOf`); the arena's best fighter only stands in for
 *  a model that will not load. */
const models = { fighter: null, mine: null, ace: null, mineGunners: [], aceGunners: [], mineName: null, aceName: null };
const gunnersIn = root => { try { return root ? gunnersOf(root.clone(true)) : []; } catch (e) { console.warn('dogfight school: gunners', e); return []; } };
let loading = 0;
/** Resolves true when these models are the ones on stage; false when a later
 *  pick (clicking through the arenas) overtook it. */
async function loadModels() {
  const ticket = ++loading;
  const best = [...arena.planes].sort((a, b) => fighterRank(a.template) - fighterRank(b.template))[0];
  const me = mine(), ace = aceAgainst(arena, me);
  const [f, m, a] = await Promise.all([best, me, ace].map(p => (p ? loadPlaneModel(p.template, modId(arenaMod)) : null)));
  if (ticket !== loading) return false;
  models.fighter = airframeRoot(f) ?? models.fighter;
  if (airframeRoot(f)) models.fighterName = best.template;
  models.mine = airframeRoot(m) ?? models.fighter;
  models.ace = airframeRoot(a) ?? models.fighter;
  models.mineName = airframeRoot(m) ? me.template : models.fighterName;
  models.aceName = airframeRoot(a) ? ace.template : models.fighterName;
  models.mineGunners = gunnersIn(models.mine);
  models.aceGunners = gunnersIn(models.ace);
  return true;
}

// --- the two-seater -------------------------------------------------------------
// The two-seater lesson's plane (features/dogfight-doctrine, "The gunners
// from the planes' own data"): the arena's own two-seater, its gunners off
// its own model. The arena's planes first, the ace's side and the planes
// that are not fighters before the rest, then the other arenas' bombers and
// two-seaters; the first that carries a gunner flies the lesson.
const seater = { arena: null, value: null, searching: false };
function seaterCandidates() {
  const me = mine();
  const aceSide = me?.side === 'Axis' ? 'Allied' : 'Axis';
  const rank = p => (p.fighter ? 2 : 0) + (p.side === aceSide ? 0 : 1);
  const here = [...arena.planes].sort((a, b) => rank(a) - rank(b));
  const seen = new Set(here.map(p => p.template));
  const elsewhere = arenas.flatMap(a => a.planes).filter(p => !p.fighter && !seen.has(p.template) && seen.add(p.template));
  return [...here, ...elsewhere].map(p => ({
    template: p.template,
    root: async () => airframeRoot(await loadPlaneModel(p.template, modId(arenaMod))),
  }));
}
async function loadSeater() {
  const at = arena;
  if (seater.arena === at) return;
  seater.arena = at;
  seater.value = null;
  seater.searching = true;
  const found = await findTwoSeater(seaterCandidates()).catch(e => { console.warn('dogfight school: two-seater', e); return null; });
  if (seater.arena !== at) return;
  seater.searching = false;
  seater.value = found && {
    template: found.template, name: pretty(found.template), mod: modId(arenaMod), gunners: found.gunners,
    make: () => new Aircraft(found.root.clone(true), null, frame),
    visual: () => planeVisual(found.root),
  };
  theatre?.planesChanged();
}

say(`Fuelling the ${pretty(mine()?.template)} and the ${pretty(aceAgainst(arena, mine())?.template)}`);
await loadModels();
if (!models.fighter) {
  say('The planes did not load');
  throw new Error('dogfight school: no plane model');
}

// --- the rules card of the mod's own war ---------------------------------------------
// On Desert Combat the Rules tab holds the jet age's rules
// (features/dogfight-doctrine-1991), each read on the two jets on stage:
// their weapons off their own models, and what the page's flight law does
// with each airframe, measured once a type (about a tenth of a second).
const JET_TREES = /^(desertcombat|dc_final)$/i;
const laws = new Map();
function lawOf(template, root) {
  const key = `${arenaMod.id}:${template}`;
  if (!laws.has(key)) laws.set(key, root ? measureAirframe(() => new Aircraft(root.clone(true), null, frame)) : null);
  return laws.get(key);
}
/** An address that names an arena follows the one picked, so a reload
 *  does not go back to the one it was opened on. */
function arenaInUrl() {
  const u = new URL(location.href);
  if (!u.searchParams.has('arena')) return;
  u.searchParams.set('arena', arena.map);
  history.replaceState(history.state, '', u);
}
/** The arena that stages the card's fight: both its planes, theirs the ace's. */
const fightArena = f => arenas.find(a => a.planes.some(p => p.template === f.yours && p.side === 'Allied') && a.axis[0] === f.theirs) ?? null;
function rulesCard() {
  if (!JET_TREES.test(arenaMod.id)) return null;
  const me = mine(), ace = aceAgainst(arena, me);
  if (!me || !ace) return null;
  const ctx = {
    you: jetAge.jetOf(models.mine, pretty(me.template), lawOf(me.template, models.mine)),
    them: jetAge.jetOf(models.ace, pretty(ace.template), lawOf(ace.template, models.ace)),
  };
  const f = jetAge.FIGHT, there = fightArena(f);
  const here = me.template === f.yours && ace.template === f.theirs;
  return {
    ...jetAge.CARD,
    rules: jetAge.rulesOn(ctx),
    fight: {
      eyebrow: f.eyebrow, title: f.title, story: f.story, sources: f.sources,
      words: here ? f.words(ctx) : [],
      go: there ? f.go : null,
      // Its arena and its planes, then the lesson that is its shape.
      onGo: () => {
        if (!there) return;
        arena = there;
        store(ARENA_KEY, arena.map);
        arenaInUrl();
        choice = f.yours;
        store(PLANE_KEY, choice);
        theatre.redrawChoices();
        loadModels().then(on => { if (on) { theatre.planesChanged(); theatre.show(f.lesson[0], f.lesson[1]); } });
      },
    },
  };
}

/** Into the arena: the lesson (or ring course) flown in your plane. */
function fly({ lesson = null, move = null, course = null }) {
  const me = mine();
  // The pair flown: a wingman, and a gunner for your plane's back seat.
  const wanted = lessonById(lesson)?.flyWith?.length ?? 0;
  const wingmen = wanted ? wanted + (models.mineGunners.length ? 1 : 0) : 0;
  location.href = arenaUrl(VIEWER_ROOT.href, { map: arena.map, mod: modId(arenaMod), side: me?.side ?? 'Allied', lesson, move, course, wingmen, base: location.href });
}

const theatre = createDogfightTheatre({
  host: document.body,
  // The planes on stage: yours, as picked, and the ace's.
  planeName: () => pretty(models.mineName),
  aceName: () => pretty(models.aceName),
  // The planes the lessons fly on, each its own airframe: every move's count
  // on the tabs is flown on them (features/dogfight-doctrine).
  airframe: () => (models.mineName ? { key: `${modId(arenaMod)}:${models.mineName}:${models.aceName}`, name: pretty(models.mineName),
                                       ace: pretty(models.aceName) } : null),
  // Flown over a floor at 0, as the Range and the school's tests fly them.
  groundY: 0,
  // Side 0 is the ace, the rest yours (you, a wingman): each its own type.
  makePlane: (side, i) => new Aircraft((craftOf(side?.craft) ?? (i === 0 ? models.ace : models.mine)).clone(true), null, frame),
  // Each side's gunners: a two-seater's rear gun fires in every lesson.
  gunners: i => (i === 0 ? models.aceGunners : models.mineGunners),
  planeVisual: (i, craft = null) => planeVisual(craftOf(craft) ?? (i === 0 ? models.ace : models.mine)),
  // A recorded fight's own types, from their trees.
  planeVisualFor: (template, mod) => loadPlaneModel(template, mod).then(scene => (scene ? planeVisual(scene) : null)),
  makePlaneFor: async (template, mod) => {
    const [scene, meshes] = await Promise.all([loadPlaneModel(template, mod),
      collisionOf(offered.find(m => m.id === String(mod ?? VANILLA.id).toLowerCase()) ?? vanillaMod)]);
    const root = airframeRoot(scene);
    if (!root) return null;
    const own = { cockpit: false, collisionMeshes: meshes };
    try {
      new Aircraft(root.clone(true), null, own);
    } catch (e) {
      console.warn(`dogfight what-if: ${template} airframe`, e);
      return null;
    }
    return () => new Aircraft(root.clone(true), null, own);
  },
  onFly: (id, move) => fly({ lesson: id, move }),
  onFlyCourse: id => fly({ course: id }),
  // Nothing under the school here: closing it goes back to the front end,
  // THE RANGE's drills, where the school is one of them.
  onClose: () => { location.href = new URL('play/index.html?tab=proving', VIEWER_ROOT).href; },
  // The brand goes the same way, not out to the site.
  siteHref: new URL('play/index.html?tab=proving', VIEWER_ROOT).href,
  siteTitle: 'The Range',
  // The address follows what is on stage, so a lesson, a scenario or a
  // fight can be linked to.
  url: true,
  rules: rulesCard,
  planes,
  plane: () => mine()?.template ?? null,
  onPlane: template => {
    choice = template;
    store(PLANE_KEY, template);
    loadModels().then(on => { if (on) theatre.planesChanged(); });
  },
  // The two-seater lesson's plane and its gunners (`loadSeater`).
  twoSeater: () => (seater.value ?? (seater.searching ? { searching: true, gunners: [] } : null)),
  mods: {
    list: () => offered.map(m => ({ id: m.id, name: m.name || m.short || m.id, short: m.short || m.name || m.id,
      icon: new URL(m.icon || `icons/mods/${m.id}.png`, VIEWER_ROOT).href })),
    current: () => mod.id,
    note: () => (arenaMod === mod ? null
      : `${mod.short || mod.name} has no battle with fighters on both sides yet: the lessons fly in ${arenaMod.short}'s.`),
    // Another mod is another catalogue: the page starts again on it, on the
    // lesson or scenario on stage (a recorded fight is the old mod's).
    pick: id => {
      remember(id);
      const next = new URL(location.href);
      for (const k of ['mod', 'fight', 'arena']) next.searchParams.delete(k);
      if (id !== VANILLA.id) next.searchParams.set('mod', id);
      location.href = next.href;
    },
  },
  arenas: {
    list: () => arenas,
    current: () => arena.map,
    pick: map => {
      const next = arenas.find(a => a.map === map);
      if (!next || next === arena) return;
      arena = next;
      store(ARENA_KEY, arena.map);
      arenaInUrl();
      // A plane the new arena does not have gives way to its own.
      if (!arena.planes.some(p => p.template === choice)) choice = null;
      theatre.redrawChoices();
      loadModels().then(on => { if (on) theatre.planesChanged(); });
      loadSeater();
    },
  },
});
loadSeater();
wait.hidden = true;
theatre.open(params.get('lesson') || null, { demo: params.get('demo'), fight: params.get('fight') });
// The test hook, as the Range's is `window.__provingGround`.
window.__dogfightSchool = { theatre, arenas, get arena() { return arena.map; }, get plane() { return mine()?.template ?? null; },
  get rules() { const card = rulesCard(); return card ? card.rules.map(r => ({ id: r.id, status: r.verdict.status, words: r.verdict.words })) : null; },
  get fight() { return rulesCard()?.fight ?? null; },
  /** The two-seater lesson's plane and its gunners, as read off its model. */
  get twoSeater() {
    const v = seater.value;
    return v ? { template: v.template, gunners: v.gunners.map(g => ({ seat: g.seat, weapon: g.weapon, rate: g.rate, speed: g.speed, life: g.life, tracer: g.tracer, at: g.at })) }
      : { searching: seater.searching };
  },
  /** What the flight law does with each airframe measured so far, by `<mod>:<template>`. */
  get laws() { return Object.fromEntries(laws); } };
