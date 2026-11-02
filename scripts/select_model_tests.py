#!/usr/bin/env python3
"""Pick the BF1942 tool tests a change can reach, so verify.sh runs those
instead of all ~490 files (25 minutes) for a one-file edit.

No tags to keep up: the selection follows references. Every code file in the
repo is scanned for the names of other files it uses (`import audit_mod`,
`imp('replay-accuracy.js')`, `"damage.json"`, `'./replay-recording.js'`).
A changed file reaches every file that names it, and those that name them in
turn; the test files reached are the ones to run. So a change to
viewer/replay-recording.js runs the tests whose harnesses import any viewer
module that imports it, and a change to api/ runs none of them.

A test that scans a folder (`VIEWER.glob("*.js")`, `iterdir`, `readdirSync`)
names no file, so it would never be reached. Such a test runs on every change
unless it says what it watches, in a comment of its own:

    # watches: tools/bf1942-models/viewer/*.js tools/bf1942-models/viewer/map.html

Paths are from the repo root, fnmatch patterns (`*` crosses folders).

Everything runs when the selector or verify.sh itself changed, and on --all.

  scripts/select_model_tests.py                 # changes since origin/main, plus the working tree
  scripts/select_model_tests.py --files a b     # these paths instead
  scripts/select_model_tests.py --explain       # why each test was picked, on stderr
  scripts/select_model_tests.py --changed       # just the changed files

Prints `ALL`, nothing (no test reachable), or one test module per line.
"""

from __future__ import annotations

import argparse
import fnmatch
import re
import subprocess
import sys
from collections import defaultdict, deque
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TESTS = "tools/bf1942-models/tests"
# Files whose change means the selection itself may be wrong.
RUN_ALL = {"scripts/verify.sh", "scripts/select_model_tests.py"}
SCANNED = {".py", ".js", ".mjs", ".cjs", ".html", ".sh", ".ts", ".vue"}
SKIP_DIRS = ("node_modules/", "/node_modules/")
# A file name as code uses it: a string literal that is only a path,
# `'./replay-accuracy.js'`, `"damage.json"`, `ROOT / "audit_mod.py"`. A name in
# a comment or a sentence is not a use, and would tie everything together.
NAME = re.compile(r"""["']\.{0,2}/?((?:[\w\-.]+/)*[\w\-]+(?:\.[\w\-]+)+)["']""")
PY_IMPORT = re.compile(r"^\s*(?:from\s+([\w.]+)\s+import\s+\(?([\w\s,]+)\)?|import\s+([\w.,\s]+?)(?:\s+as\s+\w+)?\s*$)", re.M)
FOLDER_SCAN = re.compile(r"\.(?:r?glob|iterdir)\(|os\.walk|os\.listdir|readdirSync|readdir\(")
WATCHES = re.compile(r"^\s*(?:#|//)\s*watches:\s*(.+)$", re.M)


def git(*args: str) -> list[str]:
    out = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True)
    return [line for line in out.stdout.splitlines() if line.strip()] if out.returncode == 0 else []


def changed_files() -> list[str]:
    """Commits since this branch left origin/main, the working tree, and new files."""
    base = git("merge-base", "HEAD", "origin/main")
    files = set(git("diff", "--name-only", base[0], "HEAD")) if base else set()
    files |= set(git("diff", "--name-only", "HEAD"))
    files |= set(git("ls-files", "--others", "--exclude-standard"))
    return sorted(files)


def repo_files() -> list[str]:
    files = set(git("ls-files")) | set(git("ls-files", "--others", "--exclude-standard"))
    return sorted(f for f in files if not any(s in f or f.startswith(s.lstrip("/")) for s in SKIP_DIRS))


def references(text: str, py: bool) -> tuple[set[str], set[str]]:
    """The file names a source mentions, and (Python) the modules it imports."""
    names = set(NAME.findall(text))
    modules: set[str] = set()
    if py:
        for frm, what, imp in PY_IMPORT.findall(text):
            if frm:
                modules.update(frm.split("."))
                modules.update(w.strip() for w in what.replace("\n", ",").split(",") if w.strip())
            else:
                for part in imp.split(","):
                    modules.update(part.strip().split(" ")[0].split("."))
    return names, modules


