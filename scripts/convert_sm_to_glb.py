#!/usr/bin/env python3
"""Refractor StandardMesh (.sm) and DDS to glTF 2.0 Binary (.glb) Converter.

Extracts .sm geometry from standardMesh.rfa and .dds textures from texture.rfa,
converts DDS (DXT1/DXT3/DXT5/uncompressed) to PNG, and bundles geometry and
textures into self-contained binary glTF (.glb) models.

Iconic models produced:
- tiger.glb   (Tiger I: hull + turret + 88mm KwK cannon)
- sherman.glb (M4 Sherman: hull + turret + 75mm M3 cannon)
- spitfire.glb (Supermarine Spitfire Mk.Vb: fuselage + cockpit)
- b17.glb     (B-17 Flying Fortress)
- willy.glb   (Willys MB Jeep: body + steering + wheels)
"""

from __future__ import annotations

import argparse
import ctypes
import io
import json
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path
from typing import Any

from PIL import Image

# Load liblzo2 for RFA decompression
try:
    lzo = ctypes.CDLL("liblzo2.so.2")
    lzo.lzo1x_decompress_safe.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint,
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_uint),
        ctypes.c_void_p,
    ]
    lzo.lzo1x_decompress_safe.restype = ctypes.c_int
except Exception as e:
    sys.exit(f"Error loading liblzo2.so.2: {e}")

DEFAULT_GAME_ROOT = Path("/home/dylan/.wine/drive_c/EA Games/Battlefield 1942")
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODELS_OUT = REPO_ROOT / "tournament-images/models"
UI_MODELS_OUT = REPO_ROOT / "ui/public/stats/assets/models"


class RfaArchive:
    """Reads uncompressed and LZO-compressed Refractor 2 FlatArchive (RFA) files."""

    def __init__(self, path: Path):
        self.path = path
        self.data = path.read_bytes()
        self.entries: dict[str, tuple[int, int, int]] = {}
        self.lower_entries: dict[str, str] = {}
        self.compressed = False
        self._parse()

    def _parse(self) -> None:
        data = self.data
        if data[:28] == b"Refractor2 FlatArchive 1.1 ":
            offset = struct.unpack_from("<I", data, 28)[0]
            self.compressed = struct.unpack_from("<I", data, 32)[0] == 1
        else:
            offset, flag = struct.unpack_from("<II", data, 0)
            self.compressed = flag == 1

        count = struct.unpack_from("<I", data, offset)[0]
        pos = offset + 4
        for _ in range(count):
            name_len = struct.unpack_from("<I", data, pos)[0]
            pos += 4
            name = data[pos : pos + name_len].decode("latin1")
            pos += name_len
            compressed_size, uncompressed_size, file_offset = struct.unpack_from("<III", data, pos)
            pos += 24
            clean_name = name.replace("\\", "/")
            self.entries[clean_name] = (compressed_size, uncompressed_size, file_offset)
            self.lower_entries[clean_name.lower()] = clean_name

    def has(self, name: str) -> bool:
        clean = name.replace("\\", "/")
        return clean in self.entries or clean.lower() in self.lower_entries

    def extract(self, name: str) -> bytes:
        clean = name.replace("\\", "/")
        real_name = self.entries.get(clean) or self.lower_entries.get(clean.lower())
        if not real_name:
            raise KeyError(f"'{name}' not found in archive {self.path.name}")
        if isinstance(real_name, str):
            _cs, uncompressed_size, file_offset = self.entries[real_name]
        else:
            _cs, uncompressed_size, file_offset = real_name

        if not self.compressed:
            return self.data[file_offset : file_offset + uncompressed_size]

        segs = struct.unpack_from("<I", self.data, file_offset)[0]
        pieces: list[bytes] = []
        header = file_offset + 4
        for i in range(segs):
            seg_cs, seg_us, seg_off = struct.unpack_from("<III", self.data, header + 12 * i)
            start = header + 12 * segs + seg_off
            payload = self.data[start : start + seg_cs]
            out = ctypes.create_string_buffer(seg_us)
            out_len = ctypes.c_uint(seg_us)
            rc = lzo.lzo1x_decompress_safe(payload, seg_cs, out, ctypes.byref(out_len), None)
            if rc != 0:
                raise RuntimeError(f"LZO decompress failed ({rc}) for {name} in {self.path.name}")
            pieces.append(out.raw[: out_len.value])
        return b"".join(pieces)


