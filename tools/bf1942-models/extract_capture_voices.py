#!/usr/bin/env python3
"""Extract the control-point announcer lines, one folder per nation.

`Bf1942/Game/GamePlay.ssc` plays `WeNowHaveControlOver{,2,3}.wav` on
`GainControlPoint` and `WeHaveLostControlOf{,2,3}.wav` on
`LoseControlPoint`, both under `Sound/@RTD/@Language/`. `@Language` is not
the player's UI language: every soldier template declares
`ObjectTemplate.setRadioLanguage "<Lang>"` (`Objects/Soldiers/*/Objects.con`),
so a side hears its own soldier's tongue -- Russians on Kharkov hear Russian,
US Marines on Wake hear UsEnglish, the British hear English.

Output: `<out>/voices/<nation>/<stem>.mp3` at 22 kHz, `<nation>` being the
viewer's own nation code (the key `teamNation` answers), so `map.html` can
go straight from the local side's nation to a folder. Vanilla ships six
tongues; Road to Rome adds French and Italian.

Standard library plus ffmpeg, like the other sound pipelines.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.rfa import ArchivePool, find_archives_dir
from extract_map import (
    SOUND_ARCHIVES, TranscodeError, ffmpeg_available, resolve_sound,
    transcode_to_mp3,
)
from extract_models import DEFAULT_GAME_DIR, mod_chain

# Engine language directory -> viewer nation code.
LANGUAGE_NATIONS = {
    "UsEnglish": "us",
    "English": "brit",
    "Canadian": "can",
    "German": "ger",
    "Japanese": "jp",
    "Russian": "rus",
    "Italian": "it",
    "French": "fre",
}

STEMS = (
    "WeNowHaveControlOver", "WeNowHaveControlOver2", "WeNowHaveControlOver3",
    "WeHaveLostControlOf", "WeHaveLostControlOf2", "WeHaveLostControlOf3",
)

# The announcer is a 2D radio voice; 22 kHz is what the engine's default
# quality plays and it is indistinguishable for speech.
RATES = ("22khz", "44khz", "11khz")


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
            ref = f"@ROOT/Sound/@RTD/{language}/{stem}.wav"
            resolved = resolve_sound(ref, None, sounds, rates=RATES)
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
            manifest["missing"].append({"nation": nation,
                                        "why": f"only {len(written)} of {len(STEMS)} stems"})
    if transcode and manifest["nations"]:
        (out / "voices" / "voices.json").write_text(json.dumps(manifest, indent=1) + "\n")
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
    raise SystemExit(main())