def build(files: list[str]):
    by_name: dict[str, list[str]] = defaultdict(list)
    by_module: dict[str, list[str]] = defaultdict(list)
    for f in files:
        name = f.rsplit("/", 1)[-1]
        by_name[name].append(f)
        if name.endswith(".py"):
            by_module[name[:-3]].append(f)
    # users[x]: the files that name x.
    users: dict[str, set[str]] = defaultdict(set)
    tests: dict[str, dict] = {}
    for f in files:
        if Path(f).suffix not in SCANNED:
            continue
        try:
            text = (REPO / f).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        names, modules = references(text, f.endswith(".py"))
        for n in names:
            for target in by_name.get(n.rsplit("/", 1)[-1], []):
                users[target].add(f)
        for m in modules:
            for target in by_module.get(m, []):
                users[target].add(f)
        if f.startswith(TESTS + "/") and "/" not in f[len(TESTS) + 1:]:
            watches = [w for line in WATCHES.findall(text) for w in line.split()]
            tests[f] = {
                "watches": watches,
                "scans": bool(FOLDER_SCAN.search(text)),
                "is_test": f.rsplit("/", 1)[-1].startswith("test_") and f.endswith(".py"),
            }
    return users, tests


def select(changed: list[str], explain=None):
    if not changed:
        return []
    if RUN_ALL & set(changed):
        return "ALL"
    files = repo_files()
    users, tests = build(files)
    picked: dict[str, str] = {}
    # A helper the tests share (a harness, a page reader) that scans a folder
    # hands its scan, or what it watches, to every test that uses it.
    for f, info in list(tests.items()):
        if info["is_test"] or not (info["scans"] or info["watches"]):
            continue
        for t in reach(users, [f]):
            if t in tests and tests[t]["is_test"] and not tests[t]["watches"]:
                tests[t]["scans"] = tests[t]["scans"] or (info["scans"] and not info["watches"])
                tests[t]["inherited"] = tests[t].get("inherited", []) + info["watches"]
    seen = reach(users, changed)
    for f in seen:
        if f in tests and tests[f]["is_test"]:
            picked[f] = f"reaches {seen[f]}" if seen[f] != f else "changed"
    for f, info in tests.items():
        if not info["is_test"] or f in picked:
            continue
        watches = info["watches"] or info.get("inherited", [])
        hit = next((c for c in changed for w in watches if fnmatch.fnmatch(c, w)), None)
        if hit:
            picked[f] = f"watches {hit}"
        elif info["scans"] and not info["watches"]:
            picked[f] = "scans a folder and names no watches"
    if explain:
        chain = lambda f: " <- ".join(_chain(seen, f))
        for f in sorted(picked):
            why = picked[f]
            print(f"{f.rsplit('/', 1)[-1]}: {why}" + (f"  [{chain(f)}]" if why.startswith("reaches") else ""), file=explain)
    return sorted(f.rsplit("/", 1)[-1][:-3] for f in picked)


def reach(users: dict[str, set[str]], start: list[str]) -> dict[str, str]:
    """Every file that names one of `start`, directly or through others:
    `{file: the file it named on the way}`."""
    seen = {f: f for f in start}
    queue = deque(start)
    while queue:
        cur = queue.popleft()
        for u in users.get(cur, ()):
            if u not in seen:
                seen[u] = cur
                queue.append(u)
    return seen


def _chain(seen: dict[str, str], f: str) -> list[str]:
    out = [f.rsplit("/", 1)[-1]]
    while seen.get(f, f) != f:
        f = seen[f]
        out.append(f.rsplit("/", 1)[-1])
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--files", nargs="*", help="changed paths, from the repo root (default: git)")
    ap.add_argument("--all", action="store_true", help="print ALL")
    ap.add_argument("--explain", action="store_true", help="why each test was picked, on stderr")
    ap.add_argument("--changed", action="store_true", help="print the changed files the default selection uses, and stop")
    args = ap.parse_args()
    if args.changed:
        print("\n".join(changed_files()))
        return 0
    if args.all:
        print("ALL")
        return 0
    changed = args.files if args.files is not None else changed_files()
    result = select(changed, sys.stderr if args.explain else None)
    if result == "ALL":
        print("ALL")
    else:
        for m in result:
            print(m)
    return 0


if __name__ == "__main__":
    sys.exit(main())
