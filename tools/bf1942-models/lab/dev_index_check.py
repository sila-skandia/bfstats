#!/usr/bin/env python3
"""Fit each of a human's rounds to the deviation draw it took (ledger DEV-9, DEV-14).

Reads `lab/dev_index_probe.mjs`'s log (every word the sender put on the
wire, with its serial) and the server recorder's file from the same run
(each round's launch frame `f`, its flight `pn`/`pj`). Per round:

  * the launch velocity, fitted to the first samples of its flight (gravity
    on the vertical);
  * its offset from the launch frame's +Z (`f`'s `d`) on the frame's right
    and up rows, in hundredths of a radian: DEV-9's `u x total`;
  * the table indices k whose point `(u_up, u_right)` that offset fits, with
    the total a free scale.

Then the rounds are taken in order against the probe's fire words (each tap
is one word with the fire bit) and the offset `k - serial` and
`k - words released` is fitted jointly over every tap: the one law that puts
every round on its point.

    python3 lab/dev_index_check.py probe.ndjson replay_<unix>.ndjson [--pid 0]

`--page page.json` reads `lab/dev_index_page_probe.cjs`'s file instead of a
node probe's: the input index the page drew each of its own rounds at
(input-index.js) against the server's `gi` for the same round, in order.
"""
import argparse
import json
import math
import sys

FIRE = 1


def _seeds():
    x, out = 1, []
    for _ in range(1024):
        x = (x * 214013 + 2531011) & 0xFFFFFFFF
        out.append((x >> 16) & 0x7FFF)
    return out + [0]


SEEDS = _seeds()
M = 0xFFFFFFFF


def _s32(x):
    x &= M
    return x - (1 << 32) if x & 0x80000000 else x


def _schrage(y, a):
    lo = ((y & 0xFFFF) * a) & M
    hi = ((_s32(lo) >> 16) + (_s32(y) >> 16) * a) & M
    x = ((_s32(hi) >> 15) + (lo & 0xFFFF) + ((hi & 0x7FFF) << 16)) & M
    z = (x - 0x7FFFFFFF) & M
    return x if _s32(z) < 0 else z


def _draw(k):
    r = _schrage(_schrage((SEEDS[k] + k) & M, 0x5E30), 0x661F)
    return (((_s32(r) >> 7) | 1) + 1) * 5.9604645e-08 * 2.0 - 1.0


def deviation_point(k):
    """`[u_up, u_right]` at table index k: bot-deviation.js `deviationPoint`."""
    k &= 0x3FF
    k2 = k + 0x200 if k + 0x200 <= 0x400 else k - 0x200
    return _draw(k), _draw(k2)


TABLE = [deviation_point(k) for k in range(1024)]


def norm(v):
    n = math.sqrt(sum(c * c for c in v))
    return [c / n for c in v]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def polyfit(ts, ys, deg):
    """Least squares of ys on 1, t, .. t^deg (normal equations, small n)."""
    n = deg + 1
    a = [[sum(t ** (i + j) for t in ts) for j in range(n)] for i in range(n)]
    b = [sum(y * t ** i for t, y in zip(ts, ys)) for i in range(n)]
    for i in range(n):
        p = max(range(i, n), key=lambda r: abs(a[r][i]))
        a[i], a[p], b[i], b[p] = a[p], a[i], b[p], b[i]
        for r in range(n):
            if r != i:
                f = a[r][i] / a[i][i]
                a[r] = [x - f * y for x, y in zip(a[r], a[i])]
                b[r] -= f * b[i]
    return [b[i] / a[i][i] for i in range(n)]


def load(path):
    with open(path) as fh:
        return [json.loads(line) for line in fh if line.strip()]


