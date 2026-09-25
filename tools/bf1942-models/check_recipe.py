#!/usr/bin/env python3
"""Compare a split recipe against the monolithic pose glb it came from.

Every number in a recipe is one the glb already holds — the joint nodes' static
transforms, the stance clips' channel values, the weapon's grip transform — so
this is the check that the recipe format is lossless for what a viewer draws.

    python3 tools/bf1942-models/check_recipe.py <pose.glb> <pose.json>

Exits non-zero and prints every disagreement otherwise.
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

COMPONENT = {5126: ("f", 4), 5123: ("H", 2), 5121: ("B", 1), 5125: ("I", 4)}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def canonical(name: str) -> str:
    return name.replace("_", " ").strip().lower()


def parse_glb(data: bytes) -> dict:
    """A `.glb`'s JSON document, with its binary chunk under `_bin`."""
    assert data[:4] == b"glTF", "not a glb"
    offset, chunks = 12, []
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        chunks.append((kind, data[offset + 8:offset + 8 + length]))
        offset += 8 + length
    doc = json.loads(chunks[0][1].decode("utf-8"))
    doc["_bin"] = chunks[1][1] if len(chunks) > 1 else b""
    return doc


def read_glb(path: Path) -> dict:
    return parse_glb(Path(path).read_bytes())


def accessor(doc: dict, index: int) -> list[tuple]:
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    fmt, size = COMPONENT[acc["componentType"]]
    width = WIDTH[acc["type"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or size * width
    out = []
    for i in range(acc["count"]):
        base = start + i * stride
        out.append(tuple(struct.unpack_from("<" + fmt * width, doc["_bin"], base)))
    return out


def glb_state(doc: dict) -> dict:
    """The glb as a recipe would write it: joints, clips and the grip."""
    names = [canonical(node.get("name", "")) for node in doc["nodes"]]
    joints = {}
    for index, node in enumerate(doc["nodes"]):
        if not node.get("extras", {}).get("joint"):
            continue
        quat = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
        trans = node.get("translation", [0.0, 0.0, 0.0])
        joints[names[index]] = list(quat) + list(trans)

    clips = {}
    for animation in doc.get("animations", []):
        bones: dict[str, list[list[float]]] = {}
        times: list[float] | None = None
        for channel in animation["channels"]:
            sampler = animation["samplers"][channel["sampler"]]
            node = channel["target"]["node"]
            path = channel["target"]["path"]
            key_times = [t[0] for t in accessor(doc, sampler["input"])]
            values = accessor(doc, sampler["output"])
            if times is None:
                times = key_times
            entry = bones.setdefault(names[node], [[0.0] * 7 for _ in values])
            for i, value in enumerate(values):
                if path == "rotation":
                    entry[i][:4] = list(value)
                elif path == "translation":
                    entry[i][4:] = list(value)
        clips[animation["name"]] = {"times": times, "bones": bones}

    grip = next((n for n in doc["nodes"]
                 if str(n.get("name", "")).endswith(" grip")), None)
    roots = [doc["nodes"][i] for i in doc["scenes"][doc.get("scene", 0)]["nodes"]]
    root = next(n for n in roots
                if n.get("extras", {}).get("soldier") and "mesh" not in n)
    return {
        "joints": joints,
        "clips": clips,
        "attach": (list(grip.get("rotation", [0.0, 0.0, 0.0, 1.0]))
                   + list(grip.get("translation", [0.0, 0.0, 0.0]))) if grip else None,
        "root": list(root.get("rotation", [0.0, 0.0, 0.0, 1.0])),
    }


TOL = 3e-6


def close(a, b) -> bool:
    return abs(a - b) <= TOL + 1e-5 * max(abs(a), abs(b))


def main() -> int:
    glb_path, recipe_path = Path(sys.argv[1]), Path(sys.argv[2])
    doc = read_glb(glb_path)
    state = glb_state(doc)
    recipe = json.loads(recipe_path.read_text())
    bad: list[str] = []

    for bone, values in recipe["joints"].items():
        want = state["joints"].get(bone)
        if want is None:
            bad.append(f"joints: {bone} is not a joint node in the glb")
        elif not all(close(x, y) for x, y in zip(values, want)):
            bad.append(f"joints: {bone} {values} != {want}")

    for name, clip in recipe["clips"].items():
        want = state["clips"].get(name)
        if want is None:
            bad.append(f"clips: the glb has no {name}")
            continue
        if "still" in clip:
            for bone, values in clip["still"].items():
                got = want["bones"].get(bone)
                if got is None or not all(close(x, y) for x, y in zip(values, got[0])):
                    bad.append(f"clips: {name}.{bone} {values} != {got}")
        else:
            if len(clip["times"]) != len(want["times"]):
                bad.append(f"clips: {name} has {len(clip['times'])} keys, "
                           f"the glb {len(want['times'])}")
                continue
            for i, (a, b) in enumerate(zip(clip["times"], want["times"])):
                if not close(a, b):
                    bad.append(f"clips: {name} key {i} at {a} != {b}")
            for bone, keys in clip["bones"].items():
                got = want["bones"].get(bone)
                if got is None:
                    bad.append(f"clips: {name}.{bone} is not in the glb clip")
                    continue
                if len(keys) != len(got):
                    bad.append(f"clips: {name}.{bone} has {len(keys)} keys, "
                               f"the glb {len(got)}")
                    continue
                for i, (a, b) in enumerate(zip(keys, got)):
                    if not all(close(x, y) for x, y in zip(a, b)):
                        bad.append(f"clips: {name}.{bone} key {i} {a} != {b}")

    if recipe.get("attach") and state["attach"] is not None:
        got = recipe["attach"]["q"] + recipe["attach"]["t"]
        if not all(close(x, y) for x, y in zip(got, state["attach"])):
            bad.append(f"attach {got} != {state['attach']}")

    if not all(close(x, y) for x, y in zip(recipe["root"]["q"], state["root"])):
        bad.append(f"root {recipe['root']['q']} != {state['root']}")

    if bad:
        print(f"{glb_path.name} vs {recipe_path.name}: {len(bad)} disagreements")
        for line in bad[:20]:
            print("  " + line)
        return 1
    print(f"ok: {recipe_path.name} reproduces {glb_path.name} "
          f"({len(recipe['joints'])} joints, "
          f"{sum(len(c.get('still') or c.get('bones') or {}) for c in recipe['clips'].values())} clip entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
