"""`lab/prone_slope_probe.mjs` runs as the prone-slope fixtures.

    python3 lab/prone_slope_fixture.py <stem> <probe.ndjson> [<probe.ndjson> ...] [--map wake]

Each spot of each run (its phases from `<spot>: settle`, standing still on
the face, to `<spot>: stand`)
becomes one segment, its rows tagged `run: <spot>`: the phase and word rows
(a word keeps its `press`) and the soldier's control states with every field
carried forward from the newest state that had it. Written to
`tests/fixtures/<stem>.ndjson.gz`, with `<stem>_terrain.json.gz` the level's
heightmap and material window round every segment, as
`lab/veh_law_fixture.py` cuts it.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from veh_law_fixture import FIXTURES, ROOT, terrain_window  # noqa: E402


def segments(rows):
    phases = [r for r in rows if r['kind'] == 'phase']
    spots = []
    for p in phases:
        name = p.get('name') or ''
        if name.endswith(os.environ.get('PRONE_FIRST', ': settle')):
            spots.append([name.split(':')[0], p['phase'], None])
        if name.endswith(': stand') and spots:
            spots[-1][2] = p['phase']
    for spot, a, b in spots:
        if b is None:
            continue
        words = [r for r in rows if r['kind'] == 'word' and a <= r['phase'] <= b]
        if not words:
            continue
        lo, hi = words[0]['serial'], words[-1]['serial']
        cur, states = {}, []
        for r in rows:
            if r['kind'] != 'cs' or r.get('cls') != 'BFSoldierNetworkable' or r.get('serial') is None:
                continue
            for k in ('pos', 'rot', 'vel', 'lower'):
                if r.get(k) is not None:
                    cur[k] = r[k]
            if lo - 1 <= r['serial'] <= hi and all(k in cur for k in ('pos', 'rot', 'vel')):
                states.append({'kind': 'cs', 'cls': 'BFSoldierNetworkable', 'serial': r['serial'], 'tick': r.get('tick'),
                               **{k: cur[k] for k in ('pos', 'rot', 'vel', 'lower') if k in cur}})
        out = [{'kind': 'phase', 'run': spot, 'phase': p['phase'], 'name': p.get('name')}
               for p in phases if a <= p['phase'] <= b]
        out += [{'kind': 'word', 'run': spot, 'serial': w['serial'], 'phase': w['phase'], 'st': w['st'],
                 **({'press': w['press']} if w.get('press') else {})} for w in words]
        out += [{**s, 'run': spot} for s in states]
        yield spot, out, states


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('stem')
    ap.add_argument('logs', nargs='+')
    ap.add_argument('--map', default='wake')
    ap.add_argument('--assets', default=str(ROOT / 'viewer'))
    a = ap.parse_args()
    all_rows, xs, zs, seen = [], [], [], []
    for path in a.logs:
        rows = [json.loads(line) for line in open(path) if line.strip()]
        for spot, out, states in segments(rows):
            if spot in seen:
                continue
            seen.append(spot)
            all_rows += out
            xs += [s['pos'][0] for s in states]
            zs += [s['pos'][2] for s in states]
    map_dir = Path(a.assets) / 'maps' / a.map
    scene = json.load(open(map_dir / 'scene.json'))
    t = terrain_window(map_dir, scene, xs, zs, pad=12.0)
    tables = json.load(open(Path(a.assets) / 'maps' / 'damage.json'))['materials']
    used = sorted(set(t['materials']) | {0})
    t['level'] = a.map
    t['source'] = (f'{a.map} terrain/heightmap.png (u16, Heightmap.raw) and terrain/materials.png, '
                   'a window of samples round the lab runs')
    t['materialFriction'] = {str(k): tables[str(k)]['friction'] for k in used if str(k) in tables}
    t['materialResistance'] = {str(k): tables[str(k)]['resistance'] for k in used if str(k) in tables}
    with gzip.open(FIXTURES / f'{a.stem}_terrain.json.gz', 'wt') as f:
        json.dump(t, f, separators=(',', ':'))
    with gzip.open(FIXTURES / f'{a.stem}.ndjson.gz', 'wt') as f:
        for x in all_rows:
            f.write(json.dumps(x, separators=(',', ':')) + '\n')
    print(json.dumps({'spots': seen, 'rows': len(all_rows), 'terrain': [t['i0'], t['j0'], t['n']]}))


if __name__ == '__main__':
    sys.exit(main())
