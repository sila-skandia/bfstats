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
        * `mesh-texture-upside-down`: the same rule over every mesh texture
          in the shared store whose source is a TGA, mapped back by the glb
          image's `name` (FH's tank reticle discs).
        * `minimap-icon-not-drawn`: a placed vehicle's map symbol (its own,
          a level's, or set in an `include`d `.inc`) that the viewer draws as
          the grey dot (`surveys/census_minimap_icons.py`, FHSW's `.inc`
          icons).
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
        * `mode-script-static-not-baked`: a mode script places scenery
          beyond StaticObjects.con (`Object.create` in a file it runs) that
          scene.glb carries fewer of (Hellendoorn's V2s, Telemark's turbines).
        * `lod-rung-beyond-kept-chain`: a part ships LOD rungs past the ones
          the client builds from its `.sm` (SM-11: after a LOD whose last
          material has under 100 vertices; LOD-6: after LOD 0 when the
          lightmap byte is set). The stone bridge's hole; FHSW's
          japanesefarm rungs (`surveys/census_lod_chains.py`).
        * `level-envmap-not-baked`: `envmap` null while an `.rcm` of the level
          names six faces the chain holds: flat, unreflecting water.
        * `object-script-spawn-group-dropped`: a group the level's object
          scripts bind to a side, its spawn points on a placed template, and
          no spawn of it in scene.json (FH Omaha, FHR-2; the `spawn_groups`
          corpus probe).
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
        * `launcher-motor-one-shots-dropped`: a round whose launcher has no
          script, whose motor Engine's script opens with launch one-shots the
          effect manifest keeps none of (FH's Nebelwerfer, f9553031).
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
import os
import re
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE / "viewer"

ACCEPTED = {
    "level-envmap-faces-absent":
        "no .rcm of the level names six faces any archive of the chain holds "
        "(EoD's Mission Impossible names GuadalCanal/Textures/envmap_02.dds; "
        "FHSW's Ilomantsi names fht_ilomantsi faces no mod ships): the engine "
        "has no cube to load either",
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
    """The colour over black, with the alpha kept as a fourth band: a texel
    the alpha hides carries whatever colour the bake's bleed gave it, and a
    sight picture is black lines whose shape is all in the alpha."""
    from PIL import Image  # noqa: PLC0415
    im = im.convert("RGBA")
    black = Image.new("RGBA", im.size, (0, 0, 0, 255))
    rgb = Image.alpha_composite(black, im).convert("RGB")
    rgb.putalpha(im.getchannel("A"))
    return rgb.resize(size, Image.BILINEAR)


def _diff(a, b) -> float:
    """Mean colour difference, plus the mean alpha difference."""
    from PIL import ImageChops, ImageStat  # noqa: PLC0415
    means = ImageStat.Stat(ImageChops.difference(a, b)).mean
    return sum(means[:3]) / 3 + (means[3] if len(means) > 3 else 0.0)


def orientation(exported, expected, symmetric: float = 4.0, margin: float = 2.0) -> str:
    """'ok', 'flipped' or 'unknown' (sizes differ, or the picture reads the
    same both ways up: its two ways up differ by under `symmetric`)."""
    from PIL import ImageOps  # noqa: PLC0415
    if exported.size != expected.size:
        return "unknown"
    want, got = _flat(expected), _flat(exported)
    upside = _flat(ImageOps.flip(expected))
    if _diff(want, upside) < symmetric:
        return "unknown"
    d_ok, d_flip = _diff(got, want), _diff(got, upside)
    if d_flip + margin < d_ok and d_flip < 0.5 * d_ok:
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


# ---------------------------------------------------------------------------
# hud: mesh textures in the shared store
# ---------------------------------------------------------------------------

def scaled_orientation(exported, expected) -> str:
    """`orientation`, with the source brought to the exported size first: a
    mesh texture is downscaled to the bake's `max_texture`. A picture whose
    shape changed is 'unknown'. The store's pixels are the source's (lossless,
    `bf42/glbopt.py`), so the bars are low: a tank sight's fine black lines
    differ from their mirror by about 1 in a 48 px reduction."""
    from PIL import Image  # noqa: PLC0415
    ew, eh = exported.size
    sw, sh = expected.size
    if (ew, eh) != (sw, sh):
        if abs(ew * sh - eh * sw) > max(ew, eh):
            return "unknown"
        expected = expected.convert("RGBA").resize((ew, eh), Image.BILINEAR)
    return orientation(exported, expected, symmetric=0.5, margin=0.4)


def tree_glbs(tree, scenes: bool = True):
    """Every glb the tree serves: its models (vanilla's without `mods/`), the
    shared effects, and the exported levels' scenes, as `(path, level or
    "")`."""
    from audit_play import _exported_levels  # noqa: PLC0415
    for p in sorted(tree.models.rglob("*.glb")):
        rel = p.relative_to(tree.models).parts
        if tree.mod_id == "bf1942" and rel and rel[0] == "mods":
            continue
        yield p, ""
    fx = tree.maps / "_shared" / "effects.glb"
    if fx.is_file():
        yield fx, ""
    if scenes:
        exported = _exported_levels(tree)
        for lv in tree.levels:
            if lv.lower() in exported and (tree.maps / lv / "scene.glb").is_file():
                yield tree.maps / lv / "scene.glb", lv


# An image `glbopt.externalise_images` wrote: uri, mimeType, then the name.
_STORED_TGA = re.compile(rb'\{"uri":\s*"([^"]+)",\s*"mimeType":\s*"[^"]*",\s*"name":\s*"([^"]*\.tga)"\}',
                         re.I)


def _tga_image_refs(path: Path) -> list[tuple[str, str]]:
    """`(uri, name)` of each stored image a glb draws from a TGA, read off the
    JSON chunk's bytes: parsing FHSW's 16,000 chunks as JSON took a minute."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(20)
            if head[:4] != b"glTF":
                return []
            chunk = fh.read(struct.unpack("<I", head[12:16])[0])
    except OSError:
        return []
    if b".tga" not in chunk.lower():
        return []
    return [(u.decode("utf-8", "replace"), n.decode("utf-8", "replace"))
            for u, n in _STORED_TGA.findall(chunk)]


def tga_images(tree) -> dict[Path, tuple[str, list[str], str]]:
    """{store file: (source name, the glbs naming it, the first one's level)}
    for every image a glb of the tree draws from a TGA. The optimiser moved
    the pixels into `viewer/textures/` under a hash of the pixels
    (`bf42/glbopt.py`), and the glb keeps the source the bake resolved as the
    image's `name` (`assemble._texture_index`: `texture/brit_reticule.tga`),
    so no manifest is needed to map a store file back to its TGA."""
    out: dict[Path, tuple[str, list[str], str]] = {}
    for p, lv in tree_glbs(tree):
        for uri, name in _tga_image_refs(p):
            target = Path(*(p.parent / uri).parts).resolve()
            out.setdefault(target, (name, [], lv))[1].append(str(p))
    return out


def mesh_tga_findings(tree, game, ctx: dict, Finding) -> list:
    """Each TGA-sourced mesh texture in the store, against its source decoded
    with PIL and `bf42/meshtga.py`'s row rule: FH's tank reticle discs read
    upside down when an RLE bottom-left file was given the origin bit."""
    from PIL import Image  # noqa: PLC0415
    images = tga_images(tree)
    level_cache: dict[str, object] = {}
    out, checked, unknown, unresolved = [], 0, 0, 0
    for target, (name, glbs, lv) in sorted(images.items()):
        raw = game.textures.try_read(name) if getattr(game, "textures", None) else None
        if raw is None and lv:
            if lv not in level_cache:
                level_cache[lv] = level_files(game, lv)
            files = level_cache[lv]
            hit = files.find(name) if files is not None else None
            raw = files.read(hit) if hit else None
        if raw is None or not _is_tga(raw) or not target.is_file():
            unresolved += 1
            continue
        try:
            state = scaled_orientation(Image.open(target), engine_tga_image(raw))
        except Exception:  # noqa: BLE001 - an image PIL cannot read is not this check's
            unresolved += 1
            continue
        checked += 1
        unknown += state == "unknown"
        if state == "flipped":
            out.append(_new(Finding, "hud", "mesh-texture-upside-down", name,
                            f"{target.parent.name}/{target.name} in {len(glbs)} glbs "
                            f"({os.path.relpath(glbs[0], VIEWER)}) (TGA type {raw[2]}, origin "
                            f"bit {'top' if raw[17] & 0x20 else 'bottom'}-left) is drawn the other "
                            "way up from the engine's row order", lv, "major",
                            "bf42/assemble.py _texture_index, bf42/meshtga.py (steps models, levels)"))
    ctx["hud: TGA mesh textures checked"] = (f"{checked} of {len(images)} ({unknown} symmetric "
                                             f"or reshaped, {unresolved} not in the install)")
    return out


# ---------------------------------------------------------------------------
# hud: minimap symbols
# ---------------------------------------------------------------------------

def minimap_findings(tree, game, ctx: dict, Finding) -> list:
    """`surveys/census_minimap_icons.py` over the tree's exported levels: a
    placed vehicle whose template names a map symbol (its own, a level's, or
    in an `include`d `.inc`) and the viewer draws the grey vehicle dot
    instead (FHSW's 155 icons set inside `.inc` files, 54b6fc7e)."""
    import sys as _sys  # noqa: PLC0415
    surveys = str(HERE / "surveys")
    if surveys not in _sys.path:
        _sys.path.insert(0, surveys)
    import census_minimap_icons as cm  # noqa: PLC0415
    row = cm.tree_row(tree.mod_id, game.mod)
    row = (row[0], tree.maps / "maps.json", tree.maps / "_shared" / "hud" if tree.mod_id != "bf1942"
           else cm.VANILLA_HUD, tree.mod_id in ("fhsw", "fhsweurope"))
    rows = cm.survey_tree(tree.mod_id, game.game_dir, None, row)
    out, seen = [], set()
    for r in rows:
        if r["verdict"] != "dot" or (r["template"], r["icon"]) in seen:
            continue
        seen.add((r["template"], r["icon"]))
        levels = sorted({x["level"] for x in rows if x["template"] == r["template"]
                         and x["verdict"] == "dot"})
        out.append(_new(Finding, "hud", "minimap-icon-not-drawn", r["template"],
                        f"setMinimapIcon {r['icon']} ({r['source'] or 'unread'}): the map draws "
                        f"{r['viewer']} instead; {len(levels)} levels", levels[0], "major",
                        "extract_hud_pack.py extract_icon_map (step hud)"))
    verdicts = collections.Counter(r["verdict"] for r in rows)
    ctx["hud: minimap marks read"] = ", ".join(f"{k} {v}" for k, v in sorted(verdicts.items()))
    return out


def run_hud(tree, game, ctx: dict, Finding) -> list:
    out = run_icons(tree, game, ctx, Finding)
    if not getattr(game, "ok", False):
        ctx["hud: orientation"] = "skipped: no game install"
        return out
    out += hud_orientation_findings(tree, game, ctx, Finding)
    out += loading_orientation_findings(tree, game, ctx, Finding)
    for what, check in (("mesh textures", mesh_tga_findings), ("minimap", minimap_findings)):
        try:
            out += check(tree, game, ctx, Finding)
        except Exception as exc:  # noqa: BLE001 - one check never stops the audit
            ctx[f"hud: {what} unreadable"] = f"{type(exc).__name__}: {str(exc)[:100]}"
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


def level_files(game, level: str):
    """The level's `LevelFiles` (base, patches and the chain's copies of the
    same level under them), or None: no install, no archive."""
    from bf42.level import find_level_archives, load_level_files  # noqa: PLC0415
    if getattr(game, "game_dir", None) is None:
        return None
    try:
        paths = find_level_archives(game.game_dir, game.chain[0].name, level, chain=game.chain)
        return load_level_files(paths, level) if paths else None
    except Exception:  # noqa: BLE001 - a damaged archive is the caller's "unreadable"
        return None


def run_order(files) -> list[str]:
    """`extract_map.level_run_order`, once per level: the scripts `Init.con`
    reaches, in the order a host runs them."""
    if not hasattr(files, "_audit_run_order"):
        from extract_map import level_run_order  # noqa: PLC0415
        files._audit_run_order = level_run_order(files)
    return files._audit_run_order


def level_library(files, chain_library=None) -> LayeredLibrary:
    """The level's own templates (every `.con`/`.inc` of its archives) over
    the chain's."""
    from bf42.con import ObjectLibrary  # noqa: PLC0415
    own = ObjectLibrary()
    for arc in files.archives:
        for n in arc.entries:
            if n.lower().endswith((".con", ".inc")):
                try:
                    own.add_con(n, arc.read(n).decode("latin-1", "replace"))
                except Exception:  # noqa: BLE001 - one unreadable script
                    continue
    return LayeredLibrary(own, chain_library)


def mode_edit_blocks(game, level: str, mode: str | None, chain_library=None, files=None,
                     game_types=None):
    """`(the default layer's reopened-template blocks, a library of the
    level's own templates over the chain's)`, read from the install."""
    from bf42.level import mode_template_edits  # noqa: PLC0415
    files = files if files is not None else level_files(game, level)
    if files is None or not mode:
        return [], chain_library
    blocks = mode_template_edits(files, mode, game_types)
    if not blocks:
        return [], chain_library
    return blocks, level_library(files, chain_library)


# ---------------------------------------------------------------------------
# levels: the LOD chain the client keeps
# ---------------------------------------------------------------------------

# `StandardMeshTemplate_readLods` 0x005b54e0 stops building LODs after the
# first whose LAST material has fewer than this many vertices (ledger SM-11),
# and after LOD 0 when the `.sm` header's lightmap byte is set (LOD-6). Written
# here from the ledger, not imported from `bf42/assemble.py`, so a regression in
# the exporter's rule is caught.
SM_KEEP_MIN_VERTICES = 100


def sm_lod_summary(raw: bytes) -> tuple[bool, list[int | None]] | None:
    """`(lightmap byte, each LOD's last material's vertex count)` of a `.sm`,
    read off the descriptors alone: collision blocks and vertex payloads are
    stepped over by their sizes. None for a file that is not a `.sm`."""
    try:
        (version,) = struct.unpack_from("<I", raw, 0)
        if version not in (8, 9, 10):
            return None
        pos = 8 + 24
        lit = False
        if version > 9:
            lit, pos = bool(raw[pos]), pos + 1
        (cols,) = struct.unpack_from("<I", raw, pos)
        pos += 4
        for _ in range(cols):
            (size,) = struct.unpack_from("<I", raw, pos)
            pos += 4 + size
        (count,) = struct.unpack_from("<I", raw, pos)
        pos += 4
        if count > 64:
            return None
        lasts: list[int | None] = []
        for _ in range(count):
            (mats,) = struct.unpack_from("<I", raw, pos)
            pos += 4
            sizes = []
            for _ in range(mats):
                (n,) = struct.unpack_from("<I", raw, pos)
                pos += 4 + n + 12
                _prim, _flags, stride, vertices, indices, _u = struct.unpack_from("<6I", raw, pos)
                pos += 24
                sizes.append((stride, vertices, indices))
            for stride, vertices, indices in sizes:
                pos += stride * vertices + 2 * indices
            lasts.append(sizes[-1][1] if sizes else None)
        return lit, lasts
    except (struct.error, IndexError):
        return None


def kept_lod_count(lightmapped: bool, lasts: list[int | None]) -> tuple[int, str]:
    """How many LODs, from LOD 0, the client builds, and why it stops there."""
    if lightmapped and lasts:
        return 1, "the .sm's lightmap byte is set (LOD-6)"
    last = 9999999
    for i, n in enumerate(lasts):
        if n is not None:
            last = n
        if last < SM_KEEP_MIN_VERTICES:
            return i + 1, f"LOD {i} ends on {last} vertices (SM-11)"
    return len(lasts), ""


def scene_rung_chains(doc: dict) -> dict[str, dict]:
    """{geometry lower: {name, top (highest rung level shipped), parts, lit}}
    over a scene's parts with LOD rungs; `lit` counts parts the level lights
    (`extras.lightmap`, whose rungs the viewer hides)."""
    nodes = doc.get("nodes", [])
    out: dict[str, dict] = {}
    for n in nodes:
        rungs = [((nodes[c].get("extras") or {}).get("lod") or {}) for c in n.get("children", [])]
        rungs = [r for r in rungs if r.get("level", 0) > 0]
        if not rungs:
            continue
        geom = rungs[0].get("geometry") or (n.get("extras") or {}).get("geometry") or n.get("name") or ""
        row = out.setdefault(geom.lower(), {"name": geom, "top": 0, "parts": 0, "lit": 0})
        row["top"] = max(row["top"], max(r["level"] for r in rungs))
        row["parts"] += 1
        row["lit"] += bool((n.get("extras") or {}).get("lightmap"))
    return out


_GEOM_FILE = re.compile(r"^\s*GeometryTemplate\.(create\s+\S+|file)\s+(\S+)", re.I)


def level_geometry_files(files) -> dict[str, str]:
    """{geometry lower: mesh file} the level's own scripts declare
    (`GeometryTemplate.file`, else the geometry's own name). Only the scripts
    `Init.con`'s run graph reaches declare anything (Monster des Stahles'
    `rem run Geometries/go` leaves its collisionless hulls undeclared), and
    the first declaration of a name wins (ledger LOAD-1, LOAD-2)."""
    from bf42 import con as con_mod  # noqa: PLC0415
    out: dict[str, str] = {}
    for path in run_order(files):
        try:
            text = con_mod.strip_comments(files.read(path).decode("latin-1", "replace"))
        except Exception:  # noqa: BLE001
            continue
        current = None
        for line in text.splitlines():
            m = _GEOM_FILE.match(line)
            if not m:
                continue
            value = m.group(2).strip('"')
            if m.group(1).lower().startswith("create"):
                current = None if value.lower() in out else value.lower()
                if current:
                    out[current] = value
            elif current:
                out[current] = value.replace("\\", "/").rsplit("/", 1)[-1]
    return out


class MeshSummaries:
    """`sm_lod_summary` of a geometry's `.sm` as a level's bake reads it: the
    chain's `standardMesh/` first, the level's own `StandardMesh/` for a name
    the chain does not ship (`ArchivePool.add_level_meshes`: global meshes keep
    priority). Which copy the engine draws when both ship one is not read
    (FHSW Liberation of Caen's `pak40_mount_M1`); the check follows the bake.
    The geometry's file is the level's own declaration when `Init.con` reaches
    one. Chain files are read once per audit."""

    def __init__(self, game, library):
        self.game, self.library, self._chain = game, library, {}

    def _from_chain(self, mesh: str):
        if mesh.lower() not in self._chain:
            pool = getattr(self.game, "meshes", None)
            hit = pool.resolve_ext(f"standardMesh/{mesh}", (".sm",)) if pool is not None else None
            self._chain[mesh.lower()] = sm_lod_summary(pool.read(hit)) if hit else None
        return self._chain[mesh.lower()]

    def for_level(self, files):
        own = level_geometry_files(files) if files is not None else {}
        cache: dict[str, tuple | None] = {}

        def find(geometry: str):
            key = geometry.lower()
            if key not in cache:
                g = self.library.geometry(geometry) if self.library is not None else None
                mesh = own.get(key) or (g.mesh_file if g is not None else geometry)
                got = self._from_chain(mesh)
                if got is None and files is not None and files.find(f"StandardMesh/{mesh}.sm"):
                    got = sm_lod_summary(files.read(f"StandardMesh/{mesh}.sm"))
                cache[key] = got
            return cache[key]
        return find


def lod_chain_findings(doc: dict, find, hidden: bool, level: str, Finding) -> list:
    """One finding per level and reason for the geometries of its scene that
    ship a rung the client never builds (`lod_chain_overruns`)."""
    by_rule: dict[str, list] = collections.defaultdict(list)
    for name, kept, total, why, top, parts in lod_chain_overruns(doc, find, hidden):
        by_rule["LOD-6" if "LOD-6" in why else "SM-11"].append((name, kept, total, why, top, parts))
    out = []
    for rule, rows in sorted(by_rule.items()):
        rows.sort(key=lambda r: -r[5])
        name, kept, total, why, top, _parts = rows[0]
        out.append(_new(Finding, "levels", "lod-rung-beyond-kept-chain", f"{level}/scene.glb",
                        f"{len(rows)} geometries, {sum(r[5] for r in rows)} parts ship LOD rungs "
                        f"the client never builds ({rule}), drawn past their distance; e.g. "
                        f"{name}: keeps {kept} of {total} ({why}), rungs to LOD {top}",
                        level, "major", "bf42/assemble.py retail_lod_chain (step levels: re-bake)"))
    return out


def lod_chain_overruns(doc: dict, find, hidden: bool) -> list[tuple]:
    """`(geometry, LODs kept, LODs in the file, why, top rung shipped, parts)`
    for each geometry of a scene that ships a rung the client never builds
    (the stone bridge's hole, SM-11; FHSW's `japanesefarm1_m1` fade plane,
    LOD-6). A lightmapped part's rungs are left to
    `lightmapped-part-ships-rungs` when the viewer hides them."""
    out = []
    for _key, row in sorted(scene_rung_chains(doc).items()):
        summary = find(row["name"])
        if summary is None:
            continue
        kept, why = kept_lod_count(*summary)
        if row["top"] < kept:
            continue
        parts = row["parts"] - (row["lit"] if hidden else 0)
        if parts > 0:
            out.append((row["name"], kept, len(summary[1]), why, row["top"], parts))
    return out


# ---------------------------------------------------------------------------
# levels: the reflection cube
# ---------------------------------------------------------------------------

class ChainFaces:
    """Whether an `.rcm` face resolves where the engine looks: the level's
    own files, every level archive of the chain (each mounted at its own path,
    with the basename as the fallback, `features/level-archive-mounts`) and the
    chain's texture pool, `.tga` names finding the `.dds` shipped. The level
    archive index is built on the first face a level's own files miss."""

    def __init__(self, game):
        self.game, self._index = game, None

    @staticmethod
    def _stem(path: str) -> str:
        leaf = path.replace("\\", "/").lower().rsplit("/", 1)[-1]
        return leaf.rsplit(".", 1)[0] if leaf.endswith((".dds", ".tga")) else leaf

    def _build(self) -> set[str]:
        from bf42.rfa import RfaArchive, find_archives_dir, find_levels_dir  # noqa: PLC0415
        out: set[str] = set()
        for mod_dir in getattr(self.game, "chain", []):
            ad = find_archives_dir(mod_dir)
            ld = find_levels_dir(ad) if ad else None
            if ld is None:
                continue
            for f in ld.iterdir():
                if f.suffix.lower() != ".rfa":
                    continue
                try:
                    arc = RfaArchive(f)
                except Exception:  # noqa: BLE001
                    continue
                for n in arc.entries:
                    low = n.replace("\\", "/").lower()
                    if low.endswith((".dds", ".tga")):
                        out.add(low)
                        out.add("stem:" + self._stem(low))
        return out

    def resolves(self, files, path: str) -> bool:
        if files is not None and files.find(path):
            return True
        pool = getattr(self.game, "textures", None)
        if pool is not None:
            stem = path.rsplit(".", 1)[0] if path.lower().endswith((".dds", ".tga")) else path
            if pool.resolve_ext(stem, (".dds", ".tga")):
                return True
        if self._index is None:
            self._index = self._build()
        low = path.replace("\\", "/").lower()
        return low in self._index or "stem:" + self._stem(low) in self._index


def envmap_findings(tree, level: str, sc: dict, files, faces: ChainFaces, Finding) -> list:
    """The level's reflection cube: baked when an `.rcm` of the level has six
    faces the chain holds (`write_skybox`; 225 levels had none before
    a9235ca5 because the faces were looked for in the level's own archive)."""
    from bf42.level import parse_cubemap_rcm  # noqa: PLC0415
    if "envmap" not in sc:
        return []
    env = sc.get("envmap")
    script = "extract_map.write_skybox (patch_sky.py --mod M --all)"
    if env:
        lost = [f for f in env if not (tree.maps / level / f).is_file()]
        return [_new(Finding, "levels", "level-envmap-file-missing", f"{level}/{lost[0]}",
                     f"{len(lost)} of the cube's {len(env)} faces are not in the tree",
                     level, "major", script)] if lost else []
    if files is None:
        return []
    rcms = sorted((n for n in files.names() if n.lower().endswith(".rcm")), key=str.lower)
    if not rcms:
        return []
    short = []
    for name in rcms:
        try:
            mapping = parse_cubemap_rcm(files.read(name).decode("latin-1", "replace"))
        except Exception:  # noqa: BLE001 - a damaged entry is the next candidate's turn
            continue
        if len(mapping) != 6:
            continue
        lost = [p for p in mapping.values() if not faces.resolves(files, p)]
        if not lost:
            return [_new(Finding, "levels", "level-envmap-not-baked", level,
                         f"{name.rsplit('/', 1)[-1]} names six faces the chain holds and "
                         "scene.json has envmap null: the water draws flat, unreflecting",
                         level, "major", script)]
        short.append(f"{name.rsplit('/', 1)[-1]}: {lost[0]}")
    return [_new(Finding, "levels", "level-envmap-faces-absent", level,
                 "no .rcm of the level has six faces any archive holds (" + "; ".join(short)[:120] + ")",
                 level, "major", script)] if short else []


# ---------------------------------------------------------------------------
# levels: spawn groups an object script binds (FHR-2)
# ---------------------------------------------------------------------------

_SPM_GROUP = re.compile(r"^\s*spawnPointManager\.group\s+(\d+)", re.I)
_SPM_TEAM = re.compile(r"^\s*spawnPointManager\.groupTeam\s+(\d+)", re.I)
_TEMPLATE_CREATE = re.compile(r"^\s*ObjectTemplate\.create\s+(\S+)\s+(\S+)", re.I)
_SET_GROUP = re.compile(r"^\s*ObjectTemplate\.setGroup\s+(\d+)", re.I)
_ADD_TEMPLATE = re.compile(r"^\s*ObjectTemplate\.addTemplate\s+(\S+)", re.I)


def object_script_spawn_groups(scripts: list[str]):
    """`({group: team} the scripts bind, {group: SpawnPoint templates they
    declare in it}, {child lower: parents lower})` over the level's object
    scripts, the texts in the order `Init.con` runs them. `Game::load` runs
    them before the mode script (ledger FHR-2): FH Omaha's landing craft
    carry the Allies' first spawn and bind its groups there."""
    from bf42 import con as con_mod  # noqa: PLC0415
    bound: dict[int, int] = {}
    used: dict[int, list[str]] = collections.defaultdict(list)
    parents: dict[str, set[str]] = collections.defaultdict(set)
    for text in scripts:
        group = spawn = current = None
        for line in con_mod.strip_comments(text).splitlines():
            if m := _SPM_GROUP.match(line):
                group = int(m.group(1))
            elif (m := _SPM_TEAM.match(line)) and group is not None:
                bound[group] = int(m.group(1))
            elif m := _TEMPLATE_CREATE.match(line):
                current = m.group(2).lower()
                spawn = m.group(2) if m.group(1).lower() == "spawnpoint" else None
            elif (m := _SET_GROUP.match(line)) and spawn:
                used[int(m.group(1))].append(spawn)
            elif (m := _ADD_TEMPLATE.match(line)) and current:
                parents[m.group(1).lower()].add(current)
    return bound, dict(used), dict(parents)


def _hosted(name: str, parents: dict[str, set[str]], placed: set[str]) -> bool:
    """Whether a template, or a template that adds it at any depth, is placed."""
    seen, stack = set(), [name.lower()]
    while stack:
        n = stack.pop()
        if n in placed:
            return True
        if n not in seen:
            seen.add(n)
            stack.extend(parents.get(n, ()))
    return False


def level_object_scripts(files) -> list[str]:
    """The texts of the scripts under the level's `Objects/` that `Init.con`
    reaches, in run order (a script it never runs declares nothing: FHSW
    Liberation of Caen ships a paratrooper spawn object it never runs)."""
    out = []
    for path in run_order(files):
        if "/objects/" not in f"/{path}":
            continue
        try:
            out.append(files.read(path).decode("latin-1", "replace"))
        except Exception:  # noqa: BLE001
            continue
    return out


def spawn_group_findings(level: str, sc: dict, doc: dict, scripts: list[str], Finding) -> list:
    """A group the level's object scripts bind to a side, whose spawn points
    ride a template the level places, with no spawn of it in scene.json."""
    bound, used, parents = object_script_spawn_groups(scripts)
    # every layer the scene bakes: Doomed Budapest's flag spawners and their
    # groups stand in ObjectiveMode alone
    layers = [sc, *[m for m in (sc.get("modes") or {}).values() if isinstance(m, dict)]]
    have = {s.get("group") for ly in layers for s in (ly.get("soldierSpawns") or [])}
    have |= {s.get("group") for ly in layers for s in (ly.get("vehicleSoldierSpawns") or [])}
    placed = {str(s.get("vehicle") or "").lower() for ly in layers for s in (ly.get("objectSpawns") or [])}
    placed |= {_SUFFIX.sub("", (n.get("name") or "").lower()) for n in doc.get("nodes", [])}
    out = []
    for group in sorted(set(bound) & set(used)):
        if group in have:
            continue
        names = sorted({n for n in used[group] if _hosted(n, parents, placed)})
        if not names:
            continue
        out.append(_new(Finding, "levels", "object-script-spawn-group-dropped", f"group {group}",
                        f"the level's object scripts bind group {group} to team {bound[group]} and "
                        f"a placed template carries its spawn points ({', '.join(names[:3])}); "
                        "scene.json has no spawn in it: that side has no spawn there "
                        "(FH Omaha, FHR-2)", level, "major",
                        "bf42/level.py init_spawn_groups, extract_map.load_level "
                        "(patch_scene.py --layer spawns)"))
    return out


# ---------------------------------------------------------------------------
# levels: what a mode script creates beyond StaticObjects.con
# ---------------------------------------------------------------------------

def mode_script_statics(game_types: dict, layers: set[str], library) -> dict[str, set]:
    """{template lower: its distinct positions} the game types create outside
    their layer files and that are scenery, not round machinery
    (`bf42.level.is_gameplay_kind`, by what the scripts declare, else by the
    library). A game type whose layer directory is not among the scene's
    `layers` is left out: the page plays the default layer for it."""
    from bf42.level import is_gameplay_kind  # noqa: PLC0415
    out: dict[str, set] = collections.defaultdict(set)
    for gt in game_types.values():
        if (getattr(gt, "mode", "") or "").lower() not in layers:
            continue
        for inst in getattr(gt, "objects", None) or []:
            key = inst.template.lower()
            kind = (getattr(gt, "declared", None) or {}).get(key)
            if kind is None and library is not None:
                t = library.object(inst.template)
                kind = t.kind if t is not None else None
            if is_gameplay_kind(kind):
                continue
            out[key].add(tuple(round(float(v), 1) for v in inst.position))
    return dict(out)


def missing_mode_statics(doc: dict, statics: dict[str, set], library) -> list[tuple[str, int, int]]:
    """`(template, nodes in scene.glb, placements the scripts make)` where the
    scene carries fewer of the template than the mode scripts place. A
    template nothing declares places nothing in the engine either (Ctf
    scripts' `gebase`/`ukbase` on FHSW's desert levels)."""
    names = [(n.get("name") or "").lower() for n in doc.get("nodes", [])]
    stripped = collections.Counter(_SUFFIX.sub("", n) for n in names)
    exact = collections.Counter(names)
    out = []
    for tmpl, places in sorted(statics.items()):
        if library is None or library.object(tmpl) is None:
            continue
        node = expected_node(library, tmpl)
        if node is None:
            continue
        have = max(stripped.get(node, 0), exact.get(node, 0))
        if have < len(places):
            out.append((tmpl, have, len(places)))
    return out


def run_levels(tree, game, ctx: dict, Finding) -> list:
    out = []
    hidden = viewer_hides_lightmap_rungs()
    ok = getattr(game, "ok", False)
    rung_total = edits = with_statics = 0
    names = {}
    library = game.library() if ok else None
    meshes = MeshSummaries(game, library) if ok else None
    faces = ChainFaces(game) if ok else None
    try:
        rows = json.loads((tree.maps / "maps.json").read_text())
        rows = rows.get("maps", []) if isinstance(rows, dict) else rows
        names = {str(r.get("name") or "").lower(): r.get("name") for r in rows if isinstance(r, dict)}
    except (OSError, ValueError):
        pass

    def unreadable(lv, what, exc):
        ctx.setdefault("levels: unreadable", []).append(f"{lv} ({what}): {str(exc)[:60]}")

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
        name = names.get(lv.lower()) or lv
        try:
            sc = json.loads((tree.maps / lv / "scene.json").read_text())
            files = level_files(game, name)
            game_types = None
            if files is not None:
                from bf42.level import load_game_types  # noqa: PLC0415
                game_types = load_game_types(files)
            blocks, lib = mode_edit_blocks(game, name, sc.get("gameplayMode"), library,
                                           files=files, game_types=game_types)
        except Exception as exc:  # noqa: BLE001 - one broken level never stops the audit
            unreadable(lv, "mode script", exc)
            continue
        adds = active_additions(blocks)
        edits += bool(adds)
        for tmpl, kid, lacking, total in missing_additions(doc, adds, lib):
            out.append(_new(Finding, "levels", "mode-template-edit-not-baked", tmpl,
                            f"{sc.get('gameplayMode')}'s script reopens {tmpl} and adds {kid}; "
                            f"{lacking} of {total} placed {tmpl} carry no {kid} in scene.glb",
                            lv, "major", "scene_layers.py LevelContext.library (step levels: re-bake)"))
        if files is None:
            continue
        checks = (
            ("LOD chains", lambda: lod_chain_findings(doc, meshes.for_level(files), hidden, lv,
                                                      Finding)),
            ("envmap", lambda: envmap_findings(tree, lv, sc, files, faces, Finding)),
            ("spawn groups", lambda: spawn_group_findings(lv, sc, doc, level_object_scripts(files),
                                                          Finding)),
        )
        for what, check in checks:
            try:
                out += check()
            except Exception as exc:  # noqa: BLE001
                unreadable(lv, what, exc)
        try:
            layers = {k.lower() for k in (sc.get("modes") or {})}
            statics = mode_script_statics(game_types or {}, layers, library)
            if statics:
                with_statics += 1
                lib = lib if lib is not library else level_library(files, library)
                for tmpl, have, want in missing_mode_statics(doc, statics, lib):
                    out.append(_new(Finding, "levels", "mode-script-static-not-baked", tmpl,
                                    f"the mode scripts place {want} {tmpl} beyond StaticObjects.con; "
                                    f"scene.glb carries {have} (Hellendoorn's V2s, Telemark's turbines)",
                                    lv, "major", "extract_map.union_mode_statics (step levels: re-bake)"))
        except Exception as exc:  # noqa: BLE001
            unreadable(lv, "mode statics", exc)
    ctx["levels: lightmapped parts with rungs"] = f"{rung_total} ({'hidden by the viewer' if hidden else 'drawn'})"
    if ok:
        ctx["levels: levels whose mode script reopens templates with children"] = edits
        ctx["levels: levels whose mode scripts place statics"] = with_statics
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


def motor_rounds(library) -> list[tuple[str, object]]:
    """`(round, its Engine)` for each round whose whole sound is a child
    Engine's script and whose launcher has none of its own: FH's Nebelwerfer
    and Wurfgerat 40 rockets carry their launch report as the motor script's
    first one-shots (f9553031). Written here from that rule, not imported
    from `extract_effects.motor_round_names`, so a regression there is caught."""
    from bf42 import con as con_mod  # noqa: PLC0415
    voiced = {t.projectile_template.lower() for t in library.objects.values()
              if t.kind.lower() == "firearms" and t.sound_script and t.projectile_template}

    def engine(t, depth=0, seen=frozenset()):
        if t is None or depth > 6 or t.name.lower() in seen:
            return None
        for ref in t.children:
            c = library.object(con_mod.instance_template_name(ref, library.object) or ref.template)
            if c is None:
                continue
            if c.kind.lower() == "engine" and c.sound_script:
                return c
            hit = engine(c, depth + 1, seen | {t.name.lower()})
            if hit is not None:
                return hit
        return None

    out = []
    for t in library.objects.values():
        if t.kind.lower() != "projectile" or t.sound_script or t.name.lower() in voiced:
            continue
        e = engine(t)
        if e is not None:
            out.append((t.name, e))
    return sorted(out, key=lambda r: r[0].lower())


def launch_one_shots(engine, objects, sounds) -> list[str]:
    """The samples of a motor script that start with the round and play once
    (no loop, no `trigger Volume`: a launch report, not a passing crack) and
    that resolve in the install."""
    import extract_map as em  # noqa: PLC0415
    from bf42.level import parse_ssc, resolve_ssc_path  # noqa: PLC0415

    def read(path):
        hit = objects.find(path)
        return objects.read(hit).decode("latin-1") if hit else None
    path = resolve_ssc_path(getattr(engine, "source", "") or "", engine.sound_script)
    text = read(path)
    if text is None:
        return []
    try:
        patches = parse_ssc(text, level="high", include=read, source=path)
    except Exception:  # noqa: BLE001 - an unparsable script is not this check's
        return []
    return [s.file for p in patches for s in p.samples
            if not s.loop and (s.trigger or "") != "volume"
            and em.resolve_sound(s.file, None, sounds) is not None]


def motor_one_shot_findings(tree, library, objects, sounds, Finding) -> list:
    """`launcher-motor-one-shots-dropped`: a motor round whose launch
    one-shots the effect manifest keeps none of (FH's Nebelwerfer fired with
    no report while the manifest kept the flight table's loops alone)."""
    try:
        m = json.loads((tree.maps / "_shared" / "effects.sounds.json").read_text())
    except (OSError, ValueError):
        return []
    bundles, scripts = m.get("bundles") or {}, m.get("scripts") or {}
    out = []
    for name, engine in motor_rounds(library):
        entry = bundles.get(name.lower())
        if entry is None:
            continue          # round-flight-sound-not-in-manifest's
        layers = [ly for key in entry.get("scripts") or [entry.get("script")]
                  for ly in (scripts.get(key) or {}).get("layers") or []]
        if any(not ly.get("loop") and (ly.get("trigger") or "") != "volume" for ly in layers):
            continue
        shots = launch_one_shots(engine, objects, sounds)
        if shots:
            out.append(_new(Finding, "sound", "launcher-motor-one-shots-dropped", name,
                            f"{engine.name}'s script opens with {len(shots)} one-shots "
                            f"({', '.join(sorted({s.rsplit('/', 1)[-1] for s in shots})[:3])}) and "
                            "the manifest keeps its loops alone: the launcher fires with no report",
                            "", "major", "extract_effects.motor_round_names (step effects)"))
    return out


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
