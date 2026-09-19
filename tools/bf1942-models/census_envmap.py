#!/usr/bin/env python3
"""Census all envmap usage in vanilla BF1942 .rs shader files."""

import sys
from pathlib import Path
from collections import defaultdict, Counter
import re

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
from extract_map_images import RfaArchive

INSTALL = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"

def scan_archive(rfa_path: Path) -> tuple[int, list[tuple[str, str]]]:
    """Scan an .rfa for .rs files and return count and envmap details.
    
    Returns (rs_count, [(filename, full_text), ...])
    """
    archive = RfaArchive(rfa_path)
    rs_files = [name for name in archive.entries if name.lower().endswith('.rs')]
    envmap_files = []
    
    for rs_name in rs_files:
        try:
            content = archive.read(rs_name).decode('latin-1', errors='replace')
            if 'envmap' in content.lower():
                envmap_files.append((rs_name, content))
        except Exception as e:
            print(f"WARNING: Could not read {rfa_path.name}:{rs_name}: {e}", file=sys.stderr)
    
    return len(rs_files), envmap_files

def extract_model_family(rs_path: str) -> str:
    """Extract model family from .rs path like 'Objects/Vehicles/Air/Bf109/Bf109.rs'."""
    parts = rs_path.replace('\\', '/').split('/')
    # Look for vehicle/weapon names in path
    for i, part in enumerate(parts):
        if part.lower() in ('air', 'land', 'sea', 'stationary', 'handheld', 'common'):
            if i + 1 < len(parts):
                return parts[i + 1]
    # Fallback: return second-to-last part (filename minus .rs)
    if len(parts) >= 2:
        return parts[-2]
    return Path(rs_path).stem

def main():
    # Scan vanilla bf1942
    mod_dir = INSTALL / "Mods/bf1942"
    archives_dir = mod_dir / "Archives"
    
    print("=" * 80)
    print("ENVMAP CENSUS - Vanilla BF1942")
    print("=" * 80)
    
    total_rs = 0
    total_envmap_rs = 0
    envmap_details = []
    
    # Scan all archives
    for rfa in sorted(archives_dir.rglob("*.rfa")):
        rel = rfa.relative_to(archives_dir)
        rs_count, envmap_files = scan_archive(rfa)
        total_rs += rs_count
        total_envmap_rs += len(envmap_files)
        
        if envmap_files:
            print(f"\n{rel}: {len(envmap_files)} envmap shaders (of {rs_count} .rs)")
            for rs_name, content in envmap_files[:3]:  # Show first 3
                print(f"  • {rs_name}")
            if len(envmap_files) > 3:
                print(f"  ... and {len(envmap_files) - 3} more")
            envmap_details.extend([(rfa.name, rs_name, content) for rs_name, content in envmap_files])
    
    print("\n" + "=" * 80)
    print(f"TOTALS: {total_envmap_rs} envmap .rs files out of {total_rs} total")
    print("=" * 80)
    
    # Analyze syntax patterns
    print("\n--- SYNTAX PATTERNS ---")
    
    envmap_lines = []
    envmap_contexts = []
    model_families = Counter()
    
    for archive_name, rs_path, content in envmap_details:
        # Extract the lines with envmap
        for line_num, line in enumerate(content.split('\n'), 1):
            if 'envmap' in line.lower():
                envmap_lines.append(line.strip())
                # Get 3 lines of context
                lines = content.split('\n')
                start = max(0, line_num - 3)
                end = min(len(lines), line_num + 2)
                ctx = '\n'.join(lines[start:end])
                envmap_contexts.append((rs_path, line_num, ctx))
        
        model_families[extract_model_family(rs_path)] += 1
    
    # Show unique syntaxes
    unique_syntaxes = Counter(envmap_lines)
    print(f"\nUnique envmap syntaxes found ({len(unique_syntaxes)}):")
    for syntax, count in unique_syntaxes.most_common(20):
        print(f"  {count:4d}x  {syntax}")
    
    # Show top model families
    print(f"\n--- TOP MODEL FAMILIES ---")
    for family, count in model_families.most_common(20):
        print(f"  {count:3d}x  {family}")
    
    # Show detailed contexts (first 10)
    print(f"\n--- EXAMPLE CONTEXTS (first 10) ---")
    for rs_path, line_num, ctx in envmap_contexts[:10]:
        print(f"\n{rs_path} (line {line_num}):")
        for line in ctx.split('\n'):
            print(f"  {line}")
    
    # Check for variants
    print("\n--- VARIANT ANALYSIS ---")
    has_color = sum(1 for _, _, c in envmap_details if 'envcolor' in c.lower())
    has_intensity = sum(1 for _, _, c in envmap_details if any(x in c.lower() for x in ['intensity', 'amount', 'factor']))
    has_stage_num = sum(1 for line in envmap_lines if re.search(r'\bstage\s+\d+', line, re.I))
    
    print(f"Files with 'envColor': {has_color}")
    print(f"Files with intensity/amount/factor: {has_intensity}")
    print(f"Lines with 'stage N': {has_stage_num}")
    
    # Check expansion pack and mods
    print("\n" + "=" * 80)
    print("EXPANSION PACKS & MODS")
    print("=" * 80)
    
    for mod_name in ["XPack1", "XPack2"]:
        mod_path = INSTALL / f"Mods/{mod_name}"
        if not mod_path.exists():
            continue
        archives = mod_path / "Archives"
        if not archives.exists():
            continue
        
        mod_rs = 0
        mod_envmap = 0
        for rfa in archives.rglob("*.rfa"):
            rs_count, envmap_files = scan_archive(rfa)
            mod_rs += rs_count
            mod_envmap += len(envmap_files)
        print(f"{mod_name}: {mod_envmap} envmap .rs (of {mod_rs} total)")

if __name__ == "__main__":
    main()
