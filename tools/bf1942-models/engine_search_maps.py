#!/usr/bin/env python3
"""The engine's own search maps for a level that ships none.

The release Linux dedicated server paints and saves a level's search maps
when `ai.createAllMaps` runs after the statics are loaded
(features/bot-map-generation, section 13). This runs it for one level in a
private instance inside the lab folder, in the lab's Linux container, and
copies the maps it writes into the level's generated bot layer
(`bot-layers/<mod>/<level>/Pathfinding/`), where the bake and the generator
read them. The lab's own install, the game install and the level's source
archive are never written: the instance holds links to the server's
archives and its own rebuilt copy of the level archive.

    python3 engine_search_maps.py --mod bf1942 \
        --archive ../../community-mappack-by-michaels/shigaisen_B.rfa

The level is started in co-op with a script layer made for the run: its
Conquest script as `Coop.con`, a minimal `AI.con`, and an `AIpathFinding.con`
that declares `Tank0` and `Infantry1` with DICE's usual numbers, seeds the
flood with the level's soldier spawns and asks for the maps. The server
aborts after it has saved them (`free(): invalid pointer`), before any
strategic map; that is expected and is why none is collected.

A mod's level works the same way when the mod is in the client's install:

    python3 engine_search_maps.py --mod DesertCombat \
        --archive "<game>/Mods/DesertCombat/Archives/bf1942/Levels/DC_Basrah_Nights.rfa"

The lab's server source holds vanilla and the two expansion packs. Any other
mod is read from the game install (`--game`, `BF1942_GAME_DIR`, or the
install the lab's container mounts): the instance gets a lower-case tree of
links to the mod's scripts and archives (the Linux server lower-cases every
path before it opens a file), next to the same for each mod its `init.con`
names with `game.addModPath`, and the map list names the mod. Nothing is
copied and the game install is never written.

Measured on one level each of Desert Combat, BF1918 and Forgotten Hope
(2026-11-10): the server loads the mod and writes all six maps in two to six
minutes, but what it paints is only what its flood reaches from the soldier
spawns, and on these levels that is little (6 % of Pegasus, 0.7 % of
DC_Basrah_Nights, 143 cells of BF1918's Baghdad). Look at a mod level's maps
before a layer is built on them. A Desert Combat server does not abort: it
writes the strategic maps too and goes on into the round, so the run ends it
once the search maps have stopped changing.

The engine reads an archive only if the 148-byte block after its 8-byte
header and its trailing bytes are those of a game archive, so the rebuilt
archive keeps the source's and stores the added files as literal-only LZO
(or as they are, when the source archive is stored uncompressed).
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42.rfa import RfaArchive  # noqa: E402

LAYERS = HERE / "bot-layers"
#: `ai.addSearchMap` lines: DICE's infantry map and the tank map most levels declare.
SEARCH_MAPS = (
    ("Tank0", "0 0 25 3.0 0.3 2.5 0", "Tank"),
    ("Infantry1", "0 1.5 30 1.0 0.4 2.0 1", "Infantry"),
)
LEVELS = (0, 1, 2)
#: What a server reads of a mod: scripts, the lexicon and the archives.
MOD_SUFFIXES = {".con", ".dat", ".rfa"}
MOD_SKIP_DIRS = {"movies", "music", "settings", "logs"}
#: Ends the server whose working folder is `$1`, and no other in the container.
STOP_SERVER = 'for p in $(pgrep bf1942_lnxded); do [ "$(readlink /proc/$p/cwd)" = "$1" ] && kill -9 $p; done; true'
#: Where the retail install is looked for when `--game` is not given.
GAME_DIRS = ("~/Library/Application Support/CrossOver/Bottles/BF1942/drive_c/EA Games/Battlefield 1942",
             "~/.wine/drive_c/EA Games/Battlefield 1942")


def lzo_literal(seg: bytes) -> bytes:
    """`seg` as an LZO1X stream of one literal run and the end marker."""
    n = len(seg)
    if n == 0:
        return b"\x11\x00\x00"
    if n < 4:
        raise ValueError("a segment of 1 to 3 bytes has no literal-only form")
    if n <= 238:
        head = bytes([n + 17])
    else:
        rem = n - 18
        zeros = (rem - 1) // 255
        head = b"\x00" + b"\x00" * zeros + bytes([rem - 255 * zeros])
    return head + seg + b"\x11\x00\x00"


def pack_file(data: bytes, seg_size: int = 16384) -> bytes:
    """One file's payload: the segment table and its literal-only segments."""
    if 0 < len(data) < 4:
        data = data + b"\r\n" * 2
    segs = [data[i:i + seg_size] for i in range(0, len(data), seg_size)] or [b""]
    if len(segs) > 1 and len(segs[-1]) < 19:
        segs[-2:] = [segs[-2] + segs[-1]]
    enc = [lzo_literal(s) for s in segs]
    table, off = b"", 0
    for s, e in zip(segs, enc):
        table += struct.pack("<III", len(e), len(s), off)
        off += len(e)
    return struct.pack("<I", len(segs)) + table + b"".join(enc)


