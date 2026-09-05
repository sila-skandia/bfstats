#!/usr/bin/env bash
# Upload extracted spawn maps onto the assets volume (arcade/maps/...).
#
# FileBrowser HTTP (local or a port-forward):
#   FILEBROWSER_URL=http://127.0.0.1:18081 ./scripts/upload-arcade-map-art.sh
#
# Live cluster volume (FileBrowser pod if scaled up, otherwise the API pod):
#   ./scripts/upload-arcade-map-art.sh --kubectl
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAPS_DIR="${MAPS_DIR:-$ROOT/api/assets/arcade/maps}"
FILEBROWSER_URL="${FILEBROWSER_URL:-http://127.0.0.1:18081}"
FILEBROWSER_USER="${FILEBROWSER_USER:-admin}"
FILEBROWSER_PASS="${FILEBROWSER_PASS:-admin}"
KUBE_CONTEXT="${KUBE_CONTEXT:-hetzner}"
KUBE_NS="${KUBE_NS:-bf42-stats}"

if [[ ! -d "$MAPS_DIR" ]]; then
  echo "No extracted maps at $MAPS_DIR. Run scripts/extract-bf1942-map-art.py first." >&2
  exit 1
fi

map_count="$(find "$MAPS_DIR" -mindepth 2 -name 'ingame.webp' | wc -l)"
if [[ "$map_count" -eq 0 ]]; then
  echo "No ingame.webp files under $MAPS_DIR." >&2
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
  local raw token dest slug webp code
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

  echo "Creating arcade/maps ..."
  create_dir "arcade/" >/dev/null
  create_dir "arcade/maps/" >/dev/null

  local count=0
  while IFS= read -r webp; do
    slug="$(basename "$(dirname "$webp")")"
    dest="arcade/maps/${slug}/ingame.webp"
    create_dir "arcade/maps/${slug}/" >/dev/null
    code="$(curl -sS -o /tmp/fb-upload-body -w "%{http_code}" -X POST \
      -H "X-Auth: $token" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"$webp" \
      "$FILEBROWSER_URL/api/resources/${dest}?override=true")"
    if [[ "$code" != "200" && "$code" != "201" ]]; then
      echo "upload failed ($code) $dest" >&2
      cat /tmp/fb-upload-body >&2 || true
      echo >&2
      exit 1
    fi
    count=$((count + 1))
    echo "uploaded $dest"
  done < <(find "$MAPS_DIR" -mindepth 2 -name 'ingame.webp' | sort)

  echo "Uploaded $count maps to $FILEBROWSER_URL"
}

upload_via_kubectl() {
  local pod dest_root container
  pod="$(kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" get pods -l app=filebrowser \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "$pod" ]]; then
    dest_root="/mnt/assets/arcade"
    container="filebrowser"
  else
    pod="$(kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" get pods -l app=bf42-stats \
      -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    dest_root="/mnt/data/assets/arcade"
    container="nginx"
  fi

  if [[ -z "$pod" ]]; then
    echo "No FileBrowser or API pod in $KUBE_NS. Scale filebrowser or check the API." >&2
    exit 1
  fi

  local archive
  archive="$(mktemp --suffix=.tar)"
  tar -C "$MAPS_DIR/.." -cf "$archive" maps
  kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" exec -c "$container" "$pod" -- mkdir -p "$dest_root"
  kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" cp -c "$container" "$archive" "$pod:/tmp/arcade-maps.tar"
  kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" exec -c "$container" "$pod" -- sh -c \
    "tar xf /tmp/arcade-maps.tar -C '$dest_root' && rm -f /tmp/arcade-maps.tar && chown -R 1000:1000 '$dest_root' && chmod -R a+rX '$dest_root' && find '$dest_root/maps' -name ingame.webp | wc -l"
  rm -f "$archive"
  echo "Copied $map_count maps into $pod:$dest_root/maps"
}

case "${1:-}" in
  --kubectl) upload_via_kubectl ;;
  "") upload_via_http ;;
  *)
    echo "Usage: $0 [--kubectl]" >&2
    exit 1
    ;;
esac
