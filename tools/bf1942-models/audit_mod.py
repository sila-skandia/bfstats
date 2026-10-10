#!/usr/bin/env python3
"""Adversarial audit of an extracted mod tree: find the simple defects a human
would otherwise find by hand-testing.

    python3 audit_mod.py --mod fh                       # every static audit
    python3 audit_mod.py --mod fh --audit textures sound
    python3 audit_mod.py --mod fhsw --audit textures    # read-only on any tree
    python3 audit_mod.py --mod fh --json out.json       # machine-readable too
    python3 audit_mod.py --mod fh --render              # also the rendered smoke

Sub-audits (each prints a table; the exit status is 1 when any finding is not
in `ACCEPTED`):

    textures   every .glb (models, level scenes, effects): untextured drawn
               materials, texture files that are missing / 1x1 / opaque white /
               magenta, degenerate UVs, unresolved lists in .report.json, and
               (with the game install present) a source-level scan of every
               `.rs` for texture lines the reader fails to parse.
    placement  each level's objects, spawners and spawn points against the
               level's own heightmap: floating, buried, at the origin, stacked.
    sound      every vehicle template's Engine and FireArms against what the
               sound table holds, with an independent folder oracle over the
               game's `.con` files; every sample file a layer names.
    models     vehicles without seats, weapons without a fire sound or
               effect, kits without viewmodels, icons and thumbnails missing,
               models.json against the files on disk.
    data       control points and spawn groups against the model catalogue,
               kits named by levels against the kit tables, voices.

`ACCEPTED` lists the causes that are true of the retail install itself (a
texture the game never shipped): they are still printed, under "accepted", so
a regression in their count is visible, but they do not fail the run.

The tool reads the published tree only (`viewer/models/mods/<id>`,
`viewer/maps/mods/<id>`; vanilla is `viewer/models` and `viewer/maps`) and,
when `~/.wine/.../Battlefield 1942` is present, the game archives, for the
questions a glb cannot answer by itself ("did the source declare a texture?").
Nothing is written; no browser is started without `--render`.
"""

from __future__ import annotations

import argparse
import array
import collections
import json
import math
import os
import re
import struct
import sys
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

VIEWER = HERE / "viewer"
AUDITS = ("textures", "placement", "sound", "models", "data")

# Causes that are a property of the retail install, not of the extraction.
# `cause id -> why it is accepted`. Keep this list short and explained: a cause
# lands here only after the archives were searched for the missing thing.
# Source textures that are one flat colour on purpose, by name fragment: the
# engine's own placeholder, the black darkness plane that fades out up close,
# the white mask an effect tints.
AUTHORED_UNIFORM = ("notexture", "black_o", "black_l", "_white_", "white_i")

ACCEPTED: dict[str, str] = {
    "untextured-texture-absent-from-install":
        "a drawn material whose texture is in no archive of the install "
        "(sherW2_f, ahelm2_r, the Ju 88's *_MESH set): retail draws it "
        "untextured too",
    "untextured-generic-material-name":
        "the shader is called `Material #N`, a name hundreds of `.rs` files "
        "share, so the glb cannot say which texture it wanted (here the "
        "Ju 88 cockpit, whose body textures are absent from the install)",
    "level-sound-wav-in-other-dir":
        "the script loads `Sound/@RTD/x.wav` and the file ships only as "
        "`Sound/<rate>/Ambience/x.wav`; the engine does not search folders, "
        "so Gold Beach's 14 linnut_metsa emitters are silent in retail too",
    "level-places-undefined-template":
        "the level script `Object.create`s a name no ObjectTemplate.create "
        "defines; the engine places nothing too (Omaha's `beachsound`)",
    "level-template-logic-not-baked":
        "a ControlPoint/SpawnPoint/ObjectSpawner template of a mode layer the "
        "viewer does not play (SinglePlayer)",
    "level-sound-samples-absent":
        "the level object's sound script names a wav that is in no archive "
        "(Prokhorovka's radio_german1.wav)",
    "kit-icon-absent-from-install":
        "the kit names an icon that is in no menu.rfa of the mod chain "
        "(Icon_ppsh_selected, Icon_TommygunUS_selected)",
    "weapon-icon-absent-from-install":
        "the weapon names an icon that is in no menu.rfa of the mod chain",
    "viewmodel-clip-absent-from-install":
        "the first-person animation file the weapon names is in no archive "
        "(Binoculars' 1PFireBinoculars.baf)",
    "emplacement-no-seats-never-placed":
        "a weapon that rides on a host vehicle or aircraft (the `V`, `_Air`, "
        "`_unlimited` mounts): its seat is the host's",
    "air-no-seats-never-placed": "an aircraft no baked level places",
    "land-no-seats-never-placed": "a land vehicle no baked level places",
    "sea-no-seats-never-placed": "a ship part no baked level places",
    "texture-uniform-authored":
        "a flat texture the game itself names for the purpose (notexture, "
        "black_o, e_richo_white_I)",
    "engine-without-script":
        "no `loadSoundScript` anywhere in the install's objects archives binds "
        "an Engine of the vehicle: silent in retail (carriers, remote-control "
        "bombers, gliders)",
    "engine-script-unusable-in-install":
        "the script is not in the install, or `#include`s a file the mod never "
        "shipped (Zuikaku includes ZuikakuEngine from a folder holding "
        "ShokakuEngine): silent in retail",
    "weapon-script-unusable-in-install":
        "the gun's script, a file it includes, or every wav it plays is not in "
        "the install (coax1s.wav, jumplight.wav are in no archive)",
    "static-floating-authored":
        "the level script's own `Object.absolutePosition` puts the object "
        "there, and the engine places a static exactly as written (no snap to "
        "the terrain): a bridge deck over a gully, FH's raised coal corridor, "
        "an editor slip (Iwo's crate at y 253). The detail names the line",
    "spawn-floating-authored":
        "the level's ObjectSpawns.con puts the spawner there (a bridge deck); "
        "the detail names the line",
    "object-outside-world-authored":
        "placed past the world's edge by the level script itself",
    "object-outside-world-on-wrapped-terrain":
        "past the heightmap's edge, at a height within 2.5 m of the wrapped "
        "terrain: the level was dressed on the wrapped ground, and the "
        "viewer draws and collides that ground (d85a44f)",
    "object-stacked-duplicate":
        "the level script places the same template twice at one position "
        "(editor leftovers); retail draws both too, the pixels are identical",
    "report-materialsWithoutShader":
        "bullet_m1 / NULL_Mat0: the round's own placeholder mesh, baked hidden "
        "(bf42/verify.py: nothing draws it)",
    "uv-constant":
        "authored: every vertex of the part carries one UV, so retail samples "
        "one texel too (a canopy, a gun mount); the glb reproduces the source",
    "texture-absent-from-install":
        "the texture is not in any of the 1,541 .rfa archives of the install "
        "(every mod and level searched); retail draws these untextured too",
    "uv-nan-degenerate":
        "the source .sm carries NaN texture coordinates, only on triangles of "
        "zero area: nothing is drawn from them",
    "report-template-not-in-install":
        "the geometry or template the model asks for is not in any archive",
    "report-geometry-undeclared":
        "an `ObjectTemplate.geometry <name>` that no `GeometryTemplate.create` "
        "of the install declares (FH's 45mmATGun_carriage_M1 / _crank / _gun / "
        "_gun_base, He111's he111_fus2_m1, SU76_Turret_M1; every archive of "
        "every mod searched). `GeometryTemplateManager::getTemplate` "
        "`0x0838b1e0` returns null for a name with no template and no ':' and "
        "`SimpleObject::SimpleObject` ignores it (ledger LOD-4, GEO-1): the "
        "object is built with no geometry, so retail draws nothing there",
    "land-model-draws-nothing-geometry-undeclared":
        "every geometry the vehicle's tree names is undeclared, so retail "
        "draws nothing for it either (FH's 45mmATGun; ledger GEO-1)",
    "air-model-draws-nothing-geometry-undeclared":
        "as land-model-draws-nothing-geometry-undeclared",
    "sea-model-draws-nothing-geometry-undeclared":
        "as land-model-draws-nothing-geometry-undeclared",
    "emplacement-model-draws-nothing-geometry-undeclared":
        "as land-model-draws-nothing-geometry-undeclared",
}


@dataclass
class Finding:
    audit: str
    cause: str
    subject: str
    detail: str = ""
    level: str = ""
    # scene-space (x, y, z) of the object a placement finding is about, so a
    # later pass can look the same position up in the level's own script
    pos: tuple | None = None

    def key(self):
        return (self.audit, self.cause)


@dataclass
class Tree:
    mod_id: str
    models: Path
    maps: Path
    textures: Path
    levels: list[str] = field(default_factory=list)

    @staticmethod
    def locate(mod_id: str) -> "Tree":
        mod_id = mod_id.lower()
        if mod_id == "bf1942":
            models, maps = VIEWER / "models", VIEWER / "maps"
            levels = sorted(p.name for p in maps.iterdir()
                            if (p / "scene.json").is_file())
        else:
            models = VIEWER / "models" / "mods" / mod_id
            maps = VIEWER / "maps" / "mods" / mod_id
            levels = sorted(p.name for p in maps.iterdir()
                            if p.is_dir() and (p / "scene.json").is_file()) \
                if maps.is_dir() else []
        if not models.is_dir():
            raise SystemExit(f"no model tree at {models}")
        return Tree(mod_id, models, maps, VIEWER / "textures", levels)


# ---------------------------------------------------------------------------
# glb reading
# ---------------------------------------------------------------------------

