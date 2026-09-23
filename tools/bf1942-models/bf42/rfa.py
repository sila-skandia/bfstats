"""Refractor Flat Archive access, plus the search path a mod inherits.

The reader itself already exists in the bf1942-map-images skill; this module adds
the part the model pipeline needs on top of it: a *pooled, case-insensitive* view
over many archives at once. Refractor was authored on Windows, so `Objects.rfa`
happily asks for `texture/Sherma_I` when the archive holds `texture/sherma_i.dds`,
and a mod resolves that name against its own archives before its parents'.

**Every segment of a compressed archive is LZO**, which is the one thing the
skill's reader gets wrong and `_inflate_segment` below fixes. Its rule was that
a segment whose compressed size equals its uncompressed size was stored
verbatim — the plausible reading of a format that has no per-segment flag. It
is not what the format does. LZO output is not bounded below by its input:
`animations/GrenadeAxis.ske` deflates 130 bytes *up* to 136, so a stream of
exactly the payload's length is an ordinary compressed one that happened to
break even. Measured over every archive in the install — vanilla and all nine
mods — 448 segments have `seg_c == seg_uc` and all 448 inflate cleanly to
exactly `seg_uc` bytes; not one is raw. Under the old rule each of those came
back as undecoded LZO bytes, so 448 files silently arrived as garbage that
happened to start with a byte or two of real data. `animations/GrenadeAllies.ske`
was one, which is why the viewer's grenade sat on its side in the palm with no
grip transform; `animations/Weapons/MedPack/MedPackFire.baf` and every mod's
`Molotov.ske`, `APLandmine.ske` and smoke-grenade skeleton were others, along
with level heightmaps and terrain tiles.

Nothing observed needs the verbatim path, but it is kept as a fallback for a
break-even segment LZO rejects rather than dropped. It is only reachable there:
when the two sizes differ, verbatim is arithmetically impossible — the segment
cannot both be `seg_c` bytes long and expand to a different `seg_uc` — so a
failed inflate is real archive damage and has to keep raising. EoD's
`objects.rfa` has three such entries out of 4806, and `ArchivePool.try_read`
exists to log and skip them.
"""

from __future__ import annotations

import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))

try:
    from extract_map_images import RfaArchive as _SkillRfaArchive
    from extract_map_images import lzo_decompress
except ImportError:  # pragma: no cover - developer environment guard
    sys.exit(
        "Could not import the RFA reader. This tool reuses the one from the\n"
        "bf1942-map-images skill at ~/.claude/skills/bf1942-map-images/scripts/."
    )


def _inflate_segment(chunk: bytes, seg_c: int, seg_uc: int) -> bytes:
    """One archive segment's payload: LZO, falling back to verbatim.

    See the module docstring for why LZO is tried first even when the segment
    did not shrink, and why only a break-even segment may fall back. A short
    inflate is a failed one — `lzo1x_decompress_safe` can return a truncated
    buffer for a stream that is not LZO at all — so the result counts only if
    it is exactly the length the segment header declares.
    """
    if seg_c != seg_uc:
        return lzo_decompress(chunk, seg_uc)
    try:
        out = lzo_decompress(chunk, seg_uc)
    except Exception:
        return chunk
    return out if len(out) == seg_uc else chunk


class RfaArchive(_SkillRfaArchive):
    """The skill's reader with the segment rule corrected."""

    def read(self, name: str) -> bytes:
        c_size, uc_size, offset = self.entries[name]
        if uc_size == 0:
            return b""
        self._fh.seek(self._base + offset)
        if not self.compressed:
            return self._fh.read(uc_size)

        blob = self._fh.read(c_size)
        (segments,) = struct.unpack_from("<I", blob, 0)
        data_start = 4 + segments * 12
        out = bytearray()
        for i in range(segments):
            seg_c, seg_uc, seg_off = struct.unpack_from("<III", blob, 4 + i * 12)
            chunk = blob[data_start + seg_off:data_start + seg_off + seg_c]
            out += _inflate_segment(chunk, seg_c, seg_uc)
        return bytes(out)


def write_rfa(path: Path, files: dict[str, bytes]) -> None:
    """An uncompressed archive holding `files` (archive path -> bytes).

    The layout `RfaArchive` reads: `u32 data_size, u32 compressed = 0`, the
    payloads back to back, then at `data_size` the count and one entry per
    file (`u32 name length, name, u32 c_size, u32 uc_size, u32 offset`, three
    unused dwords), offsets from the start of the file. Written as a numbered
    patch (`<Level>_999.rfa`) it overlays a level the way the game's own
    patches do, which is how a test changes one con file in a scratch copy of
    the install.
    """
    body = bytearray()
    index = bytearray()
    for name, data in files.items():
        offset = 8 + len(body)
        body += data
        raw = name.replace("/", "\\").encode("latin-1")
        index += struct.pack("<I", len(raw)) + raw
        index += struct.pack("<III", len(data), len(data), offset) + bytes(12)
    blob = struct.pack("<II", 8 + len(body), 0) + bytes(body)
    blob += struct.pack("<I", len(files)) + bytes(index)
    Path(path).write_bytes(blob)


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


def _level_texture_entries(entries):
    """The entries of a level archive that `ArchivePool.add_level` registers.

    Yields `(entry name, basename)`. One filter for the pool and for
    `level_texture_names`, so the cheap "could this level reskin anything?"
    question can never disagree with what the pool would actually resolve.
    """
    for name in entries:
        parts = name.split("/")
        # Level entries look like: bf1942/levels/MapName/<subdir>/file.ext
        if len(parts) < 5:
            continue
        if parts[3].lower() not in LEVEL_TEXTURE_DIRS:
            continue
        basename = parts[-1]
        # Skip menu icons, lightmaps, terrain tiles
        if any(p.lower() in ("menu", "objectlightmaps") for p in parts):
            continue
        if _TERRAIN_TILE.match(Path(basename).stem):
            continue
        yield name, basename


