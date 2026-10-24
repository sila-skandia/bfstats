// The 3D name tags on the page: who the candidates are (the page's own bots
// offline, the server's rows in a room or through the sidecar), the aim ray
// that lights a tag under the crosshair, and the paint, in `Font/BF1942.font`
// on a canvas between the 3D view and the HUD. The law is `nametags.js`
// (ledger HUD-16..HUD-22); this file only feeds it and draws its answer.

import * as THREE from 'three';
import { loadConsoleFont, drawFontLine } from './console-view.js';
import { meetSoldier } from './skeleton-hit.js';
import { BOT_BODY_RADIUS, BOT_BODY_HEIGHT } from './bot-referee.js';
import {
  NAMETAG_UP, SOLDIER_ORIGIN_UP,
  aimState, ageAim, markAimed, latchAim, nameTagAlpha, nameTagRgb, nameTagText,
  nameTagDistances,
} from './nametags.js';

const KIT_ORDER = ['scout', 'assault', 'antitank', 'medic', 'engineer'];

/**
 * Built once. `page` is a bag of getters:
 * `bots`, `camera`, `capsulesOf`, `ctfCarriers`, `deployActive`, `deployKit`,
 * `deployTeamId`, `hudPaths`, `LOCAL_PLAYER`, `occupancy`, `optPilot`,
 * `replayActive`, `roomClient`, `roomJoined`, `soldier`, `soldierDead`,
 * `stage`, `world`.
 */
