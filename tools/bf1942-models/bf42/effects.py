"""Refractor effect bundles as viewer-ready specs.

An impact in BF1942 is an `EffectBundle`: a list of `Emitter`s, each of which
names one payload template — a `SpriteParticle` (a textured, camera-facing
quad) or a `Particle` (an ordinary `.sm` mesh; the bullet-hole decals are
these) — and says how often to spawn it, where in the bundle's frame, with what
initial speed, and for how long. The payload says how a spawned particle lives:
its lifetime, size and colour ramps, gravity, drag, and for meshes an alpha ramp.

Nearly every number is a CRD random variable (`bf42.con.crd4`). This module
turns the raw property strings `con.py` captured on those templates into plain
dictionaries the viewer's `effects-core.js` samples at run time. It does not
sample anything itself: the randomness belongs at play time, per particle, the
way the engine does it.

Everything named here was read out of the engine — the emitter and particle
template serialisers (`EmitterTemplate::makeScript`, lnxded 0x081e61c0 /
client 0x005097a0; `ParticleTemplate::makeScript` 0x0820b260 / 0x005384d0)
list exactly these properties, and the update loops give them their meaning.
See `features/bf1942-engine-reference/subsystems/projectiles-and-impacts.md`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import con as con_mod

# Emitter properties, with the JSON key each lands under. CRD-valued unless
# noted. Defaults are the `EmitterTemplate` constructor's (lnxded 0x081e5c00).
_EMITTER_CRD = {
    "delay": "delay",
    "timetolive": "timeToLive",
    "intensity": "intensity",
    "startrotation": "startRotation",
    "relativepositionindof": ("relativePosition", "dof"),
    "relativepositioninup": ("relativePosition", "up"),
    "relativepositioninright": ("relativePosition", "right"),
    "positionalspeedindof": ("positionalSpeed", "dof"),
    "positionalspeedinup": ("positionalSpeed", "up"),
    "positionalspeedinright": ("positionalSpeed", "right"),
    "rotationalspeedindof": ("rotationalSpeed", "dof"),
    "rotationalspeedinup": ("rotationalSpeed", "up"),
    "rotationalspeedinright": ("rotationalSpeed", "right"),
}
_EMITTER_FLOAT = {
    "intensityatspeed": "intensityAtSpeed",
    "emitterspeedscale": "emitterSpeedScale",
    "startprobability": "startProbability",
    "loddistance": "lodDistance",
}
_EMITTER_BOOL = {
    "looping": "looping",
    "startatcreation": "startAtCreation",
    "addemitterspeed": "addEmitterSpeed",
    "addchild": "addChild",
    "nophysics": "noPhysics",
    "movetowatersurface": "moveToWaterSurface",
    "usecameraorientation": "useCameraOrientation",
}
_PARTICLE_CRD = {
    "timetolive": "timeToLive",
    "size": "size",
    "gravitymodifier": "gravityModifier",
    "drag": "drag",
    "initrotation": "initRotation",
    "rotationspeed": "rotationSpeed",
    "xysizeratio": "xySizeRatio",
    "alphatestref": "alphaTestRef",
}
_PARTICLE_CURVE = {
    "sizeovertime": "sizeOverTime",
    "gravitymodifierovertime": "gravityModifierOverTime",
    "dragovertime": "dragOverTime",
    "alphaovertime": "alphaOverTime",
    "colorrgbaovertime": "colorRGBAOverTime",
    "xysizeratioovertime": "xySizeRatioOverTime",
    "rotationspeedovertime": "rotationSpeedOverTime",
}
_PARTICLE_BOOL = {
    "turnsinmovingdirection": "turnsInMovingDirection",
    "hascollisionphysics": "hasCollisionPhysics",
    "usemipmaps": "useMipMaps",
}


def _truthy(text: str) -> bool:
    return bool(con_mod.truthy(text))


def _blend(props: dict[str, str]) -> str:
    """`add` for light, `alpha` for smoke and dust — the engine's two modes.

    `destBlendMode BMOne` is additive; everything else (`BMInvSourceAlpha`, the
    default) is ordinary source-over. `srcBlendMode` is left alone: the one
    sprite that pairs `BMOne` source with `BMInvSourceAlpha` destination
    (the bazooka backblast flare) reads correctly as source-over too.
    """
    dest = (props.get("destblendmode") or "").strip().lower()
    return "add" if dest == "bmone" else "alpha"


def particle_spec(payload: con_mod.ObjectTemplate) -> dict | None:
    """The payload half of an emitter: what one spawned particle does.

    `kind` is `sprite` for a `SpriteParticle` and `mesh` for a `Particle`.
    A mesh particle's `sizeModifier` is the engine's whole scaling switch:
    unset (0/0/0, the constructor default) the mesh draws at its authored
    size whatever `size` says; set, the scale is `size x sizeOverTime x
    sizeModifier` (`Particle::handleUpdate`, lnxded 0x0820ad20). The decals
    declare `sizeModifier 1/1/1` for exactly that reason and the flying stone
    chips do not.
    """
    kind = payload.kind.lower()
    props = payload.effect_props
    if kind in ("spriteparticle", "spriteparticlenew"):
        spec: dict = {"kind": "sprite", "template": payload.name,
                      "texture": payload.sprite_texture, "blend": _blend(props)}
        if not payload.sprite_texture:
            return None
    elif kind == "particle":
        if not payload.geometry:
            return None
        spec = {"kind": "mesh", "template": payload.name,
                "geometry": payload.geometry}
    elif kind in ("simpleobject", "bundle") and payload.geometry:
        # Debris: the cascade bundles (`BazookaCascadesStone`) throw real
        # `SimpleObject`s (`Gibb_concret45_m1`) out of their emitters — physical
        # chunks under full gravity, not particles. They have no ramps and no
        # lifetime of their own; the engine keeps them until the object manager
        # sweeps them. Modelled as a mesh particle that falls for a few
        # seconds, which is what a chunk looks like before it rests.
        spec = {"kind": "mesh", "template": payload.name,
                "geometry": payload.geometry, "debris": True,
                "timeToLive": ["u", 3.0, 5.0, 0],
                "gravityModifier": ["n", 1.0, 0.0, 0]}
    else:
        return None
    for cmd, key in _PARTICLE_CRD.items():
        if (raw := props.get(cmd)) and (value := con_mod.crd4(raw.split()[0])) is not None:
            spec[key] = value
    for cmd, key in _PARTICLE_CURVE.items():
        if (raw := props.get(cmd, "").strip()) and (curve := con_mod.curve(raw.split()[0])):
            spec[key] = curve
    for cmd, key in _PARTICLE_BOOL.items():
        if cmd in props:
            spec[key] = _truthy(props[cmd])
    if raw := props.get("sizemodifier"):
        try:
            spec["sizeModifier"] = list(con_mod.vec3_lenient(raw.split()[0]))
        except ValueError:
            pass
    return spec


def emitter_spec(emitter: con_mod.ObjectTemplate,
                 payload: con_mod.ObjectTemplate) -> dict | None:
    """One emitter and its payload as the viewer plays them.

    `timeToLive` is how long the emitter keeps spawning; `intensity` is
    particles per second — the engine spaces spawns `|1 / intensity|` apart
    (`Emitter::calcInvItensity`, 0x081e2f10; a zero intensity becomes one per
    hundred seconds, a negative one is used unsigned). `startRotation` rolls
    the emitter's frame about its own direction-of-fire axis per spawn
    (`dice::ref2::roll`, 0x08061df0), which is what scatters a smoke puff's
    launch direction. All offsets and speeds are in the emitter's frame:
    `dof` is its forward, `up` its up, `right` its right.
    """
    particle = particle_spec(payload)
    if particle is None:
        return None
    props = emitter.effect_props
    spec: dict = {"template": emitter.name, "particle": particle}
    for cmd, key in _EMITTER_CRD.items():
        raw = props.get(cmd)
        if not raw:
            continue
        value = con_mod.crd4(raw.split()[0])
        if value is None:
            continue
        if isinstance(key, tuple):
            spec.setdefault(key[0], {})[key[1]] = value
        else:
            spec[key] = value
    for cmd, key in _EMITTER_FLOAT.items():
        if (raw := props.get(cmd, "").strip()):
            try:
                spec[key] = float(raw.split()[0])
            except ValueError:
                pass
    for cmd, key in _EMITTER_BOOL.items():
        if cmd in props:
            spec[key] = _truthy(props[cmd])
    if emitter.show_in_first_person != emitter.show_in_third_person:
        spec["view"] = "first" if emitter.show_in_first_person else "third"
    return spec


@dataclass
class BundleNode:
    """One level of a bundle: emitters placed in it, and nested bundles."""
    template: con_mod.ObjectTemplate
    position: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0)
    emitters: list[tuple[con_mod.ChildRef, con_mod.ObjectTemplate,
                         con_mod.ObjectTemplate, dict]] = field(default_factory=list)
    bundles: list["BundleNode"] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not self.emitters and all(b.empty for b in self.bundles)

    def count(self) -> int:
        return len(self.emitters) + sum(b.count() for b in self.bundles)


def bundle_tree(library: con_mod.ObjectLibrary, name: str, *,
                position=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0),
                depth: int = 0) -> BundleNode | None:
    """Resolve a bundle and everything it nests into placed emitter specs.

    `RichoStoneDecal` is `addTemplate e_richoStone` plus `addTemplate
    em_RichoStoneDecal`: a bundle of a bundle and an emitter. Nested bundles
    keep their own placement (`e_ExplBazooka` yaws its first emitter 90
    degrees) as a node level, so the viewer can apply the engine's frame at
    the root and let the hierarchy do the rest.
    """
    template = library.object(name)
    if template is None or template.kind.lower() != "effectbundle" or depth > 6:
        return None
    node = BundleNode(template=template, position=position, rotation=rotation)
    for ref in template.children:
        child = library.object(ref.template)
        if child is None:
            continue
        kind = child.kind.lower()
        if kind == "effectbundle":
            nested = bundle_tree(library, ref.template, position=ref.position,
                                 rotation=ref.rotation, depth=depth + 1)
            if nested is not None and not nested.empty:
                node.bundles.append(nested)
        elif kind == "emitter" and child.emitter_template:
            payload = library.object(child.emitter_template)
            if payload is None:
                continue
            spec = emitter_spec(child, payload)
            if spec is not None:
                node.emitters.append((ref, child, payload, spec))
    return node


def effect_names_for_projectiles(library: con_mod.ObjectLibrary) -> set[str]:
    """Bundles a projectile plays on its own: trails and end-of-flight effects."""
    names: set[str] = set()
    for template in library.objects.values():
        if template.kind.lower() != "projectile":
            continue
        if template.end_effect_template:
            names.add(template.end_effect_template)
        if template.start_effect_template:
            names.add(template.start_effect_template)
        for ref in template.children:
            child = library.object(ref.template)
            if child is not None and child.kind.lower() == "effectbundle":
                names.add(child.name)
    return names


def projectile_trail_bundle(library: con_mod.ObjectLibrary,
                            projectile: con_mod.ObjectTemplate) -> str | None:
    """The bundle a projectile drags along in flight, if it declares one."""
    if projectile.start_effect_template:
        return projectile.start_effect_template
    for ref in projectile.children:
        child = library.object(ref.template)
        if child is not None and child.kind.lower() == "effectbundle":
            return child.name
    return None
