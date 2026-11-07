// A stretch of a round's recording, cut out as a recording of its own
// (features/dogfight-recordings, "A fight in 3D"): the replay page reads it
// as it reads a whole round, but it holds a few seconds, not forty minutes.
//
// The recorder writes state on change (a pose when an object moves, a seat
// when a player changes it), so a stretch that starts mid-round needs what
// held when it starts. `sliceRecording` writes that first, all at time 0,
// then every row of the stretch with its time moved back by its start:
//
// - The world as it stood: the header, the roster, the animation table,
//   the control points, the moving parts' names, and the state events in
//   their order (the level and rules, who joined and left, teams), each
//   player's last control, seat, exit and kit, the last round clock.
// - Every object live at the start: its last first-seen row, its creation,
//   its last pose, hit points, moving-part rotations, engines, stances and
//   ammo. An object destroyed before the start, or out of the recording
//   player's range at it (a client file's `d`), is left out; it comes back
//   with its own rows if it comes back in the stretch.
// - Each player's last seat (`p`), AI level and score line, and the tickets.
// - Not carried: what happened before (scores, kills, chat, radio, shots,
//   hits, projectiles in flight). The stretch's own are all there.

/** State events: the replay keeps what they set, so the last of each holds. */
const STATE_EVENTS = new Set(['setLevel', 'gameRules', 'serverInfo', 'serverName', 'challenge', 'gameStatus',
  'dbComplete', 'createPlayer', 'destroyPlayer', 'setTeam', 'welcome', 'mapList', 'sessionId', 'scoreTable', 'flagHolder']);
/** Per-player events of which only the last before the start matters. */
const LAST_PER_PLAYER = new Set(['control', 'enterVehicle', 'exitVehicle', 'pickupKit']);
/** Row kinds kept whole: small, and read as tables. */
const WHOLE = new Set(['h', 'roster', 'anim', 'cp', 'cpt', 'jn', 'bai']);
/** Per-sample rows collapsed to their latest value, and how each is keyed. */
const LATEST = {
  s: { list: 'o', key: e => e[0], obj: e => e[0] },
  a: { list: 'a', key: e => e[0], obj: e => e[0] },
  p: { list: 'p', key: e => e[0], obj: () => null },
  j: { list: 'o', key: e => `${e[0]}/${e[1]}`, obj: e => e[0] },
  g: { list: 'o', key: e => `${e[0]}/${e[5] ?? e[0]}`, obj: e => e[0] },
  st: { list: 'o', key: e => e[0], obj: e => e[0] },
  am: { list: 'o', key: e => e[0], obj: e => e[0] },
  lod: { list: 'o', key: e => e[0], obj: () => null },
  ps: { list: 'ps', key: e => e[0], obj: () => null },
};

const r3 = v => Math.round(v * 1000) / 1000;

/**
 * The stretch [t0, t1] of a recording (`text`, its ndjson) as a recording of
 * its own, times from 0. `meta` goes into the header as `clip`.
 */
export function sliceRecording(text, t0, t1, meta = {}) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a cut last line */ }
  }
  const before = rows.filter(r => (r.t ?? 0) < t0);
  // Objects at the start: created or seen, and not since destroyed or out
  // of range. A net id can be reused; the last of its rows decides.
  const gone = new Set();
  const lastCreate = new Map();
  const lastSeen = new Map();
  for (const r of before) {
    if (r.k === 'e' && r.e === 'createObject' && r.netId) { lastCreate.set(r.netId, r); gone.delete(r.netId); }
    else if (r.k === 'e' && r.e === 'destroyObject' && r.netId) gone.add(r.netId);
    else if (r.k === 'o' && Number.isFinite(r.id)) { lastSeen.set(r.id, r); gone.delete(r.id); }
    else if (r.k === 'd' && Number.isFinite(r.id)) gone.add(r.id);
  }
  const live = id => id === null || !gone.has(id);
  const prelude = [];
  const at0 = r => ({ ...r, t: 0 });
  const version = rows.find(r => r.k === 'h')?.v ?? 5;
  // The tables and the state events, in their order.
  for (const r of before) {
    if (r.k === 'h') prelude.push(at0({ ...r, clip: { ...meta, from: r3(t0), to: r3(t1) } }));
    else if (WHOLE.has(r.k) && r.k !== 'h') prelude.push(at0(r));
    else if (r.k === 'e' && STATE_EVENTS.has(r.e)) prelude.push(at0(r));
  }
  // Each player's last control, seat change and kit; the last clock.
  const perPlayer = new Map();
  let clock = null;
  for (const r of before) {
    if (r.k !== 'e') continue;
    if (LAST_PER_PLAYER.has(r.e) && r.pid !== undefined) perPlayer.set(`${r.e}/${r.pid}`, r);
    if (r.e === 'clock') clock = r;
  }
  const kept = [...perPlayer.values()].sort((a, b) => a.t - b.t);
  // An exit before his last entry is no exit.
  const lastEnter = new Map(kept.filter(r => r.e === 'enterVehicle').map(r => [r.pid, r.t]));
  for (const r of kept) {
    if (r.e === 'exitVehicle' && (lastEnter.get(r.pid) ?? -1) > r.t) continue;
    prelude.push(at0(r));
  }
  if (clock) prelude.push(at0(clock));
  // The objects live at the start: created, first seen.
  for (const [id, r] of lastCreate) if (live(id)) prelude.push(at0(r));
  for (const [id, r] of lastSeen) if (live(id)) prelude.push(at0(r));
  // Their latest state, and the players'.
  for (const [k, how] of Object.entries(LATEST)) {
    if (k === 'j' && version === 4) continue;
    const latest = new Map();
    for (const r of before) {
      if (r.k !== k) continue;
      for (const e of r[how.list] ?? []) {
        if (!Array.isArray(e)) continue;
        if (!live(how.obj(e))) continue;
        latest.set(how.key(e), e);
      }
    }
    if (latest.size) prelude.push({ k, t: 0, [how.list]: [...latest.values()] });
  }
  const tickets = before.filter(r => r.k === 'tk').at(-1);
  if (tickets) prelude.push(at0(tickets));
  // The stretch, its times from 0.
  const stretch = [];
  for (const r of rows) {
    const t = r.t ?? 0;
    if (t < t0 || t > t1 || r.k === 'h' || r.k === 'end') continue;
    const moved = { ...r, t: r3(t - t0) };
    if (Number.isFinite(r.at)) moved.at = r3(r.at - t0);
    stretch.push(moved);
  }
  stretch.push({ k: 'end', t: r3(t1 - t0) });
  return [...prelude, ...stretch].map(r => JSON.stringify(r)).join('\n') + '\n';
}
