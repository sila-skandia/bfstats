# Shared gameplay recordings

The request (2026-09-27): store recordings in FileBrowser, read-only for now.
The owner publishes a few rounds and shares links that open straight into the
replay, instead of REPLAY's file picker, to promote the feature. The long-term
goal is players storing their own recordings.

## Status

Built (2026-09-27). Read-only: recordings go up through FileBrowser and are
served as static files. Nothing on the site uploads or lists them.

## Publishing a recording

1. Scale FileBrowser up (it sits at `replicas: 0`) and open it over Tailscale
   (`filebrowser-hetzner`).
2. Upload `replay_<stamp>.ndjson`, and its `ev_*.xml` server log if there is
   one, into `mesh/replays/`. Create that folder the first time.
3. Scale FileBrowser back to 0 (its 256Mi limit is outside the node's budget,
   see features/mesh-site).
4. Share the link:

```
https://play.bfstats.io/map.html?replay=replays/<file>.ndjson
https://play.bfstats.io/map.html?replay=replays/<file>.ndjson&serverlog=replays/<ev_log>.xml
```

A new recording needs no deploy: nginx serves it as soon as it is on the
volume. Give each cut a new file name. The edge keeps a recording for a day
(`s-maxage=86400`), so a file replaced under the same name can serve the old
copy until then. A mesh deploy purges it sooner.

## The link

| Parameter | |
|---|---|
| `replay=replays/<file>` | The recording. The path is relative to `map.html`, so it is the same link locally (`viewer/replays/`, gitignored, where the server lab stages its runs) and on play.bfstats.io. |
| `serverlog=replays/<ev_log>.xml` | Optional. The dedicated server's event log, overlaid on the replay. |
| `mod=<mod>` | Not needed. The page plays the recording in its own mod (below). |
| `map=<level>` | Only for a recording begun mid-round. See below. |

**The mod.** A link written from the file name names no mod, so `map.html`
comes up in the mod the visitor last browsed (`mods.js` remembers it). A
vanilla round would load on Road to Rome's level list for anyone who last
looked at Road to Rome. Once the recording is read, before any level loads,
`ownModHref` (`replay-open.js`) sends the page on to the same link with the
recording's own mod appended. The recording comes back out of the browser's
cache (`max-age=300`). A link that names a mod keeps it, as `?map=` keeps its
level.

**A recording begun mid-round** names neither its level nor its mod
(features/round-replay-ux). Open recording recognises the level by its flags.
A link does not, so give it both: `&mod=<mod>&map=<level>`.

## How it is served

- `deploy/app/mesh-deployment.yaml` mounts the assets PVC's
  `assets/mesh/replays` read-only at the mesh nginx's `/replays/`. That is
  FileBrowser's `mesh/replays/`, next to `mesh/models` and `mesh/maps`.
- `mesh/nginx.conf`, `location /replays/`: `.ndjson` as
  `application/x-ndjson` (Alpine's `mime.types` has no entry for it) and
  `.xml` as `text/xml`, both gzipped. There is no listing: a recording is
  reached by the link that names it. Measured under the pod's own 200m CPU
  limit: a 30.9 MB recording went out as 7.8 MB in 1.3 s, and the container
  sat at 5 MiB.
- **Permissions.** FileBrowser runs as uid/gid 1000 and creates files `0640`
  in folders `0750` (its `DefaultFileMode` and `DefaultDirMode`). nginx's
  workers drop to the `nginx` user and only its groups, so the stock image
  answered 403 for anything uploaded by hand. The publish scripts'
  `chmod -R a+rX` hides this for `models/` and `maps/`. `mesh/Dockerfile`
  adds `nginx` to a gid-1000 group (`assets`), so the workers read what
  FileBrowser writes. The pod's `fsGroup: 1000` keeps the volume in that
  group. Reproduced 403 on the stock image, 200 with the change.
- `mesh/Dockerfile` and `.dockerignore` keep a local `viewer/replays/` out of
  the image, as they do the extract trees.

If an upload into `mesh/replays/` fails on permissions, the folder was
created by the kubelet (the mesh pod's `subPath` makes a missing one) before
FileBrowser made it. Hand it to uid 1000 from the API pod, which mounts the
PVC's root at `/mnt/data`: `chown 1000:1000 /mnt/data/assets/mesh/replays`.

## Verification

- `tests/test_replay_open.py`: a link naming no mod gains the recording's
  (vanilla from a remembered mod, `XPack1` to `xpack1`). It stays when the
  link names a mod, when the recording is one held for the page, when the
  recording names no mod or one without maps here, and on a page watching
  nothing.
- The image built and run locally, with FileBrowser-style `0640`/`0750`
  uid-1000 files mounted read-only: 200 with gzip and the cache header, 404
  for the folder and for a missing file. `map.html`, the modules and the mesh
  host's 301 are unchanged.
- `map.html` in Chromium, against the image with a stub asset tree:
  - a visitor who last browsed `xpack1` was sent on to `…&mod=bf1942`;
  - a fresh visitor and a link naming its mod stayed put;
  - all three reached the loading screen's `Replay · 15 Sep 2026, 21:31 · BF1942 server1`.

## Later: players' own recordings

- Upload through the API rather than FileBrowser: authenticated, size-capped,
  and checked for a bf42plus header (the first line's `{"k":"h",...}`, as
  `replay-open.js` checks a dropped file). Write under
  `mesh/replays/players/<id>/`. The nginx location and the link already serve
  any path under `replays/`.
- Quota and retention: the same PVC holds the 18 GB SQLite database, and a
  round is tens of MB. Storing recordings gzipped (`gzip_static` in the
  location) would cut both disk and the per-request gzip.
- A gallery would read the API's own table of recordings, not an nginx
  listing.