def rebuild_archive(src: Path, dst: Path, add: dict[str, bytes]) -> None:
    """`src` with `add` (archive path -> bytes) added or replaced: the header
    block, every other file's payload and the trailing bytes kept. An archive
    stored uncompressed (a third of the community map pack) stays so, and the
    added files go in as they are."""
    b = src.read_bytes()
    data_size, compressed = struct.unpack_from("<II", b, 0)
    if compressed not in (0, 1):
        raise ValueError(f"{src.name}: compression flag {compressed}, not 0 or 1")
    off = data_size
    (count,) = struct.unpack_from("<I", b, off)
    off += 4
    entries = []
    for _ in range(count):
        (ln,) = struct.unpack_from("<I", b, off)
        off += 4
        name = b[off:off + ln]
        off += ln
        c, u, o = struct.unpack_from("<III", b, off)
        tail = b[off + 12:off + 24]
        off += 24
        entries.append([name, b[o:o + c], u, tail, o])
    trailer = b[off:]
    first = min(e[4] for e in entries)
    block = b[8:first]
    if len(block) != 148:
        raise ValueError(f"{src.name}: {len(block)} bytes between the header and the first file, not 148")
    tail0 = entries[0][3]
    by_name = {e[0].lower(): e for e in entries}
    for name, data in add.items():
        raw = name.encode("latin-1")
        row = [raw, pack_file(data) if compressed else data, len(data), tail0, 0]
        if raw.lower() in by_name:
            by_name[raw.lower()][1:3] = row[1:3]
        else:
            entries.append(row)
    entries.sort(key=lambda e: e[0].lower())
    body, index = bytearray(), bytearray()
    for name, blob, u, tail, _ in entries:
        offset = 8 + len(block) + len(body)
        body += blob
        index += struct.pack("<I", len(name)) + name + struct.pack("<III", len(blob), u, offset) + tail
    dst.write_bytes(struct.pack("<II", 8 + len(block) + len(body), compressed) + block + bytes(body)
                    + struct.pack("<I", len(entries)) + bytes(index) + trailer)


def level_folder(archive: RfaArchive) -> str:
    """The level's path prefix inside its archive, as the archive spells it."""
    for name in archive.entries:
        parts = name.split("/")
        low = [p.lower() for p in parts]
        if "levels" in low and len(parts) > low.index("levels") + 2:
            return "/".join(parts[:low.index("levels") + 2])
    raise ValueError("no level folder in the archive")


