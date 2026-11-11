// Pins how the strategic layer binds the world's flags to its areas and what
// the SAI counts as a side's control points (features/bot-map-generation/
// flag-binding.md): control points first, the page's stand-ins (a spawn group
// no point claims, a ship's decks) after and only into an area that holds no
// control point. `ControlPoint` is still the page's sum (stand-ins and owned
// areas typed `ControlPoint` with the points); pinned as it is. The shape
// is FHSW Edson's Ridge's: the Allies' flags own no spawn (capture-only), and
// their orphan spawn groups stand beside them. Run by
// `tests/test_strategic_flag_binding.py`. One JSON object on stdout.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = await import(pathToFileURL(path.join(HERE, '..', 'sim', 'env.mjs')).href);
env.installModuleHooks(path.join(HERE, '..', 'viewer'));
const { StrategicLayer, StrategicAI, isStandIn } = await import(pathToFileURL(path.join(HERE, '..', 'viewer', 'strategic.js')).href);

const area = (name, min, max, neighbours, flags, side, takeable = {}) => ({ name, min, max, radius: 40, neighbours, flags, side, takeable, orderPositions: {} });
const ai = {
  strategicAreas: [
    area('AxisBase', [50, -150], [150, -50], ['West', 'Pass'], ['Base', 'ControlPoint'], 1, { 2: false }),
    area('West', [350, -550], [450, -450], ['AxisBase', 'East', 'Pass'], ['Flank', 'ControlPoint'], 2),
    area('East', [550, -550], [650, -450], ['West', 'AlliedBase'], ['Close', 'ControlPoint'], 2),
    area('Pass', [350, -250], [450, -150], ['AxisBase', 'West'], ['Route'], 2),
    area('AlliedBase', [850, -950], [950, -850], ['East'], ['Base', 'ControlPoint'], 2, { 1: false }),
  ],
  conditions: [], prerequisites: [],
  strategies: [{ name: 'push', aggression: 1, attacks: 2, defences: 0, modifiers: [] }],
  sideStrategies: { 1: ['push'], 2: ['push'] },
};
// In spawn-flags.js order: points with spawns, the stand-ins, then the
// capture-only points.
const flags = [
  { name: 'AxisBase', controlPointName: 'AxisBase', position: [150, 0, -150], team: 1, uncapturable: true },
  { name: 'AlliedBase', controlPointName: 'AlliedBase', position: [950, 0, -950], team: 2, uncapturable: true },
  { name: 'sbWest', position: [440, 0, -540], team: 2, uncapturable: true, standalone: true, controlPointName: null },
  { name: 'sbPass', position: [440, 0, -240], team: 2, uncapturable: true, standalone: true, controlPointName: null },
  { name: 'ship', position: [640, 0, -540], team: 2, uncapturable: true, vehicle: true },
  { name: 'West', controlPointName: 'West', position: [450, 0, -550], team: 2, uncapturable: false, captureOnly: true },
  { name: 'East', controlPointName: 'East', position: [650, 0, -550], team: 2, uncapturable: false, captureOnly: true },
];
const layer = new StrategicLayer(ai, flags);
const sai = new StrategicAI(layer, { random: () => 0.5 });
sai.beginPass(new Map());
const states = {};
for (const side of [1, 2]) {
  sai._updateStates(side);
  states[side] = { controlPoint: sai.sides[side].states.friendly.get('ControlPoint') ?? 0,
                   enemyControlPoint: sai.sides[side].states.enemy.get('ControlPoint') ?? 0 };
}
sai._updateTemperatures(1);
const out = {
  bound: Object.fromEntries(layer.areas.map(a => [a.name, a.controlPoints.map(f => f.name)])),
  owners: Object.fromEntries(layer.areas.map(a => [a.name, layer.ownerOf(a)])),
  axisTargets: layer.areas.filter(a => sai._attackValue(a, 1) > 0.1).map(a => a.name),
  states,
  standIns: flags.filter(isStandIn).map(f => f.name),
};
process.stdout.write(JSON.stringify(out) + '\n');
