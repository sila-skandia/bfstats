# Mesh asset size

The extracted trees are several times the size of the archives they come from.
This is the optimisation round: make them smaller without moving a single texel
or vertex the viewer draws. Parity was the point of the export, so every step here
must be provably lossless, or measured and signed off where it can't be.

## Baseline (2026-09-29, this PC)

| Tree | On disk | Source archives |
|---|---|---|
| `viewer/maps` (vanilla) | 1.4 GB | `Mods/bf1942/Archives` 1.1 GB (of which sound 250 MB) |
| `viewer/maps/mods/xpack1` | 1.9 GB | `Mods/XPack1/Archives` 288 MB |
| `viewer/maps/mods/xpack2` | 2.2 GB | `Mods/XPack2/Archives` 451 MB |
| `viewer/maps/mods/eod` | 14 GB | parked |
| `viewer/models` (all mods) | 5.7 GB | |

Where the bytes are, over every `.glb` under `viewer/maps` (327 files, 18.0 GB):

| | Bytes | Share |
|---|---|---|
| Embedded PNG textures | 13.0 GB | 72% |
| of which a copy of an image already in another glb | 9.0 GB | 50% |
| Geometry and animation buffers | 4.2 GB | 23% |
| glTF JSON chunk | 0.84 GB | 5% |

The cause is layout, not content. The game keeps one Spitfire texture and every
level refers to it; each `scene.glb` here is self-contained, so it carries its
own copy of every texture it places. On top of that, PNG is a poor container for
pixels that came out of DXT: a lossless WebP of the same pixels is 23% smaller
(Bocage, 60 textures, pixel-identical round trip).

## Plan

Every phase is a post-process over a finished tree, idempotent and
deterministic, so the extractors and their layer model
(`features/level-bake-layers`) keep working unchanged. A glb that has not been
through a phase still loads.

### Phase 1: one texture store, lossless WebP (done 2026-09-29)

- `tools/bf1942-models/optimise_mesh.py` moves each embedded image into
  `<mesh root>/textures/<2 hex>/<hash>.webp` (a lossless WebP), and the glb
  points at it with a relative URI through `EXT_texture_webp`. The hash is taken
  over the decoded pixels, so the same texture from two levels, two trees or two
  mods is one file.
- The mesh root is the directory holding `models/` and `maps/` (`viewer/`
  locally, `assets/mesh` on the volume). The store is shared by every tree and
  every mod.
- A stored file never changes (its name is its content), so nginx serves
  `/textures/` as `immutable` with a one-year max-age. A texture a player has
  already loaded is never fetched again, whatever level they open next.
- Parity gate: for every rewritten glb, the pixels decoded from the store equal
  the pixels decoded from the embedded PNG, image for image, and the JSON
  (images and textures aside) and every non-image byte are unchanged.

Result on the in-scope trees (vanilla, XPack1, XPack2; maps and models),
2026-09-29, 36 s + 60 s at `-j 10`:

| | Before | After |
|---|---|---|
| glbs | 6,978 MB (1,650 files) | 2,409 MB |
| `textures/` | | 747 MB (3,580 WebP from 33,160 embedded images) |
| Total | 6,978 MB | 3,156 MB (-55%) |

WebP effort: method 4 at quality 75 comes within 6% of method 6 at quality 100,
in a 37th of the time. The name is the pixels, so a slower re-encode later only
replaces files.

How parity was checked:

- **In the tool:** every image is decoded from the new WebP and compared with
  the embedded PNG, and every accessor's bytes and the rest of the JSON are
  compared with the original, before a file is written. 0 failures.
- **On the GPU:** a harness (vendored `GLTFLoader`, headless Chromium on
  Vulkan) uploaded every texture of 43 models and two levels, old and new, and
  read the texels back with `readPixels`: identical, 0 mismatches. Whole-scene
  renders are not a usable gate on this GPU: the untouched Sherman rendered
  against itself differs by about 3,900 pixels.
