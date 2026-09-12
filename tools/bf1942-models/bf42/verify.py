"""Did the extraction come out right? Objective checks over an exported `.glb`.

"Looks fine in the viewer" is not a regression test. Every failure mode this
pipeline has actually had is measurable from the artefact itself, so this module
turns each one into a check a script can run:

* **Parts collapsed onto the origin.** The bug `bindToSkeletonPart` used to
  cause — parse it wrong and every sub-part lands on the weapon origin. The
  check has to be precise about what "collapsed" means, because vanilla itself
  stacks parts on purpose: the Type99's mag and bolt bones rest *exactly* on
  `Type99Base` (they only separate during the reload clip), the No4's `Load`
  and `Block` bones share a rest point, and every soldier's body and head stack
  at the origin because both are authored in bind space. What no healthy model
  does is pile three or more parts on the origin *without a bind to explain
  them* — a part that carries a `boundBone` extra was put there by a skeleton
  and is vouched for by the silhouette check instead.
* **Area outside the shadow silhouette.** Each hand weapon ships a
  `Shad_*`/`Shade_*` mesh — the whole weapon as one part in the same space — so
  sub-part placement is measurable rather than a matter of opinion. The metric
  is the side (Z-Y) projection because the shadow meshes are nearly flat in X
  (a Colt's is 3 cm wide); rasterise both, dilate the silhouette one pixel for
  raster tolerance, and report the fraction of bound-part area that falls
  outside, aggregated over parts weighted by area. Correctly placed vanilla
  weapons measure 0-6%; reading the `.ske` unmirrored throws 15-60%.
* **The wrong size.** Real-world lengths are an external check on the whole
  coordinate chain — `.sm` units through `.ske` bind poses to glTF metres. A K98
  is 1.11 m; put its bolt behind the butt plate and the box grows past any
  modelling licence. Tolerance is generous (default 18%) because the models
  themselves take licence — the vanilla Colt draws 11% long against a real
  M1911 — while the failure modes overshoot by far more.
* **Degenerate geometry.** NaN positions and zero-area triangles, counted in
  world space.

Everything here is pure: `.glb` bytes in, findings out. The CLI wiring that
knows about `models.json`, reports and archives lives in `verify_models.py`.
"""

from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass, field
from pathlib import Path

Vector3 = tuple[float, float, float]
Matrix3 = tuple[tuple[float, float, float], ...]
Triangle = tuple[Vector3, Vector3, Vector3]

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

_IDENTITY: Matrix3 = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))

# Correct vanilla weapons aggregate 0-6% outside their own shadow silhouette;
# the historical mirror bug threw 15-60%. The gap is wide enough that the
# thresholds are not delicate.
SILHOUETTE_WARN = 0.07
SILHOUETTE_FAIL = 0.10
SILHOUETTE_RESOLUTION = 512

# Four weapons measure high on a *correct* extraction because the mismatch is
# authored into the game data, verified by bounding boxes against the shadow.
# Recorded the same way the damage tables record their missing `run` targets:
# as facts, each with a ceiling a regression would still have to break.
SILHOUETTE_AUTHORED: dict[str, tuple[float, str]] = {
    # measured 58.8%: Type5Simple's file is literally Shad_K98_m1 — vanilla
    # ships the K98's shadow for the Type 5, and the Type 5's Garand-style box
    # magazine hangs below the K98's flush-stocked silhouette.
    "Type5": (0.70, "vanilla reuses the K98's shadow mesh (Shad_K98_m1)"),
    # measured 22.6%: the only bound part is the 6 cm plunger handle at the top
    # of the box, and the crude shadow leaves it almost no area to land in.
    "Detonator": (0.30, "single tiny bound part against a crude shadow"),
    # measured 15.4%: the shadow draws the pan magazine slightly lower and
    # thinner than the DPMag bone rests it.
    "DP": (0.22, "shadow draws the pan magazine lower than the bone rests it"),
    # measured 9.0%: the shadow is tighter than the weapon itself — the unbound
    # body measures 11.3% outside it — and the small trigger parts sit in that
    # gap.
    "Panzershreck": (0.15, "shadow is tighter than the weapon body itself"),
}

# Two mesh materials no vanilla `.rs` defines a shader for — 2 triangles on the
# Thompson body, a 29-triangle sight detail on the StG 44. Authored gaps in the
# game data, not lookup failures.
MATERIALS_WITHOUT_SHADER_AUTHORED: dict[str, frozenset[str]] = {
    "Thompson": frozenset({"thompson_m1_material0"}),
    "Sg44": frozenset({"sg44_material1"}),
}

