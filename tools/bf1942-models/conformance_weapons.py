#!/usr/bin/env python3
"""A hand weapon's scripts beside what the viewer's trees and page do with them.

    python3 conformance_weapons.py --mod fhsw \\
        --levels battle_of_foy,berlin-1945,gold_beach-1944,prokhorovka-1943
    python3 conformance_weapons.py --mod bf1942                 # every level
    python3 conformance_weapons.py --mod fhsw --levels battle_of_foy \\
        --weapon K98 --verbose --json out/foy-weapons.json

For every hand weapon the kits of the named levels deal (a `Random*` item's
variants, the child FireArms a weapon carries, the rounds they fire), three
readings are put side by side and each disagreement is listed:

  declared  every `ObjectTemplate` word the weapon's script writes, read here
            raw and on its own (`RawLibrary`: the first `create` of a name
            wins, LOAD-1, a `Compressed.con` chunk before the loose file of
            the same folder, LOAD-5), not through `bf42/con.py`'s fields
  ours      the weapon glb's `weapon` and `fireArms` extras, each first-person
            rig's `weaponStats`, the sound manifest and the files it names,
            the HUD art
  honoured  whether any module of `viewer/` reads the key (`RULES`' regex)

A disagreement is one of five classes:

  a  declared, not extracted: no reader carries the word, or the tree was
     extracted before a reader did
  b  extracted, not honoured: the key is in the tree and no page module reads it
  c  extracted wrong: the tree's value is not the script's
  d  sound: the weapon's script is not the one in the manifest, a patch the
     engine triggers has nothing shipped, or a sample is not in the install
  e  asset missing: no glb, no first-person rig, no icon, no mp3

`tests/test_weapon_words.py` answers for the words no branch of `add_con`
reads; this answers for the ones that are read and then lost, or kept and
never used. A word listed in `KNOWN` is a disagreement somebody has looked at:
it is still counted, with its verdict, and `--open` leaves it out.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import warnings
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from bf42 import con as con_mod, glbopt  # noqa: E402

VIEWER = HERE / "viewer"
WEAPON_KINDS = ("handfirearms", "firearms")

# --------------------------------------------------------------------------- #
# declared: the scripts, read raw
# --------------------------------------------------------------------------- #


class RawLibrary(con_mod.ObjectLibrary):
    """An ObjectLibrary that also keeps every template's words as written.

    `raw[name.lower()]` is `{name, kind, source, lines}`; `lines` the
    `(word, args)` pairs in script order, the word in the spelling `add_con`
    meets it under. A second `create` of a name configures nothing (LOAD-1),
    so its lines are dropped here as the engine drops them; `shadowed` lists
    the files whose declaration lost. `ObjectTemplate.active <name>` reopens
    a template, and what follows is added to it (`reopened` counts them):
    `add_con` has no such branch, so a word written that way is one it loses.
    """

    def __init__(self) -> None:
        super().__init__()
        self.raw: dict[str, dict] = {}
        self.shadowed: dict[str, list[str]] = defaultdict(list)
        self.reopened: Counter[str] = Counter()

    def add_con(self, path: str, text: str) -> None:
        current: dict | None = None
        stripped = con_mod.strip_comments(text)
        if "v_is_coop" in stripped.lower():
            stripped = con_mod.resolve_coop_conditionals(stripped)
        for line in stripped.splitlines():
            match = con_mod._COMMAND.match(line.strip())
            if not match or match.group(1).lower() != "objecttemplate":
                continue
            word = con_mod.console_word("objecttemplate", match.group(2).lower())
            args = (match.group(3) or "").strip()
            if word == "create":
                parts = args.split()
                if len(parts) < 2:
                    current = None
                elif parts[1].lower() in self.raw:
                    self.shadowed[parts[1].lower()].append(path)
                    current = None
                else:
                    current = self.raw[parts[1].lower()] = {
                        "name": parts[1], "kind": parts[0], "source": path,
                        "lines": []}
            elif word == "active":
                current = self.raw.get(args.split()[0].lower()) if args else None
                if current is not None:
                    self.reopened[current["name"].lower()] += 1
            elif current is not None:
                current["lines"].append((word, args))
        super().add_con(path, text)


def template_words(raw: dict) -> dict[str, list[str]]:
    """A template's own words, each with every value it was given, in order.
    Words after an `addTemplate` that place the child (`setPosition`,
    `setRotation`, `setInputId`, `startOnEffects`) are the child's."""
    words: dict[str, list[str]] = defaultdict(list)
    in_child = False
    for word, args in raw["lines"]:
        if word == "addtemplate":
            in_child = True
        elif in_child and word in CHILD_WORDS:
            continue
        words[word].append(args)
    return words


CHILD_WORDS = frozenset({"setposition", "setrotation", "setinputid", "startoneffects",
                         "setactivestate", "setrandomgeometries"})

_NUMBER = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def numbers(args: str) -> list[float]:
    """The numbers of an argument string, however it separates them
    (`5 2.25 0.12`, `-0.08/0.02/0.02`, `CRD_UNIFORM/1/2/0`)."""
    return [float(token) for token in _NUMBER.findall(re.sub(r"[A-Za-z_]\w*", " ", args))]


