// SINGLEPLAY > CAMPAIGN: retail's campaign screen, drawn from the game's own page.
//
// `main-menu-layout.json` (extract_main_menu_layout.py) carries
// `menu/CampaignMenu` and `menu/CampaignNavigation` as flat draw lists, the
// same way it carries MULTIPLAY: the NEW CAMPAIGN / CONTINUE CAMPAIGN tabs,
// the CUSTOM / EASY / NORMAL / HARD column with OVERALL DIFFICULTY and the
// AI SKILLS, PLAYER DEATH TICKET PENALTY and ENEMY VS. FRIENDLY UNITS RATIO
// rows, the PERFORMANCE block, the level preview, LEVELS, TEAM, STATISTICS
// and the START / CONTINUE button. Every plate, string, rect and condition is
// the file's; this module writes the variables the conditions read
// (`Campaign/NewCampaignFlag`, `Campaign/Team`, the difficulty values ...),
// applies what the file's hit nodes set, and draws the parts the engine
// fills at runtime: the two lists' rows, the sliders' fill, the preview.
//
// Departures, each because the page has nothing to honour it with:
//  - PERFORMANCE's NUMBER OF BOTS is a bot count (0..32, Instant Battle's
//    default 4), not retail's percentage of `game.maxNrofPlayers`: a browser
//    does not carry 18 bots. CPU-TIME GIVEN TO AI is not drawn.
//  - The slider rows take a click in CUSTOM and in a preset alike; a click
//    in a preset turns the column to CUSTOM with the preset's values.
//
// The law (score, progression, saving, the launch address) is `campaign.js`.

import { createNavStrip } from './nav-strip.js';
import { createMenuPack } from './menu-pack.js';
import {
  drawBitmapText, elementVisible, fitText, inRect, measureText, paintElement, rgb,
} from './menu-screen.js';
import { beginStage, pointerToVirtual } from './stage.js';
import { fracToBotCount } from './bot-settings.js';
import { hudPaths as plainHudPaths } from '../hud-pack.js';
import * as law from './campaign.js';

/** The labels of the rows this screen draws its own value into, by key. */
const SLIDER_ROWS = Object.freeze({
  SINGLEPLAYER_AI_SKILLS: 'aiSkill',
  SINGLEPLAYER_NR_OF_LIVES: 'lives',
  SINGLEPLAYER_BOT_RATIO: 'ratio',
});
const BOTS_ROW = 'GENERAL_OPTIONS_PERCENTAGE_OF_BOTS';
const CPU_ROW = 'GENERAL_OPTIONS_PERCENTAGE_OF_CPU';

const GREEN = [0.4922, 0.5352, 0.2891, 1.0];
const INK = [0.78, 0.78, 0.78];
const DIM = [0.5, 0.5, 0.5];
const WHITE = [1, 1, 1];

/** A row's elements: everything on the page level with its label (the
 *  label's y, give or take the plate's own offsets), left of the preview. */
function rowBand(elements, label) {
  const y = label.rect[1];
  return elements.filter(el => el !== label && el.rect[0] < 360
    && el.rect[1] >= y - 7 && el.rect[1] < y + 6);
}

/** The pieces of one slider row, read off the page: the trough (the
 *  50-wide fill pair) and the value box (the wider pair). */
export function sliderRows(page) {
  const elements = page?.elements || [];
  const out = {};
  for (const el of elements) {
    if (el.kind !== 'text') continue;
    const field = SLIDER_ROWS[el.key] ?? (el.key === BOTS_ROW ? 'bots' : null);
    if (!field) continue;
    const band = rowBand(elements, el);
    const fills = band.filter(b => b.kind === 'fill').sort((a, b) => a.rect[0] - b.rect[0]);
    if (fills.length < 2) continue;
    out[field] = {
      label: el,
      trough: fills[1].rect,                        // the inner well
      box: fills[fills.length - 1].rect,            // the value box's inner well
      band,
    };
  }
  return out;
}

/** What the page draws, less the parts this screen replaces: the CPU row,
 *  the bot row's percentage edit and its `%`. */
