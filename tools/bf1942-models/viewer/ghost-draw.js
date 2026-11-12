// The retail client's draw law for everything it does not control, shared by
// the relay seam (`net-relay.js`) and the room client (`netcode-client.js`):
// the constants of `SimpleObjectNetworkable::predict` / `BFSoldierNetworkable::
// predict`, the clock it draws by (P-6) and the quaternion helpers both use.
// Pure: no THREE, no DOM. Moved here from `net-relay.js`, which re-exports
// every name it exported before (ledger P-2, P-6..P-9).

// The retail client's ghost smoothing, SimpleObjectNetworkable::predict
// 0x08237a90 (BFSoldierNetworkable::predict 0x08222e50 is the same scheme),
// in its default mode (NetworkManager::globalPredictionMode 1, set at
// NetworkManager::NetworkManager 0x0842b570):
//   * every object is drawn at now - interpolationTime, 100 ms
//     (NetworkManager+0x44 = 0x64, console `interpolationTime`), between the
//     two received samples that embrace that time (findEmbracingIndices);
//   * a pair further apart than 500 ms is not interpolated;
//   * past the newest sample it extrapolates along the velocity of the last
//     two (their displacement over their own gap), by that velocity times the
//     elapsed time, for at most extrapolationTime, 1200 ms
//     (NetworkManager+0x48 = 0x4b0, console `extrapolationTime` -- the CAP,
//     and the divisor's fallback for a zero gap, never a divisor of the
//     velocity), and then holds the newest.
// The ring is 16 samples, the engine's own (+0x54's 0x90-byte records): a
// 100 ms delay needs only a few, but a stalled tab's backlog arrives as one
// burst, and a 4-deep ring dropped the very samples the lookback then asked
// for.
export const TRACK_SAMPLES = 16;
// The server's simulation rate: an `s` row's `tick` over this is the time its
// samples describe (the ghost block header's tick, 30 a second on the lab).
export const SERVER_TICK_HZ = 30;
export const RENDER_LOOKBACK_S = 0.100;
export const TRACK_MAX_GAP = 0.500;
export const EXTRAPOLATION_S = 1.200;

