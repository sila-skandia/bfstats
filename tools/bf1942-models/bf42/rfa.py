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

import posixpath
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
# The skill is also checked in at the repo root; that copy wins, so a fresh
# clone or worktree needs nothing installed under ~/.claude.
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / ".claude/skills/bf1942-map-images/scripts"))

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
        # An entry that promises bytes and stores none: DC Final's
        # `DC_No_Fly_Zone.rfa` lists `ctf/ControlPointTemplates.con` at 1821
        # bytes with a compressed size of 0. It reads as an empty file, so the
        # rest of the level still extracts.
        if len(blob) < 4:
            return b""
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


# The extensions the client's TextureManager probes for a texture name, in its
# order. Each image codec registers its extension (`getExtension`, codec vtable
# slot +0xc: "TGA" 0x00644440, "BMP" 0x00644af0, "DDS" 0x00596c40, "RCM"
# 0x006448a0) into a `std::set<std::string>` at TextureManager+0x24 (`addCodec`,
# vt+0x38 0x006426a0), and the load walks that set in order (0x006429d0), so
# `.bmp` is tried before `.dds` and `.rcm` before `.tga`. The spelled extension
# of a name is dropped first (0x00581330 cuts at the last '.'), except `rcm`.
ENGINE_TEXTURE_EXTS = (".bmp", ".dds", ".rcm", ".tga")

# What the client draws for a texture none of its paths holds: the
# TextureManager's `getTexture` (vt+0x10, 0x00643040) loads this name in the
# missing one's place (strings 0x00917d54 and "dds" 0x00917d50). Vanilla's
# `texture.rfa` ships it: a 128 x 128 dark grey DXT5.
DEFAULT_TEXTURE = "texture/defaultTexture"

_IMAGE_EXTS = ENGINE_TEXTURE_EXTS


