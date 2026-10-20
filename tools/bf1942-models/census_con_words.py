#!/usr/bin/env python3
"""Which `ObjectTemplate` words do the installed mods write that NOTHING in the
exporter reads — on every template kind, not just the weapons?

    python3 census_con_words.py                      # vanilla, RtR, SW
    python3 census_con_words.py --mod FHSW --examples 6
    python3 census_con_words.py --by-kind            # group by template kind
    python3 census_con_words.py --answered           # include the answered ones

`census_weapon_words.py` asks this of `FireArms` and `HandFireArms` only, and
`tests/test_weapon_words.py` answers for each word it finds. The rest of the
library has the same hole and had no table, which is how `fireingForce` sat
unread on eleven vanilla tanks from the first extract until a play-test found
it (ledger FA-1, FA-19, `features/gun-hull-recoil`).

Asking it of every kind needs more care than pointing the weapon census at a
longer `--kinds` list, because `add_con`'s `objecttemplate` branch is not the
only reader:

  * every word on a template of an effect kind is stashed verbatim in
    `ObjectTemplate.effect_props` (`con.py` `_EFFECT_KINDS`), and
    `bf42/effects.py` reads it from there against its own tables. Point the
    weapon census at `emitter` and it reports `intensity`, `startRotation` and
    the whole particle vocabulary as unread, which is 300-odd false positives
    and enough noise to bury a real one.
  * an `ActiveKitPart`'s create block is re-read by `bf42/kit.py` against
    `_PART_VEC3` / `_PART_FLOAT` and its own `word ==` chain.

So the reader set here is per kind: `con.py`'s branch always, plus the readers
that kind actually goes through. Each table is harvested from the source by
AST, so a word a reader gains leaves this census in the same change — nothing
is restated here to go stale.

The verdicts live in `tests/test_con_words.py` (`ANSWERED_WORDS`), which fails
on a word that is neither read nor answered for. `--answered` prints those too,
with their verdict, which is the list of what the viewer knowingly does not do.
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
from bf42 import effects as effects_mod  # noqa: E402
from bf42 import kit as kit_mod  # noqa: E402
from census_weapon_words import branch_words  # noqa: E402

DEFAULT_MODS = ("bf1942", "XPack1", "XPack2")

#: Template kinds the three vanilla packs declare, from their own `create`
#: lines. A mod's extra kind is picked up by `--kinds`, or by `kinds_of()`.
VANILLA_KINDS = (
    "activekitpart", "animatedbundle", "bfsoldier", "bundle", "camera",
    "effectbundle", "emitter", "engine", "entrypoint", "firearms", "flag",
    "flagbase", "floatingbundle", "freecamera", "handfirearms", "kit",
    "kitpart", "landinggear", "lodobject", "objectspawner", "obstacle",
    "particle", "playercontrolobject", "projectile", "rotationalbundle",
    "seatobject", "simpleobject", "sonarobject", "spawnpoint", "spring",
    "spriteparticle", "supplydepot", "wing",
)

#: module -> the dict literals in it whose KEYS are lower-case con words.
#: Harvested by AST so a table that gains a word needs no edit here.
_READER_TABLES = {
    effects_mod: ("_EMITTER_CRD", "_EMITTER_FLOAT", "_EMITTER_CURVE",
                  "_EMITTER_BOOL", "_PARTICLE_CRD", "_PARTICLE_CURVE",
                  "_PARTICLE_BOOL"),
    kit_mod: ("_PART_VEC3", "_PART_FLOAT"),
}


def _table_keys(module, names: tuple[str, ...]) -> set[str]:
    """The keys of the named module-level dict literals, by AST."""
    tree = ast.parse(inspect.getsource(module))
    wanted = set(names)
    found: set[str] = set()
    seen: set[str] = set()
    for node in tree.body:
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)
                and node.targets[0].id in wanted
                and isinstance(node.value, ast.Dict)):
            continue
        seen.add(node.targets[0].id)
        for key in node.value.keys:
            if isinstance(key, ast.Constant) and isinstance(key.value, str):
                found.add(key.value)
    if missing := wanted - seen:
        raise RuntimeError(
            f"{module.__name__}: no dict literal named {', '.join(sorted(missing))} "
            "- the table was renamed or moved, and this census is now blind to it")
    return found


def _chain_words(module, func: str) -> set[str]:
    """Every string a named function compares `word` or `cmd` against."""
    tree = ast.parse(inspect.getsource(module))
    target = next((n for n in ast.walk(tree)
                   if isinstance(n, ast.FunctionDef) and n.name == func), None)
    if target is None:
        raise RuntimeError(f"{module.__name__}.{func} is gone; this census is blind to it")
    words: set[str] = set()
    for node in ast.walk(target):
        if not (isinstance(node, ast.Compare) and isinstance(node.left, ast.Name)
                and node.left.id in ("word", "cmd")):
            continue
        for op, right in zip(node.ops, node.comparators):
            if isinstance(op, ast.Eq) and isinstance(right, ast.Constant):
                words.add(right.value)
            elif isinstance(op, ast.In) and isinstance(right, (ast.Tuple, ast.Set, ast.List)):
                words |= {e.value for e in right.elts if isinstance(e, ast.Constant)}
    return words


def reader_words() -> dict[str, set[str]]:
    """What each reader reads: `'con'` always applies, the rest per kind."""
    return {
        "con": branch_words("objecttemplate"),
        "effects": _table_keys(effects_mod, _READER_TABLES[effects_mod])
        | {"sizemodifier", "colorrgbaovertime"},
        "kit": _table_keys(kit_mod, _READER_TABLES[kit_mod])
        | _chain_words(kit_mod, "active_parts"),
    }


def readers_for(kind: str, words: dict[str, set[str]]) -> set[str]:
    """The words something reads on a template of `kind`."""
    read = set(words["con"])
    if kind in con_mod._EFFECT_KINDS:
        # Every word on these is stashed in `effect_props` for `effects.py`.
        read |= words["effects"]
    if kind in kit_mod.KIT_PART_KINDS:
        read |= words["kit"]
    return read


class ConWordCensus(con_mod.ObjectLibrary):
    """An ObjectLibrary that counts, per template kind, the words it is given
    that no reader of that kind has.

    `unread[word]` is how many templates write it, `kinds[word]` the kinds they
    are, and `examples[word]` the first few template names.
    """

    def __init__(self, kinds=VANILLA_KINDS) -> None:
        super().__init__()
        self.watch = {k.lower() for k in kinds}
        self.words = reader_words()
        self._read_cache: dict[str, set[str]] = {}
        self.unread: Counter[str] = Counter()
        self.kinds: dict[str, Counter[str]] = defaultdict(Counter)
        self.examples: dict[str, list[str]] = defaultdict(list)
        self.declared: Counter[str] = Counter()
        self._seen: set[tuple[str, str]] = set()

    def _read(self, kind: str) -> set[str]:
        if kind not in self._read_cache:
            self._read_cache[kind] = readers_for(kind, self.words)
        return self._read_cache[kind]

    def add_con(self, path: str, text: str) -> None:
        current: tuple[str, str] | None = None      # (kind, name)
        for line in con_mod.strip_comments(text).splitlines():
            match = con_mod._COMMAND.match(line.strip())
            if not match or match.group(1).lower() != "objecttemplate":
                continue
            word = con_mod.console_word("objecttemplate", match.group(2).lower())
            parts = (match.group(3) or "").split()
            if word == "create":
                if len(parts) >= 2:
                    current = (parts[0].lower(), parts[1])
                    self.declared[current[0]] += 1
                else:
                    current = None
                continue
            if current is None:
                continue
            kind, name = current
            if kind not in self.watch or word in self._read(kind):
                continue
            key = (word, name.lower())
            if key in self._seen:
                continue
            self._seen.add(key)
            self.unread[word] += 1
            self.kinds[word][kind] += 1
            if len(self.examples[word]) < 8:
                self.examples[word].append(name)
        super().add_con(path, text)


#: Where a reader can live: the extractors at the top level, the library, the
#: viewer and the sidecar. NOT `tests/` or `surveys/` — a test or a survey that
#: names a word is talking about it, not reading it, and counting those as
#: readers is self-defeating: `tests/test_con_words.py` names every word this
#: census finds, so searching it would mask the whole list.
_SEARCH_DIRS = ("bf42", "viewer", "sidecar")
#: Files at the top level that are not readers either: the two censuses.
_NOT_A_READER = frozenset({"census_con_words.py", "census_weapon_words.py"})


def mentions(words, root: Path = HERE) -> dict[str, list[str]]:
    """For each word, the files under `root` whose text contains it, case
    insensitively — every table, branch and comment alike.

    This is a TRIAGE HINT, not a verdict. The reader tables above are the
    authority on what is read; this says where to look when a word the tables
    do not have turns out to be handled somewhere they cannot see — the level
    extractor's own tables (`extract_map.py`, `bf42/level.py`), the HUD pack's,
    the spotting bar's. A word nothing mentions is a real gap; a word something
    mentions needs a human to decide which.
    """
    wanted = {w.lower(): w for w in words}
    found: dict[str, set[str]] = {w: set() for w in words}
    for path in _reader_files(root):
        try:
            text = path.read_text(errors="replace").lower()
        except OSError:
            continue
        label = path.relative_to(root).as_posix()
        for lower, word in wanted.items():
            if lower in text:
                found[word].add(label)
    return {w: sorted(v) for w, v in found.items()}


def _reader_files(root: Path):
    """Every file a reader could live in, once each."""
    seen: set[Path] = set()
    for path in sorted(root.glob("*.py")):
        if path.is_file() and path.name not in _NOT_A_READER:
            seen.add(path)
    for sub in _SEARCH_DIRS:
        directory = root / sub
        if not directory.is_dir():
            continue
        for pattern in ("*.py", "*.js", "*.mjs"):
            seen.update(p for p in directory.rglob(pattern) if p.is_file())
    return sorted(seen)


def kinds_of(game_dir: Path, mod: str) -> Counter[str]:
    """Every template kind `mod`'s chain declares, and how many of each."""
    census = census_of(game_dir, mod, kinds=())
    return census.declared