class RfaCatalog:
    """Manages priority-ordered RFA archives (e.g. patch archives before base archives)."""

    def __init__(self, paths: list[Path]):
        self.archives = [RfaArchive(p) for p in paths if p.is_file()]

    def has(self, name: str) -> bool:
        clean = name.replace("\\", "/")
        for a in self.archives:
            if a.has(clean):
                return True
        stem = Path(clean).stem.lower()
        for a in self.archives:
            for k in a.lower_entries:
                if Path(k).stem.lower() == stem:
                    return True
        return False

    def extract(self, name: str) -> bytes:
        clean = name.replace("\\", "/")
        for a in self.archives:
            if a.has(clean):
                return a.extract(clean)
        # Search by stem (e.g. Tiger_Hull_M1.sm)
        stem = Path(clean).stem.lower()
        ext = Path(clean).suffix.lower()
        for a in self.archives:
            for k in a.lower_entries:
                kp = Path(k)
                if kp.stem.lower() == stem and (not ext or kp.suffix.lower() == ext):
                    return a.extract(k)
        raise KeyError(f"Asset '{name}' not found across archives")

    def find_texture(self, tex_ref: str) -> bytes | None:
        if not tex_ref:
            return None
        clean = tex_ref.replace("\\", "/").strip().lstrip("/")
        stem = Path(clean).stem.lower()

        # 1. Direct candidate paths
        candidates = [
            clean,
            f"{clean}.dds",
            f"{clean}.tga",
            f"texture/{Path(clean).name}.dds",
            f"texture/{Path(clean).name}.tga",
            f"texture/{stem}.dds",
        ]
        for cand in candidates:
            for a in self.archives:
                if a.has(cand):
                    return a.extract(cand)

        # 2. Match stem, preferring standard non-theater texture
        for a in self.archives:
            for k in a.lower_entries:
                if Path(k).stem.lower() == stem and not any(th in k.lower() for th in ["africa/", "russia/"]):
                    return a.extract(k)

        # 3. Match any stem
        for a in self.archives:
            for k in a.lower_entries:
                if Path(k).stem.lower() == stem:
                    return a.extract(k)

        # 4. Suffix mismatch recovery (e.g. b17win_l vs b17win_t)
        if "_" in stem:
            prefix = stem.rsplit("_", 1)[0]
            for a in self.archives:
                for k in a.lower_entries:
                    if Path(k).stem.lower().startswith(prefix) and not any(
                        th in k.lower() for th in ["africa/", "russia/"]
                    ):
                        return a.extract(k)
        return None


def parse_rs_materials(rs_text: str) -> dict[str, dict[str, Any]]:
    """Parses Refractor RenderScript (.rs) subshader definitions."""
    materials: dict[str, dict[str, Any]] = {}
    pattern = re.compile(r'subshader\s+"([^"]+)"[^{]*\{([^}]+)\}', re.MULTILINE | re.DOTALL)
    for match in pattern.finditer(rs_text):
        mat_name = match.group(1).strip()
        body = match.group(2)
        tex_match = re.search(r'texture\s+"([^"]+)"', body)
        tex_name = tex_match.group(1).strip() if tex_match else None
        trans = bool(re.search(r"transparent\s+true", body, re.IGNORECASE))
        twosided = bool(re.search(r"twosided\s+true", body, re.IGNORECASE))
        alpha_match = re.search(r"alphaTestRef\s+([0-9.]+)", body)
        alpha_ref = float(alpha_match.group(1)) if alpha_match else 0.5
        materials[mat_name.lower()] = {
            "texture": tex_name,
            "transparent": trans,
            "twosided": twosided,
            "alphaTestRef": alpha_ref,
        }
    return materials


