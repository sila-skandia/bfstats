// Capture progress rings: the page's own addition, not retail's.
//
// Retail draws no capture progress for a control point. The client's map
// update (BF1942.exe `BfMap::update` 0x0046a680) walks the control points
// only to raise the capture flag beneath the minimap (HUD-15), and the one
// progress ring it draws, `Minimap/Objectives/Objective000..100.dds` (loaded
// into BfMap +0xa4..+0xc4 by the ctor at 0x0046e4f6..0x0046e5ab), is
// ObjectiveMode's: at 0x0046c84c..0x0046c9fd it lists the objective manager's
// objects ([0x0098fffc]), keeps those whose template answers the objective
// IID (0x94b5, OBJ-6), and draws frame `trunc((1 - completion) * 8 + 0.5)`
// (0x0046c93e..0x0046c955: fsubr 1.0, fmul 8.0, fadd 0.5, `_ftol` 0x00804af0)
// at the objective's position, 32 units wide, where `completion` is its
// `getCompletion` (vt +0xf0, DestroyTargetObjective 0x005558d0: 1 - hp/maxHp,
// or the networked value on a client). So a whole target is a full ring and
// the ring empties as it is destroyed (ledger OBJ-7).
//
// The owner asked for the same art around the control points (2026-10-25):
// a ring that fills in the taking side's colour while a point is being
// taken, and drains in the holder's while it is being run down. Nothing here
// changes a law or anything sent to a server. The control point's ghost body
// carries only its team and its spawns-enabled byte (wire.md, decodes/
// control-point.md), never a timer, so on a server the ring is the page's
// own ESTIMATE: the server's capture law (`control-point-law.js`, ledger
// AI-100, AI-115, AI-142, FHR-1, FHR-4) run over the server's own positions
// of the players this client is sent, and put back to the server's word the
// moment a point's team changes on the wire. In solo play the page runs the
// law itself (bot-referee.js `captureTick`), so the ring is the law's own
// state. In a replay it is the same estimate over the recording's positions.
//
// What the estimate cannot see: a player the server does not send this
// client (an enemy beyond his ghost scope, round-replay-capture section 19),
// and the timers' state at the moment this client joined. A point far from
// the player can therefore run slow or not at all; the server's word puts it
// right when the point changes hands. Measured on the lab: see
// features/capture-progress-rings.

import { captureRadius, controlPointSettings, controlPointStep } from './control-point-law.js';
import { createMapSprites } from './map-sprites.js';


/** The nine frames, empty to full (`extract_hud_pack.py` names them). */
export const RING_SPRITES = ['000', '012', '025', '037', '050', '062', '075', '087', '100']
  .map(f => `objective${f}`);

/** The frame for a fraction in [0, 1], rounded the way the client picks an
 *  objective's: `trunc(x * 8 + 0.5)`. */
export function ringSprite(fraction) {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return RING_SPRITES[Math.floor(f * 8 + 0.5)];
}

/** What the law's state on a point shows, or null when nothing is moving.
 *  `point` is a flag-like object carrying its settings, its `team` and the
 *  law's state `_cp` (`controlPointStep`): state 3 is being taken (the get
 *  timer +0x16c running for the team at +0x170), state 2 being run down (the
 *  lose timer +0x168), state 1 lost (`lostControl`). Returns
 *  `{ kind, team, fraction }`: `getting` fills in the taker's colour,
 *  `losing` drains in the holder's. */
export function captureProgress(point) {
  const cp = point?._cp;
  if (!cp) return null;
  const cfg = controlPointSettings(point);
  if (cp.state === 3 && cp.getting) {
    const fraction = cfg.timeToGet > 0 ? 1 - cp.get / cfg.timeToGet : 1;
    return { kind: 'getting', team: cp.getting, fraction: clamp01(fraction) };
  }
  const owner = point.team ?? 0;
  if (cp.state === 2 && owner) {
    const fraction = cfg.timeToLose > 0 ? cp.lose / cfg.timeToLose : 0;
    return { kind: 'losing', team: owner, fraction: clamp01(fraction) };
  }
  if (cp.state === 1 && owner) return { kind: 'losing', team: owner, fraction: 0 };
  return null;
}

function clamp01(v) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

