#!/usr/bin/env python3
"""What each side of an exported level is dealt, and whether it all works:
four static audits written from the owner's FHSWEurope Ulsnes report
(2026-10-21: a US flag beside Norway, a Norwegian shotgun that flashed white
and fired silently, Einunna Bridge's kits on Ulsnes, bot grenades that never
left the hand).

    python3 audit_mod.py --mod <id> --audit loadouts armoury nations flagcloth

loadouts  per level and side, `loadouts.json` `levels.<level>` against the
          level's own `Init.con` (`game.setTeamSkin` / `game.setKit`, read
          from the level as the engine mounts it, every archive of its name
          down the chain): the soldier and each slot's kit. A kit the
          level's run scripts declare beats the chain's (LOAD-1, LOAD-2), so
          the row the page deals (`levelKits[<level>][<kit>]`, else `kits`)
          must carry that copy's hand weapons and `addWeaponIcon` row. And
          every dealt row's `weapons[].icon` is its slot's `addWeaponIcon`
          entry (one icon per slot, `extract_loadouts.slot_icon`).
armoury   every hand weapon a dealt kit puts in a hand (a rolled item's
          variants included), as the page fetches it: a sound entry in the
          tree's `sounds/weapons.json`, a third-person `<Weapon>.glb` (mod
          tree, then vanilla's, exact case: the bots' FireArms and every
          muzzle flash come from it), a FireArms with a round in it, the
          round in the level's `damage.json` projectile table, a first-person
          rig, and for a thrown weapon (a `fireDelay` or a fuse round) a round
          `bot-rounds.js` flies (a `shell` or `rocket` body).
nations   per level and side: the soldier's art in `soldier-icons.json`
          (HUD-11) names a nation; the Instant Battle row in
          `menu-levels.json` names the same soldier and nation; and the
          nation's `conp_`, `flag_ticket_`, `icon_flag_` sprites and the menu
          flag texture resolve through the HUD pack (`hud-pack.js`).
flagcloth every control-point flag cloth in the level's bake against the
          level's `textureManager.alternativePath` list: where an alternative
          folder holds the cloth's texture (Ulsnes's `Texture/NOR_ALTERNATIVE/
          flags_o.dds`), the engine draws that one (ledger LOAD-3, rfa.py
          `engine_texture`), so the baked image must be it. Remote-only levels
          (`evict_levels.py`) are read from the volume's glb, JSON chunk only,
          cached by the marker's sha256.

Everything here reads the published tree plus the install; nothing is
written. Each finding carries severity and the owning script.
"""

from __future__ import annotations

import json
import os
import re
import struct
import sys
import time
import urllib.request
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE / "viewer"
LIVE = os.environ.get("BF_MESH_LIVE", "https://mesh.bfstats.io")
CACHE = Path(os.environ.get("BF_AUDIT_CACHE", Path.home() / ".cache" / "bfstats-audit"))

PLAY_BREAKS = {
    "loadout-level-missing": "vanilla kits",
    "loadout-soldier-mismatch": "wrong soldier",
    "loadout-slot-mismatch": "wrong kit",
    "level-kit-row-stale": "wrong weapons in the kit",
    "weapon-no-sound": "fires silently",
    "weapon-no-model": "fires invisibly (bots, third person)",
    "weapon-model-case-mismatch": "fires invisibly (bots, third person)",
    "weapon-no-firearms": "cannot fire",
    "thrown-round-not-flown": "bot grenade never leaves the hand",
}

ACCEPTED = {
    "weapon-draws-nothing":
        "the weapon's template tree has no renderable geometry (FHSWEurope's "
        "scold-only smoke rolls, the Deploy_Cavalry horse items): the models "
        "step exports nothing for it by design, and its first-person rig "
        "carries the FireArms the player fires",
    "weapon-sound-absent-from-install":
        "the weapon's FireArms binds no sound script, or one whose samples are in "
        "no archive of the chain: silent in retail too",
}

_NOT_A_WEAPON = re.compile(r"^scold", re.I)
_CREATE = re.compile(r"^\s*objecttemplate\.(create|activesafe)\s+(\S+)\s+(\S+)", re.I)
_ADD_TEMPLATE = re.compile(r"^\s*objecttemplate\.addtemplate\s+(\S+)", re.I)
_ADD_ICON = re.compile(r"^\s*objecttemplate\.addweaponicon\s+(\S+)", re.I)
_ALT_PATH = re.compile(r"^\s*texturemanager\.alternativepath\s+(\S+)", re.I | re.M)
_WEAPON_KINDS = {"handfirearms"}


# ---------------------------------------------------------------------------
# shared readers
# ---------------------------------------------------------------------------

