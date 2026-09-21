"""Break a real `.glb` on purpose, so the verifier can be caught passing.

A verifier that stopped saying "broken" is the same bug as one that always
says it, with the sign flipped, and the only way to know which one you have is
to hand it something that really is broken. Synthetic scenes answer half of
that -- they say the check computes what it claims -- but they are built by the
same understanding the check was built from, so they cannot catch a check that
has quietly stopped reaching real files.

So these functions take an `.glb` the pipeline actually produced and reproduce,
in its own bytes, the failure modes the pipeline has had:

* `collapse_translations` -- every sub-part's placement lost, which is the
  `bindToSkeletonPart` bug and the Sherman-onto-the-hull case W3-E raised,
* `scale_root` -- the whole coordinate chain off by a factor,
* `unbind` -- a bind silently dropped, the part left wherever it fell,
* `strip_extras` -- a soldier's skeleton lost while its skins stay,
* `drop_node` -- a part that never reached the file,
* `mirror_z` -- the `.ske` read unmirrored, which is what the silhouette
  check exists for.

Only the JSON chunk is rewritten; the binary chunk is copied through
untouched, so the geometry is still the real geometry and every reading the
verifier takes is a reading of a real model.
"""

from __future__ import annotations

import copy
import json
import struct
from pathlib import Path

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def read(path: Path) -> tuple[dict, bytes]:
    """The JSON document and binary chunk of a `.glb`."""
    data = Path(path).read_bytes()
    doc: dict | None = None
    blob = b""
    offset = 12
    while offset + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        if kind == CHUNK_JSON:
            doc = json.loads(data[offset:offset + length].decode("utf-8"))
        elif kind == CHUNK_BIN:
            blob = data[offset:offset + length]
        offset += length + (-length % 4)
    if doc is None:
        raise ValueError(f"no JSON chunk in {path}")
    return doc, blob


def write(path: Path, doc: dict, blob: bytes) -> Path:
    """Serialise a document and binary chunk back into a `.glb`."""
    text = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    text += b" " * (-len(text) % 4)
    body = struct.pack("<II", len(text), CHUNK_JSON) + text
    if blob:
        padded = blob + b"\0" * (-len(blob) % 4)
        body += struct.pack("<II", len(padded), CHUNK_BIN) + padded
    header = struct.pack("<III", GLB_MAGIC, 2, 12 + len(body))
    path = Path(path)
    path.write_bytes(header + body)
    return path


def _nodes(doc: dict, names: set[str] | None):
    for index, node in enumerate(doc.get("nodes", [])):
        if names is None or node.get("name") in names:
            yield index, node


def mutate(source: Path, dest: Path, *changes) -> Path:
    """Apply each `change(doc)` to a copy of `source`, written to `dest`."""
    doc, blob = read(source)
    doc = copy.deepcopy(doc)
    for change in changes:
        change(doc)
    return write(dest, doc, blob)


# -- the mutations ---------------------------------------------------------- #

def collapse_translations(names: set[str] | None = None,
                          to: tuple[float, float, float] = (0.0, 0.0, 0.0)):
    """Lose every named node's placement, leaving it at `to`.

    With `names=None` every mesh-bearing node below the scene root collapses,
    which is what a `setPosition` read as a property of the parent does.
    """
    def change(doc: dict) -> None:
        roots = set(doc.get("scenes", [{}])[doc.get("scene", 0)].get("nodes", []))
        for index, node in _nodes(doc, names):
            if index in roots:
                continue
            node["translation"] = list(to)
    return change


def scale_root(factor: float):
    """Scale the whole scene, as a units mix-up in the coordinate chain would."""
    def change(doc: dict) -> None:
        scene = doc.get("scenes", [{}])[doc.get("scene", 0)]
        for index in scene.get("nodes", []):
            node = doc["nodes"][index]
            existing = node.get("scale", [1.0, 1.0, 1.0])
            node["scale"] = [v * factor for v in existing]
    return change


def unbind(names: set[str] | None = None):
    """Drop the `boundBone` extra, as a bind that was never applied would."""
    def change(doc: dict) -> None:
        for _index, node in _nodes(doc, names):
            (node.get("extras") or {}).pop("boundBone", None)
    return change


def strip_extras(*keys: str, names: set[str] | None = None):
    """Remove extras the exporter wrote -- `"skeleton"` loses a soldier's rig."""
    def change(doc: dict) -> None:
        for _index, node in _nodes(doc, names):
            for key in keys:
                (node.get("extras") or {}).pop(key, None)
    return change


def drop_node(name: str):
    """Detach a part: unlink it from its parent and from the scene."""
    def change(doc: dict) -> None:
        targets = {i for i, n in enumerate(doc.get("nodes", []))
                   if n.get("name") == name}
        if not targets:
            raise KeyError(f"no node named {name}")
        for node in doc.get("nodes", []):
            if "children" in node:
                node["children"] = [c for c in node["children"]
                                    if c not in targets]
        for scene in doc.get("scenes", []):
            scene["nodes"] = [n for n in scene.get("nodes", [])
                              if n not in targets]
    return change


def mirror_z(names: set[str] | None = None):
    """Negate Z on the named nodes -- the unmirrored `.ske` read."""
    def change(doc: dict) -> None:
        for _index, node in _nodes(doc, names):
            t = node.get("translation")
            if t:
                node["translation"] = [t[0], t[1], -t[2]]
    return change


def bound_part_names(doc: dict) -> set[str]:
    """Every node the exporter placed from a skeleton bone."""
    return {n.get("name") for n in doc.get("nodes", [])
            if (n.get("extras") or {}).get("boundBone")}
