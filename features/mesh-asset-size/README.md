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
