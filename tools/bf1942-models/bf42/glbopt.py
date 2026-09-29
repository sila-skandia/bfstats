"""Post-process a finished glb so the tree it lives in costs less to store and serve.

Phase 1 of `features/mesh-asset-size`: every image embedded in a glb moves to
one content-addressed texture store shared by the whole mesh root,

    <mesh root>/textures/<2 hex>/<32 hex>.webp

as a lossless WebP, and the glb points at it through `EXT_texture_webp` with a
URI relative to where the glb sits. The name is a hash of the decoded pixels, so
the Spitfire's skin baked into twenty levels, two packs and the model tree is one
file, fetched once and cached for good.

Nothing the viewer draws moves: before a glb is rewritten, every stored image is
decoded again and compared with the embedded PNG pixel for pixel, and every
other byte of the file (the JSON bar images and textures, every non-image
buffer view) is carried over unchanged. A glb with no embedded image is left
alone, so running this twice changes nothing the second time.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import struct
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
WEBP_EXT = "EXT_texture_webp"


def read_glb(data: bytes) -> tuple[dict, bytes]:
    magic, version, _total = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC or version != 2:
        raise ValueError("not a glTF 2.0 binary")
    json_len, json_type = struct.unpack_from("<II", data, 12)
    if json_type != CHUNK_JSON:
        raise ValueError("first chunk is not JSON")
    doc = json.loads(data[20:20 + json_len])
    blob = b""
    at = 20 + json_len
    if at + 8 <= len(data):
        bin_len, bin_type = struct.unpack_from("<II", data, at)
        if bin_type == CHUNK_BIN:
            blob = data[at + 8:at + 8 + bin_len]
    return doc, blob


def write_glb(doc: dict, blob: bytes) -> bytes:
    """The same layout `GlbBuilder.build` writes: compact JSON, space and zero padding."""
    json_bytes = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * (-len(json_bytes) % 4)
    blob = blob + b"\0" * (-len(blob) % 4)
    chunks = struct.pack("<II", len(json_bytes), CHUNK_JSON) + json_bytes
    if blob:
        chunks += struct.pack("<II", len(blob), CHUNK_BIN) + blob
    return struct.pack("<III", GLB_MAGIC, 2, 12 + len(chunks)) + chunks


def _rgba_key(image: Image.Image) -> tuple[Image.Image, str]:
    """The image as the browser will hand it to WebGL, and the store name for it.

    WebP holds RGB or RGBA; a greyscale or palette PNG decodes to the same RGB(A)
    the browser would produce from it. RGB stays RGB (no alpha plane to store).
    """
    if image.mode not in ("RGB", "RGBA"):
        has_alpha = image.mode in ("LA", "PA") or "transparency" in image.info
        image = image.convert("RGBA" if has_alpha else "RGB")
    digest = hashlib.sha256()
    digest.update(f"{image.mode}:{image.width}x{image.height}:".encode())
    digest.update(image.tobytes())
    return image, digest.hexdigest()[:32]


def _same_pixels(decoded: Image.Image, image: Image.Image) -> bool:
    # libwebp leaves out an alpha plane that is 255 everywhere, so an opaque
    # RGBA image comes back RGB: the same texels once WebGL gives it alpha 1.
    decoded.load()
    if decoded.mode != image.mode:
        decoded = decoded.convert(image.mode)
    return decoded.size == image.size and decoded.tobytes() == image.tobytes()


def encode_webp(image: Image.Image) -> bytes:
    out = io.BytesIO()
    # `exact` keeps the RGB under fully transparent texels: the extractor bleeds
    # colour into them on purpose (`_bleed_alpha`) so filtering does not fringe.
    # Method 4 at quality 75 comes within 6% of the smallest lossless WebP in a
    # 37th of the time (Kursk, 30 textures). The store name is the pixels, not
    # the file, so a slower re-encode later needs nothing else to change.
    image.save(out, "WEBP", lossless=True, quality=75, method=4, exact=True)
    return out.getvalue()


class TextureStore:
    """`<mesh root>/textures`: one file per distinct image, named by its pixels."""

    def __init__(self, mesh_root: Path) -> None:
        self.mesh_root = Path(mesh_root)
        self.root = self.mesh_root / "textures"

    def relative(self, key: str) -> str:
        return f"{key[:2]}/{key}.webp"

    def path(self, key: str) -> Path:
        return self.root / self.relative(key)

    def put(self, image: Image.Image, key: str) -> tuple[Path, bool]:
        """Store the image unless it is there already. Returns (path, written)."""
        target = self.path(key)
        if target.exists():
            return target, False
        data = encode_webp(image)
        if not _same_pixels(Image.open(io.BytesIO(data)), image):
            raise ValueError(f"lossless WebP round trip moved pixels for {key}")
        target.parent.mkdir(parents=True, exist_ok=True)
        # Never replace a file that exists: another worker may have just written
        # the same texture, and a stored file is shared through hard links.
        tmp = target.with_name(f".{target.name}.{os.getpid()}.tmp")
        tmp.write_bytes(data)
        try:
            os.link(tmp, target)
            written = True
        except FileExistsError:
            written = False
        finally:
            tmp.unlink()
        return target, written

    def check(self, key: str, image: Image.Image) -> None:
        """A stored file decodes to exactly these pixels (it may predate this run)."""
        if not _same_pixels(Image.open(self.path(key)), image):
            raise ValueError(f"{self.path(key)} does not hold the pixels its name says")


@dataclass
class Result:
    changed: bool = False
    bytes_before: int = 0
    bytes_after: int = 0
    images: int = 0
    stored: list[str] = field(default_factory=list)
    written: list[str] = field(default_factory=list)


def externalise_images(data: bytes, glb_path: Path, store: TextureStore) -> tuple[bytes, Result]:
    """Move every embedded image of one glb into the store. `glb_path` is where
    the glb will be served from; image URIs are relative to it."""
    result = Result(bytes_before=len(data), bytes_after=len(data))
    doc, blob = read_glb(data)
    images = doc.get("images") or []
    embedded = [i for i, image in enumerate(images) if "bufferView" in image]
    if not embedded:
        return data, result

    views = doc["bufferViews"]
    image_views = {images[i]["bufferView"] for i in embedded}
    # A view shared with anything but an image would be dropped from under it.
    for accessor in doc.get("accessors", []):
        if accessor.get("bufferView") in image_views:
            raise ValueError(f"{glb_path}: a buffer view is both an image and an accessor")

    base = glb_path.parent
    for i in embedded:
        image_def = images[i]
        view = views[image_def["bufferView"]]
        start = view.get("byteOffset", 0)
        png = blob[start:start + view["byteLength"]]
        decoded = Image.open(io.BytesIO(png))
        decoded.load()
        rgba, key = _rgba_key(decoded)
        path, written = store.put(rgba, key)
        if not written:
            store.check(key, rgba)
        rel = os.path.relpath(path, base).replace(os.sep, "/")
        new_def = {"uri": rel, "mimeType": "image/webp"}
        if "name" in image_def:
            new_def["name"] = image_def["name"]
        images[i] = new_def
        result.stored.append(key)
        if written:
            result.written.append(key)
    result.images = len(embedded)

    # Point every texture drawing an embedded image at it through the extension.
    # glTF core allows only PNG and JPEG as a texture's `source`.
    moved = set(embedded)
    for texture in doc.get("textures", []):
        source = texture.get("source")
        if source in moved:
            del texture["source"]
            texture.setdefault("extensions", {})[WEBP_EXT] = {"source": source}

    # Repack the buffer without the image views, every survivor at the same
    # 4-byte alignment `GlbBuilder._view` gives it, in the same order.
    remap: dict[int, int] = {}
    new_views: list[dict] = []
    new_blob = bytearray()
    for index, view in enumerate(views):
        if index in image_views:
            continue
        while len(new_blob) % 4:
            new_blob.append(0)
        start = view.get("byteOffset", 0)
        moved_view = dict(view)
        moved_view["byteOffset"] = len(new_blob)
        new_blob += blob[start:start + view["byteLength"]]
        remap[index] = len(new_views)
        new_views.append(moved_view)
    doc["bufferViews"] = new_views
    for accessor in doc.get("accessors", []):
        if "bufferView" in accessor:
            accessor["bufferView"] = remap[accessor["bufferView"]]
    for image in images:
        if "bufferView" in image:
            image["bufferView"] = remap[image["bufferView"]]
    doc["buffers"] = [{"byteLength": len(new_blob)}] if new_blob else []
    if not new_blob:
        del doc["buffers"]
        if not new_views:
            del doc["bufferViews"]

    used = set(doc.get("extensionsUsed", [])) | {WEBP_EXT}
    required = set(doc.get("extensionsRequired", [])) | {WEBP_EXT}
    doc["extensionsUsed"] = sorted(used)
    doc["extensionsRequired"] = sorted(required)

    out = write_glb(doc, bytes(new_blob))
    _check_same(data, out, glb_path)
    result.changed = True
    result.bytes_after = len(out)
    return out, result


def _check_same(before: bytes, after: bytes, glb_path: Path) -> None:
    """Everything but the image plumbing is the same, byte for byte."""
    old_doc, old_blob = read_glb(before)
    new_doc, new_blob = read_glb(after)

    def view_bytes(doc, blob, index):
        view = doc["bufferViews"][index]
        start = view.get("byteOffset", 0)
        return blob[start:start + view["byteLength"]]

    old_accessors = old_doc.get("accessors", [])
    new_accessors = new_doc.get("accessors", [])
    if len(old_accessors) != len(new_accessors):
        raise AssertionError(f"{glb_path}: accessor count moved")
    for a, b in zip(old_accessors, new_accessors):
        if {k: v for k, v in a.items() if k != "bufferView"} != {k: v for k, v in b.items() if k != "bufferView"}:
            raise AssertionError(f"{glb_path}: an accessor changed")
        if "bufferView" in a:
            va, vb = old_doc["bufferViews"][a["bufferView"]], new_doc["bufferViews"][b["bufferView"]]
            if ({k: v for k, v in va.items() if k != "byteOffset"}
                    != {k: v for k, v in vb.items() if k != "byteOffset"}):
                raise AssertionError(f"{glb_path}: a buffer view changed")
            if view_bytes(old_doc, old_blob, a["bufferView"]) != view_bytes(new_doc, new_blob, b["bufferView"]):
                raise AssertionError(f"{glb_path}: accessor bytes changed")

    plumbing = {"images", "textures", "bufferViews", "buffers", "accessors",
                "extensionsUsed", "extensionsRequired"}
    for key in set(old_doc) | set(new_doc):
        if key in plumbing:
            continue
        if old_doc.get(key) != new_doc.get(key):
            raise AssertionError(f"{glb_path}: '{key}' changed")
    for old_t, new_t in zip(old_doc.get("textures", []), new_doc.get("textures", [])):
        rest_old = {k: v for k, v in old_t.items() if k not in ("source", "extensions")}
        rest_new = {k: v for k, v in new_t.items() if k not in ("source", "extensions")}
        source = new_t.get("source", new_t.get("extensions", {}).get(WEBP_EXT, {}).get("source"))
        if rest_old != rest_new or old_t.get("source") != source:
            raise AssertionError(f"{glb_path}: a texture changed")
