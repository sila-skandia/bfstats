"""A local mirror of the live mesh assets the signature art is drawn from.

The viewer tree on this machine holds only part of what mesh.bfstats.io serves
(the content-addressed store keeps most glbs as `glbs/<sha>.glb`, and the
textures live in the shared `textures/` store). The signature renderer needs a
glb and its textures on disk, laid out the way the viewer tree is, so that the
texture URIs the glb carries (spelled relative to the glb's own tree path)
resolve. This module fetches exactly that:

    path = mirror.glb('models/mods/fh/poses/GermanSoldier__Mg42.pose.glb')

returns a local file at `<cache>/models/mods/fh/poses/GermanSoldier__Mg42.pose.glb`
with every texture it names beside it at `<cache>/textures/...`. A glb whose
tree publishes a manifest (`models.json`, `poses/index.json`) is fetched by its
sha from `glbs/`; one no manifest names (EoD's poses) from its own path.

Nothing here writes to the live site; it only reads it.
"""

from __future__ import annotations

import json
import os
import struct
import urllib.error
import urllib.request
from pathlib import Path

LIVE = os.environ.get("BFSTATS_MESH_ORIGIN", "https://mesh.bfstats.io")
CACHE = Path(os.environ.get("BFSTATS_SIGNATURE_CACHE", Path.home() / ".cache" / "bfstats-signature-assets"))
USER_AGENT = "bfstats-signature-art/1"
TEXTURE_EPOCH = "2"
LOCAL_VIEWER = Path(__file__).resolve().parents[2] / "tools" / "bf1942-models" / "viewer"


def tree_of(mod: str) -> str:
    """The tree path a mod's models live under."""
    return "models" if mod == "bf1942" else f"models/mods/{mod}"


def _get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def _cached(rel: str, url: str) -> Path:
    out = CACHE / rel
    if out.exists() and out.stat().st_size > 0:
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    data = _get(url)
    tmp = out.with_suffix(out.suffix + ".part")
    tmp.write_bytes(data)
    tmp.replace(out)
    return out


_tables: dict[str, dict[str, str]] = {}


def _manifest(tree: str, kind: str) -> dict[str, str]:
    """name -> sha for one tree's models or poses."""
    key = f"{tree}|{kind}"
    if key in _tables:
        return _tables[key]
    table: dict[str, str] = {}
    rel = f"{tree}/models.json" if kind == "models" else f"{tree}/poses/index.json"
    try:
        doc = json.loads(_cached(rel, f"{LIVE}/{rel}").read_text())
    except (urllib.error.HTTPError, json.JSONDecodeError):
        doc = None
        (CACHE / rel).unlink(missing_ok=True)
    if kind == "models" and isinstance(doc, list):
        for row in doc:
            for glb, sha in [(row.get("glb"), row.get("sha")), (row.get("cockpit"), row.get("cockpitSha"))]:
                if glb and sha:
                    table[glb] = sha
            for variant in row.get("variants") or []:
                if variant.get("glb") and variant.get("sha"):
                    table[variant["glb"]] = variant["sha"]
    elif kind == "poses" and isinstance(doc, dict):
        table.update({k: v for k, v in (doc.get("sha") or {}).items() if isinstance(v, str)})
    _tables[key] = table
    return table


def models(mod: str) -> list[dict]:
    """A tree's models.json rows."""
    rel = f"{tree_of(mod)}/models.json"
    return json.loads(_cached(rel, f"{LIVE}/{rel}").read_text())


def _images(path: Path) -> list[str]:
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise ValueError(f"{path} is not a glb")
    length = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + length])
    return [image["uri"] for image in doc.get("images", []) if image.get("uri")]


def glb(rel: str) -> Path:
    """Mirror one glb (a tree path under the live origin) and its textures."""
    parts = rel.split("/")
    if parts[1] == "mods":
        tree, inner = "/".join(parts[:3]), "/".join(parts[3:])
    else:
        tree, inner = parts[0], "/".join(parts[1:])
    if inner.startswith("poses/"):
        sha = _manifest(tree, "poses").get(inner[len("poses/"):])
    else:
        sha = _manifest(tree, "models").get(inner)
    url = f"{LIVE}/glbs/{sha}.glb" if sha else f"{LIVE}/{rel}"
    path = _cached(rel, url)
    for uri in _images(path):
        target = (path.parent / uri).resolve()
        texture_rel = os.path.relpath(target, CACHE.resolve())
        if texture_rel.startswith(".."):
            continue
        try:
            # The viewer's epoch query (viewer/texture-url.js): the edge still holds year-long
            # 404s for some names from before 2026-11-13; the query is a fresh cache key.
            _cached(texture_rel, f"{LIVE}/{texture_rel}?r={TEXTURE_EPOCH}")
        except urllib.error.HTTPError as error:
            # The shared store on this machine is the same content-addressed set; a
            # texture the live volume lacks is drawn from it rather than left white.
            local = LOCAL_VIEWER / texture_rel
            if local.exists():
                (CACHE / texture_rel).parent.mkdir(parents=True, exist_ok=True)
                (CACHE / texture_rel).write_bytes(local.read_bytes())
                print(f"  texture {texture_rel}: {error.code} live, taken from the local store")
            else:
                print(f"  texture {texture_rel}: {error.code}")
    return path


def exists(rel: str) -> bool:
    """Whether the live site serves a glb, without downloading it."""
    if (CACHE / rel).exists():
        return True
    parts = rel.split("/")
    tree = "/".join(parts[:3]) if parts[1] == "mods" else parts[0]
    inner = rel[len(tree) + 1:]
    if inner.startswith("poses/") and _manifest(tree, "poses").get(inner[len("poses/"):]):
        return True
    if not inner.startswith("poses/") and _manifest(tree, "models").get(inner):
        return True
    request = urllib.request.Request(f"{LIVE}/{rel}", method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status == 200
    except urllib.error.HTTPError:
        return False


def kits(mod: str) -> Path | None:
    """A tree's kits.json, mirrored, or None when the tree publishes none."""
    rel = f"{tree_of(mod)}/kits.json"
    try:
        return _cached(rel, f"{LIVE}/{rel}")
    except urllib.error.HTTPError:
        return None


def kit_parts(mod: str, template: str) -> list[Path]:
    """Mirror the worn parts of one kit, from the mod's tree or vanilla's."""
    path = kits(mod)
    if path is None:
        return []
    doc = json.loads(path.read_text())
    kit = next((k for k in doc.get("kits", []) if str(k.get("template", "")).lower() == template.lower()), None)
    if kit is None:
        raise KeyError(f"no kit {template} in {mod}")
    out = []
    for part in kit.get("worn") or []:
        if not part.get("glb"):
            continue
        for tree in dict.fromkeys([tree_of(mod), "models"]):
            rel = f"{tree}/{part['glb']}"
            try:
                out.append(glb(rel))
                break
            except urllib.error.HTTPError:
                continue
    return out


def kit_row(mod: str, template: str) -> dict:
    doc = json.loads(kits(mod).read_text())
    return next(k for k in doc["kits"] if str(k.get("template", "")).lower() == template.lower())


def recipe(rel: str) -> dict | None:
    """A pose's recipe (`<Soldier>__<Weapon>.pose.json`), mirrored beside its glb, or None."""
    try:
        return json.loads(_cached(rel, f"{LIVE}/{rel}").read_text())
    except (urllib.error.HTTPError, json.JSONDecodeError):
        (CACHE / rel).unlink(missing_ok=True)
        return None
