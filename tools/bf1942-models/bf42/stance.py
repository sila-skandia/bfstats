"""A soldier's skeleton in each stance, as data: `poses/stances.json`.

The room server and the headless runner draw nothing, but a round they fly
has to meet a soldier on the engine's capsules (`setSkeletonCollisionBone`,
ledger DIE-10) and a bot has to aim at one of his skeleton's bones
(`pickSoldierRandomSensePosition`, ledger AI-123), as on the page, which reads
both off the body it draws. This module poses the exported skeleton in the
three stances and writes where every bone is, so neither needs a glb, a GPU
or the content store:

    {
      "format": "bf1942-stance-bodies/1",
      "bodies": [
        { "names": ["Bip01", ...],             the skeleton's bones, in its order
          "stand":  { "bones": [[x, y, z], ...], "parents": [[x, y, z], ...] },
          "crouch": { ... }, "prone": { ... } }
      ],
      "default": 0,                            the body most soldiers share
      "soldiers": { "GermanSoldier": { "body": 0, "source": "GermanSoldier__K98" }, ... }
    }

`bones[i]` is bone `i` in the body's frame (feet at the origin, metres, the
exported rig's own axes), `parents[i]` the node it hangs from, which is what a
capsule's segment runs to (`viewer/skeleton-hit.js` `buildCapsules`). Soldiers
that pose alike share a body.

The pose is the one `viewer/pose-compose.js` composes for a still soldier:
the rig's rest transforms, the recipe's joints over them, and the stance's
constant clip (`stand`, `crouch`, `lie`) over those. Two sources, the two
ways a poses tree holds a soldier:

* a split tree: `poses/rigs/<Soldier>.rig.glb` and a
  `<Soldier>__<Pose>.pose.json` recipe (`root.q`, `joints`, `clips.<name>.still`);
* a single-file tree: a `<Soldier>__<Pose>.pose.glb` whose three animations
  are the stance clips.

The walk is three.js's own (`Object3D.traverse`: a node, then its children in
order; parentless nodes in index order), so the bones come out in the order
`server/soldier-capsules.mjs` read them off the rig, which is the `.ske`'s.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

FORMAT = "bf1942-stance-bodies/1"

#: stance -> the constant clip it is posed from (`pose-compose.js` `recipeClips`).
STANCE_CLIPS = {"stand": "stand", "crouch": "crouch", "prone": "lie"}

_GLB_MAGIC = 0x46546C67
_JSON = 0x4E4F534A
_BIN = 0x004E4942


def bone_key(name: str) -> str:
    """`skeleton-hit.js` `boneKey`: case, `_` and runs of space folded."""
    return " ".join(str(name).lower().replace("_", " ").split())


def read_glb(path: Path) -> tuple[dict, bytes | None]:
    data = Path(path).read_bytes()
    if len(data) < 12 or struct.unpack_from("<I", data, 0)[0] != _GLB_MAGIC:
        raise ValueError(f"not a GLB: {path}")
    offset, doc, blob = 12, None, None
    while offset + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        if kind == _JSON and doc is None:
            doc = json.loads(data[offset:offset + length].decode("utf-8"))
        elif kind == _BIN and blob is None:
            blob = data[offset:offset + length]
        offset += length
    if doc is None:
        raise ValueError(f"GLB has no JSON chunk: {path}")
    return doc, blob


# -- transforms ------------------------------------------------------------- #

def _q_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def _q_rot(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    # v + 2w (q x v) + 2 q x (q x v)
    cx, cy, cz = y * vz - z * vy, z * vx - x * vz, x * vy - y * vx
    dx, dy, dz = y * cz - z * cy, z * cx - x * cz, x * cy - y * cx
    return (vx + 2 * (w * cx + dx), vy + 2 * (w * cy + dy), vz + 2 * (w * cz + dz))


class _Rig:
    """A glTF node tree with each node's local translation, rotation and
    scale, posable. Scales are composed per axis (the rigs carry none but
    1, and a mirrored root's -1)."""

    def __init__(self, doc: dict):
        nodes = doc.get("nodes") or []
        self.names = [n.get("name") or "" for n in nodes]
        self.extras = [n.get("extras") if isinstance(n.get("extras"), dict) else {} for n in nodes]
        self.children = [list(n.get("children") or []) for n in nodes]
        self.parent = [-1] * len(nodes)
        for i, kids in enumerate(self.children):
            for k in kids:
                if 0 <= k < len(nodes) and self.parent[k] < 0:
                    self.parent[k] = i
        self.rest_t = [tuple((n.get("translation") or [0, 0, 0])[:3]) for n in nodes]
        self.rest_q = [tuple((n.get("rotation") or [0, 0, 0, 1])[:4]) for n in nodes]
        self.scale = [tuple((n.get("scale") or [1, 1, 1])[:3]) for n in nodes]
        # three.js's traverse: parentless nodes in index order, depth first.
        self.order: list[int] = []
        stack = [i for i in range(len(nodes)) if self.parent[i] < 0][::-1]
        while stack:
            i = stack.pop()
            self.order.append(i)
            stack.extend(k for k in reversed(self.children[i]) if self.parent[k] == i)
        # The skeleton's bones: the nodes the extractor marked, first of a name.
        self.joints: list[int] = []
        self.by_key: dict[str, int] = {}
        for i in self.order:
            if not self.extras[i].get("joint"):
                continue
            key = bone_key(self.names[i])
            if key not in self.by_key:
                self.by_key[key] = i
                self.joints.append(i)
        self.t = list(self.rest_t)
        self.q = list(self.rest_q)

    def reset(self) -> None:
        self.t = list(self.rest_t)
        self.q = list(self.rest_q)

    def apply(self, values: dict | None) -> None:
        """`{bone: [qx, qy, qz, qw, px, py, pz]}` onto the bones it names."""
        for bone, v in (values or {}).items():
            i = self.by_key.get(bone_key(bone))
            if i is None:
                continue
            self.q[i] = (v[0], v[1], v[2], v[3])
            self.t[i] = (v[4], v[5], v[6])

    def world(self) -> list[tuple[float, float, float]]:
        """Every node's world position."""
        pos = [(0.0, 0.0, 0.0)] * len(self.names)
        rot = [(0.0, 0.0, 0.0, 1.0)] * len(self.names)
        scl = [(1.0, 1.0, 1.0)] * len(self.names)
        for i in self.order:                       # parents come first
            p = self.parent[i]
            if p < 0:
                pos[i], rot[i], scl[i] = self.t[i], self.q[i], self.scale[i]
                continue
            sx, sy, sz = scl[p]
            t = self.t[i]
            r = _q_rot(rot[p], (t[0] * sx, t[1] * sy, t[2] * sz))
            pos[i] = (pos[p][0] + r[0], pos[p][1] + r[1], pos[p][2] + r[2])
            rot[i] = _q_mul(rot[p], self.q[i])
            s = self.scale[i]
            scl[i] = (sx * s[0], sy * s[1], sz * s[2])
        return pos

    def stance(self) -> dict:
        pos = self.world()
        origin = (0.0, 0.0, 0.0)
        r = lambda p: [round(p[0], 5), round(p[1], 5), round(p[2], 5)]
        return {
            "bones": [r(pos[i]) for i in self.joints],
            "parents": [r(pos[self.parent[i]] if self.parent[i] >= 0 else origin) for i in self.joints],
        }


# -- the two sources -------------------------------------------------------- #

def body_from_recipe(rig_doc: dict, recipe: dict) -> dict | None:
    """A split tree's soldier: the rig posed by one of his recipes."""
    rig = _Rig(rig_doc)
    if len(rig.joints) < 2:
        return None
    root_q = (recipe.get("root") or {}).get("q")
    if root_q:
        for i, extras in enumerate(rig.extras):
            if extras.get("rigRoot"):
                rig.rest_q[i] = tuple(root_q[:4])
    body = {"names": [rig.names[i] for i in rig.joints]}
    for stance, clip in STANCE_CLIPS.items():
        rig.reset()
        rig.apply(recipe.get("joints"))
        rig.apply(((recipe.get("clips") or {}).get(clip) or {}).get("still"))
        body[stance] = rig.stance()
    return body


def _accessor_floats(doc: dict, blob: bytes, index: int) -> tuple[list[float], int]:
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    if acc.get("componentType") != 5126:
        raise ValueError("a pose track that is not float")
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or 4 * width
    count = acc["count"]
    out: list[float] = []
    for k in range(count):
        out.extend(struct.unpack_from(f"<{width}f", blob, start + k * stride))
    return out, width


def body_from_glb(doc: dict, blob: bytes | None) -> dict | None:
    """A single-file tree's soldier: the pose glb's own nodes, each stance its
    animation's first key (the stance clips are constant)."""
    rig = _Rig(doc)
    if len(rig.joints) < 2 or blob is None:
        return None
    clips = {a.get("name"): a for a in doc.get("animations") or []}
    body = {"names": [rig.names[i] for i in rig.joints]}
    for stance, name in STANCE_CLIPS.items():
        rig.reset()
        clip = clips.get(name)
        for channel in (clip or {}).get("channels") or []:
            target = channel.get("target") or {}
            node, path = target.get("node"), target.get("path")
            if node is None or path not in ("rotation", "translation"):
                continue
            sampler = clip["samplers"][channel["sampler"]]
            values, width = _accessor_floats(doc, blob, sampler["output"])
            first = tuple(values[:width])
            if path == "rotation" and width == 4:
                rig.q[node] = first
            elif path == "translation" and width == 3:
                rig.t[node] = first
        body[stance] = rig.stance()
    return body


# -- a poses tree ----------------------------------------------------------- #

def _soldier_of(stem: str) -> str:
    return stem.split("__", 1)[0]


def kit_weapons(kits: dict | None) -> tuple[set[str], set[str]]:
    """`kits.json`'s weapon names, lower case: every kit's primary, and every
    item of every kit."""
    primary: set[str] = set()
    items: set[str] = set()
    for kit in (kits or {}).get("kits") or []:
        if kit.get("primary"):
            primary.add(str(kit["primary"]).lower())
        for item in kit.get("items") or []:
            if isinstance(item, dict) and item.get("template"):
                items.add(str(item["template"]).lower())
    return primary, items


def candidates(index: dict, kits: dict | None = None, recipes=None, singles=None) -> dict[str, list[tuple[str, str]]]:
    """Each soldier's poses in the order they are tried, `(kind, stem)`: a
    recipe before a single-file pose (it is the smaller read); a kit's
    primary weapon before another item, and an item before anything else (a
    seat's pose has no stance clips; `kits` is the tree's `kits.json`); then
    the pose most of the tree's soldiers have, so they come out posed alike
    and share a body; then by name. The first that is there and has the
    three stance clips is the one posed. A function of the index and the
    kits alone, so a stage that holds only the chosen files picks what the
    whole tree would."""
    recipes = sorted(index.get("recipe") or []) if recipes is None else recipes
    singles = sorted(index.get("glb") or []) if singles is None else singles
    primary, items = kit_weapons(kits)
    holders: dict[tuple[str, str], set[str]] = {}
    out: dict[str, list[tuple[str, str]]] = {}
    for kind, stems in (("recipe", recipes), ("glb", singles)):
        for stem in stems:
            if "__" not in stem:
                continue
            holders.setdefault((kind, stem.split("__", 1)[1]), set()).add(_soldier_of(stem))
            out.setdefault(_soldier_of(stem), []).append((kind, stem))

    def rank(item):
        kind, stem = item
        pose = stem.split("__", 1)[1]
        return (kind != "recipe", pose.lower() not in primary, pose.lower() not in items,
                -len(holders[(kind, pose)]), stem)
    return {soldier: sorted(found, key=rank) for soldier, found in sorted(out.items())}


def build(poses: Path, glbs: Path | None = None, log=None) -> dict:
    """`stances.json` for the poses tree `poses`. A file the tree itself does
    not hold is looked up in the content store `glbs` by the index's sha."""
    poses = Path(poses)
    index_file = poses / "index.json"
    index = json.loads(index_file.read_text()) if index_file.exists() else {}
    recipes = sorted(index.get("recipe") or (p.name[:-len(".pose.json")] for p in poses.glob("*.pose.json")))
    singles = sorted(index.get("glb") or (p.name[:-len(".pose.glb")] for p in poses.glob("*.pose.glb")))
    shas = index.get("sha") or {}
    kits_file = poses.parent / "kits.json"
    kits = json.loads(kits_file.read_text()) if kits_file.exists() else None

    def locate(rel: str) -> Path | None:
        local = poses / rel
        if local.exists():
            return local
        sha = shas.get(rel)
        if sha and glbs and (Path(glbs) / f"{sha}.glb").exists():
            return Path(glbs) / f"{sha}.glb"
        return None

    bodies: list[dict] = []
    seen: dict[str, int] = {}
    soldiers: dict[str, dict] = {}

    def keep(soldier: str, source: str, body: dict | None) -> bool:
        if not body:
            return False
        text = json.dumps(body, sort_keys=True)
        if text not in seen:
            seen[text] = len(bodies)
            bodies.append(body)
        soldiers[soldier] = {"body": seen[text], "source": source}
        return True

    def from_recipe(stem: str) -> dict | None:
        recipe_file = poses / f"{stem}.pose.json"
        if not recipe_file.exists():
            return None
        recipe = json.loads(recipe_file.read_text())
        clips = recipe.get("clips") or {}
        rig_file = locate(recipe["rig"]) if recipe.get("rig") else None
        if not rig_file or not all(name in clips for name in STANCE_CLIPS.values()):
            return None
        return body_from_recipe(read_glb(rig_file)[0], recipe)

    def from_single(stem: str) -> dict | None:
        file = locate(f"{stem}.pose.glb")
        if not file:
            return None
        doc, blob = read_glb(file)
        names = {a.get("name") for a in doc.get("animations") or []}
        if not set(STANCE_CLIPS.values()) <= names:
            return None           # a seat's or a gun's pose: no stance clips
        return body_from_glb(doc, blob)

    for soldier, stems in candidates(index, kits, recipes, singles).items():
        for kind, stem in stems:
            try:
                if keep(soldier, stem, from_recipe(stem) if kind == "recipe" else from_single(stem)):
                    break
            except (ValueError, KeyError, IndexError, struct.error) as error:
                if log:
                    log(f"{stem}: {error}")
    # The body most soldiers share: what a soldier the tree poses only in
    # seats is given (the skeleton is the same one).
    used = [row["body"] for row in soldiers.values()]
    default = max(sorted(set(used)), key=used.count) if used else None
    return {"format": FORMAT, "bodies": bodies, "default": default,
            "soldiers": dict(sorted(soldiers.items()))}


def write(poses: Path, glbs: Path | None = None, out: Path | None = None, log=None) -> dict:
    doc = build(poses, glbs, log)
    target = Path(out) if out else Path(poses) / "stances.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    return doc
