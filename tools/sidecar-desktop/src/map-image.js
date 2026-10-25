'use strict';
// The map preview images bfstats.io serves from the assets volume, addressed
// the way the live list reports a server: mod (`gameId`) and map name.
// Mirrors ui/src/utils/mapImage.ts (keep in sync); the API lowercases both
// halves and walks the mod's inheritance, so a mod server on a vanilla map
// still finds its image. Community maps often have none: callers fall back.

const ASSETS_BASE = 'https://bfstats.io/stats/assets/maps/';

/** `Battle of the Bulge` and `battle_of_the_bulge` -> `battle_of_the_bulge`. */
function mapSlug(mapName) {
  return String(mapName ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

function mapImageUrl(gameId, mapName, { base = ASSETS_BASE } = {}) {
  const mod = String(gameId ?? '').trim().toLowerCase();
  const map = mapSlug(mapName);
  if (!mod || !map) return null;
  return `${base}${encodeURIComponent(mod)}/${encodeURIComponent(map)}`;
}

module.exports = { ASSETS_BASE, mapSlug, mapImageUrl };
