// THE RANGE tab (features/proving-ground): the front end's way into the
// training grounds. What the front end draws behind every tab (`menu/Background`
// and the navigation strip, THE RANGE lit on CREDITS' plate), with the tab's
// own panel laid into the frame where a menu page sits, as REPLAY lays its
// feed.
//
// Two screens in the panel, the way a game's training menu reads:
//
// - **The drills.** LIVE-FIRE RANGE and DOGFIGHT SCHOOL, each a card with the
//   game's own loading-screen art. The school is one page whatever the battle
//   (`dogfight.html`, which keeps its own arena), so its card goes straight
//   there.
// - **Select loadout.** The range is the same empty white floor on every
//   battle; what changes is the arsenal on it. So the battles are offered as
//   loadouts: a grid of their menu thumbnails, each with the two nations and
//   how many land and air vehicles it brings, and a briefing beside it (the
//   battle's loading screen, the side, where to start, the enemy soldiers,
//   the vehicles) with DEPLOY, which opens `map.html?proving=1` on that
//   battle (`proving-ground.js`).
//
// The battles are the Instant Battle list's, for the mod the CUSTOM GAME tab
// picked (`skirmish.js` `levelRows`), and each battle's vehicles are read from
// the models catalogue's `levels` (`models.json`), the mod's tree first.
//
// `?tab=proving` opens on the drills; `&view=loadout`, or a `&battle=<map>`
// (with `&side=<1|2>`), on the loadout screen with that battle picked.

import { createNavStrip } from './nav-strip.js';
import { createMenuPack } from './menu-pack.js';
import { elementVisible, inRect, paintElement, stageScale, toVirtual } from './menu-screen.js';
import { hudPaths as plainHudPaths } from '../hud-pack.js';
import { provingGroundUrl, START_POINTS, vehiclesByLevel } from '../proving-ground.js';

export { provingGroundUrl, vehiclesByLevel };

/** The panel's box in the menu's 800x600, as REPLAY's feed. */
const BOX = [24, 90, 752, 492];
const GUTTER = 8;
/** How many of the enemy's soldiers the range offers. */
export const SOLDIER_STEPS = [0, 4, 8, 16];
/** The loadout last picked, kept in this browser. */
const LOADOUT_KEY = 'bf42.range.loadout';

/** The menu's nation codes (`menu-levels.json`) and the words for them. */
export const NATIONS = Object.freeze({
  ger: 'Germany', brit: 'Britain', us: 'United States', rus: 'Soviet Union', jp: 'Japan',
  can: 'Canada', ita: 'Italy', fra: 'France', pol: 'Poland',
});

/** The art on the drills' cards: the game's own loading screens, vanilla's. */
const DRILL_ART = {
  range: 'maps/_shared/load/desert.webp',
  school: 'maps/battle_of_britain/load.webp',
};

