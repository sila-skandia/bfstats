// Where a bot's round goes in its deviation cone: a point of the DEV-9
// square fixed by the bot's input index, scaled by the total (ledger AI-145).
//
// `FireArms::fireBarrel` 0x0828aba0 draws its two uniforms from a pure
// function of `k = (Game::getCurrentInputIndex() + barrel) & 0x3ff` (vt+0xa0,
// `Game+0x68`; the up axis from `random_seeds[k]`, the right axis from
// `random_seeds[k +- 0x200]`, a static table in .data). The barrel is
// `Fire`'s own: 0..n-1 for a gun with `addFireArmsPosition` barrels, and -1
// for one with none (BOMB-2), so a barrel-less gun draws at index - 1.
// `GameServer::simulatePlayerUpdate` 0x0815bd00 sets `Game+0x68` from the
// player's action buffer: the first queued action's index (+0x14), or the
// last index + 1 when none is queued. A human's actions are numbered as they
// arrive (`ActionBuffer::add` 0x081125c0 counts them); a bot's are pushed by
// `AIPlayer::addInput` 0x085dcf10 through `ActionBuffer::pushBack`
// 0x08112750, which keeps the action's own +0x14, and `PlayerAction::set`
// 0x081128a0 never writes it: the bot's index is whatever its stack slot
// holds. The slot was not traced to its writer. The lab's server recordings
// say what it holds:
//
//  * a bot in a seat: one index for every bot, map and mod. The 3,018
//    vanilla and 376 Desert Combat bot rounds of the seat MGs (Browning,
//    MG42, the coaxials; no barrels) all draw at 617, so the index is 618;
//  * a bot on foot: its own index, a multiple of 4 (the low bits of an
//    aligned address), held through a life, its weapons included, and new
//    at the next. The shotguns' eight barrels (DC's Saiga12k and Remington,
//    22 pulls of 10 bot lives) each fit one index, 76, 132, 180, 468, 476,
//    532, 540, 708, 772 and 876, to the recorder's rounding, and every
//    still bot's rifle rounds keep one direction for a life
//    (`~/.cache/dc-sweep/review-bots/pellet_fit2.py`, `lives.py`).
//
// So the viewer gives each bot on foot one of the 256 multiples of 4 at
// every spawn, hashed from its id and the life (INFERRED: an address is not
// a draw, but nothing the viewer has predicts its low bits), and every
// seated bot 618.
//
// `random_seeds` (0x0872fc80, 1024 words) is the first 1024 values of the
// C runtime's `rand()` from seed 1 (`x = x * 214013 + 2531011`, the value
// `(x >> 16) & 0x7fff`), checked word for word against the binary; the word
// after it, which index 0x200's right axis reads, is 0.

import * as THREE from 'three';
import { deviate } from './round-launch.js';

/** A seated bot's input index, as the recordings show it (AI-145). */
export const SEAT_INPUT_INDEX = 618;
/** The draw table `fireBarrel` reads: `random_seeds` and the 0 after it. */
const SEEDS = (() => {
  const out = new Array(1025);
  let x = 1;
  for (let i = 0; i < 1024; i++) {
    x = (Math.imul(x, 214013) + 2531011) >>> 0;
    out[i] = (x >>> 16) & 0x7fff;
  }
  out[1024] = 0;
  return out;
})();

/** One Schrage step of the engine's Park-Miller generator (mod 2^31 - 1),
 *  in its own 32-bit words: every operand stays under 2^31 for this table. */
function schrage(y, a) {
  const lo = (y & 0xffff) * a;
  const hi = (lo >> 16) + (y >>> 16) * a;
  const x = ((hi >> 15) + (lo & 0xffff) + ((hi & 0x7fff) << 16)) >>> 0;
  return x < 0x7fffffff ? x : x - 0x7fffffff;
}

