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

### Phase 2: geometry and JSON (measured; settled by 2a + 2b below)

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

**Meshopt verdict (2026-10-19, measured on FHSW Tobruk, 70.0 MB): recommended
against, in either form.** What matters is not meshopt against raw but meshopt
against what the wire already does, which after 2b is brotli:

| Tobruk, whole file (70.0 MB) | Bytes | % of plain |
|---|---|---|
| plain `scene.glb` + brotli q11 (phase 2b, shipped) | 13.6 MB | 19.3% |
| gltfpack `-cc -noq` (meshopt, reordered) | 36.2 MB | 51.7% |
| ... + gzip -9 | 20.9 MB | 29.9% |
| ... + brotli q11 | 17.9 MB | 25.6% |

| Tobruk, binary chunk alone (60.0 MB) | gzip -9 | brotli q11 |
|---|---|---|
| raw streams | 49.3% | 22.0% |
| strictly lossless meshopt first | 66.1% raw; then 46.4% | 32.3% |

(The strictly lossless rows are `encodeVertexBuffer` unfiltered per
bufferView at its stride plus `encodeIndexSequence`, no reordering -- the
only form whose decoded streams are bit-identical, phase 2's gate; the
round trip was verified bit-identical. It beats gzip by 3 points and loses
to brotli-of-raw by 10: the codec's delta coding obscures the cross-static
redundancy brotli's window dedupes.)

Even gltfpack's best case -- with the vertex-cache reordering that makes the
decoded attribute streams NOT bit-identical, plus a wasm decoder wired into
`viewer/glb-loader.js`, plus a full re-bake of every tree -- transfers a
THIRD MORE than brotli over the files as they are. The strictly lossless
form (bit-identical streams, the only kind phase 2's gate allows) is further
behind still. The reason is structural: a scene's redundancy is whole placed
statics repeated across the buffer, which brotli's 16 MB window dedupes and
meshopt's per-view, per-vertex delta coding cannot see. Quantisation could
reopen the question, but that is lossy and belongs with KTX2's kind of
sign-off, not here.

### Phase 2a: gzip (live 2026-09-29)

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
built into the mesh image) would take a level from 9.2 MB to about 5.3 MB.
That is phase 2b, below; zopfli (not installed here) would only shave gzip by
a few percent.

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

### Phase 2b: brotli (built 2026-10-19, awaiting merge + the full-tree run)

Lossless like 2a, and the same shape: a pre-compressed `<name>.glb.br` beside
the glb, served by `brotli_static`, and the biggest lever left on the level
scenes short of redesigning the bake (every `scene.glb` carries its own copy
of each placed static; sharing them across levels changes the bake and the
loader, out of scope here). Brotli's window spans the whole buffer where
gzip's is 32 KB, which is exactly the shape of a scene's redundancy.

**Measured on FHSW** (this PC, brotli 1.2.0, `--lgwin=24`; percentages of the
plain glb):

| FHSW level | Plain | gzip -9 (live) | brotli q11 | q11 time | q11 peak RSS |
|---|---|---|---|---|---|
| battle_of_edson_s_ridge | 11.4 MB | 38.0% | 18.0% | 21 s | 147 MiB |
| tobruk | 70.0 MB | 42.0% | 19.3% | 141 s | ~200 MiB |
| desert_hill (largest) | 310.9 MB | 46.4% | 18.5% | 626 s | 240 MiB |

Quality ladder on tobruk: q5 23.6% (1.6 s), q9 22.6% (25 s), q10 20.1%
(103 s), q11 19.3% (141 s). q11 is used: the CPU is paid once per changed glb
(the optimiser's `-j` parallelises it; ~200 MiB a worker) and saved on every
transfer. Loading Tobruk moves 13.6 MB instead of the 29.4 MB the `.gz` moves
today.

**Models and rigs measured, and mostly not worth it**: Sherman (0.32 MB) gz
45.5% -> br 38.3%, a rig (1.89 MB) gz 12.6% -> br 7.7% -- tens of KB per
file, against ~24,000 more files on the volume and in every publish. But the
big FHSW/FHSWEurope models are scenes in miniature: M24LT (10.3 MB) gz 47.2%
-> br 23.1%. So the rule is a **size threshold, not a tree**: a glb of 4 MB
or more gets a `.br` (`bf42/glbbr.py` `MIN_BYTES`). That is every level scene
and the ~310 largest models, and nothing else:

| In scope (>= 4 MB) | Their glbs | Their .gz (sent today) | .br (q11, projected) |
|---|---|---|---|
| maps: vanilla + 8 mod trees | 618 files, 26.6 GB | 10.9 GB | ~5.1 GB |
| models: fhsw + fhsweurope | 310 files, 2.0 GB | 0.9 GB | ~0.45 GB |
| Total | 928 files, 28.6 GB | 11.8 GB | ~5.5 GB storage added |

Transfers that hit these files roughly halve against the `.gz`. (FHSW alone:
10.1 GB of scenes, 4.3 GB of `.gz`, ~1.9 GB of `.br`. dc_final is counted but
unpublished, so ~0.2 GB of the total stays home.)

#### The integrity design: a metadata meta-block, brotli's gzip trailer

The 2a invariants need an equivalent here, and brotli records nothing about
its content -- no CRC, no length, no trailer. Rather than a sidecar file (a
third sibling to pair, publish and hand-upload correctly), the record goes
**inside the stream where every decoder ignores it**: RFC 7932's metadata
meta-block, emitted by the reference encoder itself
(`BROTLI_OPERATION_EMIT_METADATA`, `libbrotlienc` via ctypes) as the stream's
FIRST block, before any data. Its 16 skipped bytes are `GBR1`, the glb's
CRC-32, and its length as a u64 -- the gzip trailer's fields, at the front,
inside the first 19 bytes whatever window the encoder picked. So:

- `bf42/glbbr.py` `is_fresh` reads 19 bytes and compares CRC and length with
  the glb, exactly as `glbgz.is_fresh` reads the trailer. Same trust model
  too: the record is written from the same bytes that were compressed, in the
  same call. Belt and braces, every `compress()` decodes its own output back
  and compares before anything is written.
- A `.br` made by a plain `brotli scene.glb` has no record and reads as
  stale: nothing hand-made ever passes for fresh.
- The publisher (`br_fresh`) makes the same check as `gz_fresh`, sharing one
  CRC pass over the glb for both copies.
- The API route (`AssetServingService.MatchingBrotli`) checks recorded length
  plus mtime per request -- the same two checks, the same cost, as its gzip
  path (`BrotliRecordedLength` is the C# copy of the 19-byte parse).
- Decoders skip it by spec. Proven against node's `brotliDecompressSync` (the
  reference C decoder browsers ship) in `tests/test_glbbr.py`, and end to end
  in headless Chromium below. (A first attempt spliced the block in by
  bit-shifting the encoder's stream; that corrupts the byte-aligned literals
  of uncompressed meta-blocks, which incompressible spans produce. The
  encoder API emits the block natively; nothing is spliced.)

#### What was built

- **`bf42/glbbr.py`**: `ensure(glb, data, create=True)` with `glbgz.ensure`'s
  exact contract -- deterministic for an encoder version, freshness
  content-based (an encoder upgrade rewrites nothing that still matches),
  rewritten through its own inode for the hard-link mirrors, a fresh copy
  older than its glb touched for the API's mtime check. The threshold guards
  CREATION only: a stale `.br` beside a small or changed glb is always
  rewritten, and `create=False` (optimise_mesh `--no-brotli`, for a cheap
  pass) still rewrites stale ones. Needs `libbrotlienc`/`libbrotlidec` (the
  brotli package); raises `BrotliUnavailable` with instructions otherwise.
- **`optimise_mesh.py`** runs it after the `.gz`, from the same final bytes,
  so every extractor and bake keeps `.br` files fresh exactly as they keep
  `.gz` files fresh. `--no-brotli` skips new ones.
- **`bf42/glbstore.py`** (phase 5) carries a fresh sidecar `.br` into
  `glbs/` beside the blob's `.gz`; it never compresses one itself (that
  would turn a seconds-per-tree sweep into minutes per big glb).
- **`scripts/publish-mesh-delta.py`**: the `.br` rides in its glb's unit,
  right after the `.gz` (`rank`, `pack_units`). It is OPTIONAL -- a glb
  without one is served gzip as before, so untreated trees publish unchanged
  -- but one that exists must be fresh (`br_fresh`), a changed glb whose
  volume copy has a `.br` must bring a new one (brotli_static would go on
  serving the old bytes), and an orphan `.br` stops the publish. The
  unpublished-mod blob holds cover `.br` files too.
- **`mesh/Dockerfile`**: a build stage compiles `ngx_brotli`'s STATIC module
  (pinned commit a71f9312) against the image's own nginx version from
  nginx.org source, `--with-compat` -- the official binary is built with it,
  which is what makes the module loadable. brotli_static serves files and
  links nothing (the brotli library is only needed by the filter module,
  which is deliberately not built): +71 KB image, no runtime memory, the
  64 MiB limit in `deploy/app/mesh-deployment.yaml` stands. Verified by
  building the image and probing it (below).
- **`mesh/nginx.conf`**: `brotli_static on` beside `gzip_static on` in
  `/models/`, `/maps/` and `/glbs/`. With both on, a client that accepts br
  gets the `.br`; gzip-only clients the `.gz`; everything else the plain glb.
- **`mesh/file-size.js`**: X-File-Size now covers `Content-Encoding: br`
  (same single stat), so FileLoader's progress stays right at 5x compression.
- **The API route** prefers a fresh `.br` over the `.gz` when the request's
  Accept-Encoding names `br` (explicitly -- `*` keeps meaning gzip), with
  the same Vary and X-File-Size (`tests/api/ImageStorage/MeshAssetBrotliTests.cs`).
- **The viewer needs no change**: the browser inflates Content-Encoding
  transparently, exactly as with gzip.

#### Verified locally (2026-10-19)

- `tests/test_glbbr.py` (19 tests): determinism, the record, freshness,
  threshold and `create` semantics, inode rewrites, mtime touch, node's
  reference decoder inflating the stream byte-identically, incompressible
  input (uncompressed meta-blocks) round-tripping.
  `tests/test_publish_mesh_gzip.py` grew the `.br` pairing and refusal cases.
- On the real Tobruk: `ensure` wrote 13,551,013 bytes (19.3%) in 166 s
  including the verify decode; the second run wrote nothing in 0.1 s.
- The image built from this branch, with the real trees mounted read-only and
  the scratch Tobruk (glb + .gz + .br) overlaid:
  `Accept-Encoding: gzip, deflate, br, zstd` on `maps/mods/fhsw/tobruk/scene.glb`
  -> `Content-Encoding: br`, `Content-Length: 13551013` (the `.br` byte for
  byte), `X-File-Size: 70040340`, `Vary: Accept-Encoding`, Cache-Control as
  before. `gzip` only -> the `.gz`; no Accept-Encoding -> the plain glb; a
  level with no `.br` (vanilla Bocage) -> the `.gz` as today.
- Headless Chromium (Vulkan) against that container: `map.html?mod=fhsw&map=Tobruk`
  loads to its hooks with `scene.glb` arriving `content-encoding: br`, no
  console errors, and an in-page fetch of the glb SHA-256-matches the local
  file -- the browser's decoder skips the metadata block and hands three.js
  the exact bytes.

#### Rolling it out

1. Merge; Jenkins builds the mesh image (the build stage pulls nginx source
   from nginx.org and ngx_brotli from GitHub once per image build) and the
   API. Until step 3 the new nginx ignores nothing: no `.br` files exist on
   the volume yet.
2. Write the `.br` files locally -- the optimiser's normal form, scenes and
   big models only. One-time cost at q11, `-j 10`: roughly 40 min for FHSW,
   comparable again for FHSWEurope, less for everything else (~2 GiB RSS at
   `-j 10`):

        python3 tools/bf1942-models/optimise_mesh.py tools/bf1942-models/viewer/maps --skip-mods -j 10
        python3 tools/bf1942-models/optimise_mesh.py tools/bf1942-models/viewer/maps/mods/<m> -j 10   # per mod tree
        python3 tools/bf1942-models/optimise_mesh.py tools/bf1942-models/viewer/models/mods/fhsw tools/bf1942-models/viewer/models/mods/fhsweurope -j 10

   The hard-link mirrors of `viewer/models` need the new siblings:
   `cp -al` as for `.gz` (phase 2a).
3. Publish: `scripts/publish-mesh-delta.py maps models --dry-run` should list
   ~930 `.glb.br` (~5.5 GB) and nothing else; then without `--dry-run`
   (~18 min at 5 MB/s). **Mind the volume's headroom: +5.5 GB.**
4. Check live with a `?cb=` probe:
   `curl -sI -H 'Accept-Encoding: br, gzip' 'https://mesh.bfstats.io/maps/mods/fhsw/tobruk/scene.glb?cb=1'`
   shows `content-encoding: br` and `x-file-size`; `cf-cache-status` says
   what the edge kept.

Rolling back is the image alone: without `brotli_static` the `.br` files are
never read, and the API route falls back by deploy of the previous API image.

After this, the remaining steps are lossy and need a measured parity
sign-off: quantised meshopt geometry (phase 2's verdict above rules out the
lossless kind) and KTX2 textures (phase 4).

### Phase 3: the JSON chunk

840 MB of JSON across the maps. Find what dominates (per-node extras on placed
statics is the suspect) before choosing a fix; anything that changes the node
graph touches viewer code that finds nodes by name.

### Phase 4: GPU texture formats (KTX2)

Not lossless: a KTX2/Basis texture is a re-encode. It saves video memory as
well as bytes, but it's only worth doing with a pixel-diff sign-off per texture
class (terrain tiles, statics, vehicles, sprites).

### Phase 5: one glb store (planned 2026-10-14; built 2026-10-19, awaiting the full-tree run)

Phase 1 took the textures out of the glbs and named each by its content, so a
texture shared by five mods is stored once. The glbs themselves are still
written per tree and per name, and most of them are byte-identical copies.

**Measured 2026-10-14** (this PC, the binary chunk of every `*.glb`,
`viewmodels/*.fp.glb` and `poses/**/*.glb` under `viewer/models`, hashed; the
`.glb.gz` beside each is not counted and doubles every figure):

| | Stored | Distinct | Duplicate |
|---|---|---|---|
| All trees | 24.1 GB | 8.7 GB | 15.4 GB (64%) |
| by kind: first-person rigs | | | 7.6 GB |
| by kind: models | | | 6.5 GB |
| by kind: poses | | | 1.3 GB |
| `fhsweurope` | 8.9 GB | | 7.8 GB (88%), almost all copies of `fhsw` |
| `fhsw` | 11.1 GB | | 5.4 GB |
| `eod` | 1.2 GB | | 0.5 GB |
| `fh` | 0.8 GB | | 0.4 GB |

Within FHSW alone: 2,484 rigs hold 600 distinct bodies (4.54 GB stored, 1.19 GB
distinct), and 8,360 model glbs hold 3,592 (4.08 GB, 2.37 GB).

Three sources:

- **Rigs are written per soldier type and weapon pair** (`<Soldier>__<Weapon>.fp.glb`),
  and the body is the same for every soldier type that carries the weapon: the
  nations differ only in texture, which is already in the store. FHSW has 712
  weapons across 22 soldier types; `BritishSoldier__345RCL_HESH` and its German,
  Russian and US twins are the same 3.7 MB, two thirds of it animation.
- **Mod variants differing only in script values** get their own copy of the
  geometry: `M24LT` and `M24LT_APCR` are both 10.2 MB, as are `SturmPanther` and
  `SturmPanther_GT102`.
- **Each mod tree holds its whole chain's library.** FHSWEurope's tree is FHSW's
  re-exported (`features/mesh-mod-assets`: a tree must hold every template its
  levels place), so FHSW's content is stored twice, and FH's three times.

On the live volume (68.4 GB of mesh data on 2026-10-14, FHSW 24.8 GB and
FHSWEurope 16.2 GB of it) about 25 GB is these duplicates and their `.gz`.

**The plan**, the phase 1 pattern applied to glbs:

1. A post-process over a finished tree, as `optimise_mesh.py` is: hash each glb,
   write it once to `viewer/glbs/<sha>.glb` (and its `.glb.gz`), and record
   `name -> sha` in the tree's manifests (`models.json`, the rig index
   `viewmodels/index.json`, the pose index). Idempotent and deterministic, so the
   extractors and the layer model are unchanged.
