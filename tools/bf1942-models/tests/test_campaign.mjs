/**
 * The single-player campaign under node (features/single-player-campaign):
 * `viewer/play/campaign.js` (the score rule, progression, saving and the
 * launch address), the campaign screen's pure half
 * (`viewer/play/campaign-screen.js`), the end-of-mission plate's pure half
 * (`viewer/campaign-debriefing.js`), SINGLEPLAY's row through
 * `viewer/play/nav-strip.js`, and the Instant Battle list's long titles
 * (`viewer/play/menu-screen.js` `fitText`).
 *
 * Run by `tests/test_campaign.py`; standalone: `node tests/test_campaign.mjs`.
 */
import assert from 'node:assert/strict';
import * as law from '../viewer/play/campaign.js';
import {
  campaignVars, difficultyFromSets, drawnElements, listArea, listOf, sliderRows,
} from '../viewer/play/campaign-screen.js';
import {
  campaignPlateVars, localRow, plateAction, plateButtons, roundOutcome, wrapLines,
} from '../viewer/campaign-debriefing.js';
import { createNavStrip } from '../viewer/play/nav-strip.js';
import { fitText, measureText } from '../viewer/play/menu-screen.js';
import { VICTORY } from '../viewer/round-state.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** A Storage stand-in. `broken` throws on every call, as a private window can. */
function memoryStorage({ broken = false } = {}) {
  const map = new Map();
  const guard = fn => (...a) => { if (broken) throw new Error('denied'); return fn(...a); };
  return {
    getItem: guard(k => (map.has(k) ? map.get(k) : null)),
    setItem: guard((k, v) => { map.set(k, String(v)); }),
    removeItem: guard(k => { map.delete(k); }),
    map,
  };
}

// --- the score rule ----------------------------------------------------------

test('the tables are the client\'s', () => {
  assert.deepEqual([...law.FLOOR], [-2, -2, -2, -2, -3, -3, -3, -3, -4, -4, -4, -4, -4, -4, -4, -4]);
  assert.deepEqual([...law.CAP], [5, 7, 9, 11, 13, 15, 17, 17, 17, 19, 20, 21, 22, 23, 24, 25]);
});

test('a win adds its victory type, a loss takes twice it, a draw nothing', () => {
  assert.equal(law.scoreDelta({ won: true, victoryType: VICTORY.minor }), 1);
  assert.equal(law.scoreDelta({ won: true, victoryType: VICTORY.major }), 2);
  assert.equal(law.scoreDelta({ won: true, victoryType: VICTORY.total }), 3);
  assert.equal(law.scoreDelta({ won: false, victoryType: VICTORY.minor }), -2);
  assert.equal(law.scoreDelta({ won: false, victoryType: VICTORY.major }), -4);
  assert.equal(law.scoreDelta({ won: false, victoryType: VICTORY.total }), -6);
  assert.equal(law.scoreDelta({ won: false, victoryType: VICTORY.draw }), 0);
  assert.equal(law.scoreDelta({ won: true, victoryType: VICTORY.none }), 0);
});

test('a lost mission still advances while the score holds its floor', () => {
  const s0 = law.newCampaign({ team: law.ALLIED });
  const s1 = law.finishMission(s0, { won: false, victoryType: VICTORY.minor });
  assert.equal(s1.score, -2);           // mission 1's floor is -2: not below it
  assert.equal(s1.over, false);
  assert.equal(s1.mission, 2);
  assert.deepEqual(s1.results.map(r => [r.mission, r.won, r.delta]), [[1, false, -2]]);
});

test('below the floor is the end: TOTAL DEFEAT, the mission does not advance', () => {
  const s0 = law.newCampaign();
  const s1 = law.finishMission(s0, { won: false, victoryType: VICTORY.major });
  assert.equal(s1.score, -4);
  assert.equal(s1.over, true);
  assert.equal(s1.finished, true);
  assert.equal(s1.mission, 1);
  assert.equal(law.finalGrade(s1), 'totalDefeat');
  assert.equal(law.missionOf(s1, [{ dir: 'battleaxe' }]), null);
});

