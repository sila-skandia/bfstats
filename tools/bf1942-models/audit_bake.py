#!/usr/bin/env python3
"""Bake-time checks promoted from censuses, corpus probes and real-tree tests,
and the class-b checks of features/static-validation-coverage, as `audit_mod.py`
sub-audits and causes. File parsing only: the tree's glb JSON chunks and
manifests, the install's archives. `mod_pipeline.py`'s `v_static` runs them.

    python3 audit_mod.py --mod <id> --audit hud poses levels sound vehicles

hud     * `vehicle-icon-not-extracted`: a vehicle's HUD picture
          (`extras.hud` vehicleIcon / primaryAmmoIcon / secondaryAmmoIcon, in
          a model glb or a baked scene) that the tree's HUD pack does not hold
          while a menu or level archive of the chain does: the HUD draws the
          flak gun instead (`census_vehicle_icons.py`, VHUD-13).
        * `hud-image-upside-down`, `loading-image-upside-down`: an exported
          HUD sprite or loading picture whose rows run against the engine's
          order for its source TGA (an RLE file is read as stored,
          `bf42/meshtga.py`). Decoded here with PIL and the rule, not with
          the extractors' own decoders.
poses   * `gait-clip-missing`: the shared leg bundle lacks a gait's lower-body
          clip, and soldiers slide (the corpus probe `gait_clips`).
        * `kit-weapon-no-pose`: a (soldier, weapon) pair an exported level's
          kits hand out, with a first-person rig and no third-person pose in
          the tree or in vanilla's (`tests/test_kit_poses_on_disk.py`): the
          bots hold the Colt.
levels  * `lightmapped-part-ships-rungs`: a lightmapped part ships LOD rungs
          the viewer does not hide (the corpus probe `lightmapped_rungs`,
          ledger LOD-6).
        * `mode-template-edit-not-baked`: the default layer's game type
          reopens a template (`ObjectTemplate.active`) and adds a child the
          level's scene.glb does not carry under it (Monster des Stahles'
          depots, LOAD-9).
sound   (`audit_mod.audit_sound` calls these)
        * every vehicle FireArms classed by where its sound comes from
          (`census_vehicle_weapon_sounds.classify`) against the tree's table:
          `weapon-loop-on-launcher`, `weapon-round-report-not-in-table`,
          `weapon-carries-round-flight-sound`, `weapon-sample-dropped`.
        * `round-flight-sound-not-in-manifest`: a round with a script of its
          own or on a child Engine that `effects.sounds.json` neither binds
          nor records as silent.
        * `held-hull-engine-not-in-table`: a hull a spawner holds in a baked
          glb (`extras.heldSpawner`) whose Engine binds a usable script, with
          no engine layers in the table (Wake's Daihatsus, Tarawa's planes).
        * `level-sound-template-not-baked`: a template a level's `Sounds/*.con`
          declares and its scripts place, missing from `sounds.areas`.
vehicles (`audit_play.run_vehicles` calls this)
        * `rotor-blur-pair-missing`: a LodObject the `.con` makes a blade/blur
          pair (`con.propeller_blur_halves`) drawn without its
          `extras.propellerBlur` or one of its halves: the rotor never turns
          into the disc (DC's MH-53).
"""

from __future__ import annotations

import collections
import io
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE / "viewer"

ACCEPTED = {
    "vehicle-icon-absent-from-install":
        "the picture is in no menu or level archive of the chain: the engine "
        "draws nothing there either",
    "kit-weapon-no-pose-in-game":
        "the game gives the pair no third-person stand pose (tests/"
        "test_kit_poses_on_disk.py NO_POSE, with the reason)",
    "level-sound-template-script-silent":
        "the template's sound script parses to no sample, or to samples no "
        "archive holds (a commented-out patch, `Crickets_env_03.wav` shipped "
        "nowhere): retail plays nothing there either",
}

_SUFFIX = re.compile(r"_\d+$")


def glb_json(path: Path) -> dict | None:
    from audit_play import glb_json as read  # noqa: PLC0415
    return read(path)


def exported_scene_docs(tree):
    """`(level dir, scene.glb JSON)` for each exported level, lazily."""
    from audit_play import _exported_levels  # noqa: PLC0415
    exported = _exported_levels(tree)
    for lv in tree.levels:
        if lv.lower() not in exported:
            continue
        doc = glb_json(tree.maps / lv / "scene.glb")
        if doc is not None:
            yield lv, doc


def _new(Finding, audit, cause, subject, detail, level="", severity="major", script=""):
    f = Finding(audit, cause, subject, detail, level)
    f.severity = "info" if cause in ACCEPTED else severity
    f.owning_script = script
    if cause in ACCEPTED:
        f.accepted = ACCEPTED[cause]
    return f