- **In the viewer:** Bocage (504 texture requests), Anzio (XPack1), the
  Sherman and the Horten load with no failed request and no console error.

One behaviour moved, on purpose. `GLTFLoader` caches a texture by URI, so two
images in one glb with identical pixels and different names now share one
`THREE.Texture` (Bocage: 355 texture objects become 349). The pixels are the
same by construction, so nothing drawn changes, and it saves video memory. The
shared texture carries the first image's name; `levelSkins` in
`replay-assets.js` keys off names, and at worst swaps one texture for a
pixel-identical one.

Out of scope and left as they are: EoD and the other mod trees. They still
load, since the viewer reads both forms. The two tracked first-person fixtures
under `models/viewmodels/` are skipped too.

### Running it after a bake

The extractors still write self-contained glbs. After any bake or re-extract,
run the optimiser over what changed, then publish:

    python3 tools/bf1942-models/optimise_mesh.py tools/bf1942-models/viewer/maps --skip-mods -j 10
    python3 tools/bf1942-models/optimise_mesh.py tools/bf1942-models/viewer/maps/mods/xpack1 -j 10
    scripts/publish-mesh-delta.py            # textures, then models, then maps

A glb that skips the step still works; it's just bigger. The local hard-link
mirrors of `viewer/models` (`tournament-images/mesh`,
`bfstats-service-record/.e2e/assets-dev/mesh`) share the rewritten glbs'
inodes, so they need `textures/` beside `models/`:
`cp -al viewer/textures <mirror>/textures`, again after new textures land.

### Fresh bake, 2026-09-29 (local, not published)

Every extractor now ends by optimising its own output. To prove it from
scratch, vanilla, XPack1 and XPack2 were baked from the game into a scratch
mesh root through every extractor: models, kits, viewmodels, levels, effects
and poses.

- All steps exited 0, and no glb came out still embedding its textures. A
  second vanilla model run was byte-identical (830 files).
- It caught one bug: levels are built in staging and moved afterwards, and the
  first version optimised them in staging, so their URIs had the wrong depth.
  Fixed (the workers pass `--no-optimise`, the batch optimises after
  promotion), with a regression test. The optimiser now also fails any glb
  whose image URIs do not resolve.
- 873 files differed from the local tree. That was bake drift, not the
  optimiser: the local levels were baked on 26 September, before 15 exporter
  fixes that landed by 14:38 on 27 September (deck spawns, mode statics, spawn
  groups, skinning, kits).
- Installed into the local tree in place: 873 files changed and 1,413 added.
  The overwritten originals are in `~/.cache/swap-backup`, and the two tracked
  fixtures were kept as committed. The manifests came from a normal run with
  the local `thumb` keys carried over: a subset `extract_models.py` run leaves
  a 1-row `models.json`, and `extract_kits --all` writes a larger `kits.json`.
- Published after the owner's local test (a replayed round). One regression
  followed. A bake into an empty scratch tree has no prior rows to merge, so
  its `maps.json` lacked the `loading` key that `extract_loading_assets.py`
  adds, and every replay card fell back to `western.webp`. Restored from the
  pre-swap manifests, locally and live. When swapping a scratch bake in,
  merge the manifests (keep the keys the bake does not write), as
  `extract_maps_all.merge_index` does for an in-place bake.

Recipe (from `tools/bf1942-models`; `S` is a scratch mesh root):

    python3 extract_all.py [--mod XPack1|XPack2 --own] --level-all --configuration-all --cockpit -j 8 --out $S/models[/mods/<m>]
    python3 extract_kits.py [--mod <M> --own] --out $S/models[/mods/<m>]
    python3 extract_viewmodel.py <soldier weapon pairs> --out $S/models/viewmodels
    python3 extract_maps_all.py [--mod <M>] -j 8 --out $S/maps[/mods/<m>]
    python3 extract_effects.py [--mod <M>] --out $S/maps[/mods/<m>]/_shared
    python3 extract_pose.py [--mod <M>] --matrix --export --split-only --soldiers <...> --out <poses> -j 4
    python3 extract_pose.py [--mod <M>] --shared-assets --out <poses>
    python3 extract_pose.py [--mod <M>] --kit-poses --out <poses> -j 4

