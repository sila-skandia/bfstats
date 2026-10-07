#!/usr/bin/env bash
# The DC parity round's one asset pass: models, levels, per-tree json, effects,
# viewmodels, manifest, for vanilla, XPack1, XPack2, DesertCombat and DC_Final.
# Extraction only; publishing is a separate step after the results are checked.
set -u
TOOLS=$(git rev-parse --show-toplevel)/tools/bf1942-models
V=$TOOLS/viewer
SCRATCH=$HOME/.cache/dc-sweep/assets
INSTALL=$(git rev-parse --show-toplevel)/features/desert-combat-parity/sweep/install-models.py
export TMPDIR=$HOME/.cache/dc-sweep/tmp
mkdir -p "$SCRATCH" "$TMPDIR"
cd "$TOOLS"
FAILS=()

log() { echo "[$(date +%H:%M:%S)] $*"; }
guard() {
  local free; free=$(df --output=avail -BG "$HOME" | tail -1 | tr -dc 0-9)
  if (( free < 6 )); then log "ABORT: ${free}G free"; echo "${FAILS[@]:-}"; exit 2; fi
}
step() { # name, command...
  local name=$1; shift
  guard; log "START $name"
  if "$@" > "$SCRATCH/$name.log" 2>&1; then log "OK    $name"; else log "FAIL  $name (rc=$?)"; FAILS+=("$name"); fi
}

# tree: key mod models-dir maps-dir own-flag
TREES=(
  "vanilla bf1942 $V/models $V/maps"
  "xpack1 XPack1 $V/models/mods/xpack1 $V/maps/mods/xpack1 --own"
  "xpack2 XPack2 $V/models/mods/xpack2 $V/maps/mods/xpack2 --own"
  "desertcombat DesertCombat $V/models/mods/desertcombat $V/maps/mods/desertcombat --own"
  "dc_final DC_Final $V/models/mods/dc_final $V/maps/mods/dc_final --own"
)

# 1. Models: scratch extract, in-place install (keeps thumbs), optimise live.
for t in "${TREES[@]}"; do
  read -r key mod models maps own <<<"$t"
  out=$SCRATCH/models-$key
  rm -rf "$out"
  step "models-$key" python3 extract_all.py --mod "$mod" ${own:-} --level-all --configuration-all --cockpit \
       -j 8 --no-optimise --out "$out"
  if [[ -f $out/models.json ]]; then
    step "install-$key" python3 "$INSTALL" "$models" "$out"
    step "optimise-models-$key" python3 optimise_mesh.py -j 8 "$models"
  fi
  rm -rf "$out"
done

# 2. Levels: a full re-bake of every level each tree already has.
for t in "${TREES[@]}"; do
  read -r key mod models maps own <<<"$t"
  # Every level the tree already has (a mod's own and the inherited ones it
  # holds); an empty list would bake nothing, so check it.
  mapfile -t levels < <(find "$maps" -mindepth 2 -maxdepth 2 -name scene.json -printf '%h\n' \
                        | grep -v '/_shared$' | xargs -n1 basename | sort -u)
  log "levels-$key: ${#levels[@]}"
  (( ${#levels[@]} > 0 )) || { FAILS+=("levels-$key-empty"); continue; }
  step "levels-$key" python3 extract_maps_all.py --mod "$mod" --out "$maps" -j 8 --levels "${levels[@]}"
  # A re-bake replaces the level's folder, its effects.glb with it.
  step "effects-levels-$key" python3 extract_effects.py --mod "$mod" --levels --tree "$maps"
done

# 3. Per-tree json, effects, viewmodels.
for t in "${TREES[@]}"; do
  read -r key mod models maps own <<<"$t"
  step "collision-$key" python3 extract_collision_meshes.py --mod "$mod" --out "$maps/_shared"
  step "vehicle-ai-$key" python3 extract_vehicle_ai.py --mod "$mod" --out "$maps/_shared/vehicle-ai.json"
  step "effects-shared-$key" python3 extract_effects.py --mod "$mod" --out "$maps/_shared"
  step "effects-levels-$key" python3 extract_effects.py --mod "$mod" --levels --tree "$maps"
  if [[ -d $models/viewmodels ]]; then
    step "viewmodels-$key" python3 extract_viewmodel.py --mod "$mod" --kits "$models/kits.json" \
         --maps "$maps/maps.json" --out "$models/viewmodels"
    step "optimise-viewmodels-$key" python3 optimise_mesh.py -j 8 "$models/viewmodels"
  fi
done

# 4. The mods manifest last.
step "mods-manifest" python3 build_mods_manifest.py

log "DONE; failures: ${FAILS[*]:-none}"