const STYLE = `
.pgm-root { position: fixed; z-index: 20; display: flex; min-width: 0; min-height: 0;
  --pgm-plate: rgba(22, 22, 18, .95); --pgm-deep: rgba(12, 12, 10, .78); --pgm-edge: rgba(200, 194, 152, .28);
  --pgm-edge-hi: rgba(232, 195, 90, .75);
  --pgm-khaki: #a39c6c; --pgm-khaki-ink: #15150e; --pgm-ink: #eeecd9; --pgm-muted: #a9a690; --pgm-faint: #7d7a66;
  --pgm-gold: #e8c35a; --pgm-green: #3ddc8a; --pgm-amber: #e2a33b; --pgm-sky: #7fb2e0;
  font: 13px/1.4 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif; color: var(--pgm-ink); }
.pgm-root[hidden], .pgm-root [hidden] { display: none !important; }
.pgm-root *, .pgm-root *::before, .pgm-root *::after { box-sizing: border-box; }
.pgm-panel { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden;
  background: var(--pgm-plate); border: 1px solid var(--pgm-edge); border-radius: 8px; box-shadow: 0 18px 48px rgba(0,0,0,.55); }

/* The plate's head: where you are, and the way back. */
.pgm-head { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 14px 0 6px; flex: none;
  background: var(--pgm-khaki); color: var(--pgm-khaki-ink); font: 800 12px/1 'Trebuchet MS', 'Segoe UI', sans-serif;
  letter-spacing: .16em; text-transform: uppercase; }
.pgm-head h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 0 8px; font: inherit; white-space: nowrap; min-width: 0; }
.pgm-head h1 .pgm-sep { width: 6px; height: 6px; border-top: 2px solid currentColor; border-right: 2px solid currentColor;
  transform: rotate(45deg); opacity: .55; }
.pgm-head h1 .pgm-here { overflow: hidden; text-overflow: ellipsis; }
.pgm-head .pgm-mod { margin-left: auto; font-weight: 700; letter-spacing: .08em; opacity: .7; }
.pgm-back { appearance: none; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px 0 8px;
  border: 1px solid rgba(21,21,14,.45); border-radius: 4px; background: rgba(21,21,14,.10); color: inherit;
  font: 800 11px/1 'Trebuchet MS', sans-serif; letter-spacing: .14em; text-transform: uppercase; cursor: pointer; }
.pgm-back:hover { background: rgba(21,21,14,.22); }
.pgm-back:focus-visible { outline: 2px solid var(--pgm-khaki-ink); outline-offset: 1px; }
.pgm-back svg { width: 10px; height: 10px; }
.pgm-head .pgm-back + h1 { margin-left: 2px; }

.pgm-view { display: flex; flex: 1 1 auto; min-height: 0; }

/* --- The drills ---------------------------------------------------------------- */
.pgm-modes { flex-direction: column; gap: 12px; padding: 16px; }
.pgm-modes-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.pgm-modes-head h2 { margin: 0; font: 800 22px/1 'Trebuchet MS', sans-serif; letter-spacing: .08em; text-transform: uppercase; }
.pgm-modes-head p { margin: 0; color: var(--pgm-muted); }
.pgm-modes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; flex: 1 1 auto; min-height: 0; }
.pgm-mode { appearance: none; position: relative; display: flex; flex-direction: column; justify-content: flex-end;
  min-height: 0; padding: 0; border: 1px solid var(--pgm-edge); border-radius: 6px; overflow: hidden; isolation: isolate;
  background: #0b0b09; color: var(--pgm-ink); text-align: left; font: inherit; cursor: pointer;
  --accent: var(--pgm-green); transition: border-color .2s ease, box-shadow .2s ease, transform .2s ease; }
.pgm-mode[data-mode="school"] { --accent: var(--pgm-amber); }
.pgm-mode-art { position: absolute; inset: 0; z-index: -2; background: #11110e center / cover no-repeat;
  background-image: var(--art); filter: saturate(.85) contrast(1.05); transform: scale(1.02);
  transition: transform .6s cubic-bezier(.2,.7,.2,1), filter .3s ease; }
.pgm-mode::before { content: ''; position: absolute; inset: 0; z-index: -1;
  background: linear-gradient(180deg, rgba(8,8,6,.15) 0%, rgba(8,8,6,.35) 38%, rgba(8,8,6,.92) 72%, rgba(8,8,6,.97) 100%); }
/* A strip of light that sweeps the card when it is picked out. */
.pgm-mode::after { content: ''; position: absolute; inset: -40% auto -40% -60%; width: 40%; z-index: -1; pointer-events: none;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,.10), transparent); transform: translateX(0) skewX(-12deg); opacity: 0; }
.pgm-mode:hover, .pgm-mode:focus-visible { border-color: var(--accent); outline: none;
  box-shadow: 0 0 0 1px var(--accent), 0 14px 36px rgba(0,0,0,.55), 0 0 28px color-mix(in srgb, var(--accent) 22%, transparent); }
.pgm-mode:hover .pgm-mode-art, .pgm-mode:focus-visible .pgm-mode-art { transform: scale(1.07); filter: saturate(1) contrast(1.08); }
.pgm-mode:hover::after, .pgm-mode:focus-visible::after { animation: pgm-sweep 1.1s ease-out 1; }
@keyframes pgm-sweep { 0% { opacity: 0; transform: translateX(0) skewX(-12deg); } 20% { opacity: 1; }
  100% { opacity: 0; transform: translateX(420%) skewX(-12deg); } }
.pgm-mode-no { position: absolute; top: 12px; left: 14px; display: flex; align-items: center; gap: 8px;
  font: 800 11px/1 'Courier New', monospace; letter-spacing: .2em; color: var(--accent); text-shadow: 0 1px 2px #000; }
.pgm-mode-no::after { content: ''; width: 26px; height: 1px; background: currentColor; opacity: .7; }
/* Corner brackets, a gunsight's frame. */
.pgm-mode-frame { position: absolute; inset: 8px; pointer-events: none; opacity: .55; transition: opacity .2s ease, inset .3s ease;
  background:
    linear-gradient(var(--accent), var(--accent)) top left / 14px 1px no-repeat,
    linear-gradient(var(--accent), var(--accent)) top left / 1px 14px no-repeat,
    linear-gradient(var(--accent), var(--accent)) top right / 14px 1px no-repeat,
    linear-gradient(var(--accent), var(--accent)) top right / 1px 14px no-repeat,
    linear-gradient(var(--accent), var(--accent)) bottom left / 14px 1px no-repeat,
    linear-gradient(var(--accent), var(--accent)) bottom left / 1px 14px no-repeat,
    linear-gradient(var(--accent), var(--accent)) bottom right / 14px 1px no-repeat,
    linear-gradient(var(--accent), var(--accent)) bottom right / 1px 14px no-repeat; }
.pgm-mode:hover .pgm-mode-frame, .pgm-mode:focus-visible .pgm-mode-frame { opacity: 1; inset: 5px; }
.pgm-mode-body { display: flex; flex-direction: column; gap: 8px; padding: 40px 20px 18px; }
.pgm-mode-kicker { color: var(--accent); font: 800 10px/1 'Trebuchet MS', sans-serif; letter-spacing: .22em; text-transform: uppercase; }
.pgm-mode-title { font: 800 26px/1 'Trebuchet MS', sans-serif; letter-spacing: .06em; text-transform: uppercase;
  text-shadow: 0 2px 10px rgba(0,0,0,.8); }
.pgm-mode-text { color: #d3d0bb; max-width: 46ch; text-shadow: 0 1px 4px rgba(0,0,0,.9); }
.pgm-mode-facts { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 0; padding: 0; list-style: none; }
.pgm-mode-facts li { padding: 3px 7px; border: 1px solid rgba(238,236,217,.22); border-radius: 3px; background: rgba(0,0,0,.35);
  color: var(--pgm-muted); font: 700 10px/1.2 'Trebuchet MS', sans-serif; letter-spacing: .1em; text-transform: uppercase; }
.pgm-mode-cta { display: inline-flex; align-items: center; align-self: flex-start; gap: 10px; margin-top: 6px; height: 34px; padding: 0 16px;
  border: 1px solid var(--accent); border-radius: 4px; background: color-mix(in srgb, var(--accent) 16%, rgba(0,0,0,.4));
  color: #fff; font: 800 11px/1 'Trebuchet MS', sans-serif; letter-spacing: .2em; text-transform: uppercase;
  transition: background-color .2s ease, gap .2s ease; }
.pgm-mode:hover .pgm-mode-cta, .pgm-mode:focus-visible .pgm-mode-cta { background: color-mix(in srgb, var(--accent) 34%, rgba(0,0,0,.4)); gap: 14px; }
.pgm-mode-cta svg { width: 10px; height: 10px; }

/* --- Select loadout ------------------------------------------------------------ */
.pgm-loadout { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(250px, 1fr); }
.pgm-pick { display: flex; flex-direction: column; min-height: 0; min-width: 0; border-right: 1px solid var(--pgm-edge); background: var(--pgm-deep); }
.pgm-pick-bar { display: flex; align-items: center; gap: 10px; padding: 10px; flex: none; }
.pgm-search { flex: 1 1 auto; min-width: 0; height: 30px; padding: 0 10px; border: 1px solid var(--pgm-edge); border-radius: 5px;
  background: rgba(0,0,0,.35); color: var(--pgm-ink); font: inherit; }
.pgm-search:focus-visible { outline: 1px solid var(--pgm-gold); outline-offset: 1px; }
.pgm-count { color: var(--pgm-faint); font: 700 10px/1 'Trebuchet MS', sans-serif; letter-spacing: .16em; text-transform: uppercase; white-space: nowrap; }
.pgm-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); align-content: start; gap: 8px;
  list-style: none; margin: 0; padding: 0 10px 12px; overflow: auto; flex: 1 1 auto; min-height: 0;
  scrollbar-width: thin; scrollbar-color: rgba(200,194,152,.38) transparent; }
.pgm-cards li { min-width: 0; }
.pgm-empty { grid-column: 1 / -1; padding: 18px 4px; color: var(--pgm-faint); }
.pgm-card { appearance: none; position: relative; display: flex; flex-direction: column; width: 100%; padding: 0; border: 1px solid var(--pgm-edge);
  border-radius: 5px; overflow: hidden; background: #10100d; color: var(--pgm-ink); text-align: left; font: inherit; cursor: pointer;
  transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease; }
.pgm-card:hover { border-color: rgba(238,236,217,.55); transform: translateY(-1px); }
.pgm-card:focus-visible { outline: 1px solid var(--pgm-gold); outline-offset: 1px; }
.pgm-card[aria-selected="true"] { border-color: var(--pgm-green); animation: pgm-picked 2.4s ease-in-out infinite; }
@keyframes pgm-picked { 0%, 100% { box-shadow: 0 0 0 1px var(--pgm-green), 0 0 10px rgba(61,220,138,.18); }
  50% { box-shadow: 0 0 0 1px var(--pgm-green), 0 0 20px rgba(61,220,138,.38); } }
.pgm-card-art { position: relative; display: block; aspect-ratio: 4 / 3; overflow: hidden; background: linear-gradient(135deg, #24231c, #121210); }
.pgm-card-art img { position: relative; z-index: 1; width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .4s ease, filter .3s ease;
  filter: saturate(.8) brightness(.88); }
.pgm-card:hover .pgm-card-art img, .pgm-card[aria-selected="true"] .pgm-card-art img { transform: scale(1.06); filter: saturate(1) brightness(1); }
.pgm-card-art::after { content: ''; position: absolute; inset: 0; z-index: 2; background: linear-gradient(180deg, transparent 55%, rgba(0,0,0,.7)); }
.pgm-card-art .pgm-noart { position: absolute; inset: 0; display: grid; place-items: center; color: var(--pgm-faint);
  font: 800 22px/1 'Trebuchet MS', sans-serif; letter-spacing: .1em; }
.pgm-card-tick { position: absolute; top: 6px; right: 6px; z-index: 3; display: grid; place-items: center; width: 18px; height: 18px;
  border-radius: 50%; background: var(--pgm-green); color: #06150d; opacity: 0; transform: scale(.6); transition: opacity .15s ease, transform .15s ease; }
.pgm-card-tick svg { width: 10px; height: 10px; }
.pgm-card[aria-selected="true"] .pgm-card-tick { opacity: 1; transform: scale(1); }
.pgm-card-nats { position: absolute; left: 6px; bottom: 6px; z-index: 3; display: flex; align-items: center; gap: 4px;
  font: 800 9px/1 'Trebuchet MS', sans-serif; letter-spacing: .1em; color: var(--pgm-muted); }
.pgm-nat { display: inline-block; padding: 2px 4px; border: 1px solid rgba(238,236,217,.35); border-radius: 2px; background: rgba(0,0,0,.55);
  color: var(--pgm-ink); font: 800 9px/1 'Trebuchet MS', sans-serif; letter-spacing: .08em; text-transform: uppercase; }
.pgm-nat[data-side="axis"] { border-color: rgba(214, 120, 96, .65); }
.pgm-nat[data-side="allied"] { border-color: rgba(127, 178, 224, .65); }
.pgm-card-text { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px 7px; }
.pgm-card-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; min-height: 2.4em;
  font: 800 11px/1.2 'Trebuchet MS', sans-serif; letter-spacing: .05em; text-transform: uppercase; overflow-wrap: anywhere; }
.pgm-tally { display: flex; gap: 10px; min-height: 12px; color: var(--pgm-faint); font: 700 10px/1 'Trebuchet MS', sans-serif; letter-spacing: .06em; }
.pgm-tally span { display: inline-flex; align-items: center; gap: 4px; }
.pgm-tally svg { width: 14px; height: 10px; fill: currentColor; }
.pgm-tally [data-cls="air"] { color: var(--pgm-sky); }

.pgm-brief { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.pgm-hero { position: relative; flex: none; height: 136px; overflow: hidden; background: #0d0d0b; border-bottom: 1px solid var(--pgm-edge); }
.pgm-hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 40%;
  animation: pgm-hero-in .5s ease-out both; }
@keyframes pgm-hero-in { from { opacity: 0; transform: scale(1.06); } to { opacity: 1; transform: scale(1); } }
.pgm-hero::after { content: ''; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(10,10,8,.05) 20%, rgba(10,10,8,.88) 100%),
              repeating-linear-gradient(0deg, rgba(0,0,0,.12) 0 1px, transparent 1px 3px); }
.pgm-hero-text { position: absolute; left: 14px; right: 14px; bottom: 10px; z-index: 1; display: flex; flex-direction: column; gap: 5px; }
.pgm-hero-kicker { color: var(--pgm-green); font: 800 10px/1 'Trebuchet MS', sans-serif; letter-spacing: .22em; text-transform: uppercase; }
.pgm-battle { margin: 0; font: 800 20px/1.05 'Trebuchet MS', sans-serif; letter-spacing: .06em; text-transform: uppercase;
  text-shadow: 0 2px 8px rgba(0,0,0,.85); }
.pgm-sides { display: flex; align-items: center; gap: 6px; color: var(--pgm-muted); font: 700 10px/1 'Trebuchet MS', sans-serif;
  letter-spacing: .12em; text-transform: uppercase; }
.pgm-brief-body { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px; overflow: auto; flex: 1 1 auto; min-height: 0;
  scrollbar-width: thin; scrollbar-color: rgba(200,194,152,.38) transparent; }
.pgm-lede { margin: 0; color: var(--pgm-muted); font-size: 12px; }
.pgm-field { display: flex; flex-direction: column; gap: 6px; }
.pgm-label { color: var(--pgm-faint); font: 700 10px/1.2 'Trebuchet MS', sans-serif; letter-spacing: .16em; text-transform: uppercase; }
.pgm-label small { font: inherit; letter-spacing: .04em; text-transform: none; opacity: .85; }
.pgm-seg { display: inline-flex; flex-wrap: wrap; align-self: flex-start; border: 1px solid var(--pgm-edge); border-radius: 6px; overflow: hidden; }
.pgm-seg button { appearance: none; min-height: 28px; min-width: 52px; padding: 4px 12px; border: 0; background: transparent;
  color: var(--pgm-muted); font: 700 11px/1.15 'Trebuchet MS', sans-serif; letter-spacing: .1em; text-transform: uppercase; cursor: pointer; }
.pgm-seg button + button { border-left: 1px solid var(--pgm-edge); }
.pgm-seg button:hover { color: var(--pgm-ink); background: rgba(255,255,255,.06); }
.pgm-seg button[aria-pressed="true"] { background: var(--pgm-khaki); color: var(--pgm-khaki-ink); }
.pgm-seg button small { display: block; margin-top: 2px; font: 700 9px/1 'Trebuchet MS', sans-serif; letter-spacing: .08em; opacity: .75; }
.pgm-seg button:focus-visible, .pgm-enter:focus-visible { outline: 1px solid var(--pgm-gold); outline-offset: 1px; }
.pgm-vehicles { display: flex; flex-wrap: wrap; gap: 5px; margin: 0; padding: 0; list-style: none; }
.pgm-vehicles li { padding: 3px 8px; border: 1px solid var(--pgm-edge); border-radius: 4px; color: var(--pgm-ink);
  font: 700 11px/1.2 'Trebuchet MS', sans-serif; letter-spacing: .04em; }
.pgm-vehicles li[data-cls="air"] { border-color: rgba(127, 178, 224, .55); }
.pgm-vehicles li[data-cls="sea"] { opacity: .5; text-decoration: line-through; }
.pgm-note { color: var(--pgm-faint); font-size: 12px; }
.pgm-keys { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0; color: var(--pgm-muted); font-size: 12px; }
.pgm-keys kbd { justify-self: start; min-width: 18px; padding: 1px 5px; border: 1px solid var(--pgm-green); border-radius: 3px;
  color: #d9ffec; font: 700 11px/1.3 'Courier New', monospace; text-align: center; }
.pgm-deploy { display: flex; align-items: center; gap: 12px; padding: 10px 14px; flex: none; border-top: 1px solid var(--pgm-edge);
  background: rgba(0,0,0,.25); }
.pgm-deploy-what { min-width: 0; color: var(--pgm-faint); font: 700 10px/1.3 'Trebuchet MS', sans-serif; letter-spacing: .12em; text-transform: uppercase; }
.pgm-deploy-what b { display: block; color: var(--pgm-ink); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pgm-enter { appearance: none; display: inline-flex; align-items: center; gap: 10px; flex: none; margin-left: auto; height: 38px; padding: 0 22px;
  border: 1px solid var(--pgm-green); border-radius: 5px; background: rgba(61,220,138,.16); color: #d9ffec;
  font: 800 12px/1 'Trebuchet MS', sans-serif; letter-spacing: .2em; text-transform: uppercase; cursor: pointer;
  transition: background-color .15s ease, box-shadow .15s ease; }
.pgm-enter:hover { background: rgba(61,220,138,.28); box-shadow: 0 0 0 3px rgba(61,220,138,.14); }
.pgm-enter:disabled { opacity: .45; cursor: default; box-shadow: none; }
.pgm-enter svg { width: 12px; height: 12px; }

/* --- The key hints along the foot, as a console game prints them. --------------- */
.pgm-hints { display: flex; align-items: center; gap: 16px; flex: none; min-height: 28px; padding: 0 14px; overflow: hidden;
  border-top: 1px solid var(--pgm-edge); background: rgba(0,0,0,.35); color: var(--pgm-faint);
  font: 700 10px/1 'Trebuchet MS', sans-serif; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
.pgm-hints span { display: inline-flex; align-items: center; gap: 6px; }
.pgm-hints kbd { min-width: 16px; padding: 2px 4px; border: 1px solid rgba(238,236,217,.35); border-radius: 3px; color: var(--pgm-ink);
  font: 700 10px/1 'Courier New', monospace; text-align: center; }

@media (max-width: 640px) {
  .pgm-modes { padding: 10px; gap: 10px; overflow: auto; }
  .pgm-modes-grid { grid-template-columns: 1fr; grid-auto-rows: minmax(220px, 1fr); flex: none; }
  .pgm-mode-title { font-size: 22px; }
  .pgm-loadout { grid-template-columns: 1fr; grid-template-rows: minmax(180px, 44%) minmax(0, 1fr); }
  .pgm-pick { border-right: 0; border-bottom: 1px solid var(--pgm-edge); }
  .pgm-cards { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); }
  .pgm-hero { height: 96px; }
  .pgm-hints { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .pgm-root *, .pgm-root *::before, .pgm-root *::after { animation: none !important; transition: none !important; }
}
`;

