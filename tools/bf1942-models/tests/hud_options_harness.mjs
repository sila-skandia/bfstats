// Drives `viewer/tooltips.js`, `viewer/general-options.js` and the font
// metrics of `viewer/bitmap-text.js` outside a browser.
import * as tips from './tooltips.js';
import * as general from './general-options.js';
import * as text from './bitmap-text.js';

const out = {};

// --- the tooltip manager -----------------------------------------------------
const strings = {
  TOOLTIP_ON: 'TOOLTIPS ARE ON', TOOLTIP_OFF: 'TOOLTIPS ARE OFF', TOOLTIP_CLOSE: 'TO CLOSE THIS TOOLTIP',
  TOOLTIP_TURN_OFF: 'TO TURN TOOLTIPS OFF', TOOLTIP_TURN_ON: 'TO TURN TOOLTIPS ON',
  TOOLTIP_HEAVY_TANK: 'The HEAVY TANK has the best armor.\n', TOOLTIP_HEAVY_TANK_HEADING: 'HEAVY TANK',
  TOOLTIP_HEAVY_TANK_1: 'Main gun',
  TOOLTIP_CLOSE_TO_REPAIR: 'Repair pod.', TOOLTIP_CLOSE_TO_REPAIR_HEADING: 'REPAIR',
  TOOLTIP_INTERFACE: 'The interface.', TOOLTIP_INTERFACE_HEADING: 'MAIN INTERFACE',
  TOOLTIP_INTERFACE_1: 'crouching/standing', TOOLTIP_INTERFACE_2: 'prone/standing', TOOLTIP_INTERFACE_3: 'radio',
  TOOLTIP_SOLDIER_MEDIC: 'The MEDIC KIT.', TOOLTIP_SOLDIER_MEDIC_HEADING: 'MEDIC',
  TOOLTIP_COMMUNICATION: 'Radio.', TOOLTIP_COMMUNICATION_HEADING: 'COMMUNICATION',
};
const keyLabel = t => ({ c_PIToolTip: 'T', c_PICrouch: 'LEFT CTRL', c_PILie: 'Z', c_PIRadio8: 'F8' }[t] ?? '');
const fed = m => { const v = {}; m.feed(v); return v; };
out.constants = { vehicle: tips.VEHICLE_TIP_SECONDS, fade: tips.TEXT_FADE_SECONDS, kit: tips.KIT_TIP_SECONDS,
                  kits: tips.KIT_TIPS.map(k => [k.id, k.key, k.rows]) };
{
  // Off, as the shipped profile leaves it: nothing shows.
  const m = new tips.ToolTipManager({ strings, keyLabel });
  out.offShows = m.enable(tips.vehicleTipId(0), 'TOOLTIP_HEAVY_TANK', { time: 15, prio: tips.PRIO_HELP });
  out.offVars = fed(m)['ToolTip/ShowToolTip'];
}
{
  const m = new tips.ToolTipManager({ strings, keyLabel, enabled: true });
  out.shows = m.enable(tips.vehicleTipId(0), 'TOOLTIP_HEAVY_TANK', { time: 15, prio: tips.PRIO_HELP });
  const v = fed(m);
  out.vehicle = { show: v['ToolTip/ShowToolTip'], small: v['ToolTip/SmallToolTip'], heading: v['ToolTip/ToolTipHeading'],
                  body: v['ToolTip/ToolTipKeyString'], footer: v['ToolTip/ToolTipFooter'],
                  key0: v['ToolTip/Key/ToolTipKey0'], keyText0: v['ToolTip/Key/ToolTipKeyText0'],
                  state: v['ToolTip/Text/ToolTipState'], change: v['ToolTip/Text/ToolTipStateChange'] };
  // A lower priority tip does not replace it; an equal one does.
  out.lowerWaits = m.enable(tips.TIP_CLOSE_TO_REPAIR, 'TOOLTIP_CLOSE_TO_REPAIR', { time: 10, prio: tips.PRIO_NEAR });
  out.sameIdAgain = m.enable(tips.vehicleTipId(0), 'TOOLTIP_HEAVY_TANK', { time: 15 });
  out.equalReplaces = m.enable(tips.vehicleTipId(1), 'TOOLTIP_HEAVY_TANK', { time: 15, prio: tips.PRIO_HELP });
  // Fifteen seconds, then it is down.
  for (let i = 0; i < 30 * 15 - 1; i++) m.update(1 / 30);
  out.upAt15 = !!m.active;
  for (let i = 0; i < 4; i++) m.update(1 / 30);
  out.downAfter15 = !m.active;
  // The state panel stands while tooltips are on: only turning them off fades it.
  out.textStays = m.text.show && m.text.alpha === 1;
}
{
  // The near tips are a lower priority: help replaces them, and they come
  // down when the thing is left.
  const m = new tips.ToolTipManager({ strings, keyLabel, enabled: true });
  m.enable(tips.TIP_CLOSE_TO_REPAIR, 'TOOLTIP_CLOSE_TO_REPAIR', { time: 10, prio: tips.PRIO_NEAR });
  out.nearUp = m.active?.id === tips.TIP_CLOSE_TO_REPAIR;
  out.wrongIdStays = m.disable(tips.TIP_CLOSE_TO_HEAL);
  out.disabled = m.disable(tips.TIP_CLOSE_TO_REPAIR);
  out.afterDisable = { active: !!m.active, state: m.text.state, change: m.text.change };
}
{
  // The spawn's queue, in order, each once.
  const m = new tips.ToolTipManager({ strings, keyLabel, enabled: true });
  m.add(tips.TIP_INTERFACE, 'TOOLTIP_INTERFACE', { time: 20, rows: 3, once: true, triggers: ['c_PICrouch', 'c_PILie', 'c_PIRadio8'] });
  m.add(5, 'TOOLTIP_SOLDIER_MEDIC', { time: 25, rows: 0, once: true });
  m.update(0);
  const v = fed(m);
  out.queueFirst = { id: m.active?.id, index: v['ToolTip/ToolTipIndex'], keys: [0, 1, 2, 3].map(i => v[`ToolTip/Key/ToolTipKey${i}`]),
                     texts: [0, 1, 2].map(i => v[`ToolTip/Key/ToolTipKeyText${i}`]) };
  for (let i = 0; i < 30 * 20 + 2; i++) m.update(1 / 30);
  out.queueSecond = m.active?.id;
  for (let i = 0; i < 30 * 25 + 2; i++) m.update(1 / 30);
  out.queueEmpty = !m.active;
  m.add(tips.TIP_INTERFACE, 'TOOLTIP_INTERFACE', { time: 20, once: true });
  m.update(0);
  out.onceOnly = !m.active;
}
{
  // T: closes the tip up; with none up it flips the option.
  const m = new tips.ToolTipManager({ strings, keyLabel, enabled: true });
  m.enable(tips.vehicleTipId(0), 'TOOLTIP_HEAVY_TANK', { time: 15 });
  out.tCloses = [m.toggleKey(), !!m.active];
  out.tOff = [m.toggleKey(), m.text.state, m.text.change];
  for (let i = 0; i < 30 * 2; i++) m.update(1 / 30);
  out.fadeHalf = [m.text.show, Math.round(m.text.alpha * 10) / 10];
  for (let i = 0; i < 30 * 2 + 2; i++) m.update(1 / 30);
  out.fadeDone = [m.text.show, m.text.alpha];
  out.tOn = [m.toggleKey(), m.text.state, m.text.change];
}

