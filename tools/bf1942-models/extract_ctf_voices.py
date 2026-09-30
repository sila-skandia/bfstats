#!/usr/bin/env python3
"""Extract Capture the Flag's announcer, `Bf1942/Game/CTF.ssc`, per nation.

`BfMenu` loads `CTF.ssc` beside `GamePlay.ssc` (`BfMenu+0x6f8`,
0x006a5630) under the LOCAL side's `@Language`, and 0x006e4290 plays a
patch of it for each flag event by the actor's team (ledger CTF-7):

    0 Axis team stole flag        1 Allied team stole flag
    2 Axis team captured the flag 3 Allied team captured the flag
    4 Axis team returned the flag 5 Allied team returned the flag
    6 / 7 dropped                 never played (the drop cases skip the voice)

Every patch but the last two loads a line and its `ALT` twin and ends in
`randomPlay 1`: one of the two per event.

Output, under the tree's `_shared`, beside the radio's own voices
(`extract_radio.py`), in the same nation folders:

    voices/<nation>/<stem>.mp3    one per stem the nation's language ships
    voices/ctf-sounds.json        the patches in file order (the patch index
                                  is the order), each patch's stems and whether
                                  it picks one, and per nation the stems it
                                  lacks: the engine drops a load whose file is
                                  missing before it counts it (RADIO-6), so a
                                  nation rolls over what it has.

Neither Desert Combat nor DC Final ships a `CTF.ssc`: both play vanilla's
script, with Desert Combat's own UsEnglish and Iraqi recordings of it.

    python3 extract_ctf_voices.py --mod DC_Final \\
        --out tools/bf1942-models/viewer/maps/mods/dc_final/_shared
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.level import parse_ssc  # noqa: E402
from bf42.rfa import ArchivePool, find_archives_dir  # noqa: E402
from extract_capture_voices import LANGUAGE_NATIONS, RATES  # noqa: E402
from extract_map import (  # noqa: E402
    SOUND_ARCHIVES, TranscodeError, ffmpeg_available, resolve_sound, transcode_to_mp3,
)
from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402

CTF_SSC = "Bf1942/Game/CTF.ssc"


def _stem(file: str) -> str:
    return file.replace("\\", "/").rsplit("/", 1)[-1].rsplit(".", 1)[0]


def ctf_patches(text: str) -> list[dict]:
    """The script's patches in file order: `{index, stems, random}`."""
    out = []
    for index, patch in enumerate(parse_ssc(text, level="high", source=CTF_SSC)):
        out.append({"index": index, "stems": [_stem(s.file) for s in patch.samples],
                    "random": bool(patch.random_play)})
    return out


def sound_pool(game_dir: Path, mod: str) -> ArchivePool:
    pool = ArchivePool()
    for step in mod_chain(game_dir, mod):
        archives = find_archives_dir(step)
        if archives is None:
            continue
        pool.add_dir(archives, SOUND_ARCHIVES)
        for child in archives.iterdir():
            if child.is_dir() and child.name.lower() == "bf1942":
                pool.add_dir(child, ("game",))
    return pool


def extract(game_dir: Path, mod: str, out: Path, transcode: bool = True) -> dict:
    pool = sound_pool(game_dir, mod)
    raw = pool.try_read(CTF_SSC)
    if raw is None:
        raise SystemExit(f"{CTF_SSC} not found along {mod}'s chain")
    patches = ctf_patches(raw.decode("latin-1", "replace"))
    stems = sorted({stem for patch in patches for stem in patch["stems"]})
    manifest: dict = {"mod": mod, "source": CTF_SSC, "patches": patches,
                      "nations": {}, "missing": []}
    for language, nation in LANGUAGE_NATIONS.items():
        written = []
        for stem in stems:
            resolved = resolve_sound(f"@ROOT/Sound/@RTD/{language}/{stem}.wav", None, pool,
                                     rates=RATES)
            if resolved is None:
                continue
            if transcode:
                dest = out / "voices" / nation / f"{stem}.mp3"
                dest.parent.mkdir(parents=True, exist_ok=True)
                try:
                    transcode_to_mp3(resolved[1], dest)
                except TranscodeError as err:
                    manifest["missing"].append({"nation": nation, "stem": stem, "why": str(err)})
                    continue
            written.append(stem)
        if written:
            manifest["nations"][nation] = {"language": language, "stems": written}
            lacking = sorted(set(stems) - set(written))
            if lacking:
                manifest["missing"].append({"nation": nation, "stems": lacking})
    if transcode:
        (out / "voices").mkdir(parents=True, exist_ok=True)
        (out / "voices" / "ctf-sounds.json").write_text(json.dumps(manifest, indent=1) + "\n")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--mod", default="bf1942")
    parser.add_argument("--out", type=Path, required=True,
                        help="the tree's `_shared` directory to write `voices/` under")
    parser.add_argument("--no-transcode", action="store_true")
    args = parser.parse_args(argv)
    if not args.no_transcode and not ffmpeg_available():
        print("ffmpeg is not on PATH; run with --no-transcode to manifest only",
              file=sys.stderr)
        return 2
    manifest = extract(args.game_dir, args.mod, args.out, not args.no_transcode)
    print(f"{len(manifest['patches'])} patches")
    for nation, row in manifest["nations"].items():
        print(f"{nation:5} {row['language']:10} {len(row['stems'])} stems")
    for miss in manifest["missing"]:
        print("missing:", miss)
    return 0 if manifest["nations"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
