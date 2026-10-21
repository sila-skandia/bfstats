// The viewer's root directory, where the pages, `models/` and `maps/` are,
// for a module that resolves a URL against itself rather than the page.
//
// The mesh image serves every module from a versioned path as well,
// `/_v/<version>/x.js` (mesh/stamp-viewer.mjs writes the import map that
// sends imports there, and nginx serves those paths immutable). A module
// loaded that way has that path for its `import.meta.url`. Code is all that
// should travel through it: a level, a manifest or a page reached from it
// would be fetched under a second URL that changes on every deploy, so
// `new URL('./', import.meta.url)` is not the root on its own. This takes the
// version segment back out, and leaves a local server's paths, which never
// carry one, as they are.

export const VIEWER_ROOT = new URL('./', import.meta.url.replace(/\/_v\/[0-9a-f]+\//, '/'));
