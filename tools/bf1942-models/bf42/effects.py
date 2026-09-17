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
client 0x005097a0; `ParticleTemplate::makeScript` 0x0820b260 / 0x005384d0;
`SpriteParticleNewTemplate::makeScript`, client-only, for the flipbook words
`numAnimationFrames`/`initAnimationFrame`/`animationSpeed`/
`animationSpeedOverTime`) list exactly these properties, and the update loops
give them their meaning.
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
    # Texture-atlas flipbooks (ledger SPR-6). `numAnimationFrames` itself is a
    # plain count, not a CRD — handled separately below, only for sprites.
    "initanimationframe": "initAnimationFrame",
    "animationspeed": "animationSpeed",
}
_PARTICLE_CURVE = {
    "sizeovertime": "sizeOverTime",
    "gravitymodifierovertime": "gravityModifierOverTime",
    "dragovertime": "dragOverTime",
    "alphaovertime": "alphaOverTime",
    "colorrgbaovertime": "colorRGBAOverTime",
    "xysizeratioovertime": "xySizeRatioOverTime",
    "rotationspeedovertime": "rotationSpeedOverTime",
    "animationspeedovertime": "animationSpeedOverTime",
}
_PARTICLE_BOOL = {
    "turnsinmovingdirection": "turnsInMovingDirection",
    "hascollisionphysics": "hasCollisionPhysics",
    "usemipmaps": "useMipMaps",
}


def _truthy(text: str) -> bool:
    return bool(con_mod.truthy(text))


# BM* names map onto Direct3D 8 D3DBLEND ordinals 1..11 (0x005bd830 /
# 0x005241c0 / 0x00524340). Ledger SPR-5 confirmed the sprite draw path
# feeds those same ordinals to SetRenderState with no remap — see `_blend`.
_BLEND_ORDINAL = {
    "bmzero": 1, "bmone": 2, "bmsourcecolor": 3, "bminvsourcecolor": 4,
    "bmsourcealpha": 5, "bminvsourcealpha": 6, "bmdestalpha": 7,
    "bminvdestalpha": 8, "bmdestcolor": 9, "bminvdestcolor": 10,
    "bmsourcealphasaturate": 11,
}
# `geom::ParticleSystemTemplate`'s constructor (`FUN_00618350`, R8-8) hardcodes
# these two exact ordinals before any `.con` word is read — the fallback for
# a template that never sets the word at all (its setter never runs).
_DEFAULT_SRC_BLEND = _BLEND_ORDINAL["bmsourcealpha"]        # 5
_DEFAULT_DEST_BLEND = _BLEND_ORDINAL["bminvsourcealpha"]    # 6


def _blend_ordinal(props: dict[str, str], word: str, default: int) -> int:
    """One of `srcBlendMode`/`destBlendMode`, as the D3DBLEND ordinal it is.

    `setSrcBlendMode`/`setDestBlendMode` (0x006182b0/0x006182e0, R8-2) store
    the parsed int unchanged — no cast, no lookup — so the `.con` name maps
    straight onto `_BLEND_ORDINAL`. An unrecognised or absent name falls back
    to the constructor's own default (R8-8), not to `alpha`/1: a template
    that never mentions the word never calls the setter at all.
    """
    raw = (props.get(word) or "").strip().lower()
    return _BLEND_ORDINAL.get(raw, default)


def _blend(props: dict[str, str]) -> dict:
    """A sprite's blend factors: the engine's own D3DBLEND ordinals, plus the
    `add`/`alpha` label `bf42/assemble.py`'s `bake_effect_library` keys its
    own baked-material setup on (`_sprite_quad_mesh(..., additive=...)`) —
    unchanged by this round, kept exactly as before so that file (not owned
    by this track) still reads what it always read.

    `viewer/effects.js` turns `src`/`dest` into a WebGL `CustomBlending`
    pair: the two enumerations agree slot for slot (`ZeroFactor` ..
    `SrcAlphaSaturateFactor` in the same order `BMZero` .. `BMSourceAlphaSaturate`
    does), so no viewer-side guess is needed for any of the 11 values — not
    just the two `destBlendMode BMOne` / everything-else cases `label` alone
    can tell apart. The one sprite that pairs `BMOne` source with
    `BMInvSourceAlpha` destination (the bazooka backblast flare) gets its own
    correct, non-additive pair from `src`/`dest` directly; `label` still
    calls it "add" by the old two-case rule; it happens to read as ordinary
    source-over regardless (`destBlendMode`, not `srcBlendMode`, is what
    made the old rule usually right).

    Ledger SPR-5 (2026-09-17) closed the draw path: BM names are D3DBLEND
    ordinals 1–11 (`0x005bd830` / `0x005241c0` / `0x00524340`);
    `addParticle` passes `template+0x5b0` into the particle ctor
    (`0x00609ea0`) as `particle+0x78`; flush via vtable `0x00914c00` →
    `0x0062e870` → `0x0062cf20` issues `SetRenderState(SRCBLEND/DESTBLEND)`
    from `*(particle+0x78)+0x14/+0x18` (= template `+0x5c4`/`+0x5c8`) with
    no remap. `FUN_00664560`'s non-identity blend permute is not on this
    path and is not applied here.
    """
    src = _blend_ordinal(props, "srcblendmode", _DEFAULT_SRC_BLEND)
    dest = _blend_ordinal(props, "destblendmode", _DEFAULT_DEST_BLEND)
    return {
        "label": "add" if dest == _BLEND_ORDINAL["bmone"] else "alpha",
        "src": src,
        "dest": dest,
    }