def boolean(args: str) -> bool | None:
    """A console bool as `>> bool` takes it: a number, `true`/`false`, or the
    `c_True` spelling some scripts use (read as text, it is not 0)."""
    token = args.split()[0].lower() if args.split() else ""
    if token in ("true", "c_true"):
        return True
    if token in ("false", "c_false"):
        return False
    try:
        return float(token) != 0
    except ValueError:
        return None


def text(args: str) -> str:
    args = args.strip()
    if args.startswith('"'):
        end = args.find('"', 1)
        return args[1:end] if end > 0 else args[1:]
    return args.split()[0] if args else ""


# --------------------------------------------------------------------------- #
# the rules: word -> where it lands in our data, and who reads it there
# --------------------------------------------------------------------------- #
# (block, key, type, page regex or None). `block` is `stats` (the weapon glb's
# `weapon` extras and a rig's `weaponStats`), `fire` (the FireArms node's
# `fireArms` extras), `heat` (a rig's `weaponStats.heat`). The regex is looked
# for in every module of `viewer/`; None means the word is catalogue data the
# page has no use for by design.

RULES: dict[str, list[tuple[str, str, str, str | None]]] = {
    "roundoffire": [("stats", "roundOfFire", "num", r"\.roundOfFire\b"),
                    ("fire", "roundOfFire", "num", r"\.roundOfFire\b")],
    "fireonce": [("stats", "fireOnce", "bool", r"\.fireOnce\b")],
    "altfireonce": [("stats", "zoom.toggle", "bool", r"zoom\??\.toggle\b")],
    "velocity": [("stats", "velocity", "num", None),
                 ("fire", "velocity", "num", r"\.velocity\b")],
    "projectiletemplate": [("stats", "projectile", "str", r"\.projectile\b"),
                           ("fire", "projectile.template", "str", r"\.projectile\b")],
    "fireincameradof": [("stats", "fireInCameraDof", "bool", r"\.fireInCameraDof\b")],
    "setcrosshairtype": [("stats", "crossHair", "str", r"\.crossHair\b")],
    "sethudammotype": [("stats", "hudAmmo", "str", r"\.hudAmmo\b")],
    "loadsoundscript": [("stats", "soundScript", "str", None)],
    # -- magazine ---------------------------------------------------------- #
    "magsize": [("stats", "magazine.size", "num", r"magazine\??\.size\b"),
                ("fire", "magSize", "num", r"\.magSize\b")],
    "numofmag": [("stats", "magazine.magazines", "num", r"magazine\??\.magazines\b"),
                 ("fire", "numOfMag", "num", r"\.numOfMag\b")],
    "magtype": [("stats", "magazine.type", "num", None),
                ("fire", "magType", "num", r"\.magType\b")],
    "reloadtime": [("stats", "magazine.reloadTime", "num", r"magazine\??\.reloadTime\b"),
                   ("fire", "reloadTime", "num", r"\.reloadTime\b")],
    "autoreload": [("stats", "magazine.autoReload", "bool", r"magazine\??\.autoReload\b"),
                   ("fire", "autoReload", "bool", r"\.autoReload\b")],
    "allowreloadonemptycliponly": [("stats", "magazine.reloadOnEmptyOnly", "bool",
                                    r"\.reloadOnEmptyOnly\b")],
    "ejectcliptime": [("stats", "magazine.ejectClipTime", "num", r"\.ejectClipTime\b")],
    "setweaponlink": [("stats", "magazine.link", "num", r"magazine\??\.link\b")],
    "timetonotallowchange": [("stats", "magazine.timeToNotAllowChange", "num",
                              r"\.timeToNotAllowChange\b")],
    # -- optic and view ---------------------------------------------------- #
    "zoomfov": [("stats", "zoom.fov", "num", r"zoom\??\.fov\b")],
    "soldierzoomfov": [("stats", "zoom.soldierFov", "num", r"zoom\??\.soldierFov\b")],
    "usescope": [("stats", "zoom.scope", "bool", r"zoom\??\.scope\b")],
    "setsnipersight": [("stats", "zoom.sniperSight", "bool", r"\.sniperSight\b")],
    "setscopeicon": [("stats", "zoom.icon", "str", r"zoom\??\.icon\b")],
    "setsighticon": [("stats", "zoom.sightIcon", "str", r"\.sightIcon\b")],
    "unzoombetweenfiretime": [("stats", "zoom.unZoomBetweenFire", "num",
                               r"\.unZoomBetweenFire\b")],
    "soldiercameraposition": [("stats", "view.cameraPosition", "vec",
                               r"cameraPosition|soldierCameraPosition")],
    "soldierzoomposition": [("stats", "view.zoomPosition", "vec",
                             r"zoomPosition|soldierZoomPosition")],
    # -- deviation and recoil ---------------------------------------------- #
    "setmindev": [("stats", "deviation.min", "num", r"deviation")],
    "mindeviation": [("stats", "deviation.minDeviation", "num", r"\.minDeviation\b")],
    "maxdeviation": [("stats", "deviation.maxDeviation", "num", r"\.maxDeviation\b")],
    "setfiredev": [("stats", "deviation.fire", "vec", r"deviation")],
    "setdevmod": [("stats", "deviation.mod", "vec", r"deviation\??\.mod\b")],
    "setturndev": [("stats", "deviation.turn", "vec", r"deviation")],
    "setspeeddev": [("stats", "deviation.speed", "vec", r"deviation")],
    "setmiscdev": [("stats", "deviation.misc", "vec", r"deviation")],
    "setrecoilforceup": [("stats", "recoil.up", "vec", r"recoil")],
    "setrecoilforceleftright": [("stats", "recoil.leftRight", "vec", r"recoil")],
    "sethasrecoilforce": [("stats", "recoil.hasForce", "bool", r"\.hasForce\b")],
    "setgobackonrecoil": [("stats", "recoil.goBack", "bool", r"\.goBack\b")],
    # -- HUD --------------------------------------------------------------- #
    "setammobar": [("stats", "hud.ammoBar", "str", r"\.ammoBar\b")],
    "setammobarfill": [("stats", "hud.ammoBarFill", "str", r"\.ammoBarFill\b")],
    "setammobarsize": [("stats", "hud.ammoBarSize", "num", r"\.ammoBarSize\b")],
    "setamombarposx": [("stats", "hud.posX", "num", r"\.posX\b")],
    "setamombarposy": [("stats", "hud.posY", "num", r"\.posY\b")],
    "setamombartextposx": [("stats", "hud.textPosX", "num", r"\.textPosX\b")],
    "setamombartextposy": [("stats", "hud.textPosY", "num", r"\.textPosY\b")],
    "setammoicon": [("stats", "hud.icon", "str", r"ammoHud\??\.icon|hud\??\.icon\b")],
    # -- the throw and the heat -------------------------------------------- #
    "firedelay": [("stats", "throw.fireDelay", "num", r"\.fireDelay\b"),
                  ("fire", "throw.fireDelay", "num", r"\.fireDelay\b")],
    "hideduringfiretime": [("stats", "throw.hideDuringFireTime", "num",
                            r"\.hideDuringFireTime\b")],
    "rotationalspeed": [("stats", "throw.rotationalSpeed", "vec", r"\.rotationalSpeed\b")],
    "heataddwhenfire": [("heat", "heatAddWhenFire", "num", r"\.heatAddWhenFire\b")],
    "cooldownpersec": [("heat", "coolDownPerSec", "num", r"\.coolDownPerSec\b")],
    "timedelayonoverheat": [("heat", "timeDelayOnOverheat", "num",
                             r"\.timeDelayOnOverheat\b")],
    "velocitydependentonheat": [("heat", "velocityDependentOnHeat", "bool",
                                 r"\.velocityDependentOnHeat\b")],
    # -- the barrels -------------------------------------------------------- #
    "setasynchronyfire": [("fire", "asynchronyFire", "bool", r"\.asynchronyFire\b")],
    "blastammocount": [("fire", "blastAmmoCount", "bool", r"\.blastAmmoCount\b")],
    "setinputfire": [("fire", "input", "str", r"fireArms\??\.input\b|\.input ===")],
    "addfirearmsposition": [("fire", "muzzles", "count", r"muzzle")],
}

