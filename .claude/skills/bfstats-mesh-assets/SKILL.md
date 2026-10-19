---
name: bfstats-mesh-assets
description: Publishes extracted BF1942 glTF models and level scenes to the assets volume on the bfstats Hetzner cluster, where mesh.bfstats.io serves them. Use this whenever Dylan wants extracted models, maps, thumbnails or the viewer's assets pushed to production — including phrasings like "upload the models", "publish the mesh assets", "push the new vehicles up", "get these onto mesh.bfstats.io", "sync the extracts to the cluster", or "the site is missing the new tanks". Also use it when models have just been re-extracted and the obvious next step is getting them live, when mesh.bfstats.io is serving a stale or incomplete model list, or when browse thumbnails are missing on the live site. Covers the pre-flight checks, uploading with the credential-free kubectl path through the FileBrowser pod (hetzner context), and verifying what actually landed.
---

# Publishing mesh assets to bfstats

`mesh.bfstats.io` serves the BF1942 viewers from an nginx pod whose `/models/`
and `/maps/` are mounted straight off the shared assets PVC. That is the whole
trick: **publishing is an upload, never an image build.** Files land on the
volume and the site serves them on the next request.

Your job is to get `tools/bf1942-models/viewer/{models,maps}` onto that volume
intact, then leave the cluster as you found it.

## Re-extraction is part of this job, not a separate errand

**If the extractor changed, re-extract before you publish.** The whole failure
class this skill exists to prevent is *new viewer code against old assets*: the
viewer ships through Jenkins on its own cadence, assets ship by upload, and
nothing keeps them in step. A viewer that reads a glTF extras field misbehaves
silently on an asset baked before the field existed. In Sep 2026 a
flag-consuming fallback in `flight.js` took nineteen of a Corsair's nodes round
the propeller shaft on production for two days, because `wake/scene.glb`
predated the flag.

So the job is: **extract, then upload, then verify.** Do not deliver half of it
and hand the rest back as a suggestion.

**Extraction runs through `tools/bf1942-models/mod_pipeline.py`**, never through
the individual `extract_*.py` scripts: a level or a mod is twenty-odd artefacts,
and the pipeline runs them in order, keeps the thumb keys, writes the `.glb.gz`
the publisher demands and names what a bake left out (`verify`, step
`v_levels`). Skill `bf1942-mod-pipeline` is the procedure. For an exporter fix:

```bash
cd tools/bf1942-models
python3 mod_pipeline.py run --mod bf1942 --levels <affected> --force-steps \
    --only-steps levels flag_cloth optimise --no-gates
python3 mod_pipeline.py run --mod bf1942 --no-gates      # whatever the re-bake made stale
```

A change that only reaches `scene.json` is a layer, not a re-bake:
`patch_scene.py --layer <L> --mod <id> --all` (`features/level-bake-layers/README.md`).

Run the pipeline from a detached worktree at the commit that holds the fix,
with the asset trees linked in (`link_viewer_assets.sh`), and keep the state
file in the main checkout. The main checkout is shared with live sessions whose
uncommitted edits to `extract_map.py` / `bf42/` land mid-run: on 2026-09-23 a
level chain baked vanilla cleanly and then lost every expansion-pack level to a
sibling's half-written `info.statics`. A worktree's `bf42/` is whatever its own
branch is at, often many commits behind, and extracting from there silently
bakes assets with the old exporter: nothing errors, the new field is simply
absent. Confirm before you start, and again on the output:

```bash
grep -c spinsChildren tools/bf1942-models/bf42/assemble.py   # the code you are about to run
```

```python
any('spinsChildren' in (x.get('extras') or {}) for x in j['nodes'])   # one re-baked glb
```

Extraction is slow and I/O heavy. Run it detached, not under a foreground
timeout, and do not start it while an upload is reading the same tree.

### The blast radius of an exporter fix is four trees, not one

A material or extras change in `bf42/gltf.py` / `bf42/assemble.py` / `bf42/rs.py`
lands in **every** glb the exporter writes, and the exporter writes four trees:

| tree | what carries the bug | how to re-bake |
|---|---|---|
| `viewer/models` | vehicle, weapon, cockpit and wreck glbs | `extract_models.py <templates> --level-all --configuration-all --cockpit` |
| `viewer/models/mods/<mod>` | the same, per mod (EoD re-exports most vanilla planes) | same with `--mod EoD\|XPack1\|XPack2 --out viewer/models/mods/<id>` |
| `viewer/maps/**/scene.glb` | every placed vehicle and static is baked into the level | `extract_maps_all.py [--mod .. --out viewer/maps/mods/<id>] --levels <affected>` |
| `viewer/maps/**/_shared/effects.glb` | wreck and debris meshes inside effect bundles | `extract_effects.py [--mod .. --out ../_shared] --no-sound` |

Do not guess the set — measure it. Parse the JSON chunk of every glb (20-byte
header, then `struct.unpack_from('<I', data, 12)` bytes of JSON) and list the
files whose materials or extras still show the old value; `os.walk` with
`followlinks=False`, because `viewer/maps/maps` is a self-referencing symlink
that turns 13 real hits into 2,296. The 2026-09-23 envmap/alpha fix touched
17 vanilla + 56 mod templates, 33 levels across vanilla and the packs, 159 EoD
levels and all four `effects.glb`s; the first pass fixed the models and handed
the levels back as "here is the command", which the owner rejected outright:
*"it's your job to do that, not me. Extract and publish whatever you need."*
Run the whole radius, then publish, then verify. Timings at `-j 8`: vanilla
levels ~5 min, each expansion pack ~6-8 min, EoD ~1 min per level. EoD level
names include apostrophes (`charlie_don't_surf`, `who'll_stop_the_rain`), so
never splice a `--levels` list into a generated shell script — read it from a
file with `mapfile -t` and quote the array, `bash -n` the script, and treat a
stage banner with no "N of M levels" line inside a minute as a failed launch.

**Targeted model re-extraction must not go through `--out viewer/models`.**
`extract_models.py` rewrites `models.json` to just the templates it was given
(and strips `thumb`). Extract into a scratch directory and copy the `.glb` and
`.report.json` files over the existing ones; the manifest is untouched and the
thumbnails stay pointed at the right files. `extract_maps_all.py` is different —
it merges its rows into `maps.json` by name, so `--levels <subset>` straight
into the live tree is the intended use.

**Publish with `scripts/publish-mesh-delta.py [models|maps] --streams 8`.** It
sends only files absent from the volume or a different size there, manifests
last, verified sizes per unit, resumable, never deletes. It supersedes the
`cp -al` staging and `upload-mesh-assets.sh` steps below. `--dry-run` first and
read the count: anything beyond your own re-exports is another session's
unpublished work riding along, which is usually right (it is what the live
viewer code already expects) but should be named in the report.

## Before touching the cluster

Every kubectl command in this repo needs confirmation from Dylan first — a
standing rule in the project's `CLAUDE.md` — **unless he has already said to get
on with it.** That rule carries its own "unless I explicitly say otherwise", and
"just do what's needed without stopping to ask" is exactly that. Once he has
said it, it holds for the rest of the session: run the read-only checks and the
upload, and report what happened. Do not re-ask per command; being kicked along
step by step through a publish he already authorised is the failure mode here,
not a safety measure.

What still deserves a pause: scaling a deployment, applying a manifest, purging
a CDN, or anything that deletes. Those are not part of a normal publish.

Run the pre-flight checks locally, since they need no cluster access and catch
the failures that are annoying to diagnose after a 190MB transfer:

```bash
cd tools/bf1942-models/viewer
python3 - <<'PY'
import json, pathlib
root = pathlib.Path('models')
manifest = json.loads((root / 'models.json').read_text())
missing_glb = [e['name'] for e in manifest if not (root / e['glb']).is_file()]
no_thumb_key = [e['name'] for e in manifest if not e.get('thumb')]
missing_thumb = [e['name'] for e in manifest
                 if e.get('thumb') and not (root / e['thumb']).is_file()]
print(f"{len(manifest)} models")
print("missing .glb:      ", missing_glb or "none")
print("no thumb in manifest:", no_thumb_key or "none")
print("thumb file missing: ", missing_thumb or "none")
PY
du -sh models maps 2>/dev/null
```

