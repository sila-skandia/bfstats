#!/usr/bin/env python3
"""How much of a mod's texture references actually resolve from its chain.

    python3 texture_coverage.py                       # the six mods the README tables
    python3 texture_coverage.py bf1942 FHSW --missing

The measurement that put a number on the missing vanilla `texture.rfa`: every
distinct texture reference in the `.rs` files reachable from a mod's chain
(its own `standardMesh`/`treeMesh`/`animations` archives and the `Art/`
overrides in `objects.rfa`, plus the parents it inherits), resolved the same
way the extractor resolves them — exact path, then `.dds`/`.tga` probe, then
basename fallback. References are deduplicated as written, so `texture/Foo`
and `texture/foo` count twice; that matches the original measurement, and the
counts stay comparable with the feature README's table.

`--missing` lists what did not resolve, with the first `.rs` that asked.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import rs  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, build_pools, mod_chain  # noqa: E402

TEXTURE_EXTS = (".dds", ".tga")
DEFAULT_MODS = ("bf1942", "bg42", "FH", "WarFront", "GCMOD", "FinnWars")


def measure(game_dir: Path, mod: str) -> tuple[int, int, dict[str, str]]:
    """(refs, resolved, missing ref -> first .rs that asked) for one mod."""
    chain = mod_chain(game_dir, mod)
    meshes, textures, objects, _game = build_pools(chain, [])
    refs: dict[str, str] = {}
    for pool in (meshes, objects):
        for name in pool.names():
            if not name.lower().endswith(".rs"):
                continue
            for shader in rs.parse(pool.read(name).decode("latin-1")).values():
                for texture in shader.textures:
                    refs.setdefault(texture, name)
    missing = {
        texture: source for texture, source in refs.items()
        if not textures.resolve_ext(texture.lower(), TEXTURE_EXTS)
    }
    return len(refs), len(refs) - len(missing), missing


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mods", nargs="*", default=list(DEFAULT_MODS),
                    help=f"mods to measure (default: {' '.join(DEFAULT_MODS)})")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--missing", action="store_true",
                    help="list every unresolved reference and who asked for it")
    args = ap.parse_args()

    game_dir = args.game_dir.expanduser()
    if not game_dir.is_dir():
        sys.exit(f"game dir not found: {game_dir}")

    print(f"{'Mod':12s} {'Refs':>6s} {'Resolved':>9s} {'Coverage':>9s}")
    for mod in args.mods or list(DEFAULT_MODS):
        try:
            refs, resolved, missing = measure(game_dir, mod)
        except SystemExit as exc:
            print(f"{mod:12s} {exc}")
            continue
        coverage = resolved / refs * 100 if refs else 0.0
        print(f"{mod:12s} {refs:6d} {resolved:9d} {coverage:8.1f}%")
        if args.missing and missing:
            for texture, source in sorted(missing.items(),
                                          key=lambda kv: kv[0].lower()):
                print(f"    {texture!r:44s} first ref in {source}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