# ---------------------------------------------------------------------------
# hud: vehicle icons
# ---------------------------------------------------------------------------

def icon_findings(rows: list[dict], Finding) -> list:
    """`census_vehicle_icons` rows (annotated by `locate` where the install
    is present) as findings, one per (template, field, picture)."""
    out, seen = [], set()
    for r in rows:
        if r["status"] in ("ok", "level-overlay"):
            continue
        key = (r["template"].lower(), r["field"], r["name"].lower())
        if key in seen:
            continue
        seen.add(key)
        where = r.get("where")
        if r["status"] == "missing-file":
            cause = "vehicle-icon-file-missing"
        elif where == "nowhere":
            cause = "vehicle-icon-absent-from-install"
        elif where:
            cause = "vehicle-icon-not-extracted"
        else:
            cause = "vehicle-icon-unresolved"
        lv = (r.get("levels") or [""])[0]
        out.append(_new(Finding, "hud", cause, r["template"],
                        f"{r['field']} {r['name']}: the HUD draws the default icon"
                        + (f" (the picture is in {where})" if where and where != "nowhere" else ""),
                        lv, "major", "extract_hud_mods.py / extract_hud_pack.py (step hud)"))
    return out


def run_icons(tree, game, ctx: dict, Finding) -> list:
    import census_vehicle_icons as ci  # noqa: PLC0415
    from audit_play import _exported_levels  # noqa: PLC0415
    rows = ci.census(VIEWER, scenes=True, trees=[ci.tree_spec(tree.mod_id)],
                     levels=_exported_levels(tree))
    if getattr(game, "ok", False) and ci.misses(rows):
        try:
            ci.locate(rows, game.game_dir, {tree.mod_id: game.mod})
        except Exception as exc:  # noqa: BLE001 - unlocated misses stay major
            ctx["hud: icons not located"] = str(exc)[:120]
    ctx["hud: vehicle pictures read"] = len(rows)
    return icon_findings(rows, Finding)


# ---------------------------------------------------------------------------
# hud: TGA orientation
# ---------------------------------------------------------------------------

def engine_tga_image(raw: bytes):
    """A TGA as the engine draws it, top row first: PIL honours the origin
    bit, and an RLE file is then put back in file order (bf42/meshtga.py)."""
    from PIL import Image, ImageOps  # noqa: PLC0415
    from bf42.meshtga import mesh_tga_rows_as_stored  # noqa: PLC0415
    im = Image.open(io.BytesIO(raw))
    im.load()
    im = im.convert("RGBA")
    return ImageOps.flip(im) if mesh_tga_rows_as_stored(raw) else im


def _flat(im, size=(48, 48)):
    from PIL import Image  # noqa: PLC0415
    im = im.convert("RGBA")
    black = Image.new("RGBA", im.size, (0, 0, 0, 255))
    return Image.alpha_composite(black, im).convert("RGB").resize(size, Image.BILINEAR)


def _diff(a, b) -> float:
    from PIL import ImageChops, ImageStat  # noqa: PLC0415
    return sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 3


def orientation(exported, expected) -> str:
    """'ok', 'flipped' or 'unknown' (sizes differ, or the picture reads the
    same both ways up)."""
    from PIL import ImageOps  # noqa: PLC0415
    if exported.size != expected.size:
        return "unknown"
    want, got = _flat(expected), _flat(exported)
    upside = _flat(ImageOps.flip(expected))
    if _diff(want, upside) < 4:
        return "unknown"
    d_ok, d_flip = _diff(got, want), _diff(got, upside)
    if d_flip + 2 < d_ok and d_flip < 0.5 * d_ok:
        return "flipped"
    return "ok"


def _is_tga(raw: bytes) -> bool:
    return len(raw) > 18 and not raw.startswith(b"DDS ") and raw[2] in (1, 2, 3, 9, 10, 11)


def _menu_entries(game) -> dict:
    """Lower-cased entry -> (archive, entry) over the chain's menu archives,
    nearest mod first."""
    from bf42.rfa import RfaArchive, find_archives_dir  # noqa: PLC0415
    out: dict = {}
    for mod_dir in game.chain:
        ad = find_archives_dir(mod_dir)
        if ad is None:
            continue
        for f in sorted(ad.iterdir()):
            if f.suffix.lower() != ".rfa" or not f.name.lower().startswith("menu"):
                continue
            try:
                arc = RfaArchive(f)
            except Exception:  # noqa: BLE001
                continue
            for n in (getattr(arc, "entries", None) or arc.names()):
                out.setdefault(n.lower().replace("\\", "/"), (arc, n))
    return out


