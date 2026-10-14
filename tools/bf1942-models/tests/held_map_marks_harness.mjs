// The objects a hull's spawners hold are marks of their own on the map
// (`map-friendlies.js` `mapVehicleMarks`, AI-121), drawn at their declared
// size (`map-sprites.js` `drawSprite`), and no seat of the hull
// (`seat-survey.js` `surveyVehicle`): FHSW's bombers' attitude indicator.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { createMapFriendlies }, { createMapSprites }, { surveyVehicle }] = await Promise.all([
  imp('vendor/three.module.js'), imp('map-friendlies.js'), imp('map-sprites.js'), imp('seat-survey.js'),
]);

const node = (name, userData = {}, children = []) => {
  const obj = new THREE.Group();
  obj.name = name;
  obj.userData = userData;
  for (const child of children) obj.add(child);
  return obj;
};
const held = control => ({ templateKind: 'PlayerControlObject', control,
  heldSpawner: { holdObject: true, team: 2 } });
function bomber() {
  const ball = node('Attitude_indicator_B', held('Attitude_indicator_B'));
  ball.position.set(0, 100, 0);
  const cross = node('Attitude_indicator_A_ALLIED', held('Attitude_indicator_A_ALLIED'), [ball]);
  const base = node('Attitude_indicator_BASE_ALLIED', held('Attitude_indicator_BASE_ALLIED'), [cross]);
  const gunner = node('Mosquito_Gunner_PCO', { templateKind: 'PlayerControlObject', control: 'Mosquito_Gunner_PCO' });
  return node('Mosquito_B_MkIV', { templateKind: 'PlayerControlObject', control: 'Mosquito_B_MkIV' },
    [node('Mosquito_B_MkIV_Complex', { control: 'Mosquito_B_MkIV' }, [gunner, base])]);
}
const plane = bomber();
plane.updateMatrixWorld(true);
const marks = team => createMapFriendlies({
  deployTeamId: team, LOCAL_PLAYER: 1, world: { damageableOf: () => ({ hitPoints: 100 }), players: new Map(), player: () => null },
  mapVehicles: [plane], occupancy: null, vehicleSpawnActive: () => true,
  hudPack: { icons: { attitude_indicator_a_allied: { icon: 'attitude_indicator_a_256x256', size: 256 },
                      attitude_indicator_b: { icon: 'attitude_indicator_b_256x256', size: 256 } } },
}).mapVehicleMarks().map(m => [m.node.name, m.kind]);

// The sprite drawn at its declared size, whatever its pixels.
const drawn = [];
const ctx = { save() {}, restore() {}, translate() {}, rotate() {}, set globalAlpha(v) {},
  drawImage(img, x, y, w, h) { drawn.push([w, h]); } };
const { drawSprite } = createMapSprites({ sprite: () => ({ width: 512, height: 512 }) });
drawSprite(ctx, 'attitude_indicator_a_256x256', 0, 0, 0.5, { size: 256 });
drawSprite(ctx, 'minimap_icon_tank_16x16', 0, 0, 0.5);

process.stdout.write(JSON.stringify({
  allied: marks(2), axis: marks(1), drawn,
  seats: surveyVehicle(plane).order,
}));
