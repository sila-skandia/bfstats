// Decode framed ghost bodies by the class of the object they belong to.
//
// The wire never names an object's class, so a body picks its reader from what
// the events said: a createPlayer netId is a BFPlayer, a player's on-foot
// control object (SetDefaultVehicle, recorded as `control`) is a soldier, and
// everything else is its createObject template's class (classes.json, built by
// build-classes.mjs from the class map). A netId with no createObject that
// sits within a hull's seat range is that hull's nested PlayerControlObject (a
// gunner seat), read with the root template's seat spec (children.mjs).
//
// It is fed v5 recording rows (record.mjs) rather than raw events, so the live
// session and the offline rebuild (rebuild.mjs) decode the same way.

import fs from 'node:fs';
import { decodeSoldierBody } from './soldier-ghost.mjs';
import { decodePcoBody, decodeSeatBody } from './ghost/pco.mjs';
import { seatSpecFor, hullFor } from './ghost/children.mjs';
import { decodePlayerBody } from './ghost/player.mjs';
import { decodeControlPointBody } from './ghost/control-point.mjs';
import { decodeKitBody } from './ghost/kit.mjs';
import { decodeScoreBody, looksLikeScoreBody } from './ghost/score-manager.mjs';
import { namesForLevel } from './names.mjs';
import { classForTemplate, controlPointTemplates } from './template-class.mjs';
import { gameTables } from './game-tables.mjs';

let CLASSES = null;
try {
  CLASSES = JSON.parse(fs.readFileSync(new URL('./classes.json', import.meta.url), 'utf8'));
} catch { /* no class map: only soldiers and players decode by their own rules */ }

// How far past a root's netId its seats' ids reach: the same bound the replay
// viewer uses (viewer/replay-recording.js MAX_SEATS).
export const MAX_SEATS = 12;
// No BF1942 level reaches past 4096 m (the largest heightmaps are 4 km).
const WORLD_LIMIT = 8192;

export class BodyDecoder {
  constructor(opts = {}) {
    // The engine's animation state count, which sizes a soldier body's state
    // fields. An explicit count (a --names table) stays; otherwise each
    // setLevel takes it from the install for the server's mod (game-tables.mjs).
    this.animStates = opts.animStates ?? 0;
    this.animFixed = !!opts.animStates;
    this.mod = opts.mod ?? null;   // the server's mod, from its ServerInfo event
    this.objects = new Map();      // netId -> tid, from createObject
    this.playerNetIds = new Set(); // createPlayer netIds
    this.soldiers = new Set();     // on-foot control objects
    this.cameras = new Set();      // createPlayer camNetIds: each player's spawn-screen camera
    this.lastRot = new Map();
    this.lastPosOf = new Map();
    this.scoreNet = null;          // the ScoreManager's netId, once seen (score-manager.mjs)
    // The level's template table (names.mjs), set on its setLevel: a tid is
    // the level's own load order, so it is named per level, and the class
    // follows from the name (template-class.mjs). Wake's by-id class map is
    // the fallback on Wake only, the level it was read on.
    this.level = null;
    this.tidNames = opts.tidNames ?? null;
    this.cpTemplates = null;
    this.infoCache = new Map();
  }

  setLevel(level, mode = null) {
    const n = namesForLevel(level, { mod: this.mod, mode });
    this.level = String(level || '').replace(/\/+$/, '').split('/').pop().toLowerCase() || null;
    this.tidNames = n.tidNames;
    // The level's control points and the mod's animation table as the
    // client builds them from its install; the recorded ones only if that fails.
    const g = gameTables({ mod: this.mod, level, mode });
    this.cpTemplates = controlPointTemplates(level, g.cpNames ?? n.cpNames);
    if (!this.animFixed) {
      const states = g.animStates ?? n.animStates;
      if (states?.length) this.animStates = states.length;
    }
    this.infoCache.clear();
  }

  // A v5 recording row (record.mjs recordFor output, or a parsed k:"e" line).
  note(row) {
    if (!row) return;
    if (row.e === 'serverInfo') { if (row.mod) this.mod = row.mod; return; }
    if (row.e === 'setLevel') { this.setLevel(row.level, row.mode); return; }
    if (row.e === 'createObject' && row.netId != null) this.objects.set(row.netId, row.tid);
    else if (row.e === 'destroyObject') { this.objects.delete(row.netId); this.lastPosOf.delete(row.netId); this.lastRot.delete(row.netId); }
    else if (row.e === 'createPlayer' && row.netId != null) {
      this.playerNetIds.add(row.netId);
      if (row.camNetId != null) this.cameras.add(row.camNetId);
    }
    // A player handed back to his camera (after a death, `control` names his
    // camNetId) is not on foot: that id stays a FreeCamera.
    else if (row.e === 'control' && row.netId != null && !this.cameras.has(row.netId)) this.soldiers.add(row.netId);
  }