def hud_orientation_findings(tree, game, ctx: dict, Finding) -> list:
    from PIL import Image  # noqa: PLC0415
    hud = tree.maps / "_shared" / "hud"
    vanilla = VIEWER / "maps" / "_shared" / "hud"
    own: set[str] | None = None
    if tree.mod_id != "bf1942":
        try:
            own = set(json.loads((hud / "pack.json").read_text()).get("files", []))
        except (OSError, ValueError):
            return []
    where = hud if (own is None or "hud.json" in own) else vanilla
    try:
        sprites = json.loads((where / "hud.json").read_text()).get("sprites", {})
    except (OSError, ValueError):
        return []
    entries = _menu_entries(game)
    out, checked, unknown = [], 0, 0
    done: set[str] = set()
    for key, sp in sorted(sprites.items()):
        src, file = str(sp.get("source") or ""), sp.get("file")
        if not file or not src.lower().endswith(".tga") or file in done:
            continue
        if own is not None and file not in own:
            continue      # vanilla's file: vanilla's audit checks it
        done.add(file)
        hit = entries.get(src.lower().replace("\\", "/"))
        png = hud / file
        if hit is None or not png.is_file():
            continue
        raw = hit[0].read(hit[1])
        if not _is_tga(raw):
            continue
        try:
            state = orientation(Image.open(png), engine_tga_image(raw))
        except Exception:  # noqa: BLE001 - an image PIL cannot read is not this check's
            continue
        checked += 1
        unknown += state == "unknown"
        if state == "flipped":
            out.append(_new(Finding, "hud", "hud-image-upside-down", file,
                            f"{src} (TGA type {raw[2]}, origin bit {'top' if raw[17] & 0x20 else 'bottom'}"
                            "-left) is drawn the other way up from the engine's row order",
                            "", "major", "extract_hud_pack.decode_tga (step hud)"))
    ctx["hud: TGA sprites checked"] = f"{checked} ({unknown} symmetric or resized)"
    return out


def loading_orientation_findings(tree, game, ctx: dict, Finding) -> list:
    from PIL import Image  # noqa: PLC0415
    from audit_play import _exported_levels  # noqa: PLC0415
    import extract_loading_assets as ela  # noqa: PLC0415
    try:
        rows = json.loads((tree.maps / "maps.json").read_text())
    except (OSError, ValueError):
        return []
    if isinstance(rows, dict):
        rows = rows.get("maps") or []
    exported = _exported_levels(tree)
    ex = ela.LoadingAssetExtractor(game.game_dir, Path("/nonexistent"), mods=[tree.mod_id],
                                   dry_run=True)
    mod_dirs = ex.search_path(game.mod)
    out, checked, done = [], 0, set()
    for r in rows:
        bg = (r.get("loading") or {}).get("background")
        name = r.get("name") or ""
        if not bg or name.lower() not in exported or bg in done:
            continue
        done.add(bg)
        try:
            ref, got = ex.resolve_level_background(name, game.mod, mod_dirs)
        except Exception:  # noqa: BLE001
            continue
        if got is None or ref != bg or not _is_tga(got[0]):
            continue
        webp = tree.maps / bg
        if not webp.is_file():
            continue
        try:
            state = orientation(Image.open(webp), engine_tga_image(got[0]))
        except Exception:  # noqa: BLE001
            continue
        checked += 1
        if state == "flipped":
            out.append(_new(Finding, "hud", "loading-image-upside-down", bg,
                            f"the source TGA (type {got[0][2]}) is drawn the other way up "
                            "from the engine's row order", name.lower(), "major",
                            "extract_loading_assets.convert_background_to_webp (step loading)"))
    ex_close = getattr(ex, "_readers", {})
    for reader in ex_close.values():
        try:
            reader.close()
        except Exception:  # noqa: BLE001
            pass
    ctx["hud: TGA loading pictures checked"] = checked
    return out


def run_hud(tree, game, ctx: dict, Finding) -> list:
    out = run_icons(tree, game, ctx, Finding)
    if not getattr(game, "ok", False):
        ctx["hud: orientation"] = "skipped: no game install"
        return out
    out += hud_orientation_findings(tree, game, ctx, Finding)
    out += loading_orientation_findings(tree, game, ctx, Finding)
    return out


# ---------------------------------------------------------------------------
# poses
# ---------------------------------------------------------------------------

# The lower-body clips a soldier needs to walk, run, crouch and crawl
# (`extract_pose.py` `lower_state_of`; FHSW's soldiers slid without them).
GAIT_CLIPS = ("run", "walk", "crouchwalk", "crawl", "stand", "crouch", "lie")


def gait_clips_missing(models: Path) -> list[str] | None:
    """The gait clips the tree's shared leg bundle lacks; None when the tree
    ships no bundle (the viewer then uses vanilla's)."""
    p = models / "poses" / "gaits" / "lower.gait.glb"
    if not p.is_file():
        return None
    doc = glb_json(p)
    if doc is None:
        return [f"{k}.lower" for k in GAIT_CLIPS]
    have = {a.get("name") for a in doc.get("animations", [])}
    return [f"{k}.lower" for k in GAIT_CLIPS if f"{k}.lower" not in have]


