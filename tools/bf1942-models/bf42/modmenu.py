"""The interface archives a mod draws from, resolved along its mod path.

`menu.rfa` (textures and the MemeFile screen layouts), `Font.rfa` (the bitmap
faces) and `lexiconAll.dat` (the label strings) are all per-mod files, and a
mod that ships one does not ship a *copy* of the base game's -- it ships the
handful of entries it changes and inherits the rest, exactly the way
`game.addModPath` resolves everything else.  16 of the 18 installed mods ship
a `menu.rfa` of their own; 5 ship a `Font.rfa`; 16 ship a lexicon.

So the five interface extractors do not open one archive any more, they open a
`MenuSources` built from `extract_models.mod_chain` and read through it.

The rule everywhere here is the engine's: **nearest child first.**

    sources = MenuSources(mod_chain(game_dir, "EoD"))
    with sources.open_menu() as menu:
        index = {e.lower(): e for e in menu.entries}
        raw = menu.read(index["menu/texture/conp_us.dds"])   # EoD's, not vanilla's

One archive in the chain has to behave *identically* to opening that archive
directly, entry for entry and in the same order, because that is what keeps a
vanilla extraction byte-identical to the one that came before this module
existed.  `LayeredArchive` is written so that falls out: it appends each
archive's names in the archive's own order and drops the ones a nearer archive
already answered for.
"""

from __future__ import annotations

import re
from pathlib import Path

from .rfa import RfaArchive, find_archives_dir


def _archives_in(archives: Path, name: str) -> list[Path]:
    """`<name>.rfa` and its patch archives in an `Archives` directory, patch
    first, matched case-insensitively.

    Casing varies by mod -- `menu.rfa` and `Menu.rfa` both ship -- and the
    directory itself is `archives` in EoD and Interstate 82 (skill section 2),
    which `find_archives_dir` already handles.

    A Refractor patch is `<name>_001.rfa` and overrides the base `<name>.rfa`
    entry for entry, which is why `ArchivePool.add_dir` registers patches
    first everywhere else in this codebase. Road to Rome is the one installed
    mod that patches its menu: `XPack1/Archives/menu_001.rfa` (the 1.6 patch,
    Jan 2004) holds the two kit photographs
    `Icon_assault_breda_axis_selected` and `Icon_medic_stengun_allies_selected`
    and they are in no other archive of any installed mod, so reading only
    `Menu.rfa` loses them outright. Vanilla ships no `menu_001.rfa` or
    `Font_001.rfa`, so this adds nothing to a vanilla chain and its output is
    unchanged.
    """
    if archives is None or not archives.is_dir():
        return []
    stem = re.escape(name.rsplit(".", 1)[0])
    pattern = re.compile(rf"(?i)^{stem}(_\d+)?\.rfa$")
    found = [child for child in archives.iterdir()
             if child.is_file() and pattern.match(child.name)]
    # `foo_001` sorts after `foo`; reverse so the patch is layered over it.
    return sorted(found, key=lambda p: p.name.lower(), reverse=True)


def _archive_in(archives: Path, name: str) -> Path | None:
    """The base archive alone. Kept for callers that want one path."""
    found = _archives_in(archives, name)
    return found[-1] if found else None


def _file_in(mod_dir: Path, name: str) -> Path | None:
    if not mod_dir.is_dir():
        return None
    for child in mod_dir.iterdir():
        if child.is_file() and child.name.lower() == name:
            return child
    return None


