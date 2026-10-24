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
    engines: new Map(),      // `${root}|${engine}` -> the k:'g' entry, one per Engine child of a hull
    outOfScope: new Set(),   // netIds the server took out of this client's scope (k:'d'), still in the world
    bodies: new Map(),       // soldier netId a man died in -> his pid, until the server destroys it (two of one man's can lie)
    statics: new Map(),      // bf42++ static id -> its createStatic row, moves and turns folded in
    rounds: new Map(),       // netId -> { tid, tmpl }: a pooled round, by the newest pool that named it
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
  // `createObject` per netId, while the object lives: the server's object table.
  // A page that joined mid-round learnt of a hull only when it came into its
  // ghost scope (the `o` row), so its hull-model prewarm missed every hull out of
  // scope and the deck wait was all that held a spawn onto an unloaded carrier
  // (features/udp-sidecar/browser.md, "The join"). A SetLevel clears them with
  // the rest of the old world, and a DestroyObject takes its own. Measured on the
  // owner's four 64-player recordings (Midway, Tobruk), at most 715 rows and
  // 90 KB, at the end of the world dump; about 300 rows and 40 KB in play.
  // `projPool` is kept per round rather than per event (`live.rounds`): the
  // server hands a freed pool's netIds to the next pool, which can start
  // where the old one did and be shorter, so the newest pool over each id is
  // the one that names it.
  const LIVE_EVENTS = new Set(['serverInfo', 'serverName', 'setLevel', 'createPlayer', 'control', 'enterVehicle',
    'cp', 'setTeam', 'gameStatus', 'gameRules', 'clock', 'pickupKit', 'createObject']);
  // The ones whose latest word is moved to the end of the snapshot, so it lands
  // after what it amends: a setTeam after its player's createPlayer.
  const LIVE_REORDER = new Set(['setTeam', 'gameStatus', 'gameRules', 'clock', 'cp', 'control', 'pickupKit']);

  function remember(o) {
    if (Number.isFinite(o.t) && o.t > live.t) live.t = o.t;
    switch (o.k) {
      case 'h': live.head = o; return;
      case 'anim': live.anim = o; return;
      case 'o':
        live.objects.set(o.id, o);
        live.outOfScope.delete(o.id);
        return;
      case 'd':
        // Out of this client's scope (ghost action 3), not out of the world:
        // the retail client only disables the object (GhostManager::readData
        // 0x08141ed0), and the page keeps what it knows of it -- its class,
        // its side, its hit points, its stance -- and drops only its pose
        // (net-sidecar.js, the 'd' case). A joining page is handed the same:
        // the object's k:"o" and the last of its state, then a k:"d" after
        // all of it. Dropping the k:"o" here lost every kit a player carried
        // out of scope (its template is the kit object's) and every hull's
        // standing damage until it came back.
        if (live.objects.has(o.id)) live.outOfScope.add(o.id);
        live.transforms.delete(o.id);
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
        // An engine row is `[root, revs, throttle, flags, gear, engine]`, one
        // per Engine child: keyed by the hull alone, a B17's four engines
        // came to a joining page as the last one to change.
        for (const e of o.o ?? []) live.engines.set(`${e[0]}|${Number.isInteger(e[5]) ? e[5] : 0}`, e);
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
          for (const m of [live.objects, live.jointRows, live.transforms, live.states, live.attrs, live.engines, live.outOfScope,
            live.bodies, live.statics, live.rounds, live.players, live.single]) m.clear();
        }
        // A dead man's body is the soldier he was controlling when his death
        // row came, and it lies until the server destroys that object
        // (net-sidecar.js, the 'score' case; DIE-9). The death row itself is
        // history, so a joining page is told of the body alone (k:"e"
        // e:"body").
        if (o.e === 'score' && (o.kind === 4 || o.kind === 5) && Number.isInteger(o.pid)) {
          // His control object: the newest `control`, or the one his
          // createPlayer named (the world dump sends no SetDefaultVehicle for
          // a player already alive; net-sidecar.js takes vehNetId the same way).
          const nid = live.events.get(`control|${o.pid}`)?.netId ?? live.events.get(`createPlayer|${o.pid}`)?.vehNetId;
          const seated = live.events.has(`enterVehicle|${o.pid}`);
          // Keyed by the body, as net-sidecar.js keys it: a man killed again
          // inside his first body's 10 s has two lying at once.
          if (Number.isInteger(nid) && !seated) { live.bodies.delete(nid); live.bodies.set(nid, o.pid); }
        }
        if (o.e === 'destroyObject') live.bodies.delete(o.netId);
        // A kit object the server destroys (a dead man's, 10 s on) takes its
        // template with it, and the page reads a player's kit from it
        // (net-sidecar.js `kitOf`). The page that saw the pickup keeps the
        // name; the joining page is handed it on the pickup row.
        if (o.e === 'destroyObject') {
          const tmpl = live.events.get(`createObject|${o.netId}`)?.tmpl ?? live.objects.get(o.netId)?.tmpl;
          if (tmpl) for (const [key, row] of [...live.events]) {
            if (key.startsWith('pickupKit|') && row.netId === o.netId && !row.kitTmpl) live.events.set(key, { ...row, kitTmpl: tmpl });
          }
        }
        if (o.e === 'destroyPlayer') for (const [nid, pid] of [...live.bodies]) if (pid === o.pid) live.bodies.delete(nid);
        // A round restart without a level load (GameStatus back to 3 from
        // play or the end, ROUND-10): the server resets every control point
        // and sends one again only where it changed, so a point's old row is
        // the last round's (net-sidecar.js clears its sides the same way).
        if (o.e === 'gameStatus') {
          const was = live.events.get('gameStatus|')?.status;
          if (o.status === 3 && (was === 1 || was === 2)) for (const key of [...live.events.keys()]) if (key.startsWith('cp|')) live.events.delete(key);
        }
        // bf42++'s server-made statics (wire.md section 30): what the server
        // created for this level, as the page's reconciler reads it
        // (server-statics.js). A move or a turn is folded into its create
        // row; a delete takes it.
        if (o.e === 'projPool' && Number.isInteger(o.netId) && o.count > 0) {
          // An id the pool takes over is its round now: a k:"o" kept from the
          // object that had the id before names it as the pool does, and
          // carries no class of its own (a joining page reads it as a round,
          // as the page that saw the pool does; net-sidecar.js, 'projPool').
          for (let i = 0; i < Math.min(o.count, 16); i++) {
            const nid = o.netId + i;
            live.rounds.delete(nid); live.rounds.set(nid, { tid: o.tid ?? 0, tmpl: o.tmpl ?? '' });
            const was = live.objects.get(nid);
            if (was) live.objects.set(nid, { k: 'o', t: was.t, id: nid, tid: o.tid ?? 0, tmpl: o.tmpl ?? '', team: was.team ?? 0 });
          }
        }
        if ((o.e === 'destroyObject' || o.e === 'createObject') && Number.isInteger(o.netId)) live.rounds.delete(o.netId);
        if (o.e === 'createStatic' && Number.isInteger(o.id)) { live.statics.delete(o.id); live.statics.set(o.id, { ...o }); }
        if (o.e === 'updateStatic' && live.statics.has(o.id)) {
          const row = live.statics.get(o.id);
          if (o.action === 'delete') live.statics.delete(o.id);
          else if (o.action === 'move' && Array.isArray(o.value)) row.pos = o.value;
          else if (o.action === 'rotate' && Array.isArray(o.value)) row.rot = o.value;
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
          live.outOfScope.delete(o.netId);
          for (const key of [...live.engines.keys()]) if (key.startsWith(`${o.netId}|`)) live.engines.delete(key);
          live.events.delete(`createObject|${o.netId}`);
        }
        // A netId made again (a round restart re-makes every hull under its
        // old id, ROUND-10) goes to the end, after whatever else names it.
        if (o.e === 'createObject') live.events.delete(`createObject|${o.netId}`);
        // And whatever the old object under that id left behind is not this
        // one's: a k:"o" written before it (tid 0 for a pool's round) would
        // come after this createObject in the snapshot and unname the new
        // object on the joining page.
        if (o.e === 'createObject') {
          live.objects.delete(o.netId); live.outOfScope.delete(o.netId);
          live.transforms.delete(o.netId); live.states.delete(o.netId); live.attrs.delete(o.netId);
        }
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
    // The rounds, as the pools that name them: consecutive ids of one
    // template in one row, at most 15 a row (the wire's own 4-bit count,
    // ledger J-5), in the order their pools came.
    let run = null;
    for (const [nid, r] of live.rounds) {
      if (run && nid === run.netId + run.count && r.tid === run.tid && r.tmpl === run.tmpl && run.count < 15) { run.count++; continue; }
      if (run) rows.push(run);
      run = { k: 'e', t: live.t, e: 'projPool', tid: r.tid, tmpl: r.tmpl, netId: nid, count: 1 };
    }
    if (run) rows.push(run);
    for (const o of live.objects.values()) rows.push(o);
    for (const [key, entries] of live.jointRows) {
      const [k] = key.split('|');
      rows.push({ k, t: live.t, o: entries });
    }
    if (live.transforms.size) rows.push({ k: 's', t: live.t, tick: live.tick, o: [...live.transforms.values()] });
    if (live.states.size) rows.push({ k: 'st', t: live.t, o: [...live.states.values()] });
    if (live.attrs.size) rows.push({ k: 'a', t: live.t, a: [...live.attrs.values()] });
    if (live.engines.size) rows.push({ k: 'g', t: live.t, o: [...live.engines.values()] });
    for (const row of live.statics.values()) rows.push(row);
    for (const [netId, pid] of live.bodies) rows.push({ k: 'e', t: live.t, e: 'body', pid, netId });
    for (const row of live.players.values()) rows.push(row);
    for (const row of live.single.values()) rows.push(row);
    // Last, after every row that could have named them: the objects the
    // server has out of this client's scope.
    for (const id of live.outOfScope) rows.push({ k: 'd', t: live.t, id });
    return rows.map((o) => JSON.stringify(o));
  }

  return { live, remember, liveSnapshot };
}
