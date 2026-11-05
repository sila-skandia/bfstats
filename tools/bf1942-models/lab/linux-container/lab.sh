#!/usr/bin/env bash
# lab.py's Linux server on a Mac: runs `lab.py <args>` in the bf1942-lab
# container, in a Colima VM of its own. lab.py execs this itself for setup,
# start, status and stop when it runs on macOS; nothing else needs to call it.
#
# bf1942_lnxded is a 32-bit x86 Linux program, and the VM is a whole emulated
# x86_64 machine (QEMU, `--arch x86_64`). An arm64 VM runs the server too,
# through QEMU's user-mode qemu-i386 (Rosetta for Linux translates only
# 64-bit x86), but there /proc/self/mem cannot read the server's memory, and
# the server recorder reads and patches the server's code through it: every
# detour is skipped. Under full emulation the kernel is x86 and it works.
# The VM is its own Colima profile because the lab's ports are UDP and
# Colima's default port forwarder (ssh) carries only TCP; this profile uses
# the grpc one. A profile of its own also leaves the default VM alone.
#
# Paths keep their host names in the container (the repo, ~/bf1942-lab, the
# CrossOver game folder), so the absolute links lab.py makes resolve on both
# sides and the join line names the host's client launcher.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lab_dir="$(cd "$here/.." && pwd)"                 # tools/bf1942-models/lab
models="$(cd "$lab_dir/.." && pwd)"               # tools/bf1942-models
repo="$(cd "$models/../.." && pwd)"
profile="${BF42_COLIMA_PROFILE:-bf1942-lab-x86}"
context="colima-$profile"
container="${BF42_LAB_CONTAINER:-bf1942-lab-linux}"
image="bf1942-lab-linux"
lab="${BF42_LAB:-$HOME/bf1942-lab}"
src="${BF42_SERVER_SRC:-$lab/linux-src}"
bottle="${BF42_CX_BOTTLE:-BF1942}"
game="${BF42_GAME_DIR:-$HOME/Library/Application Support/CrossOver/Bottles/$bottle/drive_c/EA Games/Battlefield 1942}"
offset="${BF42_LAB_PORT_OFFSET:-0}"
# The server names each event log for the local minute, and lab.py pairs logs
# with client recordings by time, so the container keeps the host's zone.
tz="$(readlink /etc/localtime | sed 's#.*/zoneinfo/##')"

if ! command -v colima >/dev/null || ! command -v docker >/dev/null || ! command -v qemu-img >/dev/null; then
  echo "lab.sh: the Linux lab needs colima, docker and qemu" \
       "(brew install colima docker qemu lima-additional-guestagents)" >&2
  exit 1
fi
if [ ! -f "$src/bf1942_lnxded.static" ]; then
  echo "lab.sh: no Linux server at $src; see lab/INSTALL.md, \"On a Mac\"" >&2
  exit 1
fi

docker_() { docker --context "$context" "$@"; }

# 1. The VM. `colima start` makes its profile the docker CLI's current
#    context; whatever was current before is put back. Booting an emulated
#    x86_64 machine takes a minute or two.
if ! colima status -p "$profile" >/dev/null 2>&1; then
  current="$(docker context show 2>/dev/null || true)"
  echo "lab.sh: starting the $profile VM (x86_64, emulated)" >&2
  colima start -p "$profile" --arch x86_64 --vm-type qemu --cpu 4 --memory 4 --disk 30 \
    --mount-type 9p --port-forwarder grpc >&2
  if [ -n "$current" ]; then docker context use "$current" >/dev/null; fi
fi
if ! colima status -p "$profile" --json 2>/dev/null | grep -q '"arch": *"x86_64"'; then
  echo "lab.sh: the $profile VM is not x86_64, so the server recorder cannot work in it;" \
       "delete it (colima delete -p $profile) and run this again" >&2
  exit 1
fi

# 2. The image, built again when its Dockerfile changes.
want="$(shasum -a 256 "$here/Dockerfile" | cut -c1-16)"
have="$(docker_ image inspect -f '{{index .Config.Labels "bf1942-lab.dockerfile"}}' "$image" 2>/dev/null || true)"
if [ "$want" != "$have" ]; then
  echo "lab.sh: building $image (a few minutes: the VM emulates i386)" >&2
  docker_ build --platform linux/386 --label "bf1942-lab.dockerfile=$want" -t "$image" "$here" >&2
fi

# 3. The container, made again when the image or what it mounts changes,
#    but never while a lab server runs in it.
config="$(printf '%s\n' "$want" "$repo" "$lab" "$src" "$game" "$offset" "$tz" | shasum -a 256 | cut -c1-16)"
running="$(docker_ inspect -f '{{index .Config.Labels "bf1942-lab.config"}}' "$container" 2>/dev/null || true)"
if [ "$running" != "$config" ]; then
  if [ -n "$running" ]; then
    if docker_ exec "$container" pgrep -f bf1942_lnxded >/dev/null 2>&1; then
      echo "lab.sh: the container's settings changed, but a lab server runs in it; stop it first" >&2
      exit 1
    fi
    docker_ rm -f "$container" >/dev/null
  fi
  mkdir -p "$lab"
  mounts=(-v "$repo:$repo" -v "$lab:$lab")
  if [ -d "$game" ]; then mounts+=(-v "$game:$game:ro"); fi
  ports=()
  for port in 14568 22001 23001 14724; do
    p=$((port + offset))
    ports+=(-p "$p:$p/udp")
  done
  docker_ run -d --name "$container" --platform linux/386 --label "bf1942-lab.config=$config" \
    "${mounts[@]}" "${ports[@]}" \
    -e "HOME=$HOME" -e "TZ=$tz" -e "BF42_LAB=$lab" -e "BF42_SERVER_SRC=$src" \
    -e "BF42_GAME_DIR=$game" -e "BF42_MONITOR=$lab_dir/mac/bf1942-client.sh" \
    -e "BF42_LAB_PORT_OFFSET=$offset" -e BF42_VIEWER_URL \
    "$image" >/dev/null
elif [ "$(docker_ inspect -f '{{.State.Running}}' "$container")" != "true" ]; then
  docker_ start "$container" >/dev/null
fi

exec docker --context "$context" exec -i -w "$models" "$container" python3 lab/lab.py "$@"