  info(netId) {
    const tid = this.objects.get(netId);
    if (tid == null) return null;
    if (this.infoCache.has(tid)) return this.infoCache.get(tid);
    const onWake = !this.level || this.level === 'wake';
    const byId = onWake ? CLASSES?.byTid?.[tid] ?? null : null;
    const tmpl = this.tidNames?.[tid] ?? byId?.tmpl ?? null;
    const cls = classForTemplate(tmpl, this.cpTemplates) ?? byId;
    const info = cls ? { ...(byId ?? {}), ...cls, tmpl } : (tmpl ? { tmpl } : null);
    this.infoCache.set(tid, info);
    return info;
  }

  // The hull a seat belongs to, as { root, seat, tmpl }, or null. Only an id
  // with no createObject of its own can be a seat.
  seatOf(netId) {
    if (this.objects.has(netId) || this.soldiers.has(netId) || this.playerNetIds.has(netId) || this.cameras.has(netId)) return null;
    for (let root = netId - 1; root >= netId - MAX_SEATS; root--) {
      const inf = this.info(root);
      if (!inf) continue;
      if (inf.objectClass !== 'PlayerControlObject') return null;
      return { root, seat: netId - root, tmpl: inf.tmpl ?? null };
    }
    return null;
  }

  classOf(netId) {
    if (netId === this.scoreNet) return 'ScoreManager';
    if (this.playerNetIds.has(netId)) return 'BFPlayer';
    if (this.soldiers.has(netId)) return 'BFSoldierNetworkable';
    if (this.cameras.has(netId) && !this.objects.has(netId)) return 'FreeCameraNetworkable';
    const inf = this.info(netId);
    if (inf) return inf.networkableClass ?? null;
    return this.seatOf(netId) ? 'Seat' : null;
  }

  // Decode one framed record in place: rec.cls, rec.body, and for an object
  // with a transform rec.pos / rec.rot. Seats get rec.seat = { root, seat }.
  decode(rec) {
    const { netId, hex, bodyBits } = rec;
    let cls = this.classOf(netId);
    if (cls == null && this.scoreNet == null && looksLikeScoreBody(hex, bodyBits)) {
      this.scoreNet = netId;
      cls = 'ScoreManager';
    }
    if (cls === 'ScoreManager') {
      const b = decodeScoreBody(hex, bodyBits);
      rec.cls = cls;
      if (b) rec.body = b;
      return;
    }
    let b = null;
    if (cls === 'BFSoldierNetworkable') {
      // The position's reference is the stream's compression vector: zero,
      // or the block's control-state root position (rec.ref, session.mjs).
      b = decodeSoldierBody(hex, bodyBits, { animStates: this.animStates, ...(rec.ref ? { baselinePos: rec.ref } : {}) });
    } else if (cls === 'BFPlayer') {
      b = decodePlayerBody(hex, bodyBits, { strict: false });
    } else if (cls === 'SimpleObjectNetworkable') {
      const template = this.info(netId)?.tmpl;
      const hull = hullFor(template);
      b = decodePcoBody(hex, bodyBits, {
        ...(template ? { template } : {}), ...(rec.ref ? { ref: rec.ref } : {}),
        ...(hull ? { maxHp: hull.maxHp, mobile: hull.mobile !== false } : {}), strict: false,
      });
    } else if (cls === 'ControlPointNetworkable') {
      b = decodeControlPointBody(hex, bodyBits, { strict: false });
    } else if (cls === 'KitNetworkable') {
      b = decodeKitBody(hex, bodyBits, { strict: false });
    } else if (cls === 'Seat') {
      const seat = this.seatOf(netId);
      rec.seat = { root: seat.root, seat: seat.seat };
      const spec = seatSpecFor(seat.tmpl, seat.seat);
      if (spec) b = decodeSeatBody(hex, bodyBits, spec, { strict: false });
    }
    if (cls) rec.cls = cls;
    if (!b) return;
    rec.body = b;
    // A position read in a compressed mode whose reference we do not know yet
    // comes out as raw counts (a Sherman at 460461, 220223): off the world,
    // and drawn it throws the hull across the map. Keep the last good one.
    if (b.pos && !b.pos.every((v) => Number.isFinite(v) && Math.abs(v) < WORLD_LIMIT)) b.pos = null;
    // A body carries what changed: position and rotation each under their own
    // mask bit. A bot turns and moves at once (mask 0x5); a human's client
    // turns in place far more often than it steps, so a rotation alone
    // (mask 0x4) is common and must still move the facing. Dropping those
    // left a retail player facing one way all life (live, 2026-10-16: 80
    // rotation-only bodies, 0 drawn). Either half updates the transform,
    // the other from the last one this object sent.
    if (b.rot) this.lastRot.set(netId, b.rot);
    if (b.pos) this.lastPosOf.set(netId, b.pos);
    const pos = b.pos || (b.rot ? this.lastPosOf.get(netId) : null);
    if (pos) {
      rec.pos = pos;
      rec.rot = b.rot || this.lastRot.get(netId) || null;
    }
  }
}
