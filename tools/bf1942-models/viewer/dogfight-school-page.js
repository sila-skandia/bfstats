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

import { Aircraft } from './aircraft.js';
import { createDogfightTheatre } from './dogfight-theatre.js';
import { fighterRank } from './dogfight-lessons.js';
import { arenasFrom, planeIn, aceAgainst, arenaUrl } from './dogfight-arena.js';
import { loadPlaneModel, airframeRoot, planeVisual } from './plane-models.js';
import { VIEWER_ROOT } from './viewer-root.js';

const params = new URLSearchParams(location.search);
const ARENA_KEY = 'dogfight-school:arena';
/** The Range's school remembers your plane under the same name. */
const PLANE_KEY = 'dogfight-school:plane';
const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private window */ } };

/** A template as a pilot says it: `BF109` "Bf 109", `Yak9` "Yak 9". */
const pretty = t => String(t ?? '').replace(/^BF(\d)/, 'Bf $1').replace(/([a-z])(\d)/g, '$1 $2').replace(/_/g, ' ');

const wait = document.querySelector('.dsp-wait');
const say = text => { wait.querySelector('span').textContent = text; };

async function json(rel) {
  const res = await fetch(new URL(rel, VIEWER_ROOT));
  if (!res.ok) throw new Error(`${rel}: ${res.status}`);
  return res.json();
}

const [rows, levels] = await Promise.all([json('models/models.json'), json('maps/maps.json')]);
const arenas = arenasFrom(rows, levels.map(l => l.name));
if (!arenas.length) {
  say('No arena: no battle here has fighters on both sides');
  throw new Error('dogfight school: no arenas');
}
const want = (params.get('arena') ?? stored(ARENA_KEY) ?? '').toLowerCase();
let arena = arenas.find(a => a.map.toLowerCase() === want) ?? arenas[0];
let choice = stored(PLANE_KEY);

/** The planes of the arena as the theatre lists them. */
const planes = () => arena.planes.map(p => ({ template: p.template, name: pretty(p.template), fighter: p.fighter }));
const mine = () => planeIn(arena, choice);

/** The models the theatre draws and flies: the arena's best fighter (the
 *  lessons' airframe, as on the Range), yours, and the ace's. */
const models = { fighter: null, mine: null, ace: null };
let loading = 0;
/** Resolves true when these models are the ones on stage; false when a later
 *  pick (clicking through the arenas) overtook it. */
async function loadModels() {
  const ticket = ++loading;
  const best = [...arena.planes].sort((a, b) => fighterRank(a.template) - fighterRank(b.template))[0];
  const me = mine(), ace = aceAgainst(arena, me);
  const [f, m, a] = await Promise.all([best, me, ace].map(p => (p ? loadPlaneModel(p.template) : null)));
  if (ticket !== loading) return false;
  models.fighter = airframeRoot(f) ?? models.fighter;
  models.mine = airframeRoot(m) ?? models.fighter;
  models.ace = airframeRoot(a) ?? models.fighter;
  return true;
}

say(`Fuelling the ${pretty(mine()?.template)} and the ${pretty(aceAgainst(arena, mine())?.template)}`);
await loadModels();
if (!models.fighter) {
  say('The planes did not load');
  throw new Error('dogfight school: no plane model');
}

/** Into the arena: the lesson (or ring course) flown in your plane. */
function fly({ lesson = null, move = null, course = null }) {
  const me = mine();
  location.href = arenaUrl(VIEWER_ROOT.href, { map: arena.map, side: me?.side ?? 'Allied', lesson, move, course, base: location.href });
}

const theatre = createDogfightTheatre({
  host: document.body,
  planeName: () => pretty(mine()?.template),
  // Flown over a floor at 0, as the Range and the school's tests fly them.
  groundY: 0,
  makePlane: () => new Aircraft(models.fighter.clone(true), null, { cockpit: false }),
  planeVisual: i => planeVisual(i === 0 ? models.ace : models.mine),
  // A recorded fight's own types, from their trees.
  planeVisualFor: (template, mod) => loadPlaneModel(template, mod).then(scene => (scene ? planeVisual(scene) : null)),
  makePlaneFor: async (template, mod) => {
    const root = airframeRoot(await loadPlaneModel(template, mod));
    if (!root) return null;
    try {
      new Aircraft(root.clone(true), null, { cockpit: false });
    } catch (e) {
      console.warn(`dogfight what-if: ${template} airframe`, e);
      return null;
    }
    return () => new Aircraft(root.clone(true), null, { cockpit: false });
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
  planes,
  plane: () => mine()?.template ?? null,
  onPlane: template => {
    choice = template;
    store(PLANE_KEY, template);
    loadModels().then(on => { if (on) theatre.planesChanged(); });
  },
  arenas: {
    list: () => arenas,
    current: () => arena.map,
    pick: map => {
      const next = arenas.find(a => a.map === map);
      if (!next || next === arena) return;
      arena = next;
      store(ARENA_KEY, arena.map);
      // A plane the new arena does not have gives way to its own.
      if (!arena.planes.some(p => p.template === choice)) choice = null;
      theatre.redrawChoices();
      loadModels().then(on => { if (on) theatre.planesChanged(); });
    },
  },
});
wait.hidden = true;
theatre.open(params.get('lesson') || null, { demo: params.get('demo'), fight: params.get('fight') });
// The test hook, as the Range's is `window.__provingGround`.
window.__dogfightSchool = { theatre, arenas, get arena() { return arena.map; }, get plane() { return mine()?.template ?? null; } };