test('the score is capped at the mission\'s ceiling after the floor test', () => {
  let s = law.newCampaign();
  for (let i = 0; i < 3; i++) s = law.acceptMission(law.finishMission(s, { won: true, victoryType: VICTORY.total }));
  // 3, 6 -> capped at mission 2's 7, then 10 -> capped at mission 3's 9.
  assert.deepEqual(s.results.map(r => r.score), [3, 6, 9]);
  assert.equal(s.score, 9);
  assert.equal(s.mission, 4);
});

test('the status bar is the score over the floor, out of the cap over it', () => {
  assert.deepEqual(law.statusBar(0, 1), { value: 2, max: 7, fraction: 2 / 7 });
  assert.equal(law.statusBar(25, 16).fraction, 1);
  assert.equal(law.statusBar(-9, 16).fraction, 0);
  // campaign.json's own tables win over the fallback.
  assert.equal(law.statusBar(0, 1, { floor: [-1], cap: [1] }).fraction, 0.5);
});

test('sixteen missions finish the campaign, and the grade is the score\'s band', () => {
  let s = law.newCampaign({ team: law.AXIS });
  for (let m = 1; m <= 16; m++) s = law.acceptMission(law.finishMission(s, { won: true, victoryType: VICTORY.major }));
  assert.equal(s.finished, true);
  assert.equal(s.over, false);
  assert.equal(s.mission, 17);
  assert.equal(s.results.length, 16);
  assert.equal(law.finalGrade(s), s.score >= 24 ? 'totalVictory' : 'majorVictory');
  const grade = score => law.finalGrade({ ...s, score });
  assert.deepEqual([-4, -3, 3, 4, 9, 10, 18, 19, 23, 24, 25].map(grade), [
    'totalDefeat', 'majorDefeat', 'majorDefeat', 'minorDefeat', 'minorDefeat', 'minorVictory',
    'minorVictory', 'majorVictory', 'majorVictory', 'totalVictory', 'totalVictory']);
  assert.equal(law.gradeTitleKey('majorVictory'), 'DEBRIEFING_MAJOR_VICTORY');
  assert.equal(law.gradeTitleKey('totalDefeat'), 'DEBRIEFING_TOTAL_DEFEAT');
});

test('the last screen\'s CampaignVictory: side and result', () => {
  assert.equal(law.campaignVictory(law.ALLIED, 'totalVictory'), 1);
  assert.equal(law.campaignVictory(law.ALLIED, 'minorVictory'), 3);
  assert.equal(law.campaignVictory(law.AXIS, 'majorVictory'), 5);
  assert.equal(law.campaignVictory(law.ALLIED, 'majorDefeat'), 8);
  assert.equal(law.campaignVictory(law.AXIS, 'totalDefeat'), 10);
});

test('REPLAY puts back the score and mission the mission started with', () => {
  const s0 = law.acceptMission(law.finishMission(law.newCampaign(), { won: true, victoryType: VICTORY.total }));
  const s1 = law.finishMission(s0, { won: false, victoryType: VICTORY.major, stats: { kills: 4, deaths: 2, score: 7 } });
  assert.equal(s1.score, -1);
  assert.equal(s1.mission, 3);
  const back = law.replayMission(s1);
  assert.equal(back.score, 3);
  assert.equal(back.mission, 2);
  assert.deepEqual(back.totals, s0.totals);
  assert.equal(back.undo, null);
  assert.equal(law.acceptMission(s1).undo, null);
});