# The round a weapon fires: `Projectile` word -> key of `fireArms.projectile`.
PROJECTILE_RULES: dict[str, tuple[str, str, str | None]] = {
    "timetolive": ("timeToLive", "num", r"\.timeToLive\b"),
    "gravitymodifier": ("gravity", "num", r"\.gravity\b"),
    "material": ("material", "num", r"\.material\b"),
    "mass": ("mass", "num", r"\.mass\b"),
    "drag": ("drag", "num", r"\.drag\b"),
    "haspointphysics": ("hasPointPhysics", "bool", r"\.hasPointPhysics\b"),
    "sethaspointphysics": ("hasPointPhysics", "bool", r"\.hasPointPhysics\b"),
    "stopatendeffect": ("stopAtEndEffect", "bool", r"\.stopAtEndEffect\b"),
    "endeffecttemplate": ("endEffect", "str", r"\.endEffect\b"),
    "mindamage": ("damage.minDamage", "num", r"\.minDamage\b"),
    "disttostartlosedamage": ("damage.distToStartLoseDamage", "num",
                              r"\.distToStartLoseDamage\b"),
    "disttomindamage": ("damage.distToMinDamage", "num", r"\.distToMinDamage\b"),
    "radius": ("damage.radius", "int", r"damage\??\.radius\b|\.radius\b"),
    "material2": ("damage.material2", "num", r"\.material2\b"),
    "damagetype": ("damage.damageType", "num", r"\.damageType\b"),
    "hascollisioneffect": ("damage.hasCollisionEffect", "bool", r"\.hasCollisionEffect\b"),
    "dieaftercoll": ("damage.dieAfterColl", "bool", r"\.dieAfterColl\b"),
    "hasontimeeffect": ("damage.hasOnTimeEffect", "bool", r"\.hasOnTimeEffect\b"),
    "ymodonexplosion": ("damage.yModOnExplosion", "num", r"\.yModOnExplosion\b"),
    "detonateonwatercollision": ("damage.detonateOnWaterCollision", "bool",
                                 r"\.detonateOnWaterCollision\b"),
}

