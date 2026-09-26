// The Instant Battle screen's bot settings, viewer-authored.
//
// The retail left column (CUSTOM/EASY/NORMAL/HARD, OVERALL DIFFICULTY, AI
// SKILLS, PLAYER DEATH TICKET PENALTY, ENEMY VS. FRIENDLY UNITS RATIO and the
// PERFORMANCE block) is switched off — `menu-screen.js` `SHOW_BOT_SETTINGS` —
// because most of it never meant anything here and what did mapped awkwardly
// onto the viewer's own bot model. What the viewer actually takes into a
// battle is two numbers, so the column is now two controls:
//
//   NUMBER OF BOTS      the total across both sides (skirmish.js splits it
//                       between the teams, odd counts leaving the extra body
//                       on the player's side)
//   BOT INTELLIGENCE    the bots' skill, five steps: 0.10 / 0.25 / 0.50 /
//                       0.75 / 1.00. The strategist — which doctrine orders
//                       the bots (`doctrine.js`: the engine's SAI, the
//                       garrison, the squads) — is a separate axis chosen on
//                       the URL today; until it gets a control of its own the
//                       slider carries the caption BF1942 EQUIVALENT.
//
// Drawn with the menu pack's own face and fills so it sits on the screen the
// way the retail sliders did; hit-tested before the layout walk in
// `skirmish.js` (what this module draws is not in `menu-layout.json`, so the
// layout walk cannot see it).

import { drawBitmapText, rgb } from './menu-screen.js';

/** The five intelligence steps, as `map.html`'s `?botSkill=` takes them. */
export const BOT_SKILL_STEPS = [0.10, 0.25, 0.50, 0.75, 1.00];

/** The bot count's ceiling — `map.html` clamps `?botCount=` to the same 32. */
export const MAX_BOTS = 32;

// Geometry, in the menu's 800x600 virtual units. The column takes over the
// retail bot settings' own area under the INSTANT BATTLE tab: the rows ran
// x 31..177, and the troughs reuse the CUSTOM/EASY row rect's width so the
// column keeps the plate's rhythm.
const COL_X = 31;
const COL_W = 146;
const ROW_H = 14;

const COUNT_LABEL_Y = 168;
const COUNT_Y = 188;
const SKILL_LABEL_Y = 222;
const SKILL_Y = 242;
const CAPTION_Y = 264;

const GREEN = [0.4922, 0.5352, 0.2891, 1.0];
const FRAME = [0.5468, 0.5468, 0.5468, 1.0];
const WHITE = [1, 1, 1];
const INK = [0.78, 0.78, 0.78];

/** The trough the bot count is set in. */
export const botCountRect = () => [COL_X, COUNT_Y, COL_W, ROW_H];
/** The trough the intelligence slider is set in. */
export const botSkillRect = () => [COL_X, SKILL_Y, COL_W, ROW_H];

/** Where the pointer is in the bot settings, in virtual units: one of the
 *  two troughs, with the fraction across it (0..1) the click lands at. */
export function hitBotSettings(x, y) {
  if (inTrough(botCountRect(), x, y)) return { kind: 'botCount', frac: frac(botCountRect(), x) };
  if (inTrough(botSkillRect(), x, y)) return { kind: 'botSkill', frac: frac(botSkillRect(), x) };
  return null;
}

const inTrough = (r, x, y) =>
  x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
const frac = (r, x) => Math.min(1, Math.max(0, (x - r[0]) / r[2]));

/** A click fraction to a bot count, in twos: 0, 2, 4 ... 32. */
export function fracToBotCount(f) {
  const steps = MAX_BOTS / 2;
  return 2 * Math.min(steps, Math.max(0, Math.round(f * steps)));
}

/** A click fraction to an intelligence step, quantised to the five stops. */
export function fracToBotSkill(f) {
  return BOT_SKILL_STEPS[Math.min(BOT_SKILL_STEPS.length - 1,
                                  Math.max(0, Math.floor(f * BOT_SKILL_STEPS.length)))];
}

/** The two controls, over the level plate's left column. `env` is the menu
 *  pack's (texture/font/tint); `state` carries `botCount` and `botSkill`. */
export function paintBotSettings(ctx, env, state) {
  const font = env.font('standard6');
  if (!font) return;

  label(ctx, env, font, 'NUMBER OF BOTS:', COUNT_LABEL_Y);
  const count = Math.max(0, Math.min(MAX_BOTS, state.botCount | 0));
  trough(ctx, botCountRect(), count / MAX_BOTS);
  value(ctx, env, font, String(count), botCountRect());

  label(ctx, env, font, 'BOT INTELLIGENCE:', SKILL_LABEL_Y);
  // The nearest of the five stops, so a hand-typed `?botSkill=` still shows.
  const steps = BOT_SKILL_STEPS.length;
  let level = 0;
  for (let i = 1; i < steps; i++) {
    if (Math.abs(BOT_SKILL_STEPS[i] - state.botSkill)
        < Math.abs(BOT_SKILL_STEPS[level] - state.botSkill)) level = i;
  }
  trough(ctx, botSkillRect(), (level + 1) / steps);
  value(ctx, env, font, state.botSkill.toFixed(2), botSkillRect());

  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  drawBitmapText(ctx, font, env.tint, 'BF1942 EQUIVALENT',
                 COL_X + 1, CAPTION_Y, INK);
}

function label(ctx, env, font, text, y) {
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  drawBitmapText(ctx, font, env.tint, text, COL_X + 1, y, WHITE);
}

/** The retail sliders' own look: a grey frame around a black well, the
 *  selection in the box's select green. */
function trough(ctx, r, filled) {
  const [x, y, w, h] = r;
  ctx.globalAlpha = 1;
  ctx.fillStyle = rgb(FRAME);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  if (filled > 0) {
    ctx.fillStyle = rgb(GREEN);
    ctx.fillRect(x + 1, y + 1, Math.round((w - 2) * Math.min(1, filled)), h - 2);
  }
}

function value(ctx, env, font, text, r) {
  const width = measure(font, text);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  drawBitmapText(ctx, font, env.tint, text, r[0] + r[2] - width - 4, r[1] + 2, WHITE);
}

function measure(font, text) {
  let w = 0;
  for (const ch of text) {
    const g = font.meta.glyphs[ch.charCodeAt(0)];
    if (g) w += g[0] + g[1] + g[2];
  }
  return w;
}
