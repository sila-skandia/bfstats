// BodyDecoder under node: a soldier body carrying only a rotation still moves
// the facing. Bodies copied from a live session (sidecar-2026-10-16-04-57-41,
// the retail player's soldier 622): a full body, then a rotation-only one.
import { BodyDecoder } from '../sidecar/body-decoder.mjs';

const d = new BodyDecoder();
d.note({ e: 'createObject', netId: 622, tid: 1754 });
d.note({ e: 'control', pid: 1, netId: 622 });
const full = { netId: 622, hex: 'fd39d1852c002492fcfffdfffdfffdfffdff05800800007e000000001000', bodyBits: 237,
  ref: [1004.2355346679688, 105.24522399902344, 843.558349609375] };
const turn = { netId: 622, hex: '0400ff7f54acff7f', bodyBits: 64 };
d.decode(full);
d.decode(turn);

// A soldier who stops (lab, Wake, 2026-10-25, bot soldier 1111 at 5 m/s):
// his last running records, then one with his lower and upper states only
// (mask 0x60), no position and no rotation. Retail's setNetUpdate makes it a
// ring record at his last transform (ledger P-9), so it is a sample here too.
d.note({ e: 'control', pid: 2, netId: 1111 });
const ref = [870, 97, 873];
const run1 = { netId: 1111, hex: '0500d26b4989ac26b2856ad42689feff75fcffff01', bodyBits: 162, ref };
const run2 = { netId: 1111, hex: '05004c6e4989bc26b2850aca2689feff75fcffff01', bodyBits: 162, ref };
const stop = { netId: 1111, hex: '6080ef8407', bodyBits: 37, ref };
for (const r of [run1, run2, stop]) d.decode(r);
console.log(JSON.stringify({ full: { pos: full.pos, rot: full.rot }, turn: { pos: turn.pos, rot: turn.rot, mask: turn.body?.mask },
  stop: { run1: run1.pos, run2: run2.pos, rot2: run2.rot, pos: stop.pos ?? null, rot: stop.rot ?? null, mask: stop.body?.mask ?? null } }));
