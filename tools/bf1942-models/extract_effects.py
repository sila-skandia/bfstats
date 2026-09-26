#!/usr/bin/env python3
"""Bake the impact and projectile EffectBundles into one shared GLB, and the
sound each of them plays into the shared sounds directory beside it.

`_shared/effects.glb` holds every bundle the MaterialManager can pick for a
hit (`damage.json`'s effects matrix names 73 of them in vanilla) plus the
bundles projectiles play on their own — trails and end-of-flight explosions.
Each bundle is a hidden template subtree: emitter nodes carrying their sprite
quad or `Particle` mesh and the whole authored spec in `extras.effectEmitter`.
`viewer/effects.js` clones one per impact and `effects-core.js` runs it the
way the engine does.

`_shared/effects.sounds.json` is the other half, and it is the half that was
missing: 70 of those 73 impact bundles carry an `ObjectTemplate.loadSoundScript`
and none of it was ever extracted, so every hit in the viewer was mute. The
manifest keys every bundle onto its script and every script onto its parsed
layers, and the samples land in the same `_shared/sounds` directory the level
extractor fills, transcoded by the same `transcode_to_mp3` and deduplicated the
same way.

Nine of the bundles that matter most bake **no geometry at all** — the
`e_Collision_*` family (a round into a man, a grenade bouncing off concrete,
metal debris landing, two hulls grinding) is sound and nothing else. They were
reported as "missing" by the bake and are not missing; they are audible.

    python3 extract_effects.py --mod bf1942 --out viewer/maps/_shared
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import effects as effects_mod  # noqa: E402
from bf42 import gltf  # noqa: E402
from bf42.assemble import Assembler, Report  # noqa: E402
from bf42.level import parse_ssc  # noqa: E402
from bf42.rfa import ArchivePool, find_archives_dir  # noqa: E402
from extract_map import (  # noqa: E402
    SOUND_ARCHIVES, VEHICLE_RATES, TranscodeError, ffmpeg_available,
    load_damage_tables, resolve_sound, transcode_to_mp3,
)
from extract_models import DEFAULT_GAME_DIR, build_library, build_pools, mod_chain  # noqa: E402

# An impact is heard from where it happens, which for the round you just fired
# is a few metres away — the same close-range case a cockpit engine layer is,
# so the 44 kHz masters come first exactly as they do for a vehicle.
EFFECT_SOUND_LEVEL = "high"

# `Sound.setHardwareVoiceLimit 32` in `Mods/bf1942/Settings/Default.con`, and
# the same 32 is the `SoundSetup` constructor's own default before any `.con`
# is read (lnxded `dice::bf::SoundSetup::SoundSetup` 0x080d51c0, `mov DWORD
# PTR [ebx+0x50],0x20` at 0x080d520a; `setHardwareVoiceLimit` 0x080d5470
# stores to that same `+0x50` and refuses a negative). Default.con's own
# comment gives the three tiers: "Vec order is lo/med/hi and 16/24/32".
#
# The 32 is the game's. `RESERVED_2D = 6` is this project's reading of
# `reserve2dMonoChans 4/4/4` + `reserve2dStereoChans 2/2/2`, and it is NOT
# proven: lnxded has no mixer, and all four of the hardware-voice and
# reservation accessors have zero call sites in it. Both numbers go into the
# manifest separately, rather than a single pre-subtracted 26, so the
# unproven half is visible and can be changed without an extraction.
VOICE_LIMIT = 32
RESERVED_2D = 6


def effect_names(tables, library, extra: list[str]) -> set[str]:
    names: set[str] = set(extra)
    if tables is not None:
        names.update(tables.effects.values())
    names.update(effects_mod.effect_names_for_projectiles(library))
    names.update(effects_mod.effect_names_for_armor(library))
    names.update(effects_mod.effect_names_for_firearms(library))
    return names


def build_sound_manifest(names, library, objects: ArchivePool,
                         sounds: ArchivePool, shared_dir: Path,
                         rel_base: Path, audio_format: str = "mp3") -> dict:
    """Every named bundle's sound script, parsed, with its samples written.

    Scripts are shared heavily — vanilla's 70 sounding impact bundles use 38
    distinct `.ssc` between them, because every ricochet-with-decal defers to
    the same bare ricochet bundle — so the manifest is two tables rather than
    one: `scripts` holds the parsed layers once, `bundles` maps a name onto a
    script. The viewer builds one voice graph per script and shares it across
    every bundle that names it, which is also what keeps its voice pool small.

    A bundle names a *list*: 10 vanilla trees carry two scripts, none of them
    on the parent (`MajorImpact_Sand` is `e_Explani02` + `e_ExplDrySand`, the
    blast and the sand rain, and the six `*Cascades*` bundles are the same
    shape). Both children are ordinary `addTemplate` instances, so the engine
    stands both up. `script` is kept beside `scripts` as the first of them,
    for a viewer reading a manifest older than this.

    Bundle keys are lower-cased, matching `EffectLibrary`'s own lookup.
    """
    seen: dict[str, str] = {}

    def write(resolved: tuple[str, bytes]) -> str:
        basename, data = resolved
        if basename in seen:
            return seen[basename]
        shared_dir.mkdir(parents=True, exist_ok=True)
        if audio_format == "mp3":
            target = shared_dir / (Path(basename).stem + ".mp3")
            # The level extractor fills this same directory, and for the same
            # reason: a sample another level (or another run) already
            # transcoded is left alone. `explgas.wav` is an ambient bed's
            # neighbour and an explosion layer both.
            if not target.is_file():
                transcode_to_mp3(data, target)
        else:
            target = shared_dir / basename
            if not target.is_file():
                target.write_bytes(data)
        rel = str(Path(target).relative_to(rel_base)).replace("\\", "/") \
            if shared_dir.is_relative_to(rel_base) else target.name
        seen[basename] = rel
        return rel

    def read_script(path: str) -> str | None:
        hit = objects.find(path)
        return objects.read(hit).decode("latin-1") if hit else None

    def resolve(ref: str):
        return resolve_sound(ref, None, sounds, VEHICLE_RATES)

    scripts: dict[str, dict] = {}
    bundles: dict[str, dict] = {}
    silent: dict[str, str] = {}
    for name in sorted(names):
        found = effects_mod.bundle_sound_scripts(library, name)
        if not found:
            silent[name] = "no loadSoundScript in the bundle tree"
            continue
        keys: list[str] = []
        owners: list[tuple[str, int]] = []
        why: list[str] = []
        for path, owner, depth in found:
            key = path.lower()
            if key in keys:
                continue
            if key not in scripts:
                text = read_script(path)
                if text is None:
                    why.append(f"sound script missing: {path}")
                    continue
                patches = parse_ssc(text, level=EFFECT_SOUND_LEVEL,
                                    include=read_script, source=path)
                layers = effects_mod.sound_layers(patches, resolve, write)
                if not layers:
                    why.append(f"no sample resolved from {path}")
                    continue
                scripts[key] = {
                    "script": path,
                    "patches": len(patches),
                    "layers": layers,
                }
            keys.append(key)
            owners.append((owner, depth))
        if not keys:
            silent[name] = "; ".join(why) or "no sound resolved"
            continue
        entry = {"name": name, "script": keys[0], "scripts": keys}
        # Worth keeping: it is the difference between "this bundle is noisy"
        # and "this bundle borrows its noise from the thing it wraps", which
        # is true of 22 of vanilla's 70 and is not obvious from the name.
        if owners[0][1]:
            entry["soundOwner"] = owners[0][0]
        if len(keys) > 1:
            entry["soundOwners"] = [owner for owner, _ in owners]
        bundles[name.lower()] = entry

    return {
        "level": EFFECT_SOUND_LEVEL,
        "voiceLimit": VOICE_LIMIT,
        "reserved2d": RESERVED_2D,
        "scripts": scripts,
        "bundles": bundles,
        "silent": silent,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "viewer" / "maps" / "_shared")
    ap.add_argument("--name", action="append", default=[],
                    help="extra bundle template(s) to bake")
    ap.add_argument("--max-texture", type=int, default=512)
    ap.add_argument("--shared-sounds", type=Path, default=None,
                    help="where the samples land (default: <out>/sounds, the "
                         "same directory extract_map.py fills)")
    ap.add_argument("--audio-format", choices=("mp3", "wav"), default="mp3")
    ap.add_argument("--no-sound", action="store_true",
                    help="bake the geometry only, leaving effects.sounds.json alone")
    args = ap.parse_args()

    started = time.time()
    chain = mod_chain(args.game_dir, args.mod)
    meshes, textures, objects, game = build_pools(chain, [])
    library = build_library(objects)
    tables = load_damage_tables(game)
    names = effect_names(tables, library, args.name)

    assembler = Assembler(meshes, textures, objects, library,
                          include_collision=False, max_texture=args.max_texture)
    assembler.apply_material_diffuse = True
    assembler.additive_alpha_test = True
    builder = gltf.GlbBuilder()
    report = Report(root="effects", configuration="complex", lod=0)
    roots, index = assembler.bake_effect_library(builder, names, report)
    manifest = {
        "mod": args.mod,
        "bundles": index["bundles"],
        "missing": index["missing"],
        "missingTextures": sorted(set(report.missing_textures)),
        "missingMeshes": sorted(set(report.missing_meshes)),
    }
    glb = builder.build(roots, extras={"effects": manifest})
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "effects.glb").write_bytes(glb)
    (args.out / "effects.report.json").write_text(json.dumps(manifest, indent=1))
    print(f"{len(index['bundles'])} bundles, {sum(b['emitters'] for b in index['bundles'].values())} emitters, "
          f"{len(glb) // 1024} KB, {len(index['missing'])} missing, "
          f"{len(manifest['missingTextures'])} missing textures, in {time.time() - started:.1f}s "
          f"-> {args.out / 'effects.glb'}")
    if index["missing"]:
        print("missing:", ", ".join(index["missing"]))

    if args.no_sound:
        return 0
    if not ffmpeg_available() and args.audio_format == "mp3":
        print("ffmpeg not found — effect sound skipped (the samples ship as "
              "mp3 or not at all)", file=sys.stderr)
        return 1
    sounds = ArchivePool()
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        if archives is not None:
            sounds.add_dir(archives, SOUND_ARCHIVES)
    shared = args.shared_sounds or (args.out / "sounds")
    before = ({p.name for p in shared.glob("*")} if shared.is_dir() else set())
    try:
        manifest = build_sound_manifest(names, library, objects, sounds,
                                        shared, args.out, args.audio_format)
    except TranscodeError as exc:
        print(f"effect sound failed: {exc}", file=sys.stderr)
        return 1
    manifest["mod"] = args.mod
    (args.out / "effects.sounds.json").write_text(json.dumps(manifest, indent=1))
    added = [p for p in sorted(shared.glob("*")) if p.name not in before]
    layers = sum(len(s["layers"]) for s in manifest["scripts"].values())
    samples = len({layer["file"] for s in manifest["scripts"].values()
                   for layer in s["layers"]})
    print(f"{len(manifest['bundles'])} bundles with sound, "
          f"{len(manifest['scripts'])} scripts, {layers} layers, "
          f"{samples} samples ({len(added)} new, "
          f"{sum(p.stat().st_size for p in added)} B added), "
          f"{len(manifest['silent'])} silent -> {args.out / 'effects.sounds.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