def pose_stems(models: Path) -> set[str]:
    try:
        index = json.loads((models / "poses" / "index.json").read_text())
    except (OSError, ValueError):
        return set()
    stems = [*index.get("glb", []), *index.get("recipe", [])] if isinstance(index, dict) else list(index)
    return {s.lower() for s in stems}


def pose_findings(tree, Finding, no_pose: dict[str, str]) -> list:
    """Every pair an exported level's kits hand out that has a first-person
    rig and resolves to no pose, in this tree or vanilla's (`poseBases`)."""
    from audit_play import _exported_levels  # noqa: PLC0415
    from extract_pose import kit_pair_levels  # noqa: PLC0415
    kp, ip = tree.models / "kits.json", tree.models / "viewmodels" / "index.json"
    # a tree with no pose index at all is checked too: its soldiers are
    # figureless wherever vanilla's tree does not hold the pair
    if not kp.is_file() or not ip.is_file():
        return []
    rigs = {s.lower() for s in json.loads(ip.read_text())}
    poses = pose_stems(tree.models) | pose_stems(VIEWER / "models")
    accepted = {k.lower(): v for k, v in no_pose.items()}
    out = []
    for (soldier, weapon), levels in kit_pair_levels(json.loads(kp.read_text()),
                                                     _exported_levels(tree)).items():
        stem = f"{soldier}__{weapon}"
        if stem.lower() not in rigs or stem.lower() in poses:
            continue
        lv = sorted(levels)
        why = accepted.get(stem.lower())
        f = _new(Finding, "poses", "kit-weapon-no-pose-in-game" if why else "kit-weapon-no-pose",
                 stem, f"no poses/{stem}.pose.glb or recipe in this tree or vanilla's; "
                 f"{len(lv)} levels" + (f"; {why[:80]}" if why else ""),
                 lv[0] if lv else "", "major", "extract_pose.py --kit-poses (step poses_kit)")
        if why:
            f.accepted = why
        out.append(f)
    return out


def run_poses(tree, game, ctx: dict, Finding) -> list:
    out = []
    missing = gait_clips_missing(tree.models)
    if missing is None:
        ctx["poses: gait bundle"] = "none in this tree (vanilla's is used)"
    for clip in missing or []:
        out.append(_new(Finding, "poses", "gait-clip-missing", "poses/gaits/lower.gait.glb",
                        f"no {clip} clip: soldiers slide instead of moving their legs",
                        "", "major", "extract_pose.py (step poses_shared)"))
    try:
        from tests.test_kit_poses_on_disk import NO_POSE  # noqa: PLC0415
        no_pose = NO_POSE.get(tree.mod_id, {})
    except Exception:  # noqa: BLE001
        no_pose = {}
    rows = pose_findings(tree, Finding, no_pose)
    ctx["poses: dealt pairs with no pose"] = len(rows)
    return out + rows


# ---------------------------------------------------------------------------
# levels
# ---------------------------------------------------------------------------

def viewer_hides_lightmap_rungs(viewer: Path = VIEWER) -> bool:
    """`level-statics.js` keeps LOD 0 alone for a lightmapped part (LOD-6)."""
    try:
        return "obj.userData?.lightmap" in (viewer / "level-statics.js").read_text()
    except OSError:
        return False


def lightmapped_rungs(doc: dict) -> int:
    """How many lightmapped parts of a scene carry a LOD rung above 0."""
    nodes = doc.get("nodes", [])
    return sum(1 for n in nodes if (n.get("extras") or {}).get("lightmap") and any(
        ((nodes[c].get("extras") or {}).get("lod") or {}).get("level", 0) > 0
        for c in n.get("children", [])))


_ACTIVE = re.compile(r"^\s*ObjectTemplate\.(active|activeSafe|create)\s+(\S+)(?:\s+(\S+))?", re.I)
_ADD = re.compile(r"^\s*ObjectTemplate\.addTemplate\s+(\S+)", re.I)


def active_additions(blocks: list[tuple[str, str]]) -> dict[str, set[str]]:
    """{reopened template: children its `active` block adds}, lower-cased,
    from `bf42.level.mode_template_edits`' blocks."""
    out: dict[str, set[str]] = collections.defaultdict(set)
    for _path, text in blocks:
        current = None
        for line in text.splitlines():
            m = _ACTIVE.match(line)
            if m:
                current = m.group(2).lower() if m.group(1).lower() != "create" else None
                continue
            a = _ADD.match(line)
            if a and current:
                out[current].add(a.group(1).lower())
    return dict(out)


LOGIC_KINDS = frozenset({"spawnpoint", "soldierspawn", "controlpoint", "sonarobject",
                         "effectbundle", "emitter", "projectile", "objectspawner"})


