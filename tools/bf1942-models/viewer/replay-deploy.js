// The spawn screen of a dead followed player, in a replay (sweep entry 14,
// features/replay-feature-sweep-2026-11-01): the play page's own deploy
// screen (deploy-screen.js, spawning.js), opened read-only over his first
// person while he waits to spawn, showing what he saw.
//
// What it shows, and where each part comes from:
//
//  - his side's spawn rings: the page's own (`spawning.js` `deployFlagIndices`
//    and `deploySpots`) for his side at the moment, over the level's flags as
//    the replay's round has moved them (replay-round.js sets each flag's
//    team);
//  - his pick: the spawn group and kit of his last `spawnPick` at or before
//    the moment (a server recording's, server-replay-recorder "spawnPick"),
//    the ring over the flag that holds that group. Retail keeps the map's
//    selection across lives (SPAWNGRP-12, `BfMap+0xd4`), so a pick from an
//    earlier life still stands. With no pick of his in the file (a client
//    recording, a server file older than the hook, a man who has not touched
//    the screen yet), the ring goes on the flag nearest where he next
//    spawned and the kit row on the kit he spawned with: what he must have
//    chosen, read off the outcome, and said so on the card's title;
//  - the TIME TO SPAWN plate: the seconds to his next spawn in the recording
//    (replay-chapters.js `nextSpawn`), which is the wave he made, through
//    the page's own plate (`deploy-screen.js` `paintSpawnTimer`).
//
// Only in his first person (the camera's `pov` mode), which is his own
// screen; the orbit, chase and free cameras keep their death and spawn
// framing. Escape takes it down until his next wait. Nothing on it can be
// clicked: the page's buttons would commit and spawn the page's own soldier.
//
// The top half is pure (no DOM): `deployModelAt` is what the screen shows at
// a moment, and `tests/replay_deploy_harness.mjs` runs it in node. The
// bottom half is the page's side, `createReplayDeployView`, built by map.html
// over spawning.js and deploy-screen.js, and `ReplayDeploy`, the replay's
// presenter, which drives it each frame.

import { nextSpawn, playerStatusAt, spawnsOf } from './replay-chapters.js';
import { kitAt, teamAt } from './replay-recording.js';

/** The deploy screen's rows, by `Kit/SelectedKit` (deploy-screen.js `KITS`). */
export const DEPLOY_KITS = Object.freeze(['scout', 'assault', 'antitank', 'medic', 'engineer', 'slot5']);

/** The engine's class words a kit's `class` (loadouts.json) carries, by row,
 *  for a kit the level's slots do not name. */
const CLASS_ROW = [[/scout|sniper/i, 0], [/assault/i, 1], [/anti|^at$/i, 2], [/medic/i, 3], [/engineer/i, 4]];

/** The row `kit` (a kit template) sits in for `team` on the level: its slot
 *  in `loadouts.levels[level][team].slots`, else its class's row, else null. */
export function kitRowOf(kit, team, { loadouts = null, level = null } = {}) {
  if (!kit) return null;
  const want = String(kit).toLowerCase();
  const slots = loadouts?.levels?.[level]?.[team]?.slots ?? null;
  for (const [slot, name] of Object.entries(slots ?? {})) {
    if (String(name).toLowerCase() === want && Number(slot) >= 0 && Number(slot) < DEPLOY_KITS.length) return Number(slot);
  }
  const kits = loadouts?.kits ?? {};
  const entry = kits[kit] ?? Object.entries(kits).find(([name]) => name.toLowerCase() === want)?.[1];
  const cls = String(entry?.class ?? kit);
  for (const [re, row] of CLASS_ROW) if (re.test(cls)) return row;
  return null;
}

const picksCache = new WeakMap();

/** `pid`'s last `spawnPick` at or before `t` naming a group, or null. Each
 *  player's picks are put in time order once, and looked up by halves. */
export function lastPickOf(rec, pid, t) {
  const picks = rec.spawnPicks;
  if (!picks?.length) return null;
  let byPid = picksCache.get(rec);
  if (!byPid || byPid.count !== picks.length) {
    byPid = { count: picks.length, lists: new Map() };
    for (const p of picks) {
      if (!(p.group > 0)) continue;
      if (!byPid.lists.has(p.pid)) byPid.lists.set(p.pid, []);
      byPid.lists.get(p.pid).push(p);
    }
    for (const list of byPid.lists.values()) list.sort((a, b) => a.t - b.t);
    picksCache.set(rec, byPid);
  }
  const list = byPid.lists.get(pid);
  if (!list) return null;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo ? list[lo - 1] : null;
}

