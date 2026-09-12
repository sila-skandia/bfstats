"""Refractor Flat Archive access, plus the search path a mod inherits.

The reader itself already exists in the bf1942-map-images skill; this module adds
the part the model pipeline needs on top of it: a *pooled, case-insensitive* view
over many archives at once. Refractor was authored on Windows, so `Objects.rfa`
happily asks for `texture/Sherma_I` when the archive holds `texture/sherma_i.dds`,
and a mod resolves that name against its own archives before its parents'.
"""

from __future__ import annotations

import re
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


def _child_dir(parent: Path, name: str) -> Path | None:
    if not parent.is_dir():
        return None
    for child in parent.iterdir():
        if child.is_dir() and child.name.lower() == name:
            return child
    return None


def find_archives_dir(mod_dir: Path) -> Path | None:
    """`Archives` under a mod, whatever case that mod happened to use."""
    return _child_dir(mod_dir, "archives")


def find_game_dir(archives_dir: Path) -> Path | None:
    """`Archives/bf1942/`, which holds `Game.rfa` and `levels/`.

    Refractor mounts an archive at the directory its internal paths start with,
    and both `Game.rfa` (`Bf1942/Game/...`) and every level (`bf1942/levels/...`)
    start with `bf1942/`. That is why they live one folder below `objects.rfa` —
    and why the folder is called `bf1942` in every mod, not after the mod.
    """
    return _child_dir(archives_dir, "bf1942")


def find_levels_dir(archives_dir: Path) -> Path | None:
    game_dir = find_game_dir(archives_dir)
    return _child_dir(game_dir, "levels") if game_dir else None


LEVEL_TEXTURE_DIRS = ("alttextures", "texture", "textures", "custom textures")
_TERRAIN_TILE = re.compile(r"^tx\d+x\d+$", re.IGNORECASE)


class ArchivePool:
    """Many archives addressed as one case-insensitive namespace.

    Archives are added in resolution order — nearest mod first — and the first
    one holding a name wins, which is exactly how `game.addModPath` behaves.
    """

    def __init__(self) -> None:
        self._archives: list[tuple[str, RfaArchive]] = []
        self._index: dict[str, tuple[str, RfaArchive, str]] = {}
        # Filename -> first archive entry with that basename. Consulted only
        # after an exact `texture/X` miss, so a nested fallback such as
        # `Texture/ItalyBritts/britt1_r.dds` can fill a missing vanilla file
        # without stealing a real `Texture/britt1_r.dds`.
        self._basename: dict[str, tuple[str, RfaArchive, str]] = {}
        # `textureManager.alternativePath Texture/Africa` — probed by basename
        # before the path a shader wrote, which is how Tobruk turns every
        # spawned Sherman desert-yellow without touching a single `.rs`.
        self._alternative_dirs: list[str] = []

    def set_alternative_paths(self, dirs: list[str]) -> None:
        self._alternative_dirs = [d.replace("\\", "/").strip("/").lower() for d in dirs if d]

    def add(self, path: Path, label: str | None = None) -> None:
        archive = RfaArchive(path)
        label = label or path.name
        self._archives.append((label, archive))
        for name in archive.entries:
            entry = (label, archive, name)
            key = name.lower()
            if key not in self._index:
                self._index[key] = entry
            base = name.replace("\\", "/").rsplit("/", 1)[-1].lower()
            if base not in self._basename:
                self._basename[base] = entry

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
            if subdir not in LEVEL_TEXTURE_DIRS:
                continue
            basename = parts[-1]
            # Skip menu icons, lightmaps, terrain tiles
            if any(p.lower() in ("menu", "objectlightmaps") for p in parts):
                continue
            if _TERRAIN_TILE.match(Path(basename).stem):
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
                leaf = basename.lower()
                if leaf not in self._basename:
                    self._basename[leaf] = entry
                added += 1
        return added

    def extend_from(self, other: "ArchivePool") -> None:
        """Append another pool as a lower-priority fallback, keeping first hits."""
        self._archives.extend(other._archives)
        for key, entry in other._index.items():
            self._index.setdefault(key, entry)
        for key, entry in other._basename.items():
            self._basename.setdefault(key, entry)

    def absorb_images(self, other: "ArchivePool") -> int:
        """Index another pool's DDS/TGA files so shaders can resolve them by basename.

        TreeMesh billboards live in `treeMesh.rfa`, not `texture.rfa`. First hits
        in this pool still win.
        """
        added = 0
        for key, entry in other._index.items():
            if not key.endswith((".dds", ".tga")):
                continue
            if key not in self._index:
                self._index[key] = entry
                added += 1
            leaf = key.replace("\\", "/").rsplit("/", 1)[-1]
            self._basename.setdefault(leaf, entry)
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
        alt_leaf = stem.replace("\\", "/").rsplit("/", 1)[-1].lower()
        for alt in self._alternative_dirs:
            for ext in exts:
                hit = self._index.get(f"{alt}/{alt_leaf}{ext}")
                if hit:
                    return hit[2]
        for ext in exts:
            key = f"{stem.lower()}{ext}"
            if key in self._index:
                return self._index[key][2]
        leaf = stem.replace("\\", "/").rsplit("/", 1)[-1].lower()
        for ext in exts:
            hit = self._basename.get(leaf + ext)
            if hit:
                return hit[2]
        # FH/EoD often prefix a vanilla name (`FH_pahile_c` for `pahile_c`).
        for ext in exts:
            target = leaf + ext
            for prefix in ("fh_", "fw_", "eod_"):
                hit = self._basename.get(prefix + target)
                if hit:
                    return hit[2]
        return None

    def names(self) -> list[str]:
        return [real for _, _, real in self._index.values()]

    @property
    def archives(self) -> list[tuple[str, RfaArchive]]:
        return list(self._archives)
