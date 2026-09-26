#!/usr/bin/env python3
"""Extract the soldier's three bail-out sound scripts as mp3s plus a manifest.

    python3 extract_soldier_sounds.py --out ./out
    python3 extract_soldier_sounds.py --mod DesertCombat --out ./out

`Objects/Soldiers/Common/Sounds/SoldierSound.inc` loads a script per
`c_Sst*` sound trigger; three of them belong to stepping out of an aircraft:

    SoldierFallingHigh.ssc    c_SstFallingHigh    the wind, the scream, the egg
    SoldierOpenParachute.ssc  c_SstOpenParachute  the canopy cracking open
    SoldierParachuteLand.ssc  c_SstParachuteLand  the feet arriving

`viewer/parachute.js` fires those three triggers at the moments the engine
fires them (`features/viewer-parachute/README.md` has the addresses). This
ships what they resolve to, with the authored numbers the viewer needs to play
them honestly: which layers are simultaneous and which are a `randomPlay`
pick-one, each layer's volume and loop flag, and — the one that matters here —
the `Volume <- Time` ramp that delays a layer's start. `SoldierFallingHigh` is
nothing but those delays: wind from 0 s, two whooshes at 1.2 and 2.3, the
human scream at 3.3, and `soprupp.wav` at **11.5 s**, which is the easter egg
almost nobody has heard because it wants eleven and a half seconds of falling.

A soldier's own footsteps and grunts are not here; this is the bail-out set.
Standard library plus ffmpeg, same as the map and weapon sound pipelines.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.level import SoundSample, parse_ssc
from bf42.rfa import ArchivePool, find_archives_dir
from extract_map import (
    SOUND_ARCHIVES, TranscodeError, VEHICLE_RATES,
    ffmpeg_available, resolve_sound, transcode_to_mp3,
)
from extract_models import DEFAULT_GAME_DIR, OBJECT_ARCHIVES, mod_chain

# A soldier hears his own parachute from inside it, so like a cockpit engine
# layer this asks for the 44 kHz masters first.
SOLDIER_SOUND_RATES = VEHICLE_RATES

# The scripts, by the `c_Sst*` trigger the animation states declare.
BAIL_OUT_SCRIPTS = (
    ("c_SstFallingHigh", "SoldierFallingHigh.ssc"),
    ("c_SstOpenParachute", "SoldierOpenParachute.ssc"),
    ("c_SstParachuteLand", "SoldierParachuteLand.ssc"),
)

MOVEMENT_SCRIPTS = (
    ("c_SstWalk", "SoldierWalk.ssc"),
    ("c_SstRun", "SoldierRun.ssc"),
)

INJURY_SCRIPTS = (
    ("c_SstHitDamage", "SoldierHitDamage.ssc"),
    ("c_SstFFHitDamage", "SoldierFFHitDamage.ssc"),
    ("c_SstKilled", "SoldierKilled.ssc"),
)

ALL_SOLDIER_SCRIPTS = BAIL_OUT_SCRIPTS + MOVEMENT_SCRIPTS + INJURY_SCRIPTS

PATCH_MATERIALS = (
    "sand",
    "metal",
    "wood",
    "concrete",
    "grass",
    "gravel",
    "ice",
    "mud",
    "fabric",
    "harness",
)

SOUND_DIR = "Objects/Soldiers/Common/Sounds"

# `@Language` is the voice directory the engine substitutes for the game's
# language setting, the way `@RTD` stands in for the sample rate. Vanilla ships
# English, UsEnglish, German, Japanese and Russian (plus Canadian in
# `sound_001.rfa`); the scream is the only bail-out sample that uses it. The
# viewer has no language setting, so the first of these that resolves wins.
LANGUAGES = ("English", "UsEnglish", "German", "Japanese", "Russian", "Canadian")


def time_gate(sample: SoundSample) -> float:
    """When a layer starts, in seconds, from its own `Volume <- Time` ramp.

    `trigger Volume` holds a layer silent until its computed volume first goes
    non-zero, and the only thing modulating volume by `Time` in these scripts
    is a `Ramp p1 p2 0 1` — zero below `p1`, one above `p2`. So `p1` is the
    start, and a layer with no such effect starts at 0.
    """
    if (sample.trigger or "").lower() != "volume":
        return 0.0
    for effect in sample.effects:
        if effect.destination.lower() != "volume":
            continue
        if effect.source.lower() != "time":
            continue
        if effect.envelope.lower() != "ramp" or len(effect.params) < 4:
            continue
        return float(effect.params[0])
    return 0.0


def language_refs(ref: str) -> list[str]:
    """`@Language` expanded, in preference order; the ref itself if it has none."""
    if "@language" not in ref.lower():
        return [ref]
    return [re.sub(r"@language", lang, ref, flags=re.IGNORECASE)
            for lang in LANGUAGES]


def script_manifest(text: str, source: str) -> list[dict]:
    """One `.ssc` as the viewer's own shape: patches of layers."""
    patches = []
    for patch in parse_ssc(text, source=source):
        layers = []
        for sample in patch.samples:
            layers.append({
                "sample": Path(sample.file.replace("\\", "/")).stem,
                "file": sample.file,
                "volume": round(sample.volume, 4),
                "loop": bool(sample.loop),
                "at": round(time_gate(sample), 4),
                "minDistance": round(sample.min_distance, 4),
            })
        if layers:
            p_entry = {"randomPlay": bool(patch.random_play),
                       "layers": layers}
            patches.append(p_entry)
    if len(patches) == 10 and any(k in source.lower() for k in ("walk", "run", "crouch", "crawl")):
        for idx, p in enumerate(patches):
            p["material"] = PATCH_MATERIALS[idx]
    return patches