def read_glb(path: Path, with_bin: bool = False):
    """`(json, bin or None)` of a .glb; only the JSON chunk unless asked."""
    with open(path, "rb") as f:
        head = f.read(12)
        if len(head) < 12 or head[:4] != b"glTF":
            raise ValueError("not a glb")
        n, kind = struct.unpack("<II", f.read(8))
        doc = json.loads(f.read(n))
        blob = None
        if with_bin:
            rest = f.read(8)
            if len(rest) == 8:
                bn, _bk = struct.unpack("<II", rest)
                blob = f.read(bn)
    return doc, blob


def walk_files(root: Path, suffix: str):
    # vanilla's tree has the mods' trees as subdirectories (`models/mods/`)
    skip_mods = root == VIEWER / "models"
    for dirpath, dirs, files in os.walk(root, followlinks=False):
        if skip_mods and Path(dirpath) == root and "mods" in dirs:
            dirs.remove("mods")
        for name in files:
            if name.endswith(suffix):
                yield Path(dirpath) / name


def glb_files(tree: Tree):
    """Every glb the tree publishes: models (incl. kits, viewmodels, poses),
    level scenes and the shared effects."""
    seen = []
    for p in walk_files(tree.models, ".glb"):
        seen.append(p)
    if tree.maps.is_dir():
        for p in sorted(tree.maps.glob("*/scene.glb")):
            seen.append(p)
        eff = tree.maps / "_shared" / "effects.glb"
        if eff.is_file():
            seen.append(eff)
    return sorted(seen)


def _accessor_floats(doc, blob, idx, width):
    acc = doc["accessors"][idx]
    if acc.get("componentType") != 5126:
        return None
    view = doc["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", 4 * width)
    fmt = "<" + "f" * width
    out = []
    for i in range(acc["count"]):
        o = base + i * stride
        if o + 4 * width > len(blob):
            return None
        out.append(struct.unpack_from(fmt, blob, o))
    return out


def _accessor_indices(doc, blob, idx):
    acc = doc["accessors"][idx]
    view = doc["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    fmt = {5121: "B", 5123: "H", 5125: "I"}.get(acc.get("componentType"))
    if fmt is None:
        return None
    size = struct.calcsize(fmt)
    return [struct.unpack_from("<" + fmt, blob, base + i * size)[0]
            for i in range(acc["count"])]


def uv_degenerate(doc: dict, blob: bytes | None, prim: dict) -> str | None:
    """Why a textured primitive's UVs cannot sample its texture, or None.

    `"nan-visible"`: a NaN UV on a vertex some triangle of non-zero area
    uses. `"nan-degenerate"`: NaNs only on triangles with no area (the source
    meshes carry these; nothing is drawn from them). `"constant"`: every
    sampled UV identical, so the whole part is one texel. `"none"`: no UVs.
    """
    if blob is None:
        return None
    idx = prim.get("attributes", {}).get("TEXCOORD_0")
    if idx is None:
        return "none"
    acc = doc["accessors"][idx]
    if acc.get("componentType") != 5126 or acc.get("type") != "VEC2":
        return None
    view = doc["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", 8)
    count = acc["count"]
    step = max(1, count // 512)
    sample = []
    for i in range(0, count, step):
        o = base + i * stride
        if o + 8 > len(blob):
            return None
        sample.append(struct.unpack_from("<ff", blob, o))
    if len(sample) > 3 and len(set(sample)) == 1:
        return "constant"
    uv = _accessor_floats(doc, blob, idx, 2)
    if uv is None:
        return None
    bad = {i for i, (u, v) in enumerate(uv) if math.isnan(u) or math.isnan(v)}
    if not bad:
        return None
    pos = _accessor_floats(doc, blob, prim["attributes"]["POSITION"], 3)
    ind = _accessor_indices(doc, blob, prim["indices"]) if "indices" in prim else None
    if pos is None or ind is None or prim.get("mode", 4) != 4:
        return "nan-visible"
    for t in range(0, len(ind) - 2, 3):
        a, b, c = ind[t], ind[t + 1], ind[t + 2]
        if a in bad or b in bad or c in bad:
            pa, pb, pc = pos[a], pos[b], pos[c]
            ux, uy, uz = pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]
            vx, vy, vz = pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]
            cx, cy, cz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            if cx * cx + cy * cy + cz * cz > 1e-10:
                return "nan-visible"
    return "nan-degenerate"


@dataclass
class MaterialUse:
    glb: str
    path: Path
    material: str
    untextured: bool
    factor: tuple
    image: str | None
    prims: int
    mode: str = "OPAQUE"


def summarise_glb(path: Path, check_uv: bool = True):
    """What the textures audit needs from one glb."""
    doc, blob = read_glb(path, with_bin=check_uv)
    mats = doc.get("materials", [])
    textures = doc.get("textures", [])
    images = doc.get("images", [])
    uses: dict[int, int] = collections.Counter()
    collision_only: set[int] = set()
    drawn: set[int] = set()
    bad_uv: list[tuple[str, str]] = []
    dangling: list[int] = []
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            m = prim.get("material")
            if m is None:
                continue
            if (prim.get("extras") or {}).get("collision"):
                collision_only.add(m)
                continue
            if m >= len(mats):
                dangling.append(m)
                continue
            drawn.add(m)
            uses[m] += 1
            mat = mats[m]
            if "baseColorTexture" in mat.get("pbrMetallicRoughness", {}) and check_uv:
                why = uv_degenerate(doc, blob, prim)
                if why:
                    bad_uv.append((mat.get("name", f"#{m}"), why))
    out_mats = []
    for m in sorted(drawn):
        mat = mats[m]
        pbr = mat.get("pbrMetallicRoughness", {})
        tex = pbr.get("baseColorTexture")
        image = None
        if tex is not None:
            t = textures[tex["index"]]
            src = t.get("source")
            if src is None:
                src = (t.get("extensions", {}).get("EXT_texture_webp", {})
                       .get("source"))
            if src is not None and src < len(images):
                image = images[src].get("uri")
        out_mats.append(MaterialUse(
            path.name, path, mat.get("name", f"#{m}"), tex is None,
            tuple(pbr.get("baseColorFactor", (1, 1, 1, 1))), image, uses[m],
            mat.get("alphaMode", "OPAQUE")))
    if dangling:
        bad_uv.append((f"{len(dangling)} primitive(s) -> material {dangling[0]} of "
                       f"{len(mats)}", "dangling-material"))
    return out_mats, bad_uv, [(im.get("uri"), im.get("name", "")) for im in images]


# ---------------------------------------------------------------------------
# game archives (optional)
# ---------------------------------------------------------------------------

class Game:
    """The chain's pools, loaded lazily; None attributes when absent."""

    def __init__(self, mod_name: str):
        self.ok = False
        self.mod = mod_name
        if not mod_name:
            return
        try:
            from extract_models import DEFAULT_GAME_DIR, build_pools, mod_chain
            if not DEFAULT_GAME_DIR.is_dir():
                return
            self.game_dir = DEFAULT_GAME_DIR
            self.chain = mod_chain(DEFAULT_GAME_DIR, mod_name)
            (self.meshes, self.textures, self.objects,
             self.game) = build_pools(self.chain, [])
            self.ok = True
        except Exception as exc:  # no install: the glb-only audits still run
            self.error = str(exc)

    def menu_basenames(self) -> set[str]:
        """Lower-cased stems of every texture in the chain's menu archives."""
        if not hasattr(self, "_menu"):
            from bf42.rfa import RfaArchive, find_archives_dir
            names: set[str] = set()
            for mod_dir in self.chain:
                ad = find_archives_dir(mod_dir)
                if ad is None:
                    continue
                for f in ad.iterdir():
                    if f.suffix.lower() == ".rfa" and f.name.lower().startswith("menu"):
                        try:
                            arc = RfaArchive(f)
                        except Exception:
                            continue
                        for nm in (getattr(arc, "entries", None) or arc.names()):
                            names.add(nm.lower().replace("\\", "/")
                                      .rsplit("/", 1)[-1].rsplit(".", 1)[0])
            self._menu = names
        return self._menu

    def level_archive(self, level_dir_name: str):
        """The RfaArchive of a level of the chain, by its directory name."""
        from bf42.rfa import RfaArchive, find_archives_dir, find_levels_dir
        want = level_dir_name.lower()
        for mod_dir in self.chain:
            ad = find_archives_dir(mod_dir)
            ld = find_levels_dir(ad) if ad else None
            if ld is None:
                continue
            for f in ld.iterdir():
                if f.suffix.lower() == ".rfa" and f.stem.lower() == want:
                    return RfaArchive(f)
        return None

    def library(self):
        if not hasattr(self, "_library"):
            from extract_models import build_library
            self._library = build_library(self.objects)
        return self._library


def resolve_mod_name(mod_id: str) -> str:
    try:
        from extract_models import DEFAULT_GAME_DIR
        mods = DEFAULT_GAME_DIR / "Mods"
        for child in mods.iterdir():
            if child.name.lower() == mod_id.lower():
                return child.name
    except Exception:
        pass
    return mod_id


# ---------------------------------------------------------------------------
# audit 1: textures
# ---------------------------------------------------------------------------

REPORT_LISTS = ("texturesNotFound", "missingMeshFiles",
                "missingGeometryTemplates", "unresolvedTemplates",
                "materialsWithoutShader")

TEXTURE_LINE = re.compile(r"^[ \t]*texture\b[^\n]*", re.IGNORECASE | re.MULTILINE)


_cutout_cache: dict[str, bool] = {}


