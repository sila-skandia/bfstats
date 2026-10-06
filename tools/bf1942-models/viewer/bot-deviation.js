// Where a bot's round goes in its deviation cone: one fixed point of the
// DEV-9 square, scaled by the total (ledger AI-145).
//
// `FireArms::fireBarrel` 0x0828aba0 draws its two uniforms from a pure
// function of `k = (Game::getCurrentInputIndex() + barrel) & 0x3ff` (vt+0xa0,
// `Game+0x68`; the up axis from `random_seeds[k]`, the right axis from
// `random_seeds[k +- 0x200]`, a static table in .data). `GameServer::
// simulatePlayerUpdate` 0x0815bd00 sets `Game+0x68` from the player's action
// buffer: the first queued action's index (+0x14), or the last index + 1
// when none is queued. A human's actions are numbered as they arrive
// (`ActionBuffer::add` 0x081125c0 counts them); a bot's are pushed by
// `AIPlayer::addInput` 0x085dcf10 through `ActionBuffer::pushBack`
// 0x08112750, which keeps the action's own +0x14, and `PlayerAction::set`
// 0x081128a0 never writes it: the bot's index is whatever its stack slot
// holds. In the lab's 35 vanilla and 17 Desert Combat server recordings
// every bot's MG rounds lie along one direction of the square, and the
// low edges of their sizes are (minDev + 0.3125) x 0.980 for the Browning,
// the MG42 and the coaxial Browning alike: index 617 (0x269), the only
// index of 1024 that fits both. The slot was not traced to its writer.
// The table below is that index's draws for barrels 0..15, from the
// binary's own table and generator (no hand weapon has more than eight
// barrels).

import * as THREE from 'three';
import { deviate } from './round-launch.js';

/** The bots' input index as the recordings show it (AI-145). */
export const BOT_INPUT_INDEX = 0x269;

/** `[u_up, u_right]` for `(BOT_INPUT_INDEX + barrel) & 0x3ff`, barrels 0..15:
 *  each in (-1, +1], times the total. */
export const BOT_DEVIATION_POINTS = [
  [0.9517212, 0.2325311], [0.8394976, 0.6858730], [-0.3286581, -0.4036772], [0.7351384, 0.6244216],
  [-0.4029062, -0.8937931], [0.1658068, -0.7514582], [-0.6601815, -0.5509799], [0.5017421, 0.9843259],
  [0.3164992, -0.0905721], [-0.2600508, 0.8453891], [-0.7874880, 0.5352433], [-0.9024911, -0.9664714],
  [-0.3267751, 0.1049740], [-0.9015048, 0.5622971], [-0.9718697, 0.5364449], [-0.7182975, 0.8735819],
];

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _back = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _frame = new THREE.Quaternion();

/**
 * The unit direction a bot's round flies down barrel `barrel`'s line `dir`
 * (a unit array) at deviation total `total` (the cone's own unit, hundredths
 * of a radian): `round-launch.js deviate` on a frame whose +X is the
 * shooter's right and +Y his up (the engine's rows 0 and 1; a soldier's
 * camera does not roll), its two draws the fixed point.
 */
export function botDeviate(dir, total, barrel = 0) {
  const [uUp, uRight] = BOT_DEVIATION_POINTS[barrel % BOT_DEVIATION_POINTS.length];
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
