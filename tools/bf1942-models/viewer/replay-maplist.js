// The server's map rotation in a replay (MapEvent 0x13, `rec.mapList`), as
// the game's own map vote screen lists it: Id, Mapname, Mod, Gamemode and
// Votes (the lexicon's MAPVOTE_* columns), with the round's own map marked
// and the next one named. Sweep entry 12 (features/replay-feature-sweep-
// 2026-11-01).
//
// Pure, a function of the recording and the clock, so node tests it
// (tests/test_replay_models.py `test_the_map_list_marks_now_and_next`).

/** A level file's mode as MapEvent names it: `conquest.con` -> `conquest`,
 *  `CoOp` -> `coop`. */
const modeKey = mode => String(mode ?? '').replace(/\.con$/i, '').toLowerCase();

/** The map vote running at `t` (VoteEvent 0x12, type 0), the last that
 *  passed, and the yes count of the running one's target. */
function mapVotesAt(rec, t) {
  let open = null;
  let passed = null;
  for (const v of rec.votes ?? []) {
    if (v.t > t) break;
    if (v.type !== 0) continue;
    if (v.action === 0 || v.action === 3) open = v;
    else {
      if (v.action === 2) passed = v;
      open = null;
    }
  }
  return { open, passed };
}

/**
 * The rotation at `t`: `{ entries, current, next, vote }`, or null where the
 * recording has no list. Each entry `{ id, map, mode, mod, votes, current,
 * next }`; `current` is the round's level (the first entry of its map and
 * mode, else of its map), `next` the map a passed vote chose, else the one
 * after it in the rotation. `vote` is the map vote running at `t`, or null.
 */
export function mapListAt(rec, t) {
  const list = rec.mapList ?? [];
  if (!list.length) return null;
  const level = String(rec.level ?? '').toLowerCase();
  const mode = modeKey(rec.modeFile);
  let current = list.findIndex(e => e.map.toLowerCase() === level && modeKey(e.mode) === mode);
  if (current < 0) current = list.findIndex(e => e.map.toLowerCase() === level);
  const { open, passed } = mapVotesAt(rec, t);
  let next = passed && passed.target < list.length ? passed.target : current >= 0 ? (current + 1) % list.length : -1;
  if (next === current && list.length < 2) next = -1;
  const entries = list.map((e, id) => ({
    id, map: e.map, mode: e.mode, mod: e.mod,
    votes: open && open.target === id ? open.yes ?? 0 : 0,
    current: id === current, next: id === next,
  }));
  return { entries, current, next, vote: open, chosen: Boolean(passed && passed.target === next) };
}
