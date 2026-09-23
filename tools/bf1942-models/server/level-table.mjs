// The server's level table: every `viewerDir/maps/*` entry with a scene.json,
// loaded once at start (a level that fails to load is logged and skipped),
// plus the harness's `test` descriptor level. Split out of `server.mjs`.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadRealLevel, buildLevelFromDescriptor } from './level.mjs';

export function buildLevelTable(viewerDir) {
  const levels = new Map();
  const mapsDir = join(viewerDir, 'maps');
  if (existsSync(mapsDir)) {
    for (const entry of readdirSync(mapsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!existsSync(join(mapsDir, entry.name, 'scene.json'))) continue;
      try {
        levels.set(entry.name, loadRealLevel({ viewerDir, name: entry.name }));
        console.log(`level ${entry.name}: loaded`);
      } catch (error) {
        console.log(`level ${entry.name}: skipped (${error.message})`);
      }
    }
  }
  // The harness's fake level, always registered: the socket test joins it
  // with {level: 'test'} (a plain join creates on the default level instead).
  levels.set('test', buildLevelFromDescriptor({ viewerDir }));
  return levels;
}