What the results mean:

- **Missing `.glb`** — the manifest and the tree disagree. Re-run
  `extract_models.py` rather than uploading a manifest that points at nothing.
- **No `thumb` key, or the file is absent** — the browse grid renders empty
  cards. Thumbnails come from `node shoot.mjs --thumbs`, which needs the
  `model-viewer` launch config running on :5273 and also stamps the paths into
  `models.json`. Run it before uploading, or the live site's armoury view will
  look broken while every model still loads fine, which is a confusing thing to
  debug later.
- **Size** — as of Sep 2026 the tree is **~3.2GB of models and ~15GB of maps**,
  of which `models/mods` (2.7GB) and `maps/mods` (14GB) are the bulk. Vanilla
  alone is roughly 500MB + 1GB. Earlier revisions of this file said 31MB/188MB;
  that predates the mod extractions. **Check with `du -sh models maps` rather
  than trusting any number written here.**

**Upload what changed, not the whole tree.** 18GB through a `tar | kubectl exec`
pipe is a different proposition from what the script was written for. Work out
the actual fix set and stage it with hardlinks — `cp -al` is instant and freezes
the file set against concurrent writes:

```bash
S=~/.cache/mesh-upload && rm -rf $S && mkdir -p $S/models $S/maps
cp -al viewer/models/*.cockpit.glb $S/models/
cp -al viewer/maps/wake $S/maps/wake
MODELS_DIR=$S/models ./scripts/upload-mesh-assets.sh --kubectl --models
MAPS_DIR=$S/maps    ./scripts/upload-mesh-assets.sh --kubectl --maps
```

The remote unpack is `tar -x` over the existing tree, so a partial upload is
**additive** — it never removes what is already there. That is what makes
staging a subset safe.

To decide the set, parse the glTF rather than grepping it. `grep` on a `.glb` is
unreliable and will tell you a field is absent when it is present:

```python
import json, struct
d = open(p, 'rb').read(); n = struct.unpack('<I', d[12:16])[0]
j = json.loads(d[20:20+n])
any('spinsWithEngine' in (x.get('extras') or {}) for x in j.get('nodes', []))
```

**Run the upload detached.** ~800MB took over ten minutes and died on a
foreground timeout mid-transfer. Redirect to a log and background it. A
SIGTERM during the tar/transfer phase is harmless — nothing has landed yet —
but one during the unpack leaves the tree without its `chown`/`chmod`, which
serves 403s. Check `ls -l` on a file you expected to replace: if its mtime is
still the old one, nothing landed and you can simply re-run.

## Doing the upload

**`scripts/publish-mesh-delta.py` is the publisher.** It sends only files absent
from the volume or a different size there, through parallel `kubectl exec`
streams into the FileBrowser pod (hetzner context, no credentials), verified
sizes per unit, manifests last, resumable under `~/.cache/mesh-publish/`, and it
never deletes. It replaced `upload-mesh-assets.sh` (whole-tree tar) and
`upload-mesh-maps-resumable.sh` (skips a level when the file COUNT matches,
wrong after a re-bake) on 2026-09-20; those two are kept below for the rare
hand upload.

```bash
scripts/publish-mesh-delta.py models maps --dry-run      # read the count and the list
scripts/publish-mesh-delta.py models maps --streams 8     # 2 on a weak Wi-Fi
scripts/publish-mesh-delta.py models --root ~/.cache/my-stage --hash --hash-remote   # exactly your files
```

* **Read the dry run.** Anything beyond your own exports is another session's
  unpublished work riding along, usually right (the live viewer code already
  expects it) and always named in the report. When it is not wanted, hard-link
  exactly your files into a staging root (`<root>/{models,maps,textures}`, the
  textures the glbs point at too, the `.glb.gz` beside every glb) and pass
  `--root`. A staging root under `/tmp` is another filesystem and `ln` fails.