def find_script(objects: ArchivePool, name: str) -> str | None:
    """`SoldierSound.inc`'s `loadSoundScript <name>`, resolved in the pool."""
    for candidate in (f"{SOUND_DIR}/{name}", name):
        hit = objects.find(candidate)
        if hit is not None:
            text = objects.read(hit).decode("latin-1")
            m = re.search(r"#include\s+([^\r\n]+)", text, re.IGNORECASE)
            if m:
                inc = m.group(1).strip().replace("\\", "/")
                inc_text = find_script(objects, inc)
                if inc_text is not None:
                    return inc_text
            return text
    return None


def extract(game_dir: Path, mod: str, out: Path,
            transcode: bool = True) -> dict:
    chain = mod_chain(game_dir, mod)
    objects = ArchivePool()
    sounds = ArchivePool()
    for step in chain:
        archives = find_archives_dir(step)
        if archives is None:
            continue
        objects.add_dir(archives, OBJECT_ARCHIVES)
        sounds.add_dir(archives, SOUND_ARCHIVES)

    sound_out = out / "sounds"
    sound_out.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"mod": mod, "triggers": {}, "missing": []}
    wanted: dict[str, str] = {}

    for trigger, script in ALL_SOLDIER_SCRIPTS:
        text = find_script(objects, script)
        if text is None:
            manifest["missing"].append({"trigger": trigger, "script": script,
                                        "why": "no such script in this mod"})
            continue
        patches = script_manifest(text, f"{SOUND_DIR}/{script}")
        manifest["triggers"][trigger] = {"script": script, "patches": patches}
        for patch in patches:
            for layer in patch["layers"]:
                wanted[layer["sample"]] = layer["file"]

    written = []
    for stem, ref in sorted(wanted.items()):
        dest = sound_out / f"{stem}.mp3"
        resolved = None
        for candidate in language_refs(ref):
            resolved = resolve_sound(candidate, None, sounds,
                                     rates=SOLDIER_SOUND_RATES)
            if resolved is not None:
                break
        if resolved is None:
            manifest["missing"].append({"sample": stem, "ref": ref,
                                        "why": "not in the sound archives"})
            continue
        if not transcode:
            written.append(stem)
            continue
        try:
            transcode_to_mp3(resolved[1], dest)
        except TranscodeError as err:
            manifest["missing"].append({"sample": stem, "ref": ref,
                                        "why": f"transcode failed: {err}"})
            continue
        written.append(stem)
    manifest["samples"] = written
    (sound_out / "soldier.json").write_text(
        json.dumps(manifest, indent=1) + "\n")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--mod", default="bf1942")
    parser.add_argument("--out", type=Path, required=True,
                        help="the tree to write `sounds/` into")
    parser.add_argument("--no-transcode", action="store_true",
                        help="parse and manifest only; write no mp3s")
    args = parser.parse_args(argv)

    if not args.no_transcode and not ffmpeg_available():
        print("ffmpeg is not on PATH; run with --no-transcode to manifest only",
              file=sys.stderr)
        return 2

    manifest = extract(args.game_dir, args.mod, args.out,
                       transcode=not args.no_transcode)
    for trigger, entry in manifest["triggers"].items():
        for patch in entry["patches"]:
            kind = "randomPlay" if patch["randomPlay"] else "layered"
            times = ", ".join(
                f"{layer['sample']}@{layer['at']}s" for layer in patch["layers"])
            print(f"{trigger:<22} {kind:<10} {times}")
    for gap in manifest["missing"]:
        print(f"missing: {gap}", file=sys.stderr)
    print(f"{len(manifest['samples'])} samples -> {args.out / 'sounds'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
