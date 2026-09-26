"""Measure a level's ambience against a rifle shot, before and after the
ambient-sound parity fix (features/ambient-sound-parity/README.md).

    python3 tests/ambient_level_measure.py [level] [mod]

Offline, no browser. Picks listener positions off the level's own heightmap
(ground + 1.7 m): the shoreline nearest the first control point, the land cell
closest to 50 m from any coastline, every control point, and the land cell
furthest from any coastline. At each it evaluates every looping emitter in the
level's shipped `scene.json` twice -- the old page law (`volume * near/far
ramp`, open polyline, no fall-off) and `viewer/area-sound.js` -- takes each
group's loudest emitter as the page does, and scales by the long-term RMS of
the decoded sample. The environment bed (`sounds.ambient`) is summed in, as is
every group incoherently. A K98 shot at 20 m is evaluated the way `WorldFire`
plays it (`ssc-curves` modulators at the shot's settled time, DirectSound
fall-off off the stereo layers, `WEAPON_HEADROOM`), scaled by the loudest 100 ms
of each layer.

Needs the installed game (heightmap), an extracted `viewer/maps` tree, node and
ffmpeg. Prints dBFS-style figures relative to a full-scale sine-free 1.0 RMS.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from extract_map import DEFAULT_GAME_DIR, load_level  # noqa: E402

VIEWER = ROOT / "viewer"
EYE = 1.7
SHOT_DISTANCE = 20.0
WEAPON = "K98"


def decode(path: Path) -> array:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "22050",
         "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return array("f", raw)


def rms(samples: array) -> float:
    return math.sqrt(sum(v * v for v in samples) / max(1, len(samples)))


def loudest_window(samples: array, rate: int = 22050, window: float = 0.1) -> float:
    n = max(1, int(rate * window))
    best = 0.0
    for start in range(0, max(1, len(samples) - n + 1), n // 4 or 1):
        best = max(best, rms(samples[start:start + n]))
    return best


def db(v: float) -> str:
    return "  -inf" if v <= 0 else f"{20 * math.log10(v):6.1f}"


def coast_distance(areas: list[dict], x: float, z: float) -> float:
    best = math.inf
    for area in areas:
        pts = area["points"]
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            ex, ez = b[0] - a[0], b[2] - a[2]
            l2 = ex * ex + ez * ez
            t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((x - a[0]) * ex + (z - a[2]) * ez) / l2))
            qx, qz = a[0] + ex * t, a[2] + ez * t
            best = min(best, math.hypot(x - qx, z - qz))
    return best


NODE = r"""
import fs from 'node:fs';
import { emitterAt, isBed, isAreaOutline } from './area-sound.js';
import { distanceRolloff, WEAPON_HEADROOM } from './engine-audio.js';
import { modulate } from './ssc-curves.js';
const { scene, positions, weapon, shot } = JSON.parse(fs.readFileSync(0, 'utf8'));

// The page's law before the fix, verbatim in effect: open polyline, 3D
// nearest point, volume * (1 inside near, linear to 0 at far), no fall-off,
// and every emitter looped.
function legacy(area, ear) {
  const pts = area.points;
  let best = Infinity;
  const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((p, i) => [pts[i], p]);
  for (const [a, b] of segs) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    let t = l2 > 0 ? ((ear.x - a[0]) * d[0] + (ear.y - a[1]) * d[1] + (ear.z - a[2]) * d[2]) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const q = [a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]];
    best = Math.min(best, Math.hypot(ear.x - q[0], ear.y - q[1], ear.z - q[2]));
  }
  const near = area.nearDistance || 40, far = area.farDistance || 80;
  const ramp = best <= near ? 1 : best >= far ? 0 : 1 - (best - near) / Math.max(far - near, 1e-3);
  return (area.volume ?? 0.6) * ramp;
}

const out = [];
for (const p of positions) {
  const ear = { x: p.x, y: p.y, z: p.z };
  const groups = {};
  for (const area of scene.sounds.areas || []) {
    const key = area.file.toLowerCase();
    groups[key] ??= { file: area.file, legacy: 0, now: 0, nowDistance: null };
    const g = groups[key];
    g.legacy = Math.max(g.legacy, legacy(area, ear));
    if (!isBed(area)) continue;
    const hit = emitterAt(area, ear);
    if (hit && hit.gain > g.now) { g.now = hit.gain; g.nowDistance = hit.distance; }
  }
  out.push({ name: p.name, groups: Object.values(groups) });
}

