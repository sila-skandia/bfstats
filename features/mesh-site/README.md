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

Mesh nginx matches the UI budget: 32Mi request / 128Mi limit. Heavy bytes live
on the PVC, not in the container image or the API process.

That limit is cheap, but it is not free, and the node it lands on is already
past the budget in the root `CLAUDE.md`. Summing `limits.memory` over everything
scheduled (`replicas: 1`; `filebrowser` and `sqlite-browser` sit at 0):

| | MiB |
|---|---|
| api (`nginx` container) | 3072 |
| neo4j | 2048 |
| seq | 512 |
| notifications | 384 |
| redis | 256 |
| ui / haproxy / cloudflared / redis-commander | 128 each |
| **mesh** | **128** |
| api `sqlite-tools` | 64 |
| **total** | **6976** |
| node | 7741 |
| **headroom** | **765 (0.75 Gi)** |

The invariant asks for ~1.5Gi. It was already missed at 0.87Gi before mesh;
mesh takes it to 0.75Gi. Requests total only ~2.9Gi so the pod schedules
comfortably — the exposure is simultaneous peak, not scheduling. Worth funding
from the fat rather than from mesh: `seq` at 512Mi is the obvious candidate on a
box where it is a debugging convenience, and dropping mesh to a 64Mi limit
(ample for nginx serving static files — it idles near 15Mi) recovers another 64.
Neither is done here; changing a production limit is its own decision.