# Texture references that resolve nowhere in a *complete* vanilla install —
# the `.rs` names variants the archives never shipped. These are the only
# absent references that reach an extracted model; the full 56-name census is
# in features/bf1942-3d-models/extraction-rollout.md.
VANILLA_UNRESOLVED_TEXTURES: frozenset[str] = frozenset({
    "texture/",             # an empty ref in BlackMedal_Hull_L1.rs and Yamato turrets
    "texture/sherw2_f",     # Sherman road-wheel variant (Sherman, M10, Priest)
    "texture/b17win_l",     # B17 window pane
})

LENGTH_TOLERANCE = 0.18

# Real-world lengths in metres, longest axis of the thing as the game models it.
# An entry is only worth having when the real figure is unambiguous (which
# variant, stock folded or not, gun forward or aft) — a wrong expectation is
# worse than none. Sources: standard reference figures for each weapon/vehicle.
KNOWN_LENGTHS_M: dict[str, float] = {
    # Hand weapons. The game's models take some licence (the Colt draws ~11%
    # long); the tolerance absorbs that while still catching a doubled length.
    "Colt": 0.216,          # M1911, 8.5 in overall
    "WalterP38": 0.216,     # Walther P38
    "K98": 1.11,            # Karabiner 98k
    "No4": 1.129,           # Lee-Enfield No. 4
    "M1Garand": 1.10,
    "Type5": 1.10,          # Type 5 rifle, Japanese Garand copy
    "Type99": 1.118,        # Arisaka Type 99 short rifle (the sniper model)
    "Thompson": 0.85,       # M1928A1 with compensator
    "Mp18": 0.815,
    "Mp40": 0.833,          # stock extended
    "Sg44": 0.94,           # StG 44
    "Bar1918": 1.194,
    "JohnsonLMG": 1.066,    # M1941 Johnson LMG
    "DP": 1.27,             # Degtyaryov DP-27
    "Bazooka": 1.37,        # M1A1 launcher tube
    "Panzershreck": 1.64,   # RPzB 54
    # Emplacements — the gun itself, no tripod.
    "Browning": 1.654,      # M2HB
    "Browning_Air": 1.654,
    "Browning_unlimited": 1.654,
    "Stationary_Browning": 1.654,
    "MG42": 1.22,
    "MG42_Air": 1.22,
    "MG42_unlimited": 1.22,
    "Stationary_mg42": 1.22,
    # Land vehicles, gun forward where the game models it that way. Variants
    # the game leaves ambiguous (PanzerIV barrel length, T34 vs T34-85) are
    # deliberately absent.
    "Sherman": 5.84,        # M4 hull length
    "Tiger": 8.45,          # gun forward
    "Chi-ha": 5.5,          # Type 97
    "M10": 6.83,
    "Hanomag": 5.80,        # SdKfz 251
    "Priest": 6.02,         # M7 Priest
    "Sexton": 6.12,
    "Wespe": 4.81,
    "Willy": 3.36,          # Willys MB
    "Kubelwagen": 3.74,
    # Aircraft. The measured "length" is the longest ground axis, which for
    # every one of these is the wingspan.
    "B17": 31.62,
    "Spitfire": 11.23,
    "BF109": 9.92,
    "Mustang": 11.28,
    "Yak9": 9.74,
    "Ilyushin": 14.6,       # Il-2
    "Stuka": 13.8,          # Ju 87 B
    "Zero": 12.0,           # A6M2
    "SBD": 12.66,
    "SBD-T": 12.66,
    "AichiVal": 14.37,      # Aichi D3A
    "Aichival-T": 14.37,
    # Ships.
    "Fletcher": 114.7,
    "Gato": 95.0,
    "Sub7C": 67.1,          # Type VIIC
    "Hatsuzuki": 134.2,     # Akizuki class
    "Yamato": 263.0,
    "PrinceOW": 227.1,      # King George V class
}


class VerifyError(ValueError):
    pass


# -- glb reading ------------------------------------------------------------ #

def read_glb(path: Path) -> tuple[dict, bytes]:
    """The JSON document and the binary chunk of a `.glb`."""
    data = path.read_bytes()
    if len(data) < 12:
        raise VerifyError(f"truncated glb: {path.name}")
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise VerifyError(f"not a glb: {path.name}")
    doc: dict | None = None
    blob = b""
    offset = 12
    while offset + 8 <= len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        if chunk_type == CHUNK_JSON:
            doc = json.loads(data[offset:offset + chunk_length].decode("utf-8"))
        elif chunk_type == CHUNK_BIN:
            blob = data[offset:offset + chunk_length]
        offset += chunk_length + (-chunk_length % 4)
    if doc is None:
        raise VerifyError(f"no JSON chunk: {path.name}")
    return doc, blob


