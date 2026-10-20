#!/usr/bin/env python3
"""Play-breaking static audits: what stops a soldier or a crew from playing,
found by parsing the install and the extracted tree, with no browser.

    python3 audit_mod.py --mod <id> --audit kits vehicles [--json out.json]

`audit_mod.py` calls `run_kits()` and `run_vehicles()` here. Each was written
from a defect the owner found by play-testing (features/static-validation-coverage):

kits      every kit an exported level deals, with the copy of it that level
          declares (`levelVariants`, `loadouts.json` `levelKits`):
          * a worn part (helmet, cap, pack) the kit table records with no glb:
            the soldier spawns without his kit's look (FHSWEurope 203_hill-1904's
            Russians, 2026-10-15). `kit-worn-part-not-built` when the part's
            geometry is declared in the chain or the level's own archive;
            `kit-worn-geometry-undeclared` (accepted) when it is declared nowhere.
          * a (soldier, weapon) pair the level hands out with no first-person
            rig: the weapon draws as a bare third-person mesh and cannot be
            used (203_hill's GrenadeRus, a plain cylinder that could not be
            thrown). `kit-weapon-no-rig` when the chain declares the weapon,
            `kit-level-weapon-no-rig` when only the level's own scripts do (the
            203 Hill class: the extractor read the chain and not the level),
            `kit-weapon-template-undefined` (accepted) when no `.con` of the
            chain or the level creates it: the engine hands out nothing either.
          * a rolled item (`Random*`, `setRandomGeometries N`) is never held
            (ledger KIT-1): each variant `<bundle><n>` the kit can roll is
            checked as a weapon (the rig causes above), and with its rig must
            have a third-person pose (`kit-roll-variant-no-pose`). A roll the
            kit table names no template for is `kit-roll-variant-unlisted`
            when the chain or level declares it after all, and
            `kit-roll-variant-undefined` (accepted, KIT-3) when nothing does.
vehicles  every vehicle model glb against its template tree in the chain's
          `.con` files:
          * `vehicle-part-missing`: a part that carries a gun (a FireArms with a
            projectile) or a camera somewhere below it is in neither the model
            glb nor its `.cockpit.glb`. The T-34 and OT-34 drove as bare hulls
            and the IS-2 had no cannon, HUD or camera when a `CreateInvisible`
            turret took its subtree with it (2026-10-14, ledger PHY-24).
          * `vehicle-held-key-axis-missing`: a RotationalBundle bound to a key,
            not `setAutomaticReset`, clamped and position-driven holds the angle
            its key leaves it at (ledger GUN-2: a round selector, a ramp). Its
            node is in the glb without that axis, so the key does nothing. The
            Flak 18/36's APHE/AA selector on al_marj-1942 (W/S, 2026-10-15):
            `browse_rig` stripped held `c_PIThrottle` axes from spring-less
            vehicles. The rule is the engine's, written here from the ledger,
            not imported from the exporter, so a regression in the exporter's
            filter is caught rather than mirrored.

Every finding carries `severity` and `owning_script`; `audit_mod.PLAY_BREAKING`
names the causes that stop play, which the report lists first.
"""

from __future__ import annotations

import collections
import json
import re
from pathlib import Path

# The causes that stop play, with the words a play-tester would use. The
# report and the pipeline's `v_static` list these before anything cosmetic.
PLAY_BREAKS = {
    "kit-worn-part-not-built": "no kit look",
    "level-kit-not-in-kits-json": "no kit look",
    "kit-weapon-no-rig": "cannot use the weapon",
    "kit-level-weapon-no-rig": "cannot use the weapon",
    "kit-roll-variant-unlisted": "no weapon in that slot",
    "vehicle-part-missing": "cannot fire, aim or drive",
    "vehicle-held-key-axis-missing": "cannot toggle",
}

ACCEPTED = {
    "kit-worn-geometry-undeclared":
        "the worn part's geometry is declared by no GeometryTemplate of the chain "
        "or of the level: the engine builds the part with no geometry and draws "
        "nothing there (ledger GEO-1)",
    "kit-weapon-template-undefined":
        "the kit names a weapon no ObjectTemplate.create of the chain or of the "
        "level that hands it out defines: the engine gives the soldier nothing "
        "in that slot (FHSWEurope's Welrod, SandbagDeploy, roks-3)",
    "kit-roll-variant-undefined":
        "a rolled item's `<bundle><n>` is created by no ObjectTemplate of the chain "
        "or the level: `addBundleChilds` logs `template not found` and that spawn "
        "gets nothing in the slot (ledger KIT-3)",
}

