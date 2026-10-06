#!/usr/bin/env python3
"""Install a scratch model extraction into a live tree, in place.

Writes every existing file through its own inode (cp semantics, O_TRUNC), so
hard-link mirrors see the new content; merges models.json row by row keeping
the live `thumb` keys; leaves live-only rows and files alone."""
import json, shutil, sys
from pathlib import Path
live = Path(sys.argv[1]); scratches = [Path(p) for p in sys.argv[2:]]
rows = {r['name']: r for r in json.loads((live / 'models.json').read_text())}
order = list(rows)
copied = new = 0
for s in scratches:
    for f in s.iterdir():
        if f.is_file() and (f.suffix == '.glb' or f.name.endswith('.report.json')):
            dst = live / f.name
            if dst.exists():
                with open(f, 'rb') as a, open(dst, 'r+b') as b:
                    b.truncate(0); shutil.copyfileobj(a, b)
                copied += 1
            else:
                shutil.copy2(f, dst); new += 1
    mj = s / 'models.json'
    if mj.exists():
        for r in json.loads(mj.read_text()):
            old = rows.get(r['name'])
            if old and 'thumb' in old:
                r['thumb'] = old['thumb']
            if r['name'] not in rows:
                order.append(r['name'])
            rows[r['name']] = r
out = [rows[n] for n in order]
with open(live / 'models.json', 'r+') as fh:
    fh.truncate(0); fh.write(json.dumps(out, indent=1) + '\n')
print(f'{live}: {copied} files rewritten in place, {new} new, {len(out)} manifest rows')