def script_layer(archive: RfaArchive, prefix: str, world_size: int, statics: bool = True) -> dict[str, bytes]:
    """The files the run adds: co-op from Conquest, the AI start, the map request.
    Without `statics` the maps are asked for before the level's statics exist,
    which shows what the terrain alone leaves free (a diagnosis, not a layer)."""
    def text(rel: str) -> str:
        hit = next((n for n in archive.entries if n.lower() == f"{prefix}/{rel}".lower()), None)
        return archive.read(hit).decode("latin-1") if hit else ""

    conquest = text("Conquest.con") or text("GameTypes/Conquest.con")
    if not conquest.strip():
        raise ValueError("the level has no Conquest script to start a co-op round from")
    if not re.search(r"^\s*run\s+ai\b", conquest, re.I | re.M):
        conquest = re.sub(r"(?im)^(\s*run\s+\S*ObjectSpawns\b.*)$", "run ai v_arg1\r\n\\1", conquest, count=1)
    seeds = []
    for m in re.finditer(r"(?im)^\s*Object\.absolutePosition\s+([-\d.]+)/[-\d.]+/([-\d.]+)", text("Conquest/SoldierSpawns.con")):
        seeds.append(f"{float(m.group(1)):.1f}/{float(m.group(2)):.1f}")
    lines = ["ai.numAStarResources 10", ""]
    for i, (name, numbers, kind) in enumerate(SEARCH_MAPS):
        lines += [f"ai.addSearchMap {name} {numbers}", f"ai.addSearchType {kind} {i} 0"]
        if seeds:
            lines.append(f"ai.setMapSpawnPoints {i} {','.join(seeds)}")
        lines.append("")
    lines += ["ai.loadMaps", *(["run StaticObjects"] if statics else []), "ai.createAllMaps", ""]
    ai = ["aiSettings.setWorldMapSize %d %d" % (world_size, world_size), "aiSettings.setViewDistance 200",
          "aiSettings.setInformationGridDimension 32", "ai.init 2",
          "AIBotManager.setLodLevelTicks 6 6 6", "AIBotManager.setLodLevelPriority 3 3 3",
          "AIBotManager.setPlannedDecisionMakingThreshold 0.5 0.5 0.5",
          "AIBotManager.setUnplannedDecisionMakingThreshold 0.3 0.4 0.4",
          "AIBotManager.setDecisionMakingInterleave 2 2", "AIBotManager.setSensingQuotient 1 1",
          "AIBotManager.setSystemQuotient 40 40 20", "ai.saiMapXDimension 64", "ai.saiMapYDimension 64",
          "ai.createSAI", "ai.saiEnable 1", "run AIpathFinding.con v_arg1", ""]
    enc = lambda rows: "\r\n".join(rows).encode("latin-1")  # noqa: E731
    return {
        f"{prefix}/Coop.con": conquest.encode("latin-1"),
        f"{prefix}/GameTypes/Coop.con": conquest.encode("latin-1"),
        f"{prefix}/AI.con": enc(ai),
        f"{prefix}/AIpathFinding.con": enc(lines),
    }


def referenced_levels(archive: RfaArchive, prefix: str) -> list[str]:
    """Other levels this level's scripts read files from (`bf1942\\levels\\<name>\\...`):
    a variant of a level (a second day, a night) keeps its terrain in the first one's archive."""
    own = prefix.split("/")[-1].lower()
    found: dict[str, str] = {}
    for name in archive.entries:
        if not name.lower().endswith(".con"):
            continue
        for m in re.finditer(r"(?i)bf1942[\\/]levels[\\/]([^\\/\s]+)[\\/]", archive.read(name).decode("latin-1")):
            if m.group(1).lower() != own:
                found.setdefault(m.group(1).lower(), m.group(1))
    return sorted(found.values(), key=str.lower)


def world_size_of(archive: RfaArchive, prefix: str) -> int:
    hit = next((n for n in archive.entries if n.lower() == f"{prefix}/init/terrain.con".lower()), None)
    m = re.search(r"worldSize\s+(\d+)", archive.read(hit).decode("latin-1"), re.I) if hit else None
    return int(m.group(1)) if m else 1024


def mod_paths(init: str) -> list[str]:
    """The mod folders a mod's `init.con` adds with `game.addModPath Mods/<name>/`,
    in the order it names them (its own first, then the ones it builds on)."""
    found = []
    for m in re.finditer(r"(?im)^\s*game\.addModPath\s+\"?mods[\\/]([^\\/\s\"]+)", init):
        if m.group(1).lower() not in (f.lower() for f in found):
            found.append(m.group(1))
    return found


def find_mod(name: str, roots: list[Path]) -> Path | None:
    """The mod's folder under the first of `roots` that has it, whatever its case on disk."""
    for root in roots:
        for p in sorted(root.iterdir()) if root.is_dir() else ():
            if p.is_dir() and p.name.lower() == name.lower():
                return p
    return None