def expected_node(library, name: str) -> str | None:
    """The node an added child leaves in a baked glb, lower-cased, or None
    when it leaves none: a spawn point or other logic template, a part with
    nothing drawable below it, a spawner that holds nothing. A spawner that
    holds its object is drawn as that object (`extras.heldSpawner`). A name
    the chain does not declare (a level's own, Monster des Stahles' depots)
    is looked for as it is."""
    if library is None:
        return name.lower()
    t = library.object(name)
    if t is None:
        return name.lower()
    kind = t.kind.lower()
    if kind == "objectspawner":
        held = t.spawn_vehicle_name() if getattr(t, "spawner_hold_object", False) else None
        return held.lower() if held else None
    if kind in LOGIC_KINDS or not _draws(library, t.name):
        return None
    return t.name.lower()


def missing_additions(doc: dict, adds: dict[str, set[str]],
                      library=None) -> list[tuple[str, str, int, int]]:
    """`(template, child, nodes lacking it, nodes of the template)` for each
    reopened template the scene places whose added child is not under it."""
    nodes = doc.get("nodes", [])
    by: dict[str, list[int]] = collections.defaultdict(list)
    for i, n in enumerate(nodes):
        by[_SUFFIX.sub("", (n.get("name") or "").lower())].append(i)
    out = []
    for tmpl, kids in sorted(adds.items()):
        hosts = by.get(tmpl) or []
        if not hosts:
            continue
        for added in sorted(kids):
            kid = expected_node(library, added)
            if kid is None:
                continue
            lacking = 0
            for h in hosts:
                seen, stack, found = set(), list(nodes[h].get("children", [])), False
                while stack and not found:
                    c = stack.pop()
                    if c in seen:
                        continue
                    seen.add(c)
                    if _SUFFIX.sub("", (nodes[c].get("name") or "").lower()) == kid:
                        found = True
                    stack.extend(nodes[c].get("children", []))
                lacking += not found
            if lacking:
                out.append((tmpl, added, lacking, len(hosts)))
    return out


class LayeredLibrary:
    """A level's own templates ahead of the chain's (`extract_map.LevelFirst`,
    LOAD-2), for `object` and `geometry` lookups."""

    def __init__(self, level, chain):
        self.level, self.chain = level, chain

    def object(self, name):
        return self.level.object(name) or (self.chain.object(name) if self.chain else None)

    def geometry(self, name):
        return self.level.geometry(name) or (self.chain.geometry(name) if self.chain else None)


def mode_edit_blocks(game, level: str, mode: str | None, chain_library=None):
    """`(the default layer's reopened-template blocks, a library of the
    level's own templates over the chain's)`, read from the install."""
    from bf42.con import ObjectLibrary  # noqa: PLC0415
    from bf42.level import (find_level_archives, load_level_files,  # noqa: PLC0415
                            mode_template_edits)
    paths = find_level_archives(game.game_dir, game.chain[0].name, level, chain=game.chain)
    if not paths or not mode:
        return [], chain_library
    files = load_level_files(paths, level)
    blocks = mode_template_edits(files, mode)
    if not blocks:
        return [], chain_library
    own = ObjectLibrary()
    for arc in files.archives:
        for n in arc.entries:
            if n.lower().endswith((".con", ".inc")):
                try:
                    own.add_con(n, arc.read(n).decode("latin-1", "replace"))
                except Exception:  # noqa: BLE001 - one unreadable script
                    continue
    return blocks, LayeredLibrary(own, chain_library)


def run_levels(tree, game, ctx: dict, Finding) -> list:
    out = []
    hidden = viewer_hides_lightmap_rungs()
    ok = getattr(game, "ok", False)
    rung_total = edits = 0
    names = {}
    library = game.library() if ok else None
    try:
        rows = json.loads((tree.maps / "maps.json").read_text())
        rows = rows.get("maps", []) if isinstance(rows, dict) else rows
        names = {str(r.get("name") or "").lower(): r.get("name") for r in rows if isinstance(r, dict)}
    except (OSError, ValueError):
        pass
    for lv, doc in exported_scene_docs(tree):
        n = lightmapped_rungs(doc)
        rung_total += n
        if n and not hidden:
            out.append(_new(Finding, "levels", "lightmapped-part-ships-rungs", f"{lv}/scene.glb",
                            f"{n} lightmapped parts carry LOD rungs the client never builds "
                            "(LOD-6); they streak at distance", lv, "major",
                            "bf42/assemble.py (step levels) or viewer/level-statics.js"))
        if not ok:
            continue
        try:
            sc = json.loads((tree.maps / lv / "scene.json").read_text())
            blocks, lib = mode_edit_blocks(game, names.get(lv.lower()) or lv,
                                           sc.get("gameplayMode"), library)
        except Exception as exc:  # noqa: BLE001 - one broken level never stops the audit
            ctx.setdefault("levels: unreadable", []).append(f"{lv}: {str(exc)[:60]}")
            continue
        adds = active_additions(blocks)
        edits += bool(adds)
        for tmpl, kid, lacking, total in missing_additions(doc, adds, lib):
            out.append(_new(Finding, "levels", "mode-template-edit-not-baked", tmpl,
                            f"{sc.get('gameplayMode')}'s script reopens {tmpl} and adds {kid}; "
                            f"{lacking} of {total} placed {tmpl} carry no {kid} in scene.glb",
                            lv, "major", "scene_layers.py LevelContext.library (step levels: re-bake)"))
    ctx["levels: lightmapped parts with rungs"] = f"{rung_total} ({'hidden by the viewer' if hidden else 'drawn'})"
    if ok:
        ctx["levels: levels whose mode script reopens templates with children"] = edits
    return out


