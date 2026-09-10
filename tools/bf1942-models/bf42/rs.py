"""RenderShader (.rs) parsing — the only thing that binds a mesh to a texture.

A `.sm` stores material *names* and nothing else. The texture each name paints with
lives in a `.rs` file, and Refractor looks for it in two places, in this order:

1. `Objects/<path to the object>/Art/<meshfile>.rs` — a per-object override, written
   in the older brace syntax and keyed by the bare material suffix:

       shader "Material4" { technique { pass { stage { texture "texture/sherBO_f"; }}}}

2. `StandardMesh/<meshfile>.rs` — the mesh's own default, written in the subshader
   syntax and keyed by the full material name:

       subshader "Sherman_Hull_M1_Material0" "StandardMesh/Default" { texture "texture/sherma_I"; }

Both forms are matched here, and both are keyed so a material called
`Sherman_TrackL_M1_Material4` resolves against either `Material4` or its full name.

Texture paths carry no extension: the engine probes `.dds` then `.tga`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# `shader "X"` / `subshader "X" "StandardMesh/Default"`
_BLOCK_START = re.compile(r'\b(sub)?shader\s+"([^"]+)"(?:\s+"([^"]+)")?\s*\{', re.IGNORECASE)
_TEXTURE = re.compile(r'\btexture\s+"([^"]+)"', re.IGNORECASE)
_BOOL = re.compile(r'\b(twosided|transparent)\s+(true|false)\s*;', re.IGNORECASE)
_ALPHATEST = re.compile(r'\balphaTest\s+(\w+)\s+([0-9.]+)\s*;', re.IGNORECASE)
_CULLMODE = re.compile(r'\bcullMode\s+(\w+)\s*;', re.IGNORECASE)


@dataclass
class Shader:
    name: str
    kind: str                      # "shader" or "subshader"
    textures: list[str] = field(default_factory=list)
    twosided: bool = False
    transparent: bool = False
    alpha_test: float | None = None

    @property
    def base_texture(self) -> str | None:
        """The first stage's texture — the diffuse map.

        Later stages are lightmap/detail/environment passes the engine composites;
        a glTF baseColorTexture only has room for the first.
        """
        return self.textures[0] if self.textures else None


def _brace_span(text: str, open_index: int) -> tuple[int, int]:
    """The body of the block whose `{` is at `open_index`."""
    depth = 0
    for i in range(open_index, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return open_index + 1, i
    return open_index + 1, len(text)


def parse(text: str) -> dict[str, Shader]:
    """Every shader block in a `.rs`, keyed by declared name and by bare suffix.

    Both keys point at the same object, so a caller can look up either
    `Sherman_TrackL_M1_Material4` or `Material4`.
    """
    shaders: dict[str, Shader] = {}
    for m in _BLOCK_START.finditer(text):
        start, end = _brace_span(text, m.end() - 1)
        body = text[start:end]
        name = m.group(2)
        shader = Shader(
            name=name,
            kind="subshader" if m.group(1) else "shader",
            textures=[t.replace("\\", "/") for t in _TEXTURE.findall(body)],
        )
        for flag, value in _BOOL.findall(body):
            setattr(shader, flag.lower(), value.lower() == "true")
        if at := _ALPHATEST.search(body):
            shader.alpha_test = float(at.group(2))
        if cm := _CULLMODE.search(body):
            if cm.group(1).lower() == "none":
                shader.twosided = True

        shaders[name.lower()] = shader
        # `Sherman_TrackL_M1_Material4` is also addressable as `Material4`.
        if "_material" in name.lower():
            suffix = name[name.lower().rindex("_material") + 1:]
            shaders.setdefault(suffix.lower(), shader)
    return shaders


def lookup(shaders: dict[str, Shader], material_name: str) -> Shader | None:
    hit = shaders.get(material_name.lower())
    if hit:
        return hit
    low = material_name.lower()
    if "_material" in low:
        return shaders.get(low[low.rindex("_material") + 1:])
    return None