# Words that are not behaviour a table can carry: the model's own build
# (skeleton, children, placement), the netcode and the bots.
STRUCTURE = frozenset({
    "addtemplate", "createskeleton", "useskeletonpartasmain", "projectileposition",
    "setposition", "setrotation", "geometry", "hascollisionphysics",
    "hasmobilephysics", "networkableinfo", "setnetworkableinfo", "hasdynamicshadow",
    "guiindex", "setinputid", "cullradiusscale", "aitemplate", "itemindex",
    "visibledummyprojectiletemplate", "settracertemplate", "tracerinterval",
    "hasarmor", "material", "hitpoints", "maxhitpoints", "invisible",
    "setprojectiletemplate", "loadsoundscript2", "saveingamesafe",
    "setvisibledummyprojectiletemplate", "forceonexplosion", "mass", "drag",
})

# A round's own build and plumbing.
PROJECTILE_STRUCTURE = frozenset({
    "sethascollisionphysics", "loadsoundscript", "hasresponsephysics",
    "sethasresponsephysics", "createnotingrid", "saveinseparatefile",
    "starteffecttemplate", "timeonendeffect", "explosionforce",
})

# A disagreement somebody has looked at: (class, word or key) -> verdict.
# Counted like any other, and listed with the verdict beside it.
KNOWN: dict[tuple[str, str], str] = {}


def known(cls: str, what: str) -> str | None:
    return KNOWN.get((cls, what.lower()))


# --------------------------------------------------------------------------- #
# ours: the trees
# --------------------------------------------------------------------------- #


def models_root(mod: str) -> Path:
    return VIEWER / "models" if mod == "bf1942" else VIEWER / "models" / "mods" / mod


def maps_root(mod: str) -> Path:
    return VIEWER / "maps" if mod == "bf1942" else VIEWER / "maps" / "mods" / mod


def read_glb_json(path: Path) -> dict | None:
    try:
        doc, _ = glbopt.read_glb(path.read_bytes())
    except (OSError, ValueError, KeyError):
        return None
    return doc


def dig(block: dict | None, dotted: str):
    value = block
    for part in dotted.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def same(kind: str, declared: str, ours, every: list[str] | None = None) -> bool:
    """Is our value the one the script wrote. A list of ours is compared
    against as many of the script's numbers as it has (a recoil range keeps
    two of `CRD_UNIFORM/1/2/0`'s three)."""
    if kind == "bool":
        return boolean(declared) == bool(ours)
    if kind == "str":
        return str(ours).lower() == text(declared).lower()
    if kind == "count":
        return ours == len(every or [declared])
    want = numbers(declared)
    have = list(ours) if isinstance(ours, (list, tuple)) else [ours]
    if kind == "int":
        want = [float(int(v)) for v in want]
    if not want or any(not isinstance(v, (int, float)) for v in have):
        return False
    if len(have) > len(want):
        return False
    return all(abs(float(a) - b) <= 1e-6 * max(1.0, abs(b)) for a, b in zip(have, want))


class PageSource:
    """Every module of `viewer/`, for the question "does anything read this
    key". A regex that matches nowhere is a key the page carries and ignores."""

    def __init__(self, root: Path = VIEWER) -> None:
        self.text = "\n".join(
            path.read_text(errors="replace") for path in sorted(root.glob("*.js"))
            if not path.name.endswith(".test.js"))
        self._memo: dict[str, bool] = {}

    def reads(self, pattern: str | None) -> bool:
        if pattern is None:
            return True
        if pattern not in self._memo:
            self._memo[pattern] = re.search(pattern, self.text) is not None
        return self._memo[pattern]


# --------------------------------------------------------------------------- #
# the kits of a level
# --------------------------------------------------------------------------- #


def level_weapons(loadouts: dict, levels: list[str]) -> dict[str, dict]:
    """`{weapon.lower(): {name, kits: {(level, kit)}, soldiers: {soldier}}}`
    for every item the levels' kits carry, a rolled item as each variant."""
    found: dict[str, dict] = {}
    for level in levels:
        teams = loadouts.get("levels", {}).get(level)
        if teams is None:
            raise SystemExit(f"{level}: not in loadouts.json")
        own = loadouts.get("levelKits", {}).get(level, {})
        dealt = [(kit, team.get("soldier")) for team in teams.values()
                 for kit in team.get("slots", {}).values()]
        # A kit the level places on the ground: any soldier may take it.
        soldiers = sorted({s for _, s in dealt if s})
        dealt += [(kit, None) for kit in own if kit not in {k for k, _ in dealt}]
        for kit, soldier in dealt:
            row = own.get(kit) or loadouts.get("kits", {}).get(kit)
            if row is None:
                continue
            rolled = {entry["template"].lower(): entry.get("variants") or []
                      for entry in row.get("random") or []}
            for item in row.get("items", []):
                for name in rolled.get(item.lower(), [item]):
                    if not name:
                        continue
                    entry = found.setdefault(name.lower(), {
                        "name": name, "kits": set(), "soldiers": set()})
                    entry["kits"].add((level, kit))
                    entry["soldiers"].update([soldier] if soldier else soldiers)
    return found


