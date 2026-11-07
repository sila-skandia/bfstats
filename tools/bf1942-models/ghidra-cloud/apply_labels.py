# Open an existing Ghidra project program, exec a Ghidra script against it
# (with currentProgram/println/monitor and the flat API -- toAddr,
# getFunctionAt, getReferencesTo, ... -- like a headless GhidraScript), and
# save if the script changed anything. Print-only query scripts leave the
# project untouched.
#
# Usage: python3 apply_labels.py <project_dir> <project_name> <program_name> <script.py> [more scripts...]
#
# Example:
#   python3 apply_labels.py /tmp/clientproj2 bf1942-client BF1942.exe ghidra_label.py
#
# Why not `pyghidra <binary> <script.py>`: the CLI re-imports a fresh,
# unanalyzed copy unless the binary MD5 matches the project program, which
# silently discards the analyzed state. This script opens the program that is
# ALREADY in the project, by name.

import glob
import os
import sys

# Where setup.sh installs Ghidra; its own export doesn't outlive setup.sh.
# On macOS that is Homebrew's ghidra formula, with its keg-only openjdk.
_brew = sorted(glob.glob("/opt/homebrew/Cellar/ghidra/*/libexec"))
_cloud = os.path.expanduser("~/ghidra-installs/ghidra_12.1.2_PUBLIC")
os.environ.setdefault("GHIDRA_INSTALL_DIR", _cloud if os.path.isdir(_cloud) or not _brew else _brew[-1])
if "JAVA_HOME" not in os.environ:
    for _jdk in ("openjdk@25", "openjdk@21", "openjdk"):
        _home = f"/opt/homebrew/opt/{_jdk}/libexec/openjdk.jdk/Contents/Home"
        if os.path.isdir(_home):
            os.environ["JAVA_HOME"] = _home
            break

try:
    import pyghidra
except ImportError:
    # setup.sh installs PyGhidra into this venv on macOS; re-run under it.
    _venv_dir = os.path.expanduser("~/ghidra-installs/venv")
    _venv = os.path.join(_venv_dir, "bin", "python")
    if os.path.exists(_venv) and os.path.realpath(sys.prefix) != os.path.realpath(_venv_dir):
        os.execv(_venv, [_venv, *sys.argv])
    raise

pyghidra.start()

from ghidra.base.project import GhidraProject
from ghidra.program.flatapi import FlatProgramAPI
from ghidra.program.model.listing import Program
from ghidra.util.task import ConsoleTaskMonitor

project_dir, project_name, program_name = sys.argv[1:4]
scripts = sys.argv[4:]
assert scripts, "need at least one Ghidra script to run"

project = GhidraProject.openProject(project_dir, project_name, True)
try:
    root = project.getProjectData().getRootFolder()
    domain_file = root.getFile(program_name)
    assert domain_file is not None, f"program {program_name!r} not in project root"
    program = project.openProgram("/", program_name, False)  # writable handle
    fm_count = program.getFunctionManager().getFunctionCount()
    sym_count = program.getSymbolTable().getNumSymbols()
    print(f"OPENED {program_name}: {fm_count} functions, {sym_count} symbols")
    # Not a function count: the ELF loader alone makes ~40k functions from symbols.
    if not program.getOptions(Program.PROGRAM_INFO).getBoolean(Program.ANALYZED_OPTION_NAME, False):
        print("WARNING: program was never auto-analyzed (no xrefs/types) — run analysis first")
    # isChanged() can stay False after a committed transaction (seen on
    # Ghidra 12.1.2 under PyGhidra 3.1.0, 2026-10-11: a comment written in a
    # transaction was dropped as "UNCHANGED"). The modification number counts
    # committed changes and does not move for a read-only script.
    modified_at_open = program.getModificationNumber()
    monitor = ConsoleTaskMonitor()
    flat = FlatProgramAPI(program, monitor)
    for script_path in scripts:
        src = open(script_path).read()
        # Methods only: dir() also lists JPype bean properties, some setter-only.
        g = {m.getName(): getattr(flat, m.getName()) for m in FlatProgramAPI.class_.getMethods()}
        g.update({"currentProgram": program, "println": print, "print": print,
                  "getCurrentProgram": lambda: program, "monitor": monitor,
                  "transaction": lambda desc="script": pyghidra.transaction(program, desc)})
        with pyghidra.transaction(program, "apply script " + script_path):
            exec(compile(src, script_path, "exec"), g)
        print(f"RAN {script_path}")
    if program.isChanged() or program.getModificationNumber() != modified_at_open:
        project.save(program)  # writes the committed transactions to disk
        print("SAVED")
    else:
        print("UNCHANGED (not saved)")
finally:
    project.close()
print("DONE")