// --- the page feed -------------------------------------------------------------
{
  const vars = {};
  let on = false;
  let occupancy = null;
  let alive = false;
  const layout = { strings, types: ['TOOLTIP_HEAVY_TANK'], vehicles: { tiger: 0 } };
  const page = { vars: () => vars, layout: () => layout, keyLabel, enabled: () => on, setEnabled: v => { on = v; },
                 get occupancy() { return occupancy; }, deployActive: () => false, deployKit: () => 3,
                 soldierAlive: () => alive, nearEntry: () => null };
  const t = tips.createToolTips(page);
  t.frame(1 / 30);
  out.pageOff = vars['ToolTip/ShowToolTip'];
  occupancy = { root: { name: 'Tiger', userData: {} }, rootId: 'r', seatInfo: () => ({ hud: {} }) };
  t.frame(1 / 30);
  out.pageOffInSeat = vars['ToolTip/ShowToolTip'];
  occupancy = null; t.frame(1 / 30);
  out.pageToggle = t.toggleKey();
  out.pageOptionWritten = on;
  occupancy = { root: { name: 'Tiger_1', userData: {} }, rootId: 'r', seatInfo: () => ({ hud: {} }) };
  t.frame(1 / 30);
  out.pageVehicle = [vars['ToolTip/ShowToolTip'], vars['ToolTip/ToolTipHeading']];
  // The seat's own `toolTipType` wins over the table.
  occupancy = null; t.frame(1 / 30);
  occupancy = { root: { name: 'Unknown', userData: {} }, rootId: 'r', seatInfo: () => ({ hud: { toolTipType: 0 } }) };
  t.manager.disable(); t.frame(1 / 30);
  out.pageHudType = vars['ToolTip/ToolTipHeading'];
  // A repair depot in reach, then left.
  occupancy = null; t.manager.disable();
  vars['ShowRepairIcon'] = true; t.frame(1 / 30);
  out.pageRepair = vars['ToolTip/ToolTipHeading'];
  vars['ShowRepairIcon'] = false; t.frame(1 / 30);
  out.pageRepairGone = vars['ToolTip/ShowToolTip'];
}