* **It refuses a glb without a fresh `.glb.gz`** (`--allow-plain` to override):
  a changed glb needs `optimise_mesh.py` before it ships.
* **A same-size change hides from it.** A manifest whose counts change by equal
  digit width (2818 to 2847) has the same size; publish it with `--hash
  --hash-remote`. The local `--hash` record only knows what this script sent.
* **Order.** The mesh image (viewer code) deploys itself from main through
  Jenkins; publish re-baked levels only after that code is live, because a
  multi-mode `scene.glb` on an older page shows every mode's vehicles at once:
  `curl -o /dev/null -w '%{http_code}' https://mesh.bfstats.io/game-modes.js`.
  `models/mods.json` goes last, after the maps tree it counts exists.
* **One stream is about 1 MB/s** whatever the uplink; eight moved 15 GB in 51
  min. A listing streamed out of `kubectl exec` can arrive truncated with no
  error; the script lists to a file on the pod and compares counts.
* Killing the Python parent lets an in-flight transfer finish; killing the
  kubectl half leaves a truncated file live until it is re-sent.
* **Local eviction.** What is on the volume may leave this PC
  (`features/mesh-asset-size`, "Local eviction"). Publishing the `glbs` tree
  rewrites `viewer/glbs/.on-volume.json` from its listing, and
  `tools/bf1942-models/evict_glbs.py [--refresh] [--apply]` removes the store
  blobs it names at the local size. An evicted blob still counts as present to
  `store_check` and is not rewritten by `store_glbs.py`. A blob missing with no
  record behind it still stops the publish, and that is the right answer.

### The legacy whole-tree path


There is exactly one FileBrowser — the long-standing one in `bf42-stats` that
already holds tournament and map images. Mesh assets are not a new service, just
a `mesh/` folder inside the tree it already serves at `/mnt/assets`. Never stand
up a second instance.

`scripts/upload-mesh-assets.sh` does the whole sequence — tar, transfer, unpack,
`chown 1000:1000`, `chmod a+rX`. Use it rather than hand-rolling a copy; the
permissions step is easy to forget and produces a 403 that looks like a routing
bug.

It writes to `mesh/models` and `mesh/maps` under `assets/`, walking the local
tree recursively, so `models/thumbs/` goes up without special handling.

### Use the kubectl path — it is the one that works unattended

```bash
./scripts/upload-mesh-assets.sh --kubectl
```

It tars straight through the running FileBrowser pod with **no credentials at
all**, which is why it is the path that has actually worked historically.
Targets the `hetzner` context and `bf42-stats` namespace (`KUBE_CONTEXT` /
`KUBE_NS` override), falling back to the API pod if FileBrowser is down. Both
mount the same PVC, so bytes land in the same place either way — FileBrowser
sees `/mnt/assets/mesh`, the API pod `/mnt/data/assets/mesh`. One trap on the
fallback: `kubectl cp` needs `tar` inside the target container, and the script
picks `containers[0]`, the API container — a failure mentioning `tar` means
that, not a broken volume; retry once FileBrowser is up.

