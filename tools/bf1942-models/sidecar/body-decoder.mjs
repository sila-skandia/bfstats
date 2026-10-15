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
import { seatSpecFor } from './ghost/children.mjs';
import { decodePlayerBody } from './ghost/player.mjs';
import { decodeControlPointBody } from './ghost/control-point.mjs';
import { decodeKitBody } from './ghost/kit.mjs';

let CLASSES = null;
try {
  CLASSES = JSON.parse(fs.readFileSync(new URL('./classes.json', import.meta.url), 'utf8'));
} catch { /* no class map: only soldiers and players decode by their own rules */ }

// How far past a root's netId its seats' ids reach: the same bound the replay
// viewer uses (viewer/replay-recording.js MAX_SEATS).
export const MAX_SEATS = 12;

export class BodyDecoder {
  constructor(opts = {}) {
    this.animStates = opts.animStates ?? 0;
    this.objects = new Map();      // netId -> tid, from createObject
    this.playerNetIds = new Set(); // createPlayer netIds
    this.soldiers = new Set();     // on-foot control objects
    this.cameras = new Set();      // createPlayer camNetIds: each player's spawn-screen camera
    this.lastRot = new Map();
  }

  // A v5 recording row (record.mjs recordFor output, or a parsed k:"e" line).
  note(row) {
    if (!row) return;
    if (row.e === 'createObject' && row.netId != null) this.objects.set(row.netId, row.tid);
    else if (row.e === 'destroyObject') this.objects.delete(row.netId);
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
    return tid != null ? CLASSES?.byTid?.[tid] ?? null : null;
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
    const cls = this.classOf(netId);
    let b = null;
    if (cls === 'BFSoldierNetworkable') {
      // No baseline: a compressed vector's reference is BitStream+0x58, and
      // the engine never writes it, so every read is relative to zero.
      b = decodeSoldierBody(hex, bodyBits, { animStates: this.animStates });
    } else if (cls === 'BFPlayer') {
      b = decodePlayerBody(hex, bodyBits, { strict: false });
    } else if (cls === 'SimpleObjectNetworkable') {
      const template = this.info(netId)?.tmpl;
      b = decodePcoBody(hex, bodyBits, { ...(template ? { template } : {}), strict: false });
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
    if (b.pos) {
      rec.pos = b.pos;
      if (b.rot) this.lastRot.set(netId, b.rot);
      rec.rot = b.rot || this.lastRot.get(netId) || null;
    }
  }
}
