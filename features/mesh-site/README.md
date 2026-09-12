# mesh.bfstats.io

Dedicated host for the BF1942 model and level viewers in
[`tools/bf1942-models/viewer`](../../tools/bf1942-models/viewer). Same cluster as
bfstats.io; separate site so the main UI stays lean and the mesh work can ship
on its own cadence.

## Shape

| Piece | Where |
|---|---|
| Viewer HTML/JS/vendor | Docker image `anskia/bfstats-mesh` (built from `mesh/`) |
| Extracted glTF / maps | Assets PVC under `mesh/models/` and `mesh/maps/` |
| Upload / browse | FileBrowser (Tailscale `filebrowser-hetzner`) |
| Public URL | `https://mesh.bfstats.io` |
| Same assets for the main site | `GET /stats/assets/mesh/{*path}` on the API |

## One site, three features

`index.html`, `map.html` and `poses.html` are three independent three.js apps —
different layouts, different asset trees, no shared runtime. What makes them one
site is [`shell.css`](../../tools/bf1942-models/viewer/shell.css): a bar across
the top of all three carrying the brand and a Models / Maps / Poses toggle, with
the active tab marked by `aria-current="page"`.

| Tab | Page | Serves from |
|---|---|---|
| Models | `index.html` | `models/` — vehicles, weapons, armour, damage, duels |
| Maps | `map.html` | `maps/` — extracted levels, terrain, lightmaps, sky |
| Poses | `poses.html` | `models/poses/` — soldier states and weapon grip welds |

The nav is static markup in each page rather than injected by script, so it
survives a module that fails to load — which on these pages is the case worth
being able to navigate away from. Each page reserves `--nav-h` as its first grid
row instead of floating the bar over the canvas, so the two renderers that size
themselves from a container (`main.clientWidth` on models and poses,
`#stage.clientWidth` on maps) keep working with no offset arithmetic. `map.html`
gained a `#stage` wrapper for exactly that reason: its canvas and three overlays
used to resolve against the viewport.

Poses is not a separate asset tree — it reads `models/poses/`, so a
`--models`-only upload publishes both the Models and Poses tabs.

Cloudflare Tunnel → HAProxy (host `mesh.bfstats.io`) → `bfstats-mesh-service`
in `bf42-stats`. The mesh pod mounts the PVC the same way FileBrowser does, so
`/models/` and `/maps/` are served as static files next to the viewer — no
proxy hop through the API for every texture.

`mesh.bfstats.io` rides the **shared** tunnel (`a363a103…`), the one already
carrying bfstats.io / staging / seq. It is one more `hostname:` rule in
[`cloudflared-tunnel.yml`](../../deploy/app/ingress/cloudflared-tunnel.yml)
pointing at the same HAProxy, which routes on the Host header.

An earlier revision gave mesh its own tunnel (`787f3214…`, listed as
`aks-tunnel`) and a second cloudflared, reasoning that one cloudflared runs
exactly one tunnel and mesh's CNAME already pointed at that ID. The second half
was never true — `mesh.bfstats.io` had no DNS record whatsoever, so the hostname
was free to be routed anywhere. Dropping that deployment removes a failure
domain, a `tunnel-credentials-mesh` secret, and 64Mi of limit on a node that is
already short of the headroom the root `CLAUDE.md` asks for.

The tradeoff to know: mesh and bfstats.io now share an upstream. A cloudflared
restart to add or change a hostname blips every host on the tunnel, so batch
ingress edits rather than applying them one at a time.

```
assets/                         # /mnt/data/assets on the PVC
├── maps/                       # map thumbnails (existing)
├── tournaments/                # …
└── mesh/
    ├── models/                 # extract_models.py --out
    │   ├── models.json
    │   ├── damage.json
    │   └── *.glb / *.json
    └── maps/                   # extract_map.py --out
        ├── maps.json
        └── Tobruk/…
```

## One-time cluster steps

