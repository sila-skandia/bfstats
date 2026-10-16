// `scoreboard-screen.js`'s roster, under node with the DOM stubbed out: the
// class a player's row names is his kit's own (`_shared/loadouts.json`), not
// the deploy row he clicked. Desert Combat files Heavy Assault in the row
// vanilla calls `medic` and Special Ops in a sixth.
const el = () => ({
  hidden: true, clientWidth: 800, clientHeight: 600, classList: { toggle() {} },
  addEventListener() {}, getContext: () => null,
});
globalThis.document = { getElementById: el };
globalThis.fetch = () => Promise.reject(new Error('no network in the harness'));
globalThis.ResizeObserver = class { observe() {} };
globalThis.addEventListener = () => {};
globalThis.Image = class {};
const { createScoreboardScreen } = await import('./scoreboard-screen.js');

const loadouts = { kits: {
  US_HeavyAssault: { class: 'Assault' }, US_SpecOps: { class: 'Engineer' },
  US_Medic: { class: 'Medic' }, GB_Scout: { class: 'Scout' },
} };
const SLOTS = { assault: 'Us_Assault', medic: 'US_HeavyAssault', slot5: 'US_SpecOps' };
function localKit(deployKit, { carriedKit = null, withLoadouts = true } = {}) {
  const board = createScoreboardScreen({
    bust: () => '', hudPaths: { url: rel => rel }, bots: [], roomJoined: false, roomClient: null,
    roomName: 'Player', LOCAL_PLAYER: 1, deployTeamId: 2, deployKit, carriedKit,
    loadouts: withLoadouts ? loadouts : null,
    kitLoadout: (team, row) => ({ kit: withLoadouts ? SLOTS[row] ?? null : null }),
    soldier: {}, soldierDead: false, world: null, fullmapBox: { classList: { toggle() {} } },
  });
  return board.scoreboardPlayers()[0].kit;
}
// The end of a round holds the board up: Tab's release (`setScoreboard(false)`)
// cannot take it down until the round lets go of it.
function held() {
  const board = createScoreboardScreen({
    bust: () => '', hudPaths: { url: rel => rel }, bots: [], roomJoined: false, roomClient: null,
    roomName: 'Player', LOCAL_PLAYER: 1, deployTeamId: 2, deployKit: 'assault', loadouts: null,
    kitLoadout: () => ({ kit: null }), soldier: {}, soldierDead: false, world: null,
    fullmapBox: { classList: { toggle() {} } },
  });
  const out = {};
  board.holdOpen(true);
  out.openWhenHeld = board.scoreboardOpen();
  board.setScoreboard(false);
  out.openAfterTabRelease = board.scoreboardOpen();
  board.holdOpen(false);
  out.openAfterLetGo = board.scoreboardOpen();
  // A board the spawn screen opened is taken over, not left as the spawn's.
  board.setScoreboard(true, true);
  board.holdOpen(true);
  out.fromSpawnWhenHeld = board.scoreFromSpawn;
  return out;
}

// In a room the roster carries each slot's stats when the client has them:
// the sidecar's client (`net-sidecar.js` statsOf) does, the page's own room
// client does not, and its rows carry none.
function roomRoster(withStats) {
  const roomClient = {
    hello: { team: 1 }, slot: 1, feed: [],
    remoteSlots: () => [2],
    nameOf: slot => (slot === 2 ? 'Remote' : ''),
    teamOf: () => 2,
    ...(withStats ? { statsOf: slot => ({ 1: { score: 7, kills: 2, deaths: 1, ping: 3 },
                                          2: { score: 4, kills: 1, deaths: 2, ping: 0 } })[slot] ?? null } : {}),
  };
  const board = createScoreboardScreen({
    bust: () => '', hudPaths: { url: rel => rel }, bots: [], roomJoined: true, roomClient,
    roomName: 'Me', LOCAL_PLAYER: 1, deployTeamId: 2, deployKit: 'assault', loadouts: null,
    kitLoadout: () => ({ kit: null }), soldier: {}, soldierDead: false, world: null,
    fullmapBox: { classList: { toggle() {} } },
  });
  return board.scoreboardPlayers().map(p => ({ slot: p.slot, name: p.name, stats: p.stats ?? null }));
}

console.log(JSON.stringify({
  sidecarRoster: roomRoster(true),
  roomRoster: roomRoster(false),
  held: held(),
  heavyAssaultInTheMedicRow: localKit('medic'),
  specOpsInTheSixthRow: localKit('slot5'),
  carried: localKit('medic', { carriedKit: 'GB_Scout' }),
  noLoadouts: localKit('medic', { withLoadouts: false }),
  unknownKit: localKit('assault'),
}));