test('the player\'s own row adds up over the campaign', () => {
  let s = law.newCampaign();
  s = law.acceptMission(law.finishMission(s, { won: true, victoryType: VICTORY.minor, stats: { kills: 3, deaths: 1, score: 5 } }));
  s = law.acceptMission(law.finishMission(s, { won: true, victoryType: VICTORY.minor, stats: { kills: 2, deaths: 4, score: 1 } }));
  assert.deepEqual(s.totals, { score: 6, kills: 5, deaths: 5 });
});

// --- saving ------------------------------------------------------------------

test('each side keeps its own campaign, and the side last picked', () => {
  const storage = memoryStorage();
  const allied = law.finishMission(law.newCampaign({ team: law.ALLIED }), { won: true, victoryType: VICTORY.minor });
  const axis = law.newCampaign({ team: law.AXIS, difficulty: { level: 4 } });
  assert.equal(law.saveCampaign(allied, storage), true);
  assert.equal(law.saveCampaign(axis, storage), true);
  assert.equal(law.loadCampaign(law.ALLIED, storage).mission, 2);
  assert.equal(law.loadCampaign(law.AXIS, storage).difficulty.aiSkill, 3);
  assert.equal(law.lastTeam(storage), law.AXIS);
  law.rememberTeam(law.ALLIED, storage);
  assert.equal(law.lastTeam(storage), law.ALLIED);
  law.clearCampaign(law.AXIS, storage);
  assert.equal(law.loadCampaign(law.AXIS, storage), null);
  // The undo snapshot survives the round trip, so REPLAY works after a reload.
  assert.equal(law.replayMission(law.loadCampaign(law.ALLIED, storage)).mission, 1);
});

test('an unreadable save, another version or a refusing browser reads as none', () => {
  const storage = memoryStorage();
  storage.setItem(law.storageKey(law.ALLIED), '{not json');
  assert.equal(law.loadCampaign(law.ALLIED, storage), null);
  storage.setItem(law.storageKey(law.ALLIED), JSON.stringify({ ...law.newCampaign(), version: 99 }));
  assert.equal(law.loadCampaign(law.ALLIED, storage), null);
  // A side's key holding the other side's campaign is not that side's.
  storage.setItem(law.storageKey(law.AXIS), JSON.stringify(law.newCampaign({ team: law.ALLIED })));
  assert.equal(law.loadCampaign(law.AXIS, storage), null);
  const broken = memoryStorage({ broken: true });
  assert.equal(law.loadCampaign(law.ALLIED, broken), null);
  assert.equal(law.saveCampaign(law.newCampaign(), broken), false);
  assert.equal(law.lastTeam(broken), law.ALLIED);
  assert.equal(law.loadCampaign(law.ALLIED, null), null);
});

test('a stored campaign is clamped back into range', () => {
  const s = law.normalise({ version: 1, team: 7, mission: 99, score: 'x', botCount: 400,
                            difficulty: { level: 1, aiSkill: 9, lives: 0, ratio: 2 } });
  assert.equal(s.team, law.ALLIED);
  assert.equal(s.mission, 17);
  assert.equal(s.score, 0);
  assert.equal(s.botCount, law.MAX_BOTS);
  assert.deepEqual([s.difficulty.aiSkill, s.difficulty.lives, s.difficulty.ratio], [4, 1, 2]);
});

// --- difficulty and the launch -----------------------------------------------

test('the presets are the page\'s, CUSTOM is the sliders\' mean', () => {
  assert.deepEqual(law.difficultyOf({ level: 2 }), { level: 2, aiSkill: 1, lives: 1, ratio: 1, overall: 25 });
  assert.deepEqual(law.difficultyOf({ level: 4 }), { level: 4, aiSkill: 3, lives: 3, ratio: 3, overall: 75 });
  assert.deepEqual(law.difficultyOf({ level: 1, aiSkill: 4, lives: 4, ratio: 4 }),
    { level: 1, aiSkill: 4, lives: 4, ratio: 4, overall: 100 });
});