def _accessor_vec3(doc: dict, blob: bytes, index: int) -> list[Vector3]:
    acc = doc["accessors"][index]
    if acc.get("componentType") != 5126 or acc.get("type") != "VEC3":
        raise VerifyError(f"accessor {index} is not float VEC3")
    view = doc["bufferViews"][acc["bufferView"]]
    offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", 12)
    return [
        struct.unpack_from("<3f", blob, offset + i * stride)
        for i in range(acc["count"])
    ]


def _accessor_indices(doc: dict, blob: bytes, index: int) -> list[int]:
    acc = doc["accessors"][index]
    fmt = {5121: "<B", 5123: "<H", 5125: "<I"}.get(acc.get("componentType"))
    if fmt is None or acc.get("type") != "SCALAR":
        raise VerifyError(f"accessor {index} is not a scalar index type")
    size = struct.calcsize(fmt)
    view = doc["bufferViews"][acc["bufferView"]]
    offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return [
        struct.unpack_from(fmt, blob, offset + i * size)[0]
        for i in range(acc["count"])
    ]


def _quat_to_matrix(q: tuple[float, float, float, float]) -> Matrix3:
    x, y, z, w = q
    return (
        (1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)),
        (2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)),
        (2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)),
    )


def _compose(parent: tuple[Matrix3, Vector3], node: dict) -> tuple[Matrix3, Vector3]:
    pr, pt = parent
    t = node.get("translation", (0.0, 0.0, 0.0))
    r = _quat_to_matrix(node.get("rotation", (0.0, 0.0, 0.0, 1.0)))
    s = node.get("scale", (1.0, 1.0, 1.0))
    scaled = tuple(tuple(r[i][j] * s[j] for j in range(3)) for i in range(3))
    rotation = tuple(
        tuple(sum(pr[i][k] * scaled[k][j] for k in range(3)) for j in range(3))
        for i in range(3)
    )
    translation = tuple(
        sum(pr[i][k] * t[k] for k in range(3)) + pt[i] for i in range(3)
    )
    return rotation, translation


def _apply(transform: tuple[Matrix3, Vector3], point: Vector3) -> Vector3:
    r, t = transform
    return tuple(sum(r[i][k] * point[k] for k in range(3)) + t[i] for i in range(3))


@dataclass
class Part:
    """One mesh-bearing node of the exported scene, in world space."""
    name: str
    extras: dict = field(default_factory=dict)
    world_translation: Vector3 = (0.0, 0.0, 0.0)
    triangles: list[Triangle] = field(default_factory=list)

    @property
    def bound_bone(self) -> str | None:
        return self.extras.get("boundBone")

    @property
    def is_collision(self) -> bool:
        return bool(self.extras.get("collision")) or "collision" in self.name.lower()


def scene_parts(doc: dict, blob: bytes) -> list[Part]:
    """Every mesh-bearing node, world-transformed, in scene order."""
    nodes = doc.get("nodes", [])
    meshes = doc.get("meshes", [])
    parts: list[Part] = []

    def visit(index: int, parent: tuple[Matrix3, Vector3], depth: int = 0) -> None:
        if depth > 64 or index >= len(nodes):
            return
        node = nodes[index]
        world = _compose(parent, node)
        mesh_index = node.get("mesh")
        if mesh_index is not None:
            part = Part(
                name=node.get("name", f"node{index}"),
                extras=node.get("extras") or {},
                world_translation=world[1],
            )
            for prim in meshes[mesh_index].get("primitives", []):
                attrs = prim.get("attributes", {})
                if "POSITION" not in attrs or "indices" not in prim:
                    continue
                positions = _accessor_vec3(doc, blob, attrs["POSITION"])
                indices = _accessor_indices(doc, blob, prim["indices"])
                world_positions = [_apply(world, p) for p in positions]
                for i in range(0, len(indices) - 2, 3):
                    part.triangles.append((
                        world_positions[indices[i]],
                        world_positions[indices[i + 1]],
                        world_positions[indices[i + 2]],
                    ))
            parts.append(part)
        for child in node.get("children", []):
            visit(child, world, depth + 1)

    scene = doc.get("scenes", [{}])[doc.get("scene", 0)]
    for root in scene.get("nodes", []):
        visit(root, (_IDENTITY, (0.0, 0.0, 0.0)))
    return parts


