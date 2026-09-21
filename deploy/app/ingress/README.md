# Ingress via Cloudflare tunnel

CloudFlare has a tunnel to a [deployment running](./cloudflared-tunnel.yml) inside the cluster.

The deployment forwards all traffic to [haproxy](./deployment.yaml), which acts like a load balancer in to the cluster.

Go to [CloudFlare Tunnels](https://one.dash.cloudflare.com/eec964a0ad385fef75646d4b6b7d2f51/networks/tunnels) to see status of the link.

```bash
# Install cloudflared locally
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared-linux-amd64

# Login to Cloudflare
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create k3s-tunnel

# Note the Tunnel ID and credentials file location
```

Create the Kube secret from tunnel credentials

```bash
kubectl create ns cloudflared
kubectl create secret generic tunnel-credentials \
  --from-file=credentials.json=/home/user/.cloudflared/70d35215-771d-4e6e-a220-cf113b0fb1ae.json --namespace cloudflared
```

Apply [cloudflared-tunnel.yml](./cloudflared-tunnel.yml)

Route DNS via the tunnel

```bash
cloudflared tunnel route dns aks-tunnel bfstats.io
cloudflared tunnel route dns aks-tunnel staging.bfstats.io
```

`mesh.bfstats.io` is the BF1942 model/level viewer — see
[`features/mesh-site/README.md`](../../../features/mesh-site/README.md). It
rides this same tunnel and needs no cloudflared of its own:

```bash
cloudflared tunnel route dns a363a103-18d0-439f-afdc-b427e9e6a6ad mesh.bfstats.io
```

**Check which zone your `cert.pem` is scoped to before running that.**
`~/.cloudflared/cert.pem` here has been scoped to `munyard.dev`, and
`route dns` resolves the hostname *relative to the cert's zone* — so the command
above quietly created `mesh.bfstats.io.munyard.dev` instead of touching the
bfstats.io zone at all. It reports success, and the hostname you wanted stays
NODATA. The giveaway is the fully-qualified name in the output or the error:

```
Failed to create record mesh.bfstats.io.munyard.dev
```

`--overwrite-dns` does not fix this — it overwrites the wrong-zone record and
still leaves the real hostname missing. Either `cloudflared tunnel login` and
pick the bfstats.io zone first, or add the CNAME by hand in the dashboard:
name `mesh`, target `<tunnel-id>.cfargotunnel.com`, **proxied** (a
`cfargotunnel.com` target resolves only through Cloudflare's proxy, so a
grey-clouded record is dead).

It briefly had a dedicated tunnel and a second cloudflared, on the belief that
its CNAME already pointed elsewhere and could not be moved. The hostname had no
DNS record at all, so that constraint never existed, and the deployment was
dropped before it ever ran — worth knowing if an old branch reintroduces
`cloudflared-mesh-tunnel.yml` or a `tunnel-credentials-mesh` secret.

One cloudflared process serves exactly one tunnel, and DNS binds a hostname to a
tunnel ID — so adding a hostname to the wrong config silently does nothing. If a
host 1033s, check which tunnel its CNAME points at before touching ingress
rules; everything here forwards to the same HAProxy, so the backend config is
shared and rarely the cause.

## The netcode room server route (`/netcode`)

The BF1942 multiplayer room server (P2 of
[`features/netcode-play-multiplayer/README.md`](../../../features/netcode-play-multiplayer/README.md))
is a Node pod in `bf42-stats` reached through this same tunnel and HAProxy:
`wss://play.bfstats.io/netcode` is the intended public URL. The route needs no
hostname of its own — it is a path-based `is_netcode` ACL (`path_beg /netcode`,
matching both the WebSocket upgrade and the `/netcode/rooms` JSON GET), so it
rides whatever host serves the play site. The `play.bfstats.io` hostname/DNS is
the play-site deployment's open question and remains out of scope here; no
cloudflared change is needed for the netcode path itself.

The deployment files exist (`deploy/app/netcode-deployment.yaml`,
`netcode/Dockerfile`, the `netcode` backend below) but **nothing is applied** —
applying is the owner's call, per repo convention. The apply order is:

1. Apply `deploy/app/netcode-deployment.yaml` (Deployment + Service in
   `bf42-stats`). The Service must exist before step 2.
2. Apply this `deployment.yaml`'s ConfigMap — a **manual step**: no Jenkins
   stage applies the ingress ConfigMap, and none ever has (mesh was manual
   too).
3. `kubectl -n haproxy rollout restart deployment/haproxy`. There is no
   `resolvers` section, so `bfstats-netcode-service.bf42-stats` is resolved
   once at boot: a server disabled at boot stays disabled, and a backends name
   resolved before the Service exists answers 503 until this restart.

The `netcode` backend carries `init-addr last,libc,none` because the Service
may not exist when the ConfigMap is applied — without it HAProxy 3.2 treats an
unresolvable server address as a **fatal** startup error and would take
`bfstats.io` (and everything else this frontend serves) down with it. It also
carries `timeout tunnel 4h`: the defaults' 50s `timeout client`/`timeout
server` apply to upgraded WebSockets whenever `timeout tunnel` is unset, which
would reap the socket between heartbeats. The room server heartbeats at ≤ 30s,
so a live socket's idle gap stays far under the bound; a socket silent for 4h
is dead and should be reaped.
