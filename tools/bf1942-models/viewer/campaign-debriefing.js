/**
 * The end of a campaign mission: `menu/LoadMenu`'s single-player plate over
 * the world, the score rule applied, and DONE / REPLAY / CONTINUE.
 *
 * Retail (features/single-player-campaign; `play/campaign.js` has the law):
 *
 *  - a campaign round's end draws `SP_debriefing_512x512` (`StartingGame` 1,
 *    `ShowDebriefing` 1): the result's title, the two sides' ticket flags and
 *    counts, the level's own line for the player's side, CURRENT CAMPAIGN
 *    STATUS with its bar (`CampaignScore` of `MaxCampaignScore`: the score
 *    over the mission's floor, out of the cap over it), the player's row,
 *    STATISTICS:, and DONE, REPLAY and CONTINUE;
 *  - CONTINUE goes on to the next mission, won or lost; REPLAY plays this one
 *    again from the score it started with; DONE goes back to the menu with
 *    the result kept;
 *  - a campaign below its floor, or past its sixteenth mission, ends on
 *    `ShowDebriefing` 3: the side's won or lost picture over the whole stage
 *    with its line (`ALLIED WON THE CAMPAIGN` ..), which a click turns into
 *    the plate again with FINAL CAMPAIGN STATUS and DONE.
 *
 * The plate is data: `debriefing-layout.json`'s `campaign` draw list
 * (`extract_debriefing_layout.py`), painted with the score board's painter
 * under the variables written here. The top half is pure, for
 * `tests/test_campaign.mjs`; `createCampaignDebriefing` is the page's.
 */

import { leafVisible, paintLeaves, textureKey } from './scoreboard.js';
import { drawBitmapText, measureBitmapText } from './bitmap-text.js';
import { plateScale } from './round-end.js';
import { VICTORY } from './round-state.js';
import * as law from './play/campaign.js';

/** The level line's leaf is drawn wrapped, and the bar and the rows by hand. */
const OWN_DRAW = new Set(['Debriefing/DebriefingText']);

/** The words of a `law.finishMission` outcome for the plate's variables:
 *  the mission plate (`ShowDebriefing` 1) or the last screen (3), which
 *  starts on its picture (`ShowCampaignDebriefing` false) until a click. */
export function campaignPlateVars(layoutVars, {
  title = '', line = '', tickets = {}, state = null, mission = 1, tables = null,
  final = false, picture = true,
} = {}) {
  const vars = { ...(layoutVars || {}), ...tickets };
  vars.StartingGame = 1;
  vars['Debriefing/DebriefingHeading'] = title;
  vars['Debriefing/DebriefingText'] = line;
  const bar = state ? law.statusBar(state.score, mission, tables) : { value: 0, max: 1 };
  vars.CampaignScore = Math.max(0, bar.value);
  vars.MaxCampaignScore = bar.max;
  if (final) {
    const grade = law.finalGrade(state);
    vars.ShowDebriefing = 3;
    vars.CampaignVictory = law.campaignVictory(state.team, grade);
    vars['Debriefing/ShowCampaignDebriefing'] = !picture;
  } else {
    vars.ShowDebriefing = 1;
    vars['Debriefing/ShowCampaignDebriefing'] = false;
  }
  return vars;
}

/** The buttons drawn under `vars`, by the locale key each one carries. */
export function plateButtons(elements, vars) {
  return (elements || [])
    .filter(el => el.kind === 'button' && el.id && leafVisible(el, vars))
    .map(el => ({ id: el.id, rect: el.rect }));
}

/** What a click at (x, y) asks for: `done`, `replay`, `continue`, `abort`,
 *  or `reveal` on the last screen's picture; null for nothing. */
export function plateAction(elements, vars, x, y) {
  const inside = r => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
  for (const b of plateButtons(elements, vars)) {
    if (inside(b.rect)) return b.id.replace('DEBRIEFING_', '').toLowerCase();
  }
  if (vars.ShowDebriefing === 3 && !vars['Debriefing/ShowCampaignDebriefing']) return 'reveal';
  return null;
}

