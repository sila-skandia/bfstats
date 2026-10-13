#!/usr/bin/env python3
"""Find where the repo records something about BF1942, ranked by folder.

    python3 .claude/skills/bf1942-knowledge/scripts/find.py rifle grenade
    python3 .claude/skills/bf1942-knowledge/scripts/find.py --ledger KITDROP
    python3 .claude/skills/bf1942-knowledge/scripts/find.py --ledger lastCollisionHeight
    python3 .claude/skills/bf1942-knowledge/scripts/find.py --skills publish

Searches `features/**/*.md` (not `.claude/worktrees`, not `features/archived`),
the ledger rows, and the skills, for every word given (all must appear in a
line, any order, case-insensitive). For each feature folder it prints the
catalogue line from `features/README.md`, the folder's own status line, the
newest dated heading, and the best matching lines with `path:line`, so a
reader opens the right file at the right section instead of the first grep hit.
A `grep -r` from the repo root walks about 27 worktrees and returns every hit
once per worktree; this does not.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
FEATURES = REPO / "features"
LEDGER = FEATURES / "bf1942-engine-reference" / "ledger.md"
SKILL_DIRS = [REPO / ".claude" / "skills", REPO / ".agents" / "skills"]
DATE = re.compile(r"20\d\d-\d\d-\d\d")


def catalogue() -> dict[str, str]:
    rows = {}
    try:
        for line in (FEATURES / "README.md").read_text(encoding="utf-8").splitlines():
            m = re.match(r"\| \[([^\]]+)\]\([^)]+\) \| ([^|]+) \| (.+?) \|$", line)
            if m:
                rows[m.group(1)] = f"{m.group(2).strip()}: {m.group(3).strip()}"
    except OSError:
        pass
    return rows


def status_and_newest(folder: Path) -> tuple[str, str]:
    readme = folder / "README.md"
    status, newest, newest_date = "", "", ""
    try:
        for line in readme.read_text(encoding="utf-8", errors="replace").splitlines():
            if not status and re.match(r"\s*\**status\**\s*:", line, re.I):
                status = line.strip()[:160]
            if line.startswith("#"):
                d = DATE.search(line)
                if d and d.group(0) >= newest_date:
                    newest_date, newest = d.group(0), line.strip("# ").strip()[:120]
    except OSError:
        pass
    return status, newest


def matches(words: list[str], line: str) -> bool:
    low = line.lower()
    return all(w in low for w in words)


def search_features(words: list[str], per_folder: int) -> None:
    hits: dict[str, list[tuple[Path, int, str]]] = defaultdict(list)
    for path in FEATURES.rglob("*.md"):
        if "archived" in path.parts or path.name == "README.md" and path.parent == FEATURES:
            continue
        if path == LEDGER:
            continue
        try:
            for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                if matches(words, line):
                    hits[path.relative_to(FEATURES).parts[0]].append((path, n, line.strip()))
        except OSError:
            continue
    cat = catalogue()
    ranked = sorted(hits.items(), key=lambda kv: -len(kv[1]))
    if not ranked:
        print("no feature doc matches", " ".join(words))
    for folder, rows in ranked:
        status, newest = status_and_newest(FEATURES / folder)
        print(f"\n== features/{folder}  ({len(rows)} lines)")
        if folder in cat:
            print(f"   {cat[folder]}")
        if status:
            print(f"   {status}")
        if newest:
            print(f"   newest dated section: {newest}")
        # prefer headings and table rows, then the rest, shortest first
        rows.sort(key=lambda r: (not r[2].startswith(("#", "|")), len(r[2])))
        for path, n, line in rows[:per_folder]:
            print(f"   {path.relative_to(REPO)}:{n}: {line[:150]}")
    ledger_hits = search_ledger(words, limit=8, quiet=True)
    if ledger_hits:
        print(f"\n== ledger rows ({len(ledger_hits)} shown; --ledger for all)")
        for n, line in ledger_hits:
            print(f"   {LEDGER.relative_to(REPO)}:{n}: {line[:160]}")


def search_ledger(words: list[str], limit: int | None = None, quiet: bool = False):
    out = []
    section = ""
    try:
        for n, line in enumerate(LEDGER.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if line.startswith("## "):
                section = line[3:].strip()
            if line.startswith("| ") and matches(words, line):
                out.append((n, line.strip()))
                if not quiet:
                    print(f"{LEDGER.relative_to(REPO)}:{n} [{section}]\n   {line.strip()[:400]}")
            if limit and len(out) >= limit:
                break
    except OSError:
        if not quiet:
            print("no ledger at", LEDGER)
    if not quiet and not out:
        print("no ledger row matches", " ".join(words), "(a prefix is matched as `| PREFIX-`)")
    return out


def search_skills(words: list[str]) -> None:
    seen = set()
    for root in SKILL_DIRS:
        if not root.is_dir():
            continue
        for path in sorted(root.glob("*/SKILL.md")):
            real = path.resolve()
            if real in seen:
                continue
            seen.add(real)
            rows = [(n, l.strip()) for n, l in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1)
                    if matches(words, l)]
            if rows:
                print(f"\n== skill {path.parent.name}  ({len(rows)} lines)")
                for n, line in rows[:6]:
                    print(f"   {path.relative_to(REPO)}:{n}: {line[:150]}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("words", nargs="+", help="all must appear in a line; a ledger prefix (KITDROP) finds its rows")
    ap.add_argument("--ledger", action="store_true", help="search only the ledger rows, print them whole")
    ap.add_argument("--skills", action="store_true", help="search the skills instead of the feature docs")
    ap.add_argument("--per-folder", type=int, default=4)
    args = ap.parse_args()
    words = [w.lower() for w in args.words]
    if args.ledger:
        # a bare prefix matches the row id column
        if len(words) == 1 and re.fullmatch(r"[a-z]+(-\d+)?", words[0]):
            words = [f"| {words[0]}" if "-" in words[0] else f"| {words[0]}-"]
        search_ledger(words)
    elif args.skills:
        search_skills(words)
    else:
        search_features(words, args.per_folder)
    return 0


if __name__ == "__main__":
    sys.exit(main())