const DEPLOY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l10 6-10 6z" fill="currentColor"/></svg>';
const CHEVRON = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const BACK = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M7 1L3 5l4 4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const TICK = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 5.2l2.2 2.2L8.5 2.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
/** A tank and a plane in profile, for a loadout's tally. */
const LAND_ICON = '<svg viewBox="0 0 14 10" aria-hidden="true"><path d="M4 2h4v2h5v1H8v1h4.5a1.5 1.5 0 010 3h-11a1.5 1.5 0 010-3H3V4h1z"/></svg>';
const AIR_ICON = '<svg viewBox="0 0 14 10" aria-hidden="true"><path d="M0 4.3h5L7.3 0h1.2L7.6 4.3h3.6L12.6 2.6h1L13 5l.6 2.4h-1L11.2 5.7H7.6L8.5 10H7.3L5 5.7H0z"/></svg>';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nationName = code => NATIONS[code] ?? (code ? code.toUpperCase() : '');
const store = {
  get() { try { return localStorage.getItem(LOADOUT_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(LOADOUT_KEY, v); } catch { /* private mode */ } },
};

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {string} [options.root]
 * @param {Array} [options.tabs]
 * @param {(id: string) => void} [options.onTab]
 * @param {() => Array<{map: string, title: string, thumbnail?: string, backdrop?: string,
 *   nations?: {axis: string, allied: string}}>} options.levels  the battles
 * @param {() => {id: string, vanilla: boolean, models: string}} options.mod  the active mod
 * @param {(url: string) => void} [options.onStart]
 */
export function createProvingGroundScreen({
  canvas, root = '../', tabs = null, onTab = () => {}, levels = () => [], mod = () => null,
  onStart = url => location.assign(url),
} = {}) {
  const params = new URLSearchParams(location.search);
  const bust = () => (params.has('nocache') ? `?t=${Date.now()}` : '');
  const hudPaths = plainHudPaths('bf1942', null, { root });
  const packUrl = rel => hudPaths.menuUrl(rel);
  const ctx = canvas.getContext('2d');
  let layout = null;
  let strip = null;
  let hover = null;
  const pack = createMenuPack({ url: packUrl, bust, onImage: () => paintSoon(), env: { get hover() { return hover; } } });

  const state = { view: 'modes', map: null, team: 1, soldiers: 4, filter: '', spawn: 'FiringLine' };
  const catalogues = new Map();   // models base -> Promise<Map>
  /** map (lowercased) -> the vehicles the loadout brings, once read. */
  let arsenal = null;

  // --- the panel ----------------------------------------------------------------
  if (!document.getElementById('pgm-style')) {
    const style = document.createElement('style');
    style.id = 'pgm-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  const art = rel => `url("${new URL(`${root}${rel}`, location.href).href}")`;
  const rootEl = document.createElement('section');
  rootEl.className = 'pgm-root';
  rootEl.hidden = true;
  rootEl.setAttribute('aria-label', 'The Range');
  rootEl.innerHTML = `
    <div class="pgm-panel">
      <div class="pgm-head">
        <button type="button" class="pgm-back" hidden>${BACK}<span>Back</span></button>
        <h1><span class="pgm-root-name">The Range</span><span class="pgm-sep" hidden></span><span class="pgm-here" hidden>Select loadout</span></h1>
        <span class="pgm-mod"></span>
      </div>

      <div class="pgm-view pgm-modes" data-view="modes">
        <div class="pgm-modes-head">
          <h2>Training grounds</h2>
          <p>Pick a drill. No tickets, no scoreboard: just you and the weapons.</p>
        </div>
        <div class="pgm-modes-grid">
          <button type="button" class="pgm-mode" data-mode="range">
            <span class="pgm-mode-art" style='--art: ${art(DRILL_ART.range)}'></span>
            <span class="pgm-mode-frame"></span>
            <span class="pgm-mode-no">01</span>
            <span class="pgm-mode-body">
              <span class="pgm-mode-kicker">Weapons and vehicles</span>
              <span class="pgm-mode-title">Live-fire range</span>
              <span class="pgm-mode-text">An empty white floor stocked with one battle's arsenal. Every kit on both sides,
                every vehicle it fields, targets at 100 and 250 metres, and a hit log that says what each round did.</span>
              <ul class="pgm-mode-facts" role="list"><li>Pick a loadout</li><li>Both sides' kits</li><li>Ballistics drawn</li></ul>
              <span class="pgm-mode-cta">Choose loadout ${CHEVRON}</span>
            </span>
          </button>
          <button type="button" class="pgm-mode" data-mode="school">
            <span class="pgm-mode-art" style='--art: ${art(DRILL_ART.school)}'></span>
            <span class="pgm-mode-frame"></span>
            <span class="pgm-mode-no">02</span>
            <span class="pgm-mode-body">
              <span class="pgm-mode-kicker">Air combat</span>
              <span class="pgm-mode-title">Dogfight school</span>
              <span class="pgm-mode-text">Improve your dogfighting by learning from other players.</span>
              <ul class="pgm-mode-facts" role="list"><li>Six lessons</li><li>Ring courses</li><li>Bot ace</li></ul>
              <span class="pgm-mode-cta">Report for training ${CHEVRON}</span>
            </span>
          </button>
        </div>
      </div>

      <div class="pgm-view pgm-loadout" data-view="loadout" hidden>
        <div class="pgm-pick">
          <div class="pgm-pick-bar">
            <input class="pgm-search" type="search" placeholder="Find a battle" aria-label="Find a battle">
            <span class="pgm-count"></span>
          </div>
          <ul class="pgm-cards" role="listbox" aria-label="Loadouts"></ul>
        </div>
        <div class="pgm-brief">
          <div class="pgm-hero">
            <img alt="" decoding="async" hidden>
            <div class="pgm-hero-text">
              <span class="pgm-hero-kicker">Loadout</span>
              <h2 class="pgm-battle"></h2>
              <span class="pgm-sides"></span>
            </div>
          </div>
          <div class="pgm-brief-body">
            <p class="pgm-lede">Every kit and vehicle this battle hands out, on the range's floor. Press B on the range for
              the arsenal: a faction, then a kit, and it is in your hands; pick a vehicle and you are in its seat.</p>
            <div class="pgm-field"><span class="pgm-label">Your side</span>
              <div class="pgm-seg" data-field="team"><button type="button" data-v="1">Axis<small data-nat="axis"></small></button><button type="button" data-v="2">Allied<small data-nat="allied"></small></button></div></div>
            <div class="pgm-field"><span class="pgm-label">Start at <small>(M on the range to move)</small></span>
              <div class="pgm-seg" data-field="spawn">${START_POINTS.map(p => `<button type="button" data-v="${p.id}">${p.label}</button>`).join('')}</div></div>
            <div class="pgm-field"><span class="pgm-label">Enemy soldiers down range <small>(they move and shoot, and cannot hurt you)</small></span>
              <div class="pgm-seg" data-field="soldiers">${SOLDIER_STEPS.map(n => `<button type="button" data-v="${n}">${n || 'None'}</button>`).join('')}</div></div>
            <div class="pgm-field"><span class="pgm-label">Vehicles on the floor</span>
              <ul class="pgm-vehicles" role="list"></ul><span class="pgm-note" hidden></span></div>
            <div class="pgm-field"><span class="pgm-label">On the range</span>
              <dl class="pgm-keys">
                <kbd>B</kbd><span>the arsenal: a faction, a kit, a vehicle</span>
                <kbd>H</kbd><span>the collision mesh, coloured by how many hits of your weapon each part takes</span>
                <kbd>U</kbd><span>mark where your next round lands</span>
                <kbd>J</kbd><span>clear the paths and the hit log</span>
                <kbd>V</kbd><span>the dogfight school</span>
              </dl></div>
          </div>
          <div class="pgm-deploy">
            <span class="pgm-deploy-what">Loadout<b class="pgm-deploy-name"></b></span>
            <button type="button" class="pgm-enter">${DEPLOY_ICON}<span>Deploy</span></button>
          </div>
        </div>
      </div>

      <div class="pgm-hints" aria-hidden="true"></div>
    </div>`;
  document.body.appendChild(rootEl);
  const $ = sel => rootEl.querySelector(sel);
  const ui = {
    mod: $('.pgm-mod'), back: $('.pgm-back'), sep: $('.pgm-sep'), here: $('.pgm-here'),
    modes: $('.pgm-modes'), loadout: $('.pgm-loadout'), hints: $('.pgm-hints'),
    search: $('.pgm-search'), count: $('.pgm-count'), cards: $('.pgm-cards'),
    hero: $('.pgm-hero img'), battle: $('.pgm-battle'), sides: $('.pgm-sides'),
    vehicles: $('.pgm-vehicles'), note: $('.pgm-note'), enter: $('.pgm-enter'), deployName: $('.pgm-deploy-name'),
  };

  const HINTS = {
    modes: [['← →', 'Choose drill'], ['Enter', 'Select']],
    loadout: [['← ↑ → ↓', 'Choose loadout'], ['Enter', 'Deploy'], ['Esc', 'Back']],
  };

  // --- the views ------------------------------------------------------------------

  /** The address follows the panel, so a reload comes back to the same screen. */
  function address() {
    if (rootEl.hidden) return;
    const url = new URL(location.href);
    if (state.view === 'loadout') {
      url.searchParams.set('view', 'loadout');
      if (state.map) url.searchParams.set('battle', state.map);
      url.searchParams.set('side', String(state.team));
    } else {
      for (const key of ['view', 'battle', 'side']) url.searchParams.delete(key);
    }
    if (url.href !== location.href) history.replaceState(history.state, '', url);
  }

  function setView(view, { focus = true } = {}) {
    state.view = view === 'loadout' ? 'loadout' : 'modes';
    const loadout = state.view === 'loadout';
    ui.modes.hidden = loadout;
    ui.loadout.hidden = !loadout;
    ui.back.hidden = !loadout;
    ui.sep.hidden = !loadout;
    ui.here.hidden = !loadout;
    ui.hints.innerHTML = HINTS[state.view]
      .map(([k, label]) => `<span><kbd>${esc(k)}</kbd>${esc(label)}</span>`).join('');
    if (loadout) renderList();
    address();
    if (focus) focusView();
  }

  function focusView() {
    if (state.view === 'loadout') {
      const picked = ui.cards.querySelector('.pgm-card[aria-selected="true"]') ?? ui.cards.querySelector('.pgm-card');
      (picked ?? ui.search).focus({ preventScroll: true });
      picked?.scrollIntoView({ block: 'nearest' });
    } else {
      rootEl.querySelector('.pgm-mode')?.focus({ preventScroll: true });
    }
  }

  function openSchool() {
    // The dogfight school (features/dogfight-school): its own page, the
    // lessons first and no level to load. It keeps its own arena.
    onStart(new URL(`${root}dogfight.html`, location.href).toString());
  }

  // --- select loadout ---------------------------------------------------------------

  function rows() {
    const all = levels() ?? [];
    const f = state.filter.trim().toLowerCase();
    return f ? all.filter(r => r.title.toLowerCase().includes(f) || r.map.toLowerCase().includes(f)) : all;
  }

  const rowOf = map => (levels() ?? []).find(r => r.map === map) ?? null;

  function natBadges(row) {
    const n = row?.nations ?? {};
    if (!n.axis && !n.allied) return '';
    return `<span class="pgm-nat" data-side="axis" title="${esc(nationName(n.axis))}">${esc((n.axis || '?').toUpperCase())}</span>`
      + '<span>v</span>'
      + `<span class="pgm-nat" data-side="allied" title="${esc(nationName(n.allied))}">${esc((n.allied || '?').toUpperCase())}</span>`;
  }

  function tallyHtml(map) {
    const list = arsenal?.get(map.toLowerCase());
    if (!list) return '';
    const land = list.filter(v => v.cls !== 'air' && v.cls !== 'sea').length;
    const air = list.filter(v => v.cls === 'air').length;
    return `<span data-cls="land" title="${land} land vehicles">${LAND_ICON}${land}</span>`
      + `<span data-cls="air" title="${air} aircraft">${AIR_ICON}${air}</span>`;
  }

  function renderList() {
    const all = levels() ?? [];
    if (!state.map || !all.some(r => r.map === state.map)) {
      const kept = store.get();
      state.map = all.find(r => r.map === kept)?.map ?? all[0]?.map ?? null;
    }
    const list = rows();
    ui.count.textContent = `${list.length} ${list.length === 1 ? 'loadout' : 'loadouts'}`;
    ui.cards.innerHTML = list.length ? list.map(row => {
      const picture = row.thumbnail || row.backdrop;
      const fallback = row.thumbnail && row.backdrop ? row.backdrop : '';
      const initials = row.title.split(/\s+/).filter(w => /^[a-z]/i.test(w) && !/^(of|the|on|at|in|and)$/i.test(w))
        .slice(0, 2).map(w => w[0].toUpperCase()).join('');
      return `<li><button type="button" class="pgm-card" role="option" data-map="${esc(row.map)}"
          aria-selected="${row.map === state.map}" aria-label="${esc(row.title)}">
        <span class="pgm-card-art">
          ${picture ? `<img src="${esc(picture)}" data-fallback="${esc(fallback)}" alt="" loading="lazy" decoding="async">` : ''}
          <span class="pgm-noart">${esc(initials)}</span>
          <span class="pgm-card-tick">${TICK}</span>
          <span class="pgm-card-nats">${natBadges(row)}</span>
        </span>
        <span class="pgm-card-text">
          <span class="pgm-card-title" title="${esc(row.title)}">${esc(row.title)}</span>
          <span class="pgm-tally">${tallyHtml(row.map)}</span>
        </span>
      </button></li>`;
    }).join('') : '<li class="pgm-empty">No battle by that name.</li>';
    // A thumbnail that will not load gives way to the loading screen, and
    // that to the card's own plate (the battle's initials, under the picture).
    for (const img of ui.cards.querySelectorAll('.pgm-card-art img')) {
      img.addEventListener('error', () => {
        const next = img.dataset.fallback;
        if (next) { img.dataset.fallback = ''; img.src = next; } else img.remove();
      });
    }
    renderDetail();
  }

  function renderTallies() {
    for (const card of ui.cards.querySelectorAll('.pgm-card')) {
      const tally = card.querySelector('.pgm-tally');
      if (tally && !tally.childElementCount) tally.innerHTML = tallyHtml(card.dataset.map);
    }
  }

  function pick(map, { focus = false } = {}) {
    if (!map || !rowOf(map)) return;
    state.map = map;
    store.set(map);
    for (const card of ui.cards.querySelectorAll('.pgm-card')) {
      const on = card.dataset.map === map;
      card.setAttribute('aria-selected', String(on));
      if (on && focus) { card.focus({ preventScroll: true }); card.scrollIntoView({ block: 'nearest' }); }
    }
    renderDetail();
    address();
  }

  async function catalogue(base) {
    if (!catalogues.has(base)) {
      catalogues.set(base, fetch(`${root}${base}/models.json${bust()}`)
        .then(r => (r.ok ? r.json() : []))
        .then(vehiclesByLevel)
        .catch(() => new Map()));
    }
    return catalogues.get(base);
  }

  /** Every battle's vehicles, the mod's tree first, named once. */
  async function readArsenal() {
    const info = mod();
    const bases = [...new Set([info?.models || 'models', 'models'])];
    const out = new Map();
    for (const base of bases) {
      for (const [map, list] of await catalogue(base)) {
        const have = out.get(map) ?? [];
        for (const v of list) if (!have.some(f => f.name.toLowerCase() === v.name.toLowerCase())) have.push(v);
        out.set(map, have);
      }
    }
    for (const list of out.values()) list.sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name));
    return out;
  }

  let arsenalFor = null;
  async function loadArsenal() {
    const key = mod()?.models || 'models';
    if (arsenalFor === key && arsenal) return arsenal;
    arsenalFor = key;
    const read = await readArsenal();
    if (arsenalFor !== key) return read;
    arsenal = read;
    renderTallies();
    renderDetail();
    return arsenal;
  }

  function renderDetail() {
    const row = rowOf(state.map);
    ui.battle.textContent = row ? row.title : 'No battles in this game yet';
    ui.deployName.textContent = row ? row.title : '';
    ui.sides.innerHTML = row?.nations?.axis || row?.nations?.allied
      ? `${esc(nationName(row.nations.axis) || 'Axis')}<span>v</span>${esc(nationName(row.nations.allied) || 'Allies')}` : '';
    const picture = row?.backdrop || row?.thumbnail || null;
    if (picture && ui.hero.getAttribute('src') !== picture) {
      ui.hero.hidden = false;
      // A fresh element, so the picture fades in again for each loadout.
      const img = ui.hero.cloneNode();
      img.src = picture;
      img.onerror = () => { img.hidden = true; };
      ui.hero.replaceWith(img);
      ui.hero = img;
    } else if (!picture) {
      ui.hero.hidden = true;
      ui.hero.removeAttribute('src');
    }
    ui.enter.disabled = !row;
    for (const nat of rootEl.querySelectorAll('[data-nat]')) nat.textContent = nationName(row?.nations?.[nat.dataset.nat]);
    for (const seg of rootEl.querySelectorAll('.pgm-seg')) {
      const value = String(state[seg.dataset.field]);
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === value));
    }
    const info = mod();
    ui.mod.textContent = info && !info.vanilla ? info.id : '';
    ui.vehicles.innerHTML = '';
    ui.note.hidden = true;
    if (!row) return;
    const found = arsenal?.get(row.map.toLowerCase()) ?? [];
    for (const v of found) {
      const li = document.createElement('li');
      li.textContent = v.name.replace(/_/g, ' ');
      li.dataset.cls = v.cls;
      if (v.cls === 'sea') li.title = 'No water on the Range: ships stay in harbour';
      ui.vehicles.appendChild(li);
    }
    if (!arsenal) {
      ui.note.hidden = false;
      ui.note.textContent = 'Reading the arsenal…';
    } else if (!found.length) {
      ui.note.hidden = false;
      ui.note.textContent = 'The battle names its vehicles when you arrive.';
    } else if (found.some(v => v.cls === 'sea')) {
      ui.note.hidden = false;
      ui.note.textContent = 'Ships are left out: the floor has no water.';
    }
  }

  /** The card next to `card` the arrow points at, by where the cards sit. */
  function neighbour(card, key) {
    const cards = [...ui.cards.querySelectorAll('.pgm-card')];
    const i = cards.indexOf(card);
    if (i < 0) return cards[0] ?? null;
    if (key === 'ArrowLeft') return cards[i - 1] ?? null;
    if (key === 'ArrowRight') return cards[i + 1] ?? null;
    // Cards in a row share the first card's top.
    const step = Math.max(1, cards.filter(c => c.offsetTop === cards[0].offsetTop).length);
    if (key === 'ArrowDown') return cards[Math.min(cards.length - 1, i + step)] ?? null;
    if (key === 'ArrowUp') return i - step >= 0 ? cards[i - step] : null;
    return null;
  }

  /**
   * Straight into the construct from the CONTROLS preview (`controls-screen.js`
   * `onTryIt`), for its tab: the battle that fields the machine the preview
   * showed (`controls-preview.js`: a Spitfire on AIR, a Sherman on LAND &
   * SEA), else the one fielding the most of that kind, else the battle this
   * tab has picked. The preview's machines are the Allies'.
   */
  async function launchFor(kind, { vehicle = null } = {}) {
    const rowsNow = levels() ?? [];
    if (!rowsNow.length) return null;
    const info = mod();
    // The battle that fields the machine asked for, else the preview's own.
    const want = vehicle ? { name: String(vehicle).toLowerCase(), cls: kind === 'air' ? 'air' : 'land' }
      : kind === 'air' ? { name: 'spitfire', cls: 'air' } : kind === 'landSea' ? { name: 'sherman', cls: 'land' } : null;
    let pickRow = null;
    if (want) {
      const bases = [...new Set([info?.models || 'models', 'models'])];
      const counts = new Map();
      for (const base of bases) {
        const map = await catalogue(base);
        for (const row of rowsNow) {
          const list = map.get(row.map.toLowerCase()) ?? [];
          const has = list.some(v => v.name.toLowerCase() === want.name);
          const n = list.filter(v => v.cls === want.cls).length;
          const prev = counts.get(row.map) ?? { has: false, n: 0 };
          counts.set(row.map, { has: prev.has || has, n: prev.n + n });
        }
      }
      const ranked = rowsNow.map(r => ({ r, ...(counts.get(r.map) ?? { has: false, n: 0 }) }))
        .filter(x => x.n > 0)
        .sort((a, b) => Number(b.has) - Number(a.has) || b.n - a.n);
      pickRow = ranked[0]?.r ?? null;
    }
    const row = pickRow ?? rowsNow.find(r => r.map === state.map) ?? rowsNow[0];
    // In the air there is someone to fight: two enemy pilots at the far end
    // take the enemy's aircraft and fly (they shoot blanks).
    const soldiers = kind === 'air' ? Math.max(2, state.soldiers) : state.soldiers;
    const url = provingGroundUrl(root, { map: row.map, team: 2, soldiers, vehicle, spawn: 'FiringLine',
                                         mod: info && !info.vanilla ? info.id : null });
    onStart(url);
    return url;
  }

  const launchUrl = () => (state.map ? provingGroundUrl(root, {
    map: state.map, team: state.team, soldiers: state.soldiers, spawn: state.spawn,
    mod: mod() && !mod().vanilla ? mod().id : null,
  }) : null);

  function start() {
    const url = launchUrl();
    if (url) onStart(url);
  }

  // --- input --------------------------------------------------------------------------

  rootEl.addEventListener('click', e => {
    const mode = e.target.closest('.pgm-mode');
    if (mode) {
      if (mode.dataset.mode === 'school') openSchool();
      else setView('loadout');
      return;
    }
    if (e.target.closest('.pgm-back')) { setView('modes'); return; }
    const card = e.target.closest('.pgm-card');
    if (card) { pick(card.dataset.map); return; }
    const b = e.target.closest('.pgm-seg button');
    if (b) {
      const field = b.closest('.pgm-seg').dataset.field;
      state[field] = field === 'spawn' ? b.dataset.v : Number(b.dataset.v);
      renderDetail();
      if (field === 'team') address();
    }
  });
  ui.cards.addEventListener('dblclick', e => { if (e.target.closest('.pgm-card')) start(); });
  ui.search.addEventListener('input', () => { state.filter = ui.search.value; renderList(); });
  ui.enter.addEventListener('click', start);

  rootEl.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const inSearch = e.target === ui.search;
    if (state.view === 'modes') {
      const modes = [...rootEl.querySelectorAll('.pgm-mode')];
      const i = modes.indexOf(document.activeElement);
      const vertical = getComputedStyle(ui.modes.querySelector('.pgm-modes-grid')).gridTemplateColumns.split(' ').length === 1;
      const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
      const next = vertical ? 'ArrowDown' : 'ArrowRight';
      if (e.key === prev || e.key === next) {
        modes[(Math.max(0, i) + (e.key === next ? 1 : modes.length - 1)) % modes.length].focus();
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Escape' || (e.key === 'Backspace' && !inSearch)) {
      if (inSearch && ui.search.value) { ui.search.value = ''; state.filter = ''; renderList(); ui.search.focus(); }
      else setView('modes');
      e.preventDefault();
      return;
    }
    if (inSearch) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        const first = ui.cards.querySelector('.pgm-card');
        if (first) { pick(first.dataset.map, { focus: true }); e.preventDefault(); }
      }
      return;
    }
    const card = e.target.closest?.('.pgm-card');
    if (!card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      // The first press picks the loadout, the next one deploys it.
      if (card.dataset.map === state.map && e.key === 'Enter') start();
      else pick(card.dataset.map);
      e.preventDefault();
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const to = neighbour(card, e.key);
    if (to) pick(to.dataset.map, { focus: true });
    else if (e.key === 'ArrowUp') ui.search.focus();
  });

  // --- the menu behind it -------------------------------------------------------
  async function load() {
    layout = await pack.load(await pack.json(packUrl('main-menu-layout.json')));
    if (tabs) strip = createNavStrip({ layout, env: pack.env, rows: tabs, active: 'proving', onPick: onTab });
    paint();
  }

  const stage = () => stageScale(canvas.clientWidth, canvas.clientHeight, layout?.virtual ?? [800, 600]);

  function box() {
    const r = canvas.getBoundingClientRect();
    const s = stage();
    const [x, y, w, h] = BOX;
    const out = { left: r.left + s.ox + x * s.sx, top: r.top + s.oy + y * s.sy, width: w * s.sx, height: h * s.sy };
    if (r.height - (s.oy + 600 * s.sy) > 1) {
      const mute = document.querySelector('.ld-mute-btn')?.getBoundingClientRect();
      if (mute?.height) out.top = Math.max(out.top, mute.bottom + GUTTER);
      out.left = r.left + GUTTER;
      out.width = r.width - 2 * GUTTER;
      out.height = r.bottom - GUTTER - out.top;
    }
    return out;
  }

  function place() {
    const b = box();
    Object.assign(rootEl.style, {
      left: `${Math.round(b.left)}px`, top: `${Math.round(b.top)}px`,
      width: `${Math.round(b.width)}px`, height: `${Math.round(b.height)}px`,
    });
  }

  let pending = false;
  function paintSoon() {
    if (pending || !layout) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; paint(); });
  }

  function paint() {
    if (!layout || canvas.hidden) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const s = stage();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(s.sx * dpr, 0, 0, s.sy * dpr, s.ox * dpr, s.oy * dpr);
    const table = layout.variables || {};
    for (const el of layout.pages?.background?.elements || []) {
      if (elementVisible(el, table)) paintElement(ctx, el, layout, null, pack.env);
    }
    strip?.paint(ctx);
    ctx.globalAlpha = 1;
    place();
  }

  new ResizeObserver(() => paint()).observe(canvas);
  const at = event => {
    const r = canvas.getBoundingClientRect();
    return toVirtual(stageScale(r.width, r.height, layout.virtual), event.clientX - r.left, event.clientY - r.top);
  };
  canvas.addEventListener('pointermove', event => {
    if (!layout) return;
    const [x, y] = at(event);
    const next = strip?.hover(x, y) ?? null;
    const changed = JSON.stringify(next) !== JSON.stringify(hover);
    hover = next;
    canvas.style.cursor = next ? 'pointer' : 'default';
    if (changed) paintSoon();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; paintSoon(); });
  canvas.addEventListener('click', event => {
    if (!layout) return;
    const [x, y] = at(event);
    if (strip?.click(x, y)) return;
    if (!inRect(BOX, x, y)) canvas.focus();
  });

  return {
    load,
    paint,
    /** Up on the drills, unless the address asks for a loadout
     *  (`view=loadout`, or `battle=<map>` with `side=<1|2>`). */
    show(query = new URLSearchParams(location.search)) {
      const all = levels() ?? [];
      const asked = query.get('battle');
      const hit = asked ? all.find(r => r.map.toLowerCase() === asked.toLowerCase()) : null;
      if (hit) state.map = hit.map;
      if (query.get('side') === '2' || query.get('side') === '1') state.team = Number(query.get('side'));
      rootEl.hidden = false;
      paint();
      setView(hit || query.get('view') === 'loadout' ? 'loadout' : 'modes', { focus: false });
      // The front end focuses the tab's canvas once `show` returns
      // (`front-end.js` `reveal`), so the panel takes focus a frame later.
      requestAnimationFrame(() => { if (!rootEl.hidden && !rootEl.contains(document.activeElement)) focusView(); });
      loadArsenal().catch(() => {});
    },
    hide() { rootEl.hidden = true; },
    keydown() { return false; },
    setView,
    start,
    launchFor,
    launchUrl,
    openSchool,
    get state() { return { ...state }; },
    get strip() { return strip; },
  };
}