2. The viewer resolves a model, rig or pose name through the manifest it already
   loads, and fetches the blob. A name with no hash falls back to the old path,
   so an untreated tree still loads.
3. The publisher sends `glbs/` before the manifests (as `textures/` goes first
   today) and each blob once across every tree.
4. Optional later, at the source: export one rig per weapon and let the viewer
   paint the soldier's texture, as it already does for a level's first-person
   paint (`viewmodels/skins.json`). The store makes this unnecessary for size,
   but it would cut export time for FHSW's 2,484 rigs.

Expected: the volume's model trees from about 26 GB to about 9 GB, plus the
same cut in their `.gz` copies, with nothing the viewer draws changing.

**Not in this phase: the level scenes.** Every `scene.glb` bakes its own copy of
each static it places (FHSW: 8.4 GB of scenes for 94 levels, plus 6 GB of `.gz`).
Sharing statics between levels changes the bake and the viewer's level loader,
which find statics by node name; it is a separate, larger piece of work, and
quantised meshopt (phase 2) is the other lever on the same bytes.

Checks to carry over from phase 1: every name resolves to a blob byte-identical
to the glb it replaced; the hard-link mirrors of `viewer/models` (the local API
asset roots) follow the store; the stats site's API routes that serve model
files by path (`features/mesh-mod-assets`) either resolve through the manifest
or keep a path.

