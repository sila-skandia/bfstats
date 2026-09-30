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
console.log(JSON.stringify({
  heavyAssaultInTheMedicRow: localKit('medic'),
  specOpsInTheSixthRow: localKit('slot5'),
  carried: localKit('medic', { carriedKit: 'GB_Scout' }),
  noLoadouts: localKit('medic', { withLoadouts: false }),
  unknownKit: localKit('assault'),
}));
