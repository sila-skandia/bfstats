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
