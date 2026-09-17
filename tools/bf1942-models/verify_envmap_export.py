#!/usr/bin/env python3
"""Verify that envmap flags are exported to glTF materials."""

import json
import struct
import sys
from pathlib import Path

def read_glb_materials(glb_path: Path) -> list[dict]:
    """Extract material definitions from a .glb file."""
    data = glb_path.read_bytes()
    
    # Read JSON chunk
    json_length, json_type = struct.unpack_from("<II", data, 12)
    if json_type != 0x4E4F534A:  # "JSON"
        raise ValueError("GLB does not start with a JSON chunk")
    
    json_data = data[20:20 + json_length].decode("utf-8")
    doc = json.loads(json_data)
    
    return doc.get("materials", [])

def main():
    if len(sys.argv) < 2:
        print("Usage: verify_envmap_export.py <path-to.glb>")
        sys.exit(1)
    
    glb_path = Path(sys.argv[1])
    if not glb_path.exists():
        print(f"ERROR: {glb_path} not found")
        sys.exit(1)
    
    materials = read_glb_materials(glb_path)
    
    envmap_count = 0
    envmap_materials = []
    
    for mat in materials:
        if mat.get("extras", {}).get("envmap"):
            envmap_count += 1
            envmap_materials.append(mat["name"])
    
    print(f"Total materials: {len(materials)}")
    print(f"Materials with envmap: {envmap_count}")
    
    if envmap_materials:
        print("\nMaterials with envmap flag:")
        for name in sorted(envmap_materials):
            print(f"  • {name}")
    
    return 0 if envmap_count > 0 else 1

if __name__ == "__main__":
    sys.exit(main())
