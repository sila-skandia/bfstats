#!/usr/bin/env python3
"""What a mod's scripts do that the vanilla packs' scripts never do.

Run it before extracting a mod's levels. It reads every `.con`/`.inc` of the
mod's `objects.rfa` and level archives, the same of the baseline (bf1942,
XPack1, XPack2), and prints:

  1. template classes and script words the mod uses and the baseline never does;
  2. structural patterns, each a mechanic the exporter or the viewer has to know:
       carried-spawner   an ObjectSpawner that is a child of another template
                         (a ship's landing craft, an effect's bombing run, a
                         static's "flying spawn")
       static-spawner    one of those reached from a StaticObjects.con placement,
                         where no ObjectSpawns.con line names it
       rotating-carrier  a part with setContinousRotationSpeed that carries a
                         spawner, a spawn point or a vehicle
       enter-on-spawn    a SpawnPoint with setEnterOnSpawn 1 (the deploy screen
                         seats the player) and what carries it
       paratroop-spawn   a SpawnPoint with setSpawnAsParaTroper 1
       spawns-non-vehicle an ObjectSpawner whose object is not a
                         PlayerControlObject or a Kit (doors, barrels, mines,
                         effects, projectiles)
       static-vehicle    a PlayerControlObject placed by StaticObjects.con
       level-templates   object scripts a level archive carries itself
  3. the levels each pattern appears in.

    surveys/mod_mechanics.py --mod FH              # the report
    surveys/mod_mechanics.py --mod FH --json out.json
    surveys/mod_mechanics.py --mod FH --level Tarawa-1943

Reads scripts without running them: both arms of an `if` count.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tools" / "bf1942-models"))
from bf42.rfa import RfaArchive  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
BASELINE = ["bf1942", "XPack1", "XPack2"]
WORD = re.compile(r"^\s*([A-Za-z_]+)\.([A-Za-z_0-9]+)\s*(.*?)\s*$")


class Template:
    __slots__ = ("name", "kind", "children", "props", "src", "level")

    def __init__(self, name, kind, src, level):
        self.name, self.kind, self.src, self.level = name, kind, src, level
        self.children: list[str] = []
        self.props: dict[str, list[str]] = defaultdict(list)


class Corpus:
    def __init__(self):
        self.templates: dict[str, Template] = {}          # mod-wide, lowercased
        self.level_templates: dict[str, dict[str, Template]] = defaultdict(dict)
        self.kinds = Counter()
        self.words = Counter()
        self.word_src: dict[str, str] = {}
        # level -> layer file -> [template names placed]
        self.placed: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))

    def read(self, archive: Path, level: str | None):
        try:
            rfa = RfaArchive(archive)
        except Exception as exc:  # a broken archive is a finding, not a crash
            print(f"  unreadable {archive.name}: {exc}", file=sys.stderr)
            return
        for path in rfa.entries:
            low = path.lower()
            if not low.endswith((".con", ".inc")):
                continue
            try:
                text = rfa.read(path).decode("latin-1")
            except Exception:
                continue
            self._script(text, path, level)

    def _script(self, text, path, level):
        cur: Template | None = None
        in_rem = False
        base = path.lower().rsplit("/", 1)[-1]
        for raw in text.splitlines():
            line = raw.strip()
            low = line.lower()
            if low.startswith("beginrem"):
                in_rem = True
            if in_rem:
                if low.startswith("endrem"):
                    in_rem = False
                continue
            if not line or low.startswith("rem"):
                continue
            m = WORD.match(line)
            if not m:
                continue
            obj, word, rest = m.group(1).lower(), m.group(2).lower(), m.group(3)
            key = f"{obj}.{word}"
            self.words[key] += 1
            self.word_src.setdefault(key, path)
            args = rest.split()
            if obj == "objecttemplate":
                if word == "create" and len(args) >= 2:
                    cur = Template(args[1], args[0], path, level)
                    self.kinds[args[0].lower()] += 1
                    (self.level_templates[level] if level else self.templates)[args[1].lower()] = cur
                elif word in ("active", "activesafe") and args:
                    cur = self.find(args[0], level)
                elif cur is not None:
                    if word == "addtemplate" and args:
                        cur.children.append(args[0])
                    cur.props[word].append(rest)
            elif obj == "object" and word == "create" and args and level:
                self.placed[level][base].append(args[0])

    def find(self, name, level=None) -> Template | None:
        low = name.lower()
        if level and low in self.level_templates.get(level, {}):
            return self.level_templates[level][low]
        return self.templates.get(low)

    def walk(self, name, level=None, seen=None, path=()):
        """Yield (template, ancestors) for a template and everything under it."""
        seen = seen if seen is not None else set()
        tpl = self.find(name, level)
        if tpl is None or tpl.name.lower() in seen:
            return
        seen.add(tpl.name.lower())
        yield tpl, path
        for child in tpl.children:
            yield from self.walk(child, level, seen, path + (tpl,))
        if tpl.kind.lower() == "objectspawner":
            for value in tpl.props.get("setobjecttemplate", []):
                parts = value.split()
                if len(parts) >= 2 and parts[1].lower() != "none":
                    yield from self.walk(parts[1], level, seen, path + (tpl,))


def load(mods, with_levels=True) -> Corpus:
    corpus = Corpus()
    for mod in mods:
        root = GAME / mod / "Archives"
        for name in sorted(p for p in root.glob("*.rfa") if p.name.lower().startswith("objects")):
            corpus.read(name, None)
        game = root / "bf1942"
        for name in sorted(game.glob("[gG]ame*.rfa")):
            corpus.read(name, None)
        if with_levels:
            levels = root / "bf1942" / "levels"
            for name in sorted(levels.glob("*.rfa")) if levels.is_dir() else []:
                corpus.read(name, re.sub(r"_\d{3}$", "", name.stem))
    return corpus


def flag(props, word) -> bool:
    values = props.get(word, [])
    return bool(values) and values[-1].split()[:1] == ["1"]


def spawned(tpl) -> list[str]:
    out = []
    for value in tpl.props.get("setobjecttemplate", []):
        parts = value.split()
        if len(parts) >= 2 and parts[1].lower() != "none":
            out.append(parts[1])
    return out


def patterns(corpus: Corpus, fallback: Corpus):
    """Structural findings. `fallback` resolves names the mod inherits."""
    def find(name, level=None):
        return corpus.find(name, level) or fallback.find(name)

    def walk(name, level=None, seen=None, path=()):
        seen = seen if seen is not None else set()
        tpl = find(name, level)
        if tpl is None or tpl.name.lower() in seen:
            return
        seen.add(tpl.name.lower())
        yield tpl, path
        for child in tpl.children:
            yield from walk(child, level, seen, path + (tpl,))
        if tpl.kind.lower() == "objectspawner":
            for obj in spawned(tpl):
                yield from walk(obj, level, seen, path + (tpl,))

    found = defaultdict(dict)   # pattern -> key -> detail

    def scan(pool, level):
        for tpl in list(pool.values()):
            kind = tpl.kind.lower()
            for child in tpl.children:
                sub = find(child, level)
                if sub is not None and sub.kind.lower() == "objectspawner":
                    found["carried-spawner"][f"{tpl.name} > {sub.name}"] = {
                        "parent": tpl.name, "parentKind": tpl.kind, "spawner": sub.name,
                        "objects": spawned(sub), "holdObject": flag(sub.props, "holdobject"),
                        "src": tpl.src, "scope": level or "mod"}
            if kind == "spawnpoint":
                if flag(tpl.props, "setenteronspawn"):
                    found["enter-on-spawn"][tpl.name] = {
                        "group": (tpl.props.get("setgroup") or ["?"])[-1], "src": tpl.src,
                        "scope": level or "mod", "carriers": []}
                if flag(tpl.props, "setspawnasparatroper"):
                    found["paratroop-spawn"][tpl.name] = {
                        "group": (tpl.props.get("setgroup") or ["?"])[-1], "src": tpl.src,
                        "scope": level or "mod", "carriers": []}
            if kind == "objectspawner":
                odd = []
                for obj in spawned(tpl):
                    target = find(obj, level)
                    tkind = target.kind if target else "unresolved"
                    if tkind.lower() not in ("playercontrolobject", "kit"):
                        odd.append(f"{obj} ({tkind})")
                if odd:
                    found["spawns-non-vehicle"][tpl.name] = {
                        "objects": odd, "src": tpl.src, "scope": level or "mod"}
            speed = tpl.props.get("setcontinousrotationspeed")
            if speed and any(float(x or 0) for x in re.split(r"[/ ]", speed[-1]) if re.fullmatch(r"-?[\d.]+", x or "")):
                carries = []
                for sub, _ in walk(tpl.name, level):
                    if sub is tpl:
                        continue
                    if sub.kind.lower() in ("objectspawner", "spawnpoint", "playercontrolobject"):
                        carries.append(f"{sub.name} ({sub.kind})")
                if carries:
                    found["rotating-carrier"][tpl.name] = {
                        "speed": speed[-1], "carries": carries, "src": tpl.src, "scope": level or "mod"}

    scan(corpus.templates, None)
    for level, pool in corpus.level_templates.items():
        scan(pool, level)

    # who carries each enter-on-spawn / paratroop point
    for pool, level in [(corpus.templates, None)] + [(p, l) for l, p in corpus.level_templates.items()]:
        for tpl in pool.values():
            for child in tpl.children:
                for pat in ("enter-on-spawn", "paratroop-spawn"):
                    for name, row in found[pat].items():
                        if child.lower() == name.lower() and tpl.name not in row["carriers"]:
                            row["carriers"].append(tpl.name)

    # per level: what each placement reaches
    per_level = defaultdict(lambda: defaultdict(set))
    for level, layers in corpus.placed.items():
        if corpus.level_templates.get(level):
            scripts = sorted({t.src.split("/")[-2] for t in corpus.level_templates[level].values()
                              if "/objects/" in t.src.lower()})
            if scripts:
                found["level-templates"][level] = {"folders": scripts}
                per_level[level]["level-templates"].update(scripts)
        for layer, names in layers.items():
            static = layer == "staticobjects.con"
            for name in set(names):
                root = find(name, level)
                if root is None:
                    continue
                if static and root.kind.lower() == "playercontrolobject":
                    found["static-vehicle"].setdefault(root.name, {"levels": []})["levels"].append(level)
                    per_level[level]["static-vehicle"].add(root.name)
                for sub, path in walk(name, level):
                    kind = sub.kind.lower()
                    if kind == "objectspawner" and path:
                        key = f"{path[-1].name} > {sub.name}"
                        if static and not any(p.kind.lower() == "objectspawner" for p in path):
                            found["static-spawner"].setdefault(
                                f"{root.name} > {sub.name}",
                                {"objects": spawned(sub), "holdObject": flag(sub.props, "holdobject"),
                                 "levels": []})["levels"].append(level)
                            per_level[level]["static-spawner"].add(f"{root.name} > {sub.name}")
                        if key in found["carried-spawner"]:
                            per_level[level]["carried-spawner"].add(key)
                    if kind == "objectspawner" and sub.name in found["spawns-non-vehicle"]:
                        per_level[level]["spawns-non-vehicle"].add(sub.name)
                    if kind == "spawnpoint":
                        for pat in ("enter-on-spawn", "paratroop-spawn"):
                            if sub.name in found[pat]:
                                carrier = path[-1].name if path else "(placed)"
                                per_level[level][pat].add(f"{sub.name} on {carrier}")
                    if sub.name in found["rotating-carrier"]:
                        per_level[level]["rotating-carrier"].add(sub.name)
    return found, per_level


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mod", required=True, help="folder name under Mods/, e.g. FH")
    ap.add_argument("--level", help="print one level's findings only")
    ap.add_argument("--json", type=Path)
    ap.add_argument("--top", type=int, default=60, help="rows per word table")
    args = ap.parse_args()

    base = load(BASELINE)
    mod = load([args.mod])
    found, per_level = patterns(mod, base)
    base_found, _ = patterns(base, Corpus())

    new_kinds = {k: n for k, n in mod.kinds.items() if k not in base.kinds}
    new_words = {k: n for k, n in mod.words.items() if k not in base.words}

    if args.json:
        args.json.write_text(json.dumps({
            "mod": args.mod, "newKinds": new_kinds,
            "newWords": {k: {"count": n, "first": mod.word_src[k]} for k, n in new_words.items()},
            "patterns": found,
            "levels": {l: {p: sorted(v) for p, v in pats.items()} for l, pats in per_level.items()},
        }, indent=1, default=list))

    if args.level:
        want = args.level.lower()
        for level, pats in sorted(per_level.items()):
            if level.lower() != want:
                continue
            print(f"## {level}")
            for pat, rows in sorted(pats.items()):
                print(f"  {pat}:")
                for row in sorted(rows):
                    print(f"    {row}")
        return

    print(f"# {args.mod}: {len(mod.templates)} mod templates, {len(mod.placed)} levels\n")
    print("## Template classes the baseline never creates")
    for k, n in sorted(new_kinds.items(), key=lambda kv: -kv[1]):
        print(f"  {n:6d}  {k}")
    print("\n## Script words the baseline never uses")
    for k, n in sorted(new_words.items(), key=lambda kv: -kv[1])[: args.top]:
        print(f"  {n:6d}  {k:55s} {mod.word_src[k]}")
    print("\n## Patterns (mod count / baseline count / levels using it)")
    for pat in ("static-spawner", "rotating-carrier", "enter-on-spawn", "paratroop-spawn",
                "carried-spawner", "spawns-non-vehicle", "static-vehicle", "level-templates"):
        levels = sorted(l for l, pats in per_level.items() if pat in pats)
        print(f"\n### {pat}: {len(found[pat])} / {len(base_found[pat])} / {len(levels)} levels")
        for key, row in sorted(found[pat].items()):
            detail = {k: v for k, v in row.items() if k not in ("src",)}
            if "levels" in detail:
                detail["levels"] = sorted(set(detail["levels"]))
            print(f"  {key}: {json.dumps(detail, default=list)[:420]}")
    print("\n## Levels")
    for level in sorted(mod.placed):
        pats = per_level.get(level, {})
        tags = ", ".join(f"{p} {len(v)}" for p, v in sorted(pats.items()))
        print(f"  {level:36s} {tags or '-'}")


if __name__ == "__main__":
    main()