export function createNametagLayer(page) {
  const layer = {};
  const canvas = document.getElementById('nametag-canvas');
  const ctx = canvas?.getContext('2d') ?? null;
  // `BFPlayer+0x1c8` / `+0x1c4`, by the page's key for the player.
  const states = new Map();
  // Server caps (HUD-16); a server that never says leaves the client's own.
  let serverNear = Infinity;
  let serverScope = Infinity;
  let font = null;
  let fontAsked = false;
  let painted = false;
  const tints = new Map();
  layer.enabled = true;
  layer.last = [];

  const _eye = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _root = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _box = new THREE.Box3();
  const hullRadius = new WeakMap();

  layer.setServerDistances = (near, scope) => {
    serverNear = Number(near);
    serverScope = Number(scope);
  };

  function localTeam() {
    if (page.roomJoined && page.roomClient) return page.roomClient.hello?.team === 1 ? 1 : 2;
    return page.world?.player(page.LOCAL_PLAYER)?.team ?? page.deployTeamId;
  }

  function localKit() {
    const i = KIT_ORDER.indexOf(page.deployKit);
    return i < 0 ? null : i;
  }

  function localOnFoot() {
    return !!page.soldier && !page.soldierDead && !(page.optPilot?.checked && page.occupancy);
  }

  /** The hull node's world origin into `out`, and its up axis into `up`. */
  function hullFrame(root, out, up) {
    root.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(root.matrixWorld);
    up.setFromMatrixColumn(root.matrixWorld, 1).normalize();
  }

  /** Every player but the local one who could carry a tag:
   *  `{ key, name, team, seated, root, x, y, z, hp }`, y the anchor's origin
   *  (a soldier's is a metre over his feet). */
  function candidates() {
    const out = [];
    const carriers = page.ctfCarriers?.() ?? null;
    if (page.roomJoined && page.roomClient?.remoteSlots) {
      const client = page.roomClient;
      const now = performance.now();
      for (const slot of client.remoteSlots(now)) {
        const p = client.remotePlayer(slot, now);
        if (!p || !p.alive || !Number.isFinite(p.x)) continue;
        const seated = !!(p.seated || p.inVehicle);
        out.push({
          key: `slot:${slot}`, name: client.nameOf?.(slot) ?? `Player ${slot}`,
          team: client.teamOf?.(slot) ?? p.team ?? 0, seated, root: null,
          // A seated row's position is his hull's.
          x: p.x, y: p.y + (seated ? 0 : SOLDIER_ORIGIN_UP), z: p.z, up: null,
          hp: null, carrier: carriers?.has(`slot:${slot}`) ?? false,
        });
      }
      return out;
    }
    const world = page.world;
    if (!world) return out;
    for (const bot of page.bots ?? []) {
      const player = world.player(bot.playerId);
      if (!player || world.armorOf(bot.playerId)?.destroyed) continue;
      const root = player.occupancy?.root ?? null;
      const armor = player.armor;
      let c;
      if (root) {
        const dmg = world.damageableOf?.(root) ?? null;
        hullFrame(root, _root, _up);
        c = {
          x: _root.x, y: _root.y, z: _root.z, up: _up.toArray(), root,
          hp: dmg ? { hp: dmg.armor.hitPoints, max: dmg.armor.maxHitPoints,
                      critical: dmg.criticalDamage ?? 0 } : null,
        };
      } else {
        const s = player.soldier;
        if (!s) continue;
        c = {
          x: s.x, y: s.y + SOLDIER_ORIGIN_UP, z: s.z, up: null, root: null,
          hp: armor ? { hp: armor.hitPoints, max: armor.maxHitPoints } : null,
        };
      }
      out.push({
        key: bot.playerId, name: bot.name, team: player.team ?? bot.team ?? 0,
        seated: !!root, bot: true, carrier: carriers?.has(bot.playerId) ?? false, ...c,
      });
    }
    return out;
  }

  /** HUD-18's aim pass: the keys of the players under the crosshair. A ray
   *  from a metre in front of the camera down its forward axis, the scope
   *  range long; the world (terrain, statics, hulls) stops it, a soldier's
   *  body or an occupied hull before that names who is aimed at. */
  function aimed(list, scope) {
    const hit = new Set();
    page.camera.getWorldPosition(_eye);
    page.camera.getWorldDirection(_fwd).normalize();
    _eye.addScaledVector(_fwd, 1);
    const origin = [_eye.x, _eye.y, _eye.z];
    const dir = [_fwd.x, _fwd.y, _fwd.z];
    const world = page.world?.collider?.cast?.(_eye.x, _eye.y, _eye.z, _fwd.x, _fwd.y, _fwd.z, scope);
    const wallT = world ? world.t : Infinity;
    let bestT = Infinity;
    let best = null;
    const hulls = new Map();
    for (const c of list) {
      if (c.seated) {
        if (!c.root) continue;
        let group = hulls.get(c.root);
        if (!group) hulls.set(c.root, group = []);
        group.push(c.key);
        continue;
      }
      const met = meetSoldier(origin, dir, scope, {
        capsules: c.bot ? page.capsulesOf?.(c.key) ?? null : null,
        center: [c.x, c.y - SOLDIER_ORIGIN_UP + BOT_BODY_HEIGHT, c.z], radius: BOT_BODY_RADIUS,
      });
      if (met && met.t < bestT) { bestT = met.t; best = [c.key]; }
    }
    // A hull: its bounding sphere, entered before the wall the cast found
    // (the hull is in the collider itself, so its own skin is that wall).
    for (const [root, keys] of hulls) {
      let r = hullRadius.get(root);
      if (r == null) {
        _box.setFromObject(root);
        r = _box.isEmpty() ? 3 : _box.getSize(_p).length() / 2;
        hullRadius.set(root, r);
      }
      hullFrame(root, _root, _up);
      _p.subVectors(_root, _eye);
      const along = _p.dot(_fwd);
      if (along < 0) continue;
      const miss2 = _p.lengthSq() - along * along;
      if (miss2 > r * r) continue;
      const t = along - Math.sqrt(r * r - miss2);
      if (t < bestT && t <= wallT + 0.5) { bestT = t; best = keys; }
    }
    if (best && bestT <= wallT + 0.25) for (const k of best) hit.add(k);
    return hit;
  }

  function tinted(rgb) {
    // The pulses move the colour every frame: eighths keep the atlas copies
    // to a few dozen.
    const key = rgb.map(v => Math.min(255, Math.round(v / 8) * 8)).join(',');
    let c = tints.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = font.image.width;
    c.height = font.image.height;
    const g = c.getContext('2d');
    g.drawImage(font.image, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = `rgb(${key})`;
    g.fillRect(0, 0, c.width, c.height);
    if (tints.size > 256) tints.clear();
    tints.set(key, c);
    return c;
  }

  function clear() {
    if (painted && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    painted = false;
    layer.last = [];
  }

  /** One drawn frame: age, aim, latch and paint. */
  layer.draw = dt => {
    if (!ctx) return;
    const off = !layer.enabled || page.replayActive?.() || page.deployActive?.() || !page.world;
    if (off) { clear(); return; }
    if (!font && !fontAsked && page.hudPaths) {
      fontAsked = true;
      loadConsoleFont(page.hudPaths.consoleFont()).then(f => { font = f; });
    }
    // On a retail server its own caps, from the level's SetLevel (HUD-23).
    const caps = page.roomJoined ? page.roomClient?.nameTagCaps?.() ?? null : null;
    const dist = nameTagDistances(caps?.near ?? serverNear, caps?.scope ?? serverScope);
    const list = candidates();
    const live = new Set(list.map(c => c.key));
    for (const key of states.keys()) if (!live.has(key)) states.delete(key);
    for (const c of list) {
      let s = states.get(c.key);
      if (!s) states.set(c.key, s = aimState());
      ageAim(s, dt);
    }
    for (const key of aimed(list, dist.scope)) markAimed(states.get(key), dt);

    const stage = page.stage;
    const W = stage.clientWidth || 0;
    const H = stage.clientHeight || 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    painted = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const team = localTeam();
    const onFoot = localOnFoot();
    const kit = localKit();
    const seconds = performance.now() / 1000;
    page.camera.getWorldPosition(_eye);
    const drawn = [];
    for (const c of list) {
      const s = states.get(c.key);
      // HUD-22: origin + R x nameTagOffset + up x 1.5. `nameTagOffset` is not
      // exported with the hulls yet, so a seated tag sits on the hull's own.
      _p.set(c.x, c.y, c.z);
      if (c.up) _p.add(_up.fromArray(c.up).multiplyScalar(NAMETAG_UP));
      else _p.y += NAMETAG_UP;
      const d = Math.hypot(c.x - _eye.x, c.y - _eye.y, c.z - _eye.z);
      latchAim(s, d, dist.scope);
      const friend = c.team === team;
      const alpha = nameTagAlpha({ d, friend, fade: s.fade, carrier: c.carrier }, dist);
      if (alpha <= 0) continue;
      // Behind the camera: dropped. No on-screen test (HUD-22).
      _p.project(page.camera);
      if (_p.z > 1 || _p.z < -1) continue;
      const sx = (_p.x + 1) / 2 * W;
      const sy = (1 - _p.y) / 2 * H;
      // HUD-20's medic and engineer calls pulse a tag too: the caller's, as
      // the local medic or engineer heard it (`support-calls.js`, HUD-26).
      const rgb = nameTagRgb({ team: c.team, carrier: c.carrier, call: page.callFor?.(c.key) ?? null }, seconds);
      const text = nameTagText({ name: c.name, friend, seated: c.seated, hp: c.hp }, { onFoot, kit });
      drawn.push({ key: c.key, text, alpha, rgb, x: sx, y: sy, d });
      if (!font?.image) continue;
      ctx.globalAlpha = alpha / 255;
      const x = Math.trunc(sx - font.measure(text) / 2);
      drawFontLine(ctx, font, tinted(rgb), text, x, Math.trunc(sy));
    }
    ctx.globalAlpha = 1;
    layer.last = drawn;
  };

  /** The aim states, for the test hooks. */
  layer.state = key => states.get(key) ?? null;

  return layer;
}