// --- the spawn screen's tips, the flag and the tickets -------------------------------
{
  const vars = {}, over = {};
  let deploy = false, flag = false, share = 1, mode = 'GPM_COOP', spawned = false;
  const strings2 = { ...strings, TOOLTIP_ENTER_GAME: 'The goal.', TOOLTIP_ENTER_GAME_HEADING: 'Welcome',
    TOOLTIP_RESPAWN: 'Respawn.', TOOLTIP_RESPAWN_HEADING: 'RESPAWN INTERFACE', TOOLTIP_RESPAWN_1: 'close the spawninterface',
    TOOLTIP_CLOSE_TO_FLAG_HEADING: 'CLOSE TO FLAG', TOOLTIP_TICKETLOW_HEADING: 'TICKET LOW' };
  const page = { vars: () => vars, spawnVars: () => over, layout: () => ({ strings: strings2, types: [], vehicles: {} }),
                 keyLabel: t => ({ c_PIToolTip: 'T', c_GIInGameMenu: 'ENTER' }[t] ?? ''), enabled: () => true, setEnabled() {},
                 occupancy: null, deployActive: () => deploy, deployKit: () => -1, soldierAlive: () => spawned,
                 nearEntry: () => null, gameplayMode: () => mode, nearEnemyFlag: () => flag, ticketShare: () => share };
  const t = tips.createToolTips(page);
  t.frame(1 / 30);
  deploy = true; t.frame(1 / 30);
  out.spawnWelcome = { over: [over['ToolTip/ShowToolTip'], over['ToolTip/ToolTipHeading']], main: vars['ToolTip/ShowToolTip'],
                       text: over['ToolTip/Text/ShowToolTipText'] };
  for (let i = 0; i < 30 * 10 + 3; i++) t.frame(1 / 30);
  out.spawnRespawn = [over['ToolTip/ShowToolTip'], over['ToolTip/ToolTipHeading'], over['ToolTip/Key/ToolTipKey0'],
                      over['ToolTip/Key/ToolTipKeyText0']];
  for (let i = 0; i < 30 * 10 + 3; i++) t.frame(1 / 30);
  // Out of the spawn screen and back: each was once.
  deploy = false; t.frame(1 / 30); deploy = true; t.frame(1 / 30); t.frame(1 / 30);
  out.spawnOnce = over['ToolTip/ShowToolTip'];
  deploy = false; spawned = true; t.frame(1 / 30);
  // The interface queue from the spawn is up now; clear it to see the rest.
  for (let i = 0; i < 30 * 90; i++) t.frame(1 / 30);
  flag = true; t.frame(1 / 30);
  out.flag = [vars['ToolTip/ShowToolTip'], vars['ToolTip/ToolTipHeading'], over['ToolTip/ShowToolTip']];
  flag = false; t.frame(1 / 30);
  out.flagLeft = vars['ToolTip/ShowToolTip'];
  share = 0.2; t.frame(1 / 30);
  out.ticketsAtFifth = vars['ToolTip/ShowToolTip'];
  share = 0.19; t.frame(1 / 30);
  out.ticketsLow = [vars['ToolTip/ShowToolTip'], vars['ToolTip/ToolTipHeading']];
  for (let i = 0; i < 30 * 15 + 3; i++) t.frame(1 / 30);
  out.ticketsOnce = vars['ToolTip/ShowToolTip'];
  out.ids = [tips.TIP_ENTER_GAME, tips.TIP_RESPAWN, tips.TIP_CLOSE_TO_FLAG, tips.TIP_TICKETLOW, tips.TICKET_LOW_SHARE];
}
{
  // Team deathmatch and CTF get no welcome (the mode is not 2 or 4).
  const vars = {}, over = {};
  let deploy = false;
  const page = { vars: () => vars, spawnVars: () => over, layout: () => ({ strings, types: [], vehicles: {} }),
                 keyLabel: () => 'T', enabled: () => true, setEnabled() {}, occupancy: null, deployActive: () => deploy,
                 soldierAlive: () => false, gameplayMode: () => 'GPM_CTF' };
  const t = tips.createToolTips(page);
  t.frame(1 / 30); deploy = true; t.frame(1 / 30);
  out.ctfWelcome = over['ToolTip/ToolTipHeading'];
}