# Items that are not weapons a player selects: the engine's `scold*` slot
# fillers. A rolled item (`Random*` + `setRandomGeometries`) is checked as the
# variants it rolls (`_kit_rolls_for`).
_NOT_A_WEAPON = re.compile(r"^scold", re.I)
_GEOM_CREATE = re.compile(r"(?im)^\s*GeometryTemplate\.create\s+\S+\s+(\S+)")
_OBJ_CREATE = re.compile(r"(?im)^\s*ObjectTemplate\.(?:create|activeSafe)\s+\S+\s+(\S+)")


def _exported_levels(tree) -> set[str]:
    """The levels the tree exports: the rows of maps.json (FHSW and FHSWEurope:
    the rows with a `loading` block), lower-cased; `tree.levels` without one."""
    p = tree.maps / "maps.json"
    try:
        rows = json.loads(p.read_text())
    except (OSError, ValueError):
        return {lv.lower() for lv in tree.levels}
    if isinstance(rows, dict):
        rows = rows.get("maps") or rows.get("levels") or []
    if tree.mod_id in ("fhsw", "fhsweurope"):
        rows = [r for r in rows if r.get("loading")]
    names = {(r.get("name") or str(r.get("report", "")).split("/")[0]).lower()
             for r in rows if isinstance(r, dict)}
    # A scoped pass (`audit_mod.py --levels`): only its levels, by name or dir.
    scope = getattr(tree, "scope", None)
    if scope is not None:
        dirs = {(r.get("name") or "").lower(): str(r.get("glb") or r.get("report") or "")
                .split("/")[0].lower() for r in rows if isinstance(r, dict)}
        names = {n for n in names if n in scope or dirs.get(n) in scope}
    return {n for n in names if n}


def _level_scripts(game, level: str) -> dict[str, set[str]]:
    """{'objects': names, 'geometries': names} the level's own archive creates,
    lower-cased; cached on the game object. Empty without the install."""
    cache = game.__dict__.setdefault("_play_level_scripts", {})
    if level in cache:
        return cache[level]
    out = {"objects": set(), "geometries": set()}
    arc = None
    if getattr(game, "ok", False):
        try:
            arc = game.level_archive(level)
        except Exception:  # noqa: BLE001 - a broken archive reads as empty
            arc = None
    if arc is not None:
        for n in (getattr(arc, "entries", None) or arc.names()):
            if not n.lower().endswith((".con", ".inc")):
                continue
            try:
                text = arc.read(n).decode("latin-1")
            except Exception:  # noqa: BLE001
                continue
            out["objects"].update(m.group(1).lower() for m in _OBJ_CREATE.finditer(text))
            out["geometries"].update(m.group(1).lower() for m in _GEOM_CREATE.finditer(text))
    cache[level] = out
    return out


def _chain_has(game, kind: str, name: str) -> bool | None:
    """Whether the chain's library declares `name` (None without the install)."""
    if not getattr(game, "ok", False) or not name:
        return None
    lib = game.library()
    return (lib.object(name) if kind == "object" else lib.geometry(name)) is not None


# ---------------------------------------------------------------------------
# kits
# ---------------------------------------------------------------------------

def _kit_items_for(kit: dict | None, level: str, level_kit: dict | None) -> list[str]:
    """The items a kit puts in a soldier's hands on `level`: the level's own copy
    (loadouts `levelKits`, then kits.json `levelVariants`) over the kit's own."""
    if level_kit and level_kit.get("items") is not None:
        return list(level_kit["items"])
    if not kit:
        return []
    items = [i["template"] for i in kit.get("items") or []]
    for v in kit.get("levelVariants") or []:
        if level in {x.lower() for x in v.get("levels") or []}:
            items = [i["template"] for i in v.get("items") or []]
    return items


