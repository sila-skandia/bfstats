pipeline {
  agent none
  options {
    // Recreate of bf42-stats takes the only API replica down. Two builds
    // restarting at once flip ReplicaSets and page Seq with connection refused.
    disableConcurrentBuilds()
  }
  parameters {
    booleanParam(name: 'BUILD_ALL', defaultValue: false, description: 'Build and deploy all services, ignoring changeset detection')
  }
  triggers {
    githubPush()
    pollSCM('H/5 * * * *')
  }
  stages {
    stage('Detect Changes') {
      agent {
        kubernetes {
          cloud 'Local k8s'
          yamlFile 'deploy/pod.yaml'
          nodeSelector 'kubernetes.io/hostname=bethany'
        }
      }
      steps {
        script {
          checkout scm
          
          def changedFiles = []
          for (int i = 0; i < currentBuild.changeSets.size(); i++) {
              def entries = currentBuild.changeSets[i].items
              for (int j = 0; j < entries.length; j++) {
                  def entry = entries[j]
                  changedFiles.addAll(entry.affectedPaths)
              }
          }

          // Do not diff against GIT_PREVIOUS_SUCCESSFUL_COMMIT. A timed-out
          // Recreate leaves that pointer stale, so pollSCM would rebuild api/
          // every 5 minutes and bounce the live replica.
          if (!changedFiles && params.BUILD_ALL) {
              echo "BUILD_ALL set with empty changeSets; deploying all services."
          } else if (!changedFiles) {
              echo "No SCM changeSets and BUILD_ALL is false; skipping builds."
          } else {
              echo "Detected changed files: ${changedFiles.unique().join(', ')}"
          }

          if (params.BUILD_ALL) {
              env.API_CHANGED = 'true'
              env.UI_CHANGED = 'true'
              env.NOTIFICATIONS_CHANGED = 'true'
              env.MESH_CHANGED = 'true'
          } else {
              env.API_CHANGED = changedFiles.any { it.startsWith('api/') } ? 'true' : 'false'
              env.UI_CHANGED = changedFiles.any { it.startsWith('ui/') } ? 'true' : 'false'
              env.NOTIFICATIONS_CHANGED = changedFiles.any { it.startsWith('notifications/') } ? 'true' : 'false'
              env.MESH_CHANGED = changedFiles.any {
                  it.startsWith('mesh/') || it.startsWith('tools/bf1942-models/viewer/')
              } ? 'true' : 'false'
          }
          
          echo "API_CHANGED=${env.API_CHANGED}, UI_CHANGED=${env.UI_CHANGED}, NOTIFICATIONS_CHANGED=${env.NOTIFICATIONS_CHANGED}, MESH_CHANGED=${env.MESH_CHANGED}"
        }
      }
    }
    stage('Build and Deploy') {
      parallel {
        stage('API Pipeline') {
          when { anyOf { expression { env.API_CHANGED == 'true' }; expression { params.BUILD_ALL } } }
          stages {
            stage('Build API Docker Image') {
              agent {
                kubernetes {
                  cloud 'Local k8s'
                  yamlFile 'deploy/pod.yaml'
                  nodeSelector 'kubernetes.io/hostname=bethany'
                }
              }
              steps {
                container('dind') {
                  withCredentials([usernamePassword(credentialsId: 'jenkins-bf1942-stats-dockerhub-pat', usernameVariable: 'DOCKER_USERNAME', passwordVariable: 'DOCKER_PASSWORD')]) {
                    sh '''
                      # Login to Docker Hub
                      echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin

                      # Setup Docker buildx for cross-platform builds with DinD optimizations
                      docker buildx create --name multiarch-builder --driver docker-container --use || true
                      docker buildx use multiarch-builder

                      # Build and push ARM64 image for API (cross-compiled natively on amd64)
                      DOCKER_BUILDKIT=1 docker buildx build -f deploy/Dockerfile . \
                        --platform linux/arm64 \
                        --build-arg PROJECT_PATH=api \
                        --build-arg PROJECT_NAME=api \
                        --build-arg BUILDKIT_PROGRESS=plain \
                        --push \
                        -t anskia/bfstats-api:latest
                    '''
                  }
                }
              }
            }
            stage('Deploy API') {
              agent {
                kubernetes {
                  cloud 'Local k8s'
                  yamlFile 'deploy/pod.yaml'
                  nodeSelector 'kubernetes.io/hostname=bethany'
                }
              }
              steps {
                container('kubectl') {
                  withCredentials([
                    file(credentialsId: 'bf42-stats-k3s-kubeconfig', variable: 'KUBECONFIG_FILE'),
                    string(credentialsId: 'bf42-stats-secrets-jwt-private-key', variable: 'JWT_PRIVATE_KEY'),
                    string(credentialsId: 'bf42-stats-secrets-refresh-token-secret', variable: 'REFRESH_TOKEN_SECRET')
                  ]) {
                    sh '''
                      set -euo pipefail
                      export KUBECONFIG="$KUBECONFIG_FILE"
                      TMPDIR=$(mktemp -d)
                      trap 'rm -rf "$TMPDIR"' EXIT
                      printf "%s" "$JWT_PRIVATE_KEY" > "$TMPDIR/jwt-private.pem"
                      kubectl -n bf42-stats create secret generic bf42-stats-secrets \
                        --from-file=jwt-private-key="$TMPDIR/jwt-private.pem" \
                        --from-literal=refresh-token-secret="$REFRESH_TOKEN_SECRET" \
                        --dry-run=client -o yaml | kubectl apply -f -
                      # Recreate + imagePullPolicy Always can exceed 120s (Docker Hub
                      # pull + process start). A second restart during that window
                      # flips ReplicaSets. Wait out any in-flight rollout first.
                      kubectl -n bf42-stats rollout status deployment/bf42-stats --timeout=300s || true
                      kubectl -n bf42-stats rollout restart deployment/bf42-stats
                      kubectl -n bf42-stats rollout status deployment/bf42-stats --timeout=300s
                    '''
                  }
                }
              }
            }
          }
        }
        stage('Notifications Pipeline') {
          when { anyOf { expression { env.NOTIFICATIONS_CHANGED == 'true' }; expression { params.BUILD_ALL } } }
          stages {
            stage('Build Notifications Docker Image') {
              agent {
                kubernetes {
                  cloud 'Local k8s'
                  yamlFile 'deploy/pod.yaml'
                  nodeSelector 'kubernetes.io/hostname=bethany'
                }
              }
              steps {
                container('dind') {
                  withCredentials([usernamePassword(credentialsId: 'jenkins-bf1942-stats-dockerhub-pat', usernameVariable: 'DOCKER_USERNAME', passwordVariable: 'DOCKER_PASSWORD')]) {
                    sh '''
                      # Login to Docker Hub
                      echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin

                      # Setup Docker buildx for cross-platform builds with DinD optimizations
                      docker buildx create --name multiarch-builder-notif --driver docker-container --use || true
                      docker buildx use multiarch-builder-notif

                      # Build and push ARM64 image for Notifications (cross-compiled natively on amd64)
                      DOCKER_BUILDKIT=1 docker buildx build -f deploy/Dockerfile . \
                        --platform linux/arm64 \
                        --build-arg PROJECT_PATH=notifications \
                        --build-arg PROJECT_NAME=notifications \
                        --build-arg BUILDKIT_PROGRESS=plain \
                        --push \
                        -t anskia/bfstats-notifications:latest
                    '''
                  }
                }
              }
            }
            stage('Deploy Notifications') {
              agent {
                kubernetes {
                  cloud 'Local k8s'
                  yamlFile 'deploy/pod.yaml'
                  nodeSelector 'kubernetes.io/hostname=bethany'
                }
              }
              steps {
                container('kubectl') {
                  withCredentials([
                    file(credentialsId: 'bf42-stats-k3s-kubeconfig', variable: 'KUBECONFIG_FILE')
                  ]) {
                    sh '''
                      set -euo pipefail
                      export KUBECONFIG="$KUBECONFIG_FILE"
                      kubectl -n bf42-stats rollout restart deployment/bf42-notifications
                    '''
                  }
                }
              }
            }
          }
        }
        stage('UI Pipeline') {
          when { anyOf { expression { env.UI_CHANGED == 'true' }; expression { params.BUILD_ALL } } }
          stages {
            stage('Build UI Docker Image') {
              agent {
                kubernetes {
                  cloud 'Local k8s'
                  yamlFile 'deploy/pod.yaml'
                  nodeSelector 'kubernetes.io/hostname=bethany'
                }
              }
              steps {
                container('dind') {
                  withCredentials([
                    usernamePassword(credentialsId: 'jenkins-bf1942-stats-dockerhub-pat', usernameVariable: 'DOCKER_USERNAME', passwordVariable: 'DOCKER_PASSWORD')
                  ]) {
                    sh '''
                      # Login to Docker Hub
                      echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin

                      # Setup Docker buildx for cross-platform builds with DinD optimizations
                      docker buildx create --name multiarch-builder-ui --driver docker-container --use || true
                      docker buildx use multiarch-builder-ui

                      # Build and push ARM64 image for UI
                      DOCKER_BUILDKIT=1 docker buildx build -f ui/Dockerfile ui/ \
                        --platform linux/arm64 \
                        --build-arg BUILDKIT_PROGRESS=plain \
                        --build-arg VITE_DISCORD_CLIENT_ID="1410567423119196251" \
                        --cache-from type=registry,ref=anskia/bfstats-ui:buildcache \
                        --cache-to type=registry,ref=anskia/bfstats-ui:buildcache,mode=max \
                        --push \
                        -t anskia/bfstats-ui:latest
                    '''
                  }
                }
              }
            }
            stage('Deploy UI') {
              options {
                skipDefaultCheckout(true)
              }
              agent {
                kubernetes {
                  cloud 'Local k8s'
                  yamlFile 'deploy/pod.yaml'
                  nodeSelector 'kubernetes.io/hostname=bethany'
                }
              }
              steps {
                container('kubectl') {
                  withCredentials([
                    file(credentialsId: 'bf42-stats-k3s-kubeconfig', variable: 'KUBECONFIG_FILE'),
                    string(credentialsId: 'bfstats-cloudflare-api-token', variable: 'CF_API_TOKEN'),
                    string(credentialsId: 'bfstats-cloudflare-zone-id', variable: 'CF_ZONE_ID')
                  ]) {
                    sh '''
                      set -euo pipefail
                      export KUBECONFIG="$KUBECONFIG_FILE"
                      kubectl -n bfstats-ui rollout restart deployment/bfstats-ui
                      kubectl -n bfstats-ui rollout status deployment/bfstats-ui --timeout=120s

                      echo "Purging Cloudflare cache for bfstats.io..."
                      if command -v curl >/dev/null 2>&1; then
                        curl -s -f -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
                          -H "Authorization: Bearer ${CF_API_TOKEN}" \
                          -H "Content-Type: application/json" \
                          --data '{"purge_everything":true}'
                      else
                        wget -qO- \
                          --header="Authorization: Bearer ${CF_API_TOKEN}" \
                          --header="Content-Type: application/json" \
                          --post-data='{"purge_everything":true}' \
                          "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache"
                      fi
                      echo "Cloudflare cache purged successfully."

                      echo "Warming Cloudflare edge cache for critical landing page & API..."
                      if command -v curl >/dev/null 2>&1; then
                        HTML=$(curl -s https://bfstats.io/ || true)
                        if [ -n "$HTML" ]; then
                          ASSETS=$(echo "$HTML" | grep -oE '/assets/[^" >]+' | sort -u)
                          for asset in $ASSETS; do
                            curl -s -o /dev/null "https://bfstats.io${asset}" &
                          done
                        fi
                        curl -s -o /dev/null "https://bfstats.io/stats/liveservers/bf1942/servers" &
                        wait
                      else
                        HTML=$(wget -qO- https://bfstats.io/ || true)
                        if [ -n "$HTML" ]; then
                          ASSETS=$(echo "$HTML" | grep -oE '/assets/[^" >]+' | sort -u)
                          for asset in $ASSETS; do
                            wget -qO- "https://bfstats.io${asset}" >/dev/null 2>&1 &
                          done
                        fi
                        wget -qO- "https://bfstats.io/stats/liveservers/bf1942/servers" >/dev/null 2>&1 &
                        wait
                      fi
                      echo "Edge cache warming complete."
                    '''
                  }
                }
              }
            }
          }
        }
        stage('Mesh Pipeline') {
          when { anyOf { expression { env.MESH_CHANGED == 'true' }; expression { params.BUILD_ALL } } }
          stages {
            stage('Build Mesh Docker Image') {
              agent {
                kubernetes {
                  cloud 'Local k8s'
                  yamlFile 'deploy/pod.yaml'
                  nodeSelector 'kubernetes.io/hostname=bethany'
                }
              }
              steps {
                container('dind') {
                  withCredentials([
                    usernamePassword(credentialsId: 'jenkins-bf1942-stats-dockerhub-pat', usernameVariable: 'DOCKER_USERNAME', passwordVariable: 'DOCKER_PASSWORD')
                  ]) {
                    sh '''
                      echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin

                      docker buildx create --name multiarch-builder-mesh --driver docker-container --use || true
                      docker buildx use multiarch-builder-mesh

                      DOCKER_BUILDKIT=1 docker buildx build -f mesh/Dockerfile . \
                        --platform linux/arm64 \
                        --build-arg BUILDKIT_PROGRESS=plain \
                        --cache-from type=registry,ref=anskia/bfstats-mesh:buildcache \
                        --cache-to type=registry,ref=anskia/bfstats-mesh:buildcache,mode=max \
                        --push \
                        -t anskia/bfstats-mesh:latest
                    '''
                  }
                }
              }
            }
            stage('Deploy Mesh') {
              agent {
                kubernetes {
                  cloud 'Local k8s'
                  yamlFile 'deploy/pod.yaml'
                  nodeSelector 'kubernetes.io/hostname=bethany'
                }
              }
              steps {
                container('kubectl') {
                  withCredentials([
                    file(credentialsId: 'bf42-stats-k3s-kubeconfig', variable: 'KUBECONFIG_FILE'),
                    string(credentialsId: 'bfstats-cloudflare-api-token', variable: 'CF_API_TOKEN'),
                    string(credentialsId: 'bfstats-cloudflare-zone-id', variable: 'CF_ZONE_ID')
                  ]) {
                    sh '''
                      set -euo pipefail
                      export KUBECONFIG="$KUBECONFIG_FILE"
                      kubectl -n bf42-stats apply -f deploy/app/mesh-deployment.yaml
                      kubectl -n bf42-stats rollout restart deployment/bfstats-mesh
                      kubectl -n bf42-stats rollout status deployment/bfstats-mesh --timeout=120s

                      # The UI stage purges the whole zone, but it only runs when ui/
                      # changed. Without this, a mesh-only build leaves the edge serving
                      # the previous viewer — /vendor/ for up to seven days. Scoped to
                      # the one host so a mesh deploy does not cold-start bfstats.io.
                      echo "Purging Cloudflare cache for mesh.bfstats.io..."
                      if command -v curl >/dev/null 2>&1; then
                        curl -s -f -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
                          -H "Authorization: Bearer ${CF_API_TOKEN}" \
                          -H "Content-Type: application/json" \
                          --data '{"hosts":["mesh.bfstats.io"]}'
                      else
                        wget -qO- \
                          --header="Authorization: Bearer ${CF_API_TOKEN}" \
                          --header="Content-Type: application/json" \
                          --post-data='{"hosts":["mesh.bfstats.io"]}' \
                          "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache"
                      fi
                      echo "Cloudflare cache purged for mesh.bfstats.io."
                    '''
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