def has_cutout(path: Path) -> bool:
    """True when the texture has a texel of alpha 0."""
    key = str(path)
    if key not in _cutout_cache:
        try:
            from PIL import Image
            im = Image.open(path)
            if im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info:
                lo, _hi = im.convert("RGBA").getchannel("A").getextrema()
                _cutout_cache[key] = lo == 0
            else:
                _cutout_cache[key] = False
        except Exception:
            _cutout_cache[key] = False
    return _cutout_cache[key]


def classify_image(path: Path):
    """`(kind, detail)` for one texture file, or None when it is fine."""
    try:
        from PIL import Image, ImageStat
    except ImportError:
        return None
    if not path.is_file():
        return ("texture-file-missing", "")
    if path.stat().st_size == 0:
        return ("texture-file-empty", "")
    try:
        im = Image.open(path)
        im.load()
    except Exception as exc:
        return ("texture-undecodable", str(exc)[:60])
    w, h = im.size
    if w <= 1 and h <= 1:
        return ("texture-1x1", f"{w}x{h}")
    rgba = im.convert("RGBA")
    stat = ImageStat.Stat(rgba)
    mean, dev = stat.mean, stat.stddev
    opaque = dev[3] < 0.5 and mean[3] > 250
    if all(d < 1.5 for d in dev[:3]):
        r, g, b = mean[:3]
        if opaque and min(r, g, b) > 245:
            return ("texture-opaque-white", f"{w}x{h}")
        if opaque and r > 230 and b > 230 and g < 30:
            return ("texture-magenta", f"{w}x{h}")
        if opaque and max(r, g, b) < 4:
            return ("texture-opaque-black", f"{w}x{h}")
    return None


def audit_textures(tree: Tree, game: Game, ctx: dict) -> list[Finding]:
    out: list[Finding] = []
    files = glb_files(tree)
    ctx["glb_count"] = len(files)
    image_users: dict[str, set[str]] = collections.defaultdict(set)
    image_names: dict[str, str] = {}
    opaque_users: dict[str, set[str]] = collections.defaultdict(set)
    untextured: list[MaterialUse] = []
    for path in files:
        rel = str(path.relative_to(VIEWER))
        try:
            mats, bad_uv, images = summarise_glb(path)
        except Exception as exc:
            out.append(Finding("textures", "glb-unreadable", rel, str(exc)[:80]))
            continue
        for uri, nm in images:
            if uri:
                image_names.setdefault(uri, nm)
        for m in mats:
            if m.image:
                image_users[m.image].add(path.name)
                if m.mode == "OPAQUE":
                    opaque_users[m.image].add(path.name)
            if m.untextured:
                untextured.append(m)
        for name, why in bad_uv:
            cause = ("primitive-material-index-out-of-range"
                     if why == "dangling-material" else f"uv-{why}")
            out.append(Finding("textures", cause, path.name, name))

    # texture files
    cache: dict[str, tuple | None] = {}
    for uri, users in sorted(image_users.items()):
        target = (VIEWER / "models" / "mods" / tree.mod_id / uri).resolve() \
            if False else None
        # URIs are relative to the glb that holds them; they all end in
        # `textures/xx/<hash>.webp`, one shared store.
        tail = "/".join(uri.split("/")[-3:])
        target = VIEWER / tail
        res = classify_image(target)
        if res:
            kind, detail = res
            base = image_names.get(uri, "").lower().replace("\\", "/").rsplit("/", 1)[-1]
            if any(a in base for a in AUTHORED_UNIFORM):
                kind = "texture-uniform-authored"
            detail = f"{image_names.get(uri, '')} {detail}"
            out.append(Finding("textures", kind, tail,
                               f"{detail}; used by {len(users)} glb: "
                               + ", ".join(sorted(users)[:4])))
    ctx["texture_files"] = len(image_users)

    # an opaque material whose texture carries texels of alpha 0: the engine
    # alpha-tests every draw (ENGINE_ALPHA_FLOOR in bf42/assemble.py), so the
    # glb must be MASK or the DXT block colour under the cut-out draws as a
    # solid shape (the red square where FH's N1K1 reticle should be)
    for uri, users in sorted(opaque_users.items()):
        if has_cutout(VIEWER / "/".join(uri.split("/")[-3:])):
            out.append(Finding(
                "textures", "opaque-material-cutout-texture",
                image_names.get(uri, uri),
                f"{len(users)} glb: " + ", ".join(sorted(users)[:4])))

    # reports
    agg: dict[tuple[str, str], set[str]] = collections.defaultdict(set)
    report_paths = list(walk_files(tree.models, ".report.json"))
    for p in report_paths:
        try:
            r = json.load(open(p))
        except Exception:
            continue
        for key in REPORT_LISTS:
            for item in r.get(key) or []:
                agg[(key, item if isinstance(item, str) else json.dumps(item))] \
                    .add(p.name[:-len(".report.json")])
    for lv in tree.levels:
        try:
            sc = json.load(open(tree.maps / lv / "scene.json"))
        except Exception:
            continue
        obj = sc.get("objects", {})
        for t in obj.get("texturesMissing", []) or []:
            agg[("texturesNotFound", t)].add("level:" + lv)
        for t in obj.get("unresolvedTemplates", []) or []:
            agg[("unresolvedTemplates", t)].add("level:" + lv)
        for t in obj.get("missingMeshes", []) or []:
            agg[("missingMeshFiles", t)].add("level:" + lv)

    # decide what the install holds, when we can
    absent: dict[str, bool] = {}
    if game.ok:
        for (key, item), _users in agg.items():
            if key == "texturesNotFound":
                absent[item] = not _install_has_texture(game, item)
    for (key, item), users in sorted(agg.items(), key=lambda kv: -len(kv[1])):
        if key == "texturesNotFound":
            if not game.ok:
                cause = "texture-not-found"
            elif absent.get(item, True):
                cause = "texture-absent-from-install"
            else:
                cause = "texture-in-install-but-unresolved"
        elif key in ("missingGeometryTemplates", "unresolvedTemplates",
                     "missingMeshFiles"):
            if key == "missingMeshFiles" and game.ok:
                have = bool(game.meshes.resolve_ext(item.lower(), (".sm",)))
            else:
                have = game.ok and _install_has_object(game, item)
            cause = ("report-template-in-install-but-unresolved" if have
                     else "report-template-not-in-install")
            if key == "missingGeometryTemplates" and game.ok \
                    and _geometry_undeclared(game, item):
                # An object template of the same name does not help: the
                # engine looks the geometry up in the GeometryTemplate manager.
                cause = "report-geometry-undeclared"
        else:
            cause = "report-" + key
        out.append(Finding("textures", cause, item,
                           f"{len(users)} model(s): " + ", ".join(sorted(users)[:5])))

    # untextured drawn materials. Shader names are not unique across `.rs`
    # files (`wreck_cub_Material0` is in wreck_cub.rs and wreck_pipercub.rs),
    # so the model's own report is asked first: it names what that one
    # extraction failed to find.
    shader_map = _shader_map(game) if game.ok else {}
    level_missing: dict[str, list[str]] = {}
    for lv in tree.levels:
        try:
            level_missing[lv] = json.load(open(tree.maps / lv / "scene.json")) \
                .get("objects", {}).get("texturesMissing", []) or []
        except Exception:
            pass
    groups: dict[tuple[str, str], list[MaterialUse]] = collections.defaultdict(list)
    for m in untextured:
        owner = m.path
        missing: list[str] = []
        if owner.name == "scene.glb":
            missing = level_missing.get(owner.parent.name, [])
        else:
            rp = owner.with_name(owner.name[:-4] + ".report.json")
            if rp.is_file():
                try:
                    missing = json.load(open(rp)).get("texturesNotFound", []) or []
                except Exception:
                    missing = []
        sh = None
        if game.ok:
            key = m.material.lower()
            sh = shader_map.get(key)
            if sh is None and "_material" in key:
                sh = shader_map.get(key[key.rindex("_material") + 1:])
        if missing and (sh is None or sh[2]):
            absent_refs = [t for t in missing if not game.ok
                           or not _install_has_texture(game, t)]
            if absent_refs or not game.ok:
                cause, what = "untextured-texture-absent-from-install", \
                    ",".join(sorted(missing)[:3])
            else:
                cause, what = "untextured-texture-in-install-but-unresolved", \
                    ",".join(sorted(missing)[:3])
        elif re.match(r"^(material|mat)[ _]?#?\d+$", m.material, re.IGNORECASE):
            # many `.rs` files name a shader `Material #2`: the glb does not
            # say which one made this material, so it cannot be attributed
            cause, what = "untextured-generic-material-name", m.material
        elif sh is None:
            if m.material.lower() == "water":
                continue  # the water plane is drawn by the water shader
            cause, what = ("untextured-shader-not-found" if game.ok
                           else "untextured-material"), m.material
        elif not sh[0]:
            cause, what = "untextured-rs-declares-no-texture", sh[1]
        elif any(not _install_has_texture(game, t) for t in sh[0]):
            cause, what = "untextured-texture-absent-from-install", ",".join(sh[0])
        else:
            cause, what = "untextured-texture-in-install-but-unresolved", ",".join(sh[0])
        groups[(cause, what)].append(m)
    for (cause, what), ms in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        glbs = sorted({m.glb for m in ms})
        out.append(Finding("textures", cause, what,
                           f"{len(ms)} material(s) in {len(glbs)} glb: "
                           + ", ".join(glbs[:5])))

    if game.ok:
        out.extend(rs_source_scan(game))
    return out


def _install_has_texture(game: Game, ref: str) -> bool:
    ref = ref.split(" (")[0]
    return bool(game.textures.resolve_ext(ref, (".dds", ".tga")))


