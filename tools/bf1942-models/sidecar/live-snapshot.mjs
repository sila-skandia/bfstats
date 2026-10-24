// The sidecar's live snapshot: the rows that put a page joining mid-session at
// the current instant (sidecar.mjs sends them on every page connection).
// A module of its own so a node harness can drive it
// (tests/sidecar_live_snapshot_harness.mjs).

// What a page needs to JOIN a session that is already running.
//
// It used to be every line recorded so far, replayed on connect. The file is a
// buffered stream, so reading it back missed whatever had not been flushed and
// a page could lose the rows naming the object it controls (live, 2026-10-16),
// so the writer kept the whole stream in memory instead. On a sidecar left
// running that is tens of thousands of rows, and joining replayed the round's
// every event in one burst, which the page then processed as if it were
// happening now: the browser crashed (owner, 2026-10-21). What a page actually
// needs is the CURRENT state, so that is what is kept: the latest row per
// object per kind, and none of the history. Memory is bounded by the object
// count rather than by the length of the round, and `--out` is untouched.
export function createLiveState() {
  const live = {
    head: null,              // k:'h', the recording's own header
    anim: null,              // k:'anim', the stance table the `st` rows name
    events: new Map(),       // `${e}|${pid}` -> the latest state event (serverInfo, setLevel, createPlayer, control)
    objects: new Map(),      // netId -> the k:'o' row that created it
    jointRows: new Map(),    // `${k}|${parent}` -> the k:'j'/'jn' entries naming that parent's children
    transforms: new Map(),   // netId -> the k:'s' entry [id, x, y, z, qx, qy, qz, qw]
    states: new Map(),       // netId -> the k:'st' entry
    attrs: new Map(),        // netId -> the k:'a' entry
    flags: new Map(),        // control point id -> the k:'g' entry
    players: new Map(),      // pid -> the k:'ps' row
    single: new Map(),       // k -> the latest whole row (tk, win)
    t: 0,
    tick: 0,
  };

  // A state event the page must know to render the world it is joining. Anything
  // else on the `e` stream is history (a spawn that already happened, a hit mark,
  // a hud line) and replaying it is what made the page crash.
  // `projPool` is state too: a CreateMultipleObjects names the netIds of a pool
  // of rounds and is the only word that they are rounds. A page that joined
  // without it took the first grenade thrown for a classless object and stood it
  // on the field as a hull (2026-10-22).
  // `enterVehicle` too, per player and only while he sits: who is in which
  // hull is state. A page that joined after the bots boarded thought every
  // crewed enemy hull was empty and marked it on its map, where retail hides a
  // hull with an enemy in it (MMAP-3; the owner, 2026-10-22).
  // `cp` per control point, `setTeam` per player, and the round's `gameStatus`,
  // `gameRules` and `clock`, each the latest only. Without `cp` a page that
  // joined after a capture drew every flag at the level's starting side and
  // offered spawns at flags the enemy held; the server refused each one, so
  // the deploy timer ran out and nothing happened (Wake, 2026-10-22: the US
  // held only the Village, the page showed all five).
  // `pickupKit` per player: the kit each one carries. A page reloaded mid-life
  // drew its own soldier, and every remote one, with no kit the server named.
  // `spawnGroups`, the newest: the spawn manager's whole table (each group's
  // side, whether a human can spawn on it, its ring), which the server sends
  // once at the join and then only where it changes (ghost-writer.mjs).
  // `createObject` per netId, while the object lives: the server's object table.
  // A page that joined mid-round learnt of a hull only when it came into its
  // ghost scope (the `o` row), so its hull-model prewarm missed every hull out of
  // scope and the deck wait was all that held a spawn onto an unloaded carrier
  // (features/udp-sidecar/browser.md, "The join"). A SetLevel clears them with
  // the rest of the old world, and a DestroyObject takes its own. Measured on the
  // owner's four 64-player recordings (Midway, Tobruk), at most 715 rows and
  // 90 KB, at the end of the world dump; about 300 rows and 40 KB in play.
  const LIVE_EVENTS = new Set(['serverInfo', 'serverName', 'setLevel', 'createPlayer', 'control', 'projPool', 'enterVehicle',
    'cp', 'setTeam', 'gameStatus', 'gameRules', 'clock', 'pickupKit', 'createObject', 'spawnGroups']);
  // The ones whose latest word is moved to the end of the snapshot, so it lands
  // after what it amends: a setTeam after its player's createPlayer.
  const LIVE_REORDER = new Set(['setTeam', 'gameStatus', 'gameRules', 'clock', 'cp', 'control', 'pickupKit', 'spawnGroups']);

  function remember(o) {
    if (Number.isFinite(o.t) && o.t > live.t) live.t = o.t;
    switch (o.k) {
      case 'h': live.head = o; return;
      case 'anim': live.anim = o; return;
      case 'o':
        live.objects.set(o.id, o);
        return;
      case 'd':
        // Despawned: it is not part of the world a new page joins.
        live.objects.delete(o.id); live.transforms.delete(o.id);
        live.states.delete(o.id); live.attrs.delete(o.id);
        return;
      case 's':
        if (Number.isFinite(o.tick) && o.tick > live.tick) live.tick = o.tick;
        for (const e of o.o ?? []) live.transforms.set(e[0], e);
        return;
      case 'st':
        for (const e of o.o ?? []) live.states.set(e[0], e);
        return;
      case 'a':
        for (const e of o.a ?? []) live.attrs.set(e[0], e);
        return;
      case 'g':
        for (const e of o.o ?? []) live.flags.set(e[0], e);
        return;
      case 'j':
      case 'jn':
        for (const e of o.o ?? []) {
          const key = `${o.k}|${e[0]}`;
          const entries = live.jointRows.get(key) ?? [];
          const at = entries.findIndex((x) => x[1] === e[1]);
          if (at >= 0) entries[at] = e; else entries.push(e);
          live.jointRows.set(key, entries);
        }
        return;
      case 'ps':
        if (Number.isInteger(o.pid)) live.players.set(o.pid, o);
        return;
      case 'tk':
      case 'win':
        live.single.set(o.k, o);
        return;
      case 'e':
        // A new level is a new world: its pools are numbered afresh, and nothing
        // of the old one survives it. A level change is a new connection
        // (RECON-2) whose server never destroys the last session's objects, so
        // a page that connected after a rejoin was handed the old level's
        // players, objects and poses beside the new one's.
        if (o.e === 'setLevel') {
          for (const key of [...live.events.keys()]) if (!/^(serverInfo|serverName|setLevel)\|/.test(key)) live.events.delete(key);
          for (const m of [live.objects, live.jointRows, live.transforms, live.states, live.attrs, live.flags, live.players, live.single]) m.clear();
        }
        // Out of his seat, or gone: the seat row goes, and a player the server
        // destroyed takes his roster row with him.
        if (o.e === 'exitVehicle') live.events.delete(`enterVehicle|${o.pid}`);
        if (o.e === 'destroyPlayer') { for (const e of ['enterVehicle', 'createPlayer', 'control', 'setTeam', 'pickupKit']) live.events.delete(`${e}|${o.pid}`); }
        if (o.e === 'destroyObject') for (const [key, row] of [...live.events]) if (key.startsWith('enterVehicle|') && (row.netId === o.netId)) live.events.delete(key);
        // Destroyed: no longer part of the world a page joins. A hull the
        // server re-makes under the same netId (a round restart) comes back
        // into scope with its own k:"o" (ghost-writer.mjs).
        if (o.e === 'destroyObject') {
          live.objects.delete(o.netId); live.transforms.delete(o.netId);
          live.states.delete(o.netId); live.attrs.delete(o.netId);
          live.events.delete(`createObject|${o.netId}`);
        }
        // A netId made again (a round restart re-makes every hull under its
        // old id, ROUND-10) goes to the end, after whatever else names it.
        if (o.e === 'createObject') live.events.delete(`createObject|${o.netId}`);
        if (LIVE_EVENTS.has(o.e)) {
          const key = `${o.e}|${o.pid ?? o.netId ?? o.id ?? ''}`;
          if (LIVE_REORDER.has(o.e)) live.events.delete(key);
          live.events.set(key, o);
        }
        return;
      default:
        // Rounds (k:'f'), deaths (k:'d' handled above as an object row), hud
        // text, projectile pools and every other event: not state.
        return;
    }
  }

  /** The rows that put a joining page at the current instant: the level and its
   *  players, then every object that exists, then where each one is and what it
   *  is doing. No event, no round, no history. */
  function liveSnapshot() {
    const rows = [];
    if (live.head) rows.push(live.head);
    if (live.anim) rows.push(live.anim);
    for (const e of live.events.values()) rows.push(e);
    for (const o of live.objects.values()) rows.push(o);
    for (const [key, entries] of live.jointRows) {
      const [k] = key.split('|');
      rows.push({ k, t: live.t, o: entries });
    }
    if (live.transforms.size) rows.push({ k: 's', t: live.t, tick: live.tick, o: [...live.transforms.values()] });
    if (live.states.size) rows.push({ k: 'st', t: live.t, o: [...live.states.values()] });
    if (live.attrs.size) rows.push({ k: 'a', t: live.t, a: [...live.attrs.values()] });
    if (live.flags.size) rows.push({ k: 'g', t: live.t, o: [...live.flags.values()] });
    for (const row of live.players.values()) rows.push(row);
    for (const row of live.single.values()) rows.push(row);
    return rows.map((o) => JSON.stringify(o));
  }

  return { live, remember, liveSnapshot };
}
