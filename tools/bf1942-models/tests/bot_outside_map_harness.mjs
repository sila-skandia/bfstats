// The land map's impassable material (viewer/nav-map.js `impassableMaterial`,
// `OUTSIDE_MAP_MATERIAL`; ledger AI-27, AI-93, CA-5), under node, for
// tests/test_bot_outside_map.py. Prints one JSON object.
//
// A flat 128 m world whose terrain paints material 7 (the combat area's
// "Reserved (Outside map)") on a tongue x 40..80, z -40..-128 that cuts in
// from the south edge, the way Aberdeen's surround cuts in beside the
// British base. Two points either side of the tongue's tip: the straight
// line between them crosses it. Cases: the painted map with the option
// blocks the tongue (and the brush grows it a metre); without it the tongue
// is free, as the generator's walk test paints it; a water map ignores it; a
// deck over the material frees nothing; a level's own baked map is taken as
// it is; and the route between the two points goes round the tongue's tip
// with the option and across it without.

import {
  buildNavMap, findPath, gridAt, CELL_FREE, CELL_MATERIAL, OUTSIDE_MAP_MATERIAL,
} from './nav-grid.js';

const SIZE = 128;
const onTongue = (x, z) => x >= 40 && x < 80 && z <= -40;
const heightfield = {
  materials: new Uint8Array(1),   // "has a material map"
  height() { return 0; },
  material(x, z) { return onTongue(x, z) ? 7 : 3; },
};
const box = (x0, x1, y0, y1, z0, z1) => {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const q = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]];
  const out = [];
  for (const [a, b, c, d] of q) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  return out;
};
const collider = { waterLevel: -10, heightfield, surfaceHeight: () => 0, statics: null };
// A drivable deck 3 m up over the tongue (x 50..60, z -60..-50): its top is
// above the soldier's clip band, so on plain ground it would be a surface.
const deckTris = new Float32Array(box(50, 60, 2.9, 3, -60, -50));
const deckCollider = { ...collider, statics: { tris: deckTris, count: deckTris.length / 9, drivable: new Uint8Array(deckTris.length / 9).fill(1) } };

const out = { codes: { CELL_FREE, CELL_MATERIAL }, outsideMapMaterial: OUTSIDE_MAP_MATERIAL };
const withRule = buildNavMap(collider, SIZE, { impassableMaterial: OUTSIDE_MAP_MATERIAL, strategic: false });
const without = buildNavMap(collider, SIZE, { strategic: false });
out.tongueWith = gridAt(withRule, 60.5, -100.5);
out.tongueWithout = gridAt(without, 60.5, -100.5);
// The brush (the infantry map's plus) grows it a metre past its edge, no more.
out.edgeWith = gridAt(withRule, 39.5, -100.5);
out.pastEdgeWith = gridAt(withRule, 38.5, -100.5);
out.plainWith = gridAt(withRule, 20.5, -100.5);
const water = buildNavMap({ ...collider, waterLevel: 10 }, SIZE, { waterMap: true, waterDepth: 5, brush: 0, impassableMaterial: OUTSIDE_MAP_MATERIAL, strategic: false });
out.waterTongue = gridAt(water, 60.5, -100.5);
const deck = buildNavMap(deckCollider, SIZE, { maxSlopeDeg: 30, brush: 1, lowClip: 0.3, hiClip: 2.5, impassableMaterial: OUTSIDE_MAP_MATERIAL, strategic: false });
const deckPlain = buildNavMap(deckCollider, SIZE, { maxSlopeDeg: 30, brush: 1, lowClip: 0.3, hiClip: 2.5, strategic: false });
out.deckWith = gridAt(deck, 55.5, -55.5);
out.deckWithout = gridAt(deckPlain, 55.5, -55.5);
// A loaded map that leaves the material free (a generated layer's) has it
// blocked; one that blocks it already (every DICE map) is unchanged, cell
// for cell; without the option a loaded map is what it says.
const baked = { pixelSize: 1, params: { name: 'Infantry1' }, level: 0, mapIndex: 0, blocked: () => false };
const bakedNav = buildNavMap(collider, SIZE, { searchMap: baked, impassableMaterial: OUTSIDE_MAP_MATERIAL, strategic: false });
out.bakedSource = bakedNav.source;
out.bakedTongue = gridAt(bakedNav, 60.5, -100.5);
out.bakedPlain = gridAt(bakedNav, 20.5, -100.5);
out.bakedWithout = gridAt(buildNavMap(collider, SIZE, { searchMap: baked, strategic: false }), 60.5, -100.5);
const dice = { ...baked, blocked: (px, pz) => onTongue(px + 0.5, -(pz + 0.5)) };
const diceWith = buildNavMap(collider, SIZE, { searchMap: dice, impassableMaterial: OUTSIDE_MAP_MATERIAL, strategic: false });
const diceWithout = buildNavMap(collider, SIZE, { searchMap: dice, strategic: false });
out.diceUnchanged = diceWith.blocked.every((v, i) => v === diceWithout.blocked[i]);
// The route from west of the tongue to east of it, both 20 m from its tip.
const maxZ = p => Math.max(...p.map(q => q[1]));
// Every half metre along every leg, not only the corners.
const crosses = p => p.some(([x, z], i) => {
  if (i === 0) return onTongue(x, z);
  const [px, pz] = p[i - 1];
  const n = Math.max(1, Math.ceil(Math.hypot(x - px, z - pz) / 0.5));
  for (let k = 0; k <= n; k++) if (onTongue(px + (x - px) * k / n, pz + (z - pz) * k / n)) return true;
  return false;
});
const routeWith = findPath(withRule, 30.5, -50.5, 90.5, -50.5);
const routeWithout = findPath(without, 30.5, -50.5, 90.5, -50.5);
out.routeWith = routeWith ? { points: routeWith.length, crosses: crosses(routeWith), northmost: maxZ(routeWith) } : null;
out.routeWithout = routeWithout ? { points: routeWithout.length, crosses: crosses(routeWithout), northmost: maxZ(routeWithout) } : null;
process.stdout.write(JSON.stringify(out) + '\n');
