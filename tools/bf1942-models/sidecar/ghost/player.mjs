// Decode a player's ghost body: dice::bf::BFPlayer.
//
// WHAT THIS IS. Not a Networkable: a BFPlayer is the per-player object the
// server adds with NetworkManager::addPlayerNetworkable (0x0842c310), and it
// rides the ghost stream under its own netId, which is the `netId` a
// createPlayer event carries (run.ndjson: netId 1 = skandia, 3 = sidecar,
// 509 = Michael O'Brien, 511 = Kazuyoshi Shiokawa). Its reader is
// **BFPlayer::setNetUpdate (0x08053a40)**; its writer is BFPlayer::getNetUpdate
// (0x080534b0); its mask is built by BFPlayer::updateStateMask (0x08052f60).
// The reader and the writer agree field-for-field and guard-for-guard, and the
// mask-builder names every guard, so the layout below is read three ways.
//
// A BFPlayer body is a SINGLE setNetUpdate: whoever compiled review.mjs framed
// these records with a descriptor that holds only the player networkable, and
// every record that exists decodes to its last bit with just this reader. So,
// unlike a vehicle (ghost/pco.mjs, which concatenates the hull and its child
// networkables), a player body has no child tail.
//
// THE BODY (in this order — the order both setNetUpdate and getNetUpdate use):
//
//   readUnsigned(24)     presence mask                      always, LSB-first
//   0x000002  u7  @ +0x90  readUnsigned(0,0x7f)      (clamped 0..0x7f; setTeam
//                                                    zeroes it on a team change)
//   0x000004  b   @+0x13c  readBool
//   0x000008  u?  @ +0xa0  readUnsigned(0,0xff)   \  nine flat counters cleared
//   0x000010  u?  @ +0xa4  readUnsigned(0,0xff)    |  together by resetStats
//   0x000020  u?  @ +0xa8  readUnsigned(0,0xff)    |  (0x080556e0): the player's
//   0x000040  u?  @ +0xac  readUnsigned(0,0xff)    |  stat block. What each one
//   0x000080  u?  @ +0xb0  readUnsigned(0,0xff)    |  counts is the `stat` key
//   0x000100  u?  @ +0xb4  readUnsigned(0,0xff)    |  in FIELDS below (THE STAT
//   0x000200  u?  @ +0xb8  readUnsigned(0,0xff)    |  BLOCK)
//   0x000400  u?  @ +0xbc  readUnsigned(0,0xff)   /
//   0x000800  s16 @ +0xc0  readSigned(16)          the ninth, signed: the score
//   0x001000  b   @+0x14c  readBool                 call-for-medic / engineer
//   0x004000  b   @+0x148  readBool                 (BFPlayer::setCallForMedic
//                                                    / setCallForEngineer are
//                                                    empty stubs on the server)
//   0x008000  b   @+0x149  readBool
//   0x010000  u10 @ +0x94  readUnsigned(0,0x3ff)    the ping, 0..1023 ms
//   0x002000  u7  @ +0x8c  readUnsigned(0,0x7f)     vehicle HP as a small int
//                                                    (getVehicleHp 0x08054720;
//                                                    ctor inits +0x8c = -1.0)
//   0x040000  u5  @ slot+0x3c readUnsigned(0,0x12)  controlled-object value
//   0x040000  b   @ slot+0x54 readBool              ** same guard bit 0x40000 **
//   0x080000  u8  @+0x178  readUnsigned(0,0xff)     a float the writer rounds
//                                                    (resetStats clears +0x178)
//   0x100000  u8  @ +0xe8  readUnsigned(0,0xff)     \ three more counters
//   0x200000  u8  @ +0xec  readUnsigned(0,0xff)     |
//   0x400000  u8  @ +0xf0  readUnsigned(0,0xff)    /
//   0x800000  u8  @ +0x80  readUnsigned(0,0xff)
//   (no guard) b  @+0x164  readBool                 isConnected (BFPlayer::
//                                                    setIsConnected 0x08055910
//                                                    writes +0x164) — ALWAYS
//
// TWO TRAPS, both straight out of the engine and both easy to "fix" wrongly:
//
//  1. `readUnsigned(min,max)` (0x083da040) is the RANGED reader, and its width
//     is the smallest n with (1<<n)-1 >= (max-min+1) — the engine's off-by-one
//     (bitstream.mjs `rangedBits`). So readUnsigned(0,0xff) is **9 bits**, not
//     8, and readUnsigned(0,0x3ff) is **11**, not 10. Reading them as the naive
//     width shifts every later field. The all-bits-set record (mask 0xffffff,
//     `ffffff00...`) is exactly 195 bits only with the ranged widths.
//  2. Mask bit 0x40000 guards TWO fields in a row — a 5-bit ranged value and
//     then a bool. A decoder that reads one and not the other is exact only on
//     bodies that never set the bit.
//
// THE STAT BLOCK, read out of the Linux server (lnxded, BFPlayer at the
// server's own offsets) and the retail client:
//
//  - Who increments which counter is `ScoreManager::scoreEvent` (0x081617c0),
//    a jump table at 0x086c1118 by ScoreMsg. Every case increments one
//    counter, adds that event's points (the ScoreManager's `kill`, `death`,
//    ... settings) to +0xc0, and mirrors both into a second copy 0x54 higher
//    (+0xf4..+0x114, never sent):
//      0 capture       +0xa8  (0x08161828)   pays ScoreManager+0x48
//      1 attack        +0xb8  (0x081618a1)   +0x4c
//      2 defence       +0xac  (0x08161907)   +0x50
//      3 kill          +0xa4  (0x08161970)   +0x40
//      4, 5 death      +0xa0  (0x081619d9)   +0x3c
//      6 team kill     +0xbc  (0x08161a41)   +0x44
//      7 nothing       (returns, 0x081617e2)
//      8 objective     +0xb0  (0x08161aaa)   +0x54
//      9 objective TK  +0xb4  (0x08161b13)   +0x58
//  - The server's own GameSpy player report, `bfPlayersCallback`
//    (0x0804d3f0), names four of them: `kills` = +0xa4 (0x0804d485), `deaths`
//    = +0xa0 (0x0804d497), `score` = +0xc0 (0x0804d4ae), `ping` = +0x94
//    (0x0804d4c5), `team` = +0x7c. So +0x94 is the ping, not an id (getId
//    0x080560e0 reads +0x58).
//  - The retail client's score board fills a row's cells 3..6 (the addColumn
//    ints 175, 210, 245, 280: the score, kills, deaths and ping headings) with
//    "%d" of its player's +0xf4, +0xd8, +0xd4 and +0xc8 (BF1942.exe
//    0x006e08f7, 0x006e092f, 0x006e0967, 0x006e099f; cell setter 0x007d4980).
//    Its own copy of this mask (0x00407b46..0x00407d4d) puts bit 0x800 at
//    +0xec, 0x10 at +0xd0, 0x8 at +0xcc and 0x10000 at +0xc0, each exactly 8
//    below the row's read, so the four columns are this block's +0xc0, +0xa4,
//    +0xa0 and +0x94 (that the row's pointer is the player's 8 bytes on is
//    inferred from the four agreeing).
//  - Live, Kursk co-op (2026-10-16): a bot's +0xb8 steps with +0xc0 by 2 (the
//    `attack` 2 of ScoreManagerSettings.con), a kill steps +0xa4 and +0xc0 by
//    1 on the killer and +0xa0 on the victim in the same tick.
//
// An underflow propagates (no try/catch around the reads) so verify.mjs sees a
// short or long read rather than a swallowed throw.

