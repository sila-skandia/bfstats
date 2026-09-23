// A ship's baked landing craft, split off as vehicles of their own before
// the level's scene is indexed. Split out of `seats.js`, which re-exports it.

/**
 * The sea craft an ObjectSpawner launches from a ship, split off as vehicles
 * of their own. A ship template carries its landing craft as child
 * `ObjectSpawner`s (`HatsuzukiDaihatsuSpawner`, `ShokakuDaiHatsuSpawner`,
 * `FletcherLcvpSpawner`, `Enterprise_lcvpSpawner`, ... in `Objects.rfa`), and
 * the engine spawns each as its own object; the exporter bakes the spawned
 * `Lcvp` / `Daihatsu` under its carrier's node instead, where every walk of
 * the carrier (its seats, its `shipSpec` engines and rudders, its collision
 * owner) took the craft for part of the ship. A nested PlayerControlObject
 * with a body of its own (`physics.mass`) in the sea category is such a
 * craft; a seat PCO carries no mass. Each is moved under the level's
 * `spawners` group, world pose kept, before the scene is indexed. Deck
 * aircraft (a carrier's Zero) stay where they are: the deck spawns follow
 * the hull (`rebaseDeckSpawns`). Returns the craft moved.
 */
export function detachSpawnedCraft(root) {
  let spawners = null;
  root.traverse(o => {
    if (!spawners && (o.userData?.kind === 'spawners' || o.name === 'spawners')) spawners = o;
  });
  if (!spawners) return [];
  const craft = [];
  for (const top of spawners.children) {
    top.traverse(o => {
      if (o === top || o.userData?.templateKind !== 'PlayerControlObject') return;
      const physics = o.userData.physics;
      if (!(physics?.mass > 0) || physics.vehicleCategory !== 'VCSea') return;
      craft.push(o);
    });
  }
  if (!craft.length) return craft;
  root.updateMatrixWorld(true);
  for (const o of craft) spawners.attach(o);
  return craft;
}
