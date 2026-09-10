"""Refractor Flat Archive access, plus the search path a mod inherits.

The reader itself already exists in the bf1942-map-images skill; this module adds
the part the model pipeline needs on top of it: a *pooled, case-insensitive* view
over many archives at once. Refractor was authored on Windows, so `Objects.rfa`
happily asks for `texture/Sherma_I` when the archive holds `texture/sherma_i.dds`,
and a mod resolves that name against its own archives before its parents'.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))

try:
    from extract_map_images import RfaArchive  # noqa: F401  (re-exported)
except ImportError:  # pragma: no cover - developer environment guard
    sys.exit(
        "Could not import the RFA reader. This tool reuses the one from the\n"
        "bf1942-map-images skill at ~/.claude/skills/bf1942-map-images/scripts/."
    )


def find_archives_dir(mod_dir: Path) -> Path | None:
    """`Archives` under a mod, whatever case that mod happened to use."""
    if not mod_dir.is_dir():
        return None
    for child in mod_dir.iterdir():
        if child.is_dir() and child.name.lower() == "archives":
            return child
    return None


class ArchivePool:
    """Many archives addressed as one case-insensitive namespace.

    Archives are added in resolution order — nearest mod first — and the first
    one holding a name wins, which is exactly how `game.addModPath` behaves.
    """

    def __init__(self) -> None:
        self._archives: list[tuple[str, RfaArchive]] = []
        self._index: dict[str, tuple[str, RfaArchive, str]] = {}

    def add(self, path: Path, label: str | None = None) -> None:
        archive = RfaArchive(path)
        label = label or path.name
        self._archives.append((label, archive))
        for name in archive.entries:
            key = name.lower()
            if key not in self._index:
                self._index[key] = (label, archive, name)

    def add_dir(self, archives_dir: Path, patterns: tuple[str, ...]) -> None:
        """Every archive in a directory matching any of `patterns`, base before patch.

        Refractor patches are `<name>_001.rfa` and override the base `<name>.rfa`,
        so patches have to be registered first to win the first-hit lookup.
        """
        found: list[Path] = []
        for child in sorted(archives_dir.iterdir()):
            if not child.is_file() or child.suffix.lower() != ".rfa":
                continue
            stem = child.stem.lower()
            if any(stem == p or stem.startswith(f"{p}_") for p in patterns):
                found.append(child)
        # `foo_001` sorts after `foo`; reverse so the patch is registered first.
        for child in sorted(found, key=lambda p: p.stem.lower(), reverse=True):
            self.add(child)

    def add_level(self, path: Path, label: str | None = None) -> int:
        """Register vehicle textures from a level archive.

        Level archives carry theatre-specific skins under ``AltTextures/`` and
        ``Texture/`` subdirectories.  The engine resolves ``texture/X`` against
        these by basename, so ``AltTextures/p4main_f.dds`` satisfies a lookup
        for ``texture/p4main_f``.  This method mirrors that resolution.

        Returns the number of texture entries registered.
        """
        archive = RfaArchive(path)
        label = label or path.stem
        self._archives.append((label, archive))
        added = 0
        for name in archive.entries:
            parts = name.split("/")
            # Level entries look like: bf1942/levels/MapName/<subdir>/file.ext
            if len(parts) < 5:
                continue
            subdir = parts[3].lower()
            if subdir not in ("alttextures", "texture"):
                continue
            basename = parts[-1]
            # Skip menu icons, lightmaps, terrain textures
            if any(p.lower() in ("menu", "objectlightmaps") for p in parts):
                continue
            # Register as texture/<basename> so it resolves the same way
            # the engine does when a shader asks for texture/X.
            synth_key = f"texture/{basename}".lower()
            if synth_key not in self._index:
                entry = (label, archive, name)
                self._index[synth_key] = entry
                # `resolve_ext` hands back the *real* entry name, which `read` then
                # has to look up; index it under itself too or every level texture
                # resolves and then fails to load.
                self._index.setdefault(name.lower(), entry)
                added += 1
        return added

    def __contains__(self, name: str) -> bool:
        return name.lower() in self._index

    def read(self, name: str) -> bytes:
        label, archive, real = self._index[name.lower()]
        return archive.read(real)

    def find(self, name: str) -> str | None:
        """The archive-cased name for a lookup, or None."""
        hit = self._index.get(name.lower())
        return hit[2] if hit else None

    def source_of(self, name: str) -> str | None:
        hit = self._index.get(name.lower())
        return hit[0] if hit else None

    def resolve_ext(self, stem: str, exts: tuple[str, ...]) -> str | None:
        """`texture/sherma_i` -> whichever of `.dds`/`.tga` actually exists.

        `.rs` files name textures without an extension because the engine probes
        for one; this reproduces that probe.
        """
        if stem.lower() in self._index:
            return self._index[stem.lower()][2]
        for ext in exts:
            key = f"{stem.lower()}{ext}"
            if key in self._index:
                return self._index[key][2]
        return None

    def names(self) -> list[str]:
        return [real for _, _, real in self._index.values()]

    @property
    def archives(self) -> list[tuple[str, RfaArchive]]:
        return list(self._archives)
