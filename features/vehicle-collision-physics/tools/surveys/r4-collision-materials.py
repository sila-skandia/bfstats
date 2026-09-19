#!/usr/bin/env python3
"""List collision-face/vertex material ids for given .sm files (vanilla bf1942)."""
import sys, collections
from pathlib import Path
sys.path.insert(0, str(Path("/home/dylan/projects/skandia/bfstats/tools/bf1942-models")))
from bf42.rfa import ArchivePool
from bf42 import stdmesh

MODS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"

def main():
    mod = sys.argv[1] if len(sys.argv) > 1 else "bf1942"
    names = sys.argv[2:]
    pool = ArchivePool()
    for rfa in sorted((MODS / mod / "Archives").rglob("*.rfa")):
        try:
            pool.add(rfa, rfa.name)
        except Exception:
            pass
    lookup = {n.lower(): n for n in pool.names()}
    for want in names:
        real = lookup.get(want.lower())
        if not real:
            print(f"{want}: NOT FOUND")
            continue
        data = pool.read(real)
        try:
            mesh = stdmesh.parse(data, real)
        except Exception as exc:
            print(f"{want}: parse error {exc}")
            continue
        print(f"=== {real} (version {mesh.version}, {len(mesh.collision_layers)} collision layers) ===")
        for li, layer in enumerate(mesh.collision_layers):
            mat_counts = collections.Counter(f.material_id for f in layer.faces)
            flag_counts = collections.Counter(f.flags for f in layer.faces)
            print(f"  layer {li}: {len(layer.vertices)} verts, {len(layer.faces)} faces, "
                  f"materials={dict(sorted(mat_counts.items()))}, flags={dict(sorted(flag_counts.items()))}")

if __name__ == "__main__":
    main()