/**
 * What `pid`'s spawn screen shows at `t`, or null while he is not waiting to
 * spawn (alive, gone, or not in the round). `{ team, group, kit, kitRow,
 * source, spawnAt, countdown, since }`:
 *  - `group` the spawn group his pick names (null when only the place is
 *    known), `kitRow` the deploy screen's row (null when unknown);
 *  - `source` 'recorded' for his own `spawnPick`, 'spawned' for the
 *    fallback read off his next spawn, null with neither;
 *  - `spawnAt` where his next soldier first stands, in the recording's frame
 *    (BF1942's), or null; `countdown` whole seconds to it, or null;
 *  - `since` when the wait began: his last death, else his first sight.
 */
export function deployModelAt(rec, pid, t, { kills = rec.kills, loadouts = null, level = null } = {}) {
  if (pid === null || pid === undefined || !Number.isFinite(t)) return null;
  const status = playerStatusAt(rec, pid, t, kills);
  if (status.state !== 'dead' && status.state !== 'spawning') return null;
  const team = teamAt(rec, pid, t);
  if (team !== 1 && team !== 2) return null;
  const next = nextSpawn(rec, pid, t);
  const spawnAt = next?.life?.keys?.at(0)?.p ?? null;
  const countdown = next ? Math.max(0, Math.ceil(next.t - t)) : null;
  // The wait's start: the end of his last life before now.
  let since = null;
  for (const s of spawnsOf(rec, pid)) {
    if (s.t > t) break;
    const end = s.life.diedAt ?? s.life.destroyed;
    if (Number.isFinite(end) && end <= t) since = end;
  }
  const pick = lastPickOf(rec, pid, t);
  if (pick) {
    const kitRow = Number.isInteger(pick.kit) && pick.kit >= 0 && pick.kit < DEPLOY_KITS.length ? pick.kit : null;
    return { team, group: pick.group, kit: kitRow !== null ? DEPLOY_KITS[kitRow] : null, kitRow,
             source: 'recorded', spawnAt, countdown, since, pickT: pick.t };
  }
  if (next) {
    const kit = kitAt(next.life, next.life.created);
    const kitRow = kitRowOf(kit, team, { loadouts, level });
    return { team, group: null, kit: kitRow !== null ? DEPLOY_KITS[kitRow] : null, kitRow,
             source: 'spawned', spawnAt, countdown, since, pickT: null };
  }
  return { team, group: null, kit: null, kitRow: null, source: null, spawnAt: null, countdown: null, since, pickT: null };
}

/** The key a model is redrawn on: what the screen paints of it. */
export function deployModelKey(m) {
  return m ? `${m.team}|${m.group}|${m.kitRow}|${m.source}|${m.spawnAt?.join(',') ?? ''}` : '';
}

// --- the page's side ----------------------------------------------------------

/**
 * The page's deploy screen, borrowed for a replay. Built once by map.html;
 * `page` hands in, as getters: `spawning` (its selection fields, which this
 * sets while the screen is up and puts back when it goes), `room` (whose
 * `spawnCountdown` the plate reads; wrapped while up), `flags`,
 * `refreshFlags`, `fullmapBox`, `toggleFullMap`, `layoutDeploy`,
 * `drawFullMap`, `paintDeployChrome`, `deployActive`, `deployChoiceIndex`,
 * `deployFlagIndices`, `deploySpots`.
 *
 * `show(model)` opens it on a model of `deployModelAt` (again on every
 * change), `hide()` closes it and puts the page's own state back.
 */
