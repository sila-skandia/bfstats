// The zoomed look on the wire: the page's look stage (viewer/local-look.js)
// against a real server's law, outside a browser. Prints one JSON blob.
//
// A hand moves the mouse at several speeds, at the hip and zoomed with the
// No4 (zoomFov 0.4). Each tick the page turns its own soldier by
// `footLookPair` and the room sends one wire record (viewer/netcode.js
// `encodeInput`). The server decodes the record and scales it by the held
// weapon's zoomFov while zoomed (BFSoldier::handlePlayerInput 0x08275bf2,
// measured on the lab: `tests/fixtures/zoom_look_no4.ndjson`). Summed per
// stretch: what the page turned, what the server turned from `footWirePair`
// (sent since 2026-10-24) and from `footLookPair` (sent before).
import { createLocalLook } from '../viewer/local-look.js';
import { encodeInput, decodeInput } from '../viewer/netcode.js';
import { quantiseAxis } from '../viewer/mouse-input.js';
import { carrySelfAim } from '../sidecar/soldier-ghost.mjs';

const ZOOM_FOV = Number(process.argv[2] ?? 0.4);
let zoomed = false;
const page = {
  isZoomed: () => zoomed,
  handWeapon: { data: { zoom: { fov: ZOOM_FOV } } },
  optPilot: { checked: false },
  occupancy: null,
};
const look = createLocalLook(page);

const server = (pair) => {
  const d = decodeInput(encodeInput({}, pair)).look;
  const f = zoomed ? ZOOM_FOV : 1;
  return { x: d.x * f, y: d.y * f };
};

// [label, zoomed, ticks, pixels per tick x, y]
const stretches = [
  ['hip pan', false, 30, 6, 0],
  ['hip slow pitch', false, 30, 0, 1],
  ['zoomed pan', true, 30, 6, 0],
  ['zoomed pitch', true, 30, 0, -4],
  ['zoomed fine pitch', true, 60, 0, 0.5],
  ['zoomed fine pan', true, 60, 0.3, 0],
  ['zoomed flick and settle', true, 40, 12, -3],
];
const out = { zoomFov: ZOOM_FOV, stretches: [] };
for (const [label, z, ticks, px, py] of stretches) {
  zoomed = z;
  const sum = { page: { x: 0, y: 0 }, wire: { x: 0, y: 0 }, legacy: { x: 0, y: 0 } };
  let worstTick = 0;
  for (let i = 0; i < ticks; i++) {
    look.mouseInput.accumulate(px, py);
    look.pumpLook(1);
    const local = look.footLookPair();
    const viaWire = server(look.footWirePair());
    const viaLegacy = server(local);
    sum.page.x += local.x; sum.page.y += local.y;
    sum.wire.x += viaWire.x; sum.wire.y += viaWire.y;
    sum.legacy.x += viaLegacy.x; sum.legacy.y += viaLegacy.y;
    worstTick = Math.max(worstTick, Math.abs(viaWire.x - local.x), Math.abs(viaWire.y - local.y));
  }
  const r = (v) => Math.round(v * 1e6) / 1e6;
  out.stretches.push({
    label, zoomed: z,
    page: { x: r(sum.page.x), y: r(sum.page.y) },
    wire: { x: r(sum.wire.x), y: r(sum.wire.y) },
    legacy: { x: r(sum.legacy.x), y: r(sum.legacy.y) },
    worstTick: r(worstTick),
  });
}
// Every value the mouse stage can hand the world (a multiple of 0.01 inside
// +-16) reaches the server as itself (mouse-input.js fixedFor), and a raw
// value packs as the engine's floatToFixed does.
let gridBad = 0, rawBad = 0;
for (let i = -1600; i <= 1600; i++) {
  const q = quantiseAxis(i / 100);
  if (decodeInput(encodeInput({}, { x: q, y: q })).look.x !== q) gridBad++;
}
for (let i = 0; i < 4000; i++) {
  const v = Math.sin(i * 12.9898) * 20;
  if (decodeInput(encodeInput({}, { x: v, y: v })).look.x !== quantiseAxis(v)) rawBad++;
}
out.codec = { gridBad, rawBad };
// The ack's zoom: unknown until a state carries the bits, then carried.
{
  const m = new Map();
  out.carryZoom = [
    carrySelfAim(m, 7, { aimA: 1 }),
    carrySelfAim(m, 7, { stateBits: 0x60 }),
    carrySelfAim(m, 7, { aimB: 2 }),
    carrySelfAim(m, 7, { stateBits: 0x40 }),
  ].map((r) => r?.zoom ?? null);
}
console.log(JSON.stringify(out));
