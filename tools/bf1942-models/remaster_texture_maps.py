#!/usr/bin/env python3
"""Normal and roughness maps for remaster mode (features/remaster-browser).

    tools/bf1942-models/.venv-remaster/bin/python tools/bf1942-models/remaster_texture_maps.py \
        viewer/maps/wake/scene.glb viewer/maps/battle_of_britain/scene.glb 'viewer/models/**/*.glb'

The venv is the worktree's own (numpy, Pillow; neither is installed
system-wide): `python3 -m venv tools/bf1942-models/.venv-remaster &&
tools/bf1942-models/.venv-remaster/bin/pip install numpy pillow`.

For every texture of the content-addressed store (`viewer/textures/<aa>/
<hash>.webp`) that the given glbs name, writes one WebP beside a
manifest, under `viewer/remaster-textures/`:

    R, G   the tangent-space normal's x and y, as n * 0.5 + 0.5
    B      roughness, 0..1

and `viewer/remaster-textures/index.json` lists the hashes written, which
the page reads so it never asks for one that is not there. The store is read,
never written.

BF1942's textures are painted with their light in them, so a height taken
straight from brightness would turn every painted shadow into a slope. The
height is the texture's luminance with its broad shading taken out (a high
pass at an eighth of the texture's size): what is left is grain, mortar,
rivets, planks, bark, the relief that the paint drew. Roughness follows the
same reading: broad bright surfaces (paint, concrete, metal) a little
smoother, fine busy detail and dark crevices rougher.
"""

from __future__ import annotations

import argparse
import glob
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
VIEWER = HERE / "viewer"
OUT = VIEWER / "remaster-textures"
STORE = "textures/"


def glb_images(path: Path) -> list[str]:
    """The image URIs a glb names."""
    with path.open("rb") as f:
        head = f.read(12)
        if head[:4] != b"glTF":
            return []
        length, _ = struct.unpack("<II", f.read(8))
        doc = json.loads(f.read(length))
    return [i["uri"] for i in doc.get("images", []) if i.get("uri")]


def store_hash(uri: str) -> str | None:
    """`../../textures/ab/abcdef....webp` -> `abcdef...`, else None."""
    if STORE not in uri:
        return None
    name = uri.rsplit("/", 1)[-1]
    return name.split(".", 1)[0]


def box_blur(a: np.ndarray, r: int) -> np.ndarray:
    """A wrapped box blur of radius r, separable, by cumulative sums."""
    if r < 1:
        return a
    for axis in (0, 1):
        pad = np.concatenate([a.take(range(-r, 0), axis=axis), a, a.take(range(0, r), axis=axis)], axis=axis)
        c = np.cumsum(pad, axis=axis, dtype=np.float64)
        n = a.shape[axis]
        hi = c.take(range(2 * r, 2 * r + n), axis=axis)
        lo = np.concatenate([np.zeros_like(c.take([0], axis=axis)), c.take(range(0, n - 1), axis=axis)], axis=axis)
        a = ((hi - lo) / (2 * r + 1)).astype(np.float32)
    return a


def maps_for(rgb: np.ndarray) -> np.ndarray:
    """The packed normal (RG) and roughness (B) for one texture, 0..255."""
    h, w = rgb.shape[:2]
    lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]).astype(np.float32)
    # The broad shading out: a gaussian-ish low pass (three box passes) at
    # an eighth of the texture.
    r = max(1, min(h, w) // 16)
    low = box_blur(box_blur(box_blur(lum, r), r), r)
    detail = lum - low
    # A touch of smoothing so single-texel noise is not a bump.
    height = box_blur(detail, 1)
    # Slope in texels, scaled so a 512 texture and a 128 one read alike.
    k = 3.2 * (min(h, w) / 512.0) ** 0.5
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5
    nx, ny = -dx * k * 8.0, -dy * k * 8.0
    nz = np.ones_like(nx)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny = nx * inv, ny * inv
    # Roughness: 0.92 at mid-grey, down toward 0.55 on broad bright
    # surfaces, up toward 1 where the detail is busy or the paint is dark.
    busy = box_blur(np.abs(detail), max(1, r // 2))
    rough = 0.92 - 0.38 * np.clip(low - 0.45, 0, 1) / 0.55 + 2.5 * busy + 0.12 * np.clip(0.25 - low, 0, 1) / 0.25
    rough = np.clip(rough, 0.5, 1.0)
    out = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, rough], axis=-1)
    return np.clip(out * 255.0 + 0.5, 0, 255).astype(np.uint8)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("glbs", nargs="+", help="glb paths or globs, relative to tools/bf1942-models")
    ap.add_argument("--force", action="store_true", help="rewrite maps that exist")
    args = ap.parse_args(argv)

    hashes: dict[str, Path] = {}
    for pattern in args.glbs:
        for p in sorted(glob.glob(str(HERE / pattern), recursive=True)):
            for uri in glb_images(Path(p)):
                hsh = store_hash(uri)
                if not hsh:
                    continue
                src = VIEWER / "textures" / hsh[:2] / f"{hsh}.webp"
                if src.exists():
                    hashes[hsh] = src
    OUT.mkdir(parents=True, exist_ok=True)
    index_path = OUT / "index.json"
    done = set(json.loads(index_path.read_text())["hashes"]) if index_path.exists() else set()
    written = 0
    for i, (hsh, src) in enumerate(sorted(hashes.items())):
        dst = OUT / hsh[:2] / f"{hsh}.webp"
        if dst.exists() and not args.force:
            done.add(hsh)
            continue
        with Image.open(src) as im:
            rgb = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
        dst.parent.mkdir(parents=True, exist_ok=True)
        # Lossy at 88: a normal map tolerates it, and lossless was 1.4 GB for
        # the two levels and the models tree (about 120 MB a level to load).
        Image.fromarray(maps_for(rgb), "RGB").save(dst, "WEBP", quality=88, method=4)
        done.add(hsh)
        written += 1
        if written % 50 == 0:
            print(f"  {written} written ({i + 1}/{len(hashes)})", flush=True)
    index_path.write_text(json.dumps({"format": "bf1942-remaster-texture-maps/1", "hashes": sorted(done)}) + "\n")
    print(f"{len(hashes)} store textures named; {written} maps written; {len(done)} in the index")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
