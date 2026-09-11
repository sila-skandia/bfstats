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

Cloudflare Tunnel → HAProxy (host `mesh.bfstats.io`) → `bfstats-mesh-service`
in `bf42-stats`. The mesh pod mounts the PVC the same way FileBrowser does, so
`/models/` and `/maps/` are served as static files next to the viewer — no
proxy hop through the API for every texture.

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

DNS via the existing tunnel (same as bfstats.io / staging):

```bash
cloudflared tunnel route dns aks-tunnel mesh.bfstats.io
```

Apply the mesh Deployment/Service, then refresh HAProxy and cloudflared so the
new hostname is routed:

```bash
kubectl --context hetzner apply -f deploy/app/mesh-deployment.yaml
kubectl --context hetzner -n haproxy apply -f deploy/app/ingress/deployment.yaml
kubectl --context hetzner -n cloudflared apply -f deploy/app/ingress/cloudflared-tunnel.yml
kubectl --context hetzner -n cloudflared rollout restart deployment/cloudflared
```

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

That writes into `mesh/models` and `mesh/maps` on the assets volume, walking the
tree recursively — so `models/thumbs/` (the browse-view thumbnails from
`node shoot.mjs --thumbs`) goes up with everything else. The mesh site picks it
all up immediately, no image rebuild. The API endpoint reads the same tree for
anything on bfstats.io that wants a vehicle glb later.

## Caching

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

The invariant asks for ~1.5Gi, and it was already missed at 0.87Gi before mesh
existed. Mesh costs 0.06Gi of that. The remaining gap is not a mesh problem:
`seq` at 512Mi is the obvious candidate on a box where it is a debugging
convenience. Requests total only ~2.9Gi, so scheduling is comfortable — the
exposure is simultaneous peak.

Note that scaling `filebrowser` up to upload assets temporarily adds its 256Mi
limit on top. Scale it back to 0 when the upload is done.
