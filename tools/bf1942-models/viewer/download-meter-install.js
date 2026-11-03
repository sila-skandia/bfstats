// Puts `download-meter.js` on the page: every file the page downloads is
// counted for the loading screen's download line (progress.js `downloads`).
// Import it after `asset-retry-install.js`, so a file tried three times is
// one file, and before anything fetches.

import * as THREE from 'three';
import { createDownloadMeter } from './download-meter.js';

export const downloadMeter = globalThis.__downloadMeter ?? createDownloadMeter();

if (!globalThis.__downloadMeter) {
  globalThis.__downloadMeter = downloadMeter;
  globalThis.fetch = downloadMeter.meterFetch(globalThis.fetch.bind(globalThis));
  downloadMeter.meterImageLoader(THREE.ImageLoader, THREE.Cache);
}