def _kit_rolls_for(kit: dict | None, level: str, level_kit: dict | None,
                   lo_kit: dict | None) -> dict[str, list]:
    """Per rolled item (lower case) of a kit on `level`, its variants 1..N,
    None where the kit table found no template: the level's own copy
    (loadouts `levelKits`, then kits.json `levelVariants`) over the kit's own
    (loadouts `kits`, then kits.json `items`)."""
    for row in (level_kit, lo_kit):
        if row and row.get("random") is not None:
            return {r["template"].lower(): list(r.get("variants") or [])
                    for r in row["random"]}
    rolls: dict[str, list] = {}
    if kit:
        rows = list(kit.get("items") or [])
        for v in kit.get("levelVariants") or []:
            if level in {x.lower() for x in v.get("levels") or []} and v.get("items"):
                rows = list(v["items"])
        for item in rows:
            if item.get("variants"):
                rolls[item["template"].lower()] = list(item["variants"])
    return rolls


def _pose_stems(path: Path) -> set[str] | None:
    """The pose stems (lower case) `poses/index.json` lists, None without it."""
    try:
        index = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    stems = ([*index.get("glb", []), *index.get("recipe", [])]
             if isinstance(index, dict) else list(index))
    return {str(stem).lower() for stem in stems}


def _kit_worn_for(kit: dict, level: str) -> list[dict]:
    worn = list(kit.get("worn") or [])
    for v in kit.get("levelVariants") or []:
        if level in {x.lower() for x in v.get("levels") or []} and v.get("worn") is not None:
            worn = list(v["worn"])
    return worn


