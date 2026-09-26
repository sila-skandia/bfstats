#!/usr/bin/env python3
"""Extract the soldier's own voice lines, one folder per nation.

    python3 extract_soldier_voices.py --out viewer/maps/_shared

Four soldier sound scripts load their samples from `Sound/@RTD/@Language/`:

    SoldierHitDamage.ssc      c_SstHitDamage      BeingHit1..6     the grunt
    SoldierFFHitDamage.ssc    c_SstFFHitDamage    WatchYourAim1..9 a team hit
    SoldierKilled.ssc         c_SstKilled         Dying1..8        the last word
    SoldierFallingHigh.ssc    c_SstFallingHigh    fallparachute1..3 the scream

`@Language` is the side's own tongue, the same `setRadioLanguage` the
announcer and the radio read (see `extract_capture_voices.py`), so a Marine
who hits the sand at Wake without his chute swears in UsEnglish and a German
does it in German. `extract_soldier_sounds.py` resolves the same scripts once,
first language wins, for its `soldier.json`; this lays every language out
beside the radio lines so the page can pick the speaker's.

Output: `<out>/voices/<nation>/<stem>.mp3` at 22 kHz and a manifest at
`<out>/voices/soldier-voices.json` (not `voices.json`, which is the
announcer's). Standard library plus ffmpeg, like the other sound pipelines.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.rfa import ArchivePool, find_archives_dir
from extract_capture_voices import LANGUAGE_NATIONS, RATES
from extract_map import (
    SOUND_ARCHIVES, TranscodeError, ffmpeg_available, resolve_sound,
    transcode_to_mp3,
)
from extract_models import DEFAULT_GAME_DIR, mod_chain

# Stems exactly as the scripts spell them; `resolve_sound` matches case-blind,
# which is what finds English's lower-case `beinghit1.wav`.
STEMS = (
    *(f"BeingHit{i}" for i in range(1, 7)),
    "WatchYourAim", *(f"WatchYourAim{i}" for i in range(2, 10)),
    *(f"Dying{i}" for i in range(1, 9)),
    "fallparachute", "fallparachute2", "fallparachute3",
)


def extract(game_dir: Path, mod: str, out: Path, transcode: bool = True) -> dict:
    sounds = ArchivePool()
    for step in mod_chain(game_dir, mod):
        archives = find_archives_dir(step)
        if archives is not None:
            sounds.add_dir(archives, SOUND_ARCHIVES)
    manifest: dict = {"mod": mod, "nations": {}, "missing": []}
    for language, nation in LANGUAGE_NATIONS.items():
        written = []
        for stem in STEMS:
            resolved = resolve_sound(f"@ROOT/Sound/@RTD/{language}/{stem}.wav",
                                     None, sounds, rates=RATES)
            if resolved is None:
                continue
            dest = out / "voices" / nation / f"{stem}.mp3"
            if transcode:
                dest.parent.mkdir(parents=True, exist_ok=True)
                try:
                    transcode_to_mp3(resolved[1], dest)
                except TranscodeError as err:
                    manifest["missing"].append({"nation": nation, "stem": stem,
                                                "why": f"transcode failed: {err}"})
                    continue
            written.append(stem)
        if written:
            manifest["nations"][nation] = {"language": language, "samples": written}
        if written and len(written) != len(STEMS):
            missing = [s for s in STEMS if s not in written]
            manifest["missing"].append({"nation": nation, "stems": missing})
    if transcode and manifest["nations"]:
        (out / "voices" / "soldier-voices.json").write_text(
            json.dumps(manifest, indent=1) + "\n")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--mod", default="bf1942")
    parser.add_argument("--out", type=Path, required=True,
                        help="the `_shared` directory to write `voices/` under")
    parser.add_argument("--no-transcode", action="store_true")
    args = parser.parse_args(argv)
    if not args.no_transcode and not ffmpeg_available():
        print("ffmpeg is not on PATH; run with --no-transcode to manifest only",
              file=sys.stderr)
        return 2
    manifest = extract(args.game_dir, args.mod, args.out, not args.no_transcode)
    for nation, row in manifest["nations"].items():
        print(f"{nation:5} {row['language']:10} {len(row['samples'])} samples")
    for miss in manifest["missing"]:
        print("missing:", miss)
    return 0 if manifest["nations"] else 1


if __name__ == "__main__":
    sys.exit(main())
