// The boot loader's stand-in for viewer-root.js (entry.js). The bundle is a
// classic script, inlined into the page in production, so it has no
// `import.meta.url`: its script tag says where the viewer's root is, relative
// to the page (`data-viewer-root`, "./" on map.html, "../" on play/index.html).

export const VIEWER_ROOT = new URL(document.currentScript?.dataset.viewerRoot ?? './', location.href);