def _install_has_object(game: Game, name: str) -> bool:
    lib = game.library()
    if lib.objects.get(name.lower()) is not None:
        return True
    if lib.geometry(name) is not None:
        return True
    return False


def _geometry_undeclared(game: Game, name: str) -> bool:
    """True when no GeometryTemplate of the chain answers to `name`.

    The engine's lookup is a case-blind map on the template name and, for a
    `Type:File` name, a template made on the spot (SM-14). A name that is
    neither is null, with no fallback to a mesh file or to an object template
    of that name (`getTemplate` 0x0838b1e0, GEO-1).
    """
    return game.library().geometry(name) is None


def _shader_map(game: Game) -> dict[str, tuple[list[str], str, bool]]:
    """shader name (lower) -> (parsed textures, source .rs)."""
    cached = getattr(game, "_shaders", None)
    if cached is not None:
        return cached
    from bf42 import rs
    out: dict[str, tuple[list[str], str, bool]] = {}
    for pool in (game.meshes, game.objects):
        for name in pool.names():
            if not name.lower().endswith(".rs"):
                continue
            try:
                parsed = rs.parse(pool.read(name).decode("latin-1"))
            except Exception:
                continue
            for key, sh in parsed.items():
                prev = out.get(key)
                if prev is None:
                    out[key] = (list(sh.textures), name, False)
                elif prev[0] != list(sh.textures):
                    out[key] = (prev[0], prev[1], True)
    game._shaders = out
    return out


def rs_source_scan(game: Game) -> list[Finding]:
    """Texture lines in `.rs` files that the reader does not parse: a shader
    the game textures but the glb draws flat white."""
    from bf42 import rs
    out = []
    for pool in (game.meshes, game.objects):
        for name in pool.names():
            if not name.lower().endswith(".rs"):
                continue
            text = pool.read(name).decode("latin-1")
            for m in TEXTURE_LINE.finditer(text):
                line = m.group(0).strip()
                if re.match(r"texture(Fade|[A-Za-z_])", line, re.IGNORECASE):
                    continue
                if not rs._TEXTURE.search(line):
                    out.append(Finding("textures", "rs-texture-line-unparsed",
                                       name, line[:80]))
    return out


# ---------------------------------------------------------------------------
# audit 2: placement
# ---------------------------------------------------------------------------

def level_heightfield(level_dir: Path):
    from PIL import Image
    sc = json.load(open(level_dir / "scene.json"))
    hm = sc.get("heightmap")
    if not hm:
        return sc, None
    im = Image.open(level_dir / hm["image"]).convert("RGB")
    dim, sp, hu = hm["dim"], hm["spacing"], hm["heightUnits"]
    data = im.tobytes()
    heights = array.array("f", [0.0]) * (dim * dim)
    for i in range(dim * dim):
        heights[i] = ((data[i * 3] << 8) | data[i * 3 + 1]) / 65535 * hu

    def at(x: float, z: float) -> float:
        fx, fz = x / sp, -z / sp
        ix, iz = math.floor(fx), math.floor(fz)
        ax, az = fx - ix, fz - iz

        def g(i, j):
            return heights[(j % dim) * dim + (i % dim)]
        return (g(ix, iz) * (1 - ax) * (1 - az) + g(ix + 1, iz) * ax * (1 - az)
                + g(ix, iz + 1) * (1 - ax) * az + g(ix + 1, iz + 1) * ax * az)
    return sc, at


def _quat_rotate(q, v):
    x, y, z, w = q
    # v' = v + 2w(q x v) + 2 q x (q x v)
    cx = y * v[2] - z * v[1]
    cy = z * v[0] - x * v[2]
    cz = x * v[1] - y * v[0]
    dx = y * cz - z * cy
    dy = z * cx - x * cz
    dz = x * cy - y * cx
    return (v[0] + 2 * (w * cx + dx), v[1] + 2 * (w * cy + dy),
            v[2] + 2 * (w * cz + dz))


def placed_boxes(doc: dict):
    """World AABB (x0,y0,z0,x1,y1,z1) and name of each root object of a scene,
    from the POSITION accessor bounds under its subtree. Translation and
    rotation only (scale is 1 in these scenes)."""
    nodes, meshes, acc = doc["nodes"], doc["meshes"], doc["accessors"]

    def mesh_bounds(mi):
        lo = [math.inf] * 3
        hi = [-math.inf] * 3
        for prim in meshes[mi]["primitives"]:
            if (prim.get("extras") or {}).get("collision"):
                continue
            a = acc[prim["attributes"]["POSITION"]]
            if "min" not in a:
                continue
            for k in range(3):
                lo[k] = min(lo[k], a["min"][k])
                hi[k] = max(hi[k], a["max"][k])
        return None if lo[0] == math.inf else (lo, hi)

    def collect(ni, origin, rot, pts):
        n = nodes[ni]
        t = n.get("translation", (0, 0, 0))
        q = n.get("rotation", (0, 0, 0, 1))
        off = _quat_rotate(rot, t)
        o = (origin[0] + off[0], origin[1] + off[1], origin[2] + off[2])
        r = _qmul(rot, q)
        if "mesh" in n:
            b = mesh_bounds(n["mesh"])
            if b:
                lo, hi = b
                for sx in (0, 1):
                    for sy in (0, 1):
                        for sz in (0, 1):
                            c = (hi[0] if sx else lo[0], hi[1] if sy else lo[1],
                                 hi[2] if sz else lo[2])
                            w = _quat_rotate(r, c)
                            pts.append((o[0] + w[0], o[1] + w[1], o[2] + w[2]))
        for c in n.get("children", ()):
            collect(c, o, r, pts)

    out = []
    for ri in doc["scenes"][0]["nodes"]:
        n = nodes[ri]
        ex = n.get("extras") or {}
        if not ex.get("templateKind") or "translation" not in n:
            continue
        pts: list = []
        collect(ri, (0.0, 0.0, 0.0), (0, 0, 0, 1), pts)
        t = n["translation"]
        if pts:
            # collect() applied the root's own transform already
            xs, ys, zs = zip(*pts)
            box = (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))
        else:
            box = (t[0], t[1], t[2], t[0], t[1], t[2])
        out.append((n["name"], tuple(t), box, ex.get("templateKind")))
    return out


def _qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


# Levels place these on top of other things on purpose (a gun in a bunker,
# an aircraft on a carrier): a spawn that is above the ground is fine when
# an object's box holds it up. These are the margins of that test.
SUPPORT_SLACK = 2.0
FLOAT_METRES = 3.0
STATIC_FLOAT_METRES = 6.0
BURY_METRES = 1.5


_ABS_POS = re.compile(r"absolutePosition\s+([-\d.eE+]+)/([-\d.eE+]+)/([-\d.eE+]+)", re.I)


def authored_positions(arc) -> dict:
    """(x, -z) rounded to 0.1 m -> (x, y, 'file:line') for every
    `Object.absolutePosition` in a level archive's scripts (commented-out
    `rem` lines excluded). Scene z is the script's z negated."""
    out: dict = {}
    for en in arc.entries:
        if not en.lower().endswith(".con"):
            continue
        try:
            text = arc.read(en).decode("latin1")
        except Exception:
            continue
        short = en.split("/levels/")[-1]
        short = short.split("/", 1)[-1] if "/" in short else short
        for i, line in enumerate(text.splitlines(), 1):
            st = line.strip()
            if st[:3].lower() == "rem":
                continue
            m = _ABS_POS.search(st)
            if m:
                x, y, z = (float(v) for v in m.groups())
                out.setdefault((round(x, 1), round(z, 1)), (x, y, f"{short}:{i}"))
    return out