// One K98 round at `shot` metres, every layer at its settled gain.
const layers = weapon.layers.map(layer => {
  const volMods = (layer.modulators || []).filter(m => m.dest === 'volume')
    .map(m => ({ source: m.source, envelope: m.envelope, params: m.params }));
  const v = Math.min(1, Math.max(0, modulate(volMods, { distance: shot, time: 10, rpm: 0 }, layer.volume ?? 1)));
  const roll = layer.stereo ? 1 : distanceRolloff(shot, layer.minDistance);
  return { file: layer.file, gain: v * roll * WEAPON_HEADROOM };
});
process.stdout.write(JSON.stringify({ out, layers }));
"""


def main() -> int:
    level = sys.argv[1] if len(sys.argv) > 1 else "Wake"
    mod = sys.argv[2] if len(sys.argv) > 2 else "bf1942"
    level_dir = VIEWER / "maps" / (level.lower() if mod == "bf1942" else f"mods/{mod.lower()}/{level.lower()}")
    scene = json.loads((level_dir / "scene.json").read_text())
    _files, info, hm, _paths = load_level(DEFAULT_GAME_DIR, mod, level)
    water = scene.get("waterLevel") or (scene.get("water") or {}).get("level") or 0.0
    outlines = [a for a in scene["sounds"]["areas"] if len(a["points"]) > 2]

    def ground(x: float, gz: float) -> float:
        ix, iz = hm.world_to_index(x, -gz)
        return hm.height_at(ix, iz)

    # Land cells, every 4th heightmap sample, with their distance to the coast.
    land = []
    step = hm.spacing * 2
    for iz in range(0, hm.dim, 2):
        for ix in range(0, hm.dim, 2):
            h = hm.height_at(ix, iz)
            if h < water + 0.5:
                continue
            x, gz = ix * hm.spacing, -iz * hm.spacing
            land.append((x, gz, h, coast_distance(outlines, x, gz) if outlines else math.inf))
    cps = scene.get("controlPoints") or []
    positions = []
    if land and outlines:
        c0 = cps[0]["position"] if cps else [land[0][0], 0, land[0][1]]
        shore = min((c for c in land if c[3] <= 6.0),
                    key=lambda c: math.hypot(c[0] - c0[0], c[1] - c0[2]))
        positions.append(("shoreline", shore))
        inland = min(land, key=lambda c: abs(c[3] - 50.0))
        positions.append(("~50 m inland", inland))
    for cp in cps:
        x, _, gz = cp["position"]
        positions.append((cp["name"], (x, gz, ground(x, gz),
                                        coast_distance(outlines, x, gz) if outlines else math.inf)))
    if land:
        positions.append(("furthest from coast", max(land, key=lambda c: c[3])))

    payload = {
        "scene": scene,
        "positions": [{"name": n, "x": c[0], "y": c[2] + EYE, "z": c[1]} for n, c in positions],
        "weapon": json.loads((VIEWER / "models/sounds/weapons.json").read_text())["weapons"][WEAPON],
        "shot": SHOT_DISTANCE,
    }
    script = VIEWER / ".ambient_measure_tmp.mjs"
    script.write_text(NODE)
    try:
        proc = subprocess.run(["node", str(script)], input=json.dumps(payload),
                              capture_output=True, text=True, cwd=VIEWER)
    finally:
        script.unlink(missing_ok=True)
    if proc.returncode:
        print(proc.stderr, file=sys.stderr)
        return 1
    res = json.loads(proc.stdout)

    cache: dict[str, float] = {}

    def level_rms(rel: str) -> float:
        if rel not in cache:
            cache[rel] = rms(decode((level_dir / rel).resolve()))
        return cache[rel]

    amb = scene["sounds"].get("ambient")
    bed = (amb["volume"] * level_rms(amb["file"])) if amb else 0.0

    shot_sq = 0.0
    for layer in res["layers"]:
        if layer["gain"] <= 0:
            continue
        peak = loudest_window(decode(VIEWER / "models/sounds" / layer["file"]))
        shot_sq += (layer["gain"] * peak) ** 2
    shot = math.sqrt(shot_sq)

    print(f"{level} ({mod}): environment bed {db(bed)} dB RMS "
          f"({Path(amb['file']).name if amb else 'none'} x {amb['volume'] if amb else 0}); "
          f"{WEAPON} at {SHOT_DISTANCE:.0f} m, loudest 100 ms: {db(shot)} dB\n")
    print(f"{'position':24} {'coast':>6} | {'waves before':>12} {'waves after':>11} | "
          f"{'bus before':>10} {'bus after':>9} | {'shot-bus before':>15} {'after':>6}")
    waves_key = None
    for (name, cell), row in zip(positions, res["out"]):
        before_sq = bed ** 2
        after_sq = bed ** 2
        wb = wa = 0.0
        for g in row["groups"]:
            r = level_rms(g["file"])
            before_sq += (g["legacy"] * r) ** 2
            after_sq += (g["now"] * r) ** 2
            if "wave" in g["file"].lower() or "ocean" in g["file"].lower() or "river" in g["file"].lower() \
                    or "lake" in g["file"].lower():
                wb = max(wb, g["legacy"] * r)
                wa = max(wa, g["now"] * r)
        after = math.sqrt(after_sq)
        print(f"{name[:24]:24} {cell[3]:5.0f}m | {db(wb):>12} {db(wa):>11} | "
              f"{db(math.sqrt(before_sq)):>10} {db(after):>9} | "
              f"{20 * math.log10(shot / math.sqrt(before_sq)):+15.1f} {20 * math.log10(shot / after):+6.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
