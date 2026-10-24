#!/usr/bin/env python3
"""Pair the rounds a sidecar drew for another soldier with the rounds the
server fired (wire.md section 44, "The line a remote's round is drawn on").

    python3 lab/fire_line_check.py watch.ndjson server/replay_*.ndjson [more watch files]

`watch.ndjson` is a sidecar recording (or `sidecar/rebuild.mjs` output) whose
`k:"f"` rows for a soldier come from `ghost-writer.mjs` `_handFire`; the
server replay is the recorder's, whose `f` rows are each round's launch frame
(`fireBarrel`'s Mat4: the camera's position and its +Z). The two clocks are
aligned by the commonest gap between a soldier's rows in the two files, then
each drawn round is paired with the nearest server round of the same soldier
within 0.25 s. Printed per stance (the drawn soldier's lower-body state):
the angle between the two directions and its vertical part, in mrad, and
the distance between the two launch points and its vertical part, in metres.
"""
import json
import math
import sys
from collections import Counter, defaultdict


def rows(path):
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def unit(v):
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def stance_of(name):
    if not name:
        return 'stand'
    if any(k in name for k in ('Lie', 'Crawl')):
        return 'prone'
    if 'Crouch' in name:
        return 'crouch'
    return 'stand'


def load_watch(path):
    names, fires, lower = {}, [], defaultdict(list)
    for r in rows(path):
        k = r.get('k')
        if k == 'anim':
            for i, n, *_ in r['states']:
                names[i] = n
        elif k == 'st':
            for o in r['o']:
                lower[o[0]].append((r['t'], names.get(o[1], '')))
        elif k == 'f' and 'w' not in r and r.get('p') and r.get('d'):
            fires.append(r)
    return fires, lower


def stance_at(lower, nid, t):
    best = ''
    for tt, n in lower.get(nid, []):
        if tt > t:
            break
        best = n
    return stance_of(best)


def compare(watch_path, server_path, window=None):
    """The paired rounds, as dicts. `window` (t0, t1) keeps the drawn rounds
    of that span of the watch file only; `server_path` may be a list of rows."""
    fires, lower = load_watch(watch_path)
    if window:
        fires = [f for f in fires if window[0] <= f['t'] <= window[1]]
    src = server_path if isinstance(server_path, list) else rows(server_path)
    srv = [r for r in src if r.get('k') == 'f' and r.get('pid', -1) >= 0]
    by_id = defaultdict(list)
    for r in srv:
        by_id[r['id']].append(r)
    gaps = Counter()
    for f in fires:
        for s in by_id.get(f['id'], []):
            gaps[round(s['t'] - f['t'], 1)] += 1
    if not gaps:
        return []
    offset = gaps.most_common(1)[0][0]
    # refine: the median gap of the pairs near the mode
    near = sorted(s['t'] - f['t'] for f in fires for s in by_id.get(f['id'], [])
                  if abs(s['t'] - f['t'] - offset) < 0.3)
    offset = near[len(near) // 2]
    # A soldier whose drawn rounds are as many as the server's is paired in
    # order (a burst's rounds are 0.1 s apart, about the clocks' jitter);
    # otherwise each drawn round takes the nearest server round.
    drawn = defaultdict(list)
    for f in fires:
        drawn[f['id']].append(f)
    pairs = []
    for nid, fs in drawn.items():
        lo, hi = fs[0]['t'] + offset - 1, fs[-1]['t'] + offset + 1
        ss = [s for s in by_id.get(nid, []) if lo <= s['t'] <= hi]
        if len(fs) == len(ss):
            pairs += list(zip(fs, ss))
            continue
        for f in fs:
            cands = [s for s in ss if abs(s['t'] - f['t'] - offset) < 0.25]
            if cands:
                pairs.append((f, min(cands, key=lambda s: abs(s['t'] - f['t'] - offset))))
    out = []
    for f, s in pairs:
        a, b = unit(f['d']), unit(s['d'])
        ang = math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(a, b))))) * 1000
        vert = (math.asin(max(-1, min(1, a[1]))) - math.asin(max(-1, min(1, b[1])))) * 1000
        dp = [x - y for x, y in zip(f['p'], s['p'])]
        out.append({
            'stance': stance_at(lower, f['id'], f['t']), 'mrad': ang, 'vmrad': vert,
            'm': math.sqrt(sum(x * x for x in dp)), 'dy': dp[1], 'w': s.get('w', ''),
        })
    return out


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else float('nan')


def summary(pairs):
    lines = []
    for stance in ('stand', 'crouch', 'prone', 'all'):
        ps = [p for p in pairs if stance == 'all' or p['stance'] == stance]
        if not ps:
            continue
        lines.append(
            f"{stance:7s} n={len(ps):3d}  angle median {pct([p['mrad'] for p in ps], .5):6.2f} p90 {pct([p['mrad'] for p in ps], .9):6.2f} mrad"
            f"  vertical median {pct([p['vmrad'] for p in ps], .5):+6.2f} mrad"
            f"  point median {pct([p['m'] for p in ps], .5):5.3f} p90 {pct([p['m'] for p in ps], .9):5.3f} m"
            f"  dy median {pct([p['dy'] for p in ps], .5):+6.3f} m")
    return lines


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    server = argv[1]
    for watch in [argv[0], *argv[2:]]:
        print(f'== {watch}')
        for line in summary(compare(watch, server)):
            print(line)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