class LayeredArchive:
    """Several archives addressed as one namespace, nearest first.

    `entries` holds real entry names: the nearest archive's, in its own order,
    then each parent's that no nearer archive already carries (compared
    case-insensitively, since Refractor is).  `read` takes any of those names.

    A one-archive chain is that archive: same names, same order.  That is the
    property the byte-identity proof for vanilla rests on.
    """

    def __init__(self, paths: list[Path], labels: list[str] | None = None):
        self.paths = list(paths)
        self.labels = list(labels) if labels else [p.parent.parent.name for p in paths]
        self._archives: list[RfaArchive] = []
        self.entries: list[str] = []
        self._owner: dict[str, int] = {}     # lowered name -> archive index
        self._real: dict[str, str] = {}      # lowered name -> name as opened
        for i, path in enumerate(self.paths):
            archive = RfaArchive(path)
            self._archives.append(archive)
            for name in archive.entries:
                key = name.lower()
                if key in self._owner:
                    continue
                self._owner[key] = i
                self._real[key] = name
                self.entries.append(name)

    # -- lifecycle ---------------------------------------------------------

    def __enter__(self) -> "LayeredArchive":
        return self

    def __exit__(self, *_) -> None:
        self.close()

    def close(self) -> None:
        for archive in self._archives:
            archive.close()
        self._archives = []

    # -- reading -----------------------------------------------------------

    def __contains__(self, name: str) -> bool:
        return name.lower().replace("\\", "/") in self._owner

    def read(self, name: str) -> bytes:
        key = name.lower().replace("\\", "/")
        index = self._owner[key]
        return self._archives[index].read(self._real[key])

    def owner(self, name: str) -> str | None:
        """Which mod in the chain answers for an entry -- the directory name,
        e.g. `EoD` or `bf1942`.  This is what a pack manifest records so a
        reader can see where a sprite came from without re-deriving it."""
        index = self._owner.get(name.lower().replace("\\", "/"))
        return None if index is None else self.labels[index]


class MenuSources:
    """The interface files of a mod and the mods it inherits from.

    Built from `extract_models.mod_chain`, whose first element is the mod
    itself and whose last is `bf1942`.  A chain member that ships none of
    these files simply contributes nothing.
    """

    def __init__(self, chain: list[Path]):
        if not chain:
            raise ValueError("empty mod chain")
        self.chain = list(chain)

    # -- identity ----------------------------------------------------------

    @property
    def mod_dir(self) -> Path:
        return self.chain[0]

    @property
    def mod_id(self) -> str:
        """The viewer's id for this mod: the directory name lowercased, which
        is what `build_mods_manifest.py` and `maps/mods/<id>/` already use."""
        return self.chain[0].name.lower()

    @property
    def is_vanilla(self) -> bool:
        return self.mod_id == "bf1942"

    def labels(self, paths_attr: str) -> list[str]:
        return [d.name for d, p in self._pairs(paths_attr)]

    # -- files -------------------------------------------------------------

    def _pairs(self, kind: str) -> list[tuple[Path, Path]]:
        """Every file of this kind along the chain, nearest mod first and,
        within one mod, its patch archives ahead of the base they patch."""
        out: list[tuple[Path, Path]] = []
        for mod_dir in self.chain:
            if kind == "lexicon":
                found = _file_in(mod_dir, "lexiconall.dat")
                if found is not None:
                    out.append((mod_dir, found))
                continue
            for path in _archives_in(find_archives_dir(mod_dir), kind):
                out.append((mod_dir, path))
        return out

    @property
    def menu_paths(self) -> list[Path]:
        return [p for _, p in self._pairs("menu.rfa")]

    @property
    def font_paths(self) -> list[Path]:
        return [p for _, p in self._pairs("font.rfa")]

    @property
    def lexicon_paths(self) -> list[Path]:
        return [p for _, p in self._pairs("lexicon")]

    # -- opening -----------------------------------------------------------

    def open_menu(self) -> LayeredArchive:
        pairs = self._pairs("menu.rfa")
        if not pairs:
            raise FileNotFoundError(
                f"no menu.rfa anywhere in {[d.name for d in self.chain]}")
        return LayeredArchive([p for _, p in pairs], [d.name for d, _ in pairs])

    def open_font(self) -> LayeredArchive:
        pairs = self._pairs("font.rfa")
        if not pairs:
            raise FileNotFoundError(
                f"no Font.rfa anywhere in {[d.name for d in self.chain]}")
        return LayeredArchive([p for _, p in pairs], [d.name for d, _ in pairs])

    # -- provenance --------------------------------------------------------

    def provenance(self) -> dict:
        """What a pack manifest records about where its contents came from."""
        root = self.chain[0].parent
        rel = lambda p: str(p.relative_to(root.parent)) if root.parent in p.parents else str(p)
        return {
            "mod": self.mod_id,
            "chain": [d.name for d in self.chain],
            "menu": [rel(p) for p in self.menu_paths],
            "font": [rel(p) for p in self.font_paths],
            "lexicon": [rel(p) for p in self.lexicon_paths],
        }