# -- geometry health -------------------------------------------------------- #

def _triangle_area(tri: Triangle) -> float:
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = tri
    ab = (bx - ax, by - ay, bz - az)
    ac = (cx - ax, cy - ay, cz - az)
    cross = (
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
    )
    return 0.5 * math.sqrt(sum(v * v for v in cross))


@dataclass
class GeometryStats:
    triangles: int = 0
    zero_area: int = 0
    non_finite_vertices: int = 0

    @property
    def zero_area_fraction(self) -> float:
        return self.zero_area / self.triangles if self.triangles else 0.0


def geometry_stats(parts: list[Part], *, zero_area_eps: float = 1e-10) -> GeometryStats:
    stats = GeometryStats()
    for part in parts:
        if part.is_collision:
            continue
        for tri in part.triangles:
            stats.triangles += 1
            flat = [v for point in tri for v in point]
            if not all(math.isfinite(v) for v in flat):
                stats.non_finite_vertices += 1
                continue
            if _triangle_area(tri) < zero_area_eps:
                stats.zero_area += 1
    return stats


def origin_pile(parts: list[Part], *, epsilon: float = 1e-4,
                allowance: int = 2) -> list[str]:
    """Unexplained visible parts piled on the scene origin.

    One part at the origin is the hull or weapon body; a soldier legitimately
    stacks two (body and head are both authored in bind space). A part carrying
    a `boundBone` extra was placed there by a skeleton — the Type99's mag and
    bolt bones genuinely rest on its base bone — so bound parts do not count.
    More than `allowance` *unbound* parts at the origin is the child-placement
    failure mode: `setPosition` read as a property of the parent, or a bind
    that was never applied, leaves every sub-part buried at the root.
    """
    piled = [
        part.name for part in parts
        if not part.is_collision
        and part.bound_bone is None
        and all(abs(v) < epsilon for v in part.world_translation)
    ]
    return piled if len(piled) > allowance else []


# Markers `assemble.py` writes into `boundParts` when a bind could not be
# applied. "no such bone" means the placement is simply unknown; "no skeleton
# in scope" is the recorded GrenadeAllies case — the `.ske` itself is corrupt
# and the report says so under `skeletonsNotRead`.
_BIND_NO_BONE = "(no such bone)"
_BIND_NO_SKELETON = "(no skeleton in scope)"


def unplaced_bound_parts(report: dict) -> tuple[list[str], list[str]]:
    """Bound parts the assembler could not place: (missing bones, missing skeletons)."""
    no_bone: list[str] = []
    no_skeleton: list[str] = []
    for line in report.get("boundParts") or []:
        if _BIND_NO_BONE in line:
            no_bone.append(line)
        elif _BIND_NO_SKELETON in line:
            no_skeleton.append(line)
    return no_bone, no_skeleton


# -- silhouette ------------------------------------------------------------- #

def _rasterize(triangles: list[Triangle], axes: tuple[int, int],
               lo: tuple[float, float], hi: tuple[float, float],
               resolution: int) -> bytearray:
    """Filled projection of `triangles` onto the plane given by `axes`."""
    ai, aj = axes
    span_x = hi[0] - lo[0]
    span_y = hi[1] - lo[1]
    sx = (resolution - 1) / span_x if span_x > 0 else 0.0
    sy = (resolution - 1) / span_y if span_y > 0 else 0.0
    mask = bytearray(resolution * resolution)
    for tri in triangles:
        pts = [((p[ai] - lo[0]) * sx, (p[aj] - lo[1]) * sy) for p in tri]
        min_x = max(0, math.floor(min(p[0] for p in pts)))
        max_x = min(resolution - 1, math.ceil(max(p[0] for p in pts)))
        min_y = max(0, math.floor(min(p[1] for p in pts)))
        max_y = min(resolution - 1, math.ceil(max(p[1] for p in pts)))
        (x0, y0), (x1, y1), (x2, y2) = pts
        d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(d) < 1e-12:
            # Degenerate in this projection: stamp its bounding pixels so an
            # edge-on part still counts as present.
            for py in range(min_y, max_y + 1):
                row = py * resolution
                for px in range(min_x, max_x + 1):
                    mask[row + px] = 1
            continue
        for py in range(min_y, max_y + 1):
            row = py * resolution
            for px in range(min_x, max_x + 1):
                w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / d
                w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / d
                if w0 >= -1e-9 and w1 >= -1e-9 and (1 - w0 - w1) >= -1e-9:
                    mask[row + px] = 1
    return mask