def census_of(game_dir: Path, mod: str, kinds=VANILLA_KINDS) -> ConWordCensus:
    from extract_models import build_library, build_pools, mod_chain

    _, _, objects, _ = build_pools(mod_chain(game_dir, mod), [])
    return build_library(objects, ConWordCensus(kinds))


def main() -> int:
    from extract_models import DEFAULT_GAME_DIR

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mod", action="append", default=[],
                        help="game mod folder (bf1942, XPack1, FHSW, ...)")
    parser.add_argument("--kinds", default=None,
                        help="template kinds to watch, comma separated; "
                             "default every kind the vanilla packs declare")
    parser.add_argument("--all-kinds", action="store_true",
                        help="watch every kind the mod itself declares")
    parser.add_argument("--by-kind", action="store_true",
                        help="group the report by template kind")
    parser.add_argument("--answered", action="store_true",
                        help="also print the words tests/test_con_words.py answers for")
    parser.add_argument("--where", action="store_true",
                        help="annotate each word with the files that mention it, "
                             "and list the ones nothing mentions at all")
    parser.add_argument("--examples", type=int, default=3)
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    args = parser.parse_args()
    game_dir = args.game_dir.expanduser()

    answered: dict[str, str] = {}
    if not args.answered:
        try:
            from tests.test_con_words import ANSWERED_WORDS
            answered = ANSWERED_WORDS
        except ImportError:
            pass

    for mod in args.mod or DEFAULT_MODS:
        kinds = (tuple(k.strip().lower() for k in args.kinds.split(",") if k.strip())
                 if args.kinds else
                 tuple(kinds_of(game_dir, mod)) if args.all_kinds else VANILLA_KINDS)
        result = census_of(game_dir, mod, kinds)
        rows = [(w, n) for w, n in result.unread.items() if w not in answered]
        hidden = len(result.unread) - len(rows)
        print(f"{mod}: {len(rows)} unanswered word(s) over {len(kinds)} kind(s)"
              + (f", {hidden} answered for" if hidden else ""))
        if args.by_kind:
            per_kind: dict[str, list[tuple[str, int]]] = defaultdict(list)
            for word, _ in rows:
                for kind, n in result.kinds[word].items():
                    per_kind[kind].append((word, n))
            for kind in sorted(per_kind):
                print(f"  {kind} ({result.declared[kind]} templates)")
                for word, n in sorted(per_kind[kind], key=lambda kv: (-kv[1], kv[0])):
                    print(f"    {n:5d}  {word:34s} "
                          f"{', '.join(result.examples[word][:args.examples])}")
            continue
        seen_in = mentions([w for w, _ in rows]) if args.where else {}
        for word, n in sorted(rows, key=lambda kv: (-kv[1], kv[0])):
            where = ", ".join(f"{k} x{c}" for k, c in result.kinds[word].most_common(3))
            tail = (f" <- {', '.join(seen_in[word][:3])}" if seen_in.get(word)
                    else " <- NOTHING MENTIONS IT" if args.where else "")
            print(f"  {n:5d}  {word:34s} [{where}] "
                  f"{', '.join(result.examples[word][:args.examples])}{tail}")
        if args.where:
            orphans = [(w, n) for w, n in rows if not seen_in.get(w)]
            print(f"  -- {len(orphans)} of {len(rows)} are mentioned nowhere in the tree:")
            for word, n in sorted(orphans, key=lambda kv: (-kv[1], kv[0])):
                where = ", ".join(f"{k} x{c}" for k, c in result.kinds[word].most_common(2))
                print(f"  {n:5d}  {word:34s} [{where}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
