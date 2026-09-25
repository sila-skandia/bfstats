---
name: hetzner-cluster
description: Reach the production k3s cluster (context hetzner, namespace bf42-stats) from a cloud session through the KUBECONFIG_B64 environment variable - install kubectl, write the kubeconfig, then publish mesh assets or inspect pods. Use whenever a task needs kubectl, publishing to the assets volume, or a look at production pods.
---

# Hetzner cluster access from a cloud session

Only when a task needs the cluster (not part of setup.sh). Needs: env var
`KUBECONFIG_B64` (`kubectl config view --minify --flatten --context hetzner | base64 -w0`),
the API server host allowed under Network access, and allow rules for
mkdir, base64, chmod, curl and kubectl in the committed Claude settings.

## Setup, once per session (separate commands; compound ones fall back to auto-mode checks)

```bash
mkdir -p ~/.kube
base64 -d <<< "$KUBECONFIG_B64" > ~/.kube/config
chmod 600 ~/.kube/config
curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x /usr/local/bin/kubectl
kubectl --context hetzner -n bf42-stats get pods -l app=filebrowser
```

Never print, echo or commit the kubeconfig or the variable. A proxy 403/407 or
reset means the network policy denies the API server host: see
/root/.ccr/README.md and name the host to the owner.

## Rules

- CLAUDE.md's kubectl confirmation rule applies; asset publishing through the
  filebrowser pod is covered by its asset exception.
- Never publish a cloud session's partial tree as-is: publish-mesh-delta.py
  sends the manifests (maps.json, models.json, mods.json, kits.json) last and
  would replace the live level list with the two local levels. Stage exactly
  the files to publish under a scratch root with the same layout and no
  manifests, then run
  `scripts/publish-mesh-delta.py maps --root <scratch-root> --hash --dry-run`,
  read the list, rerun without `--dry-run`, and check the live sizes on
  https://mesh.bfstats.io/.