def exported_dirs(tree) -> dict[str, str]:
    """The tree's exported levels as {level dir (lower): maps.json name}: the
    rows of maps.json (FHSW and FHSWEurope: the rows with a `loading` block),
    cut to `tree.scope` when the pass is scoped."""
    try:
        rows = json.loads((tree.maps / "maps.json").read_text())
    except (OSError, ValueError):
        return {lv.lower(): lv for lv in tree.levels}
    if isinstance(rows, dict):
        rows = rows.get("maps") or rows.get("levels") or []
    if tree.mod_id in ("fhsw", "fhsweurope"):
        rows = [r for r in rows if r.get("loading")]
    out = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        d = str(r.get("glb") or r.get("report") or "").split("/")[0].lower()
        if d:
            out[d] = r.get("name") or d
    scope = getattr(tree, "scope", None)
    if scope is not None:
        out = {d: n for d, n in out.items() if d in scope or str(n).lower() in scope}
    return out


def _json(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _vanilla(tree) -> bool:
    return tree.mod_id == "bf1942"


class LevelSource:
    """One level as the engine mounts it: every archive of its name down the
    chain (`find_level_archives`), its root `Init.con`, the scripts that
    `Init.con` runs, and what those scripts declare. Cached per level on the
    game object; None-valued without the install."""

    def __init__(self, game, level_dir: str):
        self.ok = False
        self.init_text = ""
        self.run_texts: list[tuple[str, str]] = []
        self.alt_paths: list[str] = []
        if not getattr(game, "ok", False):
            return
        import extract_map as em  # noqa: PLC0415
        from bf42 import con as con_mod  # noqa: PLC0415
        try:
            paths = em.find_level_archives(game.game_dir, game.chain[0].name, level_dir,
                                           chain=game.chain)
        except Exception:  # noqa: BLE001
            paths = []
        if not paths:
            return
        try:
            files = em.load_level_files(paths, level_dir)
        except Exception:  # noqa: BLE001 - a truncated archive reads as absent
            return
        self.ok = True
        for rel in ("Init.con", "Init/SkyAndSun.con"):
            if files.find(rel):
                text = files.read(rel).decode("latin-1", "replace")
                if rel == "Init.con":
                    self.init_text = text
                self.alt_paths += [m.group(1).replace("\\", "/").strip("/")
                                   for m in _ALT_PATH.finditer(con_mod.strip_comments(text))]
        try:
            runs = em.level_run_scripts(files)
        except Exception:  # noqa: BLE001
            runs = []
        for path in runs:
            try:
                blob = files.read(path)
            except KeyError:
                continue
            self.run_texts.append((path, con_mod.strip_comments(
                blob.decode("latin-1", "replace"))))

    @classmethod
    def from_texts(cls, init_text: str, run_texts=(), alt_paths=()) -> "LevelSource":
        """A level from its script texts (tests): `run_texts` as (path, text)."""
        from bf42 import con as con_mod  # noqa: PLC0415
        src = cls.__new__(cls)
        src.ok = True
        src.init_text = init_text
        src.run_texts = [(p, con_mod.strip_comments(t)) for p, t in run_texts]
        src.alt_paths = list(alt_paths)
        return src

    def teams(self) -> dict:
        from bf42 import kit as kit_mod  # noqa: PLC0415
        return kit_mod.parse_level_kits(self.init_text) if self.init_text else {}

    def declarations(self) -> tuple[dict[str, str], dict[str, dict]]:
        """({name: kind} the run scripts create, first create wins;
        {kit name: {"name", "children", "icons", "script"}} for each Kit)."""
        if hasattr(self, "_decl"):
            return self._decl
        kinds: dict[str, str] = {}
        kits: dict[str, dict] = {}
        for path, text in self.run_texts:
            cur = None
            for line in text.splitlines():
                m = _CREATE.match(line)
                if m:
                    verb, kind, name = m.group(1).lower(), m.group(2), m.group(3)
                    cur = None
                    if verb != "create" or name.lower() in kinds:
                        continue   # a second create of a name makes nothing
                    kinds[name.lower()] = kind.lower()
                    if kind.lower() == "kit":
                        cur = kits[name.lower()] = {"name": name, "children": [],
                                                    "icons": [], "script": path}
                    continue
                if cur is None:
                    continue
                if (a := _ADD_TEMPLATE.match(line)):
                    cur["children"].append(a.group(1))
                elif (a := _ADD_ICON.match(line)):
                    cur["icons"].append(a.group(1).strip('"'))
        self._decl = (kinds, kits)
        return self._decl


def level_source(game, level_dir: str) -> LevelSource:
    cache = game.__dict__.setdefault("_sides_levels", {})
    if level_dir not in cache:
        cache[level_dir] = LevelSource(game, level_dir)
    return cache[level_dir]


def kind_of(game, src: LevelSource | None, name: str) -> str | None:
    """A template's kind as the level's load sees it: the level's own
    declaration first, then the chain's. None when neither declares it, or
    without the install."""
    if src is not None and src.ok:
        k = src.declarations()[0].get(name.lower())
        if k:
            return k
    if not getattr(game, "ok", False):
        return None
    t = game.library().object(name)
    return t.kind.lower() if t is not None else None


def effective_row(lo: dict, level: str, kit: str) -> tuple[dict | None, str]:
    """The kit row the page deals on `level` (`kit-loadout.js`): the level's
    own copy (`levelKits[level][kit]`) over the mod's (`kits[kit]`)."""
    own = ((lo.get("levelKits") or {}).get(level) or {})
    for k, row in own.items():
        if k.lower() == kit.lower():
            return row, "levelKits"
    for k, row in (lo.get("kits") or {}).items():
        if k.lower() == kit.lower():
            return row, "kits"
    return None, ""


def _finding(Finding, audit, cause, subject, detail, level, script, sev=None):
    f = Finding(audit, cause, subject, detail, level)
    if cause in ACCEPTED:
        f.severity, f.accepted = "info", ACCEPTED[cause]
    else:
        f.severity = sev or ("blocker" if cause in PLAY_BREAKS else "major")
    f.owning_script = script
    return f


# ---------------------------------------------------------------------------
# 1. loadouts
# ---------------------------------------------------------------------------

def slot_icon(icons: list, slot) -> str | None:
    if not isinstance(slot, int) or slot < 1 or slot > len(icons):
        return None
    return icons[slot - 1]


def icon_pairing_findings(row: dict, kit: str, level: str, Finding, where: str) -> list:
    """`weapons[].icon` must be its slot's `addWeaponIcon` entry."""
    out = []
    icons = list(row.get("weaponIcons") or [])
    bad = [f"{w.get('weapon')}@{w.get('slot')}: {w.get('icon')} != {slot_icon(icons, w.get('slot'))}"
           for w in row.get("weapons") or []
           if (w.get("icon") or None) != slot_icon(icons, w.get("slot"))]
    if bad:
        out.append(_finding(Finding, "loadouts", "kit-weapon-icon-misaligned", kit,
                            f"{where}: " + "; ".join(bad[:3]), level,
                            "extract_loadouts.py (step loadouts)"))
    return out


def run_loadouts(tree, game, ctx: dict, Finding) -> list:
    out: list = []
    lo = _json(tree.maps / "_shared" / "loadouts.json")
    if lo is None:
        return out
    levels = {k.lower(): v for k, v in (lo.get("levels") or {}).items()}
    exported = exported_dirs(tree)
    checked_rows: set = set()
    read = 0
    for level in sorted(exported):
        row = levels.get(level)
        if row is None:
            out.append(_finding(Finding, "loadouts", "loadout-level-missing", level,
                                "loadouts.json has no levels row: the page deals its "
                                "fallback kits", level, "extract_loadouts.py (step loadouts)"))
            continue
        src = level_source(game, level)
        dealt: list[str] = []
        if src.ok and src.init_text:
            read += 1
            oracle = src.teams()
            for team, want in sorted(oracle.items()):
                have = row.get(str(team)) or {}
                if (want.soldier or "").lower() != (have.get("soldier") or "").lower():
                    out.append(_finding(
                        Finding, "loadouts", "loadout-soldier-mismatch", f"team {team}",
                        f"Init.con setTeamSkin {want.soldier}, loadouts.json "
                        f"{have.get('soldier')}", level, "extract_loadouts.py (step loadouts)"))
                slots = {int(k): v for k, v in (have.get("slots") or {}).items()}
                for slot, kit in sorted(want.slots.items()):
                    if (slots.get(slot) or "").lower() != kit.lower():
                        out.append(_finding(
                            Finding, "loadouts", "loadout-slot-mismatch",
                            f"team {team} slot {slot}",
                            f"Init.con setKit {kit}, loadouts.json {slots.get(slot)}",
                            level, "extract_loadouts.py (step loadouts)"))
            # the level's own copy of each kit it deals
            kinds, kits = src.declarations()
            for team, want in sorted(oracle.items()):
                for slot, kit in sorted(want.slots.items()):
                    decl = kits.get(kit.lower())
                    if decl is None:
                        continue
                    eff, where = effective_row(lo, level, kit)
                    if eff is None:
                        continue
                    want_w = {c.lower() for c in decl["children"]
                              if kind_of(game, src, c) in _WEAPON_KINDS}
                    have_w = {i.lower() for i in eff.get("items") or []
                              if kind_of(game, src, i) in _WEAPON_KINDS}
                    want_i = [i.lower() for i in decl["icons"]]
                    have_i = [str(i).lower() for i in eff.get("weaponIcons") or []]
                    if want_w != have_w or (want_i and want_i != have_i):
                        diff = []
                        if want_w != have_w:
                            diff.append(f"level declares {sorted(want_w)}, "
                                        f"{where} row carries {sorted(have_w)}")
                        if want_i and want_i != have_i:
                            diff.append("addWeaponIcon row differs")
                        out.append(_finding(
                            Finding, "loadouts", "level-kit-row-stale", kit,
                            f"{decl['script']}: " + "; ".join(diff), level,
                            "extract_loadouts.py (step loadouts)"))
        else:
            out.append(_finding(Finding, "loadouts", "loadout-level-unread", level,
                                "no level archive or Init.con to read", level,
                                "the install", sev="info"))
        for team, side in sorted(row.items()):
            for slot, kit in sorted((side.get("slots") or {}).items()):
                dealt.append(kit)
        for kit in dict.fromkeys(dealt):
            eff, where = effective_row(lo, level, kit)
            if eff is None:
                continue
            key = (where, level if where == "levelKits" else "", kit.lower())
            if key in checked_rows:
                continue
            checked_rows.add(key)
            out += icon_pairing_findings(eff, kit, level, Finding, where)
    ctx["loadouts: levels read"] = f"{read} of {len(exported)}"
    return out


# ---------------------------------------------------------------------------
# 2. armoury
# ---------------------------------------------------------------------------

def _glb_json(path: Path) -> dict | None:
    try:
        with path.open("rb") as fh:
            head = fh.read(20)
            if len(head) < 20 or head[:4] != b"glTF":
                return None
            n = struct.unpack_from("<I", head, 12)[0]
            return json.loads(fh.read(n))
    except (OSError, ValueError):
        return None


def model_file(tree, name: str) -> tuple[Path | None, bool]:
    """(`<stem>.glb` the page fetches for `name`, exact case?) in the mod's
    model tree, then vanilla's (`pose-bases.js` `modelUrls`)."""
    stem = re.sub(r"[\\/]", "_", name)
    bases = [tree.models] if _vanilla(tree) else [tree.models, VIEWER / "models"]
    for base in bases:
        p = base / f"{stem}.glb"
        if p.is_file():
            return p, True
    listing = _model_listing(tree)
    for base in bases:
        hit = listing.get((str(base), f"{stem}.glb".lower()))
        if hit:
            return base / hit, False
    return None, False


_listing_cache: dict = {}


def _model_listing(tree) -> dict:
    key = str(tree.models)
    if key not in _listing_cache:
        out = {}
        bases = [tree.models] if _vanilla(tree) else [tree.models, VIEWER / "models"]
        for base in bases:
            try:
                for n in os.listdir(base):
                    if n.endswith(".glb"):
                        out.setdefault((str(base), n.lower()), n)
            except OSError:
                pass
        _listing_cache[key] = out
    return _listing_cache[key]


def fire_arms(doc: dict) -> dict | None:
    """The FireArms the page fires (`bot-barrels.js` `fireArmsNodes`): the
    node on `c_PIFire` with a round, else the first with a round."""
    found = [((n.get("extras") or {}).get("fireArms")) for n in doc.get("nodes") or []]
    found = [f for f in found if isinstance(f, dict)]
    for f in found:
        if f.get("input") == "c_PIFire" and isinstance(f.get("projectile"), dict):
            return f
    for f in found:
        if isinstance(f.get("projectile"), dict):
            return f
    return found[0] if found else None


def is_fuse_round(damage: dict | None) -> bool:
    """`projectile-damage.js` `isFuseRound`: a blast at the end of its life,
    none on impact, and the round does not die on contact."""
    if not damage:
        return False
    m2 = damage.get("material2")
    if not isinstance(m2, (int, float)) or m2 < 0:
        return False
    dtype = damage.get("damageType", 1)
    if dtype not in (1, 4):
        return False
    radius = damage.get("radius", 10)   # projectile-damage.js DEFAULT_SPLASH_RADIUS
    if not isinstance(radius, (int, float)) or int(radius) <= 0:
        return False
    hce = damage.get("hasCollisionEffect", True)
    impact = dtype == 1 and bool(hce)
    dies = bool(hce) or bool(damage.get("dieAfterColl"))
    return not impact and not dies


def throws(fa: dict) -> bool:
    p = fa.get("projectile")
    if not isinstance(p, dict):
        return False
    return ((fa.get("throw") or {}).get("fireDelay") or 0) > 0 or is_fuse_round(p.get("damage"))


def flies(fa: dict) -> bool:
    """`bot-rounds.js` `launchesDrawnRound`: a shell or a rocket, a fuse round,
    or a round carrying a depot or a spawner is flown; any other round is the
    referee's ray."""
    p = fa.get("projectile")
    return isinstance(p, dict) and (p.get("kind") in ("shell", "rocket")
                                    or is_fuse_round(p.get("damage"))
                                    or bool(p.get("depots")) or bool(p.get("spawners")))


def rig_pairs(tree) -> tuple[set[str] | None, dict]:
    """Every (soldier, weapon) pair with first-person arms in the trees the
    page reads (`arms-rig.js` `loadRigIndex`: the mod's, then vanilla's), and
    the pairs the extractor records as absent in retail too."""
    from bf42.glbstore import rig_pair_stems  # noqa: PLC0415
    bases = [tree.models] if _vanilla(tree) else [tree.models, VIEWER / "models"]
    pairs: set[str] | None = None
    absent: dict = {}
    for base in bases:
        doc = _json(base / "viewmodels" / "index.json")
        if doc is not None:
            pairs = (pairs or set()) | {s.lower() for s in rig_pair_stems(doc)}
        for r in _json(base / "viewmodels" / "absent.json") or []:
            absent.setdefault((str(r.get("soldier", "")).lower(),
                               str(r.get("weapon", "")).lower()), r.get("reason"))
    return pairs, absent


def dealt_items(lo: dict, level: str, row: dict) -> list[tuple[str, str, str]]:
    """(kit, soldier, weapon) for every hand weapon the level deals: every
    side's soldier with every kit any side is dealt (a dropped kit is anyone's,
    KITDROP-6), each rolled item as the variants it rolls."""
    kits, soldiers = [], []
    for _team, side in sorted(row.items()):
        if side.get("soldier"):
            soldiers.append(side["soldier"])
        kits += list((side.get("slots") or {}).values())
    out = []
    for kit in dict.fromkeys(kits):
        eff, _where = effective_row(lo, level, kit)
        if eff is None:
            continue
        rolls = {r["template"].lower(): [v for v in r.get("variants") or [] if v]
                 for r in eff.get("random") or [] if r.get("template")}
        for item in eff.get("items") or []:
            if _NOT_A_WEAPON.match(item):
                continue
            for weapon in rolls.get(item.lower(), [item]):
                for soldier in dict.fromkeys(soldiers):
                    out.append((kit, soldier, weapon))
    return out


def run_armoury(tree, game, ctx: dict, Finding) -> list:
    out: list = []
    lo = _json(tree.maps / "_shared" / "loadouts.json")
    if lo is None:
        return out
    sounds = _json(tree.models / "sounds" / "weapons.json") or {}
    sound_names = {k.lower() for k in (sounds.get("weapons") or {})}
    # `silent`: weapons the extractor read and found quiet, with the reason
    sound_names |= {f"\0{k.lower()}\0{v}" for k, v in (sounds.get("silent") or {}).items()}
    damage = _json(tree.maps / "_shared" / "damage.json") or {}
    rounds = {k.lower() for k in (damage.get("projectiles") or {})}
    pairs, absent = rig_pairs(tree)
    levels = {k.lower(): v for k, v in (lo.get("levels") or {}).items()}
    exported = exported_dirs(tree)
    weapon_seen: dict[str, list] = {}      # weapon (lower) -> findings, once a tree
    pair_seen: set = set()
    n_weapons = set()
    for level in sorted(exported):
        row = levels.get(level)
        if row is None:
            continue
        src = level_source(game, level)
        for kit, soldier, weapon in dealt_items(lo, level, row):
            key = weapon.lower()
            kind = kind_of(game, src, weapon)
            if kind is not None and kind not in _WEAPON_KINDS:
                continue
            n_weapons.add(key)
            if key not in weapon_seen:
                weapon_seen[key] = weapon_checks(
                    tree, weapon, kind, sound_names, rounds, Finding,
                    drawable=lambda w, lv=level: renders(game, lv, w))
                for f in weapon_seen[key]:
                    f.level = level
                    f.detail = f"{f.detail} (kit {kit})"
                out += weapon_seen[key]
            # the first-person rig, per (soldier, weapon)
            if pairs is not None:
                pair = f"{soldier}__{weapon}".lower()
                if pair not in pairs and pair not in pair_seen:
                    pair_seen.add(pair)
                    why = absent.get((soldier.lower(), weapon.lower()))
                    out.append(_finding(
                        Finding, "armoury",
                        "weapon-rig-engine-deleted" if why else "weapon-no-rig",
                        weapon, f"{soldier}: no first-person rig (kit {kit})", level,
                        "extract_viewmodel.py (step viewmodels)",
                        sev="info" if why else "blocker"))
    ctx["armoury: hand weapons dealt"] = len(n_weapons)
    return out


def renders(game, level: str, name: str) -> bool | None:
    """Whether `name`'s template tree draws anything, as the level's load
    declares it (`extract_all.has_renderable_geometry`, the models step's own
    gate): the chain's library, or for a template the level declares, a
    library of that level's load (built once per level). None without the
    install."""
    if not getattr(game, "ok", False):
        return None
    from extract_all import has_renderable_geometry  # noqa: PLC0415
    src = level_source(game, level)
    if src.ok and name.lower() in src.declarations()[0]:
        cache = game.__dict__.setdefault("_sides_level_libs", {})
        if level not in cache:
            try:
                from extract_loadouts import LevelLoad  # noqa: PLC0415
                load = LevelLoad(chain=game.chain, name=level)
                cache[level] = load.library
            except Exception:  # noqa: BLE001 - an unreadable level
                cache[level] = None
        lib = cache[level]
    else:
        lib = game.library()
    if lib is None or lib.object(name) is None:
        return None
    return bool(has_renderable_geometry(lib, name))


def weapon_checks(tree, weapon: str, kind: str | None, sound_names: set, rounds: set,
                  Finding, drawable=None) -> list:
    out: list = []
    path, exact = model_file(tree, weapon)
    if path is None:
        if drawable is not None and drawable(weapon) is False:
            out.append(_finding(Finding, "armoury", "weapon-draws-nothing", weapon,
                                "its template tree draws nothing (an empty roll, a "
                                "deploy item): no third-person glb by design", "",
                                "the mod's data (extract_all has_renderable_geometry)"))
        else:
            out.append(_finding(Finding, "armoury", "weapon-no-model", weapon,
                                f"no {weapon}.glb in the mod's or vanilla's model tree",
                                "", "extract_models.py (step models)"))
        return out
    if not exact:
        out.append(_finding(Finding, "armoury", "weapon-model-case-mismatch", weapon,
                            f"the page asks {weapon}.glb, the tree holds {path.name}",
                            "", "extract_models.py (step models)"))
    doc = _glb_json(path) or {}
    fa = fire_arms(doc)
    if fa is None or not isinstance(fa.get("projectile"), dict):
        # a melee weapon, binoculars, a pack: nothing to fire
        if kind in _WEAPON_KINDS and fa is not None:
            out.append(_finding(Finding, "armoury", "weapon-no-firearms", weapon,
                                f"{path.name}: a FireArms with no round", "",
                                "extract_models.py (step models)"))
        return out
    if not (doc.get("extras") or {}).get("weapon"):
        out.append(_finding(Finding, "armoury", "weapon-no-firearms", weapon,
                            f"{path.name}: no document `extras.weapon` (bots read it)", "",
                            "extract_models.py (step models)"))
    if weapon.lower() not in sound_names:
        quiet = next((k.split("\0")[2] for k in sound_names
                      if k.startswith(f"\0{weapon.lower()}\0")), None)
        if quiet is not None:
            out.append(_finding(Finding, "armoury", "weapon-sound-absent-from-install",
                                weapon, f"weapons.json silent: {quiet}", "",
                                "the mod's data (extract_weapon_sounds.py)"))
        else:
            out.append(_finding(Finding, "armoury", "weapon-no-sound", weapon,
                                "no entry in sounds/weapons.json, read or quiet", "",
                                "extract_weapon_sounds.py (step sounds)"))
    proj = fa["projectile"]
    tpl = str(proj.get("template") or "")
    if rounds and tpl and tpl.lower() not in rounds:
        out.append(_finding(Finding, "armoury", "round-not-in-damage-table", weapon,
                            f"{tpl} is not in _shared/damage.json projectiles", "",
                            "extract_map.py damage tables (step levels)"))
    # A thrown `bullet` (SW's throwing knives) is a ray for the human too
    # (`hand-fire.js`); a fuse round or a body of any other kind must fly.
    if throws(fa) and not flies(fa) and (is_fuse_round(proj.get("damage"))
                                         or proj.get("kind") != "bullet"):
        out.append(_finding(Finding, "armoury", "thrown-round-not-flown", weapon,
                            f"{tpl}: a thrown round of kind {proj.get('kind')!r}, which "
                            "bot-rounds.js leaves to the referee's ray", "",
                            "bf42/gltf.py projectile kind (step models)"))
    return out


# ---------------------------------------------------------------------------
# 3. nations
# ---------------------------------------------------------------------------

class Pack:
    """The HUD pack as `hud-pack.js` resolves it: a file the mod's
    `pack.json` lists is the mod's, anything else vanilla's."""

    def __init__(self, tree):
        self.vanilla = VIEWER / "maps" / "_shared" / "hud"
        if _vanilla(tree):
            self.mod, self.own = None, set()
        else:
            self.mod = tree.maps / "_shared" / "hud"
            files = (_json(self.mod / "pack.json") or {}).get("files") or []
            self.own = {str(f).lstrip("./") for f in files}

    def path(self, rel: str) -> Path:
        rel = rel.lstrip("./")
        return (self.mod / rel) if self.mod is not None and rel in self.own else self.vanilla / rel

    def json(self, rel: str):
        return _json(self.path(rel))


def run_nations(tree, game, ctx: dict, Finding) -> list:
    out: list = []
    lo = _json(tree.maps / "_shared" / "loadouts.json") or {}
    pack = Pack(tree)
    soldiers = {k.lower(): v for k, v in (pack.json("soldier-icons.json") or {}).items()}
    sprites = {k.lower(): v for k, v in ((pack.json("hud.json") or {}).get("sprites") or {}).items()}
    menu = pack.json("menu/menu-levels.json") or {}
    menu_rows = {str(r.get("dir") or r.get("level") or "").lower(): r
                 for r in (menu.get("levels") or [])}
    levels = {k.lower(): v for k, v in (lo.get("levels") or {}).items()}
    exported = exported_dirs(tree)
    sprite_seen: set = set()
    script = "extract_hud_mods.py / extract_menu_layout.py (step hud)"
    for level in sorted(exported):
        row = levels.get(level) or {}
        mrow = menu_rows.get(level)
        if mrow is None:
            out.append(_finding(Finding, "nations", "menu-level-missing", level,
                                "menu-levels.json has no row", level, script))
        for team, side in (("1", "axis"), ("2", "allied")):
            soldier = (row.get(team) or {}).get("soldier")
            if not soldier:
                continue
            art = soldiers.get(soldier.lower())
            nation = (art or {}).get("nation")
            if not nation:
                out.append(_finding(Finding, "nations", "side-soldier-no-art", soldier,
                                    f"team {team}: soldier-icons.json has no nation for "
                                    "him; every surface falls back to the flag meshes",
                                    level, script))
            if mrow is not None:
                ms = mrow.get(side) or {}
                if ms.get("skin") and ms["skin"].lower() != soldier.lower():
                    out.append(_finding(Finding, "nations", "menu-side-skin-mismatch", side,
                                        f"menu-levels.json {ms.get('skin')}, loadouts.json "
                                        f"{soldier}", level, script))
                if nation and ms.get("nation") != nation:
                    out.append(_finding(Finding, "nations", "menu-side-nation-mismatch", side,
                                        f"menu-levels.json {ms.get('nation')} "
                                        f"({ms.get('nationSource')}), {soldier}'s art {nation}",
                                        level, script))
                flag = ms.get("flag")
                if flag and not pack.path(f"menu/textures/{flag}.png").is_file():
                    out.append(_finding(Finding, "nations", "menu-flag-texture-missing", flag,
                                        f"{side}: menu/textures/{flag}.png resolves nowhere",
                                        level, script))
            if nation:
                for prefix in ("conp_", "flag_ticket_", "icon_flag_"):
                    name = f"{prefix}{nation}".lower()
                    if (name, level) in sprite_seen:
                        continue
                    entry = sprites.get(name)
                    ok = bool(entry) and pack.path(entry.get("file") or f"{name}.png").is_file()
                    if not ok:
                        sprite_seen.add((name, level))
                        out.append(_finding(Finding, "nations", "hud-nation-sprite-missing",
                                            name, f"team {team} ({soldier}): "
                                            + ("not in hud.json" if not entry else
                                               f"{entry.get('file')} resolves nowhere"),
                                            level, script))
    ctx["nations: levels read"] = len(exported)
    return out


# ---------------------------------------------------------------------------
# 4. flag cloth
# ---------------------------------------------------------------------------

def _scene_url(tree, level: str) -> str:
    rel = tree.maps.relative_to(VIEWER).as_posix()
    return f"{LIVE}/{rel}/{level}/scene.glb"


def scene_json(tree, level: str) -> tuple[dict | None, str]:
    """The level bake's glTF JSON: the local `scene.glb`, else (a remote-only
    level) the volume's, read to the end of its JSON chunk and cached by the
    marker's sha256. (doc, where) or (None, why)."""
    local = tree.maps / level / "scene.glb"
    if local.is_file():
        return _glb_json(local), "local"
    marker = _json(tree.maps / level / "scene.remote.json")
    if marker is None:
        return None, "no scene"
    sha = ((marker.get("files") or {}).get("scene.glb") or {}).get("sha256") or "nosha"
    cached = CACHE / "scene-json" / tree.mod_id / f"{level}.{sha[:16]}.json"
    if cached.is_file():
        doc = _json(cached)
        if doc is not None:
            return doc, "remote (cached)"
    url = f"{_scene_url(tree, level)}?cb={sha[:12]}{int(time.time())}"
    try:
        req = urllib.request.Request(url, headers={"Accept-Encoding": "gzip",
                                                   "User-Agent": "bfstats-audit"})
        with urllib.request.urlopen(req, timeout=60) as r:
            gz = r.headers.get("Content-Encoding") == "gzip"
            dec = zlib.decompressobj(16 + zlib.MAX_WBITS) if gz else None
            buf = b""
            need = None
            while True:
                chunk = r.read(1 << 16)
                if not chunk:
                    break
                buf += dec.decompress(chunk) if dec else chunk
                if need is None and len(buf) >= 20:
                    if buf[:4] != b"glTF":
                        return None, "volume copy is not a glb"
                    need = 20 + struct.unpack_from("<I", buf, 12)[0]
                if need is not None and len(buf) >= need:
                    break
        doc = json.loads(buf[20:need])
    except Exception as exc:  # noqa: BLE001 - the network: say so, do not fail
        return None, f"volume unreadable ({exc})"
    cached.parent.mkdir(parents=True, exist_ok=True)
    for old in cached.parent.glob(f"{level}.*.json"):
        old.unlink()
    cached.write_text(json.dumps(doc))
    return doc, "remote"


def cloth_images(doc: dict) -> list[tuple[str, str, str]]:
    """(point, flag mesh, image name) per baked flag cloth."""
    out = []
    for n in doc.get("nodes") or []:
        e = n.get("extras") or {}
        if e.get("kind") != "flagCloth" or n.get("mesh") is None:
            continue
        for prim in doc["meshes"][n["mesh"]].get("primitives") or []:
            mat = (doc.get("materials") or [])[prim.get("material", 0)] if doc.get("materials") else {}
            t = ((mat.get("pbrMetallicRoughness") or {}).get("baseColorTexture") or {}).get("index")
            if t is None:
                continue
            tex = doc["textures"][t]
            src = tex.get("source")
            if src is None:
                src = ((tex.get("extensions") or {}).get("EXT_texture_webp") or {}).get("source")
            if src is None:
                continue
            out.append((e.get("point") or n.get("name") or "?", e.get("mesh") or "?",
                        str(doc["images"][src].get("name") or "")))
            break
    return out


def _strip_ext(p: str) -> str:
    p = p.replace("\\", "/").lower()
    return p.rsplit(".", 1)[0] if "." in p.rsplit("/", 1)[-1] else p


class ImageIndex:
    """Every image entry (lower case, no extension) of every archive the
    level's load mounts: the chain's archives and every level archive of it."""

    def __init__(self, game):
        self.names: set[str] = set()
        if not getattr(game, "ok", False):
            return
        from bf42.rfa import RfaArchive, find_archives_dir  # noqa: PLC0415
        for mod_dir in game.chain:
            ad = find_archives_dir(mod_dir)
            if ad is None:
                continue
            for f in ad.rglob("*"):
                if f.suffix.lower() != ".rfa" or not f.is_file():
                    continue
                try:
                    arc = RfaArchive(f)
                except Exception:  # noqa: BLE001 - a truncated archive
                    continue
                for n in arc.entries:
                    low = n.lower()
                    if low.endswith((".dds", ".tga")):
                        self.names.add(_strip_ext(low))


def run_flagcloth(tree, game, ctx: dict, Finding) -> list:
    out: list = []
    exported = exported_dirs(tree)
    index = None
    read = fetched = alts = 0
    for level in sorted(exported):
        src = level_source(game, level)
        if not src.ok or not src.alt_paths:
            continue
        alts += 1
        doc, where = scene_json(tree, level)
        if doc is None:
            out.append(_finding(Finding, "flagcloth", "flagcloth-scene-unread", level, where,
                                level, "the volume", sev="info"))
            continue
        read += 1
        fetched += where == "remote"
        if index is None:
            index = game.__dict__.get("_sides_images") or ImageIndex(game)
        for point, mesh, image in cloth_images(doc):
            base = _strip_ext(image).rsplit("/", 1)[-1]
            want = next((f"{a.lower()}/{base}" for a in src.alt_paths
                         if f"{a.lower()}/{base}" in index.names), None)
            if want is None:
                continue
            if _strip_ext(image) != want:
                out.append(_finding(
                    Finding, "flagcloth", "flag-cloth-alt-texture-not-baked", point,
                    f"{mesh}: baked {image}, the level's alternativePath draws {want}",
                    level, "extract_map.py / flag cloth texture (step levels)"))
    ctx["flagcloth: levels with alternativePath"] = alts
    ctx["flagcloth: scenes read (fetched)"] = f"{read} ({fetched})"
    return out