def kit_findings(tree, game, Finding) -> list:
    out: list = []
    kp = tree.models / "kits.json"
    lp = tree.maps / "_shared" / "loadouts.json"
    ip = tree.models / "viewmodels" / "index.json"
    if not kp.is_file() or not lp.is_file():
        return out
    kits = {k["template"].lower(): k for k in json.loads(kp.read_text()).get("kits", [])}
    lo = json.loads(lp.read_text())
    # Rig files plus the painted `pairs` rows (one rig per weapon, the
    # soldier's textures swapped at load): either way the pair has arms.
    from bf42.glbstore import rig_pair_stems  # noqa: PLC0415
    rigs = ({n.lower() for n in rig_pair_stems(json.loads(ip.read_text()))}
            if ip.is_file() else None)
    # Pairs whose rig the extractor could not build because the ENGINE deletes
    # the weapon's cloned states (no substituted clip in any archive, ANIM-16):
    # the game shows the bare pose, so a missing rig is the mod's data, not a
    # play-breaker. `extract_viewmodel.py` records them beside the index.
    ap = tree.models / "viewmodels" / "absent.json"
    try:
        absent_rigs = {(str(r.get("soldier", "")).lower(), str(r.get("weapon", "")).lower()):
                       str(r.get("reason", "engine-deleted state clones"))
                       for r in json.loads(ap.read_text())}
    except (OSError, ValueError):
        absent_rigs = {}
    poses = _pose_stems(tree.models / "poses" / "index.json")
    lo_kits = {name.lower(): row for name, row in (lo.get("kits") or {}).items()}
    exported = _exported_levels(tree)
    seen_worn: set = set()
    seen_pair: set = set()

    def add(cause, subject, detail, level, script):
        f = Finding("kits", cause, subject, detail, level)
        f.severity = "info" if cause in ACCEPTED else "blocker" if cause in PLAY_BREAKS else "major"
        f.owning_script = script
        if cause in ACCEPTED:
            f.accepted = ACCEPTED[cause]
        out.append(f)

    def weapon(kit_name: str, soldier: str, item: str, level: str) -> bool:
        """Report a held item with no rig, by where it is declared; True when
        the pair has its rig."""
        pair = f"{soldier}__{item}".lower()
        if pair in rigs:
            return True
        if (pair, level) in seen_pair:
            return False
        seen_pair.add((pair, level))
        why = absent_rigs.get((soldier.lower(), item.lower()))
        if why is not None:
            f = Finding("kits", "kit-rig-engine-deleted", kit_name,
                        f"{soldier} + {item}: no rig, and none in retail either ({why})",
                        level)
            f.severity = "info"
            f.owning_script = "the mod's data (extract_viewmodel.py absent.json)"
            f.accepted = why
            out.append(f)
            return False
        scripts = _level_scripts(game, level)
        in_chain = _chain_has(game, "object", item)
        in_level = item.lower() in scripts["objects"]
        if in_chain is False and not in_level:
            cause = "kit-weapon-template-undefined"
        elif in_level and not in_chain:
            cause = "kit-level-weapon-no-rig"
        else:
            cause = "kit-weapon-no-rig"
        add(cause, kit_name, f"{soldier} + {item}: no first-person rig "
            f"({'the level declares it' if in_level else 'the chain declares it' if in_chain else 'declared nowhere' if in_chain is False else 'install absent'})",
            level, "extract_viewmodel.py (step viewmodels)")
        return False

    def undeclared_roll(kit_name: str, bundle: str, n: int, level: str) -> None:
        """A roll the table records with no template: the engine hands out
        nothing that spawn (KIT-3), unless the chain or the level does declare
        `<bundle><n>` and the table missed it."""
        name = f"{bundle}{n}"
        if (name.lower(), level, "roll") in seen_pair:
            return
        seen_pair.add((name.lower(), level, "roll"))
        declared = (_chain_has(game, "object", name)
                    or name.lower() in _level_scripts(game, level)["objects"])
        if declared:
            add("kit-roll-variant-unlisted", kit_name,
                f"{name}: roll {n} of {bundle} is declared, and the kit table names no "
                "template for it", level, "extract_loadouts.py (step loadouts)")
        else:
            add("kit-roll-variant-undefined", kit_name,
                f"{name}: roll {n} of {bundle} is declared by no ObjectTemplate.create "
                "of the chain or the level", level, "extract_loadouts.py (step loadouts)")

    def held(kit_name: str, soldier: str, level: str, level_kits: dict) -> None:
        """Every item `kit_name` puts in a hand on `level`, in `soldier`'s."""
        kit = kits.get(kit_name.lower())
        level_kit = level_kits.get(kit_name)
        rolls = _kit_rolls_for(kit, level, level_kit, lo_kits.get(kit_name.lower()))
        for item in _kit_items_for(kit, level, level_kit):
            if _NOT_A_WEAPON.match(item):
                continue
            roll = rolls.get(item.lower())
            if roll is None:
                weapon(kit_name, soldier, item, level)
                continue
            # A rolled item is never held (KIT-1): each variant 1..N the kit
            # can roll is, and each needs a template, a rig and a pose.
            for n, variant in enumerate(roll, start=1):
                if variant is None:
                    undeclared_roll(kit_name, item, n, level)
                elif weapon(kit_name, soldier, variant, level) and poses is not None:
                    pair = f"{soldier}__{variant}".lower()
                    if pair not in poses and (pair, level, "pose") not in seen_pair:
                        seen_pair.add((pair, level, "pose"))
                        add("kit-roll-variant-no-pose", kit_name,
                            f"{soldier} + {variant}: a roll of {item} with a "
                            "first-person rig and no third-person pose: the bots "
                            "hold the Colt and the chase view the last weapon",
                            level, "extract_pose.py --kit-poses (step poses_kit)")

    for level, teams in sorted((lo.get("levels") or {}).items()):
        if level.lower() not in exported:
            continue
        level_kits = (lo.get("levelKits") or {}).get(level) or {}
        scripts = None
        dealt: list[str] = []
        for team, row in sorted(teams.items()):
            soldier = row.get("soldier") or ""
            for slot, kit_name in sorted((row.get("slots") or {}).items()):
                kit = kits.get(kit_name.lower())
                # a dealt kit with no kits.json row has no worn parts to draw:
                # Road to Rome's and Secret Weapons' inherited vanilla levels,
                # when kits.json was built from the pack's own kits
                # (swrtr-asset-audit #3; the rules gate's kit check)
                if kit is None and (kit_name.lower(), level) not in seen_worn:
                    seen_worn.add((kit_name.lower(), level))
                    add("level-kit-not-in-kits-json", kit_name,
                        f"team {team} slot {slot}: kits.json has no row, so the soldier "
                        "wears nothing of the kit", level, "extract_kits.py --maps (step kits)")
                # worn parts: what the soldier looks like with this kit
                for w in (_kit_worn_for(kit, level) if kit else []):
                    if w.get("glb"):
                        continue
                    key = (kit_name.lower(), (w.get("template") or "").lower(), level)
                    if key in seen_worn:
                        continue
                    seen_worn.add(key)
                    geom = w.get("geometry") or w.get("template") or ""
                    scripts = scripts or _level_scripts(game, level)
                    declared = _chain_has(game, "geometry", geom)
                    if declared is False and geom.lower() not in scripts["geometries"]:
                        cause = "kit-worn-geometry-undeclared"
                    else:
                        cause = "kit-worn-part-not-built"
                    add(cause, kit_name, f"{w.get('template')} ({w.get('slot') or '?'}): "
                        f"geometry {geom} has no glb", level, "extract_kits.py (step kits)")
                if kit_name not in dealt:
                    dealt.append(kit_name)
        # weapons: what each soldier of the level can use. A dropped kit is
        # anyone's (KITDROP-6: no team test on a pickup), so every side's
        # soldier is checked with every kit the level deals or lays on a pad.
        if rigs is None:
            continue
        dealt += [row["template"] for row in kits.values()
                  if level.lower() in {p.lower() for p in row.get("pads") or []}
                  and row["template"] not in dealt]
        for soldier in dict.fromkeys(row.get("soldier") or "" for row in teams.values()):
            for kit_name in dealt:
                held(kit_name, soldier, level, level_kits)
    return out