def parse_sm_mesh(sm_bytes: bytes, offset: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> list[dict[str, Any]]:
    """Parses binary Refractor StandardMesh (.sm) LOD0 geometry."""
    f = io.BytesIO(sm_bytes)
    version = struct.unpack("<I", f.read(4))[0]
    f.read(4)  # 4 unknown bytes
    _bbox = struct.unpack("<6f", f.read(24))
    if version == 10:
        f.read(1)  # qflag padding

    num_col = struct.unpack("<I", f.read(4))[0]
    for _ in range(num_col):
        sec_sz = struct.unpack("<I", f.read(4))[0]
        f.seek(sec_sz, io.SEEK_CUR)

    num_lods = struct.unpack("<I", f.read(4))[0]
    if num_lods < 1:
        return []

    # Pass 1: LOD0 material headers
    num_mats = struct.unpack("<I", f.read(4))[0]
    mat_headers = []
    for _ in range(num_mats):
        nl = struct.unpack("<I", f.read(4))[0]
        mname = f.read(nl).decode("latin1")
        f.read(12)  # unknown
        render_type, vert_fmt, vert_byte_size, num_verts, num_indices, mat_settings = struct.unpack("<6I", f.read(24))
        mat_headers.append((mname, render_type, vert_fmt, vert_byte_size, num_verts, num_indices, mat_settings))

    # Pass 2: Vertices, normals, UVs, indices
    materials_data: list[dict[str, Any]] = []
    ox, oy, oz = offset

    for mname, render_type, _vert_fmt, vert_byte_size, num_verts, num_indices, _mat_settings in mat_headers:
        has_lightmap = vert_byte_size == 40
        positions: list[tuple[float, float, float]] = []
        normals: list[tuple[float, float, float]] = []
        uvs: list[tuple[float, float]] = []

        for _ in range(num_verts):
            x, y, z = struct.unpack("<3f", f.read(12))
            nx, ny, nz = struct.unpack("<3f", f.read(12))
            u, v = struct.unpack("<2f", f.read(8))
            if has_lightmap:
                f.read(8)

            # Coordinate transformation:
            # Refractor (X right, Y up, Z forward [left-handed]) to glTF 2.0 (X right, Y up, -Z forward [right-handed])
            positions.append((x + ox, y + oy, -(z + oz)))
            normals.append((nx, ny, -nz))
            # Refractor V coordinates are stored negative [-1.0, 0.0] -> convert to glTF [0.0, 1.0]
            uvs.append((u, -v))

        raw_indices = struct.unpack(f"<{num_indices}H", f.read(2 * num_indices))
        tri_indices: list[int] = []

        if render_type == 5:  # TriangleStrip
            for i in range(num_indices - 2):
                if i % 2 == 0:
                    tri_indices.extend([raw_indices[i], raw_indices[i + 2], raw_indices[i + 1]])
                else:
                    tri_indices.extend([raw_indices[i], raw_indices[i + 1], raw_indices[i + 2]])
        else:  # TriangleList (render_type == 4)
            # Inverting Z axis changes winding handedness, so reverse winding: (i0, i2, i1)
            for i in range(0, num_indices, 3):
                tri_indices.extend([raw_indices[i], raw_indices[i + 2], raw_indices[i + 1]])

        materials_data.append(
            {
                "name": mname,
                "positions": positions,
                "normals": normals,
                "uvs": uvs,
                "indices": tri_indices,
            }
        )

    return materials_data


def convert_dds_to_image_bytes(dds_bytes: bytes, fmt: str = "PNG") -> bytes:
    """Converts DXT1/DXT3/DXT5 or uncompressed DDS to PNG bytes."""
    try:
        im = Image.open(io.BytesIO(dds_bytes))
        out = io.BytesIO()
        im.save(out, format=fmt)
        return out.getvalue()
    except Exception:
        # Fallback to ffmpeg for any exotic DXT variant
        proc = subprocess.Popen(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "dds",
                "-i",
                "pipe:0",
                "-f",
                "image2",
                "-c:v",
                "png",
                "pipe:1",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stdout, _ = proc.communicate(input=dds_bytes)
        if proc.returncode == 0 and len(stdout) > 0:
            return stdout
        raise RuntimeError("Failed to decode DDS texture")


def build_binary_glb(model_name: str, mesh_parts: list[dict[str, Any]]) -> bytes:
    """Assembles geometry primitives and embedded textures into a binary glTF 2.0 (.glb) container."""
    bin_buffer = bytearray()
    buffer_views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []
    materials: list[dict[str, Any]] = []
    textures: list[dict[str, Any]] = []
    images: list[dict[str, Any]] = []
    primitives: list[dict[str, Any]] = []

    tex_cache: dict[str, int] = {}  # texture_key -> material_index

    def add_to_bin(data: bytes, alignment: int = 4) -> int:
        pad = (alignment - (len(bin_buffer) % alignment)) % alignment
        bin_buffer.extend(b"\x00" * pad)
        offset = len(bin_buffer)
        bin_buffer.extend(data)
        return offset

    for part in mesh_parts:
        mname = part["name"]
        tex_bytes = part.get("texture_bytes")
        is_transparent = part.get("transparent", False)
        is_twosided = part.get("twosided", False)
        alpha_cutoff = part.get("alphaTestRef", 0.5)

        # Unique material key
        mat_key = f"{part.get('texture_name', 'default')}:{is_transparent}:{is_twosided}"
        if mat_key not in tex_cache:
            mat_idx = len(materials)
            if tex_bytes:
                img_off = add_to_bin(tex_bytes, 4)
                bv_img = len(buffer_views)
                buffer_views.append(
                    {
                        "buffer": 0,
                        "byteOffset": img_off,
                        "byteLength": len(tex_bytes),
                    }
                )
                img_idx = len(images)
                images.append({"bufferView": bv_img, "mimeType": "image/png"})
                tex_idx = len(textures)
                textures.append({"sampler": 0, "source": img_idx})
                mat_def: dict[str, Any] = {
                    "name": mname,
                    "pbrMetallicRoughness": {
                        "baseColorTexture": {"index": tex_idx},
                        "metallicFactor": 0.08,
                        "roughnessFactor": 0.82,
                    },
                    "doubleSided": is_twosided,
                }
            else:
                mat_def = {
                    "name": mname,
                    "pbrMetallicRoughness": {
                        "baseColorFactor": [0.65, 0.65, 0.60, 1.0],
                        "metallicFactor": 0.08,
                        "roughnessFactor": 0.82,
                    },
                    "doubleSided": is_twosided,
                }

            if is_transparent:
                mat_def["alphaMode"] = "MASK"
                mat_def["alphaCutoff"] = alpha_cutoff

            materials.append(mat_def)
            tex_cache[mat_key] = mat_idx
        else:
            mat_idx = tex_cache[mat_key]

        pos = part["positions"]
        norm = part["normals"]
        uvs = part["uvs"]
        inds = part["indices"]

        if not inds or not pos:
            continue

        # Indices accessor
        ind_bytes = struct.pack(f"<{len(inds)}H", *inds)
        ind_off = add_to_bin(ind_bytes, 2)
        bv_ind = len(buffer_views)
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": ind_off,
                "byteLength": len(ind_bytes),
                "target": 34963,  # ELEMENT_ARRAY_BUFFER
            }
        )
        acc_ind = len(accessors)
        accessors.append(
            {
                "bufferView": bv_ind,
                "byteOffset": 0,
                "componentType": 5123,  # UNSIGNED_SHORT
                "count": len(inds),
                "type": "SCALAR",
            }
        )

        # Positions accessor
        pos_flat = [c for p in pos for c in p]
        pos_bytes = struct.pack(f"<{len(pos_flat)}f", *pos_flat)
        pos_off = add_to_bin(pos_bytes, 4)
        bv_pos = len(buffer_views)
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": pos_off,
                "byteLength": len(pos_bytes),
                "target": 34962,  # ARRAY_BUFFER
            }
        )
        acc_pos = len(accessors)
        accessors.append(
            {
                "bufferView": bv_pos,
                "byteOffset": 0,
                "componentType": 5126,  # FLOAT
                "count": len(pos),
                "type": "VEC3",
                "min": [min(p[0] for p in pos), min(p[1] for p in pos), min(p[2] for p in pos)],
                "max": [max(p[0] for p in pos), max(p[1] for p in pos), max(p[2] for p in pos)],
            }
        )

        # Normals accessor
        norm_flat = [c for n in norm for c in n]
        norm_bytes = struct.pack(f"<{len(norm_flat)}f", *norm_flat)
        norm_off = add_to_bin(norm_bytes, 4)
        bv_norm = len(buffer_views)
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": norm_off,
                "byteLength": len(norm_bytes),
                "target": 34962,  # ARRAY_BUFFER
            }
        )
        acc_norm = len(accessors)
        accessors.append(
            {
                "bufferView": bv_norm,
                "byteOffset": 0,
                "componentType": 5126,  # FLOAT
                "count": len(norm),
                "type": "VEC3",
            }
        )

        # UV accessor
        uv_flat = [c for u in uvs for c in u]
        uv_bytes = struct.pack(f"<{len(uv_flat)}f", *uv_flat)
        uv_off = add_to_bin(uv_bytes, 4)
        bv_uv = len(buffer_views)
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": uv_off,
                "byteLength": len(uv_bytes),
                "target": 34962,  # ARRAY_BUFFER
            }
        )
        acc_uv = len(accessors)
        accessors.append(
            {
                "bufferView": bv_uv,
                "byteOffset": 0,
                "componentType": 5126,  # FLOAT
                "count": len(uvs),
                "type": "VEC2",
            }
        )

        primitives.append(
            {
                "attributes": {
                    "POSITION": acc_pos,
                    "NORMAL": acc_norm,
                    "TEXCOORD_0": acc_uv,
                },
                "indices": acc_ind,
                "material": mat_idx,
            }
        )

    # Pad binary chunk to 4-byte boundary
    pad = (4 - (len(bin_buffer) % 4)) % 4
    bin_buffer.extend(b"\x00" * pad)

    gltf: dict[str, Any] = {
        "asset": {"version": "2.0", "generator": "bfstats-convert-sm-to-glb"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": model_name, "mesh": 0}],
        "meshes": [{"name": model_name, "primitives": primitives}],
        "materials": materials,
        "textures": textures,
        "images": images,
        "samplers": [
            {
                "magFilter": 9729,  # LINEAR
                "minFilter": 9987,  # LINEAR_MIPMAP_LINEAR
                "wrapS": 10497,  # REPEAT
                "wrapT": 10497,  # REPEAT
            }
        ],
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(bin_buffer)}],
    }

    json_str = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_pad = (4 - (len(json_str) % 4)) % 4
    json_str += b" " * json_pad

    total_len = 12 + 8 + len(json_str) + 8 + len(bin_buffer)

    glb = bytearray()
    # glTF Header (12 bytes)
    glb.extend(struct.pack("<4sII", b"glTF", 2, total_len))
    # Chunk 0: JSON (8 bytes header + json_str)
    glb.extend(struct.pack("<II", len(json_str), 0x4E4F534A))
    glb.extend(json_str)
    # Chunk 1: BIN (8 bytes header + bin_buffer)
    glb.extend(struct.pack("<II", len(bin_buffer), 0x004E4942))
    glb.extend(bin_buffer)

    return bytes(glb)