def _dilate(mask: bytearray, resolution: int) -> bytearray:
    out = bytearray(mask)
    for y in range(resolution):
        row = y * resolution
        for x in range(resolution):
            if mask[row + x]:
                continue
            for dy in (-1, 0, 1):
                ny = y + dy
                if not 0 <= ny < resolution:
                    continue
                nrow = ny * resolution
                for dx in (-1, 0, 1):
                    nx = x + dx
                    if 0 <= nx < resolution and mask[nrow + nx]:
                        out[row + x] = 1
                        break
                else:
                    continue
                break
    return out


@dataclass
class SilhouetteResult:
    aggregate: float
    per_part: dict[str, float]


def silhouette_outside(bound_parts: dict[str, list[Triangle]],
                       shadow: list[Triangle], *,
                       resolution: int = SILHOUETTE_RESOLUTION,
                       ) -> SilhouetteResult | None:
    """Fraction of bound-part area outside the shadow-mesh silhouette.

    Side (Z-Y) projection: the shadow meshes are authored as near-flat cutouts
    a few centimetres wide, so the side view is the one they actually describe.
    The aggregate weights each part by its own projected area, which is why a
    coarse shadow that omits the trigger-guard hole does not fail a correctly
    placed trigger — the part is tiny against the mag and bolt the check is
    really watching.
    """
    if not shadow or not bound_parts:
        return None
    axes = (2, 1)
    points = [p for tri in shadow for p in tri]
    points += [p for tris in bound_parts.values() for tri in tris for p in tri]
    lo = (min(p[axes[0]] for p in points), min(p[axes[1]] for p in points))
    hi = (max(p[axes[0]] for p in points), max(p[axes[1]] for p in points))
    silhouette = _dilate(_rasterize(shadow, axes, lo, hi, resolution), resolution)

    per_part: dict[str, float] = {}
    total = outside_total = 0
    for name, triangles in bound_parts.items():
        part_mask = _rasterize(triangles, axes, lo, hi, resolution)
        area = 0
        outside = 0
        for i, filled in enumerate(part_mask):
            if filled:
                area += 1
                if not silhouette[i]:
                    outside += 1
        per_part[name] = outside / area if area else 0.0
        total += area
        outside_total += outside
    return SilhouetteResult(
        aggregate=outside_total / total if total else 0.0,
        per_part=per_part,
    )


# -- dimensions ------------------------------------------------------------- #

@dataclass
class DimensionCheck:
    expected: float
    measured: float

    @property
    def deviation(self) -> float:
        return abs(self.measured - self.expected) / self.expected

    def ok(self, tolerance: float = LENGTH_TOLERANCE) -> bool:
        return self.deviation <= tolerance


def dimension_check(name: str, measured_length: float | None,
                    known: dict[str, float] | None = None,
                    ) -> DimensionCheck | None:
    """Compare the measured longest side against the real thing, when known."""
    table = KNOWN_LENGTHS_M if known is None else known
    expected = table.get(name)
    if expected is None or measured_length is None:
        return None
    return DimensionCheck(expected=expected, measured=measured_length)


# -- triage ------------------------------------------------------------------ #

@dataclass
class Finding:
    severity: str   # "broken" | "degraded" | "info"
    message: str


@dataclass
class Triage:
    name: str
    findings: list[Finding] = field(default_factory=list)

    @property
    def status(self) -> str:
        severities = {f.severity for f in self.findings}
        if "broken" in severities:
            return "broken"
        if "degraded" in severities:
            return "degraded"
        return "clean"

    def broken(self, message: str) -> None:
        self.findings.append(Finding("broken", message))

    def degraded(self, message: str) -> None:
        self.findings.append(Finding("degraded", message))

    def info(self, message: str) -> None:
        self.findings.append(Finding("info", message))