// The clock the retail client draws remotes by. GameClient::predictAll
// (BF1942.exe 0x00491f00) calls every networkable's predict with
// 1000 x the client's game time (0x009a2160), skipping its own control
// object; predict draws at that time minus interpolationTime (above). The
// game time is the client's tick counter (0x009a2168) over the sim rate: the
// client tick adds one (0x004b90d0), and readControlObjectState's handler
// (0x00491c90) sets it to the ghost block's server tick (GhostManager+0x80,
// read off the block header at 0x004970f8) and adds one for each
// unacknowledged action it replays (0x00491e87). So the clock names the
// server tick that will run the action made now: the newest block's tick
// plus the actions in flight. The samples it draws from are stamped with
// their block's tick (GhostManager::readData 1000 x +0x84 on the server
// build, +0x78 on the client), so remotes are drawn interpolationTime behind
// the tick a shot fired now is run at, whatever the ping.
//
// clientClockLead is that clock less the page's mapped server time, seconds,
// at an ack: `tick` the block that ran word `acked`, `sent` the newest word
// the page has made, `serverNow` the page's mapped server clock. Null when
// the ack does not say its tick.
export function clientClockLead({ tick, acked, sent, serverNow }) {
  if (!Number.isInteger(tick) || !Number.isInteger(acked) || !Number.isInteger(sent)
      || !Number.isFinite(serverNow)) return null;
  const pending = Math.max(0, sent - acked);
  return (tick + pending) / SERVER_TICK_HZ - serverNow;
}
// Retail takes its clock whole at every control state, a step of a tick or
// two each time the trip or the word timing wobbles. The page draws at the
// frame rate, so it eases the lead instead, in two stages. `followLead`
// filters the samples: a share of each ack's (about 1 s at 20 acks a second),
// and a whole step for a jump (a respawn after a long wait, a level change, a
// stalled tab), clamped to what predict can extrapolate. `slewLead` moves the
// drawn lead onto that target continuously in page time, at most LEAD_RATE
// seconds per second, so the remotes' clock never steps: a lead changed at an
// ack moved a 50 m/s plane by centimetres at that frame.
export const LEAD_SHARE = 0.05;
export const LEAD_JUMP_S = 0.25;
export const LEAD_MAX_S = 1.0;
export const LEAD_RATE = 0.05;
export function followLead(lead, sample) {
  if (!Number.isFinite(sample)) return lead;
  const s = Math.max(0, Math.min(LEAD_MAX_S, sample));
  if (lead == null || Math.abs(s - lead) > LEAD_JUMP_S) return s;
  return lead + (s - lead) * LEAD_SHARE;
}
// The same clock against the PAGE's, seconds: what to add to page time to get
// retail's game time, at an ack (`tick` the block that ran word `acked`,
// `sent` the newest word made, `pageNow` page seconds). It names the clock
// whole, as retail's handler does, with no mapping of the server's clock in
// between: the page used to draw by that mapping plus the lead above, and the
// mapping re-anchors on its least offset (a sample a tick early, say) while
// the lead takes the change back only at its filter's pace, so the drawn
// clock ran 30-70 ms ahead of retail's for about a second, every ten seconds
// or so (lab, 100 ms round trip).
export function clientClockShift({ tick, acked, sent, pageNow }) {
  if (!Number.isInteger(tick) || !Number.isInteger(acked) || !Number.isInteger(sent)
      || !Number.isFinite(pageNow)) return null;
  return (tick + Math.max(0, sent - acked)) / SERVER_TICK_HZ - pageNow;
}
/** `followLead`'s filter for the shift: a share of each sample, a jump taken
 *  whole (a round restart resets the tick; a hitch, a respawn after a long
 *  wait, a stalled tab), no clamp (the page clock's zero is arbitrary).
 *  The share and the jump are the page's own easing (LEAD_SHARE,
 *  LEAD_JUMP_S above); retail takes each sample whole. */
export function followShift(shift, sample) {
  if (!Number.isFinite(sample)) return shift;
  if (shift == null || Math.abs(sample - shift) > LEAD_JUMP_S) return sample;
  return shift + (sample - shift) * LEAD_SHARE;
}
/** The drawn lead `dt` seconds on, moving toward `target` at LEAD_RATE. */
export function slewLead(drawn, target, dt) {
  if (target == null) return drawn;
  if (drawn == null || Math.abs(target - drawn) > LEAD_JUMP_S) return target;
  const step = LEAD_RATE * Math.max(0, dt);
  return drawn + Math.max(-step, Math.min(step, target - drawn));
}

// Normalised lerp of two unit quaternions, the short way round.
export function nlerpQ(a, b, k) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((i) => a[i] + (s * b[i] - a[i]) * k);
  const n = Math.hypot(...q) || 1;
  return q.map((v) => v / n);
}

export const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
// A rotation `r` scaled to the fraction `k` of its angle (the short way).
export function qPow(r, k) {
  const w = r[3] < 0 ? -1 : 1;
  const x = r[0] * w, y = r[1] * w, z = r[2] * w;
  const sn = Math.hypot(x, y, z);
  if (sn < 1e-9) return [0, 0, 0, 1];
  const half = Math.atan2(sn, Math.abs(r[3])) * k;
  const f = Math.sin(half) / sn;
  return [x * f, y * f, z * f, Math.cos(half)];
}
/** Past the newest of two orientations, `k` gaps on: the pair's own turn
 *  carried on (b = r a, so b r^k). Held at `b` for a turn over 90 degrees
 *  between them, which is a different appearance, not a motion. */
export function extrapolateQ(a, b, k) {
  const r = qMul(b, qConj(a));
  if (Math.abs(r[3]) < Math.SQRT1_2) return b;
  return qMul(qPow(r, k), b);
}