def audit_placement(tree: Tree, game: Game, ctx: dict) -> list[Finding]:
    out: list[Finding] = []
    models = {}
    mp = tree.models / "models.json"
    if mp.is_file():
        for e in json.load(open(mp)):
            models[e["name"].lower()] = e
    n_checked = 0
    for lv in tree.levels:
        ldir = tree.maps / lv
        try:
            sc, at = level_heightfield(ldir)
            doc, _ = read_glb(ldir / "scene.glb")
        except Exception as exc:
            out.append(Finding("placement", "level-unreadable", lv, str(exc)[:80], lv))
            continue
        if at is None:
            out.append(Finding("placement", "no-heightmap", lv, "", lv))
            continue
        water = sc.get("waterLevel", -1e9)
        boxes = placed_boxes(doc)
        world = sc.get("worldSize", 2048.0)

        # placed objects
        floaters: list = []
        seen: dict[tuple, str] = {}
        for name, t, box, kind in boxes:
            n_checked += 1
            x, y, z = t
            if abs(x) < 0.01 and abs(y) < 0.01 and abs(z) < 0.01:
                out.append(Finding("placement", "object-at-origin", name, "", lv))
            if not (-1 <= x <= world + 1 and -world - 1 <= z <= 1):
                out.append(Finding("placement", "object-outside-world", name,
                                   f"({x:.0f},{y:.0f},{z:.0f})", lv, (x, y, z)))
            key = (name.lower(), round(x, 2), round(y, 2), round(z, 2))
            if key in seen:
                out.append(Finding("placement", "object-stacked-duplicate", name,
                                   f"two at ({x:.1f},{y:.1f},{z:.1f})", lv))
            seen[key] = name
            bottom = box[1]
            # the highest ground under the footprint: a bunker built into a
            # slope is not floating because its centre is on the low side
            gmax = max(at(box[0] + (box[3] - box[0]) * i / 4,
                          box[2] + (box[5] - box[2]) * j / 4)
                       for i in range(5) for j in range(5))
            floaters.append((name, x, z, bottom - gmax, box))

        def supported(x, y, z):
            for name, _t, b, _k in boxes:
                if b[0] - 1 <= x <= b[3] + 1 and b[2] - 1 <= z <= b[5] + 1 \
                        and b[4] >= y - SUPPORT_SLACK and b[1] <= y + SUPPORT_SLACK:
                    return name
            return None

        for name, x, z, gap, box in floaters:
            if gap <= STATIC_FLOAT_METRES:
                continue
            if box[1] - gap < water and box[1] - water < 30.0:
                continue  # over open water, low: on a ship the scene lacks
            under = None
            for oname, _t, b, _k in boxes:
                if oname is name:
                    continue
                if b[0] <= (box[0] + box[3]) / 2 <= b[3] and \
                        b[2] <= (box[2] + box[5]) / 2 <= b[5] and \
                        b[4] >= box[1] - SUPPORT_SLACK and b[1] < box[1]:
                    under = oname
                    break
            if under is None:
                out.append(Finding("placement", "static-floating", name,
                                   f"lowest point {gap:.1f} m above the highest "
                                   f"ground under it at ({x:.0f},{z:.0f})", lv,
                                   (x, box[1], z)))

        # spawners and spawn points
        spawn_rows = [("vehicle", s) for s in sc.get("objectSpawns", [])]
        for kind, s in spawn_rows:
            tmpl = s.get("vehicle") or s.get("spawner")
            n_checked += 1
            x, y, z = s["position"]
            cat = (models.get((tmpl or "").lower()) or {}).get("category")
            if abs(x) < 0.01 and abs(z) < 0.01:
                if cat is not None:
                    out.append(Finding("placement", "spawn-at-origin", tmpl, "", lv))
                continue
            if cat in ("sea",):
                if y < water - 1 or y > water + 15:
                    out.append(Finding("placement", "ship-off-waterline", tmpl,
                                       f"y {y:.1f}, water {water:.1f}", lv))
                continue
            if cat == "air":
                continue
            g = at(x, z)
            if g < water and y < water + 3:
                continue  # afloat or wading, the sea floor is below it
            dy = y - g
            if dy > FLOAT_METRES and not supported(x, y, z):
                out.append(Finding("placement", "spawn-floating", tmpl,
                                   f"{dy:.1f} m above ground at ({x:.0f},{z:.0f}) "
                                   f"cp {s.get('controlPointName')}", lv, (x, y, z)))
            if dy < -BURY_METRES and cat not in (None,):
                out.append(Finding("placement", "spawn-buried", tmpl,
                                   f"{-dy:.1f} m below ground at ({x:.0f},{z:.0f})", lv))
            elif dy < -BURY_METRES and cat is None and dy < -8:
                out.append(Finding("placement", "marker-below-ground", tmpl,
                                   f"{-dy:.1f} m below ground at ({x:.0f},{z:.0f})", lv))
        for s in sc.get("soldierSpawns", []):
            n_checked += 1
            x, y, z = s["position"]
            g = at(x, z)
            if g < water:
                continue
            dy = y - g
            if dy > 6 and not supported(x, y, z):
                out.append(Finding("placement", "soldier-spawn-floating", s["name"],
                                   f"{dy:.1f} m above ground at ({x:.0f},{z:.0f})", lv))
            if dy < -3:
                out.append(Finding("placement", "soldier-spawn-buried", s["name"],
                                   f"{-dy:.1f} m below ground at ({x:.0f},{z:.0f})", lv))
        for c in sc.get("controlPoints", []):
            x, y, z = c["position"]
            g = at(x, z)
            if g >= water and (y - g > 10 and not supported(x, y, z)):
                out.append(Finding("placement", "control-point-floating", c["name"],
                                   f"{y - g:.1f} m above ground", lv))

        # Where the position is the level script's own, retail puts the object
        # there too: the engine honours `Object.absolutePosition` as written,
        # with no snap to the terrain. Say so with the script's line.
        mine = [f for f in out if f.level == lv and f.pos is not None and f.audit == "placement"
                and f.cause in ("static-floating", "object-outside-world", "spawn-floating")]
        if mine and game.ok:
            arc = game.level_archive(sc.get("level", lv))
            auth = authored_positions(arc) if arc is not None else {}
            for f in mine:
                x, y, z = f.pos
                src = next((auth[k] for dx in (0, 0.1, -0.1) for dz in (0, 0.1, -0.1)
                            if (k := (round(round(x, 1) + dx, 1),
                                       round(round(-z, 1) + dz, 1))) in auth), None)
                if src is None:
                    continue
                if f.cause == "object-outside-world":
                    # drawn past the heightmap's edge: the terrain wraps
                    # (d85a44f), and the authored height is the wrapped ground
                    off = abs(src[1] - at(x, z))
                    if off <= 2.5:
                        f.cause = "object-outside-world-on-wrapped-terrain"
                        f.detail += (f"; authored y {src[1]:.1f}, wrapped ground "
                                     f"{at(x, z):.1f} [{src[2]}]")
                        continue
                f.cause = f.cause + "-authored"
                f.detail += f"; authored y {src[1]:.1f} [{src[2]}]"
    ctx["placement_checked"] = n_checked
    return out


# ---------------------------------------------------------------------------
# audit 3: sound
# ---------------------------------------------------------------------------

def audit_sound(tree: Tree, game: Game, ctx: dict) -> list[Finding]:
    out: list[Finding] = []
    table_path = tree.maps / "_shared" / "vehicle-sounds.json"
    table = {}
    if table_path.is_file():
        for v in json.load(open(table_path)).get("vehicles", []):
            table[v["template"].lower()] = v
    shared = tree.maps / "_shared"

    def check_layers(owner, layers, where):
        for ly in layers or []:
            f = ly.get("file")
            if not f:
                continue
            p = (tree.maps / "x" / f)  # level-relative: ../_shared/sounds/a.mp3
            p = Path(os.path.normpath(str(p)))
            if not p.is_file():
                out.append(Finding("sound", "layer-file-missing", owner,
                                   f"{where}: {f}"))

    for v in table.values():
        check_layers(v["template"], v.get("layers"), "engine")
        for w in v.get("weapons", []):
            check_layers(v["template"], w.get("layers"), "weapon " + str(w.get("fireArms")))
    for lv in tree.levels:
        try:
            sc = json.load(open(tree.maps / lv / "scene.json"))
        except Exception:
            continue
        for v in sc.get("sounds", {}).get("vehicles", []) or []:
            for ly in v.get("layers") or []:
                f = ly.get("file")
                if f and not Path(os.path.normpath(str(tree.maps / lv / f))).is_file():
                    out.append(Finding("sound", "layer-file-missing", v["template"],
                                       f"engine {f}", lv))
            for w in v.get("weapons", []):
                for ly in w.get("layers") or []:
                    f = ly.get("file")
                    if f and not Path(os.path.normpath(str(tree.maps / lv / f))).is_file():
                        out.append(Finding("sound", "layer-file-missing", v["template"],
                                           f"weapon {f}", lv))
        for key in ("ambient",):
            a = sc.get("sounds", {}).get(key)
            if a and a.get("file") and \
                    not Path(os.path.normpath(str(tree.maps / lv / a["file"]))).is_file():
                out.append(Finding("sound", "ambient-file-missing", a["file"], "", lv))
        for a in sc.get("sounds", {}).get("areas", []) or []:
            f = a.get("file")
            if f and not Path(os.path.normpath(str(tree.maps / lv / f))).is_file():
                out.append(Finding("sound", "area-file-missing", f, a.get("name", ""), lv))

    if not game.ok:
        ctx["sound_note"] = "game archives absent: engine/weapon walk skipped"
        return out
    import extract_map as em
    from bf42.level import parse_sound_scripts
    import extract_vehicle_sounds as evs
    from extract_models import discover_levels, spawned_templates
    lib = game.library()
    spawned = spawned_templates(discover_levels(game.chain))
    templates = evs.vehicle_templates(game.objects, lib, spawned)
    # templates the baked levels place (level-own ones are not in the library)
    level_templates: set[str] = set()
    for lv in tree.levels:
        try:
            sc = json.load(open(tree.maps / lv / "scene.json"))
        except Exception:
            continue
        for s in sc.get("objectSpawns", []):
            if s.get("vehicle"):
                level_templates.add(s["vehicle"])
    names = {t.lower(): t for t in templates}
    for t in level_templates:
        if lib.objects.get(t.lower()) is not None:
            names.setdefault(t.lower(), t)
    ctx["sound_templates"] = len(names)

    # independent oracle: every sound script bound anywhere in the install's
    # objects archives, by (kind, template name), read straight off the .con
    # files rather than through the template tree the extractor walks.
    bound_anywhere: dict[tuple[str, str], list[tuple[str, str]]] = \
        collections.defaultdict(list)
    for n in game.objects.names():
        if not n.lower().endswith(".con"):
            continue
        try:
            text = game.objects.read(n).decode("latin-1")
        except Exception:
            continue
        if "loadsoundscript" not in text.lower():
            continue
        for nm, (kind, path) in parse_sound_scripts(text).items():
            bound_anywhere[(kind, nm)].append((n, em.resolve_ssc_path(n, path)))

    sounds = evs.load_sources(game.game_dir, game.mod).sounds

    def read_script(path):
        hit = game.objects.find(path)
        return game.objects.read(hit).decode("latin-1") if hit else None

    def script_state(path: str, firing: bool = False, engine: bool = False) -> str:
        """absent | no-patch | silent | samples-missing | ok"""
        text = read_script(path)
        if text is None:
            return "absent"
        from bf42.level import parse_ssc
        patches = parse_ssc(text, level=em.VEHICLE_SOUND_LEVEL,
                            include=read_script, source=path)
        samples = [sm for p in patches for sm in p.samples]
        if engine:
            # an Engine is a single-patch object: only patch 0 plays
            samples = list(patches[0].samples) if patches else []
        if firing and samples:
            samples = list(em._firing_patch(patches, release=False)) or samples
        if not samples:
            return "no-patch"
        real = [sm for sm in samples
                if "silence" not in str(sm.file).lower()]
        if not real:
            return "silent"
        if not any(em.resolve_sound(sm.file, None, sounds) for sm in real):
            return "samples-absent"
        return "ok"

    def tree_nodes(root):
        seen, queue, nodes = set(), [root], []
        while queue:
            node = queue.pop()
            k = node.name.lower()
            if k in seen:
                continue
            seen.add(k)
            nodes.append(node)
            for ref in node.children:
                c = em._child_template(lib, ref)
                if c is not None:
                    queue.append(c)
        return nodes

    state_cache: dict[str, str] = {}

    def state(path, firing=False, engine=False):
        key = (path, firing, engine)
        if key not in state_cache:
            state_cache[key] = script_state(path, firing, engine)
        return state_cache[key]

    for low, name in sorted(names.items()):
        root = lib.objects.get(low)
        if root is None:
            continue
        nodes = tree_nodes(root)
        engines = [n for n in nodes if n.kind.lower() == "engine"]
        guns = [n for n in nodes if n.kind.lower() == "firearms"]
        entry = table.get(low)
        has_layers = bool(entry and entry.get("layers"))
        if engines and not has_layers:
            bindings = []
            for n in engines:
                rows = bound_anywhere.get(("engine", n.name.lower()), [])
                # names repeat across folders (`carrierEngine`): the binding
                # that counts is the one in the file that declared the node
                own = [p for c, p in rows if c.lower() == (n.source or "").lower()]
                bindings += own or [p for _c, p in rows]
            if not bindings:
                out.append(Finding("sound", "engine-without-script", name,
                                   f"{len(engines)} Engine node(s), no loadSoundScript "
                                   "binds any of them"))
            else:
                states = {state(b, engine=True) for b in bindings}
                if "ok" in states:
                    out.append(Finding("sound", "engine-script-ok-but-no-layers",
                                       name, "; ".join(sorted(set(bindings))[:2])))
                else:
                    out.append(Finding("sound", "engine-script-unusable-in-install",
                                       name, f"{sorted(states)}: "
                                       + "; ".join(sorted(set(bindings))[:2])))
        got = {w["fireArms"].lower() for w in (entry or {}).get("weapons", [])}
        for g in guns:
            if g.name.lower() in got:
                continue
            rows = bound_anywhere.get(("firearms", g.name.lower()), [])
            own = [p for c, p in rows if c.lower() == (g.source or "").lower()]
            bindings = own or [p for _c, p in rows]
            if not bindings:
                continue
            sts = {state(b, True) for b in bindings}
            if "ok" in sts:
                out.append(Finding("sound", "weapon-script-ok-but-not-in-table",
                                   name, f"{g.name}: {bindings[0]}"))
            elif sts <= {"silent"}:
                continue
            else:
                out.append(Finding("sound", "weapon-script-unusable-in-install",
                                   name, f"{g.name} {sorted(sts)}"))
    return out


