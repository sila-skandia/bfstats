// The arsenal ASMR's firing range (features/replay-shorts, "The arsenal"):
// one gun alone, cut out of a real recording. A recording is a line per
// sample, event or shot; this keeps the round's set-up (the level, its
// rules), the chosen objects' own lines (made, placed, turned, damaged) and
// only the chosen weapons' shots, so the replay draws that hull or man where
// he stood, firing as he fired, with every sound the game makes for it and
// nothing else in the world.

/** Events every range keeps: the round's set-up, not anyone in it. */
const SETUP = new Set(['serverInfo', 'serverName', 'challenge', 'setLevel', 'gameRules', 'clock', 'gameStatus']);
/** Lines whose `o` (or `a`) is a list of rows, each led by an object id. */
const PER_OBJECT = new Set(['s', 'j', 'g', 'a']);
/** Of those, the ones that define an object rather than sample it: kept
 *  whenever written, up to the range's end. */
const DEFINES = new Set(['jn']);

/**
 * `text` a recording (NDJSON). `keep` is `[{ id, weapons, from, to }]`: an
 * object's net id, the weapon names whose shots it keeps, and the round's
 * seconds to keep it over. Samples are kept from `lead` seconds before each
 * `from`, so its pose is settled when the take starts. Returns the range
 * recording as NDJSON.
 */
export function rangeRecording(text, keep, { lead = 6, tail = 2 } = {}) {
  const by = new Map(keep.map(k => [k.id, k]));
  const end = Math.max(...keep.map(k => k.to)) + tail;
  const inWindow = (id, t) => {
    const k = by.get(id);
    return k && t >= k.from - lead && t <= k.to + tail;
  };
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const t = o.t ?? 0;
    switch (o.k) {
      case 'h':
        out.push(line);
        break;
      case 'roster':
        out.push(JSON.stringify({ ...o, p: [] }));
        break;
      case 'e':
        if (SETUP.has(o.e) && t <= end) out.push(line);
        else if ((o.e === 'createObject' || o.e === 'destroyObject') && by.has(o.netId) && t <= end) out.push(line);
        break;
      case 'o':
        if (by.has(o.id) && t <= end) out.push(line);
        break;
      case 'f': {
        const k = by.get(o.id);
        if (k && k.weapons.includes(o.w) && t >= k.from && t <= k.to) out.push(line);
        break;
      }
      default: {
        const field = o.k === 'a' ? 'a' : 'o';
        if (DEFINES.has(o.k) && Array.isArray(o[field]) && t <= end) {
          const rows = o[field].filter(r => by.has(r[0]));
          if (rows.length) out.push(JSON.stringify({ ...o, [field]: rows }));
        } else if (PER_OBJECT.has(o.k) && Array.isArray(o[field])) {
          const rows = o[field].filter(r => inWindow(r[0], t));
          if (rows.length) out.push(JSON.stringify({ ...o, [field]: rows }));
        }
      }
    }
  }
  out.push(JSON.stringify({ k: 'end', t: end + 1 }));
  return `${out.join('\n')}\n`;
}