# ---------------------------------------------------------------------------
# vehicles: rotor blur pairs
# ---------------------------------------------------------------------------

def _draws(library, name: str, depth: int = 0) -> bool:
    """Whether a template, or a part below it, has a geometry the chain
    declares (a SupplyDepot counts: the bake keeps it as a node)."""
    from bf42 import con as con_mod  # noqa: PLC0415
    t = library.object(name)
    if t is None or depth > 12:
        return False
    if t.kind.lower() == "supplydepot":
        return True
    if t.geometry and library.geometry(con_mod.split_geometry_qualifier(t.geometry)[1]):
        return True
    return any(_draws(library, ref.template, depth + 1) for ref in t.children)


def rotor_pair_findings(library, entries: list[dict], models: Path, placed: set[str],
                        Finding) -> list:
    """Each LodObject node of a vehicle glb that the `.con` makes a blade/blur
    pair must carry `extras.propellerBlur` and both halves."""
    from bf42 import con as con_mod  # noqa: PLC0415
    out = []
    for e in entries:
        if e.get("category") not in ("land", "air", "sea", "emplacement") or not e.get("glb"):
            continue
        doc = glb_json(models / e["glb"])
        if doc is None:
            continue
        names = {_SUFFIX.sub("", (n.get("name") or "").lower()) for n in doc.get("nodes", [])}
        names |= {(n.get("name") or "").lower() for n in doc.get("nodes", [])}
        seen = set()
        for n in doc.get("nodes", []):
            name = n.get("name") or ""
            t = library.object(name) or library.object(_SUFFIX.sub("", name))
            if t is None or not t.is_lod_selector or t.name.lower() in seen:
                continue
            halves = con_mod.propeller_blur_halves(t.children, library.selector(t.lod_selector))
            if halves is None:
                continue
            seen.add(t.name.lower())
            # a half with no geometry the chain declares draws nothing in the
            # engine either (the jets' fake propellers, ledger GEO-1)
            lost = [h.template for h in halves if h.template.lower() not in names
                    and _draws(library, h.template)]
            if len(lost) == 2 or not any(_draws(library, h.template) for h in halves):
                continue
            stamped = "propellerBlur" in (n.get("extras") or {})
            if lost or not stamped:
                out.append(_new(Finding, "vehicles", "rotor-blur-pair-missing", e["name"],
                                f"{t.name}: " + (f"{', '.join(lost)} not in {e['glb']}" if lost
                                                 else "no extras.propellerBlur")
                                + "; the blades never give way to the blurred disc",
                                "", "major", "bf42/assemble.py _propeller_blur (step models)"))
    return out


# ---------------------------------------------------------------------------
# sound
# ---------------------------------------------------------------------------

class CachedPool:
    """An ArchivePool whose `find` and `read` remember their answers: the
    census's classifier reads a template's declaring `.con` once a weapon."""

    def __init__(self, pool):
        self._pool, self._found, self._read = pool, {}, {}

    def find(self, path):
        if path not in self._found:
            self._found[path] = self._pool.find(path)
        return self._found[path]

    def read(self, path):
        if path not in self._read:
            self._read[path] = self._pool.read(path)
        return self._read[path]

    def __getattr__(self, name):
        return getattr(self._pool, name)


class _MemoParse:
    """`extract_map.parse_sound_scripts` remembered by text for one audit."""

    def __enter__(self):
        import extract_map as em  # noqa: PLC0415
        self.em, self.orig, memo = em, em.parse_sound_scripts, {}

        def parse(text):
            if text not in memo:
                memo[text] = self.orig(text)
            return memo[text]
        em.parse_sound_scripts = parse
        return self

    def __exit__(self, *exc):
        self.em.parse_sound_scripts = self.orig