# ---------------------------------------------------------------------------
# audit 4: models and rigs
# ---------------------------------------------------------------------------

NEEDED_CLIPS = ("fire", "reload", "idle")


def hud_file_names(tree: Tree) -> set[str]:
    """Lower-cased file names of the tree's hud pack and every pack it
    inherits (`pack.json` `inherits`: a pack holds only what differs)."""
    names: set[str] = set()
    cur = tree.mod_id
    for _ in range(6):
        d = (VIEWER / "maps" / "_shared" / "hud") if cur == "bf1942" \
            else VIEWER / "maps" / "mods" / cur / "_shared" / "hud"
        if d.is_dir():
            names |= {p.name.lower() for p in d.iterdir()}
        pj = d / "pack.json"
        if not pj.is_file():
            break
        nxt = json.load(open(pj)).get("inherits")
        if not nxt or nxt == cur:
            break
        cur = nxt.lower()
    return names


def declared_minimap_icons(game) -> set[str]:
    """Template names (lower) with a `setMinimapIcon` in their own block."""
    out: set[str] = set()
    for n in game.objects.names():
        if not n.lower().endswith(".con"):
            continue
        text = game.objects.read(n).decode("latin-1")
        if "minimapicon" not in text.lower():
            continue
        name = None
        for line in text.splitlines():
            m = re.match(r"\s*objecttemplate\.(create|activesafe)\s+(\S+)\s+(\S+)",
                         line, re.IGNORECASE)
            if m:
                name = m.group(3).lower()
            elif name and re.match(
                    r'\s*objecttemplate\.setminimapicon\s+"?[^"\s]', line,
                    re.IGNORECASE):
                out.add(name)
    return out


def _missing_geometry(tree: Tree, entry: dict) -> list[str]:
    try:
        r = json.load(open(tree.models / entry["report"]))
    except Exception:
        return []
    return list(r.get("missingGeometryTemplates") or []) + \
        list(r.get("missingMeshFiles") or [])


