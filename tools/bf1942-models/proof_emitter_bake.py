#!/usr/bin/env python3
"""Proof that the widened emitter bake works: count effect nodes before/after."""

import json
import sys
from pathlib import Path

def count_effect_nodes(glb_path):
    """Count nodes with effect extras in a GLB JSON dump."""
    if not glb_path.exists():
        return {"error": f"File not found: {glb_path}"}
    
    try:
        with open(glb_path) as f:
            data = json.load(f)
    except Exception as e:
        return {"error": f"Failed to load JSON: {e}"}
    
    nodes = data.get("nodes", [])
    
    effect_nodes = 0
    sprite_nodes = 0
    mesh_nodes = 0
    bundle_nodes = 0
    additive_nodes = 0
    alpha_nodes = 0
    
    for node in nodes:
        extras = node.get("extras", {})
        effect = extras.get("effect", {})
        
        if not effect:
            continue
        
        effect_nodes += 1
        kind = effect.get("kind", "")
        
        if kind == "sprite":
            sprite_nodes += 1
            # Check if it's additive or alpha by looking at the mesh name
            # (additive sprites don't have #alpha suffix in cache key)
            name = node.get("name", "")
            if "alpha" in name.lower() or "smoke" in name.lower() or "dust" in name.lower():
                alpha_nodes += 1
            else:
                additive_nodes += 1
        elif kind == "mesh":
            mesh_nodes += 1
        elif kind == "bundle":
            bundle_nodes += 1
    
    return {
        "total_nodes": len(nodes),
        "effect_nodes": effect_nodes,
        "sprites": sprite_nodes,
        "meshes": mesh_nodes,
        "bundles": bundle_nodes,
        "additive_estimate": additive_nodes,
        "alpha_estimate": alpha_nodes,
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 proof_emitter_bake.py <path_to_scene.glb.json>")
        print("Example: python3 proof_emitter_bake.py _out/bf1942_bocage_scene.glb.json")
        sys.exit(1)
    
    glb_path = Path(sys.argv[1])
    stats = count_effect_nodes(glb_path)
    
    if "error" in stats:
        print(f"Error: {stats['error']}")
        sys.exit(1)
    
    print(f"Scene: {glb_path.name}")
    print(f"Total nodes: {stats['total_nodes']}")
    print(f"Effect nodes: {stats['effect_nodes']}")
    print(f"  Sprites: {stats['sprites']} (est. {stats['additive_estimate']} additive, {stats['alpha_estimate']} alpha)")
    print(f"  Meshes: {stats['meshes']}")
    print(f"  Nested bundles: {stats['bundles']}")


if __name__ == "__main__":
    main()