#### Built 2026-10-19

- **`tools/bf1942-models/store_glbs.py`** (`bf42/glbstore.py`): hashes every
  glb a tree's manifests name, writes `<mesh root>/glbs/<sha256>.glb` once with
  its deterministic `.glb.gz` beside it (reusing the fresh sidecar `.gz`, which
  is the same bytes), and records the shas back into the manifests:
  `models.json` rows gain `sha` / `cockpitSha` and a `sha` per variant;
  `viewmodels/index.json` becomes `{"format": "bf1942-rig-index/1", "rigs":
  [...], "sha": {"<stem>.fp.glb": ...}}` (readers take both forms:
  `rig_index_stems`, `rigIndexOf`); `poses/index.json` gains a `sha` table
  keyed by the path under `poses/` (pose glbs, `rigs/`, `gaits/`). The blob is
  the **whole file**, byte-identical to the glb it replaces, so the gate is
  byte equality, not re-encoding. What no manifest names (kit glbs,
  `viewmodels/skins/`) is neither stored nor recorded and keeps its path. The
  per-tree glbs are not touched; the extractors are unchanged (a re-export
  drops the stale sha with the row it rewrites, and the next store run records
  the new one — run `store_glbs.py` after a bake as `optimise_mesh.py` runs).
- **The viewer** resolves every glb load through one chokepoint:
  `viewer/glb-loader.js` wraps the vendored `GLTFLoader` (all four pages and
  the four module-level loaders import it), asking `viewer/glb-store.js` per
  URL. The resolver parses the tree out of the URL, lazily fetches that tree's
  sha tables from the three manifests (once per tree per page), and rewrites
  `models/mods/fhsw/Tiger.glb` to `glbs/<sha>.glb` — with the loader's
  resourcePath pinned to the *original* URL's directory, because the blob's
  texture URIs are spelled from there. Exact names only, and any miss (no
  manifest, no sha, a kit glb, a level scene) keeps the old URL, so an
  untreated tree serves exactly as before.