def particle_spec(payload: con_mod.ObjectTemplate) -> dict | None:
    """The payload half of an emitter: what one spawned particle does.

    `kind` is `sprite` for a `SpriteParticle` and `mesh` for a `Particle`.
    A mesh particle's `sizeModifier` is the engine's whole scaling switch:
    unset (0/0/0, the constructor default) the mesh draws at its authored
    size whatever `size` says; set, the scale is `size x sizeOverTime x
    sizeModifier` (`Particle::handleUpdate`, lnxded 0x0820ad20). The decals
    declare `sizeModifier 1/1/1` for exactly that reason and the flying stone
    chips do not.

    A sprite's `numAnimationFrames` (ledger SPR-6) makes it a texture-atlas
    flipbook — 791 of 7,159 vanilla-plus-mods sprite templates do, among them
    `fx_expl_core` and every aircraft engine fire. `initAnimationFrame` and
    `animationSpeed` are CRDs rolled once per particle
    (`geom::ParticleSystem::addParticle`, client 0x0060a680), exactly like
    `initRotation`/`rotationSpeed`; `animationSpeedOverTime` ramps the speed
    over the particle's own life like every other `…OverTime` curve. See
    `effects-core.js`'s `atlasGrid`/`frameIndex` for what the viewer does with
    them.

    A mesh particle's `radius` (ledger EMT-5) is not set here: it is the
    referenced geometry's own bounding box, which this module never opens
    (`payload.geometry` is a bare name). `viewer/effects.js` computes it once
    from the real exported mesh when the effect library loads and writes it
    onto this same dict in place — see `meshBoundingRadius` there.
    """
    kind = payload.kind.lower()
    props = payload.effect_props
    if kind in ("spriteparticle", "spriteparticlenew"):
        blend = _blend(props)
        spec: dict = {"kind": "sprite", "template": payload.name,
                      "texture": payload.sprite_texture, "blend": blend["label"],
                      "srcBlendMode": blend["src"], "destBlendMode": blend["dest"]}
        if not payload.sprite_texture:
            return None
        if raw := props.get("numanimationframes"):
            try:
                frames = int(float(raw.split()[0]))
            except ValueError:
                frames = 0
            # A single frame is the same as no flipbook at all; the viewer
            # gates every bit of atlas math on this key being present.
            if frames > 1:
                spec["numAnimationFrames"] = frames
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
    if template is None or depth > 6:
        return None
    if template.kind.lower() == "emitter":
        # A name can be a bare `Emitter` rather than a bundle, and `addArmorEffect`
        # is where that happens: every aircraft and ship damage-smoke tier names
        # one directly (`em_PlaneDamage`, `em_StukaDamage`, `em_LcvpDamage`,
        # `em_ShokakuDamage`, … — 20 of them in vanilla), created as
        # `ObjectTemplate.create Emitter`, never wrapped in an EffectBundle.
        # The engine plays an emitter perfectly well on its own; this reader
        # required a bundle and so reported every one of them missing, which is
        # why a damaged plane or ship baked no smoke while tanks baked theirs.
        #
        # Wrap it in a synthetic single-emitter bundle so the rest of the
        # pipeline — the baker, the manifest, the viewer's clone-per-play — sees
        # the same shape it always has.
        payload = library.object(template.emitter_template) if template.emitter_template else None
        if payload is None:
            return None
        spec = emitter_spec(template, payload)
        if spec is None:
            return None
        node = BundleNode(template=template, position=position, rotation=rotation)
        node.emitters.append(
            (con_mod.ChildRef(template=template.name), template, payload, spec))
        return node
    if template.kind.lower() != "effectbundle":
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


def effect_names_for_armor(library: con_mod.ObjectLibrary) -> set[str]:
    """Bundles a damaged object shows: every `addArmorEffect` tier in the set.

    The smoke, fire and death tiers (`e_PanzDamage`, `e_PanzFire`, `e_ExplGas`,
    `e_scrapmetal*`, the boats' `e_waterBoatSink*`). None of these reach the
    bake through the MaterialManager's impact matrix or a projectile's own
    effects, which is why `_shared/effects.glb` shipped without a single one of
    them until this was added.
    """
    return {name for template in library.objects.values()
            for _, name, _ in template.armor_effects}


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
