// tests/e2e/harnesses/ui_helpers.mjs
/**
 * Shared helper functions and definitions for Refractor UI tests.
 */

export function computeVirtualScale(viewportWidth, viewportHeight, targetWidth = 800, targetHeight = 600) {
  const scale = Math.min(viewportWidth / targetWidth, viewportHeight / targetHeight);
  const scaledWidth = targetWidth * scale;
  const scaledHeight = targetHeight * scale;
  const offsetX = Math.round((viewportWidth - scaledWidth) / 2);
  const offsetY = Math.round((viewportHeight - scaledHeight) / 2);
  return { scale, scaledWidth, scaledHeight, offsetX, offsetY };
}

export function formatLoadingTitle(name) {
  if (!name || !name.trim()) return 'LOADING MAP';
  const clean = name.trim().replace(/_/g, ' ').toUpperCase();
  return `LOADING ${clean}`;
}

export const MOD_THEMES = {
  vanilla: {
    name: 'vanilla',
    fillColor: '#847D4A',
    troughColor: '#292829',
    headerColor: '#847D4A',
  },
  eod: {
    name: 'eod',
    fillColor: '#F7E7B5',
    troughColor: '#E7D7B5',
    headerColor: '#B59B70',
  },
};