// --- CUSTOMIZE ---------------------------------------------------------------------
import { readFileSync, existsSync } from 'node:fs';
out.generalRows = general.GENERAL_ROWS.map(r => [r.id, r.kind, r.verb]);
out.generalDefaults = general.generalValues({}, null);
out.generalRead = general.generalValues({ 'game.setToolTip': 1, 'game.setRadioToolTip': 0,
  'game.setStaticMinimap': 0, 'game.setMinimapTransparency': 84 }, [255, 0, 0]);
if (existsSync('./general-options-layout.json')) {
  const file = JSON.parse(readFileSync('./general-options-layout.json', 'utf8'));
  const panel = general.generalPanel(file);
  out.panel = {
    has: general.hasGeneralPage(file),
    rows: panel.rows.map(r => ({ id: r.id, hit: r.hit, track: r.track ?? null, mark: r.mark?.rect ?? null })),
    nav: Object.fromEntries(Object.entries(panel.nav).map(([k, v]) => [k, v.rect])),
    name: panel.name?.rect ?? null,
    drawn: panel.elements.length,
  };
  const slider = panel.rows.find(r => r.id === 'minimapTransparency');
  out.pick = [general.generalPick(slider, slider.track[0]), general.generalPick(slider, slider.track[0] + slider.track[2]),
              general.generalPick(slider, slider.track[0] + slider.track[2] / 2)];
  out.knob = [general.generalKnob(slider.track, slider, 0), general.generalKnob(slider.track, slider, 100)];
  const red = panel.rows.find(r => r.id === 'crossHairRed');
  out.pickRed = general.generalPick(red, red.track[0] + red.track[2]);
}

// --- FONT-3 and FONT-5 ---------------------------------------------------------------
// Trebuchet MS8's own rows (`Font/Trebuchet MS8.dif`): S, A, W, I, space.
const font = { meta: { baseline: 10, glyphs: {
  83: [0, 5, 1, 8, 38, 11, 43, 19], 65: [0, 7, 1, 8, 169, 0, 176, 8], 87: [0, 11, 0, 8, 66, 11, 77, 19],
  73: [0, 2, 1, 8, 0, 0, 2, 8], 32: [0, 1, 2, 0, 0, 0, 1, 1] } } };
const adv = (w, code) => { const g = text.glyphTable(font, w)[code]; return g[0] + g[1] + g[2]; };
out.scales = text.FONT_RESCALE;
out.outlineCopies = text.OUTLINE_COPIES;
out.native = [800, 1600, 1512, 3024].map(w => adv(w, 83));
out.at1920 = { S: adv(1920, 83), A: adv(1920, 65), W: adv(1920, 87), I: adv(1920, 73), space: adv(1920, 32),
               ascent: text.glyphTable(font, 1920)[65][3], drawW: text.glyphTable(font, 1920)[65][8],
               drawH: text.glyphTable(font, 1920)[65][9] };
out.at640 = adv(640, 65);
out.at1024 = adv(1024, 65);
out.at1280 = adv(1280, 65);
out.rounds = [text.roundHalfUp(7.5), text.roundHalfUp(7.49), text.roundHalfUp(10.5), text.roundHalfUp(0)];
text.setDisplayWidth(1920);
out.measure1920 = text.measureBitmapText(font, 'SAW');
out.snap1920 = [text.snapToPixel(10.1), text.snapToPixel(10.3)];
text.setDisplayWidth(800);
out.measure800 = text.measureBitmapText(font, 'SAW');
out.snap800 = text.snapToPixel(10.3);
console.log(JSON.stringify(out));