# --------------------------------------------------------------------------- #
# the diff
# --------------------------------------------------------------------------- #


class Report:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def add(self, cls: str, weapon: str, what: str, detail: str, *,
            template: str | None = None, declared=None, ours=None) -> None:
        self.rows.append({
            "class": cls, "weapon": weapon, "template": template or weapon,
            "what": what, "detail": detail, "declared": declared, "ours": ours,
            "known": known(cls, what)})


def check_words(report: Report, weapon: str, raw: dict, blocks: dict[str, tuple[str, dict | None]],
                page: PageSource) -> None:
    """One FireArms template's words against the blocks that should carry
    them. `blocks` maps a rule's block name to `(label, data)`; a block that
    is None is not there to compare (reported once, elsewhere)."""
    words = template_words(raw)
    for word, values in sorted(words.items()):
        rules = RULES.get(word)
        if rules is None:
            if word in STRUCTURE:
                continue
            report.add("a", weapon, word, "no reader carries the word",
                       template=raw["name"], declared=values[-1])
            continue
        declared = values[-1]
        for block, key, kind, pattern in rules:
            for label, data in blocks.get(block, []):
                if data is None:
                    continue
                ours = dig(data, key)
                if ours is None:
                    # A bool the script writes as 0 and we leave out says the
                    # same thing; so does a count of one barrel.
                    if kind == "bool" and boolean(declared) is False:
                        continue
                    if kind == "num" and word in ("unzoombetweenfiretime", "ejectcliptime",
                                                  "timetonotallowchange", "firedelay",
                                                  "hideduringfiretime", "heataddwhenfire",
                                                  "cooldownpersec", "timedelayonoverheat") \
                            and numbers(declared) == [0.0]:
                        continue
                    report.add("a", weapon, word, f"not in {label} ({key})",
                               template=raw["name"], declared=declared)
                elif not same(kind, declared, ours, values):
                    report.add("c", weapon, word, f"{label} {key}",
                               template=raw["name"], declared=declared, ours=ours)
                elif not page.reads(pattern):
                    report.add("b", weapon, word, f"{label} {key}: no page module reads it",
                               template=raw["name"], declared=declared, ours=ours)


def check_projectile(report: Report, weapon: str, launcher: dict, raws: dict,
                     fire: dict | None, page: PageSource) -> None:
    words = template_words(launcher)
    name = text(words["projectiletemplate"][-1]) if words.get("projectiletemplate") else ""
    if not name:
        return
    raw = raws.get(name.lower())
    if raw is None:
        report.add("e", weapon, "projectileTemplate", f"{name}: no script declares it",
                   template=launcher["name"])
        return
    spec = (fire or {}).get("projectile") if fire else None
    if not isinstance(spec, dict):
        return
    for word, values in sorted(template_words(raw).items()):
        rule = PROJECTILE_RULES.get(word)
        if rule is None:
            if word not in STRUCTURE and word not in PROJECTILE_STRUCTURE:
                report.add("a", weapon, f"projectile.{word}",
                           "no reader carries the word", template=name,
                           declared=values[-1])
            continue
        key, kind, pattern = rule
        declared, ours = values[-1], dig(spec, key)
        if ours is None:
            if kind == "bool" and boolean(declared) is False:
                continue
            report.add("a", weapon, f"projectile.{word}", f"{name}: not in fireArms.projectile ({key})",
                       template=name, declared=declared)
        elif not same(kind, declared, ours):
            report.add("c", weapon, f"projectile.{word}", f"{name}: fireArms.projectile {key}",
                       template=name, declared=declared, ours=ours)
        elif not page.reads(pattern):
            report.add("b", weapon, f"projectile.{word}",
                       f"{name}: {key}: no page module reads it", template=name,
                       declared=declared, ours=ours)