# Vehicle definitions with hierarchical part offsets based on BF1942 Objects.con
VEHICLE_SPECS: dict[str, list[dict[str, Any]]] = {
    "tiger": [
        {"sm": "standardMesh/Tiger_Hull_M1.sm", "rs": "standardMesh/Tiger_Hull_M1.rs", "offset": (0.0, 0.0, 0.0)},
        {"sm": "standardMesh/Tiger_Tow_M1.sm", "rs": "standardMesh/Tiger_Tow_M1.rs", "offset": (0.0, 0.64, 0.0)},
        {"sm": "standardMesh/Tiger_Canon_m1.sm", "rs": "standardMesh/Tiger_Canon_m1.rs", "offset": (0.0, 0.965, 1.295)},
    ],
    "sherman": [
        {"sm": "standardMesh/Sherman_Hull_M1.sm", "rs": "standardMesh/Sherman_Hull_M1.rs", "offset": (0.0, 0.0, 0.0)},
        {"sm": "standardMesh/Sherman_Tow_M1.sm", "rs": "standardMesh/Sherman_Tow_M1.rs", "offset": (0.0, -0.8, 0.0)},
        {"sm": "standardMesh/Sherman_Canon2_M1.sm", "rs": "standardMesh/Sherman_Canon2_M1.rs", "offset": (0.0, 1.15, 0.77)},
        {"sm": "standardMesh/Sherman_Canon1_M1.sm", "rs": "standardMesh/Sherman_Canon1_M1.rs", "offset": (0.0, 1.15, 0.77)},
    ],
    "spitfire": [
        {"sm": "standardMesh/Spitfire_Fus_M1.sm", "rs": "standardMesh/Spitfire_Fus_M1.rs", "offset": (0.0, 0.0, 0.0)},
        {"sm": "standardMesh/1p_Spitfire_m1.sm", "rs": "standardMesh/1p_Spitfire_m1.rs", "offset": (0.0, 0.0, 0.0)},
        {"sm": "standardMesh/Spitfire_Propeller_m1.sm", "rs": "standardMesh/Spitfire_Propeller_m1.rs", "offset": (0.0, 0.5, 4.0)},
    ],
    "b17": [
        {"sm": "standardMesh/B17_Fus_m1.sm", "rs": "standardMesh/B17_Fus_M1.rs", "offset": (0.0, 0.0, 0.0)},
    ],
    "willy": [
        {"sm": "standardMesh/Willy_Hul_M1.sm", "rs": "standardMesh/Willy_Hul_M1.rs", "offset": (0.0, 0.0, 0.0)},
        {"sm": "standardMesh/Willy_Str_M1.sm", "rs": "standardMesh/Willy_Str_M1.rs", "offset": (-0.399, 0.35, 0.15)},
        {"sm": "standardMesh/Willy_WheR_M1.sm", "rs": "standardMesh/Willy_WheR_M1.rs", "offset": (0.6, 0.11, 1.0)},
        {"sm": "standardMesh/Willy_WheL_M1.sm", "rs": "standardMesh/Willy_WheL_M1.rs", "offset": (-0.6, 0.11, 1.0)},
        {"sm": "standardMesh/Willy_WheR_M1.sm", "rs": "standardMesh/Willy_WheR_M1.rs", "offset": (0.6, 0.11, -1.21)},
        {"sm": "standardMesh/Willy_WheL_M1.sm", "rs": "standardMesh/Willy_WheL_M1.rs", "offset": (-0.6, 0.11, -1.21)},
    ],
}