export function drawnElements(page) {
  const elements = page?.elements || [];
  const skip = new Set();
  for (const el of elements) {
    if (el.kind !== 'text') continue;
    if (el.key === CPU_ROW) {
      skip.add(el);
      for (const b of rowBand(elements, el)) skip.add(b);
    } else if (el.key === BOTS_ROW) {
      for (const b of rowBand(elements, el)) {
        if (b.kind === 'edit' || (b.kind === 'text' && b.text === '%')) skip.add(b);
      }
    }
  }
  return elements.filter(el => !skip.has(el));
}

/** A list box by the variable the engine fills it from. */
export function listOf(page, data) {
  return (page?.elements || []).find(el => el.kind === 'listbox' && el.data === data) || null;
}

/** Where a list's rows go: the well its plate art has (`rows`, measured by
 *  the extractor), else the box, stopping at its scroll track. */
export function listArea(page, box) {
  const track = (page?.elements || []).find(el => el.kind === 'fill'
    && el.rect[0] > box.rect[0] && el.rect[0] < box.rect[0] + box.rect[2]
    && el.rect[3] > 40 && el.rect[2] < 20);
  const right = track ? track.rect[0] : box.rect[0] + box.rect[2];
  const top = box.rows?.top ?? box.rect[1];
  const bottom = box.rows?.bottom ?? box.rect[1] + box.rect[3];
  return { x: box.rect[0], y: top, w: right - box.rect[0], h: bottom - top, track };
}

/** The variables the page's conditions read, for a screen state. */
export function campaignVars(layoutVars, { mode, team, saved, difficulty }) {
  return {
    ...(layoutVars || {}),
    'Campaign/NewCampaignFlag': mode === 'new',
    'Campaign/DisableContinueCampaign': !saved,
    'Campaign/FinishedCampaign': !!saved?.finished,
    'Campaign/Team': team,
    'Campaign/CampaignDifficultyLevel': difficulty.level,
    'Campaign/CampaignAiSkill': difficulty.aiSkill,
    'Campaign/CampaignNrOfLives': difficulty.lives,
    'Campaign/CampaignBotRatio': difficulty.ratio,
    'Campaign/CampaignOverallDifficulty': difficulty.overall,
    'Campaign/CampaignCustom': difficulty.level === law.CUSTOM,
  };
}

/** A hit node's `sets`, as the difficulty they choose (null when they do not
 *  choose one). CUSTOM's row sets the level alone and keeps the sliders. */
export function difficultyFromSets(sets, current) {
  const value = name => sets.find(s => s.var === `Campaign/${name}`)?.value;
  const level = value('CampaignDifficultyLevel');
  if (level == null) return null;
  return law.difficultyOf({
    level,
    aiSkill: value('CampaignAiSkill') ?? current.aiSkill,
    lives: value('CampaignNrOfLives') ?? current.lives,
    ratio: value('CampaignBotRatio') ?? current.ratio,
  });
}

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {string} [options.root]
 * @param {URLSearchParams} [options.params]
 * @param {(text: string) => void} [options.onStatus]
 * @param {Array} [options.tabs]  the front end's navigation rows
 * @param {(id: string) => void} [options.onTab]
 * @param {(url: string) => void} [options.onStart]  a mission's address
 * @param {Storage} [options.storage]
 */
