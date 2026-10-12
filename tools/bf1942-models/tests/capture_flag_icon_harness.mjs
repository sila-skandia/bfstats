// The capture flag beneath the minimap (`viewer/ticket-feed.js`
// `feedFlagIconVars`, ledger HUD-15): up while the local player stands in the
// radius of a point his side does not hold and the map lets change hands, on
// foot or in a hull, and never for his own or a fixed point.
//
// Run by `tests/test_capture_flag_icon.py`; prints one JSON object.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const { createTicketFeed } = await import(path.join(viewer, 'ticket-feed.js'));
const { nearestEnemyFlag } = await import(path.join(viewer, 'bot-referee.js'));

const flags = [
  { name: 'neutral', team: 0, position: [0, 0, 0], radius: 20 },
  { name: 'enemy', team: 1, position: [100, 0, 0], radius: 20 },
  { name: 'own', team: 2, position: [200, 0, 0], radius: 20 },
  { name: 'enemyFixed', team: 1, position: [300, 0, 0], radius: 20, uncapturable: true },
];

function show(at, { dead = false, mounted = false, inWorld = true } = {}) {
  const position = { x: at[0], y: at[1], z: at[2] };
  const player = { team: 2, ...(mounted ? { vehicle: { state: { position } } } : { soldier: position }) };
  const page = {
    LOCAL_PLAYER: 'me',
    deployTeamId: 2,
    soldierDead: dead,
    world: { player: () => (inWorld ? player : null) },
    capturePosition: () => player.soldier ?? player.vehicle?.state?.position ?? null,
    nearestEnemyFlag: (team, p) => (p ? nearestEnemyFlag(flags, team, [p.x, p.y, p.z]) : null),
  };
  const vars = { ShowFlagIcon: 'stale' };
  createTicketFeed(page).feedFlagIconVars(vars);
  return vars;
}

console.log(JSON.stringify({
  neutral: show([5, 0, 5]),
  enemy: show([105, 0, 0]),
  enemyMounted: show([105, 0, 0], { mounted: true }),
  own: show([200, 0, 0]),
  enemyFixed: show([300, 0, 0]),
  outside: show([50, 0, 0]),
  above: show([0, 30, 0]),
  dead: show([5, 0, 5], { dead: true }),
  notInWorld: show([5, 0, 5], { inWorld: false }),
}));