def run_kits(tree, game, ctx: dict, Finding) -> list:
    rows = kit_findings(tree, game, Finding)
    ctx["kits: levels read"] = len(_exported_levels(tree))
    return rows


# ---------------------------------------------------------------------------
# vehicles
# ---------------------------------------------------------------------------

VEHICLE_CATEGORIES = ("land", "air", "sea", "emplacement")
# Logic and effect templates the model glb does not carry as nodes by design:
# spawners and spawn points are the level's (scene.json), sonar is a table,
# effects are `_shared/effects.glb`.
_NODE_SUFFIX = re.compile(r"_\d+$")
# The physics parts a hull drives, flies and floats on. A KettenKrad whose
# hidden Springs were dropped lay on its back; a Sherman missing a Spring's
# collision listed 13 degrees. (LandingGear is left out: mods build cockpit
# needles out of it.)
DRIVE_KINDS = frozenset({"spring", "engine", "wing", "floatingbundle"})
NOT_A_NODE = frozenset({"spawnpoint", "objectspawner", "sonarobject", "effectbundle",
                        "emitter", "projectile"})


def glb_json(path: Path) -> dict | None:
    import struct  # noqa: PLC0415
    try:
        with open(path, "rb") as fh:
            head = fh.read(20)
            if head[:4] != b"glTF":
                return None
            return json.loads(fh.read(struct.unpack("<I", head[12:16])[0]))
    except (OSError, ValueError):
        return None


def holds_key_axis_gun2(template, spec: dict) -> bool:
    """GUN-2: a RotationalBundle that is not setAutomaticReset, clamped (not
    free) and position-driven keeps the angle its key leaves it at. Mouse-look
    axes are the camera's (`extras.cameraView`), not a lever."""
    return (template.kind.lower() == "rotationalbundle"
            and not template.automatic_reset
            and not spec.get("free")
            and spec.get("driver") != "rate"
            and "mouselook" not in str(spec.get("input", "")).lower())