/** `text` broken into lines no wider than `width` (blank lines kept). */
export function wrapLines(measure, text, width) {
  const out = [];
  for (const para of String(text || '').split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > width) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/** The player's own row of the round, out of the board's rows. */
export function localRow(players) {
  return (players || []).find(p => p && (p.local || p.key === 'local')) ?? null;
}

/** A round's result as the campaign takes it. */
export function roundOutcome(round, localTeam) {
  const type = round?.victoryType;
  const decided = type === VICTORY.minor || type === VICTORY.major || type === VICTORY.total;
  return { won: decided && round.winner === localTeam, victoryType: decided ? type : VICTORY.draw };
}

// --- the page ------------------------------------------------------------------

const STYLE = `
.campaign-plate { position: absolute; inset: 0; z-index: 41; cursor: default; }
.campaign-plate[hidden] { display: none; }
.campaign-plate canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
`;

/**
 * `page`: `stage` (the element to draw over), `spriteUrl(rel)` (a HUD-pack
 * path to a URL), `sprite(name)` (a loaded HUD sprite: the side flags),
 * `menuUrl(rel)` (a menu-pack path: `campaign.json`), `mapsUrl` (the vanilla
 * tree's `maps.json`), `levelDir()` (the level up, lower-cased), `localTeam()`,
 * `players()` (the board's rows), `restartRound()`, `navigate(url)`,
 * `backUrl` (the campaign screen), `storage`.
 */
export function createCampaignDebriefing(page) {
  const self = { shown: false, outcome: null, vars: null, action: null };
  let root = null;
  let canvas = null;
  const layout = { data: null, fonts: new Map(), textures: new Map(), loading: null };
  let campaign = null;
  let manifest = [];
  let hover = null;

  function build() {
    if (root || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.className = 'campaign-plate';
    root.id = 'campaign-end';
    root.hidden = true;
    canvas = document.createElement('canvas');
    root.appendChild(canvas);
    (page.stage ?? document.body).appendChild(root);
    root.addEventListener('pointermove', event => {
      const [x, y] = at(event);
      const next = plateButtons(elements(), self.vars).find(b => inside(b.rect, x, y)) ?? null;
      if (next?.id !== hover?.id) { hover = next; paint(); }
      root.style.cursor = next ? 'pointer' : 'default';
    });
    root.addEventListener('click', event => {
      const [x, y] = at(event);
      act(plateAction(elements(), self.vars, x, y));
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => paint()).observe(root);
  }

  const inside = (r, x, y) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
  const elements = () => layout.data?.campaign?.elements ?? [];

  function at(event) {
    const r = root.getBoundingClientRect();
    const s = plateScale(r.width, r.height, layout.data?.virtual);
    return [(event.clientX - r.left - s.ox) / s.sx, (event.clientY - r.top - s.oy) / s.sy];
  }

  /** The plate's layout, faces and art; `campaign.json`; the levels. */
  function load() {
    if (layout.loading || typeof fetch === 'undefined') return layout.loading;
    const image = src => new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    const url = rel => page.spriteUrl(`debriefing/${rel}`);
    layout.loading = (async () => {
      const [data, camp, maps] = await Promise.all([
        fetch(url('debriefing-layout.json')).then(r => r.json()).catch(() => null),
        fetch(page.menuUrl('campaign.json')).then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch(page.mapsUrl).then(r => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      campaign = camp;
      manifest = Array.isArray(maps) ? maps : [];
      if (!data?.campaign) return;
      await Promise.all([
        ...Object.entries(data.fontFiles || {}).map(async ([id, entry]) => {
          const [meta, img] = await Promise.all([
            fetch(url(entry.glyphs)).then(r => r.json()).catch(() => null), image(url(entry.file))]);
          if (meta && img) layout.fonts.set(id, { meta, img, tinted: new Map() });
        }),
        ...Object.entries(data.textures || {}).map(async ([name, entry]) => {
          const img = await image(url(entry.file));
          if (img) layout.textures.set(name, img);
        }),
      ]);
      layout.data = data;
      if (self.shown) { refreshVars(); paint(); }
    })();
    return layout.loading;
  }

  const res = {
    texture: name => (name ? layout.textures.get(name) ?? page.sprite?.(name) ?? null : null),
    boundTexture: name => page.sprite?.(name) ?? layout.textures.get(name) ?? null,
    measure: (fontId, text) => {
      const font = layout.fonts.get(fontId);
      return font ? measureBitmapText(font, text) : 0;
    },
    drawText: (ctx, fontId, text, x, y, rgb) => {
      const font = layout.fonts.get(fontId);
      if (font) drawBitmapText(ctx, font, text, x, y, { rgb });
    },
    hover: el => hover && el.rect && inside(el.rect, hover.rect[0] + 1, hover.rect[1] + 1),
  };

  /** The words the plate shows now, from the outcome and the step it is on. */
  function refreshVars() {
    const o = self.outcome;
    const strings = { ...(layout.data?.campaign?.strings || {}), ...(campaign?.strings || {}) };
    const final = !!o?.final;
    const title = final ? strings[law.gradeTitleKey(law.finalGrade(o.state))] ?? '' : o?.title ?? '';
    self.vars = campaignPlateVars(layout.data?.campaign?.variables, {
      title, line: final ? '' : o?.line ?? '', tickets: o?.tickets ?? {},
      state: o?.state ?? null, mission: o?.mission ?? 1, tables: campaign?.score ?? null,
      final, picture: !o?.revealed,
    });
  }

  function paint() {
    const data = layout.data;
    if (!self.shown || !canvas || !data) return;
    const W = root.clientWidth || 800;
    const H = root.clientHeight || 600;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const s = plateScale(W, H, data.virtual);
    ctx.setTransform(s.sx * dpr, 0, 0, s.sy * dpr, s.ox * dpr, s.oy * dpr);
    const vars = self.vars;
    const leaves = elements().filter(el => el.kind !== 'listbox' && el.kind !== 'fillbar'
      && !(el.kind === 'text' && OWN_DRAW.has(el.var)));
    paintLeaves(ctx, data, leaves, vars, res);
    for (const el of elements()) {
      if (!leafVisible(el, vars)) continue;
      if (el.kind === 'fillbar') drawBar(ctx, el, vars);
      else if (el.kind === 'text' && OWN_DRAW.has(el.var)) drawLine(ctx, el, vars);
      else if (el.kind === 'listbox') drawList(ctx, el, vars);
    }
    ctx.globalAlpha = 1;
  }

  /** The status bar: the empty art, then the full art cut at the score. */
  function drawBar(ctx, el, vars) {
    const empty = res.texture(textureKey(el.texture));
    const full = res.texture(textureKey(el.fill));
    const [x, y, w, h] = el.rect;
    const max = Number(vars[el.max]) || 0;
    const f = max > 0 ? Math.min(1, Math.max(0, Number(vars[el.var]) / max)) : 0;
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    if (empty) ctx.drawImage(empty, x, y, w, h);
    if (full && f > 0) {
      ctx.drawImage(full, 0, 0, full.width * f, full.height, x, y, w * f, h);
    }
  }

  function drawLine(ctx, el, vars) {
    const font = layout.fonts.get(el.font);
    if (!font) return;
    const [x, y, w, h] = el.rect;
    const pitch = font.meta.lineHeight || 9;
    const lines = wrapLines(t => measureBitmapText(font, t), vars[el.var], w);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    lines.slice(0, Math.max(1, Math.floor(h / pitch))).forEach((line, i) => {
      drawBitmapText(ctx, font, line, x, y + i * pitch, { rgb: (el.color || [1, 1, 1]).slice(0, 3) });
    });
  }

  /** The player's row under PLAYERNAME, and STATISTICS: under its band. */
  function drawList(ctx, el, vars) {
    const font = layout.fonts.get(el.font);
    const o = self.outcome;
    if (!font || !o) return;
    const [bx, by] = el.rect;
    const pitch = el.rowHeight || 14;
    const draw = (text, x, line) => drawBitmapText(ctx, font, String(text), x,
      line - (font.meta.baseline ?? 0), { rgb: [1, 1, 1] });
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    if (el.data === 'Debriefing/DebriefingList') {
      // The columns the heading strip's own labels and icons stand at.
      const heads = elements().filter(h => leafVisible(h, vars) && h.rect[1] >= by && h.rect[1] < by + 18);
      const colOf = (key, icon) => heads.find(h => h.key === key || h.texture === icon)?.rect[0];
      const line = by + 2 * pitch;
      const row = o.row || {};
      const name = colOf('COL_HEADING_PLAYER_NAME');
      if (name != null) draw(row.name ?? '', name, line);
      for (const [field, key, icon] of [['score', 'COL_HEADING_SCORE', 'menu_icon_score_16x16'],
        ['kills', 'COL_HEADING_KILLS', 'menu_icon_kills_16x16'],
        ['deaths', 'COL_HEADING_DEATHS', 'menu_icon_death_16x16']]) {
        const x = colOf(key, icon);
        if (x != null) draw(row[field] ?? 0, x, line);
      }
    } else if (el.data === 'Debriefing/DebriefingStatisticsList') {
      const strings = campaign?.strings || {};
      const totals = o.state?.totals || {};
      const rows = [
        [strings.STATISTICS_SCORE ?? 'SCORE:', totals.score ?? 0],
        [strings.STATISTICS_KILLS ?? 'KILLS:', totals.kills ?? 0],
        [strings.STATISTICS_DEATHS ?? 'DEATHS:', totals.deaths ?? 0],
        ['MISSION:', `${Math.min(o.mission, 16)} / 16`],
      ];
      rows.forEach(([label, value], i) => {
        const line = by + 2 * pitch + 6 + i * pitch;
        draw(label, bx + 10, line);
        draw(value, bx + 210, line);
      });
    }
  }

  /** The round is over: the rule applied and saved, the plate up. */
  function show(model, round) {
    build();
    load();
    const team = page.localTeam();
    const saved = law.loadCampaign(team, page.storage);
    const order = campaign?.order;
    const mission = saved && order ? law.missionOf(saved, order) : null;
    const outcome = roundOutcome(round, team);
    const row = localRow(page.players?.());
    let state = saved;
    let missionNr = saved?.mission ?? 1;
    // The campaign the page was started for: the side's saved one, on this
    // mission's level. A stale address (a mission already played) shows the
    // plate and keeps the saved campaign as it is.
    const ours = !!(saved && (!order || mission?.dir === page.levelDir()));
    if (ours) {
      state = law.finishMission(saved, { ...outcome, stats: row, tables: campaign?.score ?? null });
      law.saveCampaign(state, page.storage);
    }
    self.outcome = {
      title: model?.words?.title ?? '', line: model?.words?.line ?? '',
      tickets: pickTickets(model?.vars), row, state, mission: missionNr, ours,
      final: false, revealed: false,
    };
    self.shown = true;
    hover = null;
    refreshVars();
    if (root) root.hidden = false;
    paint();
    if (!layout.data && layout.loading) layout.loading.then(() => { refreshVars(); paint(); });
  }

  const pickTickets = vars => {
    const out = {};
    for (const key of ['AxisTicket', 'AlliedTicket', 'AxisTicketFlagLoad', 'AlliedTicketFlagLoad',
      'AxisTicketFlag', 'AlliedTicketFlag']) if (vars && key in vars) out[key] = vars[key];
    return out;
  };

  function hide() {
    self.shown = false;
    if (root) root.hidden = true;
  }

  /** The next mission's address, or null (its level not on the site). */
  function nextUrl(state) {
    const mission = law.missionOf(state, campaign?.order);
    if (!mission) return null;
    const entry = manifest.find(e => String(e.name).toLowerCase() === mission.dir);
    return entry ? law.launchUrl(state, {
      root: page.root ?? './', base: globalThis.location?.href, entry, mission, levels: campaign.levels,
    }) : null;
  }

  function act(action) {
    const o = self.outcome;
    self.action = action;
    if (!action || !o) return;
    if (action === 'reveal') { o.revealed = true; refreshVars(); paint(); return; }
    if (action === 'replay') {
      if (o.ours) law.saveCampaign(law.replayMission(o.state), page.storage);
      hide();
      page.restartRound?.();
      return;
    }
    if (action === 'done' || action === 'abort') {
      if (o.ours) law.saveCampaign(law.acceptMission(o.state), page.storage);
      page.navigate?.(page.backUrl);
      return;
    }
    if (action === 'continue') {
      const state = o.ours ? law.acceptMission(o.state) : o.state;
      if (o.ours) law.saveCampaign(state, page.storage);
      if (state?.finished) {
        o.final = true;
        o.revealed = false;
        o.state = state;
        refreshVars();
        paint();
        return;
      }
      const url = state && nextUrl(state);
      page.navigate?.(url || page.backUrl);
    }
  }

  /** A mission's words for one side out of `campaign.json`, once loaded. */
  self.briefing = (dir, side) => campaign?.levels?.[dir]?.[side]?.briefing ?? null;
  self.show = show;
  self.hide = hide;
  self.load = load;
  self.paint = paint;
  self.act = act;
  return self;
}
