// What a drawn soldier wears: his kit's helmet, pack and pouches, hung on his
// own bones.
//
// A `BFSoldier` template declares a body, a head and two hands and nothing
// else, so every pose glb the extractor writes is bare-headed; the worn parts
// belong to the KIT, and the engine hangs each one off one of three bones of
// the wearer's skeleton (`A` under `Bip01 Head`, `backpack`, `HipPack`). The
// rotation per slot and a part's own offsets are `kit-graft.js`'s, pinned by
// eye (three automated checks once passed a graft with every helmet upside
// down), and this is only the three.js half: fetch `kits.json` and the part
// glbs once, clone a part onto the bone, and take it off again before the
// figure is disposed.
//
// One dresser for every soldier the map page draws -- the bots on foot, in
// their seats and as corpses (`bot-visuals.js`), the human on foot
// (`foot-body.js`) and seated (`seat-pose.js`) -- so they all wear their kits
// the same way. The soldier template itself (the level's `game.setTeamSkin`,
// British on El Alamein's Allied side, Japanese on Wake's Axis) is
// `kit-loadout.js`'s `soldierTemplateFor`; the pose glb it names already
// carries that nation's uniform and head.

import { bonePattern, kitsByTemplate, wornGrafts } from './kit-graft.js';

/** The flag a grafted part carries: its geometry and materials are the
 *  cache's, shared by every wearer, so disposing a figure must not free them. */
export const KIT_PART = 'kitPart';

export const isKitPart = obj => !!obj?.userData?.[KIT_PART];

/**
 * Unhook every grafted part from `root`, so a traversal that frees geometry
 * and materials frees only the figure's own. Returns how many came off.
 */
export function undress(root) {
  if (!root) return 0;
  const parts = [];
  root.traverse(obj => { if (isKitPart(obj)) parts.push(obj); });
  for (const part of parts) {
    part.removeFromParent();
    // The materials the page's shading made for this wearer are his own; the
    // textures under them are the cache's and stay.
    for (const m of part.userData.ownMaterials ?? []) m.dispose();
    part.userData.ownMaterials = null;
  }
  return parts.length;
}

/** The kit parts hanging on `root` now, by slot: `{ head, back, hip }`. */
export function wornSlots(root) {
  const out = {};
  root?.traverse(obj => {
    if (isKitPart(obj)) out[obj.userData.kitSlot] = (out[obj.userData.kitSlot] ?? 0) + 1;
  });
  return out;
}

/**
 * The welded weapon's subtree on a pose glb's figure: the node named after
 * the weapon template (`extras.weapon`) that has the weapon's meshes under
 * it. Not simply the node of that name: `UsSoldier.ske` carries a bone called
 * `Thompson` under `Bip01 R Hand`, so a Thompson pose holds two `Thompson`
 * nodes, GLTFLoader keeps names unique by suffixing the second
 * (`Thompson_1`), and the lookup found the empty bone -- a Thompson carried
 * into a death or a swim was never stowed (`c_AsmHideWeapon`).
 */
export function weaponNodeOf(root, name) {
  if (!root || !name) return null;
  const pattern = new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_\\d+)?$`);
  let best = null;
  let most = 0;
  root.traverse(obj => {
    if (!pattern.test(obj.name) || isKitPart(obj)) return;
    let meshes = 0;
    obj.traverse(o => { if (o.isMesh) meshes++; });
    if (meshes > most) { best = obj; most = meshes; }
  });
  return best;
}

/** The bone a kit row names (`A`, `backpack`, `HipPack`), matched loosely. */
function boneNamed(root, want) {
  const pattern = bonePattern(want);
  let found = null;
  root.traverse(obj => { if (!found && !isKitPart(obj) && pattern.test(obj.name)) found = obj; });
  return found;
}

/**
 * `ctx`: `loader` (a GLTFLoader), `bases()` (the model roots to try, the
 * active mod's first and vanilla's after, so a mod that ships only its own
 * worn meshes falls back), `bust()`, and optionally `shade(node)`, the
 * page's level lighting for the wearer's copy of a part (the body it hangs on
 * is shaded the same way, and a part shaded once in the cache would keep the
 * first level's light through a level change).
 */
export function createSoldierDress(ctx) {
  const manifests = new Map();     // base -> Promise<Map<kit, row>>
  const parts = new Map();         // glb -> Promise<scene | null>

  function kitsIndex(base) {
    if (!manifests.has(base)) {
      manifests.set(base, fetch(`${base}/kits.json${ctx.bust()}`)
        .then(r => (r.ok ? r.json() : null))
        .then(kitsByTemplate, () => new Map()));
    }
    return manifests.get(base);
  }

  /** The kit row for `kitName`: the first base that knows it. */
  async function kitRow(kitName) {
    if (!kitName) return null;
    const key = String(kitName).toLowerCase();
    for (const base of ctx.bases()) {
      const row = (await kitsIndex(base)).get(key);
      if (row) return { row, base };
    }
    return null;
  }

  function loadPart(glb, bases) {
    const key = `${bases.join('|')}|${glb}`;
    if (!parts.has(key)) {
      parts.set(key, (async () => {
        for (const base of bases) {
          try {
            const gltf = await ctx.loader.loadAsync(`${base}/${glb}${ctx.bust()}`);
            return gltf.scene;
          } catch { /* not in this tree: the next base */ }
        }
        return null;
      })());
    }
    return parts.get(key);
  }

  /**
   * Hang `kitName`'s worn parts on `root`'s bones. `still()` is asked after
   * every await, so a figure disposed while its parts were in flight is not
   * dressed after the fact. Resolves to the number of parts hung.
   */
  async function dress(root, kitName, still = () => true) {
    const found = await kitRow(kitName);
    if (!found || !root || !still()) return 0;
    const bases = [found.base, ...ctx.bases().filter(b => b !== found.base)];
    let hung = 0;
    for (const graft of wornGrafts(found.row)) {
      const source = await loadPart(graft.glb, bases);
      if (!source || !still()) continue;
      const bone = boneNamed(root, graft.bone);
      if (!bone) continue;             // no such bone on this figure: silently bare
      const node = source.clone(true);
      node.quaternion.set(...graft.quaternion);
      node.position.set(...graft.position);
      node.userData[KIT_PART] = true;
      node.userData.kitSlot = graft.slot;
      node.traverse(obj => { if (obj.isMesh) obj.frustumCulled = false; });
      if (ctx.shade) {
        const shared = new Set();
        source.traverse(obj => { for (const m of [obj.material].flat()) if (m) shared.add(m); });
        ctx.shade(node);
        const own = new Set();
        node.traverse(obj => {
          for (const m of [obj.material].flat()) if (m && !shared.has(m)) own.add(m);
        });
        node.userData.ownMaterials = [...own];
      }
      bone.add(node);
      hung++;
    }
    return hung;
  }

  return { dress, kitRow, undress };
}
