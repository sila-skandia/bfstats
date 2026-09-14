#!/usr/bin/env bash
# Upload a mod's extracted level tree to the assets PVC, one level at a time.
#
#   ./scripts/upload-mesh-maps-resumable.sh <local-levels-dir> <remote-subpath>
#   ./scripts/upload-mesh-maps-resumable.sh ~/.cache/mesh-upload-maps/mods/eod mods/eod
#
# `upload-mesh-assets.sh --kubectl` tars the whole tree, `kubectl cp`s the
# tarball into the pod and unpacks it there. That is right for the ~190MB
# vanilla tree and wrong for a mod: EoD's 239 levels are 16GB across 36,609
# files, and at the ~1.6MB/s this link sustains that is a single two-and-a-half
# hour stream with no resume. One dropped connection costs the whole transfer.
# `kubectl cp` also mis-handles a source file that is itself a tar — it unpacks
# the archive into the destination directory instead of copying it, leaving the
# script's own `tar xf` step pointed at a zero-byte file.
#
# So: one `tar | kubectl exec` per level directory, skipped when the remote file
# count already matches. A level is small enough to redo, the remote counts are
# read in a single exec rather than 239, and re-running after any failure
# resumes where it stopped.
#
# Level directories are self-contained (scene.glb, scene.json, lightmaps/,
# sounds/), so per-level is a safe unit — nothing spans two of them. The
# manifest `maps.json` is uploaded last, on purpose: it is what makes a level
# visible to the viewer, so publishing it before the scenes it names would
# advertise levels that 404.
set -uo pipefail

LOCAL_DIR="${1:?usage: $0 <local-levels-dir> <remote-subpath>}"
REMOTE_SUB="${2:?usage: $0 <local-levels-dir> <remote-subpath>}"

KUBE_CONTEXT="${KUBE_CONTEXT:-hetzner}"
KUBE_NS="${KUBE_NS:-bf42-stats}"
REMOTE_ROOT="${REMOTE_ROOT:-/mnt/assets/mesh/maps}"
DEST="$REMOTE_ROOT/$REMOTE_SUB"

POD="$(kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" get pods -l app=filebrowser \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -z "$POD" ]]; then
  echo "No FileBrowser pod in $KUBE_NS." >&2
  exit 1
fi

kex() { kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" exec -c filebrowser "$POD" -- "$@"; }
kex_i() { kubectl --context "$KUBE_CONTEXT" -n "$KUBE_NS" exec -i -c filebrowser "$POD" -- "$@"; }

kex mkdir -p "$DEST" >/dev/null

# Every remote per-level count in one round-trip, rather than one exec per level.
declare -A REMOTE
while read -r count name; do
  [[ -n "${name:-}" ]] && REMOTE["$name"]="$count"
done < <(kex sh -c "cd '$DEST' 2>/dev/null && for d in */; do [ -d \"\$d\" ] && echo \"\$(find \"\$d\" -type f | wc -l) \${d%/}\"; done" 2>/dev/null)

levels=()
while IFS= read -r d; do levels+=("$(basename "$d")"); done \
  < <(find "$LOCAL_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

total=${#levels[@]}
echo "$total levels -> $POD:$DEST"

done_n=0; sent=0; skipped=0; failed=()
for level in "${levels[@]}"; do
  done_n=$((done_n + 1))
  local_count=$(find "$LOCAL_DIR/$level" -type f | wc -l)
  remote_count="${REMOTE[$level]:-0}"
  if [[ "$remote_count" -eq "$local_count" && "$local_count" -gt 0 ]]; then
    skipped=$((skipped + 1))
    continue
  fi
  size=$(du -sm "$LOCAL_DIR/$level" | cut -f1)
  printf '[%d/%d] %s (%s MB, %s files)' "$done_n" "$total" "$level" "$size" "$local_count"
  if tar -C "$LOCAL_DIR" -cf - "$level" | kex_i tar xf - -C "$DEST"; then
    # Level and destination go to the remote shell as positional arguments,
    # never interpolated into its quoting. 239 EoD level names include
    # `charlie_don't_surf` and `charly's_nest`, whose apostrophe closes a
    # single-quoted remote string and makes `find` return nothing — reported as
    # a mismatch against a file count that had in fact landed correctly.
    got=$(kex sh -c 'find "$1" -type f | wc -l' sh "$DEST/$level" 2>/dev/null | tr -d '\r')
    if [[ "$got" -eq "$local_count" ]]; then
      sent=$((sent + 1)); echo " ok"
    else
      failed+=("$level"); echo " MISMATCH: $got of $local_count landed"
    fi
  else
    failed+=("$level"); echo " FAILED"
  fi
done

# Manifest last: it is what advertises the levels, so it must not precede them.
for manifest in "$LOCAL_DIR"/*.json; do
  [[ -f "$manifest" ]] || continue
  tar -C "$LOCAL_DIR" -cf - "$(basename "$manifest")" | kex_i tar xf - -C "$DEST" \
    && echo "manifest $(basename "$manifest") uploaded"
done

# Best-effort, then verified: FileBrowser runs as uid 1000 and cannot chown a
# root-owned directory even when the mode is already correct, so the check is
# what the run is judged on. The mesh pod serves this read-only as the
# unprivileged nginx user, so world-readable is what stops a 403.
kex sh -c "chown -R 1000:1000 '$DEST' 2>/dev/null || true; chmod -R a+rX '$DEST' 2>/dev/null || true" >/dev/null
bad=$(kex sh -c "find '$DEST' \\( -type f ! -perm -o=r \\) -o \\( -type d ! -perm -o=rx \\) 2>/dev/null | head -5")
[[ -n "$bad" ]] && { echo "unreadable to nginx, would 403:"; echo "$bad"; }

echo
echo "sent $sent, skipped $skipped (already complete), failed ${#failed[@]} of $total"
if ((${#failed[@]})); then
  printf '  %s\n' "${failed[@]}"
  echo "re-run to retry just these."
  exit 1
fi
remote_total=$(kex sh -c "find '$DEST' -type f | wc -l" | tr -d '\r')
echo "remote file count: $remote_total  (local: $(find "$LOCAL_DIR" -type f | wc -l))"