def weapon_sound_findings(library, objects, sounds, templates, coverage: dict,
                          handweapons: set[str], Finding) -> list:
    """Every FireArms under `templates`, classed by where its sound comes from
    (`census_vehicle_weapon_sounds.classify`), against the tree's table
    (`coverage`: template lower -> entry, levels' records merged)."""
    import census_vehicle_weapon_sounds as cv  # noqa: PLC0415
    import extract_map as em  # noqa: PLC0415
    pool = CachedPool(objects)
    out, cache, seen, found = [], {}, set(), {}

    def resolves(ref: str) -> bool:
        if ref not in found:
            found[ref] = em.resolve_sound(ref, None, sounds) is not None
        return found[ref]
    script = "extract_vehicle_sounds.py (step levels)"
    with _MemoParse():
        for name in templates:
            entry_of = {w["fireArms"].lower(): w for w in
                        (coverage.get(name.lower()) or {}).get("weapons") or []}
            for node in cv.fire_arms_nodes(library, name):
                k = node.name.lower()
                if (name.lower(), k) in seen or k in handweapons:
                    continue
                seen.add((name.lower(), k))
                if k not in cache:
                    try:
                        cache[k] = cv.classify(library, pool, node)
                    except Exception:  # noqa: BLE001 - one unparsable script
                        cache[k] = (cv.SILENT, None, None, [])
                kind, ssc, rnd, chosen = cache[k]
                if kind == cv.ROUND_SHOT:
                    # a round's layer gated past the range its ramp closes at
                    # is never heard at the gun (a bullet's fly-by,
                    # `extract_map._heard_at_launcher`, SND-25/33)
                    chosen = [s for s in chosen
                              if em._heard_at_launcher(s, getattr(node, "velocity", None))]
                    if not chosen:
                        continue
                entry = entry_of.get(k)
                layers = [(ly.get("file"), bool(ly.get("loop"))) for ly in (entry or {}).get("layers") or []]
                where = f"{node.name} ({kind}{', round ' + rnd if rnd else ''})"
                if kind in (cv.ROUND_SHOT, cv.ROUND_FLIGHT) and any(loop for _f, loop in layers):
                    out.append(_new(Finding, "sound", "weapon-loop-on-launcher", name,
                                    f"{where}: a looping layer at the launcher; the loop is the "
                                    "round's flight (the Flettner's rocket motor)", "", "major", script))
                if kind == cv.ROUND_SHOT and entry is None:
                    out.append(_new(Finding, "sound", "weapon-round-report-not-in-table", name,
                                    f"{where}: the round's one-shot is the weapon's report, and "
                                    "the table has no entry: the gun fires silent", "", "major", script))
                elif kind == cv.ROUND_FLIGHT and entry is not None and not any(
                        loop for _f, loop in layers):
                    out.append(_new(Finding, "sound", "weapon-carries-round-flight-sound", name,
                                    f"{where}: the launcher is mute in the game and the table "
                                    "gives it the round's sound", "", "minor", script))
                elif kind in (cv.OWN, cv.ROUND_SHOT) and entry is not None:
                    wanted = [s for s in chosen
                              if not s.file.replace("\\", "/").lower().endswith("silence.wav")
                              and resolves(s.file)]
                    if len(layers) < len(wanted):
                        out.append(_new(Finding, "sound", "weapon-sample-dropped", name,
                                        f"{where}: {len(wanted)} samples in the firing patch "
                                        f"resolve in the install, the table has {len(layers)}",
                                        "", "minor", script))
    return out


def flight_rounds(library) -> list[str]:
    """Every Projectile with a sound script of its own or on an Engine below it
    (written here, not imported from extract_effects, so a regression in the
    extractor's list is caught)."""
    from bf42 import con as con_mod  # noqa: PLC0415

    def engine_script(t, depth=0, seen=frozenset()):
        if t is None or depth > 8 or t.name.lower() in seen:
            return False
        for ref in t.children:
            c = library.object(con_mod.instance_template_name(ref, library.object) or ref.template)
            if c is None:
                continue
            if c.kind.lower() == "engine" and c.sound_script:
                return True
            if engine_script(c, depth + 1, seen | {t.name.lower()}):
                return True
        return False

    return sorted(t.name for t in library.objects.values()
                  if t.kind.lower() == "projectile" and (t.sound_script or engine_script(t)))


def round_manifest_findings(tree, library, Finding) -> list:
    p = tree.maps / "_shared" / "effects.sounds.json"
    try:
        m = json.loads(p.read_text())
    except (OSError, ValueError):
        return []
    have = {k.lower() for k in m.get("bundles") or {}} | {k.lower() for k in m.get("silent") or {}}
    return [_new(Finding, "sound", "round-flight-sound-not-in-manifest", r,
                 "the round loads a sound script (its own or a child Engine's) and "
                 "effects.sounds.json neither binds it nor records it silent: it flies silent",
                 "", "major", "extract_effects.py (step effects)")
            for r in flight_rounds(library) if r.lower() not in have]