- **`scripts/publish-mesh-delta.py`**: `glbs` is a tree, ordered after
  `textures` and before `models`, so no manifest ever advertises a blob the
  volume lacks; `index.json` joined MANIFESTS (held to the last unit);
  `texture_check` resolves a blob's `../`-spelled URIs against the shared
  store; blobs recorded only by an `UNPUBLISHED_MODS` tree's manifests are held
  back (one recorded by any published tree still goes — same bytes).
- **Serving**: `mesh/nginx.conf` serves `/glbs/` immutable with `gzip_static`
  and `X-File-Size`, `deploy/app/mesh-deployment.yaml` mounts
  `assets/mesh/glbs` (both take effect on the next image deploy).
- **The stats site's mesh route** (`/stats/assets/mesh/*`, the armoury and the
  service record) resolves a per-tree glb path that misses on disk through the
  tree's manifest to `glbs/<sha>.glb`, exactly as the viewer does
  (`api/ImageStorage/MeshGlbStoreResolver.cs`; the shared manifest readers are
  `MeshGlbStore.cs`). Parsed tables are cached against the manifest file's
  mtime and length (a few per published tree, capped at 128), the blob goes out
  with the per-tree path's own headers (`Vary`, the `.gz` pair's trailer and
  age checks, `X-File-Size`), and a direct `glbs/` request is served immutable
  like `textures/`. A name with no sha, or a manifest-less tree, 404s exactly
  as today. `MeshArmouryIndex` also merges every manifest-hashed name into its
  listings — a GC'd vehicle glb or pose stays discoverable, versioned by the
  blob hash's first twelve characters in place of a file mtime (`?v=`), which
  changes exactly when the bytes do. Tests:
  `tests/api/ImageStorage/MeshGlbStoreFallbackTests.cs` and the superseded-name
  cases in `tests/api/Armoury/MeshArmouryIndexTests.cs`.

Verified (tests: `tests/test_glb_store.py`, `tests/test_glb_store_resolve.py`
+ `glb_store_harness.mjs`, and the stored-index case in `test_pose_bases.py`):

- **Byte identity**: scratch runs over copies of gcmod + bf1918 and of
  xpack1 + xpack2; every recorded name's blob compared equal to the per-tree
  glb and its `.gz` inflated to it — 188 + 3,051 names, 0 mismatches — and the
  same again through the viewer's own resolver in node (3,239 URLs resolved,
  blob bytes equal, resourcePath correct).
- **Idempotence**: the second run over xpack1+xpack2 wrote 0 blobs, 0 `.gz`,
  0 manifests; a sha256 snapshot of all 14,872 files was identical.
