// The GLTFLoader every page uses: the vendored one, loading through the
// content-addressed glb store (glb-store.js, features/mesh-asset-size
// phase 5).
//
// `load` first asks `resolveGlb` where the URL really lives. A name the
// tree's manifest hashes is fetched as `glbs/<sha>.glb` -- with the loader's
// resourcePath pinned to the ORIGINAL URL's directory, because the blob is
// byte-identical to the per-tree glb and its texture URIs are spelled
// relative to where that file lives. A name with no sha loads exactly as it
// always did, so an untreated tree is served untouched. Resolution never
// throws into the page: any failure falls back to the plain URL.
//
// Subclassing covers `loadAsync` too (Loader.loadAsync calls this.load), and
// every module that shares a page's loader instance.

import { GLTFLoader as VendorGLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { resolveGlb } from './glb-store.js';

export class GLTFLoader extends VendorGLTFLoader {
  load(url, onLoad, onProgress, onError) {
    resolveGlb(url)
      .catch(() => ({ url, resourcePath: null }))
      .then(({ url: resolved, resourcePath }) => {
        if (!resourcePath) {
          super.load(url, onLoad, onProgress, onError);
          return;
        }
        // A page that set its own resourcePath keeps it; the vendor loader
        // reads the field synchronously at the top of load(), so setting it
        // around the call is safe however many loads share this instance.
        const kept = this.resourcePath;
        this.resourcePath = kept || resourcePath;
        try {
          super.load(resolved, onLoad, onProgress, onError);
        } finally {
          this.resourcePath = kept;
        }
      });
  }
}
