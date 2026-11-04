// The stats site's stand-in for the viewer's viewer-root.js. The scene modules
// under play/loaders/ are a synced copy of the viewer's (scripts/sync-ui-loaders.sh),
// and kit.js finds its sprites from VIEWER_ROOT. On this site the sprites are
// served from public/game-loaders/.

export const VIEWER_ROOT = new URL(
  `${import.meta.env.BASE_URL}game-loaders/`,
  globalThis.location?.origin ?? 'http://localhost/',
);