**None of this has been run yet — the site is local-only.** `mesh.bfstats.io`
resolves to nothing today (A, AAAA and CNAME all NODATA, checked 2026-09-12),
which is exactly why it was free to be put on the shared tunnel. Develop against
the `model-viewer` launch config on :5273; treat this section as the go-live
runbook rather than a description of what is deployed.

The assets are already published, though — `mesh/models` and `mesh/maps` on the
volume are populated, so the site has something to serve the moment it is up.

There is no credentials step and no new secret: the shared tunnel's
`tunnel-credentials` is already mounted by the cloudflared that will serve mesh.

**1. Let Jenkins build the image first.** The Mesh Pipeline is gated on `mesh/`
or `tools/bf1942-models/viewer/`, and it applies the mesh Deployment/Service
itself. Applying `mesh-deployment.yaml` by hand before the first push only gets
you `ImagePullBackOff`.

**2. HAProxy and the shared tunnel.** The `mesh.bfstats.io` ACL and
`mesh_frontend` backend are already in the HAProxy config; the tunnel ConfigMap
now carries the matching `hostname:` rule. Applying the ConfigMap needs a
restart for cloudflared to reread it, and that blips every host on the tunnel —
seconds, but not zero:

```bash
kubectl --context hetzner -n haproxy apply -f deploy/app/ingress/deployment.yaml
kubectl --context hetzner -n cloudflared apply -f deploy/app/ingress/cloudflared-tunnel.yml
kubectl --context hetzner -n cloudflared rollout restart deployment/cloudflared
```

**3. DNS last**, once something is actually listening. Pointing the hostname at a
tunnel with no origin behind it serves a Cloudflare 1033 rather than a useful
error:

```bash
cloudflared tunnel route dns a363a103-18d0-439f-afdc-b427e9e6a6ad mesh.bfstats.io
```

That writes a proxied CNAME to
`a363a103-18d0-439f-afdc-b427e9e6a6ad.cfargotunnel.com` in the bfstats.io zone.
It has to stay orange-clouded: `cfargotunnel.com` targets resolve only through
Cloudflare's proxy, so grey-clouding the record breaks the host entirely. Then
`curl -sI https://mesh.bfstats.io/` should return 200.

That command only works if `~/.cloudflared/cert.pem` is scoped to the bfstats.io
zone. It has been scoped to `munyard.dev`, in which case `route dns` appends
that zone and creates `mesh.bfstats.io.munyard.dev` — a stray record in an
unrelated zone, while `mesh.bfstats.io` stays NODATA. See
[the ingress README](../../deploy/app/ingress/README.md) for the symptom and the
two ways out; `--overwrite-dns` is not one of them.

Re-applying the *shared* tunnel config is optional and cosmetic: the
`mesh.bfstats.io` rule was dropped from it because that process runs a different
tunnel and would never match the hostname. Nothing breaks either way, so it can
ride along with the next ingress change rather than costing a cloudflared
restart on the host serving bfstats.io.

Jenkins RBAC already covers `bf42-stats`; mesh lives in that namespace so the
existing `jenkins-deployer` Role is enough. After the first image push, a mesh
changeset (or `BUILD_ALL`) deploys it.

## Publishing models

Extract locally as documented in
[bf1942-3d-models](../bf1942-3d-models/README.md), then upload:

```bash
# FileBrowser HTTP (port-forward or Tailscale)
FILEBROWSER_URL=http://filebrowser-hetzner:80 ./scripts/upload-mesh-assets.sh

# Or straight onto the volume
./scripts/upload-mesh-assets.sh --kubectl
```

The `chown -R 1000:1000` inside the kubectl path is best-effort. FileBrowser's
container does not run as root, so it cannot chown a directory an earlier upload
left behind — and while that `chown` sat in the middle of an `&&` chain, hitting
it aborted the run *after* tar had unpacked and *before* the `chmod -R a+rX`,
leaving a complete tree that nginx would answer 403 for. Ownership is cosmetic
here; the world-readable bit is what makes a file servable through the read-only
mount. Failing the chown no longer fails the upload.

