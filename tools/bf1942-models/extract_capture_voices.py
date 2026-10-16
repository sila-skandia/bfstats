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

The languages are the chain's own, not a fixed list: every `setRadioLanguage`
its soldiers declare (`chain_languages`), each under the folder
`LANGUAGE_NATIONS` names or, for a tongue the table has never seen, its own
name lower-cased. The path is the script's own too (`language_loads`):
`@Language` is replaced inside the `load` line the mod ships, so Battlefield
1918's `Sound/@RTD/Battlefield1918/Soldiers/@Language/` and Galactic
Conquest's fixed-rate `Sound/44khz/@Language/` are read where the engine
reads them. `extract_radio.py`, `extract_ctf_voices.py` and
`extract_soldier_voices.py` share all of this.

Standard library plus ffmpeg, like the other sound pipelines.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42.level import parse_ssc
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
    # Desert Combat's IraqSoldier (`Sound/<rate>/Iraqi/`). DC flies Iraq's
    # flag in the German slot, so the folder cannot be the side's flag nation;
    # the viewer reads `voices/languages.json` for it (extract_radio.py).
    "Iraqi": "iraq",
    # Forgotten Hope's own tongues (`Sound/<rate>/<Language>/` in FH's
    # sound.rfa, `setRadioLanguage` in its soldiers). The folder is the nation
    # code FH's menu art is named for (`conp_auss`, `conp_fin`, `conp_pol`).
    # `Finish` is the retail spelling of the directory and of the directive.
    "Australian": "auss",
    "Finish": "fin",
    "Polish": "pol",
    # Galactic Conquest's own tongues (`Sound/<rate>/<Language>/` in GCMOD's
    # sound.rfa), one per faction: HothRebel is the `setRadioLanguage` of the
    # Endor, Fleet, Russian and US soldiers, HothSnowtrooper of the German,
    # Japanese and ScoutTrooper ones, MonTrooper of MonTrooper. The soldiers
    # spell it `Hothsnowtrooper`, so the lookup is case-insensitive.
    "HothRebel": "hothrebel",
    "HothSnowtrooper": "hothsnowtrooper",
    "MonTrooper": "montrooper",
    # The tongues FHSW and FHSWEurope's soldiers declare with
    # `setRadioLanguage` (measured 2026-10-14 over the chain's objects.rfa
    # files, against the `sound/<rate>/<Language>/` folders that ship them).
    # A language missing here has no `voices/languages.json` entry, so the
    # viewer falls back to the side's flag nation and then to `voices/us`:
    # doomed_budapest's Hungarian side (`game.setTeamSkin 1 HungarianSoldier`)
    # played American radio. The folder codes are the nation codes the
    # viewer's `voices/<nation>` lookup uses; they need no menu art.
    "Hungarian": "hun",
    "Dutch": "dut",
    "Albanian": "alb",
    "Amharic": "amh",
    "Arabic": "ara",
    "Chinese": "chi",
    "Greek": "gre",
    "Norwegian": "nor",
    "Romanian": "rom",
    "Slovak": "slo",
    "Spanish": "spa",
    "Srbcro": "srb",
    "Thai": "tha",
}
LANGUAGE_FOLDERS = {k.lower(): v for k, v in LANGUAGE_NATIONS.items()}

GAMEPLAY_SSC = "Bf1942/Game/GamePlay.ssc"
# Where a stem the mod's script does not load would be: vanilla's own path.
DEFAULT_LOAD = "@ROOT/Sound/@RTD/@Language/{stem}.wav"

RADIO_LANGUAGE = re.compile(
    r'(?im)^[ \t]*objectTemplate\.(create|setRadioLanguage)[ \t]+(?:\S+[ \t]+)?"?([^"\s]+)"?')


def voice_pool(game_dir: Path, mod: str) -> ArchivePool:
    """The chain's sound, menu and object archives and its `bf1942/game`
    archive, nearest mod first: the samples, the scripts that load them under
    `@Language`, and the soldiers that say which language that is."""
    pool = ArchivePool()
    for step in mod_chain(game_dir, mod):
        archives = find_archives_dir(step)
        if archives is None:
            continue
        pool.add_dir(archives, SOUND_ARCHIVES + ("menu", "objects"))
        for child in archives.iterdir():
            if child.is_dir() and child.name.lower() == "bf1942":
                pool.add_dir(child, ("game",))
    return pool