test('the enemy\'s share of the bots follows the ratio, ties to the player', () => {
  assert.equal(law.enemyBots(4, 1), 2);   // 3 v 2 with the player, Instant Battle's split
  assert.equal(law.enemyBots(4, 2), 3);
  assert.equal(law.enemyBots(4, 3), 3);
  assert.equal(law.enemyBots(4, 4), 4);
  assert.equal(law.enemyBots(0, 4), 0);
  assert.equal(law.enemyBots(9, 1), 5);
  const teams = law.botTeams(8, 5, 2, 1);
  assert.equal(teams.length, 8);
  assert.equal(teams.filter(t => t === 1).length, 5);
  assert.equal(teams.filter(t => t === 2).length, 3);
  assert.deepEqual(law.botTeams(3, 0, 2, 1), [2, 2, 2]);
});

test('a mission launches on its level, side, layer, tickets and difficulty', () => {
  const state = law.newCampaign({ team: law.AXIS, difficulty: { level: 4 }, botCount: 6 });
  const levels = { battleaxe: { axis: { tickets: { team1: 100, team2: 120, lossPerMin: { team1: 15, team2: 30 } } } } };
  const url = new URL(law.launchUrl(state, {
    root: '../', base: 'https://play.example/play/index.html',
    entry: { name: 'Battleaxe' }, mission: { dir: 'battleaxe' }, levels,
  }));
  assert.equal(url.pathname, '/map.html');
  const q = Object.fromEntries(url.searchParams);
  assert.deepEqual(q, {
    map: 'Battleaxe', team: '1', mode: 'CoOp', botCount: '6', botSkill: '0.75',
    enemyBots: String(law.enemyBots(6, 3)), tickets: '100,120', lossPerMin: '15,30',
    deathPenalty: '10', campaign: '1',
  });
  assert.deepEqual(law.parsePair(q.tickets), { team1: 100, team2: 120 });
  assert.equal(law.parsePair('a,1'), null);
  assert.equal(law.parsePair(null), null);
  assert.equal(law.launchUrl(state, { entry: null }), null);
});

// --- the campaign screen's page ----------------------------------------------

/** `menu/CampaignMenu` as extract_main_menu_layout.py writes it, cut to the
 *  rows the screen reads (the rects are the file's). */
const sets = (level, ai, lives, ratio, overall) => [
  { var: 'Campaign/CampaignDifficultyLevel', value: level },
  ...(ai ? [{ var: 'Campaign/CampaignAiSkill', value: ai }, { var: 'Campaign/CampaignNrOfLives', value: lives },
    { var: 'Campaign/CampaignBotRatio', value: ratio }, { var: 'Campaign/CampaignOverallDifficulty', value: overall }] : []),
];
const sliderRow = (y, key) => [
  { kind: 'text', rect: [42, y, 160, 20], key, text: key },
  { kind: 'fill', rect: [205, y - 2, 50, 11] }, { kind: 'fill', rect: [206, y - 1, 48, 9] },
  { kind: 'fill', rect: [265, y - 6, 70, 19] }, { kind: 'fill', rect: [266, y - 5, 68, 17] },
  { kind: 'text', rect: [267, y - 1, 65, 20], key: 'SINGLEPLAYER_EASY', text: 'EASY',
    when: [{ var: 'Campaign/CampaignAiSkill', op: 'eq', value: 1 }] },
];
const campaignPage = { elements: [
  { kind: 'hit', rect: [31, 153, 146, 14], sets: sets(1) },
  { kind: 'hit', rect: [31, 170, 146, 14], sets: sets(2, 1, 1, 1, 25) },
  { kind: 'text', rect: [276, 176, 28, 20], text: '%' },
  ...sliderRow(245, 'SINGLEPLAYER_AI_SKILLS'),
  ...sliderRow(275, 'SINGLEPLAYER_NR_OF_LIVES'),
  ...sliderRow(305, 'SINGLEPLAYER_BOT_RATIO'),
  { kind: 'text', rect: [42, 375, 160, 40], key: 'GENERAL_OPTIONS_PERCENTAGE_OF_BOTS', text: 'NUMBER OF BOTS:' },
  { kind: 'fill', rect: [205, 373, 50, 11] }, { kind: 'fill', rect: [206, 374, 48, 9] },
  { kind: 'fill', rect: [265, 369, 32, 19] }, { kind: 'fill', rect: [266, 370, 30, 17] },
  { kind: 'edit', rect: [269, 374, 28, 20], var: 'Options/General/CampaignPercentageOfBots' },
  { kind: 'text', rect: [302, 375, 115, 20], text: '%' },
  { kind: 'text', rect: [42, 400, 160, 40], key: 'GENERAL_OPTIONS_PERCENTAGE_OF_CPU', text: 'CPU-TIME GIVEN TO AI:' },
  { kind: 'fill', rect: [205, 398, 50, 11] }, { kind: 'fill', rect: [266, 395, 30, 17] },
  { kind: 'edit', rect: [269, 399, 28, 20], var: 'Options/General/CampaignPercentageOfCpu' },
  { kind: 'text', rect: [302, 400, 115, 20], text: '%' },
  { kind: 'fill', rect: [555, 272, 10, 145] },
  { kind: 'listbox', rect: [389, 249, 178, 185], data: 'Campaign/CampaignLevelsList', rowHeight: 14,
    rows: { top: 264, bottom: 422, count: 11 }, font: 'standard6', scrollbarOffset: 4,
    select: [0, 0.1875, 0.5389, 1] },
] };

