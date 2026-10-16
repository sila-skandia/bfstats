// The ticket blink above the minimap (viewer/ticket-feed.js ticketBlinks): the retail client's own rule,
// a side's tickets blink while the other side holds 100 or more weight of control points (map draw
// 0x0046a680, setge 100), tickets <= 10 in ObjectiveMode; Conquest, CoOp and ObjectiveMode only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir();
installModuleHooks(viewer);
const { ticketBlinks } = await import(path.join(viewer, 'ticket-feed.js'));
const { GAME_PLAY_MODE } = await import(path.join(viewer, 'round-state.js'));

const scene = JSON.parse(fs.readFileSync(path.join(viewer, 'maps', 'wake', 'scene.json'), 'utf8'));
const coop = scene.modes.SinglePlayer.controlPoints.map((c) => ({ name: c.name, team: c.team, areaValue: c.areaValue }));
const out = {};
out.wakeCoop = { weights: coop.map((c) => [c.name, c.team, c.areaValue]), blinks: ticketBlinks(GAME_PLAY_MODE.coop, coop) };
const beachLost = coop.map((c) => (c.name === 'The_Beach' ? { ...c, team: 1 } : c));
out.beachTaken = ticketBlinks(GAME_PLAY_MODE.coop, beachLost);
out.conquestSame = ticketBlinks(GAME_PLAY_MODE.conquest, coop);
out.tdm = ticketBlinks(GAME_PLAY_MODE.tdm, coop);
out.ctf = ticketBlinks(GAME_PLAY_MODE.ctf, coop);
out.objective = { low: ticketBlinks(GAME_PLAY_MODE.objective, coop, { team1: 10, team2: 11 }), none: ticketBlinks(GAME_PLAY_MODE.objective, coop, null) };
console.log(JSON.stringify(out));