def audit_models(tree: Tree, game: Game, ctx: dict) -> list[Finding]:
    out: list[Finding] = []
    mp = tree.models / "models.json"
    if not mp.is_file():
        return [Finding("models", "no-models-json", str(mp))]
    entries = json.load(open(mp))
    ctx["models"] = len(entries)
    on_disk = {p.name for p in tree.models.glob("*.glb")}
    listed = set()
    hud = tree.maps / "_shared" / "hud"
    hud_files = hud_file_names(tree)
    thumbs = tree.models / "thumbs"
    thumb_files = {p.name for p in thumbs.iterdir()} if thumbs.is_dir() else set()
    icons = {}
    mi = hud / "minimap-icons.json"
    if mi.is_file():
        icons = json.load(open(mi))
    level_icons = {}
    mli = hud / "minimap-level-icons.json"
    if mli.is_file():
        for lvl in json.load(open(mli)).values():
            level_icons.update({k.lower(): v for k, v in lvl.items()})

    declared_icons = declared_minimap_icons(game) if game.ok else None
    placed: set[str] = set()
    for lv in tree.levels:
        try:
            sc = json.load(open(tree.maps / lv / "scene.json"))
        except Exception:
            continue
        for row in sc.get("objectSpawns", []) + sc.get("vehicleSoldierSpawns", []):
            if row.get("vehicle"):
                placed.add(row["vehicle"].lower())
    def in_hud(stem: str) -> bool:
        stem = stem.lower()
        return f"{stem}.png" in hud_files or any(
            f.endswith(f"_{stem}.png") for f in hud_files)

    cats = collections.Counter(e.get("category") for e in entries)
    ctx["categories"] = dict(cats)
    for e in entries:
        name = e["name"]
        for v in e.get("variants", []) or []:
            listed.add(v["glb"])
            if v["glb"] not in on_disk:
                out.append(Finding("models", "variant-glb-missing", name, v["glb"]))
        listed.add(e.get("glb"))
        if e.get("glb") and e["glb"] not in on_disk:
            out.append(Finding("models", "glb-missing", name, e["glb"]))
        th = e.get("thumb")
        if not th:
            out.append(Finding("models", "thumb-not-listed", name,
                               e.get("category", "")))
        elif th.split("/")[-1] not in thumb_files:
            out.append(Finding("models", "thumb-file-missing", name, th))
        cat = e.get("category")
        if cat in ("land", "air", "sea", "emplacement") and not e.get("triangles") \
                and _missing_geometry(tree, e):
            missing = _missing_geometry(tree, e)
            undeclared = game.ok and all(
                _geometry_undeclared(game, g) for g in missing)
            cause = (f"{cat}-model-draws-nothing-geometry-undeclared"
                     if undeclared else f"{cat}-model-draws-nothing")
            out.append(Finding("models", cause, name,
                               "0 triangles; the geometry templates its tree "
                               "names are not declared: "
                               + ", ".join(_missing_geometry(tree, e)[:3])))
        rep = None
        rp = tree.models / (e.get("report") or "")
        if e.get("report") and rp.is_file():
            try:
                rep = json.load(open(rp))
            except Exception:
                rep = None
        if cat in ("land", "air", "sea", "emplacement") and rep:
            if not rep.get("seats"):
                # a mount that only rides on a host vehicle has no seat of
                # its own; one a level places by itself must have one
                out.append(Finding(
                    "models", f"{cat}-no-seats" if name.lower() in placed
                    else f"{cat}-no-seats-never-placed", name))
            if not rep.get("fireArms") and cat == "emplacement":
                out.append(Finding("models", "emplacement-no-weapon", name))
            if rep.get("fireArms") and not any(
                    (f.get("soundScript") or f.get("sound") or f.get("projectile"))
                    for f in rep["fireArms"] if isinstance(f, dict)) and False:
                pass
        if cat in ("land", "air", "sea") and name.lower() in placed \
                and not (rep or {}).get("collisionParts"):
            out.append(Finding("models", f"{cat}-no-collision", name))
        if cat in ("land", "air", "sea", "emplacement"):
            icon = e.get("vehicleIcon")
            low = name.lower()
            if low not in icons and low not in level_icons:
                if declared_icons is None or low in declared_icons:
                    out.append(Finding("models", "minimap-icon-declared-not-shipped",
                                       name, cat))
            else:
                ic = icons.get(low) or level_icons.get(low)
                stem = (ic or {}).get("icon") if isinstance(ic, dict) else ic
                if stem and not in_hud(str(stem)):
                    out.append(Finding("models", "minimap-icon-file-missing",
                                       name, str(stem)))
    # files on disk that no entry lists (sibling variants are listed by entry)
    extra = sorted(n for n in on_disk
                   if n not in listed and ".kit." not in n and ".fp." not in n
                   and ".pose." not in n and not n.endswith(".wreck.glb")
                   and ".cockpit" not in n)
    for n in extra[:200]:
        out.append(Finding("models", "glb-on-disk-not-in-manifest", n))
    # thumbnails with no entry (the 727 vs 725 question)
    thumb_listed = {e["thumb"].split("/")[-1] for e in entries if e.get("thumb")}
    for t in sorted(thumb_files - thumb_listed):
        out.append(Finding("models", "thumb-without-entry", t))
    # the 727-vs-thumbs gap: entries sharing a thumb
    dup = collections.Counter(e.get("thumb") for e in entries if e.get("thumb"))
    for t, n in dup.items():
        if n > 1:
            users = [e["name"] for e in entries if e.get("thumb") == t]
            out.append(Finding("models", "entries-share-a-thumb", t,
                               ", ".join(users)))

    # kits and viewmodels
    kp = tree.models / "kits.json"
    vm_dir = tree.models / "viewmodels"
    vm_index = set()
    if (vm_dir / "index.json").is_file():
        vm_index = {n.lower() for n in json.load(open(vm_dir / "index.json"))}
    if kp.is_file():
        kits = json.load(open(kp)).get("kits", [])
        ctx["kits"] = len(kits)
        for kit in kits:
            pk = (kit.get("pickup") or {}).get("glb")
            if pk and pk not in on_disk:
                out.append(Finding("models", "kit-pickup-glb-missing",
                                   kit["template"], pk))
            for w in kit.get("worn", []) or []:
                if w.get("glb") and w["glb"] not in on_disk:
                    out.append(Finding("models", "kit-worn-glb-missing",
                                       kit["template"], w["glb"]))
                if w.get("texturesMissing"):
                    out.append(Finding("models", "kit-worn-textures-missing",
                                       kit["template"],
                                       ",".join(w["texturesMissing"][:3])))
            for s in kit.get("soldiers", []) or []:
                for it in kit.get("items", []) or []:
                    t = it["template"]
                    if t.lower().startswith("random"):
                        continue
                    if f"{s}__{t}".lower() not in vm_index:
                        out.append(Finding("models", "kit-item-no-viewmodel",
                                           kit["template"], f"{s}__{t}"))
    # viewmodel rigs
    if vm_dir.is_dir():
        for p in sorted(vm_dir.glob("*.report.json")):
            try:
                r = json.load(open(p))
            except Exception:
                continue
            clips = r.get("clips", {})
            nm = p.name[: -len(".fp.report.json")]
            ws0 = r.get("weaponStats") or {}
            mag = ws0.get("magazine") or {}
            gun = (ws0.get("velocity") or 0) >= 150
            needs = {"idle": True,
                     "fire": bool(ws0.get("projectile")),
                     "reload": gun and (mag.get("size") or 0) > 1
                     and not mag.get("autoReload")}
            for c in NEEDED_CLIPS:
                clip = clips.get(c)
                if clip is None:
                    out.append(Finding("models", f"viewmodel-no-{c}-clip", nm))
                elif clip.get("error") and needs[c]:
                    out.append(Finding("models", "viewmodel-clip-absent-from-install",
                                       nm, f"{c}: {clip['error'][:80]}"))
                elif needs[c] and not clip.get("upperClip") and not clip.get("variants") \
                        and not clip.get("error"):
                    out.append(Finding("models", f"viewmodel-{c}-clip-empty", nm))
            if r.get("texturesMissing"):
                out.append(Finding("models", "viewmodel-textures-missing", nm,
                                   ",".join(r["texturesMissing"][:3])))
            if not r.get("soldierParts", {}).get("parts"):
                out.append(Finding("models", "viewmodel-no-arms", nm))
            ws = r.get("weaponStats") or {}
            # a magazine-fed bolt rifle that never got its bolt cycle
            if ws.get("fireOnce") and ws.get("magazine", {}).get("size", 99) <= 10 \
                    and "bolt" not in clips and re.search(
                        r"(k98|no[1-4]|arisaka|springfield|mosin|nagant|carcano|"
                        r"lebel|mauser|sniper|enfield|type99|svt)", nm, re.I) \
                    and "grenade" not in nm.lower() and "svt" not in nm.lower() \
                    and "g43" not in nm.lower() and not nm.lower().endswith("__no2"):
                out.append(Finding("models", "bolt-rifle-no-bolt-clip", nm))
    # hud icons for kits, weapons: the pack keys a sprite by its lower-cased
    # basename, and qualifies a collision with its directory
    # (`weapon_icon_demokit`), so a name matches `stem.png` or `*_stem.png`.
    def in_hud(stem: str) -> bool:
        stem = stem.lower()
        return f"{stem}.png" in hud_files or any(
            f.endswith(f"_{stem}.png") for f in hud_files)

    lp = tree.maps / "_shared" / "loadouts.json"
    if lp.is_file() and hud_files:
        lo = json.load(open(lp))
        seen: set[str] = set()
        menu = game.menu_basenames() if game.ok else None

        def check(kind_ok, kind_absent, owner, ref):
            stem = ref.replace("\\", "/").rsplit("/", 1)[-1].rsplit(".", 1)[0]
            if stem.lower() in seen or in_hud(stem):
                return
            seen.add(stem.lower())
            if menu is not None and stem.lower() not in menu:
                out.append(Finding("models", kind_absent, owner, stem))
            else:
                out.append(Finding("models", kind_ok, owner, stem))

        for kname, k in lo.get("kits", {}).items():
            ic = (k.get("kitIcon") or {}).get("icon")
            if ic:
                check("kit-icon-missing", "kit-icon-absent-from-install", kname, ic)
            for w in k.get("weapons", []) or []:
                if w.get("icon"):
                    check("weapon-icon-missing", "weapon-icon-absent-from-install",
                          w.get("weapon", "?"), w["icon"])
    return out


def _level_defs(game, lv: str, sc: dict) -> dict:
    """`name.lower() -> (kind, script text)` for every template the level's own
    archive creates, cached on the game object."""
    cache = game.__dict__.setdefault("_level_defs", {})
    if lv in cache:
        return cache[lv]
    defs: dict = {}
    arc = game.level_archive(sc.get("level", lv)) if game.ok else None
    if arc is not None:
        create = re.compile(r"(?im)^\s*ObjectTemplate\.(?:create|activeSafe)\s+(\S+)\s+(\S+)")
        for n in (getattr(arc, "entries", None) or arc.names()):
            if not n.lower().endswith((".con", ".inc")):
                continue
            text = arc.read(n).decode("latin-1")
            for m in create.finditer(text):
                seg = text[m.end(): m.end() + 1500]
                nxt = re.search(r"(?im)^\s*ObjectTemplate\.(create|activeSafe)\b", seg)
                if nxt:
                    seg = seg[: nxt.start()]
                defs.setdefault(m.group(2).lower(), (m.group(1), seg, n))
    cache[lv] = defs
    return defs


LOGIC_KINDS = {"controlpoint", "spawnpoint", "objectspawner", "soldierspawn"}


def _classify_unresolved(game, lv, name, sc):
    if not game.ok:
        return "level-object-template-unresolved", ""
    defs = _level_defs(game, lv, sc)
    d = defs.get(name.lower())
    if d is None:
        return "level-places-undefined-template", "no ObjectTemplate.create anywhere in the level"
    kind, seg, _src = d
    if kind.lower() in LOGIC_KINDS:
        return "level-template-logic-not-baked", kind
    m = re.search(r"(?i)loadSoundScript\s+(\S+)", seg)
    if m:
        arc = game.level_archive(sc.get("level", lv))
        base = None
        for n in (getattr(arc, "entries", None) or arc.names()):
            if n.lower().endswith("/" + m.group(1).replace("\\", "/").lower()):
                base = n
                break
        if base:
            text = arc.read(base).decode("latin-1")
            files = re.findall(r"(?im)^\s*load\s+(\S+)", text)
            states = {_wav_state(game, arc, f) for f in files}
            if files and "ok" not in states:
                if "other-dir" in states:
                    return "level-sound-wav-in-other-dir", ",".join(files)[:80]
                return "level-sound-samples-absent", ",".join(files)[:80]
    return "level-template-defined-not-baked", kind


def _sound_names(game) -> set[str]:
    """Lower-cased entry names of every sound archive in the chain."""
    cache = game.__dict__.get("_wavs")
    if cache is None:
        from bf42.rfa import RfaArchive, find_archives_dir
        cache = set()
        for mod_dir in game.chain:
            ad = find_archives_dir(mod_dir)
            if ad is None:
                continue
            for f in ad.iterdir():
                if f.suffix.lower() == ".rfa" and "sound" in f.name.lower():
                    try:
                        a = RfaArchive(f)
                    except Exception:
                        continue
                    for nm in (getattr(a, "entries", None) or a.names()):
                        cache.add(nm.lower().replace("\\", "/"))
        game._wavs = cache
    return cache


