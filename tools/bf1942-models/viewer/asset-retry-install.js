// Puts `asset-retry.js` on the page: wraps the global `fetch` and three's
// ImageLoader so a download that fails on a flaky connection is tried again
// before a texture is left white. Import it first, before anything fetches.

import * as THREE from 'three';
import { createRetryingFetch, patchImageLoader } from './asset-retry.js';

if (!globalThis.fetch?.__assetRetry) {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const onRetry = ({ url, attempt, reason }) => console.warn(`[asset-retry] ${reason}; try ${attempt + 1}: ${url}`);
  const retrying = createRetryingFetch(nativeFetch, { onRetry });
  retrying.__assetRetry = true;
  globalThis.fetch = retrying;

  patchImageLoader(THREE.ImageLoader, THREE.Cache, {
    onRetry,
    // The probe goes straight out: the retrying fetch would sit out its own
    // waits before telling the image loader the network is down.
    probe: url => nativeFetch(url, { method: 'HEAD', cache: 'no-store' }).then(r => r.status, () => null),
  });
}