test('the slider rows are read off the page by their labels', () => {
  const rows = sliderRows(campaignPage);
  assert.deepEqual(Object.keys(rows).sort(), ['aiSkill', 'bots', 'lives', 'ratio']);
  assert.deepEqual(rows.aiSkill.trough, [206, 244, 48, 9]);
  assert.deepEqual(rows.aiSkill.box, [266, 240, 68, 17]);
  assert.deepEqual(rows.bots.box, [266, 370, 30, 17]);
});

test('the CPU row and the bot row\'s percentage are not drawn; OVERALL\'s % is', () => {
  const drawn = drawnElements(campaignPage);
  assert.ok(!drawn.some(el => el.key === 'GENERAL_OPTIONS_PERCENTAGE_OF_CPU'));
  assert.ok(!drawn.some(el => el.rect[1] >= 394 && el.rect[1] < 406));
  assert.ok(!drawn.some(el => el.kind === 'edit'));
  assert.ok(drawn.some(el => el.text === '%' && el.rect[1] === 176));
  assert.ok(!drawn.some(el => el.text === '%' && el.rect[1] === 375));
  assert.ok(drawn.some(el => el.key === 'GENERAL_OPTIONS_PERCENTAGE_OF_BOTS'));
});

test('the LEVELS list sits in its plate\'s well, left of its track', () => {
  const box = listOf(campaignPage, 'Campaign/CampaignLevelsList');
  const area = listArea(campaignPage, box);
  assert.deepEqual([area.x, area.y, area.w, area.h], [389, 264, 166, 158]);
  assert.equal(Math.floor(area.h / box.rowHeight), 11);
});

test('the page\'s conditions read the screen\'s state', () => {
  const d = law.difficultyOf({ level: 3 });
  const v = campaignVars({ X: 1 }, { mode: 'new', team: 1, saved: null, difficulty: d });
  assert.equal(v['Campaign/NewCampaignFlag'], true);
  assert.equal(v['Campaign/DisableContinueCampaign'], true);
  assert.equal(v['Campaign/Team'], 1);
  assert.equal(v['Campaign/CampaignOverallDifficulty'], 50);
  assert.equal(v.X, 1);
  const saved = { ...law.newCampaign(), finished: true };
  const w = campaignVars({}, { mode: 'continue', team: 2, saved, difficulty: d });
  assert.equal(w['Campaign/NewCampaignFlag'], false);
  assert.equal(w['Campaign/FinishedCampaign'], true);
});