### Phase 2: geometry and JSON (measuring)

After phase 1 a glb is geometry plus JSON, and both compress well:

| After phase 1 | Size | gzip -6 | zstd -19 | meshopt, lossless |
|---|---|---|---|---|
| Bocage `scene.glb` | 21.4 MB | 42% | 22% | binary 55% |
| Telemark (XPack2) | 25.1 MB | | | binary 58% |
| Sherman | 0.32 MB | 45% | 41% | binary 79% |

The JSON chunk gzips to 11% (Bocage: 2.17 MB -> 0.24 MB). Lossless meshopt
(`encodeVertexBuffer` with no filter, `encodeIndexSequence`) does no better on
the binary than gzip; meshopt earns its keep with quantisation, which is not
lossless. So the candidates are:

- **gzip on the wire**: add `model/gltf-binary` to nginx's `gzip_types`. It cuts
  transfer by more than half; storage is unchanged. The cost is CPU per request
  on the node, much of it taken by Cloudflare's cache.
- **Pre-compressed files** (`gzip_static`, or brotli): the same transfer win
  with no per-request CPU, and smaller storage too if only the compressed copy
  goes on the volume. That's a publisher change, and the local tree and the
  volume would then differ in form.
- **Quantised meshopt** (`KHR_mesh_quantization`): the biggest cut, but lossy.
  It needs a measured sign-off, like KTX2.

### Phase 2a: gzip (built 2026-09-29, not published)

Every glb gets `<name>.glb.gz` beside it, a gzip of its exact bytes, and
nginx's `gzip_static` sends that to any client that takes gzip. Nothing per
request is compressed; what the viewer draws is the same bytes, inflated.

Measured over every in-scope glb (this PC, zlib 1.3.2, CPU seconds):

| Tree | glbs | Plain | gzip -1 | gzip -6 | gzip -9 | -9 CPU |
|---|---|---|---|---|---|---|
| `maps` (vanilla) | 24 | 400.4 MB | 42.1% | 40.4% | 160.3 MB, 40.0% | 45.6 s |
| `maps/mods/xpack1` | 30 | 491.9 MB | 42.3% | 40.6% | 197.5 MB, 40.2% | 56.5 s |
| `maps/mods/xpack2` | 33 | 591.5 MB | 42.3% | 40.5% | 237.4 MB, 40.1% | 66.0 s |
| `models` (vanilla) | 912 | 493.4 MB | 20.8% | 19.6% | 95.0 MB, 19.2% | 20.5 s |
| `models/mods/xpack1` | 306 | 73.4 MB | 33.2% | 31.6% | 22.9 MB, 31.2% | 4.2 s |
| `models/mods/xpack2` | 405 | 97.7 MB | 33.9% | 32.3% | 31.1 MB, 31.9% | 5.6 s |
| Total | 1,710 | 2,148 MB | 787 MB | 752 MB | 744 MB, 34.6% | 198 s |

Inflating all of it takes 8 s. `-9` is used: 8 MB smaller than `-6` over the
lot, for three times the CPU, which is about 2 s a level once per bake and is
saved on every transfer. A level load moves 9.2 MB instead of 21.3 MB (Bocage),
a Sherman 0.14 MB instead of 0.32 MB.

Brotli does much better on a level, because its window spans the whole buffer
where gzip's is 32 KB:

| | gzip -9 | brotli q5 | brotli q9 | brotli q11 | zstd -19 |
|---|---|---|---|---|---|
| Bocage (21.3 MB) | 42.4%, 1.8 s | 24.8%, 0.3 s | 24.3%, 2.5 s | 21.2%, 32 s | 22.5%, 2.6 s |
| Telemark (25.1 MB) | 42.7% | 25.7% | 25.2% | 22.0%, 37 s | 23.5% |
| Sherman (0.32 MB) | 45.1% | 42.7% | 42.2% | 38.5% | 41.2% |

