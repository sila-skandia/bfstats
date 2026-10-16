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
console.log(JSON.stringify({ full: { pos: full.pos, rot: full.rot }, turn: { pos: turn.pos, rot: turn.rot, mask: turn.body?.mask } }));
