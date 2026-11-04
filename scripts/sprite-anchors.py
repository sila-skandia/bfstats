#!/usr/bin/env python3
"""Anchors of a soldier sprite strip (scripts/render-loader-sprites.sh), in CSS
pixels of one frame (the strip is drawn at 2x): per frame, the forward-most
opaque pixel (the muzzle: rightmost for a man facing right, leftmost facing
left) and the top of the head. Scene modules copy these numbers.

    python3 scripts/sprite-anchors.py tools/bf1942-models/viewer/play/loaders/duel-us.webp right 3
"""
import json
import sys

from PIL import Image


def anchors(path: str, facing: str, frames: int) -> list[dict]:
    im = Image.open(path).convert("RGBA")
    fw = im.width // frames
    out = []
    for i in range(frames):
        a = im.crop((i * fw, 0, (i + 1) * fw, im.height)).getchannel("A")
        px = a.load()
        pts = [(x, y) for y in range(a.height) for x in range(a.width) if px[x, y] > 96]
        top = min(pts, key=lambda p: p[1])
        fwd = max(pts, key=lambda p: p[0]) if facing == "right" else min(pts, key=lambda p: p[0])
        # The muzzle row: average y of the opaque pixels within 3 px of the forward edge.
        edge = [p for p in pts if abs(p[0] - fwd[0]) <= 3]
        muzzle_y = sum(p[1] for p in edge) / len(edge)
        out.append({"muzzle": [round(fwd[0] / 2, 1), round(muzzle_y / 2, 1)], "top": [round(top[0] / 2, 1), round(top[1] / 2, 1)]})
    return out


if __name__ == "__main__":
    path, facing, frames = sys.argv[1], sys.argv[2], int(sys.argv[3])
    im = Image.open(path)
    print(json.dumps({"frame": [im.width / frames / 2, im.height / 2], "poses": anchors(path, facing, frames)}))
