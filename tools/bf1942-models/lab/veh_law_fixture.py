"""A `lab/veh_law_probe.mjs` run as the three vehicle-law fixtures.

    python3 lab/veh_law_fixture.py <probe.ndjson> <map> <Template> <stem> [--from PHASE] [--assets DIR]

writes `tests/fixtures/<stem>.ndjson.gz` (the plan's phase and word rows and
the hull's control states, each carried forward into the whole state at its
tick), `<stem>_terrain.json.gz` (the level's heightmap and material samples
round the run, with the material tables) and `<stem>_chassis.json.gz`
(`lab/veh_law_chassis.mjs`'s drive on the real level), the three files
`tests/vehicle_law_harness.mjs` replays. For an aircraft the states and the
`aircraftSpec` table go in one `<stem>.json.gz`, `tests/air_law_harness.mjs`'s
shape, beside the same terrain window.

A control state carries a field only when it changed (`ghost/pco.mjs`'s mask
bits, a Spring's or the Engine's own mask), and the client keeps what a state
leaves out, so each field is carried forward from the newest state that
had it, as `sidecar.mjs` `carryHullState` does for the page's ack rows.

`--from` names the first scored phase (default the plan's first, `idle`):
the probe's `orient` phase, which drives the hull round onto open ground,
is left out, and the fixture starts at the state of the tick before.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FIXTURES = ROOT / 'tests' / 'fixtures'


def r(v, n=7):
    return [round(x, n) for x in v] if v is not None else None


def whole_states(rows, template):
    """The hull's control states, every field carried forward."""
    cur = {}
    out = []
    for rec in rows:
        if rec.get('kind') != 'cs' or not rec.get('ok') or (rec.get('tmpl') or '').lower() != template.lower():
            continue
        for k, name in (('pos', 'pos'), ('rot', 'rot'), ('vecA', 'v'), ('vecB', 'w'), ('vecC', 'acc'),
                        ('vecD', 'racc'), ('vecE', 'fr'), ('vecF', 'rfr')):
            if rec.get(k) is not None:
                cur[name] = rec[k]
        if rec.get('flag') is not None:
            cur['sleep'] = bool(rec['flag'])
        springs = cur.setdefault('springs', [])
        engine = cur.setdefault('engine', {})
        bundles = cur.setdefault('bundles', [])
        si = bi = 0
        for ch in rec.get('children') or []:
            t = ch.get('t')
            if t == 'S':
                while len(springs) <= si:
                    springs.append({'rel': None, 'dprev': None})
                if ch.get('rel') is not None:
                    springs[si] = {'rel': r(ch['rel'], 4), 'dprev': r(ch['dprev'], 4)}
                si += 1
            elif t == 'E':
                for src, dst in (('gear', 'gear'), ('revs', 'revs'), ('load', 'a4'), ('roll', 'a10c'),
                                 ('yaw', 'a104'), ('steer', 'b0'), ('running', 'running')):
                    if ch.get(src) is not None:
                        engine[dst] = ch[src]
            elif t == 'R':
                while len(bundles) <= bi:
                    bundles.append(None)
                vals = ch.get('values')
                if vals is not None:
                    prev = bundles[bi] or [None] * 7
                    bundles[bi] = [v if v is not None else p for v, p in zip(vals, prev)]
                bi += 1
        need = ('pos', 'rot', 'v', 'w', 'acc', 'racc', 'fr', 'rfr', 'sleep')
        if not all(k in cur for k in need) or any(s['rel'] is None for s in springs) or 'revs' not in engine:
            continue
        out.append({'kind': 'cs', 'serial': rec['serial'], 'tick': rec.get('tick'),
                    'pos': r(cur['pos']), 'rot': r(cur['rot'], 9), 'v': r(cur['v'], 4), 'w': r(cur['w'], 4),
                    'acc': r(cur['acc'], 4), 'racc': r(cur['racc'], 4), 'fr': r(cur['fr'], 4),
                    'rfr': r(cur['rfr'], 4), 'sleep': cur['sleep'],
                    'springs': [dict(s) for s in springs], 'engine': dict(engine),
                    'bundles': [list(b) if b else None for b in bundles]})
    return out


def png_rgb(path):
    from PIL import Image
    im = Image.open(path).convert('RGB')
    return im.size[0], im.tobytes()