Do not reach for the HTTP path first. It requires a FileBrowser login, and the
script's `admin`/`admin` default is wrong: the real credentials live only inside
FileBrowser's own DB on the volume (`/mnt/assets/.filebrowser.db`) — they are
**not** in any cluster Secret or ConfigMap, so there is nothing to discover with
kubectl. A port-forward (`kubectl --context hetzner -n bf42-stats port-forward
svc/filebrowser-service 18081:80`) gets you to the UI but uploads still 401
without the real login. The Tailscale hostname `filebrowser-hetzner` only
resolves when this machine is actually logged into the tailnet (`tailscale
status` says `Logged out.` more often than you'd hope). HTTP is for Dylan
browsing the volume by hand, not for automated uploads.

### Never upload while an extraction is writing into the tree

`upload-mesh-assets.sh` is `set -e` around a `tar | kubectl exec tar -x`
pipeline. If anything is concurrently writing into `viewer/models` or
`viewer/maps` (a `--matrix` pose export, a mod extraction in another session),
tar hits `file changed as we read it`, exits 1, and the script dies **after**
some files landed but **before** the `chown`/`chmod` steps — leaving the remote
tree partial and unreadable (404s/403s on the live site for whatever missed the
boat). Check `ps aux | grep extract` first. If an extraction is mid-flight and
the upload can't wait, snapshot with hardlinks and upload the snapshot:

```bash
cp -al tools/bf1942-models/viewer/models ~/.cache/mesh-upload-models
rm -rf ~/.cache/mesh-upload-models/mods/<the-churning-mod>
MODELS_DIR=~/.cache/mesh-upload-models ./scripts/upload-mesh-assets.sh --kubectl --models
```

`cp -al` is instant (same filesystem, hardlinks) and freezes the file set.

### Careful with replicas

The checked-in manifest says `replicas: 0`, but FileBrowser has been left
running in the cluster. **That drift matters**: applying
`deploy/app/filebrowser-deployment.yaml` scales it to 0, and the UI disappears
for reasons nobody remembers an hour later. Do not apply that manifest casually,
and if you do, expect to scale it back up.

If you scale it up yourself purely to unblock an upload, put it back where you
found it — it carries a 256Mi limit against well under 1Gi of node headroom. If
it was already running, leave it alone; it is a tool Dylan uses.

## Confirming it worked

The script prints a file count from inside the pod. Compare it to the local
count — they should match exactly:

```bash
find tools/bf1942-models/viewer/models -type f | wc -l
```

Then check the site actually serves the new content, which is the only test that
proves the mount, the permissions and nginx all agree:

```bash
curl -s https://mesh.bfstats.io/models/models.json | head -c 200
curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' \
  https://mesh.bfstats.io/models/thumbs/sherman.png
```

Expect `200 image/png` and a non-trivial size. A **403** means the `chmod -R a+rX`
step did not take: the mesh pod mounts the tree read-only and nginx's workers run
as the unprivileged `nginx` user, so world-readable is what actually makes the
files servable — `chown 1000:1000` alone is not enough. A **404** means the files
went to the wrong path; check whether the upload ran against `mesh/models` rather
than `models`.

Note the site caches: `/models/` is `max-age=300` in the browser and
`s-maxage=86400` at the edge. A fresh upload can therefore look stale for a few
minutes even when it succeeded. Add a cache-buster before concluding anything is
wrong:

```bash
curl -s "https://mesh.bfstats.io/models/models.json?cb=$(date +%s)" | head -c 200
```

Only purge Cloudflare if the content is genuinely wrong rather than merely
cached — a purge is cheap but it is not a diagnosis.

## The shape of a good run

1. **Re-extract if the extractor moved.** Compare `git log -- bf42/ extract_*.py`
   against the bake's mtimes. Detached, never under a foreground timeout.
2. Pre-flight locally; report model count, thumbnail status and total size,
   measured rather than recalled.
3. Measure the blast radius across all four trees (models, mod models, level
   bakes, `_shared/effects.glb`) and re-bake every affected file, not the one
   the report was about.
4. `scripts/publish-mesh-delta.py models` then `... maps`, detached. It works
   out the fix set itself from sizes; there is no staging step any more.
5. Verify the file count and fetch a real asset over HTTPS with a cache-buster.
   Mind case in filenames: `BF109.cockpit.glb`, not `Bf109`.
6. Report what landed, and say plainly what is still stale and why.

Run the whole sequence. Do not stop between steps to ask whether to continue —
if Dylan asked for a publish, steps 1 through 6 are the publish.

## What this skill does not do

Assets are deliberately **not** in git — `viewer/models/` and `viewer/maps/` are
gitignored and excluded from the Docker image. If asked to commit them, say so
rather than doing it; the whole design is that heavy bytes live on the PVC.

Rebuilding the viewer's HTML/JS *is* an image build and goes through the Jenkins
Mesh Pipeline, gated on `mesh/` or `tools/bf1942-models/viewer/`. Uploading
assets never needs a rebuild, and a rebuild never uploads assets. Keep the two
apart when diagnosing "the site looks wrong" — stale viewer code and stale
assets have different fixes.