class Sounds:
    """The mod's sound scripts and samples, and its weapon manifest."""

    def __init__(self, chain, objects, root: Path) -> None:
        from bf42.rfa import ArchivePool, find_archives_dir
        from extract_map import SOUND_ARCHIVES

        self.objects = objects
        self.pool = ArchivePool()
        for mod_dir in chain:
            archives = find_archives_dir(mod_dir)
            if archives is not None:
                self.pool.add_dir(archives, SOUND_ARCHIVES)
        self.root = root / "sounds"
        try:
            manifest = json.loads((self.root / "weapons.json").read_text())
        except (OSError, ValueError):
            manifest = {}
        self.weapons = {k.lower(): v for k, v in (manifest.get("weapons") or {}).items()}
        self.silent = {k.lower(): v for k, v in (manifest.get("silent") or {}).items()}

    def read(self, path: str) -> str | None:
        hit = self.objects.find(path)
        return self.objects.read(hit).decode("latin-1") if hit else None

    def check(self, report: Report, weapon: str, template, raw: dict) -> None:
        import extract_weapon_sounds as ews
        from bf42.level import parse_ssc, resolve_ssc_path
        from extract_map import RELOAD_SLOT, VEHICLE_RATES, resolve_sound

        name = raw["name"]
        entry = self.weapons.get(name.lower())
        words = template_words(raw)
        scripts = [text(v) for v in words.get("loadsoundscript", [])]
        if not scripts:
            if entry is not None:
                report.add("d", weapon, "loadSoundScript",
                           f"the script binds none and the manifest plays {entry.get('wav')}",
                           template=name)
            return
        if len(set(s.lower() for s in scripts)) > 1:
            report.add("d", weapon, "loadSoundScript",
                       "written more than once with different scripts: "
                       + ", ".join(scripts), template=name)
        declared = scripts[-1]
        path = resolve_ssc_path(template.source if template else raw["source"], declared)
        source = self.read(path)
        if source is None:
            report.add("d", weapon, "loadSoundScript", f"script not in the install: {path}",
                       template=name, declared=declared)
            return
        patches = parse_ssc(source, level=ews.WEAPON_SOUND_LEVEL, include=self.read,
                            source=path)
        # Every sample the script loads, against the install.
        for index, patch in enumerate(patches):
            for sample in ews._non_silence(patch.samples):
                if resolve_sound(sample.file, None, self.pool, VEHICLE_RATES) is None:
                    report.add("d", weapon, f"patch {index}",
                               f"sample not in the install: {sample.file}", template=name)
        sample, slot = ews.fire_sample(patches)
        if sample is None:
            if entry is not None:
                report.add("d", weapon, "fire", f"script is silent ({slot}) and the manifest "
                           f"plays {entry.get('wav')}", template=name)
            return
        if entry is None:
            why = self.silent.get(name.lower(), "not in the manifest")
            report.add("d", weapon, "fire", f"no manifest entry ({why}); the script's "
                       f"{slot} is {Path(sample.file.replace(chr(92), '/')).name}",
                       template=name)
            return
        if (entry.get("script") or "").lower() != path.lower():
            report.add("d", weapon, "script", "manifest plays another script",
                       template=name, declared=path, ours=entry.get("script"))
        want = Path(sample.file.replace("\\", "/")).stem.lower()
        have = Path(entry.get("wav") or "").stem.lower()
        # A tier or sample-rate twin of the pick keeps its stem's start.
        if want != have and not (have.startswith(want) or want.startswith(have)):
            report.add("d", weapon, "fire", f"manifest report is not the script's ({slot})",
                       template=name, declared=want, ours=have)
        if entry.get("slot") != slot:
            report.add("d", weapon, "fire", "manifest slot is not the script's",
                       template=name, declared=slot, ours=entry.get("slot"))
        if bool(entry.get("loop")) != bool(sample.loop):
            report.add("d", weapon, "fire", "loop flag", template=name,
                       declared=sample.loop, ours=entry.get("loop"))
        # The slots the engine triggers besides the round's.
        reload_loads = (ews._non_silence(patches[RELOAD_SLOT].samples)
                        if len(patches) > RELOAD_SLOT else [])
        mag = numbers((words.get("magsize") or ["-1"])[-1])
        if reload_loads and "reload" not in entry and mag and mag[0] > 0:
            report.add("d", weapon, "reload", "the script's Reload slot has loads and "
                       "the manifest ships none", template=name)
        eject = numbers((words.get("ejectcliptime") or ["0"])[-1])
        if eject and eject[0] > 0 and len(patches) > ews.EJECT_SLOT \
                and ews._non_silence(patches[ews.EJECT_SLOT].samples) and "eject" not in entry:
            report.add("d", weapon, "eject", "ejectClipTime and a seventh patch, "
                       "and the manifest ships no eject", template=name)
        for file in sorted(_manifest_files(entry)):
            if not (self.root / file).is_file():
                report.add("e", weapon, "sound file", f"{file} is named by the manifest "
                           "and not on disk", template=name)


def _manifest_files(entry) -> set[str]:
    files: set[str] = set()
    if isinstance(entry, dict):
        for key, value in entry.items():
            if key == "file" and isinstance(value, str):
                files.add(value)
            else:
                files |= _manifest_files(value)
    elif isinstance(entry, list):
        for value in entry:
            if isinstance(value, str) and value.endswith(".mp3"):
                files.add(value)
            else:
                files |= _manifest_files(value)
    return files


def hud_file(root: Path, icon: str) -> bool:
    """A HUD texture the scripts name, as `extract_hud_pack.py` files it: the
    base name, lower case, `.png`, in the mod's or vanilla's `_shared/hud`,
    under its folder's name too where two folders hold one name
    (`Weapon/Icon_bren` is `weapon_icon_bren.png`)."""
    path = Path(icon.replace("\\", "/"))
    stems = {path.stem.lower(), f"{path.parent.name}_{path.stem}".lower()}
    return any((folder / "_shared" / "hud" / f"{stem}.png").is_file()
               for folder in (root, VIEWER / "maps") for stem in stems)


