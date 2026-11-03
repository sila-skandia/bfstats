#!/usr/bin/env python3
"""Look an address or a name up in the third-party bf1942reverseengineering corpus.

That repo (github.com/JayBiggsGMG/bf1942reverseengineering, public, ~650 MB) holds
Ghidra C dumps of four builds plus the author's notes:

    winpc     BF1942.exe -- the SAME build symbols.json is pinned to (all 16,158
              function entries match client-functions.txt), so addresses carry over 1:1.
              Mostly FUN_ names.
    mac       the Mac client, with symbols. Client-only code (renderer, menus, input)
              under real names, which lnxded does not have. Its addresses are its own.
    linux     bf1942_lnxded.dynamic 1.61. Named like our lnxded.static, but a
              different link: match by name, never by address.
    debugger  a Windows debugger build, almost all FUN_ names.

It is a fallback explanation, not evidence. Nothing it says goes into the ledger
until our own binary shows it (see README, "The second corpus").

    ./recorpus.py 0x0053b950           # WinPC: the function holding this address,
                                       # its C, catalog rows and notes that cite it
    ./recorpus.py BFPlayer::setVehicle # every build's functions whose signature matches
    ./recorpus.py setVehicle --build mac --show 2   # print the first two bodies
    ./recorpus.py 0x0805c720 --build linux          # by address in another build

The corpus is found at $BF1942_RE_REPO, else ~/projects/skandia/bf1942reverseengineering.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLIENT_FUNCTIONS = HERE / "client-functions.txt"
DEFAULT_ROOT = Path.home() / "projects/skandia/bf1942reverseengineering"
CACHE_DIR = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "bfstats"

BUILDS = {
    "winpc": "decompiled_functions_bf1942exeWinPC",
    "mac": "decompiled_functions_MacClient",
    "linux": "decompiled_functions_bf42linuxServer",
    "debugger": "decompiled_functions_bf1942Debugger",
}
CATALOG_BUILD = {"winpc": "winpc", "linux_server": "linux", "mac_client": "mac"}
NOTE_GLOBS = ["@*.md", "@*.json", "*.md", "*.txt", "*.h"]
ADDR_RE = re.compile(r"(?:0x)?([0-9a-fA-F]{8})")
HEADER_ADDR = re.compile(r"(?:Address|Entry):\s*(?:0x)?([0-9a-fA-F]+)")
SIGNATURE = re.compile(r"^/\*\s*(.+?)\s*\*/\s*$")


def find_root(arg: str | None) -> Path:
    root = Path(arg or os.environ.get("BF1942_RE_REPO") or DEFAULT_ROOT).expanduser()
    if not (root / BUILDS["winpc"]).is_dir():
        sys.exit(
            f"no corpus at {root}. Clone it (public, ~650 MB):\n"
            f"  git clone --depth 1 https://github.com/JayBiggsGMG/bf1942reverseengineering {root}\n"
            "or point BF1942_RE_REPO at a checkout."
        )
    return root


def parse_header(path: Path) -> tuple[int | None, str]:
    """(address, best name) from a dump file's comment header and signature line."""
    addr, name, signature = None, path.stem, None
    with path.open(errors="replace") as fh:
        for _, line in zip(range(12), fh):
            if addr is None and (m := HEADER_ADDR.search(line)):
                addr = int(m.group(1), 16)
            elif line.startswith(("// Function:", " * Function:", "// Original:")):
                name = line.split(":", 1)[1].strip()
            elif (signature is None and (m := SIGNATURE.match(line))
                  and not m.group(1).startswith(("WARNING", "Program:"))):
                signature = m.group(1)
    return addr, signature or name


def build_index(root: Path) -> list[dict]:
    """One row per dump file across all builds, cached on the corpus HEAD."""
    try:
        head = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        head = "nogit"
    cache = CACHE_DIR / f"recorpus-{head}.json"
    if head != "nogit" and cache.exists():
        return json.loads(cache.read_text())
    rows = []
    for build, folder in BUILDS.items():
        for path in sorted((root / folder).glob("*.c")):
            addr, name = parse_header(path)
            rows.append({"build": build, "addr": addr, "name": name,
                         "path": str(path.relative_to(root))})
    demangle(rows)
    if head != "nogit":
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(rows))
    return rows


def demangle(rows: list[dict]) -> None:
    """Mac names that kept their mangled form (__ZN4dice...) get c++filt's reading."""
    mangled = [r for r in rows if r["name"].startswith("__Z")]
    if not mangled:
        return
    try:
        out = subprocess.run(["c++filt"], input="\n".join(r["name"][1:] for r in mangled),
                             capture_output=True, text=True, check=True).stdout.splitlines()
    except (OSError, subprocess.CalledProcessError):
        return
    for row, name in zip(mangled, out):
        row["name"] = name if not name.startswith("_Z") else qualified_name(row["name"])