def vehicle_findings(library, entries: list[dict], models: Path, placed: set[str],
                     Finding) -> list:
    """`library`: a bf42.con ObjectLibrary of the chain. `entries`: models.json
    rows. `placed`: lower-cased templates an exported level places (a finding on
    one of those is a blocker; elsewhere minor)."""
    from bf42 import con as con_mod  # noqa: PLC0415
    out: list = []
    crit_cache: dict[str, bool] = {}

    def critical(name: str, depth: int = 0, stack: frozenset = frozenset()) -> bool:
        key = name.lower()
        if key in crit_cache:
            return crit_cache[key]
        t = library.object(name)
        if t is None or depth > 24 or key in stack:
            return False
        kind = t.kind.lower()
        hit = ((kind == "firearms" and bool(t.projectile_template)) or kind == "camera"
               or kind in DRIVE_KINDS)
        if not hit:
            for ref in t.children:
                child = con_mod.instance_template_name(ref, library.object)
                if child and critical(child, depth + 1, stack | {key}):
                    hit = True
                    break
        crit_cache[key] = hit
        return hit

    for e in entries:
        if e.get("category") not in VEHICLE_CATEGORIES or not e.get("glb"):
            continue
        root = library.object(e["name"])
        path = models / e["glb"]
        if root is None or not path.is_file():
            continue
        doc = glb_json(path)
        if doc is None:
            continue
        # a template placed twice is `<name>` and `<name>_2` (build_node's
        # de-duplication): index both spellings, the exact one first
        nodes: dict[str, dict] = {}
        suffixed: dict[str, dict] = {}
        cockpit = glb_json(path.with_name(path.name[:-4] + ".cockpit.glb")) or {}
        for n in [*doc.get("nodes", []), *cockpit.get("nodes", [])]:
            nm = (n.get("name") or "").lower()
            nodes.setdefault(nm, n)
            suffixed.setdefault(_NODE_SUFFIX.sub("", nm), n)
        for k, n in suffixed.items():
            nodes.setdefault(k, n)
        sev = "blocker" if e["name"].lower() in placed else "minor"
        seen: set[str] = set()

        def walk(name: str, depth: int, parent: str) -> None:
            t = library.object(name)
            if t is None or depth > 24 or t.name.lower() in seen:
                return
            seen.add(t.name.lower())
            kind = t.kind.lower()
            node = nodes.get(t.name.lower())
            if node is None:
                if kind not in NOT_A_NODE and critical(t.name):
                    f = Finding("vehicles", "vehicle-part-missing", e["name"],
                                f"{t.name} ({t.kind}, under {parent}) carries a gun, a "
                                f"camera or a drive part and is in neither {path.name} "
                                f"nor its cockpit glb")
                    f.severity, f.owning_script = sev, "bf42/assemble.py (step models)"
                    out.append(f)
                return
            rig = t.rig() or {}
            have = ((node.get("extras") or {}).get("rig") or {}).get("axes") or {}
            # build_node rigs a node only when it draws or carries something;
            # an empty one has nothing a key could turn
            if "mesh" not in node and not node.get("children"):
                rig = {}
            for axis, spec in (rig.get("axes") or {}).items():
                if axis not in have and holds_key_axis_gun2(t, spec):
                    f = Finding("vehicles", "vehicle-held-key-axis-missing", e["name"],
                                f"{t.name} {axis} on {spec.get('input')}: the .con holds "
                                f"it (not setAutomaticReset, GUN-2); {path.name} has no axis")
                    f.severity, f.owning_script = sev, "bf42/assemble.py browse_rig (patch_held_axes.py)"
                    out.append(f)
            kids = [c for c in (con_mod.instance_template_name(r, library.object)
                                for r in t.children) if c]
            if kind == "lodobject" or "selector" in kind:
                # one alternative is drawn; descend only into the ones exported
                kids = [k for k in kids if k.lower() in nodes]
            for k in kids:
                walk(k, depth + 1, t.name)

        walk(root.name, 0, "root")
    return out


def placed_templates(tree) -> set[str]:
    exported = _exported_levels(tree)
    placed: set[str] = set()
    for lv in tree.levels:
        if lv.lower() not in exported:
            continue
        try:
            sc = json.loads((tree.maps / lv / "scene.json").read_text())
        except (OSError, ValueError):
            continue
        for s in sc.get("objectSpawns", []) or []:
            if s.get("vehicle"):
                placed.add(s["vehicle"].lower())
            placed.update(str(t).lower() for t in (s.get("templates") or {}).values())
        for s in sc.get("vehicleSoldierSpawns", []) or []:
            if s.get("vehicle"):
                placed.add(s["vehicle"].lower())
    return placed


def run_vehicles(tree, game, ctx: dict, Finding) -> list:
    if not getattr(game, "ok", False):
        ctx["vehicles"] = "skipped: no game install"
        return []
    mp = tree.models / "models.json"
    if not mp.is_file():
        return []
    entries = json.loads(mp.read_text())
    placed = placed_templates(tree)
    if getattr(tree, "since", None) is not None:
        # A run-scoped pass: the vehicles its levels place, and any glb it wrote.
        entries = [e for e in entries if str(e.get("name", "")).lower() in placed
                   or (e.get("glb") and tree.touched(tree.models / e["glb"]))]
    rows = vehicle_findings(game.library(), entries, tree.models, placed, Finding)
    import audit_bake  # noqa: PLC0415
    rows += audit_bake.rotor_pair_findings(game.library(), entries, tree.models, placed, Finding)
    ctx["vehicles: glbs read"] = sum(1 for e in entries if e.get("category") in VEHICLE_CATEGORIES)
    return rows


