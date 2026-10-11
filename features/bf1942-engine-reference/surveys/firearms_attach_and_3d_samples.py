"""Census what decides where a gun's voice is heard from, across the installed mods.

Run from the repository root. Backs ledger rows SND-7 (which templates carry
`ObjectTemplate.setAttachToListener 1`) and SND-30 (a `.ssc` layer that says
`stereo` plays on a 2D DirectSound voice, every other layer on a mono 3D one):

  - per mod, the templates that carry `setAttachToListener 1`, by class, and
    every FireArms among them by name;
  - per mod, the `.ssc` loads by the voice the engine gives them (2D for a
    `stereo` layer, 3D otherwise) against the channel count of the wav they
    name: a two-channel file on a 3D voice, and a one-channel file on a 2D one.

Templates are read line by line: the class is the last `ObjectTemplate.create`
before the flag. Scripts are counted as written (`#templateLevel` tiers and
`beginSkip` regions are not resolved). A wav is found by its file name in the
mod's own archives, then vanilla's; the 44 kHz copy wins.

Result 2026-10-11 (this PC's installs, 15 mods). Counts are lines in the
files, and a level archive that repeats an object's `.con` repeats its lines.

FireArms carrying the flag: none in vanilla, XPack1, XPack2, Forgotten Hope,
FHSW, FHSWEurope, DesertCombat, DC_Final, Pirates or Interstate. The mods
that do flag guns flag aircraft and helicopter guns: EoD 41, bg42 188,
bf1918 5 (four aircraft guns and `german75cannon`), FinnWars 3
(`IlyushinGuns`, `StukaGuns`, `Yak9BombDummy`), GCMOD 1 (`ILC_Turret_Lasers`).
No mod flags a tank's machine gun. Forgotten Hope's 730 flagged lines are 188
Engine, 478 RotationalBundle, 38 Bundle, 23 PlayerControlObject and 3
SimpleObject, so its tank guns are placed voices like vanilla's.

A 3D voice is a mono buffer, and the data agrees with the `stereo` word
picking the other kind: of the 3D loads whose wav was found, a two-channel
file is 1 of 4,959 in vanilla, 0 of 712 in XPack1, 5 of 1,857 in XPack2 and
62 of 18,365 in FH (0.3%); the worst is Interstate, 100 of 2,847. What the
engine feeds a mono voice from a two-channel file was not read. A 2D layer
names a one-channel file about as often as a two-channel one (vanilla 63 and
164), which the pool's mono 2D voices are for.
"""
import re
import struct
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, 'tools/bf1942-models')  # relative to the repo root
from bf42.rfa import RfaArchive  # noqa: E402

GAME = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
CREATE = re.compile(r"^\s*ObjectTemplate\.create\s+(\S+)\s+(\S+)", re.I)
ATTACH = re.compile(r"^\s*ObjectTemplate\.setAttachToListener\s+1\b", re.I)
LOAD = re.compile(r"^\s*load\s+(\S+)", re.I)
STEREO = re.compile(r"^\s*stereo\b", re.I)


def wav_channels(blob):
    """Channel count out of a RIFF/WAVE header, or None."""
    if blob[:4] != b"RIFF" or blob[8:12] != b"WAVE":
        return None
    at = 12
    while at + 8 <= len(blob):
        tag, size = blob[at:at + 4], struct.unpack_from("<I", blob, at + 4)[0]
        if tag == b"fmt ":
            return struct.unpack_from("<H", blob, at + 10)[0]
        at += 8 + size + (size & 1)
    return None


def archives(mod):
    out = []
    for rfa in sorted(mod.rglob("*.rfa")):
        try:
            out.append(RfaArchive(rfa))
        except Exception:
            continue
    return out


def wav_index(opened):
    """file name (lower) -> (archive, entry), the 44 kHz copy preferred."""
    index = {}
    for archive in opened:
        for name in archive.entries:
            low = name.lower().replace("\\", "/")
            if not low.endswith(".wav"):
                continue
            base = low.rsplit("/", 1)[-1]
            if base not in index or "44khz" in low:
                index[base] = (archive, name)
    return index


mods = sorted(p for p in (GAME / "Mods").iterdir() if p.is_dir())
vanilla = next((m for m in mods if m.name.lower() == "bf1942"), None)
vanilla_wavs = wav_index(archives(vanilla)) if vanilla else {}

print("templates carrying setAttachToListener 1, by class")
samples = {}
for mod in mods:
    opened = archives(mod)
    if not opened:
        continue
    flagged = Counter()
    guns = []
    voices = Counter()           # (voice, channels) -> loads
    wavs = wav_index(opened) if mod != vanilla else vanilla_wavs
    channels = {}
    for archive in opened:
        for name in list(archive.entries):
            low = name.lower()
            if low.endswith(".con"):
                try:
                    text = archive.read(name).decode("latin-1", "replace")
                except Exception:
                    continue
                if "attachtolistener" not in text.lower():
                    continue
                kind = template = None
                for line in text.splitlines():
                    c = CREATE.match(line)
                    if c:
                        kind, template = c.group(1), c.group(2)
                    elif ATTACH.match(line) and kind:
                        flagged[kind.lower()] += 1
                        if kind.lower() == "firearms":
                            guns.append(template)
            elif low.endswith(".ssc"):
                try:
                    text = archive.read(name).decode("latin-1", "replace")
                except Exception:
                    continue
                loads = []           # [wav name, says stereo]
                for line in text.splitlines():
                    m = LOAD.match(line)
                    if m:
                        loads.append([m.group(1).replace("\\", "/").rsplit("/", 1)[-1].lower(), False])
                    elif STEREO.match(line) and loads:
                        loads[-1][1] = True
                for base, stereo in loads:
                    if base == "silence.wav":
                        continue
                    if base not in channels:
                        found = wavs.get(base) or vanilla_wavs.get(base)
                        try:
                            channels[base] = wav_channels(found[0].read(found[1])[:4096]) if found else None
                        except Exception:
                            channels[base] = None
                    voices[("2D" if stereo else "3D", channels[base])] += 1
    samples[mod.name] = voices
    print(f"  {mod.name:14}", dict(sorted(flagged.items())) or "none",
          ("| FireArms: " + ", ".join(sorted(set(guns)))) if guns else "| FireArms: none")

print()
print("`.ssc` loads by voice kind and the wav's channels (None: wav not found)")
print(f"  {'mod':14}{'3D mono':>9}{'3D stereo':>11}{'3D ?':>7}{'2D mono':>9}{'2D stereo':>11}{'2D ?':>7}")
for mod, voices in samples.items():
    if not voices:
        continue
    print(f"  {mod:14}{voices[('3D', 1)]:9}{voices[('3D', 2)]:11}{voices[('3D', None)]:7}"
          f"{voices[('2D', 1)]:9}{voices[('2D', 2)]:11}{voices[('2D', None)]:7}")