import { BitReader, rangedBits } from '../bitstream.mjs';

export const MASK_WIDTH = 24;

// guard bit -> { name, kind }. `kind`: 'u' a ranged unsigned, 's' a signed
// int, 'b' a bool. Two entries share 0x40000 (a value then a bool), so this is
// a list, not a map.
export const FIELDS = [
  { bit: 0x000002, name: 'unk90', kind: 'u', max: 0x7f, at: 0x90 },
  { bit: 0x000004, name: 'f13c', kind: 'b', at: 0x13c },
  { bit: 0x000008, name: 'stat1', stat: 'deaths', kind: 'u', max: 0xff, at: 0xa0 },
  { bit: 0x000010, name: 'stat2', stat: 'kills', kind: 'u', max: 0xff, at: 0xa4 },
  { bit: 0x000020, name: 'stat3', stat: 'captures', kind: 'u', max: 0xff, at: 0xa8 },
  { bit: 0x000040, name: 'stat4', stat: 'defences', kind: 'u', max: 0xff, at: 0xac },
  { bit: 0x000080, name: 'stat5', stat: 'objectives', kind: 'u', max: 0xff, at: 0xb0 },
  { bit: 0x000100, name: 'stat6', stat: 'objectiveTeamKills', kind: 'u', max: 0xff, at: 0xb4 },
  { bit: 0x000200, name: 'stat7', stat: 'attacks', kind: 'u', max: 0xff, at: 0xb8 },
  { bit: 0x000400, name: 'stat8', stat: 'teamKills', kind: 'u', max: 0xff, at: 0xbc },
  { bit: 0x000800, name: 'stat9', stat: 'score', kind: 's', bits: 16, at: 0xc0 },
  { bit: 0x001000, name: 'callMedic', kind: 'b', at: 0x14c },
  { bit: 0x004000, name: 'callEngineer', kind: 'b', at: 0x148 },
  { bit: 0x008000, name: 'f149', kind: 'b', at: 0x149 },
  { bit: 0x010000, name: 'unk94', stat: 'ping', kind: 'u', max: 0x3ff, at: 0x94 },
  { bit: 0x002000, name: 'vehicleHp', kind: 'u', max: 0x7f, at: 0x8c },
  { bit: 0x040000, name: 'vehValue', kind: 'u', max: 0x12, slot: 0x3c },
  { bit: 0x040000, name: 'vehFlag', kind: 'b', slot: 0x54 },
  { bit: 0x080000, name: 'f178', kind: 'u', max: 0xff, at: 0x178 },
  { bit: 0x100000, name: 'score_e8', kind: 'u', max: 0xff, at: 0xe8 },
  { bit: 0x200000, name: 'score_ec', kind: 'u', max: 0xff, at: 0xec },
  { bit: 0x400000, name: 'score_f0', kind: 'u', max: 0xff, at: 0xf0 },
  { bit: 0x800000, name: 'unk80', kind: 'u', max: 0xff, at: 0x80 },
];