# ---------------------------------------------------------------------------
# words: what the mod declares that the reader drops
# ---------------------------------------------------------------------------

# Template kinds whose words the census reads. A weapon word with no reader
# branch and no verdict is major (the contract of tests/test_weapon_words.py:
# `allowReloadOnEmptyClipOnly` sat unread until a play-test, ledger FA-6); on a
# round or a kit it is minor, listed so a new word is seen the day it ships.
WORD_KINDS = {"firearms": "major", "handfirearms": "major", "projectile": "minor",
              "kit": "minor", "kitpart": "minor", "activekitpart": "minor"}


def word_verdicts() -> tuple[dict[str, str], str]:
    """tests/test_weapon_words.py `UNREAD_WEAPON_WORDS`: each unread weapon
    word and why it is not read. Read from the test, so the two never differ."""
    import importlib.util  # noqa: PLC0415
    path = Path(__file__).resolve().parent / "tests" / "test_weapon_words.py"
    try:
        spec = importlib.util.spec_from_file_location("_weapon_word_verdicts", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return dict(mod.UNREAD_WEAPON_WORDS), str(mod.PLUMBING)
    except Exception:  # noqa: BLE001 - no verdicts: every word reads as new
        return {}, ""


def word_findings(census, verdicts: dict[str, str], plumbing: str, kind_of: dict[str, str],
                  Finding) -> list:
    """One finding per unread word. `census`: a census_weapon_words.WordCensus
    run over the chain; `kind_of`: word -> the strictest kind it was met on."""
    out = []
    for word, count in sorted(census.unread.items(), key=lambda kv: (-kv[1], kv[0])):
        verdict = verdicts.get(word)
        ex = ", ".join(census.examples[word][:3])
        if verdict == plumbing and plumbing:
            cause, sev = "word-declared-plumbing", "info"
        elif verdict:
            cause, sev = "word-declared-not-read-known", "minor"
        else:
            cause, sev = "word-declared-not-read", WORD_KINDS.get(kind_of.get(word, ""), "minor")
        f = Finding("words", cause, word, f"{count} templates ({ex})"
                    + (f"; verdict: {verdict[:80]}" if verdict else ""))
        f.severity, f.owning_script = sev, "bf42/con.py ObjectLibrary.add_con"
        if cause == "word-declared-plumbing":
            f.accepted = verdict
        out.append(f)
    return out


def run_words(tree, game, ctx: dict, Finding) -> list:
    if not getattr(game, "ok", False):
        ctx["words"] = "skipped: no game install"
        return []
    import census_weapon_words as cw  # noqa: PLC0415
    from extract_models import build_library  # noqa: PLC0415

    class KindCensus(cw.WordCensus):
        """Also records the kind each unread word was met on."""

        def __init__(self):
            super().__init__(tuple(WORD_KINDS))
            self.kind_of: dict[str, str] = {}

        def add_con(self, path, text):
            before = set(self.unread)
            kinds = {}
            current = None
            for line in cw.con_mod.strip_comments(text).splitlines():
                m = cw.con_mod._COMMAND.match(line.strip())
                if not m or m.group(1).lower() != "objecttemplate":
                    continue
                word = cw.con_mod.console_word("objecttemplate", m.group(2).lower())
                parts = (m.group(3) or "").split()
                if word == "create":
                    current = parts[0].lower() if parts else None
                elif current in WORD_KINDS:
                    if WORD_KINDS[current] == "major" or word not in kinds:
                        kinds[word] = current
            super().add_con(path, text)
            for w in set(self.unread) - before | (set(kinds) & set(self.unread)):
                k = kinds.get(w)
                if k and (w not in self.kind_of or WORD_KINDS[k] == "major"):
                    self.kind_of[w] = k

    census = build_library(game.objects, KindCensus())
    verdicts, plumbing = word_verdicts()
    ctx["words: unread"] = len(census.unread)
    return word_findings(census, verdicts, plumbing, census.kind_of, Finding)


def severity_counts(findings) -> dict:
    return dict(collections.Counter(getattr(f, "severity", "") or "major" for f in findings))