test('a difficulty row\'s sets choose the preset; CUSTOM keeps the sliders', () => {
  const now = law.difficultyOf({ level: 1, aiSkill: 4, lives: 2, ratio: 3 });
  assert.deepEqual(difficultyFromSets(sets(2, 1, 1, 1, 25), now), law.difficultyOf({ level: 2 }));
  const custom = difficultyFromSets(sets(1), now);
  assert.deepEqual([custom.level, custom.aiSkill, custom.lives, custom.ratio], [1, 4, 2, 3]);
  assert.equal(difficultyFromSets([{ var: 'Campaign/Team', value: 1 }], now), null);
});

// --- SINGLEPLAY's row --------------------------------------------------------

const CLICKED = 'Navigation/Level1/MouseClickedIndex';
const navLayout = {
  virtual: [800, 600],
  variables: { 'Navigation/NavigationY': 33, InhibitMenuBehavior: 0 },
  pages: {
    mainNav: { elements: [
      { kind: 'button', rect: [21, 33, 107, 24], texture: 'knapp_n', hover: 'knapp_mo', pressed: 'knapp_mc' },
      { kind: 'button', rect: [21, 33, 107, 24], texture: 'knapp_n', color: [0, 0, 0, 0.6],
        when: [{ op: 'and', terms: [{ var: CLICKED, op: 'ne', value: 2 },
                                    { var: 'Navigation/NavigationY', op: 'lt', value: 74 }] }] },
      { kind: 'text', rect: [29, 42, 97, 18], key: 'MENU_SINGLEPLAY', text: 'SINGLEPLAY', font: 'standard6' },
    ] },
    // The file's own rows: two plates a slot (one with the call, one under
    // the label), the label, all at the strip's level-3 Y.
    singleplayerNav: { elements: [
      { kind: 'button', rect: [129, 59, 107, 24], texture: 'knapp2_n', hover: 'knapp_mo', pressed: 'knapp_mc',
        calls: ['Skirmish/InitSkirmish'], when: [{ var: 'InhibitMenuBehavior', op: 'ne', value: 4 }] },
      { kind: 'button', rect: [21, 59, 107, 24], texture: 'knapp2_n', hover: 'knapp_mo', pressed: 'knapp_mc',
        calls: ['Campaign/InitCampaign'], when: [{ var: 'InhibitMenuBehavior', op: 'ne', value: 4 }] },
      { kind: 'button', rect: [129, 59, 107, 24], texture: 'knapp2_n', hover: 'knapp_mo', pressed: 'knapp_mc',
        calls: [], when: [{ var: 'InhibitMenuBehavior', op: 'ne', value: 4 }] },
      { kind: 'text', rect: [137, 68, 97, 18], key: 'MENU_SKIRMISH', text: 'INSTANT BATTLE', font: 'standard6',
        when: [{ var: 'InhibitMenuBehavior', op: 'ne', value: 4 }] },
      { kind: 'text', rect: [29, 68, 97, 18], key: 'MENU_CAMPAIGN', text: 'CAMPAIGN', font: 'standard6',
        when: [{ var: 'InhibitMenuBehavior', op: 'ne', value: 4 }] },
    ] },
  },
};

function stubCtx() {
  const calls = [];
  return {
    calls,
    globalAlpha: 1, imageSmoothingEnabled: true, fillStyle: '#000',
    fillRect: () => {},
    drawImage: (img, ...rest) => calls.push({ img: img.name, rest }),
  };
}
const stubEnv = () => ({
  texture: name => ({ name, width: 107, height: 24 }),
  font: () => null, tint: () => null, hover: null,
});