The official nginx image has no brotli module, and Cloudflare asks the origin
for `br, gzip` on every plan, so a `.br` beside the `.gz` (with `ngx_brotli`
built into the mesh image) would take a level from 9.2 MB to about 5.3 MB. That
is the obvious phase 2b; zopfli (not installed here) would only shave gzip by a
few percent.

#### The design, and why

- **Plain and `.gz` side by side, on the volume and locally**, not the `.gz`
  alone. It costs 744 MB more on the volume (the glbs are 2.1 GB), and buys:
  the local tree and the volume keep one form, so `python3 -m http.server`
  (which cannot send Content-Encoding) and the owner's :5273 carry on unchanged;
  the API route, the hard-link mirrors and every script that reads a glb keep
  reading a glb; a client without gzip gets a file, not `gunzip` on the node;
  and rolling back is turning `gzip_static` off. The cost of two files is that
  they can disagree, which is what the checks below are for.
- **Written by `optimise_mesh.py`** (`bf42/glbgz.py`), which every extractor
  already runs at the end over exactly what it wrote, and which a bake's
  promotion step runs after moving a level into place. It writes the `.gz` from
  the bytes it has just written, as the last step, and only when the existing
  one does not match. Deterministic: no name and mtime 0 in the header, so an
  unchanged glb keeps a byte-identical `.gz` and the publisher sends nothing.
  The two git-tracked first-person fixtures get a `.gz` too (git ignores it).
- **Staleness is checked by the gzip trailer**: its last 8 bytes are the CRC-32
  and length of what it inflates to. The optimiser rewrites a `.gz` whose
  trailer does not match its glb. The publisher (`scripts/publish-mesh-delta.py`)
  sends a glb's `.gz` whenever it sends the glb, in the same unit, and refuses
  the whole tree if any glb or `.gz` about to go has a `.gz` that does not match
  (a CRC over the glb, a few seconds for the whole tree) or has none.
  `--allow-plain` lets a glb go without one, served plain, but never while the
  volume holds a `.gz` for it, which nginx would go on sending.
- **nginx**: `gzip_static on` in `/models/` and `/maps/`. `gzip_vary` adds
  `Vary: Accept-Encoding` to both forms; Cache-Control is unchanged. JSON keeps
  the on-the-fly gzip it had.
- **`X-File-Size`** (`mesh/file-size.js`, njs, which the official image ships):
  with Content-Encoding the Content-Length is the gzip's, but the browser counts
  inflated bytes, so three's FileLoader would show the level's download done at
  40%. It reads `X-File-Size` first, for exactly this case; the filter sets it to
  the plain file's size (one stat). Memory at 4 workers: +0.2 MiB.
- **The API route** (`/stats/assets/mesh/*`, the main site's armoury and service
  record) serves the `.gz` the same way, with the same `Vary` and `X-File-Size`,
  and no range processing on the encoded form. It cannot be sure a pair was
  published together (the mirrors, a hand upload), so it checks, per request
  and cheaply, that the trailer's length is the glb's and the `.gz` is no older
  than the glb; the optimiser touches a matching `.gz` older than its glb so
  this holds. Any miss serves the plain file.
- **Cloudflare** asks the origin for `br, gzip` on every plan, so the edge
  holds the gzip form; its docs say it inflates that for a client that does not
  take gzip (not tested here).

What it does not guard: a glb uploaded by hand (FileBrowser) over one that has a
`.gz` leaves the old `.gz` on the volume, and mesh.bfstats.io sends it. Upload the
pair, or delete the `.gz` with it. The old tar scripts (`upload-mesh-assets.sh`
and friends) send whole trees, so they send the pair as it is locally.

#### Verified locally

The mesh image built from this branch, with a small copy of the trees
(`~/.cache/gz-agent/mesh`: Bocage, Anzio, the shared dirs, the vanilla and
XPack1 models) mounted as the deployment mounts them:

