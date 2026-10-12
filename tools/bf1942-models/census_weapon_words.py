#!/usr/bin/env python3
"""Which `ObjectTemplate` words do the installed mods write on a weapon that
`bf42/con.py` does not read?

    python3 census_weapon_words.py                       # vanilla, RtR, SW, FH, FHSW
    python3 census_weapon_words.py --mod FinnWars --examples 5
    python3 census_weapon_words.py --kinds firearms,handfirearms,projectile

A weapon word nobody reads is behaviour the viewer cannot have. The M1
Garand's `allowReloadOnEmptyClipOnly` sat unread from the first extract until
an owner's play-test (ledger FA-6): one weapon in vanilla declares it, so no
survey of "the common words" ever met it. This reads every script of a mod's
chain the way `extract_models.build_library` does (includes inlined, FHSW's
packed `Compressed.con` split), and for each template of the kinds asked for
counts the words `ObjectLibrary.add_con` has no branch for.

`tests/test_weapon_words.py` holds the verdict on each such word
(`UNREAD_WEAPON_WORDS`: what it is, and why it is not read) and, where the
game is installed, fails on a word that is neither read nor listed there.
"""
from __future__ import annotations

import argparse
import ast
import inspect
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42 import con as con_mod  # noqa: E402

WEAPON_KINDS = ("firearms", "handfirearms")
DEFAULT_MODS = ("bf1942", "XPack1", "XPack2", "FH", "FHSW")


def branch_words(namespace: str) -> set[str]:
    """Every command literal `ObjectLibrary.add_con` compares `cmd` against
    inside one namespace's branch, read off the source."""
    tree = ast.parse(inspect.getsource(con_mod))
    constants = {}
    for node in ast.walk(tree):
        if (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)):
            value = node.value
            if isinstance(value, ast.Call) and value.args:
                value = value.args[0]
            if isinstance(value, (ast.Set, ast.Tuple, ast.List)):
                constants[node.targets[0].id] = {
                    e.value for e in value.elts if isinstance(e, ast.Constant)}
    add_con = next(n for n in ast.walk(tree)
                   if isinstance(n, ast.FunctionDef) and n.name == "add_con")
    words: set[str] = set()
    for node in ast.walk(add_con):
        test = node.test if isinstance(node, ast.If) else None
        if not (isinstance(test, ast.Compare) and isinstance(test.left, ast.Name)
                and test.left.id == "ns" and isinstance(test.comparators[0], ast.Constant)
                and test.comparators[0].value == namespace):
            continue
        for inner in ast.walk(ast.Module(body=node.body, type_ignores=[])):
            if not (isinstance(inner, ast.Compare) and isinstance(inner.left, ast.Name)
                    and inner.left.id == "cmd"):
                continue
            for op, right in zip(inner.ops, inner.comparators):
                if isinstance(op, ast.Eq) and isinstance(right, ast.Constant):
                    words.add(right.value)
                elif isinstance(op, ast.In) and isinstance(right, (ast.Tuple, ast.Set)):
                    words |= {e.value for e in right.elts if isinstance(e, ast.Constant)}
                elif isinstance(op, ast.In) and isinstance(right, ast.Name):
                    words |= constants.get(right.id, set())
    return words


class WordCensus(con_mod.ObjectLibrary):
    """An ObjectLibrary that also counts the words it is given and has no
    branch for, per template kind: `unread[word]` is how many templates of
    the watched kinds write it, `examples[word]` the first few of them."""

    def __init__(self, kinds=WEAPON_KINDS, read: set[str] | None = None) -> None:
        super().__init__()
        self.kinds = {k.lower() for k in kinds}
        self.read = branch_words("objecttemplate") if read is None else read
        self.unread: Counter[str] = Counter()
        self.examples: dict[str, list[str]] = defaultdict(list)
        self._seen: set[tuple[str, str]] = set()

    def add_con(self, path: str, text: str) -> None:
        current: tuple[str, str] | None = None      # (kind, name), lower case
        for line in con_mod.strip_comments(text).splitlines():
            match = con_mod._COMMAND.match(line.strip())
            if not match or match.group(1).lower() != "objecttemplate":
                continue
            word = con_mod.console_word("objecttemplate", match.group(2).lower())
            parts = (match.group(3) or "").split()
            if word == "create":
                current = (parts[0].lower(), parts[1]) if len(parts) >= 2 else None
                continue
            if current is None or current[0] not in self.kinds or word in self.read:
                continue
            key = (word, current[1].lower())
            if key in self._seen:
                continue
            self._seen.add(key)
            self.unread[word] += 1
            if len(self.examples[word]) < 8:
                self.examples[word].append(current[1])
        super().add_con(path, text)


def census(game_dir: Path, mod: str, kinds=WEAPON_KINDS) -> WordCensus:
    from extract_models import build_library, build_pools, mod_chain

    _, _, objects, _ = build_pools(mod_chain(game_dir, mod), [])
    return build_library(objects, WordCensus(kinds))


def main() -> int:
    from extract_models import DEFAULT_GAME_DIR

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mod", action="append", default=[],
                        help="game mod folder (bf1942, XPack1, FHSW, ...)")
    parser.add_argument("--kinds", default=",".join(WEAPON_KINDS),
                        help="template kinds to watch, comma separated")
    parser.add_argument("--examples", type=int, default=3)
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    args = parser.parse_args()
    kinds = tuple(k.strip().lower() for k in args.kinds.split(",") if k.strip())
    total: Counter[str] = Counter()
    for mod in args.mod or DEFAULT_MODS:
        result = census(args.game_dir.expanduser(), mod, kinds)
        print(f"{mod}: {len(result.unread)} unread word(s) on {'/'.join(kinds)} templates")
        for word, count in sorted(result.unread.items(), key=lambda kv: (-kv[1], kv[0])):
            print(f"  {count:5d}  {word:34s} {', '.join(result.examples[word][:args.examples])}")
            total[word] = max(total[word], count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