export function createReplayDeployView(page) {
  const view = { shown: false, model: null, flagIndex: -1 };
  let kept = null;
  let countdown = null;

  /** The offered flag of the model's side nearest its spawn: the fallback's
   *  ring. Flags are in the view's frame, the spawn in BF1942's. */
  function nearestFlag(model) {
    if (!model.spawnAt) return -1;
    const [x, , z] = model.spawnAt;
    let best = -1;
    let bestD = Infinity;
    for (const index of page.deployFlagIndices()) {
      for (const spot of page.deploySpots(page.flags[index])) {
        const p = spot.position;
        if (!p) continue;
        const d = Math.hypot(p[0] - x, p[2] + z);
        if (d < bestD) { bestD = d; best = index; }
      }
    }
    return best;
  }

  function apply(model) {
    const s = page.spawning;
    s.deployTeamId = model.team;
    s.deployRejoin = false;
    s.deployKit = model.kit ?? 'assault';
    s.deployHoverVar = null;
    s.deployHoverBtn = null;
    let choice = null;
    if (model.group) choice = { group: model.group, index: null };
    else {
      const index = nearestFlag(model);
      if (index >= 0) choice = { group: null, index };
    }
    s.deployChoice = choice;
    s.deployCommitted = choice;
    view.flagIndex = choice ? page.deployChoiceIndex() : -1;
    countdown = Number.isFinite(model.countdown)
      ? { countdown: model.countdown, prompt: '', text: '' } : null;
  }

  view.show = model => {
    if (!model) { view.hide(); return; }
    const first = !view.shown;
    if (first) {
      // The plain M map is up: leave it be.
      if (!page.fullmapBox.hidden && !page.deployActive()) return;
      // The flags the screen lists: the world's, which nothing in a replay
      // has asked the picker for yet (`capture.js` `refreshFlags`).
      page.refreshFlags?.();
      const s = page.spawning;
      kept = {
        deployTeamId: s.deployTeamId, deployRejoin: s.deployRejoin, deployKit: s.deployKit,
        deployChoice: s.deployChoice, deployCommitted: s.deployCommitted,
        deployHoverVar: s.deployHoverVar, deployHoverBtn: s.deployHoverBtn,
        spawnCountdown: page.room?.spawnCountdown ?? null,
      };
      if (page.room) {
        const own = kept.spawnCountdown;
        page.room.spawnCountdown = () => (view.shown ? countdown : own?.() ?? null);
      }
    }
    view.model = model;
    apply(model);
    if (first) {
      view.shown = true;
      page.fullmapBox.classList.add('deploy', 'replay-deploy');
      page.fullmapBox.style.pointerEvents = 'none';
      page.toggleFullMap(true);
      page.layoutDeploy();
    } else {
      page.drawFullMap(true);
      page.paintDeployChrome();
    }
  };

  view.hide = () => {
    if (!view.shown) return;
    view.shown = false;
    view.model = null;
    countdown = null;
    if (page.deployActive()) page.toggleFullMap(false);
    page.fullmapBox.classList.remove('replay-deploy');
    page.fullmapBox.style.pointerEvents = '';
    if (kept) {
      const s = page.spawning;
      for (const k of ['deployTeamId', 'deployRejoin', 'deployKit', 'deployChoice', 'deployCommitted',
                       'deployHoverVar', 'deployHoverBtn']) s[k] = kept[k];
      if (page.room && kept.spawnCountdown) page.room.spawnCountdown = kept.spawnCountdown;
      kept = null;
    }
  };

  return view;
}

// --- the replay's presenter -----------------------------------------------------

/** Drives the page's view each frame from the followed player's wait. */
export class ReplayDeploy {
  constructor(player) {
    this.player = player;
    this.view = player.ctx.deployView?.() ?? null;
    this.model = null;
    this.key = '';
    // Escape: down until his next wait (keyed by its start).
    this.dismissed = null;
    this.onKey = e => {
      if (e.code !== 'Escape' || !this.view?.shown) return;
      this.dismissed = `${this.player.followPid}|${this.model?.since ?? ''}`;
      this.view.hide();
      e.stopPropagation();
      e.preventDefault();
    };
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKey, true);
  }

  /** The model now, worked out again each frame (it is a handful of
   *  lookups by halves). */
  modelAt(t) {
    const p = this.player;
    return deployModelAt(p.rec, p.followPid, t, {
      kills: p.kills, loadouts: p.ctx.loadouts?.() ?? null, level: p.ctx.levelDir?.() ?? null,
    });
  }

  update(t) {
    if (!this.view) return;
    const p = this.player;
    const model = p.camera?.mode === 'pov' ? this.modelAt(t) : null;
    this.model = model;
    const wait = model ? `${p.followPid}|${model.since ?? ''}` : null;
    if (!model || wait === this.dismissed) {
      this.key = '';
      this.view.hide();
      return;
    }
    this.dismissed = null;
    const key = `${p.followPid}|${deployModelKey(model)}|${model.countdown}`;
    if (key === this.key && this.view.shown) return;
    this.key = key;
    this.view.show(model);
  }

  /** The state a script reads (`window.replay.deploy.state`). */
  get state() {
    return { shown: Boolean(this.view?.shown), model: this.model, flagIndex: this.view?.flagIndex ?? -1 };
  }

  dispose() {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKey, true);
    this.view?.hide();
  }
}