def rounds_of(rows, pid, samples=6):
    """Each of `pid`'s rounds: its time, launch frame and fitted launch velocity.

    A flight is a run of one key's `pj` samples; a pooled key flies again
    later, so a gap of more than a tick and a half or a `pd` ends one (a
    reused key's new flight does not always get its own `pn`)."""
    flights = []
    live = {}
    for r in rows:
        if r.get('k') == 'pj':
            for key, x, y, z in r['o']:
                cur = live.get(key)
                if cur is None or r['t'] - cur[-1][0] > 0.05:
                    cur = []
                    live[key] = cur
                    flights.append(cur)
                cur.append((r['t'], [x, y, z]))
        elif r.get('k') == 'pd':
            for key in r['o']:
                live.pop(key, None)
    out = []
    used = set()
    for r in rows:
        if r.get('k') != 'f' or r.get('pid') != pid or r.get('fake'):
            continue
        cands = [(abs(f[0][0] - r['t']), i) for i, f in enumerate(flights)
                 if i not in used and abs(f[0][0] - r['t']) < 0.02]
        if not cands:
            continue
        i = min(cands)[1]
        used.add(i)
        track = flights[i][:samples]
        if len(track) < 4:
            continue
        # The samples are a tick apart; their `t` is a wall clock whose
        # ticks are not evenly spaced, which bends the vertical's fit.
        ts = [j / 30 for j in range(len(track))]
        v = []
        for ax in range(3):
            c = polyfit(ts, [s[1][ax] for s in track], 2 if ax == 1 else 1)
            v.append(c[1])
        out.append({'t': r['t'], 'd': r['d'], 'ra': r.get('ra'), 'rb': r.get('rb'),
                    'gi': r.get('gi'), 'v': v, 'w': r['w']})
    return out


def offsets(rnd, flip=False):
    """DEV-9's `u x total` on the frame's (up, right) rows, hundredths of a rad."""
    d = norm(rnd['d'])
    if rnd.get('ra') and rnd.get('rb'):
        # The launch matrix's own rows 0 (right) and 1 (up).
        right, up = norm(rnd['ra']), norm(rnd['rb'])
    else:
        # A soldier's camera does not roll: right is level, up = d x right.
        right = norm(cross([0.0, 1.0, 0.0], d))
        up = cross(d, right)
    if flip:
        right = [-c for c in right]
    v = rnd['v']
    f = dot(v, d)
    return 100 * dot(v, up) / f, 100 * dot(v, right) / f


