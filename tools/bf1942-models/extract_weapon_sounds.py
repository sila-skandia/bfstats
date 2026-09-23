#!/usr/bin/env python3
"""Extract each hand weapon's fire report as an mp3 the viewer plays per shot.

    python3 extract_weapon_sounds.py                       # vanilla, whole armoury
    python3 extract_weapon_sounds.py Thompson K98 --out ./out/sounds

Every `HandFireArms` declares `ObjectTemplate.loadSoundScript Sounds/<Name>.ssc`
next to its `Objects.con` (the binoculars alone carry nothing), and the script
is the same six-slot layout the vehicle guns use — Fire, Reload, Release, Shell
Bounce, MG distance, Fire Loop. The one that matters here is decided by what
kind of weapon it is, and the data says which without being asked: a bolt rifle
or a pistol puts its report in the Fire slot and leaves the Fire Loop out, an
automatic declares its Fire slot as `silence.wav` and holds the trigger on a
looped sample at the end. `fire_sample` reads it in exactly that order.

What ships is one sample per weapon, `<Name>.mp3`, chosen for the first-person
ear: of the layers a patch stacks, the ones audible at the muzzle (their
`Volume <- Distance` ramps evaluated at zero) beat the ones that only exist
150 m out, and the loudest of those is the report. A `weapons.json` manifest
alongside carries what the viewer needs to play it honestly — the authored
volume, the `randomStartPitch` jitter, and the `Time` gate on weapons whose
sound is not at the trigger (the knife's swish lands 0.4 s into the swing).

Alongside that first-person pick, the same entry now also carries `layers`:
the whole firing patch through `_sound_layers`, exactly as
`extract_vehicle_sounds` ships a tank's guns. That is what a listener who is
NOT the shooter needs — a BAR's near and far loops hand over on `Volume <-
Distance`, and playing only the muzzle pick attenuates to silence where the
game still has a crackle. `viewer/world-fire.js` plays those layers
positionally, one cycle per round.

Weapons whose fire slot is foley are shipped as they are authored — a grenade
throw is a grunt of cloth, a landmine goes down with a rustle — and weapons
with nothing to play are named in the manifest with the reason, so "the medkit
is quiet" is a recorded fact rather than a missing file.

Standard library plus ffmpeg, same as the map sound pipeline.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import con as con_mod
from bf42.level import SoundSample, parse_ssc, resolve_ssc_path
from bf42.rfa import ArchivePool, find_archives_dir
from extract_map import (
    SOUND_ARCHIVES, VEHICLE_RATES, _SILENCE, TranscodeError,
    _firing_patch, _sound_layers, sample_writer,
    ffmpeg_available, resolve_sound, transcode_to_mp3,
)
from extract_models import (
    DEFAULT_GAME_DIR, OBJECT_ARCHIVES, build_library, catalogue, mod_chain,
)

# A hand weapon's sound is heard from its own stock, so like the vehicles it
# gets the tier the game plays on a desktop and the 44 kHz masters first.
WEAPON_SOUND_LEVEL = "high"


def _ramp_at(params: list[float], x: float) -> float:
    """`Ramp p1 p2 p3 p4` evaluated at `x`, the same shape the viewer uses."""
    a, b, base, delta = (list(params) + [0.0, 0.0, 0.0, 0.0])[:4]
    if x <= a:
        return base
    if x >= b:
        return base + delta
    span = b - a
    return base + delta if span <= 0 else base + delta * ((x - a) / span)


def muzzle_gain(sample: SoundSample, at_time: float | None = 0.0) -> float:
    """The sample's volume where the shooter stands: distance zero, time `at_time`.

    Only the ramps whose control value is known here are evaluated —
    `Distance` is zero at the muzzle by definition, `Time` is the moment the
    patch was triggered. Anything else leaves the gain alone, the same
    unknown-source rule `engine-audio.js` follows. `at_time=None` skips the
    time gates too, which is how the delayed-but-only samples (the knife) are
    admitted on the second pass.
    """
    gain = sample.volume
    for effect in sample.effects:
        if effect.destination != "volume" or effect.envelope != "ramp":
            continue
        if effect.source == "distance":
            gain *= _ramp_at(effect.params, 0.0)
        elif effect.source == "time" and at_time is not None:
            gain *= _ramp_at(effect.params, at_time)
    return gain


def fire_delay(sample: SoundSample) -> float:
    """Seconds after the trigger before this sample is audible.

    A `Volume <- Time` ramp that starts at zero is the script's own start
    delay (`trigger Volume` holds the voice until its volume first goes
    non-zero). Ramps multiply, so the sample sounds when the *last* gate
    opens — the max, though nothing in vanilla stacks two on one fire layer.
    """
    delay = 0.0
    for effect in sample.effects:
        if (effect.destination == "volume" and effect.source == "time"
                and effect.envelope == "ramp" and len(effect.params) >= 1
                and _ramp_at(effect.params, 0.0) <= 0):
            delay = max(delay, effect.params[0])
    return delay


def _non_silence(samples: list[SoundSample]) -> list[SoundSample]:
    return [s for s in samples
            if not s.file.replace("\\", "/").lower().endswith(_SILENCE)]


def fire_sample(patches) -> tuple[SoundSample | None, str]:
    """The one sample a shot should play, and which slot supplied it.

    Slot one is the Fire patch. If it holds anything real, this is a
    single-shot weapon and the report is its loudest muzzle-audible immediate
    layer — `priority` breaks ties the way the engine's voice stealing would.
    A fire patch whose every sample is time-gated (the knife, the grenades)
    still fires; the gate is honest data and rides out as `delay`.

    If slot one is silence, the weapon is an automatic and its voice is the
    Fire Loop: the last patch holding looped samples, searched from the end
    because the loop closes every vanilla script while the includes between
    (`ShellBounce.ssc`, `MGdist.ssc`) can scatter one-shot layers into
    whatever patch is open. Taking only the looped samples is what keeps that
    scatter out of the pick.

    Returns `(None, reason)` when there is nothing to play, in words the
    manifest can carry.
    """
    if not patches:
        return None, "script declares no patches"
    candidates = _non_silence(patches[0].samples)
    if candidates:
        immediate = [s for s in candidates if muzzle_gain(s) > 0]
        pool = immediate or [s for s in candidates
                             if muzzle_gain(s, at_time=None) > 0]
        if pool:
            best = max(enumerate(pool),
                       key=lambda pair: (muzzle_gain(pair[1], at_time=None),
                                         pair[1].priority or 0, -pair[0]))
            return best[1], "fire"
    for patch in reversed(patches):
        loops = [s for s in _non_silence(patch.samples) if s.loop]
        audible = [s for s in loops if muzzle_gain(s) > 0]
        if audible:
            best = max(enumerate(audible),
                       key=lambda pair: (muzzle_gain(pair[1]),
                                         pair[1].priority or 0, -pair[0]))
            return best[1], "fireLoop"
    return None, "every patch is silence"


def extract_weapon_sound(name: str, library: con_mod.ObjectLibrary,
                         objects: ArchivePool, sounds: ArchivePool,
                         out: Path) -> tuple[dict | None, str | None]:
    """One weapon: `(manifest entry, None)` or `(None, why it is quiet)`."""
    template = library.object(name)
    if template is None:
        return None, "template not found"
    if not template.sound_script:
        return None, "no loadSoundScript"
    script_path = resolve_ssc_path(template.source, template.sound_script)

    def read_script(path: str) -> str | None:
        hit = objects.find(path)
        return objects.read(hit).decode("latin-1") if hit else None

    text = read_script(script_path)
    if text is None:
        return None, f"sound script missing: {script_path}"
    patches = parse_ssc(text, level=WEAPON_SOUND_LEVEL,
                        include=read_script, source=script_path)
    sample, slot = fire_sample(patches)
    if sample is None:
        return None, slot
    resolved = resolve_sound(sample.file, None, sounds, VEHICLE_RATES)
    if resolved is None:
        return None, f"wav not in sound archives: {sample.file}"
    basename, data = resolved

    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{name}.mp3"
    # Named for the weapon, not the wav: two weapons sharing rktfireST.wav
    # (Bazooka, Panzershreck) each get their own file, small and cheap, and
    # the viewer needs no lookup beyond the name it already holds.
    if not target.exists():
        transcode_to_mp3(data, target)

    entry = {
        "file": target.name,
        "wav": basename,
        "script": script_path,
        "slot": slot,
        "volume": sample.volume,
        "loop": sample.loop,
    }
    if sample.random_start_pitch:
        entry["randomStartPitch"] = list(sample.random_start_pitch)
    delay = fire_delay(sample)
    if delay > 0:
        entry["delay"] = delay
    # The whole firing patch, near and far, for a listener who is not the
    # shooter. Same `_sound_layers` the vehicle guns ship through, so a
    # hand weapon's `Volume <- Distance` hand-over reaches `world-fire.js`
    # intact. The `_firing_patch` pick (loops, for an automatic) is the held
    # trigger's own voice; `world-fire` plays each layer as a single cycle,
    # one report per round, which is what a bystander hears.
    #
    # Wrapped, because the first-person pick above is the one the player
    # fires every round and a layer that cannot resolve (a level-local wav
    # this pass has no level archive for) must not cost it. `world-fire`
    # falls back to `FALLBACK_RAMP` over that pick.
    try:
        write = sample_writer(out, out)
        layers = _sound_layers(_firing_patch(patches), sounds, write)
    except Exception as exc:            # noqa: BLE001 - a sample must not kill the armoury
        print(f"  {name}: layers skipped ({exc})", file=sys.stderr)
        layers = []
    if layers:
        entry["layers"] = layers
    return entry, None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("templates", nargs="*",
                    help="hand weapon template names (default: the whole armoury)")
    ap.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    ap.add_argument("--mod", default="bf1942")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent / "viewer" / "models" / "sounds")
    args = ap.parse_args()

    if not ffmpeg_available():
        sys.exit("ffmpeg not found — the fire sounds ship as mp3 or not at all")

    game_dir = args.game_dir.expanduser()
    if not game_dir.is_dir():
        sys.exit(f"game dir not found: {game_dir}")

    chain = mod_chain(game_dir, args.mod)
    objects, sounds = ArchivePool(), ArchivePool()
    for mod_dir in chain:
        archives = find_archives_dir(mod_dir)
        if archives is None:
            continue
        objects.add_dir(archives, OBJECT_ARCHIVES)
        sounds.add_dir(archives, SOUND_ARCHIVES)
    library = build_library(objects)

    names = args.templates or [name for name, category, _ in
                               catalogue(objects, library)
                               if category == "handweapon"]

    weapons: dict[str, dict] = {}
    silent: dict[str, str] = {}
    failures = 0
    for name in names:
        try:
            entry, reason = extract_weapon_sound(
                name, library, objects, sounds, args.out)
        except TranscodeError as exc:
            print(f"  {name}: {exc}", file=sys.stderr)
            failures += 1
            continue
        if entry is not None:
            weapons[name] = entry
            extras = "".join([
                f" delay={entry['delay']}s" if "delay" in entry else "",
                " loop" if entry["loop"] else "",
            ])
            print(f"  {name}: {entry['wav']} ({entry['slot']}){extras}"
                  f" -> {entry['file']}", file=sys.stderr)
        else:
            silent[name] = reason
            print(f"  {name}: quiet ({reason})", file=sys.stderr)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "weapons.json").write_text(json.dumps({
        "mod": args.mod,
        "level": WEAPON_SOUND_LEVEL,
        "weapons": weapons,
        "silent": silent,
    }, indent=2))
    print(f"{len(weapons)} weapon(s) with a fire sound, {len(silent)} quiet"
          + (f", {failures} failed" if failures else "")
          + f" -> {args.out / 'weapons.json'}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
