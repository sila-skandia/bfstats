#!/usr/bin/env bash
# Upload extracted BF1942 mesh/level glTF onto the assets volume (mesh/...).
#
# Defaults to tools/bf1942-models/viewer/{models,maps} — the local extract
# targets used by the model-viewer launch config.
#
# FileBrowser HTTP (local or a port-forward / Tailscale):
#   FILEBROWSER_URL=http://filebrowser-hetzner:80 ./scripts/upload-mesh-assets.sh
#
# Live cluster volume (FileBrowser pod if scaled up, otherwise the API pod):
#   ./scripts/upload-mesh-assets.sh --kubectl
#
# Upload only models or only maps:
#   ./scripts/upload-mesh-assets.sh --models
#   ./scripts/upload-mesh-assets.sh --maps --kubectl
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VIEWER="${VIEWER:-$ROOT/tools/bf1942-models/viewer}"
MODELS_DIR="${MODELS_DIR:-$VIEWER/models}"
MAPS_DIR="${MAPS_DIR:-$VIEWER/maps}"
FILEBROWSER_URL="${FILEBROWSER_URL:-http://127.0.0.1:18081}"
FILEBROWSER_USER="${FILEBROWSER_USER:-admin}"
FILEBROWSER_PASS="${FILEBROWSER_PASS:-admin}"
KUBE_CONTEXT="${KUBE_CONTEXT:-hetzner}"
KUBE_NS="${KUBE_NS:-bf42-stats}"

DO_MODELS=1
DO_MAPS=1
MODE=http

usage() {
  echo "Usage: $0 [--kubectl] [--models] [--maps]" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --kubectl) MODE=kubectl ;;
    --models) DO_MAPS=0 ;;
    --maps) DO_MODELS=0 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
  shift
done

if [[ "$DO_MODELS" -eq 1 && ! -d "$MODELS_DIR" ]]; then
  echo "No models at $MODELS_DIR. Run extract_models.py --out ./viewer/models first." >&2
  exit 1
fi
if [[ "$DO_MAPS" -eq 1 && ! -d "$MAPS_DIR" ]]; then
  echo "No maps at $MAPS_DIR. Run extract_map.py … --out ./viewer/maps first, or pass --models only." >&2
  exit 1
fi

strip_token() {
  local token="$1"
  token="${token#"${token%%[![:space:]]*}"}"
  token="${token%"${token##*[![:space:]]}"}"
  token="${token#\"}"
  token="${token%\"}"
  if [[ "$token" == \{*token* ]]; then
    token="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])' <<<"$token")"
  fi
  printf '%s' "$token"
}

upload_via_http() {
  local raw token
  raw="$(curl -sS -X POST "$FILEBROWSER_URL/api/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$FILEBROWSER_USER\",\"password\":\"$FILEBROWSER_PASS\"}")"
  token="$(strip_token "$raw")"

  if [[ -z "$token" || "$token" == *[Ii]nvalid* || "$token" == *error* ]]; then
    echo "FileBrowser login failed. Set FILEBROWSER_USER / FILEBROWSER_PASS." >&2
    exit 1
  fi

  create_dir() {
    curl -sS -o /dev/null -w "%{http_code}" -X POST \
      -H "X-Auth: $token" \
      -H "Authorization: Bearer $token" \
      "$FILEBROWSER_URL/api/resources/${1}?override=false" \
      || true
  }

  upload_file() {
    local src="$1" dest="$2" code
    code="$(curl -sS -o /tmp/fb-mesh-upload-body -w "%{http_code}" -X POST \
      -H "X-Auth: $token" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"$src" \
      "$FILEBROWSER_URL/api/resources/${dest}?override=true")"
    if [[ "$code" != "200" && "$code" != "201" ]]; then
      echo "upload failed ($code) $dest" >&2
      cat /tmp/fb-mesh-upload-body >&2 || true
      echo >&2
      exit 1
    fi
    echo "uploaded $dest"
  }

  upload_tree() {
    local src_root="$1" dest_prefix="$2" rel dest parent count=0
    create_dir "mesh/" >/dev/null
    create_dir "${dest_prefix}/" >/dev/null

    while IFS= read -r -d '' f; do
      rel="${f#"$src_root"/}"
      dest="${dest_prefix}/${rel}"
      parent="$(dirname "$dest")"
      local accum="" part
      IFS=/ read -ra parts <<<"$parent"
      for part in "${parts[@]}"; do
        [[ -z "$part" ]] && continue
        accum="${accum}${part}/"
        create_dir "$accum" >/dev/null
      done
      upload_file "$f" "$dest"
      count=$((count + 1))
    done < <(find "$src_root" -type f -print0 | sort -z)

    echo "Uploaded $count files under $dest_prefix/ to $FILEBROWSER_URL"
  }

  [[ "$DO_MODELS" -eq 1 ]] && upload_tree "$MODELS_DIR" "mesh/models"
  [[ "$DO_MAPS" -eq 1 ]] && upload_tree "$MAPS_DIR" "mesh/maps"
}

upload_via_kubectl() {
  local pod dest_root container archive
  pod="$(kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" get pods -l app=filebrowser \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "$pod" ]]; then
    dest_root="/mnt/assets/mesh"
    container="filebrowser"
  else
    pod="$(kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" get pods -l app=bf42-stats \
      -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    dest_root="/mnt/data/assets/mesh"
    container="$(kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" get pod "$pod" \
      -o jsonpath='{.spec.containers[0].name}' 2>/dev/null || echo "nginx")"
  fi

  if [[ -z "$pod" ]]; then
    echo "No FileBrowser or API pod in $KUBE_NS. Scale filebrowser or check the API." >&2
    exit 1
  fi

  kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" exec -c "$container" "$pod" -- mkdir -p "$dest_root"

  if [[ "$DO_MODELS" -eq 1 ]]; then
    archive="$(mktemp --suffix=.tar)"
    tar -C "$MODELS_DIR" -cf "$archive" .
    kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" exec -c "$container" "$pod" -- mkdir -p "$dest_root/models"
    kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" cp -c "$container" "$archive" "$pod:/tmp/mesh-models.tar"
    kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" exec -c "$container" "$pod" -- sh -c \
      "tar xf /tmp/mesh-models.tar -C '$dest_root/models' && rm -f /tmp/mesh-models.tar && chown -R 1000:1000 '$dest_root/models' && chmod -R a+rX '$dest_root/models' && find '$dest_root/models' -type f | wc -l"
    rm -f "$archive"
    echo "Copied models into $pod:$dest_root/models"
  fi
  if [[ "$DO_MAPS" -eq 1 ]]; then
    archive="$(mktemp --suffix=.tar)"
    tar -C "$MAPS_DIR" -cf "$archive" .
    kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" exec -c "$container" "$pod" -- mkdir -p "$dest_root/maps"
    kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" cp -c "$container" "$archive" "$pod:/tmp/mesh-maps.tar"
    kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" exec -c "$container" "$pod" -- sh -c \
      "tar xf /tmp/mesh-maps.tar -C '$dest_root/maps' && rm -f /tmp/mesh-maps.tar && chown -R 1000:1000 '$dest_root/maps' && chmod -R a+rX '$dest_root/maps' && find '$dest_root/maps' -type f | wc -l"
    rm -f "$archive"
    echo "Copied maps into $pod:$dest_root/maps"
  fi
}

case "$MODE" in
  kubectl) upload_via_kubectl ;;
  http) upload_via_http ;;
esac
