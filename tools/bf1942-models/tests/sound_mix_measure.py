"""Measure the player's own rifle against a level's wind bed, under the page's
old mix and under the engine's law (ledger SND-11, SND-27, SND-28;
features/sound-mix-parity/README.md).

    python3 tests/sound_mix_measure.py [level] [mod] [weapon]
    python3 tests/sound_mix_measure.py road_to_ramelle fh K98
    python3 tests/sound_mix_measure.py bocage

Offline, no browser. Reads the level's shipped `scene.json` and the tree's
`weapons.json`, decodes the bed and the weapon's first-person report with
ffmpeg, and prints what reaches the page's limiter and what leaves it:

  old   bed = script volume x master (no clamp), report = min(volume, 1) x 0.75 x master
  law   bed = clamp01(script volume) x master,   report = clamp01(volume) x master

The limiter is the page's own (`page-audio.js` `ensureListener`: threshold
-1 dB, ratio 20, knee 0), applied here as its static curve to the sustained
level, which is the bed's: whatever it takes off the bed it takes off the shot.
`BF_VIEWER_ROOT` names another checkout's `viewer/` when this one has no bakes.
Levels are dB re a full-scale 1.0; the bed is its long-term RMS, the report its
loudest 100 ms.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# A worktree has no baked trees of its own: point this at a checkout that does.
VIEWER = Path(os.environ.get("BF_VIEWER_ROOT") or ROOT / "viewer")
MASTER = 0.7            # map.html's slider default
OLD_WEAPON_HEADROOM = 0.75
LIMIT_THRESHOLD_DB = -1.0
LIMIT_RATIO = 20.0


def decode(path: Path) -> array:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "22050",
         "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return array("f", raw)


def rms(samples) -> float:
    return math.sqrt(sum(v * v for v in samples) / max(1, len(samples)))


def loudest_window(samples: array, rate: int = 22050, window: float = 0.1) -> float:
    n = max(1, int(rate * window))
    best = 0.0
    for start in range(0, max(1, len(samples) - n + 1), n // 4 or 1):
        best = max(best, rms(samples[start:start + n]))
    return best


def db(v: float) -> float:
    return 20 * math.log10(v) if v > 0 else float("-inf")


def limiter_reduction_db(level_db: float) -> float:
    """What the page's limiter takes off a sustained level, in dB (<= 0)."""
    if level_db <= LIMIT_THRESHOLD_DB:
        return 0.0
    out = LIMIT_THRESHOLD_DB + (level_db - LIMIT_THRESHOLD_DB) / LIMIT_RATIO
    return out - level_db


def clamp01(v: float) -> float:
    return min(1.0, max(0.0, v))


def measure(level: str, mod: str | None, weapon: str) -> dict:
    maps = VIEWER / "maps" / ("mods/" + mod if mod else "")
    models = VIEWER / "models" / ("mods/" + mod if mod else "")
    scene = json.loads((maps / level / "scene.json").read_text())
    bed = (scene.get("sounds") or {}).get("ambient")
    if not bed:
        raise SystemExit(f"{level}: no sounds.ambient")
    manifest_path = models / "sounds" / "weapons.json"
    if not manifest_path.exists():
        manifest_path = VIEWER / "models" / "sounds" / "weapons.json"
    weapons = json.loads(manifest_path.read_text())["weapons"]
    spec = next(v for k, v in weapons.items() if k.lower() == weapon.lower())
    bed_rms = rms(decode((maps / level / bed["file"]).resolve()))
    shot = loudest_window(decode(manifest_path.parent / spec["file"]))
    script = float(bed.get("volume", 1.0))
    rows = {}
    for name, bed_gain, shot_gain in (
            ("old", script * MASTER,
             min(spec.get("volume", 1.0), 1.0) * OLD_WEAPON_HEADROOM * MASTER),
            ("law", clamp01(script) * MASTER,
             clamp01(spec.get("volume", 1.0)) * MASTER)):
        bed_in = db(bed_rms * bed_gain)
        cut = limiter_reduction_db(bed_in)
        rows[name] = {
            "bedGain": bed_gain, "shotGain": shot_gain,
            "bedIn": bed_in, "limiter": cut,
            "bedOut": bed_in + cut, "shotOut": db(shot * shot_gain) + cut,
        }
        rows[name]["shotOverBed"] = rows[name]["shotOut"] - rows[name]["bedOut"]
    return {"level": level, "mod": mod, "weapon": weapon, "scriptVolume": script,
            "bedFile": bed["file"], "bedRms": db(bed_rms), "shotPeak100ms": db(shot),
            "rows": rows}


def main() -> int:
    level = sys.argv[1] if len(sys.argv) > 1 else "bocage"
    mod = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] not in ("", "bf1942") else None
    weapon = sys.argv[3] if len(sys.argv) > 3 else "K98"
    m = measure(level, mod, weapon)
    print(f"{level} ({mod or 'bf1942'}), {weapon}: bed {Path(m['bedFile']).name} "
          f"script volume {m['scriptVolume']:g}, sample RMS {m['bedRms']:.1f} dB; "
          f"report loudest 100 ms {m['shotPeak100ms']:.1f} dB; master {MASTER}")
    print(f"{'':5}{'bed gain':>9}{'shot gain':>10}{'bed in':>8}{'limiter':>9}"
          f"{'bed out':>9}{'shot out':>10}{'shot-bed':>10}")
    for name, r in m["rows"].items():
        print(f"{name:5}{r['bedGain']:9.3f}{r['shotGain']:10.3f}{r['bedIn']:8.1f}"
              f"{r['limiter']:9.1f}{r['bedOut']:9.1f}{r['shotOut']:10.1f}"
              f"{r['shotOverBed']:10.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