def link_mod(src: Path, dest: Path, skip=lambda rel: False) -> int:
    """`dest` as a lower-case tree of links to what a server reads under the mod
    folder `src` (the Linux server lower-cases every path before it opens a
    file). `skip` takes a file's lower-case path inside the mod. Nothing is
    copied and `src` is not written. Returns the number of links."""
    links: dict[Path, Path] = {}
    for path in sorted(src.rglob("*")):
        rel = path.relative_to(src)
        low = Path(*(part.lower() for part in rel.parts))
        if path.is_dir() or path.suffix.lower() not in MOD_SUFFIXES:
            continue
        if len(low.parts) > 1 and low.parts[0] in MOD_SKIP_DIRS:
            continue
        if skip(low.as_posix()):
            continue
        if low in links:
            raise ValueError(f"{links[low]} and {path} are one file to a lower-casing server")
        links[low] = path
    for low, path in links.items():
        (dest / low).parent.mkdir(parents=True, exist_ok=True)
        (dest / low).symlink_to(path)
    return len(links)


def map_sizes(root: Path, want: list[str]) -> dict[str, int] | None:
    """The sizes of the `want`ed maps under `root`, or None while one is missing or empty."""
    found = {p.name.lower(): p.stat().st_size for p in root.rglob("*.raw")}
    sizes = {w: found.get(w.lower(), 0) for w in want}
    return sizes if all(v >= 32 for v in sizes.values()) else None


def game_mods_dir(given: str | None) -> Path | None:
    """The retail install's `Mods` folder, with links resolved: the lab's
    container mounts the install at its real path."""
    for c in (given, os.environ.get("BF1942_GAME_DIR"), *GAME_DIRS):
        if c and (Path(c).expanduser() / "Mods").is_dir():
            return (Path(c).expanduser() / "Mods").resolve()
    return None