// The decoded field behind each of the player's stats (THE STAT BLOCK above):
// { score: 'stat9', kills: 'stat2', ... }. The decoder keeps its own names so a
// body's dump reads against the mask; the recording's rows use these.
export const STAT_FIELDS = Object.fromEntries(FIELDS.filter((f) => f.stat).map((f) => [f.stat, f.name]));

// bits of the mask that no field uses (bit 0 and bit 17); if one is ever set,
// the decoder still consumes the body but the read is suspect.
export const UNUSED_BITS = [0x1, 0x20000];

// Decode a BFPlayer body. Returns { mask, connected, <field names>, consumed }.
// Fields absent from the mask are null. Underflow propagates.
export function decodePlayerBody(bodyHex, bodyBits, _opts = {}) {
  const r = new BitReader(Buffer.from(bodyHex, 'hex'), bodyBits);
  const out = { mask: 0, connected: null, consumed: 0 };
  for (const f of FIELDS) out[f.name] = null;

  out.mask = r.readUnsigned(MASK_WIDTH);
  const mask = out.mask;
  for (const f of FIELDS) {
    if (!(mask & f.bit)) continue;
    if (f.kind === 'b') out[f.name] = r.readBool();
    else if (f.kind === 's') out[f.name] = r.readSigned(f.bits);
    else out[f.name] = r.readUnsigned(rangedBits(0, f.max));
  }
  out.connected = r.readBool(); // unconditional, BFPlayer+0x164
  out.consumed = r.pos;
  return out;
}

export default decodePlayerBody;
