# play.bfstats.io load speed

Three complaints, 2026-10-21: opening play.bfstats.io flashed the mesh site
(the Models / Maps / Poses / Kits bar) before the menu, the first click on each
front-end tab showed a black screen before it drew, and the whole site took
seconds to show anything.

## What was measured (production, 2026-10-21)

- **The root was the game page.** HAProxy rewrites `play.bfstats.io/` to
  `/map.html`. A bare map.html hands over to the front end (`play/`), but that
  check sat in its inline module, after the module's ~360 static imports had
  been fetched and run. So every visit to the root painted the mesh nav bar,
  downloaded 245+ game modules, and only then redirected: 12.4 s to
  DOMContentLoaded. In a browser without WebGL it never redirected at all; the
  renderer threw first.
- **The menu was a waterfall of round trips.** `play/index.html` took about
  4 s on a warm visit, as ten sequential steps of ~400 ms each: the module
  graph six levels deep (every module `no-cache`, so revalidated with a 304 on
  every load), then `mods.json`, the layouts, the level lists, the font tables,
  the font pictures and the plates, each waiting on the one before. `.json` is
  never cached at the edge (see asset-batch-downloads), so each of those is a
  trip to the node. Every screen also fetched `mods.json` again, uncached.
- **Tabs loaded on first click.** Each tab's `load()` ran when it was first
  shown, and its canvas was unhidden before the load finished.

## What changed

- **map.html's hand-over is first in its `<head>`** (`window.stop()` then
  `location.replace`), before the stylesheets, the bar and the module. nginx
  also answers an argument-less `/map.html`, which is what `/` becomes on the
  play host, with a 302 to `/play/index.html`, so the root never sends the page
  at all. The JS guard still covers `?mod=` and local servers.
- **Versioned, immutable code** (`mesh/stamp-viewer.mjs`, run in the
  Dockerfile). Each page's import map gains `"/": "/_v/<version>/"` (and
  `"/_v/": "/_v/"` so a versioned module is not prefixed twice), every module
  resolves to `/_v/<version>/<path>`, and nginx serves those for a year,
  `immutable`. `<version>` hashes every code file. The pages stay `no-cache` and
  name the version. A returning visitor revalidates one HTML file instead of
  the whole graph. The script also writes a `modulepreload` for every module
  in the page's static graph, so a cold visit fetches the graph in one round.
  Source pages and local servers are untouched.
- **Modules that resolve against `import.meta.url`** (mods.js, replay-open.js,
  recording-inspect.js, vehicle-base.js) use `viewer-root.js`'s
  `VIEWER_ROOT`, which removes the version segment. Without it a level or
  manifest would be fetched under a URL that changes on every deploy, and
  `replay-open.js` would navigate to `/_v/<version>/map.html`. nginx also sends
  a `/_v/` path into the volume's trees (`models`, `maps`, `replays`, `glbs`,
  `textures`) back through its own location, and redirects a versioned page
  to its plain address. `tests/test_stamp_viewer.py` fails if a module
  outside `viewer-root.js` reads `import.meta.url`.
- **The menu's requests go out together.** `play/index.html` starts
  `mods.json` in its head (`__bf42ModsJson`, which `loadMods` takes) and
  preloads vanilla's layouts, level lists, fonts and background still.
  `loadMods` is read once per page. `skirmish.js` asks for the level lists
  alongside the layouts, and `menu-pack.js` asks for the plates and font
  pictures alongside the glyph tables.
- **Tabs are pre-warmed and swap only when drawn.** After Instant Battle is
  up, `front-end.js` loads Custom Game, Multiplay, Replay and Controls in
  idle time. Multiplay's polls are stopped again unless it is the tab up.
  `show()` keeps the current canvas up until the new tab's load resolves, then
  unhides, paints and hides the old one in the same task. A failed background
  load is forgotten, so the click retries instead of revealing an empty
  screen. Multiplay's polls now stop on every tab change, not only on the way
  back to Instant Battle.

## Results

On this PC, through the image (`docker build -f mesh/Dockerfile`) with the
local asset trees mounted, at 100 ms of added latency per request (DevTools
throttling, HTTP/1.1 nginx), against the same image built from the previous
`HEAD`:

| | before | after |
|---|---|---|
| `/map.html` (what `/` serves) to menu, cold | 8.8 s | 1.9 s |
| the same, warm | 8.1 s | 0.43 s |
| first click on Multiplay / Custom Game / Replay, time black | 130 / 226 / 41 ms | 0 |

A Wake load under the versioned code reaches its hooks in ~3 s and renders
(headless Vulkan, `?shots`), with no unversioned or duplicated module in the
resource list.

## Open

- HAProxy could redirect `/` to `/play/` itself (deploy/app/ingress), saving
  the hop through nginx. That needs an ingress apply, so the owner decides.
- The Cloudflare Cache Rule for `.json`/`.glb` (asset-batch-downloads, "The
  edge and the deploy purge") would take the menu's JSON off the node too.
- The first ~60 s after a deploy: the edge may still hand out the previous
  page (`s-maxage=60`). That page names the old version, whose URLs nginx now
  answers with the new files. This is the same skew window as before.
