#!/usr/bin/env python3
"""Census script: count sounding static buildings across BF1942 vanilla maps.

Counts how many placed static objects have loadSoundScript in their template tree,
broken down per-level and overall. Reports which sound scripts are used and which
.ssc files resolve vs. fail.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

from bf42.level import LevelFiles, discover_level_sounds, _find_template_sound_script, load_level_files
from bf42.rfa import ArchivePool, RfaArchive
from extract_models import build_library


def census_map(
    map_name: str,
    level_archives: list[Path],
    objects_pool: ArchivePool,
    library,
) -> dict:
    """Census one map's sounding statics."""
    # Load level
    files = load_level_files(level_archives, map_name)
    
    # Read StaticObjects.con
    if not files.find("StaticObjects.con"):
        return {
            "map": map_name,
            "total_statics": 0,
            "sounding_statics": 0,
            "scripts_found": 0,
            "scripts_missing": 0,
            "details": [],
            "missing_scripts": [],
        }
    
    static_text = files.read("StaticObjects.con").decode("latin-1", "replace")
    from bf42.level import parse_static_objects
    statics = parse_static_objects(static_text)

    # Count statics with sound scripts
    sounding = []
    scripts_found = []
    scripts_missing = []

    for inst in statics:
        script_info = _find_template_sound_script(inst.template, library, objects_pool)
        if script_info is None:
            continue

        source_con, script_path = script_info
        # Resolve script path
        from bf42.level import resolve_ssc_path
        ssc_path = resolve_ssc_path(source_con, script_path)
        
        ssc_hit = objects_pool.find(ssc_path)
        if ssc_hit:
            scripts_found.append(ssc_path)
        else:
            scripts_missing.append(ssc_path)
        
        sounding.append({
            "template": inst.template,
            "position": inst.position,
            "script": ssc_path,
            "resolved": ssc_hit is not None,
        })

    return {
        "map": map_name,
        "total_statics": len(statics),
        "sounding_statics": len(sounding),
        "scripts_found": len(scripts_found),
        "scripts_missing": len(scripts_missing),
        "details": sounding,
        "missing_scripts": list(set(scripts_missing)),
    }


def main():
    # Vanilla BF1942 archives
    bf1942_base = Path.home() / ".wine" / "drive_c" / "EA Games" / "Battlefield 1942" / "Mods" / "bf1942" / "Archives"
    if not bf1942_base.exists():
        print(f"Error: {bf1942_base} not found. Install BF1942 first.", file=sys.stderr)
        sys.exit(1)

    # Build object library and archive pool
    vanilla_archives = [
        bf1942_base / "Objects.rfa",
        bf1942_base / "standardMesh.rfa",
        bf1942_base / "treeMesh.rfa",
    ]
    
    objects_pool = ArchivePool()
    for archive in vanilla_archives:
        if archive.exists():
            objects_pool.add(archive)
    
    library = build_library(objects_pool)

    # Vanilla maps
    maps = [
        "Battleaxe", "Berlin", "Bocage", "El_Alamein", "Gazala",
        "Guadalcanal", "Iwo_Jima", "Kharkov", "Kursk", "Market_Garden",
        "Midway", "Omaha_Beach", "Stalingrad", "Tobruk", "Wake",
    ]

    results = []
    total_sounding = 0
    total_statics = 0
    all_missing = set()

    print("=" * 80)
    print("BF1942 Building Sound Census")
    print("=" * 80)
    print()

    for map_name in maps:
        map_archive = bf1942_base / "bf1942" / "levels" / f"{map_name}.rfa"
        if not map_archive.exists():
            print(f"⚠ Skipping {map_name} (archive not found)")
            continue

        result = census_map(map_name, [map_archive], objects_pool, library)
        results.append(result)
        
        total_sounding += result["sounding_statics"]
        total_statics += result["total_statics"]
        all_missing.update(result["missing_scripts"])

        # Per-map summary
        icon = "🔊" if result["sounding_statics"] > 0 else "  "
        print(f"{icon} {map_name:20s}: {result['sounding_statics']:3d} sounding / {result['total_statics']:4d} total statics")
        
        if result["sounding_statics"] > 0:
            # Show templates
            template_counts = defaultdict(int)
            for detail in result["details"]:
                template_counts[detail["template"]] += 1
            
            for tmpl, count in sorted(template_counts.items()):
                print(f"     {count:2d}× {tmpl}")

    print()
    print("=" * 80)
    print(f"TOTAL: {total_sounding} sounding statics across {len(results)} maps ({total_statics} statics overall)")
    print(f"       {len(all_missing)} unique sound scripts could not be resolved")
    print("=" * 80)

    if all_missing:
        print()
        print("Missing sound scripts:")
        for script in sorted(all_missing):
            print(f"  - {script}")


if __name__ == "__main__":
    main()