def triage_report(name: str, report: dict | None, *,
                  parts: list[Part] | None = None,
                  stats: GeometryStats | None = None,
                  silhouette: SilhouetteResult | None = None,
                  dimensions: DimensionCheck | None = None,
                  length_tolerance: float = LENGTH_TOLERANCE,
                  vanilla_facts: bool = True) -> Triage:
    """Fold every check into one clean / degraded / broken verdict.

    `vanilla_facts` applies the recorded authored exceptions above — the
    borrowed Type5 shadow, the two shaderless materials, the never-shipped
    textures. A mod extraction should pass False: its template names can
    collide with vanilla's without sharing its data.
    """
    triage = Triage(name)

    if parts is not None:
        visible = [p for p in parts if not p.is_collision and p.triangles]
        if not visible:
            triage.broken("no visible geometry in the exported scene")
        pile = origin_pile(parts)
        if pile:
            message = (f"{len(pile)} unbound parts piled on the origin: "
                       + ", ".join(sorted(pile)))
            # A pile the report already explains (the skeleton itself was
            # unreadable, as GrenadeAllies' corrupt .ske) is a recorded
            # degradation; an unexplained pile is a placement regression.
            if report and (report.get("skeletonsNotRead") or []):
                triage.degraded(message)
            else:
                triage.broken(message)

    if stats is not None:
        if stats.non_finite_vertices:
            triage.broken(f"{stats.non_finite_vertices} non-finite triangles")
        if stats.triangles and stats.zero_area_fraction > 0.02:
            triage.degraded(
                f"{stats.zero_area}/{stats.triangles} zero-area triangles")

    if silhouette is not None:
        pct = silhouette.aggregate * 100
        authored = SILHOUETTE_AUTHORED.get(name) if vanilla_facts else None
        if authored is not None:
            ceiling, reason = authored
            if silhouette.aggregate > ceiling:
                triage.broken(
                    f"{pct:.1f}% of bound-part area outside the shadow silhouette, "
                    f"past even the recorded authored ceiling of {ceiling * 100:.0f}%")
            else:
                triage.info(
                    f"silhouette {pct:.1f}% outside (authored: {reason})")
        elif silhouette.aggregate > SILHOUETTE_FAIL:
            triage.broken(f"{pct:.1f}% of bound-part area outside the shadow silhouette")
        elif silhouette.aggregate > SILHOUETTE_WARN:
            triage.degraded(f"{pct:.1f}% of bound-part area outside the shadow silhouette")
        else:
            triage.info(f"silhouette {pct:.1f}% outside")

    if dimensions is not None:
        line = (f"length {dimensions.measured:.3f} m vs {dimensions.expected:.3f} m real "
                f"({dimensions.deviation * 100:.1f}% off)")
        if dimensions.ok(length_tolerance):
            triage.info(line)
        else:
            triage.broken(line)

    if report:
        no_bone, no_skeleton = unplaced_bound_parts(report)
        for line in no_bone:
            triage.broken(f"bound part names a bone the skeleton lacks: {line}")
        for line in no_skeleton:
            triage.degraded(f"bound part left unplaced: {line}")
        missing_meshes = report.get("missingMeshFiles") or []
        if missing_meshes:
            triage.broken(f"mesh files unresolved: {', '.join(missing_meshes)}")
        missing_geoms = report.get("missingGeometryTemplates") or []
        if missing_geoms:
            triage.broken(f"geometry templates unresolved: {', '.join(missing_geoms)}")
        missing_textures = report.get("texturesNotFound") or []
        if missing_textures:
            authored_textures = VANILLA_UNRESOLVED_TEXTURES if vanilla_facts else frozenset()
            unexplained = [
                t for t in missing_textures
                if t.strip().lower() not in authored_textures
            ]
            if unexplained:
                triage.degraded(f"textures unresolved: {', '.join(unexplained)}")
            explained = [t for t in missing_textures if t not in unexplained]
            if explained:
                triage.info(
                    "textures absent from every vanilla install: "
                    + ", ".join(explained))
        no_shader = report.get("materialsWithoutShader") or []
        if no_shader:
            authored_materials = (
                MATERIALS_WITHOUT_SHADER_AUTHORED.get(name, frozenset())
                if vanilla_facts else frozenset())
            unexplained = [
                m for m in no_shader if m.lower() not in authored_materials
            ]
            if unexplained:
                triage.degraded(
                    f"materials without a shader: {', '.join(unexplained)}")
            explained = [m for m in no_shader if m not in unexplained]
            if explained:
                triage.info(
                    "materials no vanilla .rs defines: " + ", ".join(explained))
        bad_skeletons = report.get("skeletonsNotRead") or []
        if bad_skeletons:
            triage.degraded(f"skeletons unreadable: {', '.join(bad_skeletons)}")
        unresolved = report.get("unresolvedTemplates") or []
        if unresolved:
            triage.degraded(f"templates unresolved: {', '.join(unresolved)}")

    return triage