// The template words the law reads, copied onto the estimate's own point.
const SETTINGS = [
  'radius', 'timeToGetControl', 'timeToLoseControl', 'disableIfEnemyInsideRadius',
  'disableWhenLosingControl', 'loseControlWhenEnemyClose', 'loseControlWhenNotClose',
  'minNrToTakeControl', 'onlyTakeableByTeam', 'uncapturable',
];

/** The law's state the moment a point's team changes: `gotControl`
 *  0x08283f70 and `control` reset both timers and hold (state 4);
 *  `lostControl` 0x08284090 leaves the point neutral in state 1 with its lose
 *  timer spent and its get timer as `control` last set it, full. */
function stateAfter(team, cfg) {
  return team
    ? { state: 4, get: cfg.timeToGet, lose: cfg.timeToLose, getting: 0 }
    : { state: 1, get: cfg.timeToGet, lose: 0, getting: 0 };
}

/** How long the shadow keeps a change of its own the server has not
 *  confirmed: a round trip and a ghost block or two. Past it, the server's
 *  team stands (it saw a player this page was not sent). */
export const UNCONFIRMED_GRACE = 2;

/**
 * The estimate: one shadow point per control point, stepped by the law over
 * the players this page knows of.
 *
 * `step(points, players, dt, now)`: `points` the page's flags (each with
 * `controlPointName`, `position` and the template words; `team` is the
 * server's word), `players` `[{ team, pos: [x, y, z] }]` for every living
 * player in the page's frame (a seated one at his hull), `dt` seconds of
 * server time, `now` that clock.
 *
 * The shadow runs ahead of the word: when its law loses or takes the point
 * it moves on (a lost point starts its get timer at once, as the server's
 * does), and the word, when it comes, finds it already there. A word the
 * shadow did not see coming puts it to the law's state after that change.
 * A change of its own the server has not confirmed within
 * `UNCONFIRMED_GRACE` seconds is dropped for the server's team. Each word is
 * logged in `corrections` with how early the estimate was (`lead`, seconds;
 * negative when the word came first, by the timer the shadow still had).
 */
export function createCaptureEstimate() {
  const shadows = new Map();     // controlPointName -> shadow point
  const corrections = [];
  let pointsRef = null;

  function shadowOf(flag) {
    const key = flag.controlPointName;
    let s = shadows.get(key);
    if (!s) {
      s = { controlPointName: key, team: flag.team ?? 0, word: flag.team ?? 0, position: flag.position, predicted: [] };
      shadows.set(key, s);
    }
    for (const k of SETTINGS) s[k] = flag[k];
    s.position = flag.position;
    return s;
  }

  function hear(s, word, now) {
    const cfg = controlPointSettings(s);
    const kind = word ? 'got' : 'lost';
    const i = s.predicted.findIndex(p => p.team === word);
    let lead = null;
    if (i >= 0) {
      lead = now - s.predicted[i].at;
      s.predicted.splice(0, i + 1);
    } else {
      const cp = s._cp;
      if (kind === 'got' && cp?.state === 3 && cp.getting === word) lead = -Math.max(0, cp.get);
      else if (kind === 'lost' && cp?.state === 2) lead = -Math.max(0, cp.lose);
      s.predicted.length = 0;
    }
    corrections.push({ name: s.controlPointName, from: s.word, to: word, at: now, lead });
    if (corrections.length > 200) corrections.shift();
    s.word = word;
    // Already there by its own law: keep its state (a lost point's get timer
    // is running). Otherwise the law's state after the change the server made.
    if (s.team !== word || i < 0) { s.team = word; s._cp = stateAfter(word, cfg); }
  }

  function step(points, players, dt, now = 0) {
    if (points !== pointsRef) { shadows.clear(); pointsRef = points; }
    if (!points?.length) return;
    for (const flag of points) {
      if (flag?.controlPointName == null || !flag.position) continue;
      const s = shadowOf(flag);
      const word = flag.team ?? 0;
      if (word !== s.word) hear(s, word, now);
      // Its own change, unconfirmed too long: the server's team stands.
      if (s.team !== s.word && s.predicted.length && now - s.predicted[0].at > UNCONFIRMED_GRACE) {
        s.team = s.word;
        s._cp = stateAfter(s.word, controlPointSettings(s));
        s.predicted.length = 0;
      }
      if (!(dt > 0)) continue;
      const r = captureRadius(s);
      const inside = [];
      for (const p of players) {
        if (!p?.team || !p.pos) continue;
        const dy = Number.isFinite(p.pos[1]) ? p.pos[1] - s.position[1] : 0;
        if (Math.hypot(p.pos[0] - s.position[0], dy, p.pos[2] - s.position[2]) <= r) inside.push(p.team);
      }
      const ev = controlPointStep(s, inside, dt);
      if (ev) s.predicted.push({ team: ev.got ?? 0, at: now });
    }
  }

  /** The ring of one point by its control point name, or null. A take the
   *  server has not yet confirmed shows the full ring in the taker's colour. */
  function progressOf(name) {
    const s = shadows.get(name);
    if (!s) return null;
    if (s.team && s.team !== s.word) return { kind: 'getting', team: s.team, fraction: 1 };
    return captureProgress(s);
  }

  return {
    step,
    progressOf,
    corrections,
    shadows,
    reset() { shadows.clear(); pointsRef = null; corrections.length = 0; },
  };
}

