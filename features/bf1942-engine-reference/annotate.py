#!/usr/bin/env python3
"""Put the ledger and symbols.json into a Ghidra project: one command.

    ./annotate.py <project_dir> <project>                 # regenerate, then annotate
    ./annotate.py <project_dir> <project> --from ~/ghidra # take a fresh copy first
    ./annotate.py <project_dir> <project> --query 0x08163dd0,0x08163fd6
    ./annotate.py <project_dir> <project> --strip         # remove every annotation

It runs `ledger_index.py` (ledger.md -> ledger-index.json, ledger-gaps.md) and
then `ghidra_ledger.py` against the program in the project, headless. What is
written and how it stays idempotent is in that script's header.

The project is `linux-server` (program bf1942_lnxded.static) or
`bf1942-mp-enabler` / `bf1942-client` (program BF1942.exe); `--program` names
another. Work on a copy: `--from DIR` replaces <project_dir>/<project> with a
copy of DIR/<project> before annotating. A project under ~/ghidra is refused
unless `--write-real-project` is given, which is for the owner to type.

Ghidra refuses a project path with an element that starts with a dot, so the
copies cannot live under ~/.cache; ~/ghidra-annotated is what this PC uses.
One headless Ghidra at a time, and not while the GUI has the same project open.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
CLOUD = REPO / "tools/bf1942-models/ghidra-cloud"
CACHE = Path.home() / ".cache/bfstats-ghidra"
REAL = Path.home() / "ghidra"
PROGRAMS = {
    "linux-server": "bf1942_lnxded.static",
    "bf1942-mp-enabler": "BF1942.exe",
    "bf1942-client": "BF1942.exe",
}


def python_with_pyghidra() -> str:
    for exe in (sys.executable, str(CACHE / "venv/bin/python")):
        if Path(exe).exists() and subprocess.run(
                [exe, "-c", "import pyghidra"], capture_output=True).returncode == 0:
            return exe
    sys.exit(
        "No Python with pyghidra. On this PC:\n"
        f"  python3 -m venv {CACHE}/venv && {CACHE}/venv/bin/pip install --no-index "
        "--find-links /opt/ghidra/Ghidra/Features/PyGhidra/pypkg/dist pyghidra\n"
        "In a cloud session: tools/bf1942-models/ghidra-cloud/setup.sh")


def ghidra_dir() -> str:
    for c in (os.environ.get("GHIDRA_INSTALL_DIR"), "/opt/ghidra",
              str(Path.home() / "ghidra-installs/ghidra_12.1.2_PUBLIC")):
        if c and Path(c, "Ghidra").is_dir():
            return c
    sys.exit("Ghidra not found; set GHIDRA_INSTALL_DIR")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project_dir", type=Path)
    ap.add_argument("project")
    ap.add_argument("--program")
    ap.add_argument("--from", dest="source", type=Path, metavar="DIR",
                    help="first replace the project with a copy of DIR/<project>")
    ap.add_argument("--no-regen", action="store_true", help="use ledger-index.json as it is")
    ap.add_argument("--query", metavar="ADDRS", help="read annotations back; writes nothing")
    ap.add_argument("--strip", action="store_true", help="remove everything this ever wrote")
    ap.add_argument("--dump-client-functions", action="store_true",
                    help="rewrite client-functions.txt from the project's BF1942.exe")
    ap.add_argument("--report", type=Path, help="write the counts here as JSON")
    ap.add_argument("--write-real-project", action="store_true",
                    help="allow a project under ~/ghidra (the owner's)")
    args = ap.parse_args()

    project_dir = args.project_dir.expanduser().resolve()
    program = args.program or PROGRAMS.get(args.project)
    if not program:
        sys.exit(f"which program is in {args.project}? pass --program")
    read_only = bool(args.query or args.dump_client_functions)
    real = REAL.resolve()
    is_real = project_dir == real or real in project_dir.parents
    if is_real and args.source:
        sys.exit("--from replaces the project it copies over; never into ~/ghidra")
    if is_real and not read_only and not args.write_real_project:
        sys.exit(f"{project_dir} holds the owner's projects. Annotate a copy:\n"
                 f"  {sys.argv[0]} ~/ghidra-annotated {args.project} --from ~/ghidra\n"
                 "or, as the owner, add --write-real-project.")
    if any(p.startswith(".") for p in project_dir.parts[1:]):
        sys.exit(f"Ghidra refuses a project path with a dot-directory in it: {project_dir}")

    if args.source:
        src = args.source.expanduser().resolve()
        if src == project_dir:
            sys.exit("--from is the project directory itself")
        project_dir.mkdir(parents=True, exist_ok=True)
        for suffix in (".gpr", ".rep"):
            dst = project_dir / (args.project + suffix)
            if dst.is_dir():
                shutil.rmtree(dst)
            elif dst.exists():
                dst.unlink()
            s = src / (args.project + suffix)
            shutil.copytree(s, dst) if s.is_dir() else shutil.copy2(s, dst)
        print(f"copied {src}/{args.project} to {project_dir}")
    if not (project_dir / (args.project + ".rep")).is_dir():
        sys.exit(f"no project {args.project} in {project_dir} (try --from ~/ghidra)")

    if not args.no_regen and not read_only and not args.strip:
        subprocess.run([sys.executable, str(HERE / "ledger_index.py"), "--quiet"], check=True)

    env = dict(os.environ)
    env["GHIDRA_INSTALL_DIR"] = ghidra_dir()
    # /tmp is a small per-user tmpfs on this PC, and Ghidra unpacks into TMPDIR.
    tmp = CACHE / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    env["TMPDIR"] = str(tmp)
    env["BFSTATS_LEDGER_INDEX"] = str(HERE / "ledger-index.json")
    env["BFSTATS_SYMBOLS"] = str(HERE / "symbols.json")
    script = "ghidra_ledger.py"
    if args.query or args.dump_client_functions:
        script = "ghidra_ledger_query.py"
        env["BFSTATS_LEDGER_QUERY"] = args.query or ""
        if args.dump_client_functions:
            env["BFSTATS_FUNC_DUMP"] = str(tmp / "client-functions.dump")
    report = args.report or (tmp / f"annotate-{args.project}-{program}.json")
    env["BFSTATS_LEDGER_REPORT"] = str(report)
    if args.strip:
        env["BFSTATS_LEDGER_STRIP"] = "1"

    cmd = [python_with_pyghidra(), str(CLOUD / "apply_labels.py"),
           str(project_dir), args.project, program, str(CLOUD / script)]
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True)
    noise = ("WARNING: ", "INFO  ", "\tat ")
    for line in (proc.stdout + proc.stderr).splitlines():
        if not line.startswith(noise):
            print(line)
    if proc.returncode:
        sys.exit(proc.returncode)

    if args.dump_client_functions:
        lines = sorted(Path(env["BFSTATS_FUNC_DUMP"]).read_text().splitlines())
        head = ("# BF1942.exe function table: the entry and the last byte of each function body\n"
                "# in the bf1942-mp-enabler Ghidra project. ledger_index.py reads it to tell a\n"
                "# function entry from an address inside one. Regenerate, after functions are\n"
                "# created in Ghidra, with ./annotate.py <dir> <project> --dump-client-functions\n")
        (HERE / "client-functions.txt").write_text(head + "\n".join(lines) + "\n")
        print(f"client-functions.txt: {len(lines)} functions")
    elif not args.query:
        print(f"counts: {report}")
        if report.exists():
            n = json.loads(report.read_text())
            if n.get("label_conflicts") or n.get("outside_program"):
                print(f"  {len(n['label_conflicts'])} label conflicts, "
                      f"{len(n['outside_program'])} addresses outside the program: see the file")


if __name__ == "__main__":
    main()