def fire_nodes(doc: dict | None) -> dict[str, dict]:
    """`{template.lower(): fireArms extras}` of a glb's FireArms nodes."""
    found: dict[str, dict] = {}
    for node in (doc or {}).get("nodes", []):
        extras = node.get("extras") or {}
        if isinstance(extras.get("fireArms"), dict):
            found.setdefault(str(node.get("name", "")).lower(), extras["fireArms"])
    return found


def child_fire_arms(raws: dict, raw: dict, seen: set[str] | None = None) -> list[dict]:
    """The FireArms templates under a weapon, itself not included."""
    seen = {raw["name"].lower()} if seen is None else seen
    found: list[dict] = []
    for word, args in raw["lines"]:
        if word != "addtemplate" or not args:
            continue
        child = raws.get(args.split()[0].lower())
        if child is None or child["name"].lower() in seen:
            continue
        seen.add(child["name"].lower())
        if child["kind"].lower() in WEAPON_KINDS:
            found.append(child)
        found += child_fire_arms(raws, child, seen)
    return found


def run(mod: str, levels: list[str] | None, game_dir: Path, only: set[str] | None = None,
        library: RawLibrary | None = None) -> dict:
    from extract_models import build_library, build_pools, mod_chain
    from patch_flag_cloth import MODS

    warnings.simplefilter("ignore", ResourceWarning)
    if mod not in MODS:
        raise SystemExit(f"unknown tree {mod!r}; have {', '.join(MODS)}")
    chain = mod_chain(game_dir, MODS[mod])
    _, _, objects, _ = build_pools(chain, [])
    if library is None:
        library = build_library(objects, RawLibrary())
    raws = library.raw
    models, maps = models_root(mod), maps_root(mod)
    loadouts = json.loads((maps / "_shared" / "loadouts.json").read_text())
    levels = levels or sorted(loadouts.get("levels", {}))
    dealt = level_weapons(loadouts, levels)
    if only:
        dealt = {k: v for k, v in dealt.items() if k in only}
    page = PageSource()
    sounds = Sounds(chain, objects, models)
    try:
        rigs = {name.lower(): name for name in json.loads(
            (models / "viewmodels" / "index.json").read_text())}
    except (OSError, ValueError):
        rigs = {}
    report = Report()
    table: dict[str, dict] = {}
    for key in sorted(dealt):
        entry = dealt[key]
        raw = raws.get(key)
        weapon = raw["name"] if raw else entry["name"]
        row = table[weapon] = {
            "kits": sorted(f"{level}:{kit}" for level, kit in entry["kits"]),
            "source": raw["source"] if raw else None, "children": []}
        if raw is None:
            report.add("e", weapon, "template", "a kit carries it and no script declares it")
            continue
        if raw["kind"].lower() not in WEAPON_KINDS:
            row["kind"] = raw["kind"]
            continue
        if library.reopened.get(key):
            report.add("a", weapon, "ObjectTemplate.active",
                       "reopened after its create; add_con reads none of what follows")
        doc = read_glb_json(models / f"{weapon}.glb")
        # A weapon that draws nothing (FHSW's bare hands, `scold*`) has rigs
        # and no model of its own.
        if doc is None and not any(f"{s}__{weapon}".lower() in rigs
                                   for s in entry["soldiers"]):
            report.add("e", weapon, "glb", f"{weapon}.glb is not in the tree")
        stats = (doc or {}).get("extras", {}).get("weapon") if doc else None
        nodes = fire_nodes(doc)
        blocks: dict[str, list] = {
            "stats": [("weapon glb", stats)] if doc else [],
            "fire": [("weapon glb fireArms", nodes.get(key))] if doc else [],
            "heat": [],
        }
        fire_spec = nodes.get(key)
        words = template_words(raw)
        has_round = bool(words.get("projectiletemplate"))
        if doc and has_round and key not in nodes:
            report.add("a", weapon, "fireArms", "the glb has no fireArms node for it")
        for soldier in sorted(entry["soldiers"]):
            rig_name = f"{soldier}__{weapon}"
            if rig_name.lower() not in rigs:
                report.add("e", weapon, "rig", f"no first-person rig for {soldier}")
                continue
            rig = read_glb_json(models / "viewmodels" / f"{rigs[rig_name.lower()]}.fp.glb")
            if rig is None:
                report.add("e", weapon, "rig", f"{rig_name}.fp.glb is indexed and unreadable")
                continue
            rig_stats = rig.get("extras", {}).get("weaponStats")
            blocks["stats"].append((f"rig {soldier}", rig_stats))
            blocks["heat"].append((f"rig {soldier}", (rig_stats or {}).get("heat") or {}))
            rig_nodes = fire_nodes(rig)
            fire_spec = fire_spec or rig_nodes.get(key)
            nodes = {**rig_nodes, **nodes}
            if has_round:
                blocks["fire"].append((f"rig {soldier} fireArms", rig_nodes.get(key)))
                if key not in rig_nodes:
                    report.add("a", weapon, "fireArms",
                               f"rig {soldier} has no fireArms node for it")
            for child in child_fire_arms(raws, raw):
                if template_words(child).get("projectiletemplate") \
                        and child["name"].lower() not in rig_nodes:
                    report.add("a", weapon, "fireArms",
                               f"rig {soldier} has no fireArms node for {child['name']}",
                               template=child["name"])
        check_words(report, weapon, raw, blocks, page)
        check_projectile(report, weapon, raw, raws, fire_spec, page)
        sounds.check(report, weapon, library.object(weapon), raw)
        for child in child_fire_arms(raws, raw):
            row["children"].append(child["name"])
            child_key = child["name"].lower()
            check_words(report, weapon, child,
                        {"fire": [("fireArms", nodes.get(child_key))]},
                        page)
            check_projectile(report, weapon, child, raws, nodes.get(child_key), page)
            sounds.check(report, weapon, library.object(child["name"]), child)
        # The HUD art the weapon names.
        for word in ("setammobar", "setammobarfill", "setammoicon", "setscopeicon",
                     "setsighticon"):
            for value in words.get(word, [])[-1:]:
                if text(value) and not hud_file(maps, text(value)):
                    report.add("e", weapon, word, f"{text(value)}: not in _shared/hud")
        row["words"] = {word: values[-1] for word, values in sorted(words.items())
                        if word not in STRUCTURE}
        row["ours"] = stats
    # The kit's own icon row.
    for kit_name in sorted({kit for e in dealt.values() for _, kit in e["kits"]}):
        kit_row = loadouts.get("kits", {}).get(kit_name) or {}
        for weapon_row in kit_row.get("weapons", []):
            icon = weapon_row.get("icon")
            if icon and not hud_file(maps, icon):
                report.add("e", weapon_row.get("weapon", "?"), "kit icon",
                           f"{kit_name}: {icon} not in _shared/hud")
    by_class = Counter(row["class"] for row in report.rows)
    open_by_class = Counter(row["class"] for row in report.rows if not row["known"])
    return {"mod": mod, "levels": levels, "weapons": len(table),
            "byClass": dict(sorted(by_class.items())),
            "openByClass": dict(sorted(open_by_class.items())),
            "rows": report.rows, "table": table}