/**
 * The page's rings, from whichever source it has:
 *  - a replay: the estimate over the recording's positions, stepped on the
 *    replay's clock, re-run from a little before the clock after a seek;
 *  - a real server or a room: the estimate over the server's newest
 *    positions of every player the client knows (the local player as the
 *    server has him), stepped on the server's clock;
 *  - solo play: the law's own state on the flags (the referee runs it).
 *
 * `page` getters: `flags`, `world`, `LOCAL_PLAYER`, `roomJoined`,
 * `roomClient`, `replayCapture` (a function returning
 * `{ t, playersAt(t) }` while a replay plays, else null), `capturePosition`,
 * `soldierDead`, `sprite` (the HUD pack's lookup) and `teamTint` (the map's
 * side colours).
 */
export function createCaptureRings(page) {
  const estimate = createCaptureEstimate();
  let source = null;        // 'solo' | 'net' | 'replay'
  let lastClock = null;
  let serverSeen = null;    // the newest server clock and the page time it was read at
  let lastKey = '';

  function netPlayers(client) {
    const out = [];
    const slots = [...(client.remoteSlots?.() ?? [])];
    if (Number.isInteger(client.slot)) slots.push(client.slot);
    for (const slot of slots) {
      // The newest sample (`remotePlayerAtTime(slot, null)`): the server's
      // position, not the drawn one a render delay behind it.
      const p = client.remotePlayerAtTime ? client.remotePlayerAtTime(slot, null) : client.remotePlayer?.(slot);
      if (!p?.alive || !p.team || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      out.push({ team: p.team, pos: [p.x, p.y ?? 0, p.z] });
    }
    return out;
  }

  const CARRY_LIMIT = 60;   // seconds the page's clock may carry the server's
  const REPLAY_WARM = 25;   // seconds of law run in before the clock after a seek (a get and a lose of 10 s each, and some)
  const REPLAY_STEP = 0.2;

  function tickReplay(rc) {
    const t = rc.t;
    if (!Number.isFinite(t)) return;
    const flags = page.flags ?? [];
    if (source !== 'replay' || lastClock == null || t < lastClock || t - lastClock > 1) {
      estimate.reset();
      source = 'replay';
      lastClock = t - REPLAY_WARM;
    }
    // The teams the round has at the clock are already on the flags
    // (replay-round.js); the law runs over the positions between.
    for (let at = lastClock + REPLAY_STEP; at <= t + 1e-6; at += REPLAY_STEP) {
      estimate.step(flags, rc.playersAt(at) ?? [], REPLAY_STEP, at);
      lastClock = at;
    }
  }

  /** Once a frame. */
  function tick() {
    try {
      const rc = page.replayCapture?.() ?? null;
      if (rc) { tickReplay(rc); return; }
      const client = page.roomJoined ? page.roomClient : null;
      if (client) {
        const server = typeof client.clock === 'function' ? client.clock() : null;
        if (source !== 'net') { estimate.reset(); source = 'net'; lastClock = null; serverSeen = null; }
        if (!Number.isFinite(server)) return;
        // The server's clock moves only with the rows it sends (a block that
        // moved nothing writes none: a man standing on a flag sends nothing),
        // so between rows it is carried on by the page's own.
        const wall = (page.now?.() ?? performance.now()) / 1000;
        if (serverSeen?.clock !== server) serverSeen = { clock: server, wall };
        const clock = server + Math.min(CARRY_LIMIT, Math.max(0, wall - serverSeen.wall));
        // A clock that jumps (a level change, a rejoin) restarts the run.
        if (lastClock != null && (clock < lastClock - 1 || clock - lastClock > 2)) { estimate.reset(); lastClock = null; }
        const dt = lastClock == null ? 0 : Math.max(0, clock - lastClock);
        lastClock = lastClock == null ? clock : Math.max(lastClock, clock);
        estimate.step(page.flags ?? [], netPlayers(client), dt, lastClock);
        return;
      }
      if (source !== 'solo') { estimate.reset(); source = 'solo'; lastClock = null; }
    } catch (e) {
      console.warn('[capture-rings] estimate skipped:', e?.message ?? e);
    }
  }

  function flagByName(name) {
    return (page.flags ?? []).find(f => f.controlPointName === name) ?? null;
  }

  /** The ring a control point (by its scene name) shows, or null:
   *  `{ sprite, team, fraction, kind }`. */
  function ringFor(name) {
    let p = null;
    if (source === 'solo') {
      const flag = flagByName(name);
      p = flag ? captureProgress(flag) : null;
    } else {
      p = estimate.progressOf(name);
    }
    return p ? { ...p, sprite: ringSprite(p.fraction) } : null;
  }

  /** The ring of the point whose radius holds the local player (his
   *  controlled object, as HUD-15 measures it), or null: what the HUD draws
   *  over the capture flag's place. The nearest one with a ring wins. */
  function hudRing() {
    const pos = page.capturePosition?.();
    if (!pos) return null;
    let best = null, bestD = Infinity;
    for (const flag of page.flags ?? []) {
      if (flag?.controlPointName == null || !flag.position) continue;
      const d = Math.hypot(pos.x - flag.position[0], (Number.isFinite(pos.y) ? pos.y - flag.position[1] : 0),
        pos.z - flag.position[2]);
      if (d > captureRadius(flag) || d >= bestD) continue;
      const ring = ringFor(flag.controlPointName);
      if (ring) { best = ring; bestD = d; }
    }
    return best;
  }

  /** A key that changes when any drawn ring does: the map surfaces' and the
   *  HUD's repaint keys take it. */
  function key() {
    let k = '';
    for (const flag of page.flags ?? []) {
      if (flag?.controlPointName == null) continue;
      const r = ringFor(flag.controlPointName);
      if (r) k += `${flag.controlPointName}:${r.team}:${r.sprite};`;
    }
    lastKey = k;
    return k;
  }

  /** The HUD's ring: drawn over the place of the capture flag beneath the
   *  minimap (the layout's `ShowFlagIcon` picture, HUD-15), the same 64
   *  units, so the ring sits on the flag disc's rim. Shown while the local
   *  player stands in a point's radius and that point's ring moves, whether
   *  or not the flag itself is up (it is not on his own side's point being
   *  run down). A Hud overlay (`hud.js` `overlays`). */
  const tints = createMapSprites({ sprite: name => page.sprite?.(name) ?? null });
  let flagRect = null;
  function hudFlagRect(hud) {
    if (flagRect && flagRect.layout === hud.layout) return flagRect.rect;
    let rect = null;
    for (const group of Object.values(hud.layout?.groups ?? {})) {
      for (const el of group.elements ?? []) {
        if (el.kind !== 'picture' || el.texture !== 'icon_flag' || !el.rect) continue;
        // The plain flag's leaf (not the CTF layout's left-hand twin).
        if (!rect || JSON.stringify(el.when ?? []).includes('"op":"and"')) rect = el.rect;
      }
    }
    flagRect = { layout: hud.layout, rect: rect ?? [720, 230, 64, 64] };
    return flagRect.rect;
  }
  let hudShown = '';
  const hudOverlay = {
    key() {
      const r = page.soldierDead ? null : hudRing();
      hudShown = r ? `${r.team}:${r.sprite}` : '';
      return hudShown;
    },
    paint(ctx, hud) {
      if (!hudShown) return;
      const r = page.soldierDead ? null : hudRing();
      if (!r) return;
      // The map's side colours (`map-surfaces.js` MINIMAP_TEAM_TINT).
      const img = tints.tintedSprite(r.sprite, page.teamTint?.[r.team] ?? [255, 255, 255]);
      if (!img) return;
      const [x, y, w, h] = hudFlagRect(hud);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, x, y, w, h);
    },
  };

  return {
    tick,
    ringFor,
    hudRing,
    hudOverlay,
    key,
    estimate,
    source: () => source,
    lastKey: () => lastKey,
  };
}