def _wav_state(game, arc, ref: str) -> str:
    """`ok` (the engine's path resolves), `other-dir` (the file exists under a
    different folder than the script says), or `absent`."""
    clean = ref.replace("\\", "/")
    low = clean.lower()
    for marker in ("@root/sound/@rtd/", "@root/sound/"):
        if low.startswith(marker):
            rest = low[len(marker):]
            break
    else:
        rest = low
    names = _sound_names(game)
    level_names = {n.lower().replace("\\", "/")
                   for n in (getattr(arc, "entries", None) or arc.names())} \
        if arc is not None else set()
    for rate in ("11khz", "22khz", "44khz"):
        if f"sound/{rate}/{rest}" in names:
            return "ok"
    if any(n.endswith("/" + rest) or n.endswith("/" + rest.rsplit("/", 1)[-1])
           for n in level_names) and rest.rsplit("/", 1)[-1] in {
               n.rsplit("/", 1)[-1] for n in level_names}:
        # a level's own copy is found by basename (resolve_sound step 1)
        return "ok"
    leaf = rest.rsplit("/", 1)[-1]
    if any(n.endswith("/" + leaf) for n in names):
        return "other-dir"
    return "absent"


# ---------------------------------------------------------------------------
# audit 5: data
# ---------------------------------------------------------------------------

SOLDIER_NATION = (("german", "ger"), ("fmgerman", "ger"), ("usmarine", "us"),
                  ("us", "us"), ("russian", "rus"), ("british", "brit"),
                  ("japanese", "jp"), ("french", "fre"), ("polish", "pol"),
                  ("auss", "auss"), ("canadian", "can"), ("finish", "fin"),
                  ("italian", "it"), ("ddaypolish", "pol"))


def audit_data(tree: Tree, game: Game, ctx: dict) -> list[Finding]:
    out: list[Finding] = []
    mp = tree.models / "models.json"
    models = {e["name"].lower() for e in json.load(open(mp))} if mp.is_file() else set()
    lo = {}
    lp = tree.maps / "_shared" / "loadouts.json"
    if lp.is_file():
        lo = json.load(open(lp))
    kit_names = {k.lower() for k in lo.get("kits", {})}
    kj = tree.models / "kits.json"
    if kj.is_file():
        kit_names |= {k["template"].lower() for k in json.load(open(kj)).get("kits", [])}
    lib = game.library() if game.ok else None

    def known_template(t: str) -> bool:
        if not t:
            return True
        if t.lower() in models:
            return True
        return False

    unresolved_by_level: dict[str, set[str]] = {}
    for lv in tree.levels:
        try:
            sc = json.load(open(tree.maps / lv / "scene.json"))
            doc, _ = read_glb(tree.maps / lv / "scene.glb")
        except Exception as exc:
            out.append(Finding("data", "level-unreadable", lv, str(exc)[:80], lv))
            continue
        node_names = {n.get("name", "").lower() for n in doc["nodes"]}
        own = {t.lower() for t in sc.get("objects", {}).get("skipped", []) or []}
        for s in sc.get("objectSpawns", []):
            v = s.get("vehicle")
            if v and not known_template(v):
                if lib is not None and lib.objects.get(v.lower()) is None:
                    if v.lower() in _level_defs(game, lv, sc):
                        continue  # the level's own template
                    cause = "spawn-template-not-in-library"
                elif v.lower() in node_names:
                    continue
                else:
                    cause = "spawn-template-no-model"
                out.append(Finding("data", cause, v,
                                   f"spawner {s.get('spawner')} cp {s.get('controlPointName')}", lv))
        for s in sc.get("vehicleSoldierSpawns", []):
            v = s.get("vehicle")
            if v and not known_template(v) and v.lower() not in node_names:
                out.append(Finding("data", "vehicle-seat-spawn-no-model", v, s.get("name", ""), lv))
        cps = sc.get("controlPoints", [])
        groups = {s.get("group") for s in sc.get("soldierSpawns", [])}
        cloth = {n for n in node_names if n.endswith(" cloth")}
        for c in cps:
            g = c.get("spawnGroupId")
            if g is not None and g >= 0 and g not in groups \
                    and not c.get("unableToChangeTeam"):
                out.append(Finding("data", "control-point-spawn-group-empty",
                                   c["name"], f"group {g}", lv))
            if c.get("visible") and c.get("flagMesh") and \
                    f"{c['name'].lower()} cloth" not in cloth:
                out.append(Finding("data", "control-point-flag-not-baked",
                                   c["name"], c.get("flagMesh"), lv))
        areas = {a.get("name", "").lower() for a in
                 sc.get("sounds", {}).get("areas", []) or []}
        for t in sc.get("objects", {}).get("unresolvedTemplates", []) or []:
            if t.lower() in areas:
                continue  # an ambient emitter: the sounds layer plays it
            cause, detail = _classify_unresolved(game, lv, t, sc)
            out.append(Finding("data", cause, t, detail, lv))
        # kits and voices for the armies this level uses
        slots = lo.get("levels", {}).get(lv.lower(), {})
        used_nations = set()
        for team, row in slots.items():
            soldier = (row.get("soldier") or "").lower()
            for prefix, nation in SOLDIER_NATION:
                if soldier.startswith(prefix):
                    used_nations.add(nation)
                    break
            else:
                out.append(Finding("data", "soldier-nation-unknown", row.get("soldier"), "", lv))
            for slot, kit in (row.get("slots") or {}).items():
                if kit.lower() not in kit_names:
                    out.append(Finding("data", "level-kit-unresolved", kit,
                                       f"team {team} slot {slot}", lv))
        if not slots:
            out.append(Finding("data", "level-has-no-loadout", lv, "", lv))
        # every level-specific kit table entry
        voices = tree.maps / "_shared" / "voices"
        for n in used_nations:
            if not (voices / n).is_dir():
                out.append(Finding("data", "voices-nation-missing", n, "", lv))
        radio = tree.maps / "_shared" / "voices" / "radio-sounds.json"
        _ = radio
    # voice sample files
    vj = tree.maps / "_shared" / "voices" / "voices.json"
    for fname in ("voices.json", "soldier-voices.json"):
        p = tree.maps / "_shared" / "voices" / fname
        if not p.is_file():
            out.append(Finding("data", "voices-manifest-missing", fname))
            continue
        d = json.load(open(p))
        for entry in d.get("missing", []) or []:
            out.append(Finding("data", "voices-reported-missing", fname,
                               json.dumps(entry)[:100]))
        for nation, row in d.get("nations", {}).items():
            for s in row.get("samples", []):
                if not (tree.maps / "_shared" / "voices" / nation / f"{s}.mp3").is_file():
                    out.append(Finding("data", "voice-sample-file-missing",
                                       f"{nation}/{s}", fname))
    _ = vj
    # loadout kits whose meshes are missing: every kit named by a level
    return out


# ---------------------------------------------------------------------------
# reporting
# ---------------------------------------------------------------------------

def report(findings: list[Finding], ctx: dict, audits) -> int:
    by_audit = collections.defaultdict(list)
    for f in findings:
        by_audit[f.audit].append(f)
    failing = 0
    for audit in audits:
        fs = by_audit.get(audit, [])
        print(f"\n== {audit} ==")
        if not fs:
            print("  clean")
            continue
        causes: dict[str, list[Finding]] = collections.defaultdict(list)
        for f in fs:
            causes[f.cause].append(f)
        rows = sorted(causes.items(), key=lambda kv: -len(kv[1]))
        print(f"  {'cause':44} {'count':>5}  {'levels':>6}  examples")
        for cause, items in rows:
            accepted = cause in ACCEPTED
            if not accepted:
                failing += len(items)
            lv = {i.level for i in items if i.level}
            ex = "; ".join(f"{i.subject}" + (f" [{i.detail}]" if i.detail else "")
                           for i in items[:2])
            tag = " (accepted)" if accepted else ""
            print(f"  {cause + tag:44} {len(items):>5}  {len(lv) or '-':>6}  {ex[:150]}")
    print()
    for k, v in ctx.items():
        print(f"  [{k}] {v}")
    return failing


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mod", required=True, help="tree id: fh, fhsw, bf1942, ...")
    ap.add_argument("--audit", nargs="*", choices=AUDITS, default=list(AUDITS))
    ap.add_argument("--json", type=Path, help="write every finding to this file")
    ap.add_argument("--verbose", action="store_true",
                    help="list every finding, not two examples per cause")
    ap.add_argument("--render", action="store_true",
                    help="also run the rendered smoke (audit_render.mjs)")
    ap.add_argument("--render-url", default="http://localhost:5303",
                    help="a viewer served on a port of your own (never 5273)")
    args = ap.parse_args(argv)

    tree = Tree.locate(args.mod)
    game = Game(resolve_mod_name(args.mod)) if any(
        a in args.audit for a in ("textures", "sound", "data", "models", "placement")) else Game("")
    ctx: dict = {"mod": tree.mod_id, "levels": len(tree.levels),
                 "game archives": "read" if game.ok else "absent"}
    findings: list[Finding] = []
    runners = {"textures": audit_textures, "placement": audit_placement,
               "sound": audit_sound, "models": audit_models, "data": audit_data}
    for a in args.audit:
        findings.extend(runners[a](tree, game, ctx))
    failing = report(findings, ctx, args.audit)
    if args.verbose:
        for f in findings:
            print(f"{f.audit}\t{f.cause}\t{f.level}\t{f.subject}\t{f.detail}")
    if args.json:
        args.json.write_text(json.dumps(
            [f.__dict__ for f in findings], indent=1))
    if args.render:
        import subprocess
        rc = subprocess.call(
            ["flock", "/tmp/claude-1000/chromium.lock", "node",
             str(HERE / "audit_render.mjs"), "--mod", tree.mod_id, "--url",
             args.render_url, "--levels"], cwd=HERE)
        failing += 1 if rc else 0
    return 1 if failing else 0


if __name__ == "__main__":
    sys.exit(main())