def _key(name: str) -> str:
    """The pool key for a lookup: lower case, with `..` segments resolved.

    `GeometryTemplate.file ../bf1942/levels/DC_No_Fly_Zone/standardMesh/x` is
    read from under `standardMesh/`, so the file the engine opens is
    `bf1942/levels/DC_No_Fly_Zone/standardMesh/x.sm`. A name without `..` is
    left exactly as it was.
    """
    key = name.lower()
    if ".." in key:
        key = posixpath.normpath(key.replace("\\", "/")).lstrip("/")
    return key


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
        # Every image the game's FileManager can open, by its real archive
        # path, and nothing the pool synthesised (a `texture/<basename>` key
        # for a level's `AltTextures/`, a basename, a prefix): what
        # `engine_texture` resolves against. An archive added with
        # `mounted=False` (a fallback mod outside the chain) is not in it.
        self._mounted: dict[str, tuple[str, RfaArchive, str]] = {}
        # The level folder `Game::load` adds to the FileManager's search
        # paths (`addPath`, lnxded 0x0805b7d8, client 0x00410ccf):
        # `bf1942/levels/<L>/`, tried after the archives for every name.
        self._level_folder: str | None = None
        # Entries `try_read` has already warned about, so a second pass is quiet.
        self._unreadable: set[str] = set()
        # The order a level load runs its own scripts in (lower-case archive
        # paths), from `add_level_objects(runs=)` given a list: where two of
        # them declare one name the first to run owns it (LOAD-1), and
        # `extract_map.LevelFirst` lists them in this order.
        self.run_order: list[str] = []

    def set_alternative_paths(self, dirs: list[str]) -> None:
        self._alternative_dirs = [d.replace("\\", "/").strip("/").lower() for d in dirs if d]

    def set_level_folder(self, level: str | None) -> None:
        """The level whose folder is on the FileManager's search path."""
        self._level_folder = f"bf1942/levels/{level.lower()}/" if level else None

    def _mount(self, entry: tuple[str, RfaArchive, str]) -> None:
        key = entry[2].lower()
        if key.endswith(_IMAGE_EXTS):
            self._mounted.setdefault(key, entry)

    def add(self, path: Path, label: str | None = None, mounted: bool = True) -> None:
        archive = RfaArchive(path)
        label = label or path.name
        self._archives.append((label, archive))
        for name in archive.entries:
            entry = (label, archive, name)
            key = name.lower()
            if mounted:
                self._mount(entry)
            if key not in self._index:
                self._index[key] = entry
            base = name.replace("\\", "/").rsplit("/", 1)[-1].lower()
            if base not in self._basename:
                self._basename[base] = entry

    def add_dir(self, archives_dir: Path, patterns: tuple[str, ...],
                mounted: bool = True) -> None:
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
            self.add(child, mounted=mounted)

    def add_level(self, path: Path, label: str | None = None) -> int:
        """Register vehicle textures from a level archive.

        Level archives carry theatre-specific skins under ``AltTextures/`` and
        ``Texture/`` subdirectories.  The engine resolves ``texture/X`` against
        these by basename, so ``AltTextures/p4main_f.dds`` satisfies a lookup
        for ``texture/p4main_f``.  This method mirrors that resolution.

        Every image in the archive is also registered under its own full path,
        whether or not the basename key was free. That is the path the engine
        reads: `textureManager.alternativePath bf1942/levels/<L>/Textures/` is
        probed before the global `texture/X` (`resolve_ext`), and a level's own
        `.rs` names its textures by full path
        (`bf1942/levels/DC_Battle_of_73_Easting/objectTexture/tablemap`). When
        the full path was registered only with a free basename key, a level's
        own copy of a texture the global archive also ships (its sky, its
        reskins, the point of `alternativePath`) lost to the global one.

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
                leaf = basename.lower()
                if leaf not in self._basename:
                    self._basename[leaf] = entry
                added += 1
        for name in archive.entries:
            if name.lower().endswith((".dds", ".tga")):
                self._index.setdefault(name.lower(), (label, archive, name))
            self._mount((label, archive, name))
        return added

    def mount_level(self, path: Path, exts: tuple[str, ...],
                    label: str | None = None) -> int:
        """Register a level archive's `exts` entries under their full paths only.

        Refractor mounts every level archive of the mod chain at its own path,
        so one level may name another's files: No Fly Zone Day 2's buildings
        are `GeometryTemplate.file ../bf1942/levels/DC_No_Fly_Zone/standardMesh/...`
        and its `alternativePath` is DC_No_Fly_Zone's `Textures/`, and neither
        level ships a copy. Only the full path answers, never a basename or a
        `standardMesh/` tail: those stay the current level's (`add_level_meshes`).
        First registration wins, so mount the nearest mod's copy first.
        """
        archive = RfaArchive(path)
        label = label or path.stem
        self._archives.append((label, archive))
        added = 0
        for name in archive.entries:
            key = name.lower()
            self._mount((label, archive, name))
            if key.endswith(exts) and key not in self._index:
                self._index[key] = (label, archive, name)
                added += 1
        return added

    def add_level_objects(self, path: Path, label: str | None = None,
                          extra: frozenset[str] | set[str] = frozenset(),
                          runs=None) -> int:
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

        Only the `Objects/` subtree is taken, and `extra`: the archive paths
        (lower case) of the other object scripts the level's `Init.con` runs,
        such as Al Nas's root `objects.con` or Coastal Hammer's
        `CustomObjects/`, registered under their full path. The rest of a
        level archive is terrain, lightmaps and menu art, which `add_level`
        already handles on the texture side and which have no business in the
        object namespace.

        `runs` is a level load: the archive paths (lower case) of every script
        the level's `Init.con` runs, `Objects/` included, in the order it runs
        them (`extract_map.level_run_scripts`; kept in `run_order`). Then a
        `.con` under `Objects/` that
        nothing runs is left out. The engine never walks a level's `Objects/`
        on its own: `Game::loadAllConFiles("objects/")` lists only the
        archives mounted under `objects` (LOAD-5), so a script the level ships
        and does not run declares nothing. DC Final's Lost Village carries
        the nochute kits Lost Village nopara runs, and runs none of them. The
        census callers (every level's templates, for a catalogue) pass no
        `runs` and keep the whole folder.

        Entries are registered under their full archive path, which is what
        `build_library` iterates, and additionally under the tail from
        `Objects/` onward so a `Geometries.con` reference resolves the same
        way it would for a global template. Global templates keep priority
        in the pool; which declaration wins a name is the library's order
        (`extract_map.LevelFirst`).
        """
        archive = RfaArchive(path)
        label = label or path.stem
        self._archives.append((label, archive))
        if runs is not None and not isinstance(runs, (set, frozenset)):
            known = set(self.run_order)
            self.run_order.extend(p for p in runs if p not in known)
            runs = set(runs)
        added = 0
        for name in archive.entries:
            parts = name.replace("\\", "/").split("/")
            lowered = [p.lower() for p in parts]
            if name.lower() in extra:
                entry = (label, archive, name)
                if name.lower() not in self._index:
                    self._index[name.lower()] = entry
                    added += 1
                continue
            try:
                start = lowered.index("objects")
            except ValueError:
                start = -1
            # `Levels/<Map>/Objects/...`, not some other folder called objects.
            under_objects = start >= 2 and lowered[start - 2] == "levels"
            if runs is not None and name.lower().endswith(".con"):
                if name.lower() not in runs:
                    continue
                if not under_objects:
                    entry = (label, archive, name)
                    if name.lower() not in self._index:
                        self._index[name.lower()] = entry
                        added += 1
                    continue
            if not under_objects:
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
        """Register the meshes a level ships in its own `StandardMesh/` and
        `TreeMesh/` folders under the names the chain's archives answer,
        `standardMesh/x.sm` and `treeMesh/x.tm`, where the chain has no file
        of that name. Every mesh the vanilla extraction reported missing (45
        of 45) was in the level's own archive.

        The chain's copy wins a name both ship (ledger RFA-2). A mesh
        template opens `getPath() + file + ".sm"` (`StandardMesh/` unless
        set: lnxded `0x083a6050`, client `0x005b6080`), a tree mesh
        `"TreeMesh/" + file + ".tm"` (client `0x0064b2f0`), a mesh's shaders
        `"StandardMesh/..."` (client `0x005b69d0`). `FileManager::open`
        (lnxded `0x0841dda0`, client `0x006251f0`) tries the name as written
        in the archives mounted under the longest key its folder starts
        with, `standardmesh` or `treemesh`, the chain's archives; then each
        `addPath` prefix in turn, and `Game::load` adds the level's folder
        (lnxded `0x0805b7d8`, client `0x00410ccf`). A level archive is
        mounted under `bf1942/levels/<L>`, so its copy answers only when no
        chain archive has the name. Four FHSW levels ship a different copy
        of a chain mesh (Liberation of Caen's `pak40_mount_M1`, Goodwood's
        sandbags, Tarawa's `PT_Mine_M1`, Monster des Stahles' Oyodo hull);
        the chain's is the one drawn.
        """
        archive = RfaArchive(path)
        label = label or path.stem
        self._archives.append((label, archive))
        added = 0
        for name in archive.entries:
            parts = name.replace("\\", "/").split("/")
            lowered = [p.lower() for p in parts]
            # `bf1942/levels/<Map>/StandardMesh/...` or `.../TreeMesh/...`:
            # the folder the addPath prefix reaches, not a nested one.
            if (len(parts) < 5 or lowered[1] != "levels"
                    or lowered[3] not in ("standardmesh", "treemesh")):
                continue
            start = 3
            entry = (label, archive, name)
            self._mount(entry)
            for key in (name.lower(), "/".join(parts[start:]).lower()):
                if key not in self._index:
                    self._index[key] = entry
                    added += 1
            base = parts[-1].lower()
            if base not in self._basename:
                self._basename[base] = entry
        return added

    def add_level_root(self, path: Path, folders: tuple[str, ...],
                       label: str | None = None) -> int:
        """Register a level archive's `bf1942/levels/<L>/<folder>/...` entries
        under `<folder>/...`, as if the level folder were a mod root.

        The level folder is a search root for some of what the chain's own
        scripts name. FHSW's `animations/AnimationStates.con` runs
        `AnimationStatesSetUseHandWeapon` and its `CopyOfKnifeWeapons.inc`
        includes `CopyOfKnifeWeaponsMod.inc`, and no archive of FHSWEurope,
        FHSW, FH or vanilla holds either: only level archives do (203 Hill
        ships both, with the `copyState2 GrenadeRus GrenadeAxis` its Russians'
        grenade has no other state from). Data, not traced, like the level's
        `Menu/Texture/` (ledger VHUD-13). First registration wins, so call
        this on an empty pool, nearest copy first, and `extend_from` the
        chain after it: for a name the chain also holds the precedence is
        not traced (none of the 66 FHSWEurope levels exported on 2026-10-15
        ships one). Returns the entries registered.
        """
        archive = RfaArchive(path)
        label = label or path.stem
        self._archives.append((label, archive))
        wanted = {f.lower() for f in folders}
        added = 0
        for name in archive.entries:
            parts = name.replace("\\", "/").split("/")
            lowered = [p.lower() for p in parts]
            # `bf1942/levels/<L>/<folder>/...`
            if (len(parts) < 5 or lowered[1] != "levels"
                    or lowered[3] not in wanted):
                continue
            # The full path too: `find` answers with the archive's own name,
            # and a reader hands that back to `read`.
            for key in ("/".join(lowered[3:]), name.lower()):
                if key not in self._index:
                    self._index[key] = (label, archive, name)
                    added += 1
        return added

    def extend_from(self, other: "ArchivePool") -> None:
        """Append another pool as a lower-priority fallback, keeping first hits."""
        self._archives.extend(other._archives)
        for key, entry in other._index.items():
            self._index.setdefault(key, entry)
        for key, entry in other._mounted.items():
            self._mounted.setdefault(key, entry)
        for key, entry in other._basename.items():
            self._basename.setdefault(key, entry)

    def absorb_images(self, other: "ArchivePool") -> int:
        """Index another pool's DDS/TGA files so shaders can resolve them by basename.

        TreeMesh billboards live in `treeMesh.rfa`, not `texture.rfa`. First hits
        in this pool still win.
        """
        added = 0
        for key, entry in other._mounted.items():
            self._mounted.setdefault(key, entry)
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
        return _key(name) in self._index

    def read(self, name: str) -> bytes:
        label, archive, real = self._index[_key(name)]
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
        hit = self._index.get(_key(name))
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
        hit = self._index.get(_key(name))
        return hit[2] if hit else None

    def source_of(self, name: str) -> str | None:
        hit = self._index.get(_key(name))
        return hit[0] if hit else None

    def rank(self, name: str) -> int | None:
        """How far down the resolution order the archive holding `name` sits:
        0 is the first archive added (the nearest mod), None an absent name.
        For choosing between spellings of one file -- `Sound/22kHz/x.wav`
        against `Sound/44kHz/x.wav` -- by whose archive they are in, before
        any preference between the spellings themselves."""
        hit = self._index.get(_key(name))
        if hit is None:
            return None
        archive = hit[1]
        for i, (_label, candidate) in enumerate(self._archives):
            if candidate is archive:
                return i
        return None

    def _engine_open(self, path: str) -> tuple[str, RfaArchive, str] | None:
        """`FileManager::open` / `fileExists` for an image: the name as
        written in the mounted archives, then under the level folder
        (lnxded 0x0841dda0 and 0x0841e190 try the name, then each search
        path in turn)."""
        hit = self._mounted.get(_key(path))
        if hit is None and self._level_folder:
            hit = self._mounted.get(_key(self._level_folder + path))
        return hit

    def engine_texture(self, name: str) -> str | None:
        """The image the client's TextureManager opens for a texture name,
        or None where it draws `DEFAULT_TEXTURE` instead.

        Only routes the game has: the mounted archives by real path and the
        level folder on the search path (`_engine_open`), and the level's
        `textureManager.alternativePath` folders. The load (0x006429d0) drops
        the spelled extension (0x00581330) and, for each extension of
        `ENGINE_TEXTURE_EXTS` in turn, asks `fileExists(name.ext)`; only a
        name that exists goes on to the walk (0x00642340, 0x00642459..
        0x00642529), which opens the part after the last slash under each
        alternative path, first hit wins, and else the name itself. So an
        alternative path repaints a texture the game has and never supplies
        one it lacks, and nothing answers by basename, from another level's
        texture folder or from a level's `AltTextures/` or `Textures/` unless
        an alternative path names it. A name nothing answers is drawn with
        `DEFAULT_TEXTURE` (`getTexture` 0x00643040). What the pool's other
        lookups resolve beyond this (`resolve_ext`) the game never draws.
        """
        path = name.replace("\\", "/")
        dot = path.rfind(".")
        base = path[:dot] if dot >= 0 else path
        for ext in ENGINE_TEXTURE_EXTS:
            candidate = base + ext
            found = self._engine_open(candidate)
            if found is None:
                continue
            cut = candidate.rfind("/")
            leaf = candidate[cut:] if cut >= 0 else candidate
            for alt in self._alternative_dirs:
                hit = self._engine_open(alt + leaf)
                if hit is not None:
                    return hit[2]
            return found[2]
        return None

    def resolve_ext(self, stem: str, exts: tuple[str, ...]) -> str | None:
        """`texture/sherma_i` -> whichever of `.dds`/`.tga` actually exists.

        `.rs` files name textures without an extension because the engine probes
        for one; this reproduces that probe. A `..` in the name is resolved
        first (`_key`), so another level's file is read at its own path.
        """
        if ".." in stem:
            stem = _key(stem)
        if stem.lower() in self._index:
            return self._index[stem.lower()][2]
        # A reference that spells the extension out (`texture/SU_76MSummer.tga`
        # on FH's su76m_gun shader) while the file ships under the other one
        # (`su_76msummer.dds`): the engine reads the texture by its stem, so
        # drop the spelled extension and probe like any other reference.
        # Without this the probe below looks for `su_76msummer.tga.dds`, the
        # part draws untextured and the viewer paints it flat white.
        spelled = Path(stem.replace("\\", "/")).suffix.lower()
        if spelled and spelled in exts:
            return self.resolve_ext(stem[: -len(spelled)], exts)
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

    def reopen(self) -> int:
        """Give every archive this pool reads a file handle of its own.

        For a forked worker. `RfaArchive.read` seeks and then reads one
        handle, and a child of `fork` shares its parent's open file
        descriptions, offset included: two workers reading one archive would
        move each other's position between the seek and the read. Covers the
        archives another pool lent this one (`extend_from`). Returns how many
        were reopened.
        """
        seen: dict[int, RfaArchive] = {}
        for _label, archive in self._archives:
            seen.setdefault(id(archive), archive)
        for table in (self._index, self._basename):
            for _label, archive, _name in table.values():
                seen.setdefault(id(archive), archive)
        for archive in seen.values():
            archive._fh.close()   # this process's copy of the descriptor only
            archive._fh = open(archive.path, "rb")
        return len(seen)

    @property
    def archives(self) -> list[tuple[str, RfaArchive]]:
        return list(self._archives)
