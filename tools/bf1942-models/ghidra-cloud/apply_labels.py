# Open an existing Ghidra project program, exec a Ghidra script against it
# (with currentProgram/println globals like a headless script), and save.
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

import sys

import pyghidra

pyghidra.start()

from ghidra.base.project import GhidraProject
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
    if fm_count < 1000 and program_name.startswith(("BF1942", "bf1942")):
        print("WARNING: program looks unanalyzed (<1000 functions) — run analysis first")
    for script_path in scripts:
        src = open(script_path).read()
        g = {"currentProgram": program, "println": print, "print": print,
             "getCurrentProgram": lambda: program, "monitor": ConsoleTaskMonitor(),
             "transaction": lambda desc="script": pyghidra.transaction(program, desc)}
        with pyghidra.transaction(program, "apply script " + script_path):
            exec(compile(src, script_path, "exec"), g)
        print(f"RAN {script_path}")
    project.save(program)  # commits the open transaction and writes to disk
    print("SAVED")
finally:
    project.close()
print("DONE")