def held_hulls(tree) -> dict[str, str]:
    """{template lower: level} for every hull a spawner holds in an exported
    level's scene.glb or a model glb (`extras.heldSpawner`)."""
    out: dict[str, str] = {}

    def scan(doc, where):
        for n in doc.get("nodes", []):
            if (n.get("extras") or {}).get("heldSpawner") is not None:
                out.setdefault(_SUFFIX.sub("", (n.get("name") or "")).lower(), where)
    for lv, doc in exported_scene_docs(tree):
        scan(doc, lv)
    return out


_SOUND_CREATE = re.compile(r"(?im)^\s*ObjectTemplate\.create\s+(\S+)\s+(\S+)")
_SOUND_SCRIPT = re.compile(r"(?im)^\s*ObjectTemplate\.loadSoundScript\s+(\S+)")
_OBJ_CREATE = re.compile(r"(?im)^\s*Object\.create\s+(\S+)")


def level_sound_templates(arc) -> tuple[dict[str, tuple[str, str | None]], set[str]]:
    """({template lower: (its .con, its script)} a level's `Sounds/*.con`
    declares, {templates lower its scripts place})."""
    decl: dict[str, tuple[str, str | None]] = {}
    placed: set[str] = set()
    from bf42 import con as con_mod  # noqa: PLC0415
    for n in (getattr(arc, "entries", None) or arc.names()):
        low = n.lower().replace("\\", "/")
        if not low.endswith(".con"):
            continue
        try:
            text = con_mod.strip_comments(arc.read(n).decode("latin-1"))
        except Exception:  # noqa: BLE001
            continue
        if "/sounds/" in low:
            current = None
            for line in text.splitlines():
                m = _SOUND_CREATE.match(line)
                if m:
                    current = m.group(2).lower()
                    decl[current] = (n, None)
                    continue
                s = _SOUND_SCRIPT.match(line)
                if s and current:
                    decl[current] = (n, s.group(1))
        placed.update(x.lower() for x in _OBJ_CREATE.findall(text))
    return decl, placed


def _script_samples(arc, con_path: str, script: str | None) -> list[str]:
    """The sample files a level template's script plays."""
    if not script:
        return []
    from bf42.level import parse_ssc, resolve_ssc_path  # noqa: PLC0415
    index = {n.lower().replace("\\", "/"): n for n in (getattr(arc, "entries", None) or arc.names())}

    def read(path):
        hit = index.get(path.lower().replace("\\", "/"))
        return arc.read(hit).decode("latin-1") if hit else None
    path = resolve_ssc_path(con_path, script)
    text = read(path)
    if text is None:
        return []
    try:
        patches = parse_ssc(text, level="high", include=read, source=path)
    except Exception:  # noqa: BLE001
        return []
    return [sm.file for p in patches for sm in p.samples]


def _level_resolver(game, level: str, sounds):
    """`file -> bool`: whether a level sample resolves the way the bake
    resolves it (`extract_map.resolve_sound` over the level's files)."""
    if sounds is None:
        return lambda f: True
    import extract_map as em  # noqa: PLC0415
    from bf42.level import find_level_archives, load_level_files  # noqa: PLC0415
    try:
        files = load_level_files(find_level_archives(
            game.game_dir, game.chain[0].name, level, chain=game.chain), level)
    except Exception:  # noqa: BLE001
        files = None
    return lambda f: em.resolve_sound(f, files, sounds) is not None


def level_sound_findings(tree, game, Finding, sounds=None) -> list:
    from audit_play import _exported_levels  # noqa: PLC0415
    exported = _exported_levels(tree)
    out = []
    for lv in tree.levels:
        if lv.lower() not in exported:
            continue
        try:
            arc = game.level_archive(lv)
            sc = json.loads((tree.maps / lv / "scene.json").read_text())
        except Exception:  # noqa: BLE001
            continue
        if arc is None:
            continue
        decl, placed = level_sound_templates(arc)
        areas = {str(a.get("name") or "").lower()
                 for a in (sc.get("sounds") or {}).get("areas") or []}
        for name, (con_path, script) in sorted(decl.items()):
            if name not in placed or name in areas:
                continue
            resolves = _level_resolver(game, lv, sounds)
            silent = not any(resolves(f) for f in _script_samples(arc, con_path, script))
            out.append(_new(Finding, "sound",
                            "level-sound-template-script-silent" if silent
                            else "level-sound-template-not-baked", name,
                            f"declared in {con_path.rsplit('/', 2)[-2]}/{con_path.rsplit('/', 1)[-1]}"
                            f" ({script or 'no script'}) and placed; not in sounds.areas",
                            lv, "major", "extract_map.discover_level_sounds (step levels)"))
    return out