test('SINGLEPLAY\'s row: CAMPAIGN and INSTANT BATTLE in the file\'s slots', () => {
  let available = false;
  const picks = [];
  const rows = [
    { page: 'mainNav', items: [{ key: 'MENU_SINGLEPLAY', id: 'singleplay' }] },
    { page: 'singleplayerNav', items: [
      { key: 'MENU_CAMPAIGN', id: 'campaign', enabled: () => available },
      { key: 'MENU_SKIRMISH', id: 'instant' }] },
  ];
  const strip = createNavStrip({ layout: navLayout, env: stubEnv(), rows, active: 'singleplay',
                                 onPick: id => picks.push(id) });
  const ids = strip.buttons.map(b => [b.id, b.rect[0], b.rect[1], b.text]);
  assert.deepEqual(ids, [['singleplay', 21, 33, 'SINGLEPLAY'], ['campaign', 21, 59, 'CAMPAIGN'],
                         ['instant', 129, 59, 'INSTANT BATTLE']]);
  // CAMPAIGN is neither drawn nor clickable until its screen has loaded.
  assert.equal(strip.click(30, 70), false);
  available = true;
  assert.equal(strip.click(30, 70), true);
  assert.equal(strip.click(140, 70), true);
  assert.deepEqual(picks, ['campaign', 'instant']);
  // The chosen sub-row button is painted again on its clicked plate.
  const ctx = stubCtx();
  strip.paintChosen(ctx, 'instant');
  assert.deepEqual(ctx.calls.map(c => c.img), ['knapp_mc', 'knapp_mc']);
  const none = stubCtx();
  available = false;
  strip.paintChosen(none, 'campaign');
  assert.equal(none.calls.length, 0);
});

test('a pack without the campaign\'s row draws SINGLEPLAY alone', () => {
  const layout = { ...navLayout, pages: { mainNav: navLayout.pages.mainNav } };
  const strip = createNavStrip({ layout, env: stubEnv(), active: 'singleplay', rows: [
    { page: 'mainNav', items: [{ key: 'MENU_SINGLEPLAY', id: 'singleplay' }] },
    { page: 'singleplayerNav', items: [{ key: 'MENU_CAMPAIGN', id: 'campaign' }] }] });
  assert.deepEqual(strip.buttons.map(b => b.id), ['singleplay']);
});

// --- the end-of-mission plate ------------------------------------------------

const MISSION = [{ op: 'or', terms: [{ var: 'ShowDebriefing', op: 'eq', value: 1 }, { var: 'ShowDebriefing', op: 'eq', value: 2 }] }];
const CAMPAIGN_ARM = { op: 'or', terms: [{ var: 'StartingGame', op: 'eq', value: 1 }, { var: 'StartingGame', op: 'eq', value: 4 }] };
const SKIRMISH_ARM = { var: 'StartingGame', op: 'eq', value: 0 };
const FINAL = [{ var: 'ShowDebriefing', op: 'eq', value: 3 }, { var: 'Debriefing/ShowCampaignDebriefing', op: 'eq', value: true }];
const plate = [
  { kind: 'button', rect: [172, 542, 109, 25], id: 'DEBRIEFING_DONE', when: [...MISSION, CAMPAIGN_ARM] },
  { kind: 'button', rect: [362, 542, 109, 25], id: 'DEBRIEFING_REPLAY', when: [...MISSION, CAMPAIGN_ARM] },
  { kind: 'button', rect: [552, 542, 109, 25], id: 'DEBRIEFING_CONTINUE', when: [...MISSION, CAMPAIGN_ARM] },
  { kind: 'button', rect: [172, 542, 109, 25], id: 'DEBRIEFING_ABORT', when: [...MISSION, SKIRMISH_ARM] },
  { kind: 'button', rect: [362, 542, 109, 25], id: 'DEBRIEFING_DONE', when: FINAL },
];