export function createCampaignScreen({
  canvas,
  root = '../',
  params = new URLSearchParams(location.search),
  onStatus = () => {},
  tabs = null,
  onTab = () => {},
  onStart = url => { location.href = url; },
  storage = globalThis.localStorage,
} = {}) {
  const qs = params;
  const bust = () => (qs.has('nocache') ? `?t=${Date.now()}` : '');
  // The campaign is vanilla's alone (owner, 2026-11-06): its pack, its
  // levels, whatever game the CUSTOM GAME tab has picked.
  const paths = plainHudPaths('bf1942', null, { root });
  const SCRATCH_PACK = qs.get('pack');
  const packUrl = rel => (SCRATCH_PACK ? `${SCRATCH_PACK}/${rel}` : paths.menuUrl(rel));
  const MAPS = `${root}maps`;
  const ctx = canvas.getContext('2d');

  let nav = null;            // main-menu-layout.json
  let data = null;           // campaign.json
  let levelInfo = new Map(); // dir -> menu-levels.json record
  let entries = new Map();   // dir -> maps.json row
  let strip = null;
  let hover = null;
  let available = false;
  let rows = null;           // sliderRows
  let page = null;
  let elements = [];

  const state = {
    mode: 'new',
    team: law.lastTeam(storage),
    saved: null,
    draft: { difficulty: law.difficultyOf({ level: 3 }), botCount: law.DEFAULT_BOT_COUNT },
    index: 0,
    scroll: 0,
    confirm: null,           // null, or the lexicon key of the warning shown
  };

  const pack = createMenuPack({
    url: packUrl,
    bust,
    onImage: () => paintSoon(),
    env: {
      thumbnail: () => null,
      get hover() { return hover; },
    },
  });
  const { env, json, image, ready } = pack;

  // --- loading -----------------------------------------------------------------

  async function load() {
    const [navLayout, campaign, menuLevels, manifest] = await Promise.all([
      json(packUrl('main-menu-layout.json')),
      json(packUrl('campaign.json')),
      json(packUrl('menu-levels.json')).catch(() => null),
      json(`${MAPS}/maps.json`).catch(() => []),
    ]);
    if (!navLayout?.pages?.campaign) {
      throw new Error('the menu pack has no campaign page');
    }
    if (!Array.isArray(campaign?.order) || !campaign.order.length) {
      throw new Error('campaign.json has no missions');
    }
    nav = navLayout;
    data = campaign;
    page = nav.pages.campaign;
    elements = drawnElements(page);
    rows = sliderRows(page);
    levelInfo = new Map((menuLevels?.levels || []).map(l => [l.dir, l]));
    entries = new Map((manifest || []).map(e => [String(e.name).toLowerCase(), e]));
    pack.use(nav);
    if (tabs) {
      strip = createNavStrip({ layout: nav, env, rows: tabs, active: 'singleplay',
                               onPick: id => onTab(id) });
    }
    await pack.load(nav);
    available = true;
    selectTeam(state.team, { keepMode: false });
    onStatus('');
    paint();
  }

  // --- state -------------------------------------------------------------------

  const difficulty = () => (state.mode === 'continue' && state.saved
    ? state.saved.difficulty : state.draft.difficulty);
  const botCount = () => (state.mode === 'continue' && state.saved
    ? state.saved.botCount : state.draft.botCount);
  const vars = () => campaignVars(nav?.variables, {
    mode: state.mode, team: state.team, saved: state.saved, difficulty: difficulty(),
  });

  /** TEAM: each side has its own campaign (`campaign.js`). A side with one
   *  opens on CONTINUE CAMPAIGN, one without on NEW CAMPAIGN. */
  function selectTeam(team, { keepMode = true } = {}) {
    state.team = team === law.AXIS ? law.AXIS : law.ALLIED;
    law.rememberTeam(state.team, storage);
    state.saved = law.loadCampaign(state.team, storage);
    if (!state.saved) state.mode = 'new';
    else if (!keepMode) state.mode = 'continue';
    state.confirm = null;
    showMission();
    paintSoon();
  }

  /** The list selection on the mission the campaign is on. */
  function showMission() {
    const mission = state.mode === 'continue' && state.saved && !state.saved.finished
      ? state.saved.mission : 1;
    selectRow(mission - 1);
  }

  function setMode(mode) {
    if (mode === 'continue' && !state.saved) return;
    state.mode = mode;
    state.confirm = null;
    showMission();
    paintSoon();
  }

  function setDifficulty(next) {
    if (state.mode === 'continue' && state.saved) {
      state.saved = { ...state.saved, difficulty: next };
      law.saveCampaign(state.saved, storage);
    } else {
      state.draft = { ...state.draft, difficulty: next };
    }
    paintSoon();
  }

  function setBotCount(count) {
    if (state.mode === 'continue' && state.saved) {
      state.saved = { ...state.saved, botCount: count };
      law.saveCampaign(state.saved, storage);
    } else {
      state.draft = { ...state.draft, botCount: count };
    }
    paintSoon();
  }

  /** A slider row's step from a click across its trough or on its box: the
   *  trough by where the click lands, the box steps on. */
  function setSlider(field, x, row) {
    const d = difficulty();
    const [tx, , tw] = row.trough;
    const value = x >= tx && x < tx + tw
      ? Math.min(4, Math.max(1, Math.ceil(((x - tx) / tw) * 4)))
      : (d[field] % 4) + 1;
    setDifficulty(law.difficultyOf({ ...d, level: law.CUSTOM, [field]: value }));
  }

  function selectRow(index) {
    if (!data) return;
    const count = data.order.length;
    state.index = Math.min(count - 1, Math.max(0, index));
    const box = listOf(page, 'Campaign/CampaignLevelsList');
    if (box) {
      const visible = visibleRows(box);
      if (state.index < state.scroll) state.scroll = state.index;
      else if (state.index >= state.scroll + visible) state.scroll = state.index - visible + 1;
      state.scroll = Math.min(Math.max(0, count - visible), Math.max(0, state.scroll));
    }
    const info = levelInfo.get(data.order[state.index]?.dir);
    if (info?.thumbnail) image(packUrl(info.thumbnail));
    paintSoon();
  }

  function visibleRows(box) {
    const area = listArea(page, box);
    return Math.max(1, Math.floor(area.h / box.rowHeight));
  }

  function scrollBy(by) {
    const box = listOf(page, 'Campaign/CampaignLevelsList');
    if (!box || !data) return;
    const max = Math.max(0, data.order.length - visibleRows(box));
    state.scroll = Math.min(max, Math.max(0, state.scroll + by));
    paintSoon();
  }

  // --- starting ----------------------------------------------------------------

  /** START (a new campaign, after the overwrite warning when the side has
   *  one) or CONTINUE (the saved campaign's mission). */
  function start() {
    if (!available) return;
    const saved = state.saved;
    if (state.mode === 'continue' && saved && !saved.finished) {
      launch(saved);
      return;
    }
    if (saved && !state.confirm) {
      state.confirm = saved.finished ? 'CONFIRMATION_FINISHED_CAMPAIGN' : 'CONFIRMATION_NEW_CAMPAIGN';
      paintSoon();
      return;
    }
    const fresh = law.newCampaign({
      team: state.team,
      difficulty: (state.mode === 'continue' && saved ? saved : state.draft).difficulty,
      botCount: botCount(),
    });
    state.confirm = null;
    if (!law.saveCampaign(fresh, storage)) {
      onStatus('This browser will not keep the campaign (storage is off): it starts, but cannot be continued.');
    }
    state.saved = fresh;
    state.mode = 'continue';
    launch(fresh);
  }

  function launch(campaign) {
    const mission = law.missionOf(campaign, data.order);
    if (!mission) return;
    const entry = entries.get(mission.dir);
    if (!entry) {
      onStatus(`Mission ${campaign.mission} (${mission.title || mission.level}) is not in this site's levels yet.`);
      return;
    }
    const url = law.launchUrl(campaign, { root, entry, mission, levels: data.levels });
    if (url) onStart(url);
  }

  // --- painting ----------------------------------------------------------------

  let pending = false;
  function paintSoon() {
    if (pending || !nav) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; paint(); });
  }

  const text = key => data?.strings?.[key] ?? nav?.strings?.[key] ?? key;

  function paint() {
    if (!nav) return;
    if (!beginStage(canvas, ctx, nav.virtual)) return;
    const table = vars();
    pack.values = table;
    for (const el of nav.pages.background?.elements || []) {
      if (elementVisible(el, table)) paintElement(ctx, el, nav, null, env);
    }
    for (const el of elements) {
      if (!elementVisible(el, table)) continue;
      if (el.kind === 'picture' && el.var === 'Campaign/CampaignMap') {
        paintPreview(el);
        continue;
      }
      paintElement(ctx, el, nav, null, env);
    }
    paintSliders();
    paintLevels();
    paintStatistics();
    for (const el of nav.pages.campaignNav?.elements || []) {
      if (elementVisible(el, table)) paintElement(ctx, el, nav, null, env);
    }
    strip?.paint(ctx);
    strip?.paintChosen(ctx, 'campaign');
    if (state.confirm) paintConfirm();
    ctx.globalAlpha = 1;
  }

  function paintPreview(el) {
    const info = levelInfo.get(data.order[state.index]?.dir);
    const img = info?.thumbnail ? ready(image(packUrl(info.thumbnail))) : null;
    if (!img) return;
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, ...el.rect);
  }

  function fillRect(r, color) {
    ctx.globalAlpha = color[3] ?? 1;
    ctx.fillStyle = rgb(color);
    ctx.fillRect(...r);
  }

  function valueText(font, value, r) {
    const w = measureText(font, value);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    drawBitmapText(ctx, font, env.tint, value, Math.round(r[0] + (r[2] - w) / 2), r[1] + 3, WHITE);
  }

  /** The three difficulty troughs filled to their step, and the bot count's
   *  trough and box. The value words of the three are the page's own. */
  function paintSliders() {
    const d = difficulty();
    for (const field of ['aiSkill', 'lives', 'ratio']) {
      const row = rows[field];
      if (!row) continue;
      const [x, y, w, h] = row.trough;
      fillRect([x, y, Math.round((w * d[field]) / 4), h], GREEN);
    }
    const bots = rows.bots;
    const font = env.font('standard6');
    if (bots && font) {
      const [x, y, w, h] = bots.trough;
      const count = botCount();
      fillRect([x, y, Math.round((w * count) / law.MAX_BOTS), h], GREEN);
      valueText(font, String(count), bots.box);
    }
  }

  function paintLevels() {
    const box = listOf(page, 'Campaign/CampaignLevelsList');
    const font = box && env.font(box.font);
    if (!box || !font) return;
    const area = listArea(page, box);
    const visible = visibleRows(box);
    const saved = state.mode === 'continue' ? state.saved : null;
    const results = new Map((saved?.results || []).map(r => [r.mission, r]));
    const current = saved && !saved.finished ? saved.mission : (saved ? 0 : 1);
    for (let i = 0; i < visible; i++) {
      const index = state.scroll + i;
      const mission = data.order[index];
      if (!mission) break;
      const y = area.y + i * box.rowHeight;
      if (index === state.index) fillRect([area.x, y, area.w, box.rowHeight], box.select);
      else if (hover?.kind === 'row' && hover.index === index) {
        fillRect([area.x, y, area.w, box.rowHeight], [...box.select.slice(0, 3), box.select[3] * 0.4]);
      }
      const result = results.get(index + 1);
      // Played missions carry their result at the row's right edge; the one
      // the campaign is on is white, the ones ahead of it dim.
      const tag = result ? (result.won ? 'WON' : 'LOST') : (index + 1 === current ? 'NEXT' : '');
      const tagWidth = tag ? measureText(font, tag) : 0;
      const left = Math.round(area.x + box.scrollbarOffset);
      const room = (area.x + area.w - 4 - tagWidth) - left - (tag ? measureText(font, ' ') : 0);
      const missing = !entries.has(mission.dir);
      const ink = missing ? DIM : index + 1 === current ? WHITE : result ? INK : DIM;
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      const title = `${index + 1}. ${mission.title || mission.level}`;
      drawBitmapText(ctx, font, env.tint, fitText(font, title, room), left, y + 1, ink, true);
      if (tag) {
        drawBitmapText(ctx, font, env.tint, tag, Math.round(area.x + area.w - 4 - tagWidth), y + 1,
                       result && !result.won ? DIM : INK, true);
      }
    }
    if (area.track && data.order.length > visible) {
      const [tx, ty, tw, th] = area.track.rect;
      const size = Math.max(0.08, visible / data.order.length);
      const offset = (state.scroll / (data.order.length - visible)) * (1 - size);
      fillRect([tx, ty + offset * th, tw, size * th], [1, 1, 1, 1]);
    }
  }

  /** STATISTICS: the side's campaign so far. */
  function statisticsRows() {
    const saved = state.saved;
    if (!saved) return [['MISSION:', `1 / ${data.order.length}`]];
    const won = saved.results.filter(r => r.won).length;
    const status = saved.over ? text('DEBRIEFING_TOTAL_DEFEAT')
      : saved.finished ? 'FINISHED' : `${saved.mission} / ${data.order.length}`;
    const bar = law.statusBar(saved.score, Math.min(saved.mission, 16), data.score);
    return [
      ['MISSION:', status],
      ['CAMPAIGN STATUS:', `${Math.round(bar.fraction * 100)}%`],
      ['WON:', String(won)],
      ['LOST:', String(saved.results.length - won)],
      [text('STATISTICS_SCORE'), String(saved.totals.score)],
      [text('STATISTICS_KILLS'), String(saved.totals.kills)],
      [text('STATISTICS_DEATHS'), String(saved.totals.deaths)],
      ['DIFFICULTY:', `${saved.difficulty.overall}%`],
      ['BOTS:', String(saved.botCount)],
    ];
  }

  function paintStatistics() {
    const box = listOf(page, 'Campaign/CampaignStatisticsList');
    const font = box && env.font(box.font);
    if (!box || !font) return;
    const area = listArea(page, box);
    const left = Math.round(area.x + box.scrollbarOffset);
    const right = area.x + area.w - 4;
    const rowsShown = Math.floor(area.h / box.rowHeight);
    statisticsRows().slice(0, rowsShown).forEach(([label, value], i) => {
      const y = area.y + i * box.rowHeight + 1;
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      drawBitmapText(ctx, font, env.tint, label, left, y, INK);
      drawBitmapText(ctx, font, env.tint, value, Math.round(right - measureText(font, value)), y, WHITE);
    });
  }

  /** The overwrite warning (`CONFIRMATION_NEW_CAMPAIGN`), over the screen,
   *  with START to go on and the plate's own back arrow to keep the old. */
  const CONFIRM = { box: [230, 250, 340, 96], ok: [262, 305, 109, 25], cancel: [430, 305, 109, 25] };
  function paintConfirm() {
    const font = env.font('standard6');
    const head = env.font('trebuchet_ms8') || font;
    fillRect(CONFIRM.box, [0.5468, 0.5468, 0.5468, 1]);
    const [x, y, w, h] = CONFIRM.box;
    fillRect([x + 1, y + 1, w - 2, h - 2], [0, 0, 0, 0.92]);
    if (head) {
      const words = text(state.confirm);
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      drawBitmapText(ctx, head, env.tint, words, Math.round(x + (w - measureText(head, words)) / 2), y + 18, WHITE);
    }
    for (const [rect, label] of [[CONFIRM.ok, 'START'], [CONFIRM.cancel, 'CANCEL']]) {
      const over = hover?.kind === 'confirm' && hover.rect === rect;
      const img = env.texture(over ? 'knapp3_mo' : 'knapp3_n');
      if (img) { ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true; ctx.drawImage(img, rect[0], rect[1], img.width, img.height); }
      if (font) valueText(font, label, [rect[0], rect[1] + 3, rect[2], rect[3]]);
    }
  }

  const observer = new ResizeObserver(() => paint());
  observer.observe(canvas);

  // --- input -------------------------------------------------------------------

  const at = event => pointerToVirtual(canvas, event, nav.virtual);

  /** What a point is over, for both the hover and the click. */
  function hitTest(x, y) {
    if (state.confirm) {
      if (inRect(CONFIRM.ok, x, y)) return { kind: 'confirm', action: 'ok', rect: CONFIRM.ok };
      if (inRect(CONFIRM.cancel, x, y)) return { kind: 'confirm', action: 'cancel', rect: CONFIRM.cancel };
      return { kind: 'modal' };
    }
    for (const [field, row] of Object.entries(rows || {})) {
      const r = row.trough;
      const b = row.box;
      if (inRect([r[0] - 1, r[1] - 3, r[2] + 2, r[3] + 6], x, y) || inRect(b, x, y)) {
        return { kind: 'slider', field, row };
      }
    }
    const box = listOf(page, 'Campaign/CampaignLevelsList');
    if (box) {
      const area = listArea(page, box);
      if (inRect([area.x, area.y, area.w, area.h], x, y)) {
        const index = state.scroll + Math.floor((y - area.y) / box.rowHeight);
        return index < data.order.length ? { kind: 'row', index } : null;
      }
    }
    const table = vars();
    for (const el of [...nav.pages.campaignNav?.elements || [], ...elements]) {
      if (!elementVisible(el, table) || !inRect(el.rect, x, y)) continue;
      if (el.kind === 'button' && el.calls?.includes('Campaign/StartCampaign')) {
        return { kind: 'button', action: 'start', rect: el.rect };
      }
      if (el.kind === 'button' && el.texture?.includes('scrollpil')) {
        // Only the LEVELS list scrolls: STATISTICS fits its well.
        if (box && el.rect[0] >= box.rect[0] && el.rect[0] < box.rect[0] + box.rect[2]) {
          return { kind: 'button', action: 'scroll', by: el.texture.includes('upp') ? -1 : 1, rect: el.rect };
        }
      }
      if (el.kind === 'hit' && el.sets?.length) return { kind: 'sets', sets: el.sets, rect: el.rect };
    }
    return null;
  }

  function apply(hit, x) {
    if (!hit) return;
    switch (hit.kind) {
      case 'confirm':
        if (hit.action === 'ok') start();
        else { state.confirm = null; paintSoon(); }
        return;
      case 'slider':
        if (hit.field === 'bots') {
          const [tx, , tw] = hit.row.trough;
          setBotCount(fracToBotCount(Math.min(1, Math.max(0, (x - tx) / tw))));
        } else {
          setSlider(hit.field, x, hit.row);
        }
        return;
      case 'row':
        selectRow(hit.index);
        return;
      case 'button':
        if (hit.action === 'start') start();
        else if (hit.action === 'scroll') scrollBy(hit.by);
        return;
      case 'sets': {
        const sets = hit.sets;
        const flag = sets.find(s => s.var === 'Campaign/NewCampaignFlag');
        if (flag) { setMode(flag.value ? 'new' : 'continue'); return; }
        const team = sets.find(s => s.var === 'Campaign/Team');
        if (team) { selectTeam(team.value); return; }
        const next = difficultyFromSets(sets, difficulty());
        if (next) setDifficulty(next);
        return;
      }
      default:
    }
  }

  canvas.addEventListener('pointermove', event => {
    if (!nav) return;
    const [x, y] = at(event);
    const navHover = state.confirm ? null : strip?.hover(x, y) || null;
    const hit = navHover || hitTest(x, y);
    const next = hit && hit.kind !== 'modal'
      ? (hit.kind === 'sets' || hit.kind === 'slider' ? { kind: hit.kind, rect: hit.rect ?? hit.row?.trough }
        : hit.kind === 'row' ? { kind: 'row', index: hit.index }
          : { kind: hit.kind, rect: hit.rect, id: hit.id })
      : null;
    const changed = JSON.stringify(next) !== JSON.stringify(hover);
    hover = next && (next.kind === 'button' || next.kind === 'confirm')
      ? { ...next, rect: hit.rect } : next;
    canvas.style.cursor = next ? 'pointer' : 'default';
    if (changed) paintSoon();
  });

  canvas.addEventListener('pointerleave', () => { hover = null; paintSoon(); });

  canvas.addEventListener('click', event => {
    if (!nav) return;
    const [x, y] = at(event);
    canvas.focus();
    if (!state.confirm && strip?.click(x, y)) return;
    apply(hitTest(x, y), x);
  });

  canvas.addEventListener('dblclick', event => {
    if (!nav || state.confirm) return;
    const [x, y] = at(event);
    if (hitTest(x, y)?.kind === 'row') start();
  });

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (!nav) return;
    scrollBy(Math.sign(event.deltaY));
  }, { passive: false });

  function keydown(event) {
    if (!nav) return false;
    if (state.confirm) {
      if (event.key === 'Escape') { state.confirm = null; paintSoon(); return true; }
      if (event.key === 'Enter') { start(); return true; }
      return false;
    }
    switch (event.key) {
      case 'ArrowDown': selectRow(state.index + 1); break;
      case 'ArrowUp': selectRow(state.index - 1); break;
      case 'Home': selectRow(0); break;
      case 'End': selectRow(data.order.length - 1); break;
      case 'Enter': start(); break;
      default: return false;
    }
    return true;
  }

  return {
    load,
    paint,
    paintSoon,
    keydown,
    start,
    selectTeam,
    setMode,
    setDifficulty: level => setDifficulty(law.difficultyOf({ ...difficulty(), level })),
    setBotCount,
    /** Whether the campaign's page and data loaded: SINGLEPLAY's row offers
     *  CAMPAIGN only then. */
    get available() { return available; },
    get strip() { return strip; },
    /** The front end tells every screen's strip which tab is up; this
     *  screen's strip keeps SINGLEPLAY lit, since CAMPAIGN is under it. */
    setActive(id) { strip?.setActive(id === 'campaign' ? 'singleplay' : id); },
    get state() {
      const d = difficulty();
      return {
        mode: state.mode, team: state.team, index: state.index, scroll: state.scroll,
        confirm: state.confirm, difficulty: d, botCount: botCount(),
        saved: state.saved, missions: data?.order?.length ?? 0, available,
      };
    },
    get missions() { return (data?.order || []).map(m => m.title || m.level); },
    launchUrlFor: campaign => {
      const mission = law.missionOf(campaign, data?.order);
      const entry = mission && entries.get(mission.dir);
      return entry ? law.launchUrl(campaign, { root, entry, mission, levels: data.levels }) : null;
    },
  };
}
