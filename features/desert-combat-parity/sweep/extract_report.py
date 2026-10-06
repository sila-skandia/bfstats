import json, sys
src, dst = sys.argv[1], sys.argv[2]
last = None
for line in open(src):
    try: o = json.loads(line)
    except Exception: continue
    m = o.get('message') or {}
    if m.get('role') != 'assistant': continue
    c = m.get('content')
    if isinstance(c, list):
        t = ''.join(b.get('text','') for b in c if b.get('type')=='text')
        if t.strip(): last = t
open(dst,'w').write(last or '')
print(dst, len(last or ''))
