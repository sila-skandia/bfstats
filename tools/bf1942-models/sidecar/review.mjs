// The review log: everything the sidecar receives but cannot yet turn into a
// clean record goes here, as NDJSON, with a running tally. This is how the
// replayer's understanding was built — bf42plus and the replayer dumped the
// events they had no case for and grew the decoders over time. The sidecar
// does the same one level lower, at the raw wire: unknown server events, the
// framed per-object ghost (movement) deltas that still need a class decoder,
// any ghost block that would not frame, unknown datagram types, and decode
// errors. Review the file, decode the next thing, shrink the file.

import fs from 'node:fs';

export class ReviewLog {
  constructor(path) {
    this.path = path;
    this.stream = path ? fs.createWriteStream(path) : null;
    this.counts = new Map();   // tag -> count
    this.eventIds = new Map(); // unknown event id -> count
    this.ghostNetIds = new Map(); // netId -> count of ghost updates
    this.ghostLens = new Map();    // body bit-length -> count (per-class delta sizes)
    this.started = Date.now();
  }

  _bump(map, key) { map.set(key, (map.get(key) || 0) + 1); }

  _write(tag, rec) {
    this._bump(this.counts, tag);
    if (this.stream) this.stream.write(JSON.stringify({ tag, dt: +((Date.now() - this.started) / 1000).toFixed(3), ...rec }) + '\n');
  }

  // A server event whose 7-bit type has no decoder. Keep the id, the bit
  // offset in the block, and a window of the following bytes to decode from.
  unknownEvent({ id, seq, block, bitOffset, hex }) {
    this._bump(this.eventIds, id);
    this._write('unknown-event', { id, idHex: '0x' + id.toString(16), seq, block, bitOffset, hex });
  }

  // One framed ghost (object-update) record: which object, what action, and
  // the raw body bits that a per-class setNetUpdate decoder will consume.
  // action 1 = create/update (has a body), 3 = remove, 0 = none.
  ghostRecord({ seq, tick, netId, action, bodyBits, hex }) {
    this._bump(this.ghostNetIds, netId);
    if (bodyBits != null) this._bump(this.ghostLens, bodyBits);
    this._write('ghost-record', { seq, tick, netId, action, bodyBits, hex });
  }

  // A ghost block that would not frame (e.g. it carried a control-object
  // state the sidecar does not size): keep the whole thing raw.
  ghostBlockRaw({ seq, reason, hex }) {
    this._write('ghost-block-raw', { seq, reason, hex });
  }

  unknownDatagram({ type, hex }) {
    this._write('unknown-datagram', { type, typeHex: '0x' + type.toString(16), hex });
  }

  decodeError({ where, seq, message, hex }) {
    this._write('decode-error', { where, seq, message, hex });
  }

  // A compact tally for the end of a run (and for a periodic print).
  summary() {
    const top = (m, n = 12) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([k, v]) => `${typeof k === 'number' && k > 9 ? '0x' + k.toString(16) : k}:${v}`);
    return {
      tags: Object.fromEntries(this.counts),
      unknownEventIds: top(this.eventIds),
      ghostUpdatesByNetId: top(this.ghostNetIds),
      ghostBodyBitLengths: top(this.ghostLens),
      path: this.path,
    };
  }

  close() { if (this.stream) this.stream.end(); }
}