def terrain_window(map_dir, scene, xs, zs, pad=40.0):
    hm = scene['heightmap']
    dim, spacing = hm['dim'], hm['spacing']
    w, heights = png_rgb(map_dir / hm['image'])
    mw, mats = png_rgb(map_dir / scene['terrain']['materials']['image'])
    assert w == dim and mw == dim
    i0 = max(0, int(math.floor((min(xs) - pad) / spacing)))
    j0 = max(0, int(math.floor((min(zs) - pad) / spacing)))
    i1 = min(dim, int(math.ceil((max(xs) + pad) / spacing)) + 2)
    j1 = min(dim, int(math.ceil((max(zs) + pad) / spacing)) + 2)
    n = max(i1 - i0, j1 - j0)
    n = min(n, dim - max(i0, j0))
    hs, ms = [], []
    for j in range(j0, j0 + n):
        for i in range(i0, i0 + n):
            at = (j * dim + i) * 3
            hs.append((heights[at] << 8) | heights[at + 1])
            ms.append(mats[at])
    return {'dim': dim, 'spacing': spacing, 'yScale': hm['heightUnits'] / 256.0, 'i0': i0, 'j0': j0, 'n': n,
            'heights': hs, 'materials': ms}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('log')
    ap.add_argument('map')
    ap.add_argument('template')
    ap.add_argument('stem')
    ap.add_argument('--from', dest='first', default='idle')
    ap.add_argument('--assets', default=str(ROOT / 'viewer'))
    ap.add_argument('--mod', default=None)
    ap.add_argument('--run', default='flight', help="an aircraft fixture's run name")
    a = ap.parse_args()
    rows = [json.loads(line) for line in open(a.log) if line.strip()]
    phases = [x for x in rows if x['kind'] == 'phase']
    first = next(p['phase'] for p in phases if p['name'] == a.first)
    words = [x for x in rows if x['kind'] == 'word' and x['phase'] >= first]
    w0 = words[0]['serial']
    states = [s for s in whole_states(rows, a.template) if s['serial'] >= w0 - 1]
    out_rows = [{'kind': 'phase', 'phase': p['phase'], 'name': p['name'], 'ticks': p['ticks'], 'st': p['st']}
                for p in phases if p['phase'] >= first]
    out_rows += [{'kind': 'word', 'serial': w['serial'], 'phase': w['phase'], 'st': w['st']} for w in words]
    out_rows += states
    assets = Path(a.assets)
    map_dir = assets / 'maps' / ('mods/' + a.mod if a.mod else '') / a.map
    scene = json.load(open(map_dir / 'scene.json'))
    t = terrain_window(map_dir, scene, [s['pos'][0] for s in states], [s['pos'][2] for s in states])
    tree = assets / 'maps' / ('mods/' + a.mod if a.mod else '')
    # A mod tree keeps its tables under `_shared/` (`viewer/maps/mods/<mod>/_shared/damage.json`).
    damage = tree / 'damage.json' if (tree / 'damage.json').exists() else tree / '_shared' / 'damage.json'
    tables = json.load(open(damage))['materials']
    used = sorted(set(t['materials']) | {0})
    t['level'] = a.map
    t['source'] = (f'{a.map} terrain/heightmap.png (u16, Heightmap.raw) and terrain/materials.png, '
                   'a window of samples round the lab run')
    t['materialFriction'] = {str(k): tables[str(k)]['friction'] for k in used if str(k) in tables}
    t['materialResistance'] = {str(k): tables[str(k)]['resistance'] for k in used if str(k) in tables}
    with gzip.open(FIXTURES / f'{a.stem}_terrain.json.gz', 'wt') as f:
        json.dump(t, f, separators=(',', ':'))

    cmd = ['node', str(HERE / 'veh_law_chassis.mjs'), str(assets), a.map, a.template] + ([a.mod] if a.mod else [])
    chassis = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1]
    FIXTURES.mkdir(exist_ok=True)
    doc = json.loads(chassis)
    if doc['cls'] == 'Aircraft':
        # `tests/air_law_harness.mjs`'s one file: the airframe's table and the run.
        with gzip.open(FIXTURES / f'{a.stem}.json.gz', 'wt') as f:
            json.dump({'template': a.template, 'level': a.map, 'spec': doc['spec'],
                       'runs': [{'name': a.run, 'rows': out_rows}]}, f, separators=(',', ':'))
    else:
        with gzip.open(FIXTURES / f'{a.stem}.ndjson.gz', 'wt') as f:
            for x in out_rows:
                f.write(json.dumps(x, separators=(',', ':')) + '\n')
        with gzip.open(FIXTURES / f'{a.stem}_chassis.json.gz', 'wt') as f:
            f.write(chassis)
    print(json.dumps({'states': len(states), 'words': len(words), 'first': w0,
                      'terrain': [t['i0'], t['j0'], t['n']], 'chassis': doc['cls']}))


if __name__ == '__main__':
    sys.exit(main())