/** The draw at table index `k`, in (-1, +1]: `fireBarrel`'s two Schrage
 *  steps over `random_seeds[k] + k` and `((z >> 7 | 1) + 1) x 2^-24`. */
function draw(k) {
  const r = schrage(schrage((SEEDS[k] + k) & 0x7fffffff, 0x5e30), 0x661f);
  return Math.fround((((r >> 7) | 1) + 1) * 5.9604645e-08 * 2 - 1);
}

const _points = new Map();
/** `[u_up, u_right]` at seed index `k` (0..1023), each in (-1, +1]. */
export function deviationPoint(k) {
  k &= 0x3ff;
  let p = _points.get(k);
  if (!p) {
    const k2 = k + 0x200 > 0x400 ? k - 0x200 : k + 0x200;
    p = [draw(k), draw(k2)];
    _points.set(k, p);
  }
  return p;
}

/**
 * A bot on foot's input index for its `life`-th life: a multiple of 4
 * (AI-145), hashed from its player id and the life so that it costs the
 * bot's own random stream nothing (the headless runner's seeded matches
 * keep every other draw they had).
 */
export function footInputIndex(playerId, life = 0) {
  let h = 0x811c9dc5;
  const s = `${playerId ?? ''}#${life}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return 4 * ((h >>> 0) & 0xff);
}

/** The seed index of barrel `barrel` of a gun with `barrels` barrels fired
 *  by a player at input index `inputIndex`: `Fire` hands a barrel-less gun
 *  -1 (BOMB-2). */
export function deviationIndex(inputIndex, barrels = 0, barrel = 0) {
  return (inputIndex + (barrels > 0 ? barrel : -1)) & 0x3ff;
}

/**
 * How many `addFireArmsPosition` barrels a gun declares, from its glb's
 * muzzles (`bot-barrels.js fireArmsBarrels`). The exporter gives a gun that
 * declares none one muzzle at its `projectilePosition` (assemble.py
 * `_fire_arms`), so one muzzle reads as none: right for every vanilla hand
 * weapon and all of Desert Combat's but the RPG-7 and SA-7, which declare
 * one and so draw one index lower than the engine's (a life's index is a
 * draw either way, so nothing tells the two apart).
 */
export function declaredBarrels(barrels) {
  return Array.isArray(barrels) && barrels.length > 1 ? barrels.length : 0;
}

/** The input index a bot fires at: its seat's while seated, else its own
 *  life's (`Bot.inputIndex`), else the seat's. */
export function botInputIndex(bot) {
  if (bot?.vehicle) return SEAT_INPUT_INDEX;
  return Number.isInteger(bot?.inputIndex) ? bot.inputIndex : SEAT_INPUT_INDEX;
}

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _back = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _frame = new THREE.Quaternion();

/**
 * The unit direction a bot's round flies down the line `dir` (a unit array)
 * at deviation total `total` (the cone's own unit, hundredths of a radian):
 * `round-launch.js deviate` on a frame whose +X is the shooter's right and +Y
 * his up (the engine's rows 0 and 1; a soldier's camera does not roll, which
 * the shotgun fits confirm), its two draws seed index `k`'s point
 * (`deviationIndex`).
 */
export function botDeviate(dir, total, k) {
  const [uUp, uRight] = deviationPoint(k);
  _dir.set(dir[0], dir[1], dir[2]);
  _up.set(0, 1, 0);
  if (Math.abs(_dir.y) > 0.99) _up.set(1, 0, 0);
  _right.crossVectors(_dir, _up).normalize();
  _up.crossVectors(_right, _dir);
  _back.copy(_dir).negate();
  _frame.setFromRotationMatrix(_basis.makeBasis(_right, _up, _back));
  const draws = [(uUp + 1) / 2, (uRight + 1) / 2];
  let i = 0;
  deviate({ rand: () => draws[i++] }, _dir, total, _frame);
  _dir.normalize();
  return [_dir.x, _dir.y, _dir.z];
}
