// The server's level table: every `viewerDir/maps/*` entry with a scene.json,
// plus the harness's `test` descriptor level. Split out of `server.mjs`.
//
// A level is loaded when a room first asks for it, and kept only while a room
// plays it. Until 2026-11-13 every level was loaded at start and kept for
// good. Measured after a full collection (`heapUsed + external`): Wake 36 MB,
// Battle of Britain 31, Berlin 17, about 28 a level; the live vanilla tree
// holds 100 level directories, so the table alone was near 2.8 GB before the
// first room, on a node of 7.7 GB that runs everything else. A level that
// fails to load is logged then, and is no level from there on.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadRealLevel, buildLevelFromDescriptor } from './level.mjs';

/**
 * The table the room registry asks (`get`, `has`): a Map whose real levels
 * are loaded on demand and held weakly (a room holds its `LevelData`, so the
 * level lives exactly as long as some room plays it; the next room after
 * that loads it again). Entries set by hand (`test`) are an ordinary Map's.
 */
export class LevelTable extends Map {
  #names = new Set();
  #held = new Map();
  #load;
  #cost;
  #costs = new Map();

  constructor(names, load, cost = null) {
    super();
    for (const name of names) this.#names.add(name);
    this.#load = load;
    this.#cost = cost;
  }

  /** What a level will cost a room's bots, known before it is loaded
   *  (`levelCost`): `{ worldSize, hullMaps, waterMaps }`, or null for a level
   *  set by hand or one whose report cannot be read. The room cap's terms
   *  (`room-registry.mjs`). */
  cost(name) {
    if (!this.#cost || !this.#names.has(name)) return null;
    if (!this.#costs.has(name)) {
      let cost = null;
      try { cost = this.#cost(name); } catch { cost = null; }
      this.#costs.set(name, cost);
    }
    return this.#costs.get(name);
  }

  has(name) { return super.has(name) || this.#names.has(name); }

  get(name) {
    if (super.has(name)) return super.get(name);
    if (!this.#names.has(name)) return undefined;
    const held = this.#held.get(name)?.deref();
    if (held) return held;
    try {
      const level = this.#load(name);
      this.#held.set(name, new WeakRef(level));
      console.log(`level ${name}: loaded`);
      return level;
    } catch (error) {
      console.log(`level ${name}: skipped (${error.message})`);
      this.#names.delete(name);
      this.#held.delete(name);
      return undefined;
    }
  }

  /** Every level the table can hand out, loaded or not. */
  names() { return [...super.keys(), ...this.#names]; }
}

/**
 * A level's size as the bots' navigation maps see it, off its `scene.json`:
 * the world's side in metres (a map is one cell a square metre,
 * `nav-map.js`), and how many maps its hulls can ask for beside the
 * infantry's: one for each search map the level's AI lists that is not the
 * soldiers' (`ai.addSearchMap`: `Tank0`, `Car4`, `Boat2`, `LandingCraft3`),
 * at least the one a level with none is given (`bot-units.js` `vehicleNav`,
 * the Tank defaults), and how many of those are water maps.
 */
export function levelCost(scene) {
  const extras = scene?.extras ?? scene ?? {};
  const maps = Array.isArray(extras.ai?.searchMaps) ? extras.ai.searchMaps : [];
  const hulls = maps.filter(m => !/^infant/i.test(String(m?.name ?? '')));
  return {
    worldSize: Number.isFinite(extras.worldSize) && extras.worldSize > 0 ? extras.worldSize : 2048,
    hullMaps: Math.max(1, hulls.length),
    waterMaps: hulls.filter(m => m?.waterMap).length,
  };
}

export function buildLevelTable(viewerDir, mod = null) {
  // `mod`: that mod's own tree in place of the vanilla one (`--mod fh`, the
  // page's `?mod=`). One server, one tree: a room names its level and no mod.
  const mapsDir = mod ? join(viewerDir, 'maps', 'mods', mod) : join(viewerDir, 'maps');
  const names = [];
  if (existsSync(mapsDir)) {
    for (const entry of readdirSync(mapsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!existsSync(join(mapsDir, entry.name, 'scene.json'))) continue;
      names.push(entry.name);
    }
  }
  const levels = new LevelTable(names, name => loadRealLevel({ viewerDir, name, mod }),
    name => levelCost(JSON.parse(readFileSync(join(mapsDir, name, 'scene.json'), 'utf8'))));
  console.log(`levels: ${names.length} in ${mapsDir}, each loaded when a room first plays it`);
  // The harness's fake level, always registered: the socket test joins it
  // with {level: 'test'} (a plain join creates on the default level instead).
  levels.set('test', buildLevelFromDescriptor({ viewerDir }));
  return levels;
}