def fit_k(off, k):
    """Residual (hundredths) of an offset against index k's point, the total free."""
    uu, ur = TABLE[k & 0x3FF]
    den = uu * uu + ur * ur
    tot = max(0.0, (off[0] * uu + off[1] * ur) / den)
    return math.hypot(off[0] - tot * uu, off[1] - tot * ur), tot


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('probe')
    ap.add_argument('server')
    ap.add_argument('--pid', type=int, default=0)
    ap.add_argument('--flip', action='store_true', help='the right row the other way')
    ap.add_argument('--barrel', type=int, default=-1, help="Fire's barrel: -1 for a gun with no addFireArmsPosition")
    ap.add_argument('--page', action='store_true', help='the probe file is dev_index_page_probe.cjs output')
    a = ap.parse_args(argv)

    if a.page:
        return page_main(a)
    probe = load(a.probe)
    rnds = rounds_of(load(a.server), a.pid)
    sent = [r for r in probe if r['kind'] == 'sent']
    count = {}
    for i, w in enumerate(sent):
        count[w['serial']] = i + 1          # words released up to and including this one
    fires = [w for w in sent if w['b'] & FIRE]
    # A tap is one fire word between words without it.
    taps = [w for i, w in enumerate(sent) if w['b'] & FIRE
            and not (i > 0 and sent[i - 1]['b'] & FIRE) and not (i + 1 < len(sent) and sent[i + 1]['b'] & FIRE)]
    print(f'{len(rnds)} rounds of pid {a.pid}; {len(sent)} words released, {len(fires)} with fire, {len(taps)} taps')
    offs = [offsets(r, a.flip) for r in rnds]

    # Each round alone: its best indices.
    best = []
    for i, (r, o) in enumerate(zip(rnds, offs)):
        fits = sorted((fit_k(o, k)[0], k) for k in range(1024))
        best.append(fits)
    # Jointly: the tap rounds in order against the taps' serials and counts.
    n = min(len(taps), len(rnds))
    tap_rounds = list(range(n))
    for label, key in (('serial', lambda w: w['serial']), ('words released', lambda w: count[w['serial']])):
        scores = []
        for c in range(1024):
            tot = sum(fit_k(offs[i], key(taps[i]) + a.barrel + c)[0] ** 2 for i in tap_rounds)
            scores.append((tot, c))
        scores.sort()
        (s0, c0), (s1, c1) = scores[0], scores[1]
        print(f'k = {label} {a.barrel:+d} + c over {n} taps: best c = {c0} '
              f'(rms {math.sqrt(s0 / n):.4f}), next c = {c1} (rms {math.sqrt(s1 / n):.4f})')
    # The server's own index at each round (`gi`, Game+0x68 read at
    # fireBarrel's entry by a recorder built with it), against the draw the
    # round took and the fire word that sent it.
    print()
    print(' # t         gi  fire word: serial  released   k=gi%+d  resid  total   best k (resid)' % a.barrel)
    held = {w['serial']: w for w in fires}
    for i, (r, o) in enumerate(zip(rnds, offs)):
        gi = r.get('gi')
        best3 = ', '.join(f'{k} ({e:.4f})' for e, k in best[i][:3])
        if gi is None:
            print(f'{i:2d} {r["t"]:8.3f}  (no gi)  {best3}')
            continue
        k = (gi + a.barrel) & 0x3FF
        res, tot = fit_k(o, k)
        w = held.get(gi)
        word = f'{w["serial"]:6d} {count[w["serial"]]:9d}' if w else f'{"-":>6s} {"-":>9s}'
        print(f'{i:2d} {r["t"]:8.3f} {gi:6d}  {word}      {k:5d}  {res:.4f} {tot:.4f}   {best3}')
    gis = [r for r in rnds if r.get('gi') is not None]
    if gis:
        on = sum(1 for r, o in zip(rnds, offs) if r.get('gi') is not None
                 and best[rnds.index(r)][0][1] == ((r['gi'] + a.barrel) & 0x3FF))
        fired = sum(1 for r in gis if r['gi'] in held)
        print(f'\n{on} of {len(gis)} rounds take their best draw at gi {a.barrel:+d}; '
              f'{fired} of {len(gis)} have gi equal to a fire word\'s serial')
    return 0


def page_main(a):
    """The page's draws against the server's: one row a round, in order."""
    with open(a.probe) as fh:
        page = json.load(fh)
    rows = [r for r in load(a.server) if r.get('k') == 'f' and not r.get('fake') and r.get('gi') is not None]
    pids = sorted({r['pid'] for r in rows})
    if len(pids) > 1:
        rows = [r for r in rows if r['pid'] == a.pid]
    draws = page.get('draws', [])
    acks = [x for x in page.get('acks', []) if x.get('ai') is not None]
    print(f'{len(rows)} server rounds (pids {pids}), {len(draws)} page draws, '
          f'{len(acks)} acks with ai ({sum(1 for x in acks if x["ai"] == x["serial"])} equal to the serial)')
    # Each page draw against the server round nearest its index (the page
    # keeps its newest 64; the recorder writes behind, so read it after the
    # file has caught up).
    gis = [r['gi'] for r in rows]
    n = len(draws)
    same = 0
    print(' #  page tick   page index   server gi   d')
    for i, d in enumerate(draws):
        g = min(gis, key=lambda x: abs(x - d['index'])) if gis else None
        same += g == d['index']
        print(f'{i:2d}  {d["tick"]:9d}  {d["index"]:11d}  {g if g is not None else "-":>10}  '
              f'{(d["index"] - g) if g is not None else 0:+d}')
    print(f'\n{same} of {n} page rounds drew at the server\'s own index')
    return 0 if same == n else 1


if __name__ == '__main__':
    sys.exit(main())