CLASS_NAMES = {"a": "declared, not extracted", "b": "extracted, not honoured by the page",
               "c": "extracted wrong", "d": "sound", "e": "asset missing"}


def render(result: dict, verbose: bool = False, only_open: bool = False) -> str:
    out = [f"{result['mod']}: {result['weapons']} hand weapon(s) on "
           f"{len(result['levels'])} level(s); "
           + ", ".join(f"{cls} {count}" for cls, count in result["byClass"].items())
           + f" ({sum(result['openByClass'].values())} with no verdict)"]
    for cls in "abcde":
        rows = [r for r in result["rows"] if r["class"] == cls
                and not (only_open and r["known"])]
        if not rows:
            continue
        out.append(f"\n[{cls}] {CLASS_NAMES[cls]}: {len(rows)}")
        groups: dict[tuple, list[dict]] = defaultdict(list)
        for row in rows:
            detail = re.sub(r"^(?:weapon glb|rig \w+)(?: fireArms)? |for \w+", "",
                            row["detail"]).strip()
            head = f"{row['what']}: {detail}" if cls != "e" else \
                f"{row['what']}: " + re.sub(r"^.*\b(not in|is named|is not in|no first)", r"\1",
                                            row["detail"])
            if row["what"].startswith("projectile."):
                head = f"{row['what']}: " + row["detail"].split(": ", 1)[-1]
            groups[(head, row["known"])].append(row)
        for (head, verdict), members in sorted(groups.items(), key=lambda kv: -len(kv[1])):
            names = sorted({m["weapon"] for m in members})
            shown = ", ".join(names[:6]) + (f" +{len(names) - 6}" if len(names) > 6 else "")
            sample = members[0]
            values = ""
            if sample["declared"] is not None or sample["ours"] is not None:
                values = f" [script {sample['declared']!r} / ours {sample['ours']!r}]"
            out.append(f"  {len(names):4d}  {head}{values}: {shown}"
                       + (f"\n          = {verdict}" if verdict else ""))
            if verbose:
                for member in members:
                    out.append(f"          {member['weapon']} ({member['template']}): "
                               f"{member['detail']} script={member['declared']!r} "
                               f"ours={member['ours']!r}")
    return "\n".join(out)


def main() -> int:
    from extract_models import DEFAULT_GAME_DIR

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mod", required=True,
                        help="viewer tree name (bf1942 = vanilla, xpack1, fh, fhsw, ...)")
    parser.add_argument("--levels", default="",
                        help="level folders, comma separated (default: every level "
                             "in the tree's loadouts.json)")
    parser.add_argument("--weapon", action="append", default=[],
                        help="only this weapon template (repeatable)")
    parser.add_argument("--json", type=Path, help="write the whole table here")
    parser.add_argument("--verbose", action="store_true", help="one line per weapon and row")
    parser.add_argument("--open", action="store_true",
                        help="leave out the disagreements KNOWN has a verdict on")
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    args = parser.parse_args()
    levels = [name.strip() for name in args.levels.split(",") if name.strip()]
    result = run(args.mod, levels or None, args.game_dir.expanduser(),
                 {name.lower() for name in args.weapon} or None)
    print(render(result, args.verbose, args.open))
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(result, indent=1, default=sorted))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