test('a mission\'s plate: the campaign\'s three buttons and its bar', () => {
  const state = law.finishMission(law.newCampaign(), { won: true, victoryType: VICTORY.major });
  const vars = campaignPlateVars({ StartingGame: 2 }, { title: 'MAJOR VICTORY', line: 'Held.', state, mission: 1 });
  assert.equal(vars.StartingGame, 1);
  assert.equal(vars.ShowDebriefing, 1);
  assert.equal(vars['Debriefing/DebriefingHeading'], 'MAJOR VICTORY');
  assert.equal(vars.CampaignScore, 4);    // 2 over mission 1's floor of -2
  assert.equal(vars.MaxCampaignScore, 7);
  assert.deepEqual(plateButtons(plate, vars).map(b => b.id), ['DEBRIEFING_DONE', 'DEBRIEFING_REPLAY', 'DEBRIEFING_CONTINUE']);
  assert.equal(plateAction(plate, vars, 180, 550), 'done');
  assert.equal(plateAction(plate, vars, 370, 550), 'replay');
  assert.equal(plateAction(plate, vars, 560, 550), 'continue');
  assert.equal(plateAction(plate, vars, 10, 10), null);
});

test('the last screen: its picture until a click, then FINAL CAMPAIGN STATUS and DONE', () => {
  const state = { ...law.newCampaign({ team: law.AXIS }), score: 20, finished: true, mission: 17 };
  const pic = campaignPlateVars({}, { state, mission: 16, final: true, picture: true });
  assert.equal(pic.ShowDebriefing, 3);
  assert.equal(pic.CampaignVictory, law.campaignVictory(law.AXIS, 'majorVictory'));
  assert.equal(plateAction(plate, pic, 400, 300), 'reveal');
  const shown = campaignPlateVars({}, { state, mission: 16, final: true, picture: false });
  assert.deepEqual(plateButtons(plate, shown).map(b => b.id), ['DEBRIEFING_DONE']);
  assert.equal(plateAction(plate, shown, 370, 550), 'done');
});

test('the round\'s result and the player\'s row as the campaign takes them', () => {
  assert.deepEqual(roundOutcome({ winner: 2, victoryType: VICTORY.total }, 2), { won: true, victoryType: VICTORY.total });
  assert.deepEqual(roundOutcome({ winner: 1, victoryType: VICTORY.minor }, 2), { won: false, victoryType: VICTORY.minor });
  assert.deepEqual(roundOutcome({ winner: 0, victoryType: VICTORY.draw }, 2), { won: false, victoryType: VICTORY.draw });
  assert.equal(localRow([{ name: 'bot', key: 'b1' }, { name: 'me', key: 'local' }]).name, 'me');
  assert.equal(localRow(null), null);
});

test('the level\'s line wraps to the plate', () => {
  const measure = t => t.length;
  assert.deepEqual(wrapLines(measure, 'aaa bbb ccc\n\nddd', 7), ['aaa bbb', 'ccc', '', 'ddd']);
  assert.deepEqual(wrapLines(measure, '', 7), []);
});

// --- a long title in Instant Battle's list -----------------------------------

test('a title too long for its row stops short of what is beside it', () => {
  // A face whose every glyph advances 6 units.
  const glyphs = {};
  for (let c = 32; c < 127; c++) glyphs[c] = [0, 5, 1, 7, 0, 0, 1, 1];
  const font = { meta: { glyphs, baseline: 7 } };
  const title = 'INVASION OF THE PHILIPPINES';
  assert.equal(fitText(font, title, 1000), title);
  const cut = fitText(font, title, 120);
  assert.ok(cut.endsWith('...'));
  assert.ok(measureText(font, cut) <= 120);
  assert.ok(title.startsWith(cut.slice(0, -3)));
  assert.equal(fitText(null, title, 10), title);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); } catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
if (failed) { console.error(`${failed} of ${tests.length} failed`); process.exit(1); }
console.log(`campaign: ok (${tests.length})`);
