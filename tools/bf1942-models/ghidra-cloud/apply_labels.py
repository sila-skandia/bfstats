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

import os
import sys

# Where setup.sh installs Ghidra; its own export doesn't outlive setup.sh.
os.environ.setdefault("GHIDRA_INSTALL_DIR", os.path.expanduser("~/ghidra-installs/ghidra_12.1.2_PUBLIC"))

import pyghidra

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
    if program.isChanged():
        project.save(program)  # writes the committed transactions to disk
        print("SAVED")
    else:
        print("UNCHANGED (not saved)")
finally:
    project.close()
print("DONE")
