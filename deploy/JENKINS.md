# Jenkins CI/CD

Jenkins runs on a local k8s agent and deploys to a remote Hetzner k3s cluster. Authentication uses a **kubeconfig file** containing a long-lived service account token, stored as a Jenkins **Secret File** credential.

---

## 1. Build the Jenkins build agent image

The `kubectl` container in the Jenkins pod uses a custom image (`anskia/jenkins-build-agent`). Its Dockerfile is at `deploy/jenkins-agent/Dockerfile`.

### Prerequisites for building ARM64 images

```bash
# install QEMU binaries
docker run --privileged --rm tonistiigi/binfmt --install all
docker buildx create --name multiarch --platform linux/amd64,linux/arm64 --use
docker buildx build -f deploy/jenkins-agent/Dockerfile deploy/jenkins-agent/ \
  -t anskia/jenkins-build-agent:latest --platform linux/arm64 --load
docker push anskia/jenkins-build-agent:latest
```

---

## 2. Configure Docker Hub credentials

The Jenkinsfile pushes images to Docker Hub using a `Username/Password` credential.

1. Go to [Docker Hub > Account Settings > Security](https://hub.docker.com/settings/security)
2. Click **New Access Token**
3. Give it a description (e.g. `jenkins-bfstats`) and **Read/Write** permissions
4. Copy the token
5. In **Jenkins > Manage Jenkins > Credentials**, add a new **Username with password** credential:
   - **Username**: Your Docker Hub username
   - **Password**: The access token from step 4
   - **ID**: `jenkins-bf1942-stats-dockerhub-pat`
   - **Description**: `Docker Hub push for bfstats images`

---

## 3. Configure k3s kubeconfig

### Prerequisites

- `kubectl` configured to reach the k3s cluster (e.g. via the k3s admin kubeconfig)
- The `deployment-manager` Role already exists in the `bf42-stats` namespace (from `deploy/app/deployment-manager.yaml`)
- The `deployment-manager` Role already exists in the `bfstats-ui` namespace (from the UI repo's `deploy/app/deployment-manager.yaml`, applied separately)

### Create the ServiceAccount, token, and RoleBinding

```bash
kubectl apply -f deploy/k3s-jenkins-rbac.yaml
```

This creates:

| Resource | Name | Namespace |
|----------|------|-----------|
| ServiceAccount | `jenkins-deployer` | `bf42-stats` |
| Secret | `jenkins-deployer-token` | `bf42-stats` |
| RoleBinding | `jenkins-deployer-binding` | `bf42-stats` |
| RoleBinding | `jenkins-deployer-binding` | `bfstats-ui` |

The RoleBindings grant the ServiceAccount the permissions defined in the existing `deployment-manager` Role in both namespaces. The single kubeconfig works for deploying to both `bf42-stats` and `bfstats-ui` namespaces.

### Extract the token and CA certificate

```bash
# Service account token
TOKEN=$(kubectl -n bf42-stats get secret jenkins-deployer-token -o jsonpath='{.data.token}' | base64 -d)

# Cluster CA certificate (base64-encoded, for embedding in kubeconfig)
CA_DATA=$(kubectl -n bf42-stats get secret jenkins-deployer-token -o jsonpath='{.data.ca\.crt}')
```

### Build the kubeconfig file

Replace `<K3S_API_SERVER>` with your k3s API server URL (e.g. `https://your-server:6443`):

```bash
cat > jenkins-kubeconfig.yaml <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: k3s
    cluster:
      server: <K3S_API_SERVER>
      certificate-authority-data: ${CA_DATA}
contexts:
  - name: jenkins-deployer@k3s
    context:
      cluster: k3s
      namespace: bf42-stats
      user: jenkins-deployer
current-context: jenkins-deployer@k3s
users:
  - name: jenkins-deployer
    user:
      token: ${TOKEN}
EOF
```

### Test the kubeconfig locally

```bash
kubectl --kubeconfig=jenkins-kubeconfig.yaml -n bf42-stats get pods
kubectl --kubeconfig=jenkins-kubeconfig.yaml -n bfstats-ui get pods
```

You should see the pods in both namespaces. If this works, the kubeconfig is valid.

### Add the kubeconfig to Jenkins

1. Go to **Jenkins > Manage Jenkins > Credentials**
2. Add a new **Secret file** credential
3. Upload `jenkins-kubeconfig.yaml`
4. Set the ID to `bf42-stats-k3s-kubeconfig`

The Jenkinsfile references this credential ID in the deploy stages.

---

## 4. Configure Git HTTPS credentials

If your Jenkins pipeline clones this repository using an HTTPS URL, Jenkins needs a Git credential with access to the repo.

1. Go to **Jenkins > Manage Jenkins > Credentials**
2. Choose the appropriate store (typically **(global)** under the root domain)
3. Click **Add Credentials**
4. Set:
   - **Kind**: `Username with password`
   - **Username**: Your Git hosting username (for GitHub, your GitHub username)
   - **Password**: A Personal Access Token (PAT) with at least `repo` scope
   - **ID**: `bfstats-git-https`
   - **Description**: `bfstats GitHub HTTPS clone`
5. Save the credential

**Attach the credential to the pipeline job:**

- For a Multibranch Pipeline or Git-based Pipeline job:
  1. Edit the job configuration
  2. Under **Branch Sources > Git** (or the equivalent SCM section), set:
     - **Credentials**: Select `bfstats-git-https`
     - **Repository URL**: The HTTPS URL for this repo
  3. Save the job and trigger a build; the checkout step should now succeed.

---

## 5. Clean up old AKS credentials

Remove these Jenkins credentials (no longer needed):

| Credential ID | Reason |
|---------------|--------|
| `bf42-stats-aks-sp-client-id` | AKS service principal replaced by kubeconfig |
| `bf42-stats-aks-sp-client-secret` | AKS service principal replaced by kubeconfig |
| `bf42-stats-aks-sp-tenant-id` | AKS service principal replaced by kubeconfig |

---

## Jenkins credentials summary

| Credential ID | Type | Purpose |
|---------------|------|---------|
| `bf42-stats-k3s-kubeconfig` | Secret File | kubeconfig for k3s cluster (covers `bf42-stats` + `bfstats-ui` namespaces) |
| `bf42-stats-secrets-jwt-private-key` | Secret Text | JWT signing key |
| `bf42-stats-secrets-refresh-token-secret` | Secret Text | Refresh token secret |
| `jenkins-bf1942-stats-dockerhub-pat` | Username/Password | Docker Hub push |
| `bfstats-git-https` | Username/Password | Git HTTPS credential for cloning this repo |
| `bfstats-appi-connection-string` | Secret Text | Application Insights connection string (UI build) |
