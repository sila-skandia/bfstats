pipeline {
  agent none
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
          // 1. Try to get changes from changeSets (standard Jenkins way for SCM-triggered builds)
          for (int i = 0; i < currentBuild.changeSets.size(); i++) {
              def entries = currentBuild.changeSets[i].items
              for (int j = 0; j < entries.length; j++) {
                  def entry = entries[j]
                  changedFiles.addAll(entry.affectedPaths)
              }
          }
          
          // 2. Fallback to git diff if changeSets is empty (e.g. manual build or logic gap)
          if (!changedFiles) {
              echo "No changes detected via changeSets. Falling back to git diff."
              try {
                  def prevCommit = env.GIT_PREVIOUS_SUCCESSFUL_COMMIT ?: sh(script: 'git rev-parse HEAD~1', returnStdout: true).trim()
                  def changes = sh(script: "git diff --name-only ${prevCommit}..HEAD", returnStdout: true).trim()
                  changedFiles = changes ? changes.split('\n').toList() : []
              } catch (Exception e) {
                  echo "Error during git diff fallback: ${e.message}"
              }
          }

          if (changedFiles) {
              echo "Detected changed files: ${changedFiles.unique().join(', ')}"
          } else {
              echo "No changed files detected."
          }

          env.API_CHANGED = changedFiles.any { it.startsWith('api/') } ? 'true' : 'false'
          env.UI_CHANGED = changedFiles.any { it.startsWith('ui/') } ? 'true' : 'false'
          env.NOTIFICATIONS_CHANGED = changedFiles.any { it.startsWith('notifications/') } ? 'true' : 'false'
          
          echo "API_CHANGED=${env.API_CHANGED}, UI_CHANGED=${env.UI_CHANGED}, NOTIFICATIONS_CHANGED=${env.NOTIFICATIONS_CHANGED}"
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
                      kubectl -n bf42-stats rollout restart deployment/bf42-stats
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
                    usernamePassword(credentialsId: 'jenkins-bf1942-stats-dockerhub-pat', usernameVariable: 'DOCKER_USERNAME', passwordVariable: 'DOCKER_PASSWORD'),
                    string(credentialsId: 'bfstats-appi-connection-string', variable: 'APPINSIGHTS_CONNECTION_STRING')
                  ]) {
                    sh '''
                      # Login to Docker Hub
                      echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin

                      # Setup Docker buildx for cross-platform builds with DinD optimizations
                      docker buildx create --name multiarch-builder-ui --driver docker-container --use || true
                      docker buildx use multiarch-builder-ui

                      # Build and push ARM64 image for UI
                      # Pass Application Insights connection string as build arg
                      DOCKER_BUILDKIT=1 docker buildx build -f ui/Dockerfile ui/ \
                        --platform linux/arm64 \
                        --build-arg BUILDKIT_PROGRESS=plain \
                        --build-arg VITE_APPLICATIONINSIGHTS_CONNECTION_STRING="${APPINSIGHTS_CONNECTION_STRING}" \
                        --push \
                        -t anskia/bfstats-ui:latest
                    '''
                  }
                }
              }
            }
            stage('Deploy UI') {
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
                      kubectl -n bfstats-ui rollout restart deployment/bfstats-ui
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