- **The viewer loads a treated tree**: headless Chromium against a serve root
  with the treated gcmod — `poses.html?mod=gcmod` fetched every pose glb from
  `/glbs/<sha>.glb` (3 of 3, HTTP 200), `index.html` on the untreated vanilla
  tree loaded exactly as before; no console errors either way.
- **Publish ordering**: `publish-mesh-delta.py glbs models --root <scratch>
  --remote-manifest <empty> --dry-run --list` sends the whole `glbs` tree
  (2,830 files) before `models`, each blob's `.gz` directly after it, and
  marks all four sha-carrying manifests per tree "(manifest, lands last)".

**Measured 2026-10-19** (this PC; every `*.glb` under `viewer/models`, whole
files — what a whole-file store deduplicates — beside the binary-chunk method
of 2026-10-14):

| | Stored | Distinct whole-file | Distinct binary chunk |
|---|---|---|---|
| All trees (glbs) | 33.18 GB | 25.34 GB | 7.54 GB |
| + their `.glb.gz` | 8.33 GB | 6.36 GB | |

Whole-file duplicates are 7.84 GB of glb + 1.97 GB of `.gz` = **9.81 GB
(24%)**, and they are concentrated: fhsweurope holds 6.76 GB of byte-copies
of fhsw, xpack2 431 MB of xpack1, fh 237 MB of itself (its own re-exports),
xpack1 60 MB of itself (level variants: one `PrinceOW` is 11 identical
files). The scratch xpack1+xpack2 run bears it out end to end: 2,676 named
glbs, 1,380.6 MB per tree, became 1,415 blobs, 813.2 MB (-41%), in 2.1 s.
gcmod and bf1918 carry no whole-file duplicates at all (57 and 131 names,
unique content) — the small-mod run proves the mechanics, not the saving.

The gap between 25.34 GB of distinct whole files and 7.54 GB of distinct
binary chunks is the 2026-10-14 table's headroom that a whole-file store
cannot reach: nation-twin rigs share their binary chunk but differ in the
JSON (each nation's texture refs), as do same-geometry files whose URIs are
spelled from different tree depths. That remaining ~17.8 GB belongs to the
plan's step 4 (one rig per weapon at the source, the viewer painting the
soldier's texture — built below, 2026-10-19) or to a later chunk-level store,
not to this phase.

#### Step 4: one rig per weapon, the soldier painted at load (built 2026-10-19)

Nation twins were the rigs' whole duplication: `BritishSoldier__345RCL_HESH`
and its German, US, Russian and desert twins are byte-identical BIN chunks
whose JSON differs only in part spellings and in which sleeve/hand textures
the materials hold (diffed directly: 19 leaf diffs, all names plus one
image). So `extract_viewmodel.py` now exports one rig per **(weapon,
first-person body)** and the rest of the pairs become painted index rows.

- **Twinship is proven per soldier, never assumed.** `soldier_fp_profile`
  builds each soldier's first-person parts through the same `Assembler` and
  `build_skinned_part` the export uses and hashes everything except names and
  texture contents (`_fp_body_identity`: non-image bufferView bytes, the
  parsed skeleton, and the JSON with `name`/`extras`/images stripped — so
  material flags, including the alpha cutoff a soldier's own texture pixels
  produce, stay in the key). Equal keys group; anything else — a profile that
  fails, an ambiguous image mapping, a mapped image the canonical rig also
  paints a weapon with (`finalise_pair_rows`) — falls back to the per-pair
  export, which is always right. The grouping is real: FHSW's 755 weapons
  hold 1,453 (weapon, body) classes, not 755 — 497 weapons pair soldiers
  with genuinely different bodies, and each class keeps its own rig.
- **The index carries the rows** (`bf1942-rig-index/2`): `rigs` are the
  files on disk, `pairs` maps `<Soldier>__<Weapon>` to the canonical rig
  stem, the soldier's texture per canonical image, the skin glb that holds
  those textures (`viewmodels/soldiers/<Soldier>.skin.glb`, built like a
  level skin: one material a texture, resolved by the name the shader asked
  for), and his `view` constants where they differ. With no rows the index
  stays the bare array, byte for byte — which is how every reader tells the
  worlds apart. Rows merge across runs like `absent.json`; `store_glbs.py`
  preserves `format` and `pairs` and hashes the files alone.
- **The viewer paints at load**: `viewer/soldier-skin.js`, applied by
  `arms-rig.js` `fetchRig` on the canonical file before the level's own
  paint. The swapped texture keeps its own name, so the level repaint that
  follows keys off the *soldier's* image — `rig_images` now reads the
  soldier skins too, and skins.json rows cover the painted nations exactly
  as they covered the per-pair rigs. `viewmodelRigFor`/`rigFile` answer the
  pair's own identity (`entry.pair`), so replay caches and respawn checks
  never confuse two paints of one file. A per-pair tree (array index) loads
  unchanged, and an old page on a new tree still draws arms: the canonical
  stem is in `rigs`, and the weapon-borrow fallback already tolerated the
  wrong nation's sleeves.
- **Audits and readers** take both worlds through `bf42/glbstore.py`
  helpers: `rig_index_stems` (files), `rig_index_pairs`, `rig_pair_stems`
  (coverage — `audit_play`, `audit_mod`, `test_viewmodel_rigs_on_disk`) and
  `rig_pair_files` (pair → the file that serves it, `conformance_weapons`).
- **`--delta` reuse is now weapon-level**: a new pair whose weapon already
  has a body-twin rig on disk becomes a row and builds nothing (bf1918:
  adding `KanSoldier Binoculars` to a finished tree exported 0 rigs). A full
  run converts a per-pair tree in place and removes the superseded per-pair
  files (the bf1918 conversion produced a tree byte-identical in size to the
  from-scratch export); delta never deletes.
- **The level-skin decision pass is fingerprinted** (the same file's old
  time sink: ~40 min on FHSWEurope with nothing changed). With `--delta`,
  `write_level_skins` re-derives a level's expected paint only when its
  inputs moved (`skins_pass_fingerprints`, state in `skins.state.json`,
  which the publisher skips — machine-local mtimes). Soundness: the shared
  fingerprint covers the chain's archives (every level archive too — one
  level's alternativePath can read inside another's folder, FHSW's
  `_TEXTURE_SPECIAL`), the model trees' glbs and manifests, the rigs and the
  soldier skins — so a NEW rig image an old level repaints re-decides every
  level — and the per-level hash covers the maps.json row and the files it
  names, so an added or re-baked level decides only itself. Measured on
  FHSWEurope (86 exported levels): the fingerprint sweep is 0.7 s against
  214-348 s for the full decision pass (warm cache, depending on load;
  ~40 min observed cold), so an unchanged `--delta` re-run skips all 86.
  Tests: `test_delta_extract.SkinsDecisionDelta` covers the skip, the
  per-level re-decide (a new or changed row, a missing skin glb) and the
  whole-tree re-decide (a new rig image, a touched archive, no state file).