def convert_vehicle(
    vehicle_key: str,
    sm_catalog: RfaCatalog,
    tex_catalog: RfaCatalog,
    out_file: Path,
) -> None:
    """Converts a vehicle by consolidating its mesh parts and textures into a single .glb."""
    spec_list = VEHICLE_SPECS.get(vehicle_key)
    if not spec_list:
        raise ValueError(f"Unknown vehicle key: {vehicle_key}")

    print(f"Converting '{vehicle_key}' -> {out_file.name}...")
    mesh_parts: list[dict[str, Any]] = []

    for part_spec in spec_list:
        sm_name = part_spec["sm"]
        rs_name = part_spec["rs"]
        offset = part_spec["offset"]

        try:
            sm_bytes = sm_catalog.extract(sm_name)
        except KeyError:
            # Fallback matching
            sm_bytes = sm_catalog.extract(Path(sm_name).name)

        rs_info: dict[str, dict[str, Any]] = {}
        if sm_catalog.has(rs_name):
            rs_info = parse_rs_materials(sm_catalog.extract(rs_name).decode("latin1", errors="replace"))

        lod_materials = parse_sm_mesh(sm_bytes, offset)
        for mat in lod_materials:
            mname = mat["name"]
            prop = rs_info.get(mname.lower(), {})
            tex_ref = prop.get("texture")

            png_bytes = None
            if tex_ref:
                dds_data = tex_catalog.find_texture(tex_ref)
                if dds_data:
                    try:
                        png_bytes = convert_dds_to_image_bytes(dds_data, "PNG")
                    except Exception as exc:
                        print(f"  Warning: texture conversion failed for {tex_ref}: {exc}", file=sys.stderr)

            mesh_parts.append(
                {
                    "name": mname,
                    "positions": mat["positions"],
                    "normals": mat["normals"],
                    "uvs": mat["uvs"],
                    "indices": mat["indices"],
                    "texture_name": tex_ref,
                    "texture_bytes": png_bytes,
                    "transparent": prop.get("transparent", False),
                    "twosided": prop.get("twosided", False),
                    "alphaTestRef": prop.get("alphaTestRef", 0.5),
                }
            )

    glb_bytes = build_binary_glb(vehicle_key, mesh_parts)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_bytes(glb_bytes)
    print(f"  Wrote {out_file} ({len(glb_bytes):,} bytes)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", type=Path, default=DEFAULT_GAME_ROOT, help="Path to Battlefield 1942 install")
    parser.add_argument("--out", type=Path, default=DEFAULT_MODELS_OUT, help="Output models directory")
    parser.add_argument("--model", type=str, choices=list(VEHICLE_SPECS.keys()) + ["all"], default="all")
    parser.add_argument("--ui-dir", type=Path, default=UI_MODELS_OUT, help="Frontend static public models directory")
    args = parser.parse_args()

    game_root = args.game
    archives_dir = game_root / "Mods/bf1942/Archives"
    if not archives_dir.is_dir():
        print(f"Archives directory not found at: {archives_dir}", file=sys.stderr)
        return 2

    sm_catalog = RfaCatalog(
        [
            archives_dir / "StandardMesh_001.rfa",
            archives_dir / "standardMesh.rfa",
        ]
    )
    tex_catalog = RfaCatalog(
        [
            archives_dir / "texture_001.rfa",
            archives_dir / "texture.rfa",
        ]
    )

    models_to_convert = list(VEHICLE_SPECS.keys()) if args.model == "all" else [args.model]

    for model_key in models_to_convert:
        out_file = args.out / f"{model_key}.glb"
        convert_vehicle(model_key, sm_catalog, tex_catalog, out_file)
        if args.ui_dir:
            ui_out = args.ui_dir / f"{model_key}.glb"
            ui_out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(out_file, ui_out)

    print(f"\nSuccessfully generated {len(models_to_convert)} 3D models in {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
