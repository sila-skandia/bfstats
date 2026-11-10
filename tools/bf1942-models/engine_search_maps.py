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

    python3 engine_search_maps.py --mod bf1942 --level shigaisen_B \
        --archive ../../community-mappack-by-michaels/shigaisen_B.rfa

The level is started in co-op with a script layer made for the run: its
Conquest script as `Coop.con`, a minimal `AI.con`, and an `AIpathFinding.con`
that declares `Tank0` and `Infantry1` with DICE's usual numbers, seeds the
flood with the level's soldier spawns and asks for the maps. The server
aborts after it has saved them (`free(): invalid pointer`), before any
strategic map; that is expected and is why none is collected.

The engine reads an archive only if the 148-byte block after its 8-byte
header and its trailing bytes are those of a game archive, so the rebuilt
archive keeps the source's and stores the added files as literal-only LZO
(or as they are, when the source archive is stored uncompressed).
"""

from __future__ import annotations

import argparse
import re
import shutil
import struct
import subprocess
import sys
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


def script_layer(archive: RfaArchive, prefix: str, world_size: int) -> dict[str, bytes]:
    """The files the run adds: co-op from Conquest, the AI start, the map request."""
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
    lines += ["ai.loadMaps", "run StaticObjects", "ai.createAllMaps", ""]
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


def run(args) -> int:
    lab = Path(args.lab).expanduser()
    src_mod = lab / "linux-src" / "mods" / args.mod
    settings = lab / "server" / "mods" / "bf1942" / "settings"
    if not (lab / "linux-src" / "bf1942_lnxded.static").is_file() or not settings.is_dir():
        sys.exit(f"no lab install at {lab} (tools/bf1942-models/lab/INSTALL.md)")
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
        levels = inst / "mods" / args.mod / "archives" / "bf1942" / "levels"
        levels.mkdir(parents=True)
        shutil.copy2(lab / "linux-src" / "bf1942_lnxded.static", inst / "bf1942_lnxded")
        for name in ("init.con", "contentcrc32.con", "lexiconall.dat"):
            if (src_mod / name).is_file():
                shutil.copy2(src_mod / name, inst / "mods" / args.mod / name)
        dst_settings = inst / "mods" / args.mod / "settings"
        dst_settings.mkdir()
        for f in settings.iterdir():
            if f.is_file():
                shutil.copy2(f, dst_settings / f.name)
        (dst_settings / "maplist.con").write_text(
            f"game.addLevel {level} GPM_COOP {args.mod}\r\ngame.setCurrentLevel {level} GPM_COOP {args.mod}\r\n")
        conf = (dst_settings / "serversettings.con").read_text()
        for key, port in (("serverPort", 14608), ("gameSpyLANPort", 22041), ("gameSpyPort", 23041), ("ASEPort", 14764)):
            conf = re.sub(rf"(?im)^(game\.{key})\s+\d+", rf"\1 {port}", conf)
        (dst_settings / "serversettings.con").write_text(conf)
        arch_src = src_mod / "archives"
        for f in arch_src.iterdir():
            if f.name != "bf1942":
                (inst / "mods" / args.mod / "archives" / f.name).symlink_to(f)
        (inst / "mods" / args.mod / "archives" / "bf1942" / "game.rfa").symlink_to(arch_src / "bf1942" / "game.rfa")
        for f in (arch_src / "bf1942" / "levels").iterdir():
            if not f.name.lower().startswith(level.lower()):
                (levels / f.name).symlink_to(f)
        # A level that reads another's files (its terrain, say) needs that archive beside it.
        for other in referenced_levels(archive, prefix):
            hit = next((f for f in sorted(source.parent.iterdir()) if f.name.lower() == f"{other.lower()}.rfa"), None)
            link = levels / f"{other.lower()}.rfa"
            if hit is not None and not link.exists() and not link.is_symlink():
                link.symlink_to(hit)
        rebuild_archive(source, levels / f"{level.lower()}.rfa", script_layer(archive, prefix, world_size_of(archive, prefix)))
        for spelling in {level, level.lower()}:
            (inst / "bf1942" / "levels" / spelling / "Pathfinding").mkdir(parents=True, exist_ok=True)
        cmd = [*docker, "-w", str(inst), "-e", "LD_LIBRARY_PATH=/usr/lib32", args.container, "timeout", "-s", "KILL",
               str(args.timeout), "./bf1942_lnxded", "+config", "ServerSettings.con", "+statusMonitor", "0", "+dedicated", "1"]
        with (inst / "server.out").open("wb") as out:
            code = subprocess.run(cmd, stdout=out, stderr=subprocess.STDOUT).returncode
        written = {p.name.lower(): p for p in (inst / "bf1942" / "levels").rglob("*.raw") if "8bit" not in p.name.lower()}
        dest = Path(args.out) if args.out else LAYERS / args.mod.lower() / level.lower()
        want = [f"{name}Level{lv}Map.raw" for name, _, _ in SEARCH_MAPS for lv in LEVELS]
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
    ap.add_argument("--mod", default="bf1942", help="the mod folder the level belongs to")
    ap.add_argument("--archive", required=True, help="the level's archive (read, never written)")
    ap.add_argument("--out", help="the layer folder (default bot-layers/<mod>/<level>)")
    ap.add_argument("--lab", default="~/bf1942-lab")
    ap.add_argument("--context", default="colima-bf1942-lab-x86")
    ap.add_argument("--container", default="bf1942-lab-linux")
    ap.add_argument("--timeout", type=int, default=480, help="seconds before the server is killed")
    ap.add_argument("--keep", action="store_true", help="leave the private instance for inspection")
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