**Equivalence gate.** The claim to prove: a painted single rig resolves the
same texture, material by material, as the per-pair rig it replaces. Two
checks, both against the old per-pair export of the same pairs:

- *Data level* (each pair's materials in order: the image name and the
  content-addressed `viewer/textures/` file it resolves to, the row's mapping
  applied through the soldier skin glb): bf1918, 16 pairs (7 painted over
  another soldier's rig, 9 own files) — 0 failures; FHSW 345RCL and
  345RCL_HESH across 8 nations against the live per-pair tree, 11 pairs (7
  painted: British, Canadian, German, US over the Australian rig; German
  desert, German, Russian, US over the British HESH rig) — 0 failures.
  Same store file means the same pixels.
- *Through the viewer* (headless Chromium loading each pair the way
  `arms-rig.js` does — `rigIndexOf`/`rigEntryIn` on the index,
  `glb-loader`, `paintSoldierRig` — and reading every mounted material's
  `map.name`, then joining names to store files): bf1918 16/16 and FHSW
  11/11 pairs identical in material count, image per material and store
  file per material, with equal `view` constants and no page errors. The
  painted pairs swapped 0-2 maps each. 0 is a nation whose first-person
  images all match the canonical soldier's. Harness: a scratch
  `soldier-gate.html` + playwright driver, run under
  `flock /tmp/claude-1000/chromium.lock` on port 5353.

**Measured on bf1918** (16 kit pairs across 10 soldier types, scratch mesh
roots, warm cache): the per-pair tree is 16 rigs, 25.7 MB of glb + 3.2 MB of
`.gz`; the single-rig tree is 9 rigs + 2 soldier skins, 14.7 MB + 1.8 MB
(−43%), with 7 pairs as rows (several with 0 swapped textures: nations that
share every FP image and differ only in spellings). The canonical rig files
are byte-identical between the two worlds. Export wall time on this micro
set: 10.3 s per-pair vs 17.5 s single-rig — the profiles cost ~0.7 s per
soldier type once per run, which a 16-pair run cannot amortise and a
full-tree run buries (FHSW: 22-odd soldier types against ~3,000 fewer rig
exports).

**Projected over the existing trees** (grouping every tree's rigs by
(weapon, BIN chunk) — exactly the classes the exporter now keeps one file
for):

| Tree | Rigs | Classes | glb now | glb after | Saved (glb + .gz) |
|---|---|---|---|---|---|
| fhsw | 4,518 | 1,453 | 8,265.6 MB | 2,654.1 MB | 5,611.5 + 711.6 MB |
| fhsweurope | 3,619 | 1,093 | 6,591.1 MB | 1,996.4 MB | 4,594.7 + 578.2 MB |
| fh | 332 | 142 | 571.0 MB | 245.4 MB | 325.6 + 39.5 MB |
| eod | 295 | 144 | 464.0 MB | 237.5 MB | 226.5 + 27.1 MB |
| xpack1 | 242 | 80 | 414.0 MB | 137.7 MB | 276.3 + 33.3 MB |
| xpack2 | 244 | 88 | 419.3 MB | 154.1 MB | 265.2 + 32.2 MB |
| vanilla | 228 | 58 | 395.5 MB | 102.6 MB | 292.9 + 35.7 MB |
| total | 9,478 | 3,058 | | | **11.3 GB + 1.4 GB** |

(per soldier skin glbs add a few hundred KB a tree). The full-tree
re-extraction that realises this is the owner's run, per mod, as every
exporter change is; until a tree re-runs, its per-pair rigs and bare-array
index keep working as they are.

#### Rolling phase 5 out (the owner's run)

1. Merge first: the viewer must resolve through the manifests before any
   manifest carrying shas is published (the image deploys itself from main),
   exactly as re-extracted levels wait for their viewer code.
2. Full-tree post-process, locally:
   `python3 tools/bf1942-models/store_glbs.py tools/bf1942-models/viewer/models --mods`
   (skip nothing; dc_final's blobs stay home via the publisher). Seconds per
   tree plus one read of every glb.
3. The hard-link mirrors of `viewer/models` need the store beside them, as
   they needed `textures/`: `cp -al tools/bf1942-models/viewer/glbs <mirror>/glbs`
   (tournament-images/mesh, bfstats-service-record/.e2e/assets-dev/mesh),
   again after later runs.
4. Publish: `scripts/publish-mesh-delta.py glbs models` — blobs land before
   the manifests that advertise them. **Mind the volume's headroom**: the full
   store is ~25.3 GB of blobs + ~6.4 GB of `.gz` *added before GC removes
   anything*. If that is too much at once, go tree by tree where the win is
   (fhsweurope first: its store delta is mostly blobs fhsw already supplies),
   or GC between trees.
5. Later, separately: GC the superseded per-tree glbs (and their `.gz`) from
   the volume — the net saving is the 9.81 GB above, growing with every tree
   that re-exports its chain. **Not before** the stats site's armoury routes
   (`features/mesh-mod-assets`, `api/Armoury/MeshArmouryIndex.cs`) resolve
   through the manifests or keep the files they serve by path. Done
   2026-10-19 (see "The stats site's mesh route" above): the mesh route falls
   back to the blob on a path miss, and the armoury index lists every
   manifest-hashed name. The gate is met once that API build is **deployed**
   — an older API against a GC'd volume still breaks the service record's 3D
   viewer. What the API never covered stays out of GC's reach anyway: only
   blobs the manifests record are superseded, and kit glbs,
   `viewmodels/skins/` and the level scenes are not. A hand-shared per-tree
   URL keeps working too (same fallback); the edge caches a miss for no
   longer than its usual day.

   **GC run 2026-10-20.** The 2026-10-19 list (48,310 names) was re-checked
   against the live manifests and the volume's `glbs/` listing just before:
   a name stayed only if its tree's manifest gives it a sha, `glbs/<sha>.glb`
   is on the volume and the local file hashes to that sha. 47,605 stayed (705
   had changed since and keep their files). A canary per manifest kind (a
   model cockpit, a first-person rig, a pose) was moved aside and fetched
   through `/stats/assets/mesh/` first: 200, byte-identical. Then 94,590
   files (the glbs and their `.gz`) were removed; the volume went 147.1 GB ->
   109.3 GB. A 30-name random sample through the API route: 28 identical, 1
   `dc_final` 404 (the tree is off the volume, as intended) and 1 `400` on a
   name with parentheses, which the route rejects for every file, deleted or
   not (`AssetServingService.ValidatePath` allows letters, digits, `.-_/`
   only; the viewer's store path serves it).

## Local eviction (built 2026-10-20)

The volume (200 GB) can hold more than this PC. On 2026-10-20 the local
viewer trees were 123 GB: `glbs/` 30 GB, the level scenes 37.5 GB
(`scene.glb` 26.6 + `.gz` 10.9, plus the small `.br`), `models/` 42 GB,
`textures/` 8.7 GB. Two things that are already on the volume can now leave
this PC and still resolve.

### Store blobs (`evict_glbs.py`)

A store blob is named by its sha256, so once the volume holds
`glbs/<sha>.glb` at the local size the local copy is a cache.

- **The record**: `viewer/glbs/.on-volume.json` (`bf42/onvolume.py`), `name
  -> size` of every file in the volume's `glbs/`. `publish-mesh-delta.py`
  rewrites it from the count-checked listing it takes of the `glbs` tree
  (a dry run too: it is a local note, not a send) and merges every unit it
  lands. `evict_glbs.py --refresh` takes the same listing without publishing
  (read-only kubectl). The publisher never sends it. A missing or unreadable
  record holds nothing, which keeps every blob.
- **Write-once respects it**: `glbstore.BlobStore.put` leaves a blob absent
  when it is absent and the record holds it at the size of the bytes in hand
  (`Result.remote`, printed by `store_glbs.py` as "evicted"). Its copies are
  not written either, so the store never holds an orphan `.gz`. The sha is
  still recorded in the manifest.
- **The publisher's `store_check`** reads such a blob as present, at the
  record's size, and still refuses a per-tree glb whose size no longer
  matches it (rewritten since `store_glbs.py` ran).
- **`evict_glbs.py`** (dry run by default; `--apply` removes): a blob goes
  with its `.gz` and `.br` only when the record holds every local copy at
  the local size. It counts the bytes that free nothing because another hard
  link holds them (a `cp -al` mirror of `glbs/`).
- **Reading an evicted blob locally**: `serve_viewer.py` fetches a missing
  `glbs/` file from mesh.bfstats.io when a page asks for it (next section).
  The local API's hard-link mirrors serve per-tree paths first, so evicting
  blobs does not affect them.

Not touched, on purpose: the per-tree glbs under `models/`. Every extractor
rewrites them in place through their inode, and the hard-link mirrors depend
on that; hard-linking them to the store would let a re-export rewrite a
content-addressed blob. They stay as they are.

Dry run against the real store, 2026-10-20 (the volume's `glbs/` listed
read-only: 66,196 files, 30.86 GB): the local store is 67,753 files,
31.44 GB, and **65,874 files (32,937 blobs with their copies), 29.32 GB,
are evictable**. 161 blobs stay because a copy is not on the volume at the
local size. No store file has a second hard link today.

### Remote-only levels (`evict_levels.py`)

A published level may lose its `scene.glb`, `scene.glb.gz` and `scene.glb.br`
locally. Everything else in the level directory stays (`scene.json`, terrain,
sky, sounds, loading art, `maps.json` row), plus `scene.remote.json`
(`bf42/remote_scene.py`), which records each evicted file's size and the
glb's sha256. The marker counts only while `scene.glb` is absent. A re-bake
writes a new `scene.glb` and the level is local again.

- **Which levels stay**: `tools/bf1942-models/local_levels.json`, the
  keep-list. The defaults are every level the tests, lab scenarios, perf
  benches and memory-recorded fixtures load from the real trees, plus three
  per tree for play. The repo records popularity only for FHSWEurope
  (`features/fhsweurope-extraction`, 2026-10-19: sector115-1946 and
  invasion_of_usa-1948), so every other tree takes the first three rows of
  its `maps.json`. Each entry says why it is there. Add a level before a test
  starts depending on it; `test_remote_levels` checks that every entry is a
  row of its tree.
- **When a level goes** (`evict_levels.py`, a dry run unless `--apply`):
  - its tree is published (never `UNPUBLISHED_MODS`) and the level is not on
    the keep-list;
  - every scene file it has locally is on the volume at the local size, by
    the publisher's own count-checked listing of `maps/` (read-only kubectl);
  - with `--apply`, where the publisher's hash record knows the file, the
    local content is the content it landed, so a same-size patch not yet
    published stays.

  A local `.br` the volume lacks keeps the level. `--apply` refuses while an
  extractor, the optimiser or the publisher runs. The marker is written
  before anything is removed.
- **Opening one locally**: `serve_viewer.py` fetches a missing file under
  `maps/`, `models/`, `glbs/` or `textures/` from mesh.bfstats.io into
  `~/.cache/bfstats-mesh-remote/` and serves it. The tree itself is never
  written. A cached scene is checked against the marker's size.
  `--no-remote` or `BF_VIEWER_REMOTE=off` turns this off, and the pipeline's
  and the audits' own servers run that way. `evict_levels.py restore --mod
  <id> <level>...` puts the files back in the tree, verified against the
  marker, before a patch or an audit that needs the bytes.

**What treats a remote-only level as present.**

| Consumer | What it does with a remote-only level |
|---|---|
| `extract_maps_all.py --skip-existing` | Counts it as extracted. Without this, every full-tree pipeline run re-baked the evicted levels. |
| `mod_pipeline.py`: `levels` and `optimise` outputs, `v_outputs` (`glob_outputs`) | Counts its scene files. |
| `mod_pipeline.py`: `v_levels` (`check_level_coverage`) | Not stale; listed in an info row. |
| `mod_pipeline.py`: `gate_rules` | Its scene-node lookup is an info finding, not a false major. |
| `mod_pipeline.py`: `static_stamp`, `lightmapped_rungs` probes | Skipped with a count. |
| Input fingerprints (`manifest_set`) | Already read `maps.json` rows, never files, so nothing changes. |
| `build_mods_manifest.py` | Counts `maps.json` rows, so the level is counted. Guarded by `test_the_registry_counts_an_evicted_level`. |
| `extract_viewmodel.py` level-skins pass | Keeps the row, skin glb and `considered` mark it was published with. The pass reads the scene to decide, and the scene has not changed since it was published. Its delta fingerprint uses the marker in place of a stat. Says so on stderr. |
| `scripts/publish-mesh-delta.py` | Never sends the marker. The evicted files are "on the volume only (left alone)", so nothing is sent or removed. Refuses a `maps.json` that drops a remote-only level and a `mods.json` that counts fewer maps than such a tree's rows (`remote_levels_check`; guard tests in `test_remote_levels.PublisherGuard`). Warns when the volume no longer holds an evicted file at the marker's size. |
| `audit_completeness.py` | Its scene files are not `level-file-missing` or `maps-json-entry-file-missing`. |
| `audit_mod.py` placement, data, level-paint and hull census | Skip it with one info finding, `level-scene-remote-only`. |
| `audit_render.mjs --levels`, `audit_behaviour.mjs` | Skip it with a count. |
| Scene patchers (`patch_flag_cloth`, `patch_engine_limits`, `patch_held_axes`, the round patchers, `patch_seat_ik`) and `optimise_mesh.py` | Name the levels they could not touch on stderr. A fix that reaches scene glbs must restore, patch and publish those levels, or the volume's copy keeps the bug. |
| `swap_scene_glbs.py` | Takes a re-bake into it, unless the re-bake is the scene the marker records, and drops the marker. |
| `server/level-load.mjs`, `sim/level.mjs` | Fail with a message that names `evict_levels.py restore`. |

The `surveys/` censuses still skip or miscount these levels silently. They
are research tools, not gates.

**Dry run against the real trees, 2026-10-20** (the volume's `maps/` listed
read-only: 130,935 files, 41.45 GB). It was taken while another session's
phase 2b pass was writing `.br` files into the FHSW and FHSWEurope trees, so
the split between evictable and waiting moved between runs:

| Tree | Levels evictable | GB (glb + .gz + .br) |
|---|---|---|
| bf1942 | 6 | 0.14 |
| xpack1 | 25 | 0.57 |
| xpack2 | 27 | 0.64 |
| desertcombat | 23 | 0.75 |
| eod | 236 | 7.02 |
| fh | 6 | 0.25 |
| fhsweurope | 53 | 7.74 |
| **total** | **376** | **17.11** |

66 levels stay for the keep-list. dc_final is not published, so it is never
evicted. 126 levels (103 FHSW, 23 FHSWEurope; 16.80 GB) wait only because
their new local `.br` is not on the volume yet. Once those are published they
become evictable too, and the total is about 33.9 GB.

## Deploying phase 1

1. Viewer code needs no change: three r169's `GLTFLoader` already reads
   `EXT_texture_webp` and resolves image URIs relative to the glb.
2. `deploy/app/mesh-deployment.yaml` mounts `assets/mesh/textures` at
   `/usr/share/nginx/html/textures`; `mesh/nginx.conf` serves it immutable.
3. `scripts/publish-mesh-delta.py textures` goes first, then the rewritten glbs.
   A glb that lands before its textures draws untextured.
4. The hard-link mirrors of `viewer/models` (the local API asset roots) need
   `textures/` next to `models/`.