def texture_name_keys(name: str) -> set[str]:
    """The keys a texture name is compared under: its leaf and its stem.

    A shader asks for `texture/p4main_f`; a level ships
    `AltTextures/p4main_f.dds`. Both reduce to `p4main_f`. The leaf is kept
    beside the stem so a name with a dot of its own (`hull.v2`) still meets
    itself, which makes the comparison err toward a match - and a false match
    only costs an export that the caller then discards.
    """
    leaf = name.replace("\\", "/").rsplit("/", 1)[-1].lower()
    return {leaf, Path(leaf).stem}


def level_texture_names(path: Path) -> frozenset[str]:
    """Every name a level archive could answer a vehicle texture lookup with.

    Reads the archive's index only - no entry is decompressed - so asking this
    of all 239 Eve of Destruction levels costs less than exporting one model.
    """
    keys: set[str] = set()
    for _name, basename in _level_texture_entries(RfaArchive(path).entries):
        keys |= texture_name_keys(basename)
    return frozenset(keys)


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
        # Entries `try_read` has already warned about, so a second pass is quiet.
        self._unreadable: set[str] = set()

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
        for name, basename in _level_texture_entries(archive.entries):
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

    def add_level_objects(self, path: Path, label: str | None = None) -> int:
        """Register object templates a level defines for itself.

        A level may ship whole ObjectTemplates inside its own archive, under
        `Levels/<Map>/Objects/<Name>/`, and the engine resolves those exactly
        like the ones in `Objects.rfa`. Coral Sea is the case that matters:
        both its carriers — `Hiryu` and `Hornet`, the only things the aircraft
        spawn from — are declared there and nowhere else, so a pool built from
        `Objects.rfa` alone reports them unresolved and drops every plane on
        the map with them. Five vanilla levels do this, 33 templates between
        them (Battle of Britain's factories and radar towers, Caen's Pegasus
        Bridge and Pak40, Truk's PT boats, Kasserine's bundles).

        Only the `Objects/` subtree is taken. The rest of a level archive is
        terrain, lightmaps and menu art, which `add_level` already handles on
        the texture side and which have no business in the object namespace.

        Entries are registered under their full archive path, which is what
        `build_library` iterates, and additionally under the tail from
        `Objects/` onward so a `Geometries.con` reference resolves the same
        way it would for a global template. Global templates keep priority:
        this only ever fills gaps, so a level cannot shadow a stock object.
        """
        archive = RfaArchive(path)
        label = label or path.stem
        self._archives.append((label, archive))
        added = 0
        for name in archive.entries:
            parts = name.replace("\\", "/").split("/")
            lowered = [p.lower() for p in parts]
            try:
                start = lowered.index("objects")
            except ValueError:
                continue
            # `Levels/<Map>/Objects/...`, not some other folder called objects.
            if start < 2 or lowered[start - 2] != "levels":
                continue
            entry = (label, archive, name)
            for key in (name.lower(), "/".join(parts[start:]).lower()):
                if key not in self._index:
                    self._index[key] = entry
                    added += 1
            base = parts[-1].lower()
            if base not in self._basename:
                self._basename[base] = entry
        return added

    def add_level_meshes(self, path: Path, label: str | None = None) -> int:
        """Register meshes a level ships for itself.

        The same contract as `add_level_objects`, one folder over: a level
        archive may carry its own `Levels/<Map>/StandardMesh/` tree and the
        engine resolves those meshes exactly like the ones in
        `standardMesh.rfa`. Every mesh the vanilla extraction reported
        missing — 45 of 45 — was sitting in the level's own archive the
        whole time. Global meshes keep priority: this only fills gaps.
        """
        archive = RfaArchive(path)
        label = label or path.stem
        self._archives.append((label, archive))
        added = 0
        for name in archive.entries:
            parts = name.replace("\\", "/").split("/")
            lowered = [p.lower() for p in parts]
            try:
                start = lowered.index("standardmesh")
            except ValueError:
                continue
            # `Levels/<Map>/StandardMesh/...`, not the global archive layout.
            if start < 2 or lowered[start - 2] != "levels":
                continue
            entry = (label, archive, name)
            for key in (name.lower(), "/".join(parts[start:]).lower()):
                if key not in self._index:
                    self._index[key] = entry
                    added += 1
            base = parts[-1].lower()
            if base not in self._basename:
                self._basename[base] = entry
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

    def try_read(self, name: str) -> bytes | None:
        """`read`, but None instead of an exception on an undecompressable entry.

        Mod archives are not always intact. EoD's `objects.rfa` has three entries
        whose LZO streams overrun their lookbehind window
        (`e_MuzzSG44/Geometries.con` and two Rocketlauncher `.ssc` sounds out of
        4806 entries) — the shipped archive is simply damaged there. A bulk scan
        over every `.con` in a pool must not abort the whole extraction because
        one script in an effects folder cannot be inflated.
        """
        hit = self._index.get(name.lower())
        if hit is None:
            return None
        label, archive, real = hit
        try:
            return archive.read(real)
        except Exception as exc:  # corrupt LZO segment, truncated entry, ...
            if real.lower() not in self._unreadable:
                self._unreadable.add(real.lower())
                print(f"WARNING: unreadable archive entry {label}:{real} ({exc})",
                      file=sys.stderr)
            return None

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