- `Accept-Encoding: gzip` on `maps/bocage/scene.glb`: `Content-Encoding: gzip`,
  `Content-Length: 9151173` (the `.gz` byte for byte, which inflates to the glb),
  `X-File-Size: 21295028`, `Vary: Accept-Encoding`, the usual Cache-Control,
  `Content-Type: application/octet-stream` as before. No `Accept-Encoding`, or
  `br` only: the plain glb, byte for byte, with `Vary`. A texture and
  `maps.json` are served as before.
- Headless Chromium on Vulkan: `map.html?map=Bocage`, `map.html?map=Anzio&mod=xpack1`
  and `index.html#Sherman` load, every glb arrives gzipped (9.3 MB on the wire
  for 22.1 MB of glb on Bocage), and FileLoader's progress ends at exactly the
  file size, never above it. The only failed requests are the same with the
  current config: the loading music aborted when the level starts, and
  `maps/mods/xpack1/_shared/load/mp_briefing.png`, which the XPack1 tree lacks.

#### Rolling it out

1. Write the `.gz` files into the local trees (no glb changes, the textures are
   already out; about a minute at `-j 6`):

        python3 tools/bf1942-models/optimise_mesh.py tools/bf1942-models/viewer/maps --skip-mods -j 6
        python3 tools/bf1942-models/optimise_mesh.py tools/bf1942-models/viewer/maps/mods/xpack1 tools/bf1942-models/viewer/maps/mods/xpack2 -j 6
        python3 tools/bf1942-models/optimise_mesh.py tools/bf1942-models/viewer/models --skip-mods -j 6
        python3 tools/bf1942-models/optimise_mesh.py tools/bf1942-models/viewer/models/mods/xpack1 tools/bf1942-models/viewer/models/mods/xpack2 -j 6

2. Publish them: `scripts/publish-mesh-delta.py models maps --dry-run` should
   list about 1,710 `.glb.gz` files (744 MB) and no glb; then the same without
   `--dry-run` (about 2.5 min at 5 MB/s). The live nginx ignores them until
   step 3, so this can go any time. Out-of-scope mod glbs that differ from the
   volume now stop the publish for want of a `.gz`: optimise them or pass
   `--allow-plain`.
3. Merge: Jenkins builds the mesh image (config, njs) and the API, and the
   mesh deploy purges the mesh and play hosts' edge caches.
   `deploy/app/mesh-deployment.yaml` needs no change: same mounts, and the
   memory limit is untouched by njs.
4. Check live, never probing an uncached URL without `?cb=` (it caches at the
   edge for a day):
   `curl -sI -H 'Accept-Encoding: gzip' 'https://mesh.bfstats.io/maps/bocage/scene.glb?cb=1'`
   shows `content-encoding: gzip` and `x-file-size`.

Rolling back is the image alone: without `gzip_static` the `.gz` files are never read.

### Phase 3: the JSON chunk

840 MB of JSON across the maps. Find what dominates (per-node extras on placed
statics is the suspect) before choosing a fix; anything that changes the node
graph touches viewer code that finds nodes by name.

### Phase 4: GPU texture formats (KTX2)

Not lossless: a KTX2/Basis texture is a re-encode. It saves video memory as
well as bytes, but it's only worth doing with a pixel-diff sign-off per texture
class (terrain tiles, statics, vehicles, sprites).

## Deploying phase 1

1. Viewer code needs no change: three r169's `GLTFLoader` already reads
   `EXT_texture_webp` and resolves image URIs relative to the glb.
2. `deploy/app/mesh-deployment.yaml` mounts `assets/mesh/textures` at
   `/usr/share/nginx/html/textures`; `mesh/nginx.conf` serves it immutable.
3. `scripts/publish-mesh-delta.py textures` goes first, then the rewritten glbs.
   A glb that lands before its textures draws untextured.
4. The hard-link mirrors of `viewer/models` (the local API asset roots) need
   `textures/` next to `models/`.