def run(args) -> int:
    if args.terrain_only and not args.out:
        sys.exit("--terrain-only is a diagnosis: give it an --out that is not the level's layer")
    lab = Path(args.lab).expanduser()
    settings = lab / "server" / "mods" / "bf1942" / "settings"
    if not (lab / "linux-src" / "bf1942_lnxded.static").is_file() or not settings.is_dir():
        sys.exit(f"no lab install at {lab} (tools/bf1942-models/lab/INSTALL.md)")
    # The server's own mods first; any other comes from the client's install.
    roots = [lab / "linux-src" / "mods"] + ([g] if (g := game_mods_dir(args.game)) else [])
    src_mod = find_mod(args.mod, roots)
    if src_mod is None:
        sys.exit(f"no mod {args.mod!r} in the lab's server source or the game install (--game)")
    mod = src_mod.name.lower()
    docker = ["docker", "--context", args.context, "exec"]
    if subprocess.run([*docker, args.container, "pgrep", "bf1942_lnxded"], capture_output=True).returncode == 0:
        sys.exit("a server is running in the lab container; this tool does not share it")
    source = Path(args.archive).resolve()
    archive = RfaArchive(source)
    prefix = level_folder(archive)
    level = prefix.split("/")[-1]
    inst = lab / f"enginemaps-{level.lower()}"
    if inst.exists():
        shutil.rmtree(inst)
    try:
        levels = inst / "mods" / mod / "archives" / "bf1942" / "levels"
        levels.mkdir(parents=True)
        shutil.copy2(lab / "linux-src" / "bf1942_lnxded.static", inst / "bf1942_lnxded")
        # The level's mod without the level's own archives, then every mod its
        # init.con builds on (and vanilla, where the server starts), whole.
        own = f"archives/bf1942/levels/{level.lower()}"
        link_mod(src_mod, inst / "mods" / mod, lambda rel: rel.startswith(own))
        init = (src_mod / "init.con").read_text("latin-1") if (src_mod / "init.con").is_file() else ""
        for name in [*mod_paths(init), "bf1942"]:
            base = find_mod(name, roots)
            if base is None:
                sys.exit(f"{src_mod.name} builds on the mod {name!r}, which is in neither the lab's server source nor the game install")
            if not (inst / "mods" / base.name.lower()).exists():
                link_mod(base, inst / "mods" / base.name.lower())
        # The server starts in vanilla and reads its settings there; the map list names the mod.
        dst_settings = inst / "mods" / "bf1942" / "settings"
        dst_settings.mkdir()
        for f in settings.iterdir():
            if f.is_file():
                shutil.copy2(f, dst_settings / f.name)
        (dst_settings / "maplist.con").write_text(
            f"game.addLevel {level.lower()} GPM_COOP {mod}\r\ngame.setCurrentLevel {level.lower()} GPM_COOP {mod}\r\n")
        conf = (dst_settings / "serversettings.con").read_text()
        for key, port in (("serverPort", 14608), ("gameSpyLANPort", 22041), ("gameSpyPort", 23041), ("ASEPort", 14764)):
            conf = re.sub(rf"(?im)^(game\.{key})\s+\d+", rf"\1 {port}", conf)
        (dst_settings / "serversettings.con").write_text(conf)
        # A level that reads another's files (its terrain, say) needs that archive beside it.
        for other in referenced_levels(archive, prefix):
            hit = next((f for f in sorted(source.parent.iterdir()) if f.name.lower() == f"{other.lower()}.rfa"), None)
            link = levels / f"{other.lower()}.rfa"
            if hit is not None and not link.exists() and not link.is_symlink():
                link.symlink_to(hit)
        rebuild_archive(source, levels / f"{level.lower()}.rfa", script_layer(archive, prefix, world_size_of(archive, prefix), not args.terrain_only))
        for spelling in {level, level.lower()}:
            (inst / "bf1942" / "levels" / spelling / "Pathfinding").mkdir(parents=True, exist_ok=True)
        cmd = [*docker, "-w", str(inst), "-e", "LD_LIBRARY_PATH=/usr/lib32", args.container, "timeout", "-s", "KILL",
               str(args.timeout), "./bf1942_lnxded", "+config", "ServerSettings.con", "+statusMonitor", "0", "+dedicated", "1"]
        want = [f"{name}Level{lv}Map.raw" for name, _, _ in SEARCH_MAPS for lv in LEVELS]
        with (inst / "server.out").open("wb") as out:
            proc = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT)
            # A vanilla level's server aborts once the maps are saved. A mod's
            # (Desert Combat, measured) goes on into the round, so it is stopped
            # when the maps have been there, unchanged, for ten seconds.
            seen, steady = None, 0
            while proc.poll() is None:
                time.sleep(2)
                now = map_sizes(inst / "bf1942" / "levels", want)
                steady = steady + 1 if now is not None and now == seen else 0
                seen = now
                if steady >= 5:
                    subprocess.run([*docker, args.container, "sh", "-c", STOP_SERVER, "sh", str(inst)], capture_output=True)
                    break
            code = proc.wait()
        written = {p.name.lower(): p for p in (inst / "bf1942" / "levels").rglob("*.raw") if "8bit" not in p.name.lower()}
        dest = Path(args.out) if args.out else LAYERS / mod / level.lower()
        missing = [w for w in want if w.lower() not in written or written[w.lower()].stat().st_size < 32]
        if missing:
            tail = (inst / "server.out").read_bytes()[-300:].decode("latin-1", "replace")
            print(f"{level}: the server (exit {code}) did not write {', '.join(missing)}\n{tail}", file=sys.stderr)
            return 1
        (dest / "Pathfinding").mkdir(parents=True, exist_ok=True)
        total = 0
        for w in want:
            data = written[w.lower()].read_bytes()
            (dest / "Pathfinding" / w).write_bytes(data)
            total += len(data)
        print(f"{level}: {len(want)} search maps, {total} bytes, in {dest / 'Pathfinding'} (server exit {code})")
        return 0
    finally:
        if not args.keep:
            # The server makes its profile folders unreadable; open them first.
            subprocess.run(["chmod", "-R", "u+rwX", str(inst)], capture_output=True)
            shutil.rmtree(inst, ignore_errors=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--mod", default="bf1942", help="the mod folder the level belongs to (any case)")
    ap.add_argument("--game", help="the retail install a mod the lab's server lacks is linked from "
                                   "(default BF1942_GAME_DIR, then the usual places)")
    ap.add_argument("--archive", required=True, help="the level's archive (read, never written)")
    ap.add_argument("--out", help="the layer folder (default bot-layers/<mod>/<level>)")
    ap.add_argument("--lab", default="~/bf1942-lab")
    ap.add_argument("--context", default="colima-bf1942-lab-x86")
    ap.add_argument("--container", default="bf1942-lab-linux")
    ap.add_argument("--timeout", type=int, default=480, help="seconds before the server is killed")
    ap.add_argument("--terrain-only", action="store_true",
                    help="a diagnosis: paint before the statics are loaded, to see what the terrain alone leaves free")
    ap.add_argument("--keep", action="store_true", help="leave the private instance for inspection")
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