def soldier_radio_languages(pool) -> dict[str, str]:
    """Soldier template (lower-cased) -> its `ObjectTemplate.setRadioLanguage`
    as the con spells it, over every `.con` under `Objects/Soldiers/` (the
    only place any installed mod declares one, measured 2026-10-17)."""
    out: dict[str, str] = {}
    for name in pool.names():
        low = name.lower().replace("\\", "/")
        if not (low.startswith("objects/soldiers/") and low.endswith(".con")):
            continue
        data = pool.try_read(name)
        if not data:
            continue
        soldier = None
        for match in RADIO_LANGUAGE.finditer(data.decode("latin-1")):
            if match.group(1).lower() == "create":
                soldier = match.group(2)
            elif soldier:
                out[soldier.lower()] = match.group(2)
    return dict(sorted(out.items()))


def language_folder(language: str, taken: set[str] = frozenset()) -> str:
    """The voice folder for `language`: the table's code, else the name
    lower-cased to `[a-z0-9]`, kept clear of the folders already `taken`."""
    known = LANGUAGE_FOLDERS.get(language.lower())
    if known:
        return known
    base = re.sub(r"[^a-z0-9]+", "", language.lower()) or "language"
    folder, n = base, 2
    while folder in taken:
        folder, n = f"{base}{n}", n + 1
    return folder


def chain_languages(pool) -> dict[str, str]:
    """Language -> voice folder for a chain: the table's rows, then every
    language a soldier of the chain declares that the table does not name.
    A declared language is never skipped for want of a row (FHSW's Hungarians
    spoke American radio until 2026-10-14 for that reason; bf1918 declares
    eight the table has never had). Whether the chain ships any line in it is
    the extractor's question: a language with no files writes no folder."""
    out = dict(LANGUAGE_NATIONS)
    taken = set(out.values())
    for language in sorted(set(soldier_radio_languages(pool).values()), key=str.lower):
        if language.lower() in LANGUAGE_FOLDERS or language in out:
            continue
        if any(known.lower() == language.lower() for known in out):
            continue
        out[language] = language_folder(language, taken)
        taken.add(out[language])
    return out


def language_loads(text: str, source: str) -> dict[str, str]:
    """Stem (lower-cased) -> the script's own `load` path for every sample it
    reads from under `@Language`, with `@Language` still in it."""
    out: dict[str, str] = {}
    for patch in parse_ssc(text, level="high", source=source):
        for sample in patch.samples:
            path = sample.file.replace("\\", "/")
            if "@language/" in path.lower():
                stem = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
                out.setdefault(stem.lower(), path)
    return out


def script_loads(pool, name: str) -> dict[str, str]:
    """`language_loads` of a script along the chain; empty when it is absent."""
    raw = pool.try_read(name)
    return language_loads(raw.decode("latin-1", "replace"), name) if raw else {}


def language_ref(path: str, language: str) -> str:
    """A `load` path with `@Language` replaced, as the engine expands it."""
    return re.sub(r"(?i)@language", lambda _: language, path)


def load_path(loads: dict[str, str], stem: str) -> str:
    """The script's path for `stem`, else vanilla's."""
    return loads.get(stem.lower()) or DEFAULT_LOAD.format(stem=stem)

STEMS = (
    "WeNowHaveControlOver", "WeNowHaveControlOver2", "WeNowHaveControlOver3",
    "WeHaveLostControlOf", "WeHaveLostControlOf2", "WeHaveLostControlOf3",
)

# The announcer is a 2D radio voice; 22 kHz is what the engine's default
# quality plays and it is indistinguishable for speech.
RATES = ("22khz", "44khz", "11khz")


def extract(game_dir: Path, mod: str, out: Path, transcode: bool = True) -> dict:
    sounds = voice_pool(game_dir, mod)
    loads = script_loads(sounds, GAMEPLAY_SSC)
    manifest: dict = {"mod": mod, "nations": {}, "missing": []}
    for language, nation in chain_languages(sounds).items():
        written = []
        for stem in STEMS:
            ref = language_ref(load_path(loads, stem), language)
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