That writes into `mesh/models` and `mesh/maps` on the assets volume, walking the
tree recursively — so `models/thumbs/` (the browse-view thumbnails from
`node shoot.mjs --thumbs`) goes up with everything else. The mesh site picks it
all up immediately, no image rebuild. The API endpoint reads the same tree for
anything on bfstats.io that wants a vehicle glb later.

## Caching

The three pages and `shell.css` are `max-age=0, s-maxage=60`. Nothing in the
browser cache outlives a deploy, which matters more now that they share a
stylesheet: a stale `shell.css` against a fresh page is a broken nav, and the
two only change together on an image build.

`/models/` and `/maps/` are `max-age=300, s-maxage=86400`: a re-upload shows up
in a browser within five minutes without a hard refresh, while the edge holds
the bytes for a day. `/vendor/` is a week — the vendored three.js only changes
on an image build.

Which is why the Mesh deploy stage purges Cloudflare scoped to
`mesh.bfstats.io`. The UI stage purges the whole zone, but it only runs when
`ui/` changed; without a mesh-side purge a mesh-only build would leave the edge
serving the previous viewer, and `/vendor/` for up to a week. Scoping it to the
one host keeps a mesh deploy from cold-starting bfstats.io.

gzip is text-only on purpose. A `.glb` is a container of already-compressed PNG
textures and packed binary, and the browse thumbnails are PNG; compressing
either burns CPU on a single-node cluster to save almost nothing. `models.json`
and the per-model reports are what actually compress here.

## Local preview

Unchanged: `model-viewer` launch config serves `tools/bf1942-models/viewer` on
`:5273` with models under `viewer/models` (gitignored). Production just swaps
that local tree for the PVC mount.

## Memory

16Mi request / 64Mi limit, which is smaller than the UI's 32/128 on purpose:
this is nginx handing out static files while the client does every expensive
thing. Heavy bytes live on the PVC, not in the container image or the API
process.

The number is measured, not guessed. Serving concurrent 2.5MB `.glb` transfers,
the container's cgroup sat at 19.6Mi and peaked at 23.2Mi — and that was with 22
worker processes, where production gets at most 4 (the node has 4 cores, and the
nginx image sizes `worker_processes` from the cgroup CPU quota, which is 200m
here). 64Mi is roughly 3x the worst case.

Page cache from reading the asset tree is charged to the same cgroup under
cgroup v2, so a large `maps/` tree will push `memory.current` up. That is fine:
page cache is reclaimable, so a tight limit costs eviction and a re-read, not an
OOM kill. The measurement above already includes it — ~100MB was transferred to
reach that 23.2Mi peak.

It still lands on a node that is past the budget in the root `CLAUDE.md`.
Summing `limits.memory` over everything scheduled (`replicas: 1`; `filebrowser`
and `sqlite-browser` sit at 0):

| | MiB |
|---|---|
| api (`nginx` container) | 3072 |
| neo4j | 2048 |
| seq | 512 |
| notifications | 384 |
| redis | 256 |
| ui / haproxy / cloudflared / redis-commander | 128 each |
| api `sqlite-tools` | 64 |
| **mesh** | **64** |
| **total** | **6912** |
| node | 7741 |
| **headroom** | **829 (0.81 Gi)** |

The invariant asks for ~1.5Gi, and it was already missed at 0.87Gi before any of
this existed. mesh costs 0.06Gi — sized down from the 128Mi that copying the
neighbouring deployments would have given it, and half what this feature would
have cost had it kept a cloudflared of its own. The remaining gap is not a mesh
problem: `seq` at 512Mi is the obvious candidate on a box where it is a
debugging convenience. Requests total only ~2.9Gi, so scheduling is comfortable
— the exposure is simultaneous peak.

Note that scaling `filebrowser` up to upload assets temporarily adds its 256Mi
limit on top. Scale it back to 0 when the upload is done.