def qualified_name(mangled: str) -> str:
    """dice::ref2::rend::Foo::bar(...) from __ZN4dice4ref24rend3Foo3barE..., which
    c++filt rejects when the exporter left a dangling substitution."""
    m = re.match(r"_+ZNK?", mangled)
    if not m:
        return mangled
    parts, s = [], mangled[m.end():]
    while d := re.match(r"\d+", s):
        n = int(d.group())
        parts.append(s[d.end(): d.end() + n])
        s = s[d.end() + n:]
    if s.startswith(("D0", "D1", "D2")) and parts:
        parts.append("~" + parts[-1])
    elif s.startswith(("C1", "C2")) and parts:
        parts.append(parts[-1])
    return "::".join(parts) + "(...)" if len(parts) > 1 else mangled


def load_catalog(root: Path) -> list[dict]:
    path = root / "symbols/exports/confirmed_functions.csv"
    if not path.exists():
        return []
    with path.open(newline="") as fh:
        return list(csv.DictReader(fh))


def containing_client_function(addr: int) -> int | None:
    """Entry of the BF1942.exe function whose body holds addr (our function table)."""
    starts, ends = [], []
    for line in CLIENT_FUNCTIONS.read_text().splitlines():
        if line and not line.startswith("#"):
            a, b = line.split()[:2]
            starts.append(int(a, 16))
            ends.append(int(b, 16))
    i = bisect.bisect_right(starts, addr) - 1
    return starts[i] if i >= 0 and addr <= ends[i] else None


def note_hits(root: Path, needles: list[str], per_file: int = 6) -> list[str]:
    files = sorted({p for g in NOTE_GLOBS for p in root.glob(g) if p.is_file()})
    lowered = [n.lower() for n in needles]
    out = []
    for path in files:
        hits = 0
        for n, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
            if any(k in line.lower() for k in lowered):
                out.append(f"  {path.name}:{n}: {line.strip()[:220]}")
                hits += 1
                if hits >= per_file:
                    out.append(f"  {path.name}: ... more, grep it")
                    break
    return out


def show(root: Path, rows: list[dict], count: int, max_lines: int) -> None:
    for row in rows[:count]:
        lines = (root / row["path"]).read_text(errors="replace").splitlines()
        print(f"\n===== {row['build']} {row['path']}")
        print("\n".join(lines[:max_lines]))
        if len(lines) > max_lines:
            print(f"... {len(lines) - max_lines} more lines")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("query", help="hex address or a (partial, case-insensitive) function name")
    ap.add_argument("--build", choices=[*BUILDS, "all"], help="address default: winpc; name default: all")
    ap.add_argument("--show", type=int, default=None, metavar="N", help="print the first N bodies")
    ap.add_argument("--lines", type=int, default=120, help="max lines per printed body")
    ap.add_argument("--limit", type=int, default=40, help="max matches listed")
    ap.add_argument("--root", help="corpus checkout (default $BF1942_RE_REPO or ~/projects/skandia/...)")
    args = ap.parse_args(argv)

    root = find_root(args.root)
    index = build_index(root)
    catalog = load_catalog(root)
    m = ADDR_RE.fullmatch(args.query.strip())

    if m:
        addr = int(m.group(1), 16)
        build = args.build if args.build not in (None, "all") else "winpc"
        entry = addr
        if build == "winpc":
            entry = containing_client_function(addr)
            if entry is None:
                print(f"0x{addr:08x} is inside no BF1942.exe function in client-functions.txt")
                entry = addr
            elif entry != addr:
                print(f"0x{addr:08x} is inside the function at 0x{entry:08x}")
        matches = [r for r in index if r["build"] == build and r["addr"] == entry]
        cat = [c for c in catalog if CATALOG_BUILD.get(c["build"]) == build
               and int(c["address"], 16) == entry]
        hex8 = f"{entry:08x}"
        needles = [hex8, f"FUN_{hex8}"] + [r["name"] for r in matches
                                           if not r["name"].startswith("FUN_")]
    else:
        q = args.query.lower()
        alt = q.replace("::", "_")
        build = args.build or "all"
        matches = [r for r in index if (build == "all" or r["build"] == build)
                   and (q in r["name"].lower() or alt in Path(r["path"]).stem.lower())]
        cat = [c for c in catalog if q in c["display_name"].lower()
               or q in c["canonical_name"].lower() or q in c["decompiled_name"].lower()]
        needles = [args.query]

    print(f"dump files ({len(matches)}):")
    for r in matches[: args.limit]:
        at = f"0x{r['addr']:08x}" if r["addr"] is not None else "?"
        print(f"  {r['build']:8} {at}  {r['name'][:110]}\n           {r['path']}")
    if len(matches) > args.limit:
        print(f"  ... {len(matches) - args.limit} more (--limit, or narrow the name)")
    print(f"\nconfirmed catalog ({len(cat)}):")
    for c in cat[: args.limit]:
        print(f"  {c['build']} {c['address']} {c['canonical_name']} "
              f"[{c['symbol_confidence']}] {c['rationale'][:160]}")
    hits = note_hits(root, needles)
    print(f"\nnotes ({len(hits)} lines):")
    print("\n".join(hits[:60]) if hits else "  none")
    if args.show:
        show(root, matches, args.show, args.lines)
    return 0


if __name__ == "__main__":
    sys.exit(main())
