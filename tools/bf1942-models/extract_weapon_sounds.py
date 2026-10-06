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
    FIRE_LOOP_SLOT, RELEASE_AFTER, RELEASE_SLOTS, RELOAD_SLOT,
    SOUND_ARCHIVES, VEHICLE_RATES, _SILENCE, TranscodeError,
    _firing_patch, _sound_layers, _trigger_slots, sample_writer,
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

    A Fire Loop slot (patch 5) that loops nothing is still the round's voice:
    the engine triggers it every round and starts each of its samples again
    on a new voice (ledger SND-13, SND-14), so it plays per shot like a Fire
    slot. DC's CAR-15 and Skorpion are authored that way (`Car15s_*`,
    `scorpion_fire*`, one shot and its tail).

    Past that, a weapon whose Fire and Fire Loop slots are both silent or
    absent is heard only from the slots `FireArms::updateSound` triggers when
    the rounds stop (Release, Shell Bounce, MG distance; lnxded 0x0828cc10),
    which for a single-shot weapon is every shot, `RELEASE_AFTER` behind it.
    DC's grenade launchers are authored that way: the M203 and AK47GP30 keep
    `M203_fire_*` in the MG distance slot of a five-patch script (DC 0.7) or
    the Shell Bounce and Release slots of a four- and three-patch one (DC
    Final). Slot `release` says so, and the delay rides out with the pick.

    Returns `(None, reason)` when there is nothing to play, in words the
    manifest can carry.
    """
    if not patches:
        return None, "script declares no patches"

    def loudest(candidates):
        immediate = [s for s in candidates if muzzle_gain(s) > 0]
        pool = immediate or [s for s in candidates
                             if muzzle_gain(s, at_time=None) > 0]
        if not pool:
            return None
        return max(enumerate(pool),
                   key=lambda pair: (muzzle_gain(pair[1], at_time=None),
                                     pair[1].priority or 0, -pair[0]))[1]

    candidates = _non_silence(patches[0].samples)
    if candidates:
        best = loudest(candidates)
        if best is not None:
            return best, "fire"
    for patch in reversed(patches):
        loops = [s for s in _non_silence(patch.samples) if s.loop]
        audible = [s for s in loops if muzzle_gain(s) > 0]
        if audible:
            best = max(enumerate(audible),
                       key=lambda pair: (muzzle_gain(pair[1]),
                                         pair[1].priority or 0, -pair[0]))
            return best[1], "fireLoop"
    if len(patches) > FIRE_LOOP_SLOT:
        best = loudest(_non_silence(patches[FIRE_LOOP_SLOT].samples))
        if best is not None:
            return best, "fireLoop"
    # All three sound together on a release, so the loudest of them is the
    # report: DC 0.7's M203 puts its shell casings in slot 2, the distant
    # rattle in 3 and its report in 4.
    released = [s for index in RELEASE_SLOTS if index < len(patches)
                for s in _non_silence(patches[index].samples)]
    best = loudest(released)
    if best is not None:
        return best, "release"
    return None, "every patch is silence"


def extract_weapon_sound(name: str, library: con_mod.ObjectLibrary,
                         objects: ArchivePool, sounds: ArchivePool,
                         out: Path, previous: dict | None = None
                         ) -> tuple[dict | None, str | None]:
    """One weapon: `(manifest entry, None)` or `(None, why it is quiet)`.

    `previous` is the weapon's entry in the manifest already on disk. An mp3
    already there is kept, unless that entry says it was made from another
    wav: a pick that moves (the parser's tier fix moved none, DC's CAR-15
    gained one) must not leave the old recording under the weapon's name.
    """
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
    stale = previous is not None and previous.get("wav") != basename
    _write_mp3(data, target, stale)

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
    if slot == "release":
        delay += RELEASE_AFTER
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
        write = sample_writer(out, out, sounds=sounds)
        layers = _sound_layers(_firing_patch(patches), sounds, write,
                               patches=patches)
    except Exception as exc:            # noqa: BLE001 - a sample must not kill the armoury
        print(f"  {name}: layers skipped ({exc})", file=sys.stderr)
        layers = []
    if layers:
        entry["layers"] = layers
    picks = _alternates(name, sample, patches, sounds, out, previous)
    if picks:
        entry["randomPlay"] = picks
    press, release = _burst_edges(name, sample, slot, patches, sounds, out,
                                  previous)
    if press:
        entry["press"] = press
    if release:
        entry["release"] = release
    reload = _reload_edge(name, patches, sounds, out, previous)
    if reload:
        entry["reload"] = reload
    return entry, None


def _burst_edges(name: str, sample: SoundSample, slot: str, patches,
                 sounds: ArchivePool, out: Path, previous: dict | None
                 ) -> tuple[list[dict], list[dict]]:
    """The shooter's spin-up and release tail: `(press, release)`.

    The same two edges `extract_map._trigger_slots` gives a vehicle gun
    (ledger SND-12, SND-14, SND-16), for the ear at the muzzle: a loop pick's
    patch plays its one-shots once a press, and a stop triggers Release,
    Shell Bounce and MG distance -- DC's `akm_release`, `m16_release`,
    `hk_fire_release`, vanilla's casings. Only loads audible at the muzzle get
    a file (`<Name>.p<n>.mp3`, `<Name>.r<slot>.<load>.mp3`); a patch that
    rolls one load a trigger (`randomPlay`, SND-15) keeps its `loads` count so
    a roll can land on one the shooter does not hear. A weapon whose report
    already comes out of the release slots (`slot == "release"`) has none.
    """
    home = next((p for p in patches if any(s is sample for s in p.samples)),
                None)
    chosen = [sample] if home is None else [
        s for s in home.samples if bool(s.loop) is bool(sample.loop)]
    press, release = _trigger_slots(patches, chosen or [sample])
    if slot == "release":
        release = {}
    before = _edge_wavs(previous)
    press_picks = [pick for index, load in enumerate(press)
                   if (pick := _edge_pick(load, out / f"{name}.p{index}.mp3",
                                          sounds, before))]
    release_groups = []
    for index, loads in release.items():
        group = _slot_group(name, index, patches[index], loads, sounds, out,
                            before)
        if group:
            release_groups.append(group)
    return press_picks, release_groups


def _reload_edge(name: str, patches, sounds: ArchivePool, out: Path,
                 previous: dict | None) -> dict | None:
    """The Reload slot (patch 1), as the shooter and a bystander hear it.

    `FireArms::Reload` triggers patch 1 once, at the start of a magazine
    change (lnxded `0x08289d80`, client `0x00539c80`, the call at
    `0x00539cdf`; ledger SND-17), and every reload goes through it: R, the
    automatic change on a dry magazine, and `Fire` on an empty `autoReload`
    one (AI-133). Each load waits for its own `Volume <- Time` gate, which is
    how DC's M16 lays thirteen recordings over its 2.6 s change (`delay` per
    pick, as the knife's swish has always had it).

    `picks` are the loads audible at the muzzle, one mp3 each
    (`<Name>.r1.<load>.mp3`, the release groups' naming), for the shooter's
    ear; `layers` is the whole patch through `_sound_layers` for
    `world-fire.js`, whose `Volume <- Distance` ramps are why nobody hears
    another soldier reload: every one of vanilla's 239 reload loads stops at
    1 m, and 563 of Desert Combat's 573. None when the slot is silent.
    """
    if len(patches) <= RELOAD_SLOT:
        return None
    patch = patches[RELOAD_SLOT]
    loads = _non_silence(patch.samples)
    if not loads:
        return None
    group = _slot_group(name, RELOAD_SLOT, patch, loads, sounds, out,
                        _edge_wavs(previous))
    if not group:
        return None
    try:
        write = sample_writer(out, out, sounds=sounds)
        layers = _sound_layers(loads, sounds, write, patches=patches)
    except Exception as exc:            # noqa: BLE001 - the shooter's picks stand
        print(f"  {name}: reload layers skipped ({exc})", file=sys.stderr)
        layers = []
    if layers:
        group["layers"] = layers
    return group


def _edge_wavs(previous: dict | None) -> dict[str, str]:
    """`file -> wav` for every edge pick the manifest on disk already names."""
    previous = previous or {}
    before = {pick.get("file"): pick.get("wav")
              for group in (previous.get("release") or [])
              for pick in group.get("picks", [])}
    before.update({pick.get("file"): pick.get("wav")
                   for pick in (previous.get("press") or [])})
    before.update({pick.get("file"): pick.get("wav")
                   for pick in (previous.get("reload") or {}).get("picks", [])})
    return before


def _edge_pick(load: SoundSample, target: Path, sounds: ArchivePool,
               before: dict[str, str]) -> dict | None:
    """One edge load as an mp3 the shooter hears, or None where he does not."""
    if muzzle_gain(load, at_time=None) <= 0:
        return None
    resolved = resolve_sound(load.file, None, sounds, VEHICLE_RATES)
    if resolved is None:
        return None
    wav, data = resolved
    _write_mp3(data, target, target.exists()
               and before.get(target.name) not in (None, wav))
    pick = {"file": target.name, "wav": wav, "volume": load.volume}
    if load.random_start_pitch:
        pick["randomStartPitch"] = list(load.random_start_pitch)
    if (delay := fire_delay(load)) > 0:
        pick["delay"] = delay
    return pick


def _slot_group(name: str, index: int, patch, loads, sounds: ArchivePool,
                out: Path, before: dict[str, str]) -> dict | None:
    """Patch `index`'s `loads` as `{slot, picks}`, with `randomPlay` and
    `loads` kept for a patch that rolls one load a trigger (SND-15). None
    when the shooter hears none of them."""
    picks = []
    for load_index, load in enumerate(patch.samples):
        if not any(load is kept for kept in loads):
            continue
        pick = _edge_pick(load, out / f"{name}.r{index}.{load_index}.mp3",
                          sounds, before)
        if pick:
            picks.append({"load": load_index, **pick})
    if not picks:
        return None
    group = {"slot": index, "picks": picks}
    if patch.random_play:
        group["randomPlay"] = True
        group["loads"] = len(patch.samples)
    return group


def _write_mp3(data: bytes, target: Path, stale: bool) -> None:
    """`target` from `data`: made when missing, remade in place when `stale`.

    In place (the same inode) because `viewer/models` has hard-link mirrors
    that must see the new bytes too.
    """
    if target.exists() and not stale:
        return
    if not target.exists():
        transcode_to_mp3(data, target)
        return
    fresh = target.with_name(target.name + ".new.mp3")
    try:
        transcode_to_mp3(data, fresh)
        with open(target, "wb") as handle:
            handle.write(fresh.read_bytes())
    finally:
        fresh.unlink(missing_ok=True)


def _alternates(name: str, sample: SoundSample, patches, sounds: ArchivePool,
                out: Path, previous: dict | None) -> list[str | None] | None:
    """A `randomPlay` fire patch's picks, one mp3 per load, for the shooter.

    Every round rolls one load of such a patch (`rand() % loads`, silence
    included; ledger SND-15), so the shooter hears a different recording
    per shot: DC Final's CAR-15 has two, `Car15s_ST` and `Car15s_ST2`. The
    list is in load order; a load that is silence, or that is silent at the
    muzzle (a far layer), is `None`, because a roll that lands on it plays
    nothing where the shooter stands. The pick itself keeps `<Name>.mp3`;
    the other loads are `<Name>.<load>.mp3`. None when the patch is not one.
    """
    home = next((p for p in patches if any(s is sample for s in p.samples)), None)
    if home is None or not home.random_play:
        return None
    before = (previous or {}).get("randomPlay") or []
    picks: list[str | None] = []
    # One file per wav: a load that repeats the pick's wav (the landmine's two
    # `minedeploy`) is the pick's file.
    made = {sample.file.lower(): f"{name}.mp3"}
    for index, load in enumerate(home.samples):
        if load is sample or load.file.lower() in made:
            if muzzle_gain(load, at_time=None) > 0:
                picks.append(made[load.file.lower()] if load is not sample
                             else f"{name}.mp3")
            else:
                picks.append(None)
            continue
        if not _non_silence([load]) or muzzle_gain(load, at_time=None) <= 0:
            picks.append(None)
            continue
        resolved = resolve_sound(load.file, None, sounds, VEHICLE_RATES)
        if resolved is None:
            picks.append(None)
            continue
        target = out / f"{name}.{index}.mp3"
        # No wav name is kept per alternate; a list that moved is the sign.
        stale = index >= len(before) or before[index] != target.name
        _write_mp3(resolved[1], target, stale and target.exists())
        made[load.file.lower()] = target.name
        picks.append(target.name)
    # A pick every roll of which plays the same file needs no list.
    return picks if any(p != f"{name}.mp3" for p in picks) else None


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
    try:
        before = json.loads((args.out / "weapons.json").read_text())["weapons"]
    except (OSError, ValueError, KeyError):
        before = {}
    for name in names:
        try:
            entry, reason = extract_weapon_sound(
                name, library, objects, sounds, args.out, before.get(name))
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
